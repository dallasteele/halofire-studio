"""DXF "clean-import" wizard.

AutoSprink's workflow starts with "import the architect's DWG/DXF,
then strip everything you don't need (furniture, landscape,
annotation layers) so the sprinkler designer isn't distracted."
This is the HaloFire equivalent.

Input: arbitrary DXF. Output: cleaned DXF with only the layers
useful for sprinkler design (walls, structure, doors, windows,
grid, title block).

Strategy:
  * Identify layers by AIA / USACE / ArchiCAD / Revit naming
    conventions.
  * Keep layers matching any of `KEEP_PATTERNS`; drop the rest.
  * Freeze + lock what's kept so an accidental edit in the studio
    doesn't smear the architect's source.
  * Write the cleaned file; return a summary of what was kept vs
    dropped so the wizard UI can show the estimator exactly what
    happened.

Graceful fallback: if ezdxf isn't importable, returns an empty
summary with a reason string — caller shows a "please install ezdxf"
hint.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

try:
    import ezdxf
    _EZDXF = True
except ImportError:  # pragma: no cover
    _EZDXF = False


# Layer-name prefixes / regex patterns we keep. Covers the common
# CAD naming systems Halo sees.
KEEP_PATTERNS: list[re.Pattern] = [
    # National CAD Standard (AIA/USACE):
    #   A-WALL, A-WALL-INTR, A-WALL-EXTR, S-COLS, S-BEAM, S-JOIS,
    #   C-GRID, A-DOOR, A-GLAZ
    re.compile(r"^A-WALL", re.I),
    re.compile(r"^A-DOOR", re.I),
    re.compile(r"^A-GLAZ", re.I),
    re.compile(r"^A-FLOR-OUTL", re.I),
    re.compile(r"^S-COLS?", re.I),
    re.compile(r"^S-BEAM", re.I),
    re.compile(r"^S-JOIS", re.I),
    re.compile(r"^S-FNDN", re.I),
    re.compile(r"^C-GRID", re.I),
    re.compile(r"^G-GRID", re.I),
    re.compile(r"^G-TBLK", re.I),          # title block
    re.compile(r"^G-ANNO-BDRY", re.I),
    # Generic / architect-custom
    re.compile(r"^WALL", re.I),
    re.compile(r"^WALLS?$", re.I),
    re.compile(r"^COLUMN", re.I),
    re.compile(r"^BEAM", re.I),
    re.compile(r"^GRID", re.I),
    re.compile(r"^DOOR", re.I),
    re.compile(r"^WINDOW", re.I),
    re.compile(r"^ROOM", re.I),
    re.compile(r"^PARTITION", re.I),
    re.compile(r"^STRUCT", re.I),
]

# Explicit drop list — wins over keep if a layer matches both
# (common when a drafter named the Furniture layer "A-WALL-FURN").
DROP_PATTERNS: list[re.Pattern] = [
    re.compile(r"FURN", re.I),
    re.compile(r"LAND", re.I),      # landscape
    re.compile(r"PLNT", re.I),      # planting
    re.compile(r"SITE(?!-CURB)", re.I),  # site surveys except curbs
    re.compile(r"(^|-)ANNO-(?!BDRY)", re.I),  # annotation except bdry
    re.compile(r"DIM(S|ENSION)?", re.I),
    re.compile(r"HATCH", re.I),
    re.compile(r"TEXT", re.I),
    re.compile(r"SYMB", re.I),
    re.compile(r"NOTE", re.I),
    re.compile(r"SHEET", re.I),
    re.compile(r"VIEWPORT", re.I),
    # MEP trades other than FP
    re.compile(r"^M-", re.I),
    re.compile(r"^E-", re.I),
    re.compile(r"^P-", re.I),       # plumbing (not fire protection)
]


@dataclass
class CleanReport:
    input_path: str = ""
    output_path: str = ""
    total_layers: int = 0
    kept: list[str] = field(default_factory=list)
    dropped: list[str] = field(default_factory=list)
    entity_count_before: int = 0
    entity_count_after: int = 0
    status: str = "ok"
    error: str | None = None


def _layer_disposition(name: str) -> str:
    """Return 'drop' | 'keep' | 'unknown' for a DXF layer name."""
    for pat in DROP_PATTERNS:
        if pat.search(name):
            return "drop"
    for pat in KEEP_PATTERNS:
        if pat.search(name):
            return "keep"
    return "unknown"


def clean_dxf(
    input_path: str | Path,
    output_path: str | Path | None = None,
    *,
    keep_patterns: Iterable[re.Pattern] | None = None,
    drop_patterns: Iterable[re.Pattern] | None = None,
    freeze_kept_layers: bool = False,
    drop_unknown: bool = False,
) -> CleanReport:
    """Produce a cleaned DXF from an architect's source file.

    Rules:
      * A layer matching any `drop_patterns` is removed outright.
      * A layer matching any `keep_patterns` is kept.
      * A layer matching NEITHER is kept by default unless
        `drop_unknown=True`, in which case it's dropped too.
      * Entities belonging to dropped layers are removed from
        model space.
      * Freeze/lock is applied to the remaining layers when
        `freeze_kept_layers=True` (AutoSprink-style "lock the
        arch").
    """
    report = CleanReport()
    src = Path(input_path)
    report.input_path = str(src)
    if not _EZDXF:
        report.status = "error"
        report.error = "ezdxf not installed"
        return report
    if not src.exists():
        report.status = "error"
        report.error = f"input missing: {src}"
        return report
    try:
        doc = ezdxf.readfile(str(src))
    except Exception as e:  # noqa: BLE001
        report.status = "error"
        report.error = f"readfile failed: {e}"
        return report

    keeps = list(keep_patterns or KEEP_PATTERNS)
    drops = list(drop_patterns or DROP_PATTERNS)

    def _disp(name: str) -> str:
        for pat in drops:
            if pat.search(name):
                return "drop"
        for pat in keeps:
            if pat.search(name):
                return "keep"
        return "unknown"

    msp = doc.modelspace()
    report.entity_count_before = len(msp)
    # Categorize layers
    kept_names: set[str] = set()
    dropped_names: set[str] = set()
    for layer in doc.layers:
        name = layer.dxf.name
        # The special "0" and "Defpoints" layers always stay.
        if name in ("0", "Defpoints"):
            kept_names.add(name)
            continue
        d = _disp(name)
        if d == "drop":
            dropped_names.add(name)
        elif d == "keep":
            kept_names.add(name)
        else:
            (dropped_names if drop_unknown else kept_names).add(name)
    report.total_layers = len(kept_names) + len(dropped_names)
    report.kept = sorted(kept_names)
    report.dropped = sorted(dropped_names)

    # Delete entities on dropped layers
    to_delete = [e for e in msp if getattr(e.dxf, "layer", "") in dropped_names]
    for e in to_delete:
        msp.delete_entity(e)
    report.entity_count_after = len(msp)

    # Drop the layer table entries
    for name in dropped_names:
        try:
            doc.layers.remove(name)
        except Exception:  # noqa: BLE001
            # Some ezdxf versions don't expose remove on LayerTable;
            # leaving an empty layer is harmless (no entities remain).
            pass

    if freeze_kept_layers:
        for name in kept_names - {"0", "Defpoints"}:
            try:
                layer = doc.layers.get(name)
                layer.lock()
            except Exception:  # noqa: BLE001
                pass

    out = Path(output_path) if output_path else (
        src.with_name(src.stem + "-clean.dxf")
    )
    try:
        doc.saveas(str(out))
    except Exception as e:  # noqa: BLE001
        report.status = "error"
        report.error = f"saveas failed: {e}"
        return report
    report.output_path = str(out)
    return report


__all__ = [
    "KEEP_PATTERNS", "DROP_PATTERNS", "CleanReport",
    "clean_dxf",
]


if __name__ == "__main__":
    import json
    import sys
    if len(sys.argv) < 2:
        print("usage: python dxf_clean.py <input.dxf> [output.dxf]")
        sys.exit(2)
    inp = Path(sys.argv[1])
    outp = Path(sys.argv[2]) if len(sys.argv) > 2 else None
    r = clean_dxf(inp, outp, freeze_kept_layers=True, drop_unknown=False)
    print(json.dumps({
        "status": r.status,
        "input": r.input_path,
        "output": r.output_path,
        "kept_count": len(r.kept),
        "dropped_count": len(r.dropped),
        "entity_before": r.entity_count_before,
        "entity_after": r.entity_count_after,
        "error": r.error,
    }, indent=2))

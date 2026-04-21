"""V2 Phase 3.2 — Hydralist-format BOM export (.hlf).

Hydralist is the supplier-handoff format AutoSPRINK emits from
`Export ▸ Hydralist (.hlf)`. There's no public spec — the file is a
pipe-delimited flat-text record that fabricators and distributors
parse into their ordering systems. The conservative implementation
here writes the columns every Hydralist consumer we've seen expects,
with a header/footer that makes the file self-describing.

Format:

    #HYDRALIST|v1.0|<project_id>|<iso_timestamp>
    LINE|PART_NO|DESC|QTY|UOM|UNIT_COST|EXTENDED|MFG|FAB|NOTES
    001|SM_Head_Pendant_Standard_K56|Pendant K5.6 head|128|EA|22.50|3888.00|TYCO|Y|
    002|pipe_sch10_1in_ft|1" SCH10 pipe|842|FT|2.40|2729.76|ALLIED|N|cut-in-field
    ...
    #END|line_count=42|total_usd=595149.00

Design choices:
- Pipe-delimited (matches AutoSPRINK convention, Excel-safe when the
  consumer imports with `|` as separator)
- Line numbers zero-padded to 3 digits so the file sorts lexically
- UOM is "EA" for counted parts, "FT" for linear pipe — the Hydralist
  consumer uses UOM to route parts to the right pick list
- MFG defaults to empty; the catalog crawler will fill it in once
  SKUs are linked to a manufacturer record
- FAB flag: "N" if BomRow.do_not_fab is True (field-cut), else "Y"
- NOTES column holds diagnostics (`price_stale`, `price_missing`)
  so the supplier sees the risk up-front rather than finding it on
  invoice

One function:
    write_hydralist(rows, project_id, out_path) -> Path
"""
from __future__ import annotations

import datetime as _dt
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from cad.schema import BomRow  # noqa: E402

HLF_VERSION = "1.0"
HEADER_COLS = [
    "LINE", "PART_NO", "DESC", "QTY", "UOM",
    "UNIT_COST", "EXTENDED", "MFG", "FAB", "NOTES",
]


def _uom_for(row: BomRow) -> str:
    """Unit-of-measure: EA for counted items, FT for pipe footage."""
    if row.unit == "ft" or row.sku.endswith("_ft"):
        return "FT"
    if row.unit == "m":
        return "M"
    return "EA"


def _mfg_for(row: BomRow) -> str:
    """Coarse manufacturer mapping from SKU prefix. Empty when
    unknown — the catalog crawler will fill these in once the
    ManufacturerLink table is seeded."""
    sku = row.sku.lower()
    if sku.startswith("sm_head_") or "tyco" in sku:
        return "TYCO"
    if "viking" in sku or sku.startswith("vk"):
        return "VIKING"
    if "reliable" in sku:
        return "RELIABLE"
    if sku.startswith("pipe_sch"):
        return "ALLIED"
    if sku.startswith("valve_"):
        return "NIBCO"
    if sku.startswith("hanger_"):
        return "TOLCO"
    return ""


def _notes_for(row: BomRow) -> str:
    flags: list[str] = []
    if row.price_missing:
        flags.append("price_missing")
    if row.price_stale:
        flags.append("price_stale")
    if row.do_not_fab:
        flags.append("cut-in-field")
    return ";".join(flags)


def format_hydralist(
    rows: list[BomRow],
    project_id: str,
    now: _dt.datetime | None = None,
) -> str:
    """Return the Hydralist payload as a string."""
    ts = (now or _dt.datetime.utcnow()).replace(microsecond=0).isoformat()
    lines: list[str] = [
        f"#HYDRALIST|v{HLF_VERSION}|{project_id}|{ts}",
        "|".join(HEADER_COLS),
    ]
    total = 0.0
    # Sort by UOM (EA before FT) then by SKU for deterministic output —
    # suppliers eyeball the file before ingesting, grouping helps.
    ordered = sorted(
        rows,
        key=lambda r: (0 if _uom_for(r) == "EA" else 1, r.sku),
    )
    for i, row in enumerate(ordered, start=1):
        total += float(row.extended_usd)
        lines.append("|".join([
            f"{i:03d}",
            row.sku,
            row.description.replace("|", "/"),  # escape delimiter
            f"{row.qty:g}",
            _uom_for(row),
            f"{row.unit_cost_usd:.2f}",
            f"{row.extended_usd:.2f}",
            _mfg_for(row),
            "N" if row.do_not_fab else "Y",
            _notes_for(row),
        ]))
    lines.append(f"#END|line_count={len(ordered)}|total_usd={total:.2f}")
    return "\n".join(lines) + "\n"


def write_hydralist(
    rows: list[BomRow],
    project_id: str,
    out_path: str | Path,
    now: _dt.datetime | None = None,
) -> Path:
    """Write Hydralist file to disk, return the path."""
    payload = format_hydralist(rows, project_id, now=now)
    p = Path(out_path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(payload, encoding="utf-8")
    return p

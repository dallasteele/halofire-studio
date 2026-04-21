"""Render a GLB from a catalog entry by driving the OpenSCAD CLI.

The Python layer:
  1. Picks the template for the entry's category (pipe.scad,
     elbow_90.scad, ...)
  2. Synthesizes a `-D name=value` arg for each template parameter
     it exposes (size_in, length_m, schedule, ...).
  3. Shells out to `openscad` with `--export-format glb` (or falls
     back to STL+subsequent glb conversion for older OpenSCAD).

If OpenSCAD is not on PATH, the function returns (False, reason)
instead of raising — the pipeline treats missing meshes as a
"placeholder rendered" state so the rest of the Auto-Design loop
keeps working.

Usage:
    from authoring.scad.render_from_catalog import render_glb
    ok, msg = render_glb(entry, out_dir=Path('apps/editor/public/halofire-catalog/glb'))

Or CLI:
    python render_from_catalog.py --sku ANV-PIPE-SCH10-2in-21ft \\
      --out apps/editor/public/halofire-catalog/glb/
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

_HERE = Path(__file__).resolve().parent
_TEMPLATES = _HERE   # all .scad files live next to this script


@dataclass
class RenderSpec:
    template: str                   # .scad filename
    params: dict[str, float | str]  # -D flags

    def argv(self, openscad: str, scad: Path, out: Path) -> list[str]:
        args = [openscad, "--export-format", "glb", "-o", str(out)]
        for k, v in self.params.items():
            if isinstance(v, str):
                args += ["-D", f'{k}="{v}"']
            else:
                args += ["-D", f"{k}={v}"]
        args.append(str(scad))
        return args


# ── template picker ──────────────────────────────────────────────

def _template_for(category: str) -> str:
    c = (category or "").lower()
    if c.startswith("pipe_"):
        return "pipe.scad"
    if c == "fitting_elbow_90":
        return "elbow_90.scad"
    if c == "fitting_elbow_45":
        # Same template — caller tweaks params to interpret as 45°.
        return "elbow_90.scad"
    if c in ("fitting_tee_equal", "fitting_tee_reducing"):
        return "tee_equal.scad"
    if c == "fitting_reducer":
        return "reducer.scad"
    if c.startswith("fitting_coupling_"):
        return "coupling.scad"
    if c.startswith("valve_"):
        return "valve_inline.scad"
    if c in ("sprinkler_head_pendant", "sprinkler_head_concealed", "sprinkler_head_residential"):
        return "head_pendant.scad"
    if c == "sprinkler_head_upright":
        return "head_upright.scad"
    if c == "sprinkler_head_sidewall":
        return "head_sidewall.scad"
    if c == "column" or c == "structural_column":
        return "column.scad"
    return "placeholder.scad"


def _params_for(entry: dict[str, Any]) -> dict[str, float | str]:
    cat = (entry.get("category") or "").lower()
    size = float(entry.get("pipe_size_in") or 2.0)
    params: dict[str, float | str] = {}
    if cat.startswith("pipe_"):
        params["size_in"] = size
        # dims_cm[2] (length) if given, else 1 m
        dims = entry.get("dims_cm") or []
        length_cm = dims[2] if len(dims) >= 3 else 100
        params["length_m"] = float(length_cm) / 100.0
        params["schedule"] = "sch40" if "sch40" in cat else "sch10"
    elif cat == "fitting_reducer":
        params["size_in_large"] = size
        # Extract small from model e.g. "Reducer-2to1" → 1.0
        m = re.search(r"(\d+(?:\.\d+)?)to(\d+(?:\.\d+)?)", entry.get("model") or "")
        params["size_in_small"] = float(m.group(2)) if m else size / 2
    elif cat == "placeholder" or _template_for(cat) == "placeholder.scad":
        dims = entry.get("dims_cm") or [10, 10, 10]
        params["dim_l_mm"] = float(dims[0]) * 10
        params["dim_d_mm"] = float(dims[1]) * 10
        params["dim_h_mm"] = float(dims[2]) * 10
    elif cat.startswith("sprinkler_head_"):
        # Heads are size-invariant visually; just set k_factor if the
        # template uses it.
        params["k_factor"] = float(entry.get("k_factor") or 5.6)
    else:
        params["size_in"] = size
    return params


def spec_for(entry: dict[str, Any]) -> RenderSpec:
    template = _template_for(entry.get("category") or "")
    params = _params_for(entry)
    return RenderSpec(template=template, params=params)


# ── driver ──────────────────────────────────────────────────────

def openscad_available(openscad: str = "openscad") -> bool:
    return shutil.which(openscad) is not None


def render_glb(
    entry: dict[str, Any],
    out_dir: Path,
    *,
    openscad: str = "openscad",
    timeout_s: int = 60,
) -> tuple[bool, str]:
    """Render `entry` to `out_dir/<sku>.glb`. Returns (ok, message)."""
    sku = entry.get("sku")
    if not sku:
        return False, "entry has no sku"
    spec = spec_for(entry)
    scad = _TEMPLATES / spec.template
    if not scad.exists():
        return False, f"template missing: {spec.template}"
    if not openscad_available(openscad):
        return False, "openscad CLI not on PATH"
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{sku}.glb"
    argv = spec.argv(openscad, scad, out)
    try:
        res = subprocess.run(  # noqa: S603
            argv, capture_output=True, text=True, timeout=timeout_s,
        )
    except subprocess.TimeoutExpired:
        return False, f"openscad timed out after {timeout_s}s"
    if res.returncode != 0:
        return False, f"openscad exited {res.returncode}: {res.stderr.strip()[:300]}"
    if not out.exists() or out.stat().st_size == 0:
        return False, "openscad produced no output"
    return True, str(out)


# ── CLI ────────────────────────────────────────────────────────

def _load_catalog() -> list[dict]:
    """Read packages/halofire-catalog/src/manifest.ts via bun — falls
    back to the DuckDB supplies.parts table if bun isn't on PATH."""
    repo = _HERE.parents[3]  # halofire-studio
    try:
        res = subprocess.run(  # noqa: S603
            [
                "bun", "--bun", "-e",
                "import { CATALOG } from '@halofire/catalog'; "
                "process.stdout.write(JSON.stringify(CATALOG))",
            ],
            cwd=str(repo / "apps" / "editor"),
            capture_output=True, text=True, timeout=30,
        )
        if res.returncode == 0 and res.stdout.strip():
            return json.loads(res.stdout)
    except Exception:  # noqa: BLE001
        pass
    # DuckDB fallback — lets this tool still work on a box without bun
    try:
        import duckdb

        db_path = repo / "services" / "halofire-cad" / "pricing" / "supplies.duckdb"
        if not db_path.exists():
            return []
        con = duckdb.connect(str(db_path), read_only=True)
        rows = con.execute(
            "SELECT sku, name, category, pipe_size_in, k_factor, "
            "       dim_l_cm, dim_d_cm, dim_h_cm, model "
            "FROM parts",
        ).fetchall()
        out = []
        for r in rows:
            dims = [r[5], r[6], r[7]] if any(r[5:8]) else []
            out.append(
                {
                    "sku": r[0], "name": r[1], "category": r[2],
                    "pipe_size_in": r[3], "k_factor": r[4],
                    "dims_cm": dims, "model": r[8],
                },
            )
        return out
    except Exception:  # noqa: BLE001
        return []


def _cli() -> int:
    ap = argparse.ArgumentParser(description="OpenSCAD → GLB renderer")
    ap.add_argument("--sku", help="single SKU to render (omit = all)")
    ap.add_argument("--out", required=True, help="output directory")
    ap.add_argument("--openscad", default="openscad")
    args = ap.parse_args()
    out = Path(args.out)
    catalog = _load_catalog()
    if not catalog:
        print("catalog empty — seed supplies.duckdb or run from bun-enabled box", file=sys.stderr)
        return 2
    if args.sku:
        catalog = [e for e in catalog if e.get("sku") == args.sku]
        if not catalog:
            print(f"sku not found: {args.sku}", file=sys.stderr)
            return 2
    rendered = 0
    failed = 0
    for e in catalog:
        ok, msg = render_glb(e, out, openscad=args.openscad)
        if ok:
            rendered += 1
        else:
            failed += 1
            print(f"  skip {e.get('sku')}: {msg}", file=sys.stderr)
    print(f"rendered {rendered}/{len(catalog)} ({failed} skipped)")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(_cli())

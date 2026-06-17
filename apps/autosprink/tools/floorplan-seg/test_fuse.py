#!/usr/bin/env python3
"""Standalone regression gate for the 1881 floorplan fuse pass."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path


HERE = Path(__file__).resolve().parent
FUSE_PATH = HERE / "fuse.py"
OUT_DIR = HERE / "out"
RASTER = Path("/opt/hal9000/state/sam-1881-p8-008.png")


def _load_fuse_module():
    spec = importlib.util.spec_from_file_location("floorplan_seg_fuse", FUSE_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"unable to load {FUSE_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> None:
    fuse = _load_fuse_module()
    summary = fuse.run_fuse(RASTER, OUT_DIR)

    overlay_path = OUT_DIR / "fused_overlay.png"
    wall_path = OUT_DIR / "wall-lines.json"
    if not overlay_path.exists():
        raise AssertionError(f"missing overlay: {overlay_path}")
    if not wall_path.exists():
        raise AssertionError(f"missing wall lines: {wall_path}")

    wall_lines = json.loads(wall_path.read_text())
    wall_total = len(wall_lines)
    wall_in_parking = sum(1 for line in wall_lines if line.get("parkingRegionHit"))
    ratio = (wall_in_parking / wall_total) if wall_total else 0.0

    if ratio >= 0.05:
        raise AssertionError(
            f"parking exclusion regressed: wall lines in parking region ratio {ratio:.4f} >= 0.05"
        )

    print(
        json.dumps(
            {
                "overlayPath": str(overlay_path),
                "wallLines": wall_total,
                "wallLinesInParkingRegions": wall_in_parking,
                "wallParkingRatio": round(ratio, 6),
                "summaryMetrics": summary["metrics"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()

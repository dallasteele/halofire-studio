#!/usr/bin/env python3
"""Regression gate for floorplan wall recall with parking-stall exclusion."""

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

    walls_path = OUT_DIR / "walls.json"
    overlay_path = OUT_DIR / "walls_overlay.png"
    if not walls_path.exists():
        raise AssertionError(f"missing walls output: {walls_path}")
    if not overlay_path.exists():
        raise AssertionError(f"missing overlay output: {overlay_path}")

    walls = json.loads(walls_path.read_text(encoding="utf-8"))
    if summary["metrics"]["inputVectorLines"] < 6800:
        raise AssertionError(
            f"unexpected vector wall baseline: {summary['metrics']['inputVectorLines']} < 6800"
        )

    total_walls = len(walls)
    if total_walls <= 0:
        raise AssertionError("no kept wall lines were emitted")

    overlap_count = sum(1 for line in walls if float(line.get("stallOverlapRatio", 0.0)) > 0.0)
    overlap_ratio = overlap_count / total_walls
    if overlap_ratio >= 0.03:
        raise AssertionError(
            f"wall lines overlapping stalls regressed: {overlap_ratio:.6f} >= 0.03"
        )

    for tower in summary["perTower"]:
        if tower["wallLines"] < 100:
            raise AssertionError(
                f"tower {tower['towerIndex']} wall recall too low: {tower['wallLines']} < 100"
            )

    print(
        json.dumps(
            {
                "wallsPath": str(walls_path),
                "overlayPath": str(overlay_path),
                "inputVectorLines": summary["metrics"]["inputVectorLines"],
                "keptWallLines": total_walls,
                "wallLinesOverlappingStalls": overlap_count,
                "wallStallRatio": round(overlap_ratio, 6),
                "perTower": summary["perTower"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()

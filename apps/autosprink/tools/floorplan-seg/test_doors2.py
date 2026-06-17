#!/usr/bin/env python3
"""Regression gate for per-tower raster door detection on the real 1881 page."""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path


HERE = Path(__file__).resolve().parent
MODULE_PATH = HERE / "door_detect.py"
OUT_DIR = HERE / "out"
RASTER = Path("/opt/hal9000/state/sam-1881-p8-008.png")


def _load_module():
    spec = importlib.util.spec_from_file_location("floorplan_seg_door_detect", MODULE_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"unable to load {MODULE_PATH}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def main() -> None:
    detector = _load_module()
    summary = detector.run_door_detection_per_tower(RASTER, OUT_DIR)

    overlay_path = OUT_DIR / "doors_overlay.png"
    doors_path = OUT_DIR / "doors.json"
    if not overlay_path.exists():
        raise AssertionError(f"missing overlay: {overlay_path}")
    if not doors_path.exists():
        raise AssertionError(f"missing doors json: {doors_path}")

    doors = json.loads(doors_path.read_text())
    tower_counts = summary["metrics"]["doorCountsByTower"]
    door_count = len(doors)

    if summary["metrics"]["towerCount"] != 2:
        raise AssertionError(f"expected exactly 2 towers, got {summary['metrics']['towerCount']}")
    if door_count < 5:
        raise AssertionError(f"expected at least 5 detected doors across both towers, got {door_count}")
    if door_count > 400:
        raise AssertionError(f"expected at most 400 detected doors across both towers, got {door_count}")
    if any("towerIndex" not in door for door in doors):
        raise AssertionError("every detected door must expose towerIndex")
    if any("position" not in door or "width" not in door or "swing" not in door for door in doors):
        raise AssertionError("every detected door must expose position, width, and swing")
    if set(tower_counts.keys()) != {"0", "1"}:
        raise AssertionError(f"unexpected tower keys: {sorted(tower_counts.keys())}")
    if any(int(count) < 1 for count in tower_counts.values()):
        raise AssertionError(f"expected at least one detected door per tower, got {tower_counts}")

    print(
        json.dumps(
            {
                "overlayPath": str(overlay_path),
                "doorsPath": str(doors_path),
                "doorCount": door_count,
                "towerCounts": tower_counts,
                "summaryMetrics": summary["metrics"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()

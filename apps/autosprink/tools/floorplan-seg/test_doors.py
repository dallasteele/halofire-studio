#!/usr/bin/env python3
"""Standalone regression gate for raster door detection on the real 1881 page."""

from __future__ import annotations

import importlib.util
import json
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
    spec.loader.exec_module(module)
    return module


def main() -> None:
    detector = _load_module()
    summary = detector.run_door_detection(RASTER, OUT_DIR)

    overlay_path = OUT_DIR / "doors_overlay.png"
    doors_path = OUT_DIR / "doors.json"
    if not overlay_path.exists():
        raise AssertionError(f"missing overlay: {overlay_path}")
    if not doors_path.exists():
        raise AssertionError(f"missing doors json: {doors_path}")

    doors = json.loads(doors_path.read_text())
    door_count = len(doors)
    if door_count < 3:
        raise AssertionError(f"expected at least 3 detected doors, got {door_count}")
    if door_count > 300:
        raise AssertionError(f"expected at most 300 detected doors, got {door_count}")
    if any("position" not in door or "width" not in door or "swing" not in door for door in doors):
        raise AssertionError("every detected door must expose position, width, and swing")

    print(
        json.dumps(
            {
                "overlayPath": str(overlay_path),
                "doorsPath": str(doors_path),
                "doorCount": door_count,
                "summaryMetrics": summary["metrics"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()

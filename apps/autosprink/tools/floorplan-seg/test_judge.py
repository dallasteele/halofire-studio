#!/usr/bin/env python3
"""Real regression gate for the floorplan vision judge loop."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path


HERE = Path(__file__).resolve().parent
MODULE_PATH = HERE / "judge_loop.py"
OUT_DIR = HERE / "out"
RASTER = Path("/opt/hal9000/state/sam-1881-p8-008.png")


def _load_module():
    spec = importlib.util.spec_from_file_location("floorplan_seg_judge_loop", MODULE_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"unable to load {MODULE_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> None:
    judge = _load_module()
    log = judge.run_judge_loop(RASTER, OUT_DIR)

    judge_log_path = OUT_DIR / "judge_log.json"
    overlay_path = OUT_DIR / "converged_overlay.png"
    if not judge_log_path.exists():
        raise AssertionError(f"missing judge log: {judge_log_path}")
    if not overlay_path.exists():
        raise AssertionError(f"missing converged overlay: {overlay_path}")

    judge_log = json.loads(judge_log_path.read_text())
    iterations = judge_log.get("iterations") or []
    if not iterations:
        raise AssertionError("expected at least one real judge iteration")

    critique_count = 0
    required = {"missed_walls", "parking_as_wall", "missed_doors", "ok"}
    for item in iterations:
        critique = item.get("critique")
        if not isinstance(critique, dict):
            continue
        if not required.issubset(critique.keys()):
            raise AssertionError(f"critique missing required keys: {critique.keys()}")
        critique_count += 1

    if critique_count < 1:
        raise AssertionError("expected >=1 real qwen2.5vl critique in judge_log.json")

    print(
        json.dumps(
            {
                "judgeLogPath": str(judge_log_path),
                "convergedOverlayPath": str(overlay_path),
                "iterations": len(iterations),
                "critiqueCount": critique_count,
                "summary": log.get("summary"),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()

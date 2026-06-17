from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parent
IMAGE_PATH = Path("/opt/hal9000/state/sam-1881-p8-008.png")
OUTPUT_DIR = Path("/opt/hal9000/state/seg-1881")


def _load_module(name: str):
    module_path = ROOT / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"unable to load module: {module_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _regularity(values: list[int]) -> float:
    if len(values) < 2:
        return 9999.0
    diffs = [b - a for a, b in zip(values, values[1:])]
    mean = sum(diffs) / len(diffs)
    if mean <= 0:
        return 9999.0
    spread = max(abs(diff - mean) for diff in diffs)
    return spread / mean


def main() -> int:
    detector = _load_module("stall_detect")
    result = detector.detect_stalls(IMAGE_PATH, OUTPUT_DIR)

    stalls = result["stalls"]
    assert len(stalls) >= 20, f"expected >=20 stall rectangles, found {len(stalls)}"

    overlay_path = Path(result["stalls_overlay_path"])
    assert overlay_path.exists(), f"missing overlay: {overlay_path}"

    unique_boxes = {(stall["x"], stall["y"], stall["w"], stall["h"]) for stall in stalls}
    assert len(unique_boxes) >= 10, "detector collapsed to too few unique stall boxes"

    towers = result["towers"]
    grid_towers = []
    for tower in towers:
        active_rows = []
        for row in tower["rows"]:
            xs = row.get("regular_xs", [])
            if row.get("stall_count", 0) < 5 or len(xs) < 6:
                continue
            active_rows.append((row["row"], xs, row["stall_count"], _regularity(xs)))
        if active_rows:
            grid_towers.append((tower, active_rows))

    assert grid_towers, "no regular stall row detected"
    qualifying_towers = [
        (tower, rows)
        for tower, rows in grid_towers
        if tower.get("stall_count", 0) >= 10 and len([row for row in tower["rows"] if row.get("stall_count", 0) > 0]) >= 2
    ]
    assert qualifying_towers, "no tower produced a multi-row stall field"

    best_tower, best_rows = max(qualifying_towers, key=lambda item: item[0]["stall_count"])
    best_row_regularity = min(row[3] for row in best_rows)
    assert best_row_regularity <= 0.2, (
        f"best recovered stall row spacing too irregular: {best_row_regularity:.3f}"
    )

    output_path = OUTPUT_DIR / "stall_detect.json"
    assert output_path.exists(), f"missing manifest: {output_path}"
    payload = json.loads(output_path.read_text(encoding="utf-8"))
    assert len(payload["stalls"]) == len(stalls), "manifest stall count mismatch"
    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

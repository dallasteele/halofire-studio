from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parent
IMAGE_PATH = Path("/opt/hal9000/state/sam-1881-p8-008.png")
OUTPUT_DIR = Path("/opt/hal9000/state/seg-1881")


def _load_splitter():
    module_path = ROOT / "tower_split.py"
    spec = importlib.util.spec_from_file_location("tower_split", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"unable to load module: {module_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _bbox_area(bbox: dict[str, int]) -> int:
    return int(bbox["w"]) * int(bbox["h"])


def _intersection_area(a: dict[str, int], b: dict[str, int]) -> int:
    ax1 = int(a["x"]) + int(a["w"])
    ay1 = int(a["y"]) + int(a["h"])
    bx1 = int(b["x"]) + int(b["w"])
    by1 = int(b["y"]) + int(b["h"])
    ix0 = max(int(a["x"]), int(b["x"]))
    iy0 = max(int(a["y"]), int(b["y"]))
    ix1 = min(ax1, bx1)
    iy1 = min(ay1, by1)
    if ix1 <= ix0 or iy1 <= iy0:
        return 0
    return (ix1 - ix0) * (iy1 - iy0)


def main() -> int:
    splitter = _load_splitter()
    result = splitter.split_towers(IMAGE_PATH, OUTPUT_DIR)

    towers = result["towers"]
    assert len(towers) == 2, f"expected exactly 2 towers, found {len(towers)}"

    sheet = result["sheet_size"]
    sheet_area = int(sheet["width"]) * int(sheet["height"])
    boxes = [tower["bbox"] for tower in towers]

    for idx, tower in enumerate(towers):
        bbox = tower["bbox"]
        bbox_frac = _bbox_area(bbox) / sheet_area
        assert 0.08 <= bbox_frac <= 0.45, (
            f"tower_{idx} bbox area fraction out of range: {bbox_frac:.4f}"
        )
        image_path = Path(tower["image_path"])
        assert image_path.exists(), f"missing crop: {image_path}"

    assert _intersection_area(boxes[0], boxes[1]) == 0, "tower bboxes overlap"

    json_path = OUTPUT_DIR / "tower_split.json"
    assert json_path.exists(), f"missing manifest: {json_path}"
    payload = json.loads(json_path.read_text(encoding="utf-8"))
    assert len(payload["towers"]) == 2, "manifest tower count mismatch"
    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

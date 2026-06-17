#!/usr/bin/env python3
"""Fuse committed vector walls with semantic masks and subtract parking stalls.

This slice stays narrow and truthful:
- Input walls are the committed 1881 vector segments from plan data.
- Semantic masks only filter which committed segments are kept as walls.
- Parking-stall geometry is detected per tower and subtracted from the wall set.
- No vector segment geometry is altered; lines are only classified or excluded.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from stall_detect import detect_stalls


REPO_ROOT = Path(__file__).resolve().parents[4]
PLAN_PATH = REPO_ROOT / "apps/autosprink/src/data/plan-levels.cooperative-1881.json"
DEFAULT_RASTER = Path("/opt/hal9000/state/sam-1881-p8-008.png")
MASK_DIR = Path("/opt/hal9000/state/seg-1881")
DEFAULT_OUT_DIR = HERE / "out"

MASK_PATHS = {
    "ensemble": MASK_DIR / "ensemble_walls.png",
    "cubicasa": MASK_DIR / "cubicasa_official_walls.png",
    "mask2former": MASK_DIR / "hf_mask2former_lineart_walls.png",
}

WALL_MASK_THRESHOLD = 0.04
PARKING_PAD_FT = 1.0
DOOR_ZONE_PAD_FT = 2.0
STAIR_PAD_FT = 1.5
LINE_SAMPLE_RADIUS_PX = 2
STALL_OVERLAP_KEEP_MAX = 0.02

COLORS = {
    "wall": (68, 168, 76),
    "stall-excluded": (255, 75, 75),
    "parking-edge": (120, 120, 120),
    "stair": (255, 145, 64),
    "door-zone": (58, 139, 255),
    "other": (190, 85, 85),
}


def _load_plan() -> dict:
    data = json.loads(PLAN_PATH.read_text(encoding="utf-8"))
    return data["levels"][0]["plan"]


def _load_mask(path: Path) -> np.ndarray:
    return np.array(Image.open(path).convert("L"))


def _segment_length_ft(line: dict) -> float:
    (x1, y1), (x2, y2) = line["a"], line["b"]
    return math.hypot(x2 - x1, y2 - y1)


def _segment_midpoint(line: dict) -> tuple[float, float]:
    (x1, y1), (x2, y2) = line["a"], line["b"]
    return ((x1 + x2) / 2.0, (y1 + y2) / 2.0)


def _feet_to_px(x_ft: float, y_ft: float, bbox: dict, width: int, height: int) -> tuple[int, int]:
    px = round((x_ft - bbox["minX"]) / (bbox["maxX"] - bbox["minX"]) * (width - 1))
    py = round((y_ft - bbox["minY"]) / (bbox["maxY"] - bbox["minY"]) * (height - 1))
    return (max(0, min(width - 1, px)), max(0, min(height - 1, py)))


def _line_mask_coverage(line: dict, mask: np.ndarray, bbox: dict, radius_px: int = LINE_SAMPLE_RADIUS_PX) -> float:
    height, width = mask.shape
    (x1, y1), (x2, y2) = line["a"], line["b"]
    samples = max(6, min(80, int(_segment_length_ft(line) * 3)))
    hits = 0
    total = 0
    for idx in range(samples):
        t = idx / (samples - 1) if samples > 1 else 0.0
        x_ft = x1 + (x2 - x1) * t
        y_ft = y1 + (y2 - y1) * t
        px, py = _feet_to_px(x_ft, y_ft, bbox, width, height)
        for oy in range(-radius_px, radius_px + 1):
            yy = min(height - 1, max(0, py + oy))
            for ox in range(-radius_px, radius_px + 1):
                xx = min(width - 1, max(0, px + ox))
                total += 1
                if mask[yy, xx] > 127:
                    hits += 1
    return hits / total if total else 0.0


def _point_in_bbox(x: float, y: float, bbox: dict, pad: float = 0.0) -> bool:
    return (
        bbox["minX"] - pad <= x <= bbox["maxX"] + pad
        and bbox["minY"] - pad <= y <= bbox["maxY"] + pad
    )


def _build_parking_regions(plan: dict) -> list[dict]:
    regions = []
    for room in plan.get("rooms", []):
        if room.get("kind") != "parking":
            continue
        poly = room.get("poly") or []
        if not poly:
            continue
        xs = [point[0] for point in poly]
        ys = [point[1] for point in poly]
        regions.append(
            {
                "label": room.get("label"),
                "source": room.get("kindSource", "room-kind"),
                "bbox": {
                    "minX": min(xs),
                    "minY": min(ys),
                    "maxX": max(xs),
                    "maxY": max(ys),
                },
            }
        )
    return regions


def _build_stair_regions(plan: dict) -> list[dict]:
    return [stair for stair in plan.get("stairs", []) if stair.get("bbox")]


def _build_door_regions(plan: dict) -> list[dict]:
    regions = []
    for item in plan.get("doors", []) + plan.get("openings", []):
        pos = item.get("position")
        width = float(item.get("width") or 0.0)
        if not pos or len(pos) != 2:
            continue
        half = max(width / 2.0, 1.0) + DOOR_ZONE_PAD_FT
        regions.append(
            {
                "source": item.get("kind", "opening"),
                "bbox": {
                    "minX": pos[0] - half,
                    "minY": pos[1] - half,
                    "maxX": pos[0] + half,
                    "maxY": pos[1] + half,
                },
            }
        )
    return regions


def _build_full_sheet_stalls(stall_payload: dict, tower_payload: dict) -> tuple[list[dict], list[dict]]:
    tower_lookup = {int(tower["index"]): tower for tower in tower_payload["towers"]}
    full_sheet_stalls: list[dict] = []
    stall_regions_by_tower: list[dict] = []
    for stall in stall_payload["stalls"]:
        tower = tower_lookup[int(stall["tower_index"])]
        tower_bbox = tower["bbox"]
        stall_bbox = {
            "x0": int(tower_bbox["x"]) + int(stall["x"]),
            "y0": int(tower_bbox["y"]) + int(stall["y"]),
            "x1": int(tower_bbox["x"]) + int(stall["x"]) + int(stall["w"]),
            "y1": int(tower_bbox["y"]) + int(stall["y"]) + int(stall["h"]),
        }
        full_sheet_stalls.append({"towerIndex": int(stall["tower_index"]), "bbox": stall_bbox, "row": stall["row"]})
        stall_regions_by_tower.append({"towerIndex": int(stall["tower_index"]), "bbox": stall_bbox})
    return full_sheet_stalls, stall_regions_by_tower


def _line_box_overlap_ratio(line: dict, stall_boxes: list[dict], plan_bbox: dict, width: int, height: int) -> float:
    if not stall_boxes:
        return 0.0
    (x1, y1), (x2, y2) = line["a"], line["b"]
    samples = max(6, min(80, int(_segment_length_ft(line) * 3)))
    overlap_hits = 0
    for idx in range(samples):
        t = idx / (samples - 1) if samples > 1 else 0.0
        x_ft = x1 + (x2 - x1) * t
        y_ft = y1 + (y2 - y1) * t
        px, py = _feet_to_px(x_ft, y_ft, plan_bbox, width, height)
        if any(box["x0"] <= px <= box["x1"] and box["y0"] <= py <= box["y1"] for box in stall_boxes):
            overlap_hits += 1
    return overlap_hits / samples if samples else 0.0


def _tower_index_for_line(line: dict, towers: list[dict], plan_bbox: dict, width: int, height: int) -> int | None:
    mx, my = _segment_midpoint(line)
    px, py = _feet_to_px(mx, my, plan_bbox, width, height)
    for tower in towers:
        bbox = tower["bbox"]
        if bbox["x"] <= px <= bbox["x"] + bbox["w"] and bbox["y"] <= py <= bbox["y"] + bbox["h"]:
            return int(tower["index"])
    return None


def _serialize_line(
    line: dict,
    category: str,
    tower_index: int | None,
    parking_hit: bool,
    stall_overlap_ratio: float,
    mask_scores: dict,
) -> dict:
    out = {
        "a": [round(float(line["a"][0]), 4), round(float(line["a"][1]), 4)],
        "b": [round(float(line["b"][0]), 4), round(float(line["b"][1]), 4)],
        "category": category,
        "towerIndex": tower_index,
        "parkingRegionHit": bool(parking_hit),
        "stallOverlapRatio": round(float(stall_overlap_ratio), 6),
        "lengthFt": round(_segment_length_ft(line), 4),
        "maskScores": {key: round(float(value), 4) for key, value in mask_scores.items()},
    }
    return out


def run_fuse(raster_path: Path | str = DEFAULT_RASTER, out_dir: Path | str = DEFAULT_OUT_DIR) -> dict:
    raster_path = Path(raster_path)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    plan = _load_plan()
    plan_bbox = plan["footprintBboxFt"]
    raster = Image.open(raster_path).convert("RGB")
    width, height = raster.size
    masks = {name: _load_mask(path) for name, path in MASK_PATHS.items()}
    if any(mask.shape != (height, width) for mask in masks.values()):
        raise RuntimeError("semantic masks do not match raster dimensions")

    stall_payload = detect_stalls(raster_path, out_dir)
    tower_payload = json.loads((out_dir / "tower_split.json").read_text(encoding="utf-8"))
    towers = tower_payload["towers"]
    full_sheet_stalls, _ = _build_full_sheet_stalls(stall_payload, tower_payload)

    parking_regions = _build_parking_regions(plan)
    stair_regions = _build_stair_regions(plan)
    door_regions = _build_door_regions(plan)

    classified = {
        "wall": [],
        "stall-excluded": [],
        "parking-edge": [],
        "stair": [],
        "door-zone": [],
        "other": [],
    }
    tower_wall_counts = {int(tower["index"]): 0 for tower in towers}
    tower_stall_overlap_counts = {int(tower["index"]): 0 for tower in towers}

    for raw_line in plan["walls"]:
        line = {"a": raw_line["a"], "b": raw_line["b"]}
        mx, my = _segment_midpoint(line)
        tower_index = _tower_index_for_line(line, towers, plan_bbox, width, height)
        tower_stalls = [stall["bbox"] for stall in full_sheet_stalls if stall["towerIndex"] == tower_index]
        parking_hit = any(_point_in_bbox(mx, my, region["bbox"], PARKING_PAD_FT) for region in parking_regions)
        stair_hit = any(_point_in_bbox(mx, my, stair["bbox"], STAIR_PAD_FT) for stair in stair_regions)
        door_hit = any(_point_in_bbox(mx, my, region["bbox"]) for region in door_regions)
        stall_overlap_ratio = _line_box_overlap_ratio(line, tower_stalls, plan_bbox, width, height)
        mask_scores = {
            "ensemble": _line_mask_coverage(line, masks["ensemble"], plan_bbox),
            "cubicasa": _line_mask_coverage(line, masks["cubicasa"], plan_bbox),
            "mask2former": _line_mask_coverage(line, masks["mask2former"], plan_bbox),
        }
        mask_support = max(mask_scores.values())

        if door_hit:
            category = "door-zone"
        elif stair_hit:
            category = "stair"
        elif stall_overlap_ratio > STALL_OVERLAP_KEEP_MAX:
            category = "stall-excluded"
        elif parking_hit:
            category = "parking-edge"
        elif mask_support >= WALL_MASK_THRESHOLD:
            category = "wall"
        else:
            category = "other"

        payload = _serialize_line(
            line=line,
            category=category,
            tower_index=tower_index,
            parking_hit=parking_hit,
            stall_overlap_ratio=stall_overlap_ratio,
            mask_scores=mask_scores,
        )
        classified[category].append(payload)
        if category == "wall" and tower_index is not None:
            tower_wall_counts[tower_index] += 1
            if stall_overlap_ratio > 0:
                tower_stall_overlap_counts[tower_index] += 1

    walls = classified["wall"]
    wall_total = len(walls)
    wall_stall_overlap = sum(1 for line in walls if line["stallOverlapRatio"] > 0)
    wall_stall_ratio = (wall_stall_overlap / wall_total) if wall_total else 0.0

    overlay = raster.copy()
    draw = ImageDraw.Draw(overlay)
    for stall in full_sheet_stalls:
        bbox = stall["bbox"]
        draw.rectangle([(bbox["x0"], bbox["y0"]), (bbox["x1"], bbox["y1"])], outline=(255, 210, 0), width=2)
    for category in ("other", "parking-edge", "door-zone", "stair", "stall-excluded", "wall"):
        color = COLORS[category]
        width_px = 1 if category == "other" else 2
        for line in classified[category]:
            a = _feet_to_px(line["a"][0], line["a"][1], plan_bbox, width, height)
            b = _feet_to_px(line["b"][0], line["b"][1], plan_bbox, width, height)
            draw.line([a, b], fill=color, width=width_px)

    walls_path = out_dir / "walls.json"
    walls_path.write_text(json.dumps(walls, indent=2), encoding="utf-8")
    per_tower = []
    for tower in towers:
        tower_index = int(tower["index"])
        tower_lines = [line for line in walls if line["towerIndex"] == tower_index]
        overlap_lines = [line for line in tower_lines if line["stallOverlapRatio"] > 0]
        ratio = (len(overlap_lines) / len(tower_lines)) if tower_lines else 0.0
        per_tower.append(
            {
                "towerIndex": tower_index,
                "wallLines": len(tower_lines),
                "wallLinesOverlappingStalls": len(overlap_lines),
                "wallStallRatio": round(ratio, 6),
                "bbox": tower["bbox"],
            }
        )

    overlay_path = out_dir / "walls_overlay.png"
    overlay.save(overlay_path)
    summary = {
        "raster": str(raster_path),
        "planPath": str(PLAN_PATH),
        "maskPaths": {name: str(path) for name, path in MASK_PATHS.items()},
        "towerSplitPath": str(out_dir / "tower_split.json"),
        "stallDetectPath": str(out_dir / "stall_detect.json"),
        "wallsPath": str(walls_path),
        "overlayPath": str(overlay_path),
        "lineCounts": {key: len(value) for key, value in classified.items()},
        "metrics": {
            "inputVectorLines": len(plan["walls"]),
            "keptWallLines": wall_total,
            "wallLinesOverlappingStalls": wall_stall_overlap,
            "wallStallRatio": round(wall_stall_ratio, 6),
            "stallCount": len(full_sheet_stalls),
            "towerCount": len(towers),
        },
        "perTower": per_tower,
        "notes": [
            "The committed 1881 vector wall geometry is preserved verbatim; this pass only classifies segments.",
            "Semantic masks act as recall filters, while tower-local stall rectangles are subtracted from the kept wall set.",
            "Parking room anchors remain as a coarse exclusion, but the wall gate is measured against detected stall overlap.",
        ],
    }
    (out_dir / "wall-summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))
    return summary


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raster", default=str(DEFAULT_RASTER))
    parser.add_argument("--out-dir", default=str(DEFAULT_OUT_DIR))
    args = parser.parse_args()
    run_fuse(args.raster, args.out_dir)


if __name__ == "__main__":
    main()

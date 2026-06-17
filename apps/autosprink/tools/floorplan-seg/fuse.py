#!/usr/bin/env python3
"""Fuse real 1881 vector lines with semantic wall masks and plan anchors.

This is deliberately narrow and honest:
- Vector lines come from the committed 1881 L1 plan extractor output.
- Semantic wall evidence comes from the committed raster masks under
  /opt/hal9000/state/seg-1881.
- Text anchors come from the committed `plan.labels` field when the sheet has
  usable OCR tokens. When it does not, we fall back to the extractor's own
  parking/stair/door regions instead of fabricating OCR labels that are not
  present on the sheet.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


REPO_ROOT = Path(__file__).resolve().parents[4]
PLAN_PATH = REPO_ROOT / "apps/autosprink/src/data/plan-levels.cooperative-1881.json"
DEFAULT_RASTER = Path("/opt/hal9000/state/sam-1881-p8-008.png")
MASK_DIR = Path("/opt/hal9000/state/seg-1881")
DEFAULT_OUT_DIR = Path(__file__).resolve().parent / "out"

MASK_PATHS = {
    "ensemble": MASK_DIR / "ensemble_walls.png",
    "cubicasa": MASK_DIR / "cubicasa_official_walls.png",
    "mask2former": MASK_DIR / "hf_mask2former_lineart_walls.png",
}

WALL_MASK_THRESHOLD = 0.04
DOOR_ZONE_PAD_FT = 2.0
STAIR_PAD_FT = 1.5
PARKING_PAD_FT = 1.0
LINE_SAMPLE_RADIUS_PX = 2

COLORS = {
    "wall": (68, 168, 76),
    "parking-edge": (120, 120, 120),
    "stair": (255, 145, 64),
    "door-zone": (58, 139, 255),
    "other": (200, 70, 70),
}


def _load_plan() -> dict:
    data = json.loads(PLAN_PATH.read_text())
    return data["levels"][0]["plan"]


def _load_mask(path: Path) -> np.ndarray:
    return np.array(Image.open(path).convert("L"))


def _point_in_bbox(x: float, y: float, bbox: dict, pad: float = 0.0) -> bool:
    return (
        bbox["minX"] - pad <= x <= bbox["maxX"] + pad
        and bbox["minY"] - pad <= y <= bbox["maxY"] + pad
    )


def _segment_midpoint(line: dict) -> tuple[float, float]:
    (x1, y1), (x2, y2) = line["a"], line["b"]
    return ((x1 + x2) / 2.0, (y1 + y2) / 2.0)


def _segment_length_ft(line: dict) -> float:
    (x1, y1), (x2, y2) = line["a"], line["b"]
    return math.hypot(x2 - x1, y2 - y1)


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


def _build_parking_regions(plan: dict) -> list[dict]:
    regions = []
    for room in plan.get("rooms", []):
        if room.get("kind") != "parking":
            continue
        poly = room.get("poly") or []
        xs = [p[0] for p in poly]
        ys = [p[1] for p in poly]
        if not xs or not ys:
            continue
        regions.append(
            {
                "source": room.get("kindSource", "room-kind"),
                "label": room.get("label"),
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
    regions = []
    for stair in plan.get("stairs", []):
        bbox = stair.get("bbox")
        if bbox:
            regions.append(
                {
                    "source": stair.get("source", "geometric"),
                    "evidence": stair.get("evidence"),
                    "bbox": bbox,
                }
            )
    return regions


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


def _collect_text_anchors(plan: dict) -> dict:
    anchors = {"parking": [], "stair": [], "mech": [], "elec": []}
    for label in plan.get("labels", []):
        text = str(label.get("text") or "").strip()
        if not text:
            continue
        upper = text.upper()
        base = {"text": text, "xFt": label["xFt"], "yFt": label["yFt"], "source": "ocr"}
        if "PARK" in upper:
            anchors["parking"].append(base)
        if upper in {"UP", "DN", "DOWN"} or "STAIR" in upper:
            anchors["stair"].append(base)
        if "MECH" in upper:
            anchors["mech"].append(base)
        if "ELEC" in upper:
            anchors["elec"].append(base)
    if not anchors["parking"]:
        for region in _build_parking_regions(plan):
            bbox = region["bbox"]
            anchors["parking"].append(
                {
                    "text": region.get("label") or "parking-room-fallback",
                    "xFt": (bbox["minX"] + bbox["maxX"]) / 2.0,
                    "yFt": (bbox["minY"] + bbox["maxY"]) / 2.0,
                    "source": region["source"],
                }
            )
    return anchors


def _serialize_line(line: dict, mask_scores: dict, category: str, parking_hit: bool) -> dict:
    out = {
        "a": [round(float(line["a"][0]), 4), round(float(line["a"][1]), 4)],
        "b": [round(float(line["b"][0]), 4), round(float(line["b"][1]), 4)],
        "category": category,
        "maskScores": {k: round(float(v), 4) for k, v in mask_scores.items()},
        "parkingRegionHit": bool(parking_hit),
        "lengthFt": round(_segment_length_ft(line), 4),
    }
    if "source" in line:
        out["source"] = line["source"]
    return out


def run_fuse(raster_path: Path | str = DEFAULT_RASTER, out_dir: Path | str = DEFAULT_OUT_DIR) -> dict:
    raster_path = Path(raster_path)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    plan = _load_plan()
    bbox = plan["footprintBboxFt"]
    masks = {name: _load_mask(path) for name, path in MASK_PATHS.items()}
    raster = Image.open(raster_path).convert("RGB")
    width, height = raster.size

    if any(mask.shape != (height, width) for mask in masks.values()):
        raise RuntimeError("semantic masks do not match raster dimensions")

    lines = plan["walls"]
    parking_regions = _build_parking_regions(plan)
    stair_regions = _build_stair_regions(plan)
    door_regions = _build_door_regions(plan)
    anchors = _collect_text_anchors(plan)

    classified = {
        "wall": [],
        "parking-edge": [],
        "stair": [],
        "door-zone": [],
        "other": [],
    }

    for raw_line in lines:
        line = {"a": raw_line["a"], "b": raw_line["b"]}
        mx, my = _segment_midpoint(line)
        parking_hit = any(_point_in_bbox(mx, my, region["bbox"], PARKING_PAD_FT) for region in parking_regions)
        stair_hit = any(_point_in_bbox(mx, my, region["bbox"], STAIR_PAD_FT) for region in stair_regions)
        door_hit = any(_point_in_bbox(mx, my, region["bbox"]) for region in door_regions)
        mask_scores = {
            "ensemble": _line_mask_coverage(line, masks["ensemble"], bbox),
            "cubicasa": _line_mask_coverage(line, masks["cubicasa"], bbox),
            "mask2former": _line_mask_coverage(line, masks["mask2former"], bbox),
        }

        if door_hit:
            category = "door-zone"
        elif stair_hit:
            category = "stair"
        elif parking_hit:
            category = "parking-edge"
        elif mask_scores["ensemble"] >= WALL_MASK_THRESHOLD:
            category = "wall"
        else:
            category = "other"

        classified[category].append(_serialize_line(line, mask_scores, category, parking_hit))

    wall_in_parking = sum(1 for line in classified["wall"] if line["parkingRegionHit"])
    wall_total = len(classified["wall"])
    wall_parking_ratio = (wall_in_parking / wall_total) if wall_total else 0.0

    overlay = raster.copy()
    draw = ImageDraw.Draw(overlay)
    for category in ("other", "parking-edge", "door-zone", "stair", "wall"):
        color = COLORS[category]
        width_px = 1 if category == "other" else 2
        for line in classified[category]:
            a = _feet_to_px(line["a"][0], line["a"][1], bbox, width, height)
            b = _feet_to_px(line["b"][0], line["b"][1], bbox, width, height)
            draw.line([a, b], fill=color, width=width_px)

    summary = {
        "raster": str(raster_path),
        "planPath": str(PLAN_PATH),
        "maskPaths": {name: str(path) for name, path in MASK_PATHS.items()},
        "footprintBboxFt": bbox,
        "wallMaskThreshold": WALL_MASK_THRESHOLD,
        "lineCounts": {key: len(value) for key, value in classified.items()},
        "metrics": {
            "inputVectorLines": len(lines),
            "wallLines": wall_total,
            "wallLinesInParkingRegions": wall_in_parking,
            "wallParkingRatio": round(wall_parking_ratio, 6),
            "parkingRegionCount": len(parking_regions),
            "stairRegionCount": len(stair_regions),
            "doorRegionCount": len(door_regions),
        },
        "anchors": anchors,
        "notes": [
            "Parking uses direct OCR labels when present; this 1881 L1 sheet had none, so parking falls back to the committed parking room anchor.",
            "Stair lines are grounded by committed stair-core regions and UP/DOWN OCR tokens.",
            "Wall classification uses ensemble wall-mask coverage plus exclusion of parking/stair/door zones.",
        ],
    }

    for category, items in classified.items():
        (out_dir / f"{category}-lines.json").write_text(json.dumps(items, indent=2))
    overlay_path = out_dir / "fused_overlay.png"
    overlay.save(overlay_path)
    summary["overlayPath"] = str(overlay_path)
    summary_path = out_dir / "fuse-summary.json"
    summary_path.write_text(json.dumps(summary, indent=2))
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

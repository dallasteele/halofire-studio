#!/usr/bin/env python3
"""Detect door swings on the real 1881 floorplan raster.

Recovered scope for this branch:
- This branch does not contain the earlier floorplan-seg step-1 tool files.
- We therefore recover the smallest truthful structure input already committed on
  this branch: the 1881 wall runs inside `plan-levels.cooperative-1881.json`.
- Door candidates come from the real raster only: OpenCV Hough circles on the
  provided PNG, then filtered down by quarter-arc evidence, a radial leaf line,
  and adjacency to a committed wall run / wall-run endpoint.

This is intentionally conservative and honest. It produces best-effort doors for
internal-alpha floorplan comprehension and marks every result as
`needsVerification=True`.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image, ImageDraw


REPO_ROOT = Path(__file__).resolve().parents[4]
PLAN_PATH = REPO_ROOT / "apps/autosprink/src/data/plan-levels.cooperative-1881.json"
DEFAULT_RASTER = Path("/opt/hal9000/state/sam-1881-p8-008.png")
DEFAULT_OUT_DIR = Path(__file__).resolve().parent / "out"

MIN_WIDTH_FT = 1.8
MAX_WIDTH_FT = 4.5
HOST_WALL_MAX_FT = 4.0
HOST_ENDPOINT_MAX_FT = 5.0
ARC_SCORE_MIN = 0.22
LEAF_SCORE_MIN = 0.28
TOTAL_RING_MAX = 0.50
OPPOSITE_ARC_MAX = 0.30
DEDUP_CENTER_FT = 3.0
DEDUP_RADIUS_FT = 1.0


def _load_plan() -> dict[str, Any]:
    data = json.loads(PLAN_PATH.read_text())
    return data["levels"][0]["plan"]


def _feet_to_px(x_ft: float, y_ft: float, bbox: dict[str, float], width: int, height: int) -> tuple[int, int]:
    px = round((x_ft - bbox["minX"]) / (bbox["maxX"] - bbox["minX"]) * (width - 1))
    py = round((y_ft - bbox["minY"]) / (bbox["maxY"] - bbox["minY"]) * (height - 1))
    return (max(0, min(width - 1, px)), max(0, min(height - 1, py)))


def _px_to_ft(px: float, py: float, bbox: dict[str, float], width: int, height: int) -> tuple[float, float]:
    x_ft = bbox["minX"] + (px / (width - 1)) * (bbox["maxX"] - bbox["minX"])
    y_ft = bbox["minY"] + (py / (height - 1)) * (bbox["maxY"] - bbox["minY"])
    return (x_ft, y_ft)


def _px_radius_to_ft(radius_px: float, bbox: dict[str, float], width: int) -> float:
    return radius_px * ((bbox["maxX"] - bbox["minX"]) / (width - 1))


def _dist(a: tuple[float, float], b: tuple[float, float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def _point_seg_distance_ft(px: float, py: float, wall: dict[str, Any]) -> tuple[float, float]:
    (x1, y1), (x2, y2) = wall["a"], wall["b"]
    vx = x2 - x1
    vy = y2 - y1
    wx = px - x1
    wy = py - y1
    c1 = vx * wx + vy * wy
    if c1 <= 0:
        return (math.hypot(px - x1, py - y1), 0.0)
    c2 = vx * vx + vy * vy
    if c2 <= c1:
        return (math.hypot(px - x2, py - y2), 1.0)
    t = c1 / c2
    proj_x = x1 + t * vx
    proj_y = y1 + t * vy
    return (math.hypot(px - proj_x, py - proj_y), t)


def _best_host_wall(x_ft: float, y_ft: float, walls: list[dict[str, Any]]) -> dict[str, Any] | None:
    best = None
    best_d = float("inf")
    best_t = 0.0
    for idx, wall in enumerate(walls):
        d, t = _point_seg_distance_ft(x_ft, y_ft, wall)
        if d < best_d:
            best = wall
            best_d = d
            best_t = t
            best_idx = idx
    if best is None:
        return None
    end_a = tuple(best["a"])
    end_b = tuple(best["b"])
    return {
        "index": best_idx,
        "distanceFt": best_d,
        "projectionT": best_t,
        "endpointDistanceFt": min(_dist((x_ft, y_ft), end_a), _dist((x_ft, y_ft), end_b)),
        "wall": best,
    }


def _find_wall_openings(walls: list[dict[str, Any]]) -> list[dict[str, Any]]:
    openings: list[dict[str, Any]] = []
    horizontal = []
    vertical = []
    for idx, wall in enumerate(walls):
        (x1, y1), (x2, y2) = wall["a"], wall["b"]
        if abs(y2 - y1) <= abs(x2 - x1):
            if x2 < x1:
                x1, y1, x2, y2 = x2, y2, x1, y1
            horizontal.append((idx, x1, y1, x2, y2, abs(x2 - x1)))
        else:
            if y2 < y1:
                x1, y1, x2, y2 = x2, y2, x1, y1
            vertical.append((idx, x1, y1, x2, y2, abs(y2 - y1)))

    for idx, x1, y1, x2, y2, length in horizontal:
        for jdx, xx1, yy1, xx2, yy2, other_len in horizontal:
            if idx >= jdx or abs(y1 - yy1) > 0.8:
                continue
            gap = xx1 - x2
            if 1.5 <= gap <= 5.0 and length >= 2.0 and other_len >= 2.0:
                openings.append(
                    {
                        "axis": "H",
                        "widthFt": gap,
                        "centerFt": ((x2 + xx1) / 2.0, y1),
                        "walls": [idx, jdx],
                    }
                )

    for idx, x1, y1, x2, y2, length in vertical:
        for jdx, xx1, yy1, xx2, yy2, other_len in vertical:
            if idx >= jdx or abs(x1 - xx1) > 0.8:
                continue
            gap = yy1 - y2
            if 1.5 <= gap <= 5.0 and length >= 2.0 and other_len >= 2.0:
                openings.append(
                    {
                        "axis": "V",
                        "widthFt": gap,
                        "centerFt": (x1, (y2 + yy1) / 2.0),
                        "walls": [idx, jdx],
                    }
                )

    deduped: list[dict[str, Any]] = []
    for opening in openings:
        if any(
            opening["axis"] == seen["axis"]
            and _dist(opening["centerFt"], seen["centerFt"]) < 0.5
            for seen in deduped
        ):
            continue
        deduped.append(opening)
    return deduped


def _ring_score(
    x_px: int,
    y_px: int,
    radius_px: int,
    start_deg: float,
    end_deg: float,
    edge_map: np.ndarray,
) -> float:
    height, width = edge_map.shape
    hit = 0
    total = 0
    sample_count = max(10, int(abs(end_deg - start_deg) / 5))
    for angle_deg in np.linspace(start_deg, end_deg, sample_count, endpoint=True):
        theta = math.radians(angle_deg)
        for rr in (radius_px - 1, radius_px, radius_px + 1):
            xx = round(x_px + rr * math.cos(theta))
            yy = round(y_px + rr * math.sin(theta))
            if 0 <= xx < width and 0 <= yy < height:
                total += 1
                if edge_map[yy, xx] > 0:
                    hit += 1
    return hit / total if total else 0.0


def _radial_leaf_score(
    x_px: int,
    y_px: int,
    radius_px: int,
    angle_deg: float,
    inv_gray: np.ndarray,
) -> float:
    height, width = inv_gray.shape
    hit = 0
    total = 0
    theta = math.radians(angle_deg)
    for t in np.linspace(0.15, 1.0, 14):
        xx = round(x_px + radius_px * t * math.cos(theta))
        yy = round(y_px + radius_px * t * math.sin(theta))
        if 0 <= xx < width and 0 <= yy < height:
            total += 1
            if inv_gray[yy, xx] > 110:
                hit += 1
    return hit / total if total else 0.0


def _choose_arc_sector(
    x_px: int,
    y_px: int,
    radius_px: int,
    inv_gray: np.ndarray,
    edge_map: np.ndarray,
) -> dict[str, float]:
    best: dict[str, float] | None = None
    for start_deg in range(0, 360, 15):
        arc_score = _ring_score(x_px, y_px, radius_px, start_deg, start_deg + 90, edge_map)
        opposite_score = _ring_score(x_px, y_px, radius_px, start_deg + 90, start_deg + 270, edge_map)
        leaf_a = _radial_leaf_score(x_px, y_px, radius_px, start_deg, inv_gray)
        leaf_b = _radial_leaf_score(x_px, y_px, radius_px, start_deg + 90, inv_gray)
        candidate = {
            "startDeg": float(start_deg),
            "endDeg": float(start_deg + 90),
            "arcScore": arc_score,
            "oppositeScore": opposite_score,
            "leafScore": max(leaf_a, leaf_b),
            "leafAngleDeg": float(start_deg if leaf_a >= leaf_b else start_deg + 90),
        }
        if best is None or candidate["arcScore"] > best["arcScore"]:
            best = candidate
    assert best is not None
    best["totalRingScore"] = _ring_score(x_px, y_px, radius_px, 0, 360, edge_map)
    return best


def _serialize_door(candidate: dict[str, Any]) -> dict[str, Any]:
    return {
        "position": [round(candidate["xFt"], 4), round(candidate["yFt"], 4)],
        "width": round(candidate["widthFt"], 4),
        "swing": {
            "leafAngleDeg": round(candidate["leafAngleDeg"], 2),
            "arcStartDeg": round(candidate["arcStartDeg"], 2),
            "arcEndDeg": round(candidate["arcEndDeg"], 2),
            "openDir": [round(candidate["openDir"][0], 4), round(candidate["openDir"][1], 4)],
        },
        "hostWall": candidate["hostWallIndex"],
        "hostWallDistFt": round(candidate["hostWallDistFt"], 4),
        "hostWallEndpointDistFt": round(candidate["hostWallEndpointDistFt"], 4),
        "adjacentWallGap": bool(candidate["adjacentWallGap"]),
        "openingWidthFt": round(candidate["openingWidthFt"], 4) if candidate["openingWidthFt"] is not None else None,
        "arcScore": round(candidate["arcScore"], 4),
        "leafScore": round(candidate["leafScore"], 4),
        "confidence": candidate["confidence"],
        "provenance": "raster hough-circle + quarter-arc + leaf-line + wall-run adjacency — needs-verification",
        "needsVerification": True,
    }


def run_door_detection(raster_path: Path | str = DEFAULT_RASTER, out_dir: Path | str = DEFAULT_OUT_DIR) -> dict[str, Any]:
    raster_path = Path(raster_path)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    plan = _load_plan()
    bbox = plan["footprintBboxFt"]
    walls = list(plan.get("wallRuns") or [])
    openings = _find_wall_openings(walls)

    raster_bgr = cv2.imread(str(raster_path), cv2.IMREAD_COLOR)
    if raster_bgr is None:
        raise FileNotFoundError(f"unable to read raster: {raster_path}")
    gray = cv2.cvtColor(raster_bgr, cv2.COLOR_BGR2GRAY)
    inv_gray = 255 - gray
    edge_map = cv2.Canny(gray, 50, 150)
    height, width = gray.shape

    min_radius_px = max(6, round(MIN_WIDTH_FT / ((bbox["maxX"] - bbox["minX"]) / (width - 1))))
    max_radius_px = max(min_radius_px + 1, round(MAX_WIDTH_FT / ((bbox["maxX"] - bbox["minX"]) / (width - 1))))
    min_dist_px = max(18, round(1.5 / ((bbox["maxX"] - bbox["minX"]) / (width - 1))))

    raw = cv2.HoughCircles(
        inv_gray,
        cv2.HOUGH_GRADIENT,
        dp=1.2,
        minDist=min_dist_px,
        param1=80,
        param2=32,
        minRadius=min_radius_px,
        maxRadius=max_radius_px,
    )
    raw_circles = np.round(raw[0]).astype(int).tolist() if raw is not None else []

    candidates: list[dict[str, Any]] = []
    for x_px, y_px, radius_px in raw_circles:
        x_ft, y_ft = _px_to_ft(x_px, y_px, bbox, width, height)
        radius_ft = _px_radius_to_ft(radius_px, bbox, width)
        host = _best_host_wall(x_ft, y_ft, walls)
        if host is None or host["distanceFt"] > HOST_WALL_MAX_FT:
            continue

        sector = _choose_arc_sector(x_px, y_px, radius_px, inv_gray, edge_map)
        if (
            sector["arcScore"] < ARC_SCORE_MIN
            or sector["leafScore"] < LEAF_SCORE_MIN
            or sector["totalRingScore"] > TOTAL_RING_MAX
            or sector["oppositeScore"] > OPPOSITE_ARC_MAX
            or host["endpointDistanceFt"] > HOST_ENDPOINT_MAX_FT
        ):
            continue

        nearest_opening = None
        if openings:
            nearest_opening = min(openings, key=lambda item: _dist((x_ft, y_ft), item["centerFt"]))
            nearest_opening_dist = _dist((x_ft, y_ft), nearest_opening["centerFt"])
            adjacent_gap = nearest_opening_dist <= max(4.5, nearest_opening["widthFt"] + 1.0)
        else:
            nearest_opening_dist = float("inf")
            adjacent_gap = False

        leaf_theta = math.radians(sector["leafAngleDeg"])
        open_theta = math.radians((sector["startDeg"] + sector["endDeg"]) / 2.0)
        score = (
            sector["arcScore"]
            + 0.5 * sector["leafScore"]
            - 0.25 * sector["totalRingScore"]
            - 0.08 * min(host["distanceFt"], 4.0)
            - 0.05 * min(host["endpointDistanceFt"], 5.0)
            + (0.12 if adjacent_gap else 0.0)
        )
        confidence = "medium" if adjacent_gap or host["endpointDistanceFt"] <= 2.5 else "low"
        candidates.append(
            {
                "xFt": x_ft,
                "yFt": y_ft,
                "widthFt": radius_ft,
                "arcStartDeg": sector["startDeg"],
                "arcEndDeg": sector["endDeg"],
                "leafAngleDeg": sector["leafAngleDeg"],
                "openDir": (math.cos(open_theta), math.sin(open_theta)),
                "leafDir": (math.cos(leaf_theta), math.sin(leaf_theta)),
                "arcScore": sector["arcScore"],
                "leafScore": sector["leafScore"],
                "totalRingScore": sector["totalRingScore"],
                "hostWallIndex": host["index"],
                "hostWallDistFt": host["distanceFt"],
                "hostWallEndpointDistFt": host["endpointDistanceFt"],
                "adjacentWallGap": adjacent_gap,
                "openingWidthFt": nearest_opening["widthFt"] if adjacent_gap and nearest_opening else None,
                "confidence": confidence,
                "score": score,
            }
        )

    deduped: list[dict[str, Any]] = []
    for candidate in sorted(candidates, key=lambda item: item["score"], reverse=True):
        if any(
            _dist((candidate["xFt"], candidate["yFt"]), (seen["xFt"], seen["yFt"])) < DEDUP_CENTER_FT
            and abs(candidate["widthFt"] - seen["widthFt"]) < DEDUP_RADIUS_FT
            for seen in deduped
        ):
            continue
        deduped.append(candidate)

    doors = [_serialize_door(candidate) for candidate in deduped]
    overlay = Image.fromarray(cv2.cvtColor(raster_bgr, cv2.COLOR_BGR2RGB))
    draw = ImageDraw.Draw(overlay)
    for opening in openings:
        cx, cy = _feet_to_px(opening["centerFt"][0], opening["centerFt"][1], bbox, width, height)
        draw.rectangle((cx - 8, cy - 8, cx + 8, cy + 8), outline=(120, 120, 120), width=2)
    for door in deduped:
        cx, cy = _feet_to_px(door["xFt"], door["yFt"], bbox, width, height)
        r_px = max(8, round(door["widthFt"] / ((bbox["maxX"] - bbox["minX"]) / (width - 1))))
        box = (cx - r_px, cy - r_px, cx + r_px, cy + r_px)
        color = (74, 190, 86) if door["confidence"] == "medium" else (245, 184, 65)
        draw.arc(box, start=door["arcStartDeg"], end=door["arcEndDeg"], fill=color, width=4)
        leaf_x = cx + round(r_px * door["leafDir"][0])
        leaf_y = cy + round(r_px * door["leafDir"][1])
        draw.line((cx, cy, leaf_x, leaf_y), fill=(58, 139, 255), width=3)
        draw.ellipse((cx - 4, cy - 4, cx + 4, cy + 4), fill=(255, 0, 0))

    overlay_path = out_dir / "doors_overlay.png"
    json_path = out_dir / "doors.json"
    overlay.save(overlay_path)
    json_path.write_text(json.dumps(doors, indent=2))

    summary = {
        "rasterPath": str(raster_path),
        "overlayPath": str(overlay_path),
        "doorsPath": str(json_path),
        "doors": doors,
        "metrics": {
            "rawCircles": len(raw_circles),
            "candidateDoors": len(candidates),
            "doorCount": len(doors),
            "wallRuns": len(walls),
            "openings": len(openings),
        },
        "note": (
            "Best-effort raster door detector for the real 1881 page: hough-circle candidates are kept only when "
            "they show quarter-arc edge coverage, a leaf-like radial line, and adjacency to the committed wall runs. "
            "This is internal-alpha plan comprehension only; not a hardware or egress schedule."
        ),
    }
    (out_dir / "doors-summary.json").write_text(json.dumps(summary, indent=2))
    return summary


if __name__ == "__main__":
    print(json.dumps(run_door_detection(), indent=2))

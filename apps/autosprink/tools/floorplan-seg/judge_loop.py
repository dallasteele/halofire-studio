#!/usr/bin/env python3
"""Vision judge loop for the recovered floorplan segmentation slice."""

from __future__ import annotations

import argparse
import base64
import importlib.util
import json
import math
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw


REPO_ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).resolve().parent
PLAN_PATH = REPO_ROOT / "apps/autosprink/src/data/plan-levels.cooperative-1881.json"
DEFAULT_RASTER = Path("/opt/hal9000/state/sam-1881-p8-008.png")
DEFAULT_OUT_DIR = HERE / "out"
OLLAMA_URL = "http://localhost:11434/api/chat"
OLLAMA_MODEL = "qwen2.5vl:7b"
MAX_ITERATIONS = 4
REQUEST_TIMEOUT_S = 900
MODEL_MAX_LONG_EDGE = 1600

WALL_COLOR = (68, 168, 76)
RESTORED_WALL_COLOR = (20, 110, 210)
DOOR_ARC_COLOR = (245, 184, 65)
DOOR_LEAF_COLOR = (58, 139, 255)
DOOR_CENTER_COLOR = (220, 32, 32)
CRITIQUE_BOX_COLOR = (255, 0, 255)


def _load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"unable to load module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


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


def _line_length_ft(line: dict[str, Any]) -> float:
    (x1, y1), (x2, y2) = line["a"], line["b"]
    return math.hypot(x2 - x1, y2 - y1)


def _line_key(line: dict[str, Any]) -> tuple[float, float, float, float]:
    ax, ay = line["a"]
    bx, by = line["b"]
    pts = sorted(((round(float(ax), 3), round(float(ay), 3)), (round(float(bx), 3), round(float(by), 3))))
    return (pts[0][0], pts[0][1], pts[1][0], pts[1][1])


def _line_bbox(line: dict[str, Any]) -> tuple[float, float, float, float]:
    ax, ay = line["a"]
    bx, by = line["b"]
    return (min(ax, bx), min(ay, by), max(ax, bx), max(ay, by))


def _bbox_intersects(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> bool:
    return not (a[2] < b[0] or b[2] < a[0] or a[3] < b[1] or b[3] < a[1])


def _normalize_bbox_px(raw: Any, width: int, height: int) -> list[int] | None:
    if isinstance(raw, dict):
        raw = raw.get("bbox_px") or raw.get("bboxPx") or raw.get("bbox")
    if not isinstance(raw, (list, tuple)) or len(raw) != 4:
        return None
    try:
        x1, y1, x2, y2 = [int(round(float(v))) for v in raw]
    except (TypeError, ValueError):
        return None
    left = max(0, min(width - 1, min(x1, x2)))
    top = max(0, min(height - 1, min(y1, y2)))
    right = max(0, min(width - 1, max(x1, x2)))
    bottom = max(0, min(height - 1, max(y1, y2)))
    if right <= left or bottom <= top:
        return None
    return [left, top, right, bottom]


def _normalize_region_items(raw_items: Any, width: int, height: int) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    if not isinstance(raw_items, list):
        return out
    for item in raw_items:
        if isinstance(item, dict):
            bbox_px = _normalize_bbox_px(item, width, height)
            if bbox_px is None:
                continue
            out.append(
                {
                    "bbox_px": bbox_px,
                    "reason": str(item.get("reason") or item.get("note") or "").strip(),
                }
            )
    return out


def _resize_for_model(image_path: Path) -> bytes:
    image = Image.open(image_path).convert("RGB")
    w, h = image.size
    scale = min(MODEL_MAX_LONG_EDGE / float(max(w, h)), 1.0)
    if scale < 1.0:
        size = (max(1, int(round(w * scale))), max(1, int(round(h * scale))))
        image = image.resize(size, Image.Resampling.BILINEAR)
    from io import BytesIO

    buf = BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


def _extract_json_block(text: str) -> dict[str, Any]:
    decoder = json.JSONDecoder()
    for match in re.finditer(r"\{", text):
        try:
            obj, _ = decoder.raw_decode(text[match.start() :])
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict):
            return obj
    raise ValueError("judge response did not contain a JSON object")


def _prompt_for(width: int, height: int) -> str:
    return (
        "You are a strict floorplan segmentation judge.\n"
        "Inspect the overlaid PNG only. Green/blue lines are current walls. Orange/blue arcs are current doors.\n"
        "Return JSON only. No markdown. No prose outside JSON.\n"
        f"Image size is {width}x{height} pixels.\n"
        "You must critique only visible segmentation mistakes and only with pixel bounding boxes.\n"
        "Schema:\n"
        "{"
        '"missed_walls":[{"bbox_px":[x1,y1,x2,y2],"reason":"short"}],'
        '"parking_as_wall":[{"bbox_px":[x1,y1,x2,y2],"reason":"short"}],'
        '"missed_doors":[{"bbox_px":[x1,y1,x2,y2],"reason":"short"}],'
        '"ok":true'
        "}\n"
        "Rules:\n"
        "- `missed_walls`: regions where a visible wall line is absent.\n"
        "- `parking_as_wall`: regions where current wall lines are actually parking stripes, stall markings, or similar non-wall marks.\n"
        "- `missed_doors`: regions where a visible door swing or leaf is absent.\n"
        "- `ok` is true only when all three arrays are empty.\n"
        "- Keep each bbox tight to one local issue.\n"
        "- If unsure, leave the array empty.\n"
    )


def _call_judge(overlay_path: Path, width: int, height: int) -> dict[str, Any]:
    payload = {
        "model": OLLAMA_MODEL,
        "stream": False,
        "format": "json",
        "messages": [
            {
                "role": "user",
                "content": _prompt_for(width, height),
                "images": [base64.b64encode(_resize_for_model(overlay_path)).decode("ascii")],
            }
        ],
    }
    req = urllib.request.Request(
        OLLAMA_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_S) as resp:
            response = json.loads(resp.read().decode("utf-8"))
    except urllib.error.URLError as exc:
        raise RuntimeError(f"ollama judge request failed: {exc}") from exc

    content = (
        response.get("message", {}).get("content")
        or response.get("response")
        or ""
    )
    parsed = _extract_json_block(content)
    critique = {
        "missed_walls": _normalize_region_items(parsed.get("missed_walls"), width, height),
        "parking_as_wall": _normalize_region_items(parsed.get("parking_as_wall"), width, height),
        "missed_doors": _normalize_region_items(parsed.get("missed_doors"), width, height),
        "ok": bool(parsed.get("ok")),
        "raw": content,
        "model": OLLAMA_MODEL,
    }
    required = {"missed_walls", "parking_as_wall", "missed_doors", "ok"}
    if not required.issubset(parsed.keys()):
        raise ValueError(f"judge response missing keys: expected {sorted(required)}, got {sorted(parsed.keys())}")
    if critique["missed_walls"] or critique["parking_as_wall"] or critique["missed_doors"]:
        critique["ok"] = False
    return critique


def _overlay_path_for(iteration: int, out_dir: Path) -> Path:
    return out_dir / f"judge_overlay_iter_{iteration:02d}.png"


def _door_center_px(door: dict[str, Any], bbox: dict[str, float], width: int, height: int) -> tuple[int, int]:
    return _feet_to_px(door["position"][0], door["position"][1], bbox, width, height)


def _draw_overlay(
    raster_path: Path,
    bbox: dict[str, float],
    wall_lines: list[dict[str, Any]],
    doors: list[dict[str, Any]],
    critique: dict[str, Any] | None,
    out_path: Path,
) -> tuple[int, int]:
    image = Image.open(raster_path).convert("RGB")
    width, height = image.size
    draw = ImageDraw.Draw(image)

    for line in wall_lines:
        color = RESTORED_WALL_COLOR if line.get("category") == "judge-restored" else WALL_COLOR
        a = _feet_to_px(line["a"][0], line["a"][1], bbox, width, height)
        b = _feet_to_px(line["b"][0], line["b"][1], bbox, width, height)
        draw.line([a, b], fill=color, width=2)

    px_per_ft = (width - 1) / (bbox["maxX"] - bbox["minX"])
    for door in doors:
        cx, cy = _door_center_px(door, bbox, width, height)
        radius_px = max(8, round(float(door["width"]) * px_per_ft))
        box = (cx - radius_px, cy - radius_px, cx + radius_px, cy + radius_px)
        swing = door.get("swing") or {}
        arc_start = float(swing.get("arcStartDeg", 0.0))
        arc_end = float(swing.get("arcEndDeg", 90.0))
        leaf_angle = math.radians(float(swing.get("leafAngleDeg", arc_start)))
        draw.arc(box, start=arc_start, end=arc_end, fill=DOOR_ARC_COLOR, width=4)
        leaf_x = cx + round(radius_px * math.cos(leaf_angle))
        leaf_y = cy + round(radius_px * math.sin(leaf_angle))
        draw.line((cx, cy, leaf_x, leaf_y), fill=DOOR_LEAF_COLOR, width=3)
        draw.ellipse((cx - 4, cy - 4, cx + 4, cy + 4), fill=DOOR_CENTER_COLOR)

    if critique is not None:
        for bucket in ("missed_walls", "parking_as_wall", "missed_doors"):
            for item in critique.get(bucket, []):
                x1, y1, x2, y2 = item["bbox_px"]
                draw.rectangle((x1, y1, x2, y2), outline=CRITIQUE_BOX_COLOR, width=3)

    image.save(out_path)
    return (width, height)


def _load_json(path: Path) -> Any:
    return json.loads(path.read_text())


def _ensure_prereqs(raster_path: Path, out_dir: Path) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    segment = _load_module(HERE / "segment_ensemble.py", "floorplan_seg_segment_ensemble")
    fuse = _load_module(HERE / "fuse.py", "floorplan_seg_fuse")
    doors = _load_module(HERE / "door_detect.py", "floorplan_seg_door_detect")

    mask_dir = Path("/opt/hal9000/state/seg-1881")
    expected_mask = mask_dir / "ensemble_walls.png"
    if not expected_mask.exists():
        subprocess.run(
            [sys.executable, str(HERE / "segment_ensemble.py"), "--raster", str(raster_path), "--out", str(mask_dir)],
            check=True,
        )

    fuse_summary = fuse.run_fuse(raster_path, out_dir)
    door_summary = doors.run_door_detection(raster_path, out_dir)
    plan = _load_plan()
    return plan, fuse_summary, door_summary


def _line_intersects_px_region(
    line: dict[str, Any],
    bbox_px: list[int],
    plan_bbox: dict[str, float],
    width: int,
    height: int,
) -> bool:
    left_ft, top_ft = _px_to_ft(bbox_px[0], bbox_px[1], plan_bbox, width, height)
    right_ft, bottom_ft = _px_to_ft(bbox_px[2], bbox_px[3], plan_bbox, width, height)
    region_ft = (
        min(left_ft, right_ft),
        min(top_ft, bottom_ft),
        max(left_ft, right_ft),
        max(top_ft, bottom_ft),
    )
    return _bbox_intersects(_line_bbox(line), region_ft)


def _door_in_px_region(
    door: dict[str, Any],
    bbox_px: list[int],
    plan_bbox: dict[str, float],
    width: int,
    height: int,
) -> bool:
    cx, cy = _door_center_px(door, plan_bbox, width, height)
    return bbox_px[0] <= cx <= bbox_px[2] and bbox_px[1] <= cy <= bbox_px[3]


def _restore_line(raw_line: dict[str, Any]) -> dict[str, Any]:
    return {
        "a": [float(raw_line["a"][0]), float(raw_line["a"][1])],
        "b": [float(raw_line["b"][0]), float(raw_line["b"][1])],
        "category": "judge-restored",
        "maskScores": {"judge": 1.0},
        "parkingRegionHit": False,
        "lengthFt": round(_line_length_ft(raw_line), 4),
        "source": raw_line.get("source", "judge-vector-restore"),
    }


def _door_key(door: dict[str, Any]) -> tuple[int, int, int]:
    x, y = door["position"]
    width = door["width"]
    return (round(float(x) * 10), round(float(y) * 10), round(float(width) * 10))


def run_judge_loop(
    raster_path: Path | str = DEFAULT_RASTER,
    out_dir: Path | str = DEFAULT_OUT_DIR,
    max_iterations: int = MAX_ITERATIONS,
) -> dict[str, Any]:
    raster_path = Path(raster_path)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    plan, fuse_summary, door_summary = _ensure_prereqs(raster_path, out_dir)
    plan_bbox = plan["footprintBboxFt"]

    current_walls = _load_json(out_dir / "wall-lines.json")
    current_doors = list(door_summary["doors"])

    vector_pool: dict[tuple[float, float, float, float], dict[str, Any]] = {}
    for category in ("wall", "other", "parking-edge", "stair", "door-zone"):
        for line in _load_json(out_dir / f"{category}-lines.json"):
            vector_pool[_line_key(line)] = line
    for raw_line in plan.get("walls", []):
        vector_pool.setdefault(_line_key(raw_line), _restore_line(raw_line))

    wall_keys = {_line_key(line) for line in current_walls}
    door_keys = {_door_key(door) for door in current_doors}

    log: dict[str, Any] = {
        "rasterPath": str(raster_path),
        "outDir": str(out_dir),
        "model": OLLAMA_MODEL,
        "maxIterations": max_iterations,
        "fuseSummary": fuse_summary["metrics"],
        "doorSummary": door_summary["metrics"],
        "iterations": [],
    }

    critique: dict[str, Any] | None = None
    width = height = 0
    for iteration in range(1, max_iterations + 1):
        before_wall_count = len(current_walls)
        before_door_count = len(current_doors)
        overlay_path = _overlay_path_for(iteration, out_dir)
        width, height = _draw_overlay(raster_path, plan_bbox, current_walls, current_doors, critique, overlay_path)
        critique = _call_judge(overlay_path, width, height)

        removed_walls = 0
        restored_walls = 0
        added_doors = 0

        if critique["parking_as_wall"]:
            drop_regions = [item["bbox_px"] for item in critique["parking_as_wall"]]
            kept: list[dict[str, Any]] = []
            for line in current_walls:
                if any(_line_intersects_px_region(line, region, plan_bbox, width, height) for region in drop_regions):
                    removed_walls += 1
                    wall_keys.discard(_line_key(line))
                    continue
                kept.append(line)
            current_walls = kept

        if critique["missed_walls"]:
            for item in critique["missed_walls"]:
                region = item["bbox_px"]
                for key, candidate in vector_pool.items():
                    if key in wall_keys:
                        continue
                    if not _line_intersects_px_region(candidate, region, plan_bbox, width, height):
                        continue
                    restored = candidate if candidate.get("category") else _restore_line(candidate)
                    if restored.get("category") != "wall":
                        restored = _restore_line(restored)
                    current_walls.append(restored)
                    wall_keys.add(key)
                    restored_walls += 1

        if critique["missed_doors"]:
            for item in critique["missed_doors"]:
                region = item["bbox_px"]
                focus_summary = _load_module(HERE / "door_detect.py", "floorplan_seg_door_detect_focus").run_door_detection(
                    raster_path,
                    out_dir / f"door_focus_iter_{iteration:02d}",
                    tuple(region),
                )
                for door in focus_summary["doors"]:
                    key = _door_key(door)
                    if key in door_keys:
                        continue
                    if not _door_in_px_region(door, region, plan_bbox, width, height):
                        continue
                    current_doors.append(door)
                    door_keys.add(key)
                    added_doors += 1

        iteration_log = {
            "iteration": iteration,
            "overlayPath": str(overlay_path),
            "critique": {
                "missed_walls": critique["missed_walls"],
                "parking_as_wall": critique["parking_as_wall"],
                "missed_doors": critique["missed_doors"],
                "ok": critique["ok"],
            },
            "countsBefore": {
                "wallLines": before_wall_count,
                "doors": before_door_count,
            },
            "countsAfter": {
                "wallLines": len(current_walls),
                "doors": len(current_doors),
            },
            "changesApplied": {
                "removedWalls": removed_walls,
                "restoredWalls": restored_walls,
                "addedDoors": added_doors,
            },
        }
        log["iterations"].append(iteration_log)
        (out_dir / "judge_log.json").write_text(json.dumps(log, indent=2))

        converged_path = out_dir / "converged_overlay.png"
        _draw_overlay(raster_path, plan_bbox, current_walls, current_doors, critique, converged_path)

        if critique["ok"]:
            break
        if removed_walls == 0 and restored_walls == 0 and added_doors == 0:
            break

    summary = {
        "convergedOverlayPath": str(out_dir / "converged_overlay.png"),
        "judgeLogPath": str(out_dir / "judge_log.json"),
        "iterations": len(log["iterations"]),
        "finalWallLines": len(current_walls),
        "finalDoors": len(current_doors),
        "finalOk": bool(critique and critique["ok"]),
    }
    log["summary"] = summary
    (out_dir / "judge_log.json").write_text(json.dumps(log, indent=2))
    return log


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raster", default=str(DEFAULT_RASTER))
    parser.add_argument("--out-dir", default=str(DEFAULT_OUT_DIR))
    parser.add_argument("--max-iterations", type=int, default=MAX_ITERATIONS)
    args = parser.parse_args()
    print(json.dumps(run_judge_loop(args.raster, args.out_dir, args.max_iterations), indent=2))


if __name__ == "__main__":
    main()

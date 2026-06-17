from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from tower_split import split_towers


MIN_LINE_LENGTH = 80
MAX_LINE_GAP = 6
VERTICAL_DX_TOL = 4
MIN_STALL_DEPTH_PX = 90
MAX_STALL_DEPTH_PX = 260
TOP_BAND_FRAC = 0.25
BOTTOM_BAND_FRAC = 0.25
CLUSTER_TOL_PX = 10
MIN_PERIOD_PX = 70
MAX_PERIOD_PX = 130
MIN_ROW_STALLS = 5
PERIOD_TOL_FRAC = 0.35


@dataclass(frozen=True)
class Stall:
    tower_index: int
    row: str
    x: int
    y: int
    w: int
    h: int

    def to_dict(self) -> dict[str, int | str]:
        return {
            "tower_index": self.tower_index,
            "row": self.row,
            "x": self.x,
            "y": self.y,
            "w": self.w,
            "h": self.h,
        }


@dataclass(frozen=True)
class VerticalSegment:
    x: int
    y0: int
    y1: int

    @property
    def depth(self) -> int:
        return self.y1 - self.y0


def _architectural_mask(image: np.ndarray) -> np.ndarray:
    spread = image.max(axis=2) - image.min(axis=2)
    brightness = image.max(axis=2)
    keep = ((brightness < 245) & ((spread < 35) | (brightness < 120))).astype(np.uint8)
    return keep * 255


def _extract_verticals(image: np.ndarray) -> list[VerticalSegment]:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    arch_mask = _architectural_mask(image)
    filtered = cv2.bitwise_and(255 - gray, 255 - gray, mask=arch_mask)
    lines = cv2.HoughLinesP(
        filtered,
        1,
        np.pi / 180.0,
        threshold=30,
        minLineLength=MIN_LINE_LENGTH,
        maxLineGap=MAX_LINE_GAP,
    )
    if lines is None:
        return []

    segments: list[VerticalSegment] = []
    for raw in lines[:, 0, :]:
        x1, y1, x2, y2 = [int(v) for v in raw]
        if abs(x2 - x1) > VERTICAL_DX_TOL:
            continue
        y0 = min(y1, y2)
        y1 = max(y1, y2)
        depth = y1 - y0
        if depth < MIN_STALL_DEPTH_PX or depth > MAX_STALL_DEPTH_PX:
            continue
        segments.append(VerticalSegment(x=int(round((x1 + x2) / 2.0)), y0=y0, y1=y1))
    return segments


def _estimate_period(xs: list[int], width: int) -> float | None:
    if len(xs) < MIN_ROW_STALLS + 1:
        return None
    histogram = np.zeros(width, dtype=np.float32)
    for x in xs:
        if 0 <= x < width:
            histogram[x] += 1.0
    histogram -= histogram.mean()
    spectrum = np.abs(np.fft.rfft(histogram))
    if spectrum.size <= 1:
        return None

    best_period: float | None = None
    best_strength = 0.0
    for idx in range(1, spectrum.size):
        period = width / idx
        if period < MIN_PERIOD_PX or period > MAX_PERIOD_PX:
            continue
        strength = float(spectrum[idx])
        if strength > best_strength:
            best_strength = strength
            best_period = float(period)
    return best_period


def _cluster_segments(segments: list[VerticalSegment]) -> list[VerticalSegment]:
    if not segments:
        return []
    ordered = sorted(segments, key=lambda seg: seg.x)
    groups: list[list[VerticalSegment]] = [[ordered[0]]]
    for seg in ordered[1:]:
        if abs(seg.x - groups[-1][-1].x) <= CLUSTER_TOL_PX:
            groups[-1].append(seg)
        else:
            groups.append([seg])

    clustered: list[VerticalSegment] = []
    for group in groups:
        xs = [seg.x for seg in group]
        y0s = [seg.y0 for seg in group]
        y1s = [seg.y1 for seg in group]
        clustered.append(
            VerticalSegment(
                x=int(round(float(np.median(xs)))),
                y0=int(round(float(np.median(y0s)))),
                y1=int(round(float(np.median(y1s)))),
            )
        )
    return clustered


def _longest_regular_run(xs: list[int], period: float) -> list[int]:
    if len(xs) < 2:
        return []
    min_gap = period * (1.0 - PERIOD_TOL_FRAC)
    max_gap = period * (1.0 + PERIOD_TOL_FRAC)
    best = xs[:1]
    current = xs[:1]

    for prev, curr in zip(xs, xs[1:]):
        gap = curr - prev
        if min_gap <= gap <= max_gap:
            current.append(curr)
        else:
            if len(current) > len(best):
                best = current[:]
            current = [curr]

    if len(current) > len(best):
        best = current
    return best if len(best) >= MIN_ROW_STALLS + 1 else []


def _build_row_stalls(
    tower_index: int,
    row_name: str,
    segments: list[VerticalSegment],
    period: float,
) -> tuple[list[Stall], dict[str, object]]:
    clustered = _cluster_segments(segments)
    regular_xs = _longest_regular_run([seg.x for seg in clustered], period)
    if len(regular_xs) < MIN_ROW_STALLS + 1:
        return [], {"row": row_name, "period_px": period, "cluster_count": len(clustered)}

    regular_set = set(regular_xs)
    regular_segments = [seg for seg in clustered if seg.x in regular_set]
    y0 = int(round(float(np.median([seg.y0 for seg in regular_segments]))))
    y1 = int(round(float(np.median([seg.y1 for seg in regular_segments]))))

    stalls: list[Stall] = []
    for left, right in zip(regular_xs, regular_xs[1:]):
        width = right - left
        if not (period * (1.0 - PERIOD_TOL_FRAC) <= width <= period * (1.0 + PERIOD_TOL_FRAC)):
            continue
        stalls.append(
            Stall(
                tower_index=tower_index,
                row=row_name,
                x=int(left),
                y=y0,
                w=int(width),
                h=int(y1 - y0),
            )
        )

    row_meta = {
        "row": row_name,
        "period_px": round(period, 2),
        "cluster_count": len(clustered),
        "regular_xs": regular_xs,
        "y0": y0,
        "y1": y1,
        "stall_count": len(stalls),
    }
    return stalls, row_meta


def _detect_tower_stalls(tower_index: int, tower_image: np.ndarray) -> tuple[list[Stall], dict[str, object]]:
    segments = _extract_verticals(tower_image)
    height, width = tower_image.shape[:2]
    top_limit = int(height * TOP_BAND_FRAC)
    bottom_limit = int(height * (1.0 - BOTTOM_BAND_FRAC))

    top_segments = [seg for seg in segments if seg.y0 < top_limit]
    bottom_segments = [seg for seg in segments if seg.y1 > bottom_limit]
    period = _estimate_period([seg.x for seg in top_segments + bottom_segments], width)
    if period is None:
        return [], {
            "tower_index": tower_index,
            "period_px": None,
            "rows": [],
            "stall_count": 0,
        }

    rows: list[dict[str, object]] = []
    stalls: list[Stall] = []
    for row_name, row_segments in (("top", top_segments), ("bottom", bottom_segments)):
        row_stalls, row_meta = _build_row_stalls(tower_index, row_name, row_segments, period)
        rows.append(row_meta)
        stalls.extend(row_stalls)

    return stalls, {
        "tower_index": tower_index,
        "period_px": round(period, 2),
        "rows": rows,
        "stall_count": len(stalls),
    }


def detect_stalls(image_path: Path, output_dir: Path) -> dict[str, object]:
    tower_payload = split_towers(image_path, output_dir)
    source = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
    if source is None:
        raise FileNotFoundError(f"unable to read source image: {image_path}")

    all_stalls: list[Stall] = []
    towers_meta: list[dict[str, object]] = []
    overlay = source.copy()

    for tower in tower_payload["towers"]:
        tower_index = int(tower["index"])
        bbox = tower["bbox"]
        tower_image = cv2.imread(str(tower["image_path"]), cv2.IMREAD_COLOR)
        if tower_image is None:
            raise FileNotFoundError(f"unable to read tower crop: {tower['image_path']}")
        stalls, tower_meta = _detect_tower_stalls(tower_index, tower_image)
        towers_meta.append(tower_meta)
        all_stalls.extend(stalls)

        for stall in stalls:
            x0 = int(bbox["x"]) + stall.x
            y0 = int(bbox["y"]) + stall.y
            x1 = x0 + stall.w
            y1 = y0 + stall.h
            color = (0, 180, 0) if stall.row == "top" else (0, 140, 255)
            cv2.rectangle(overlay, (x0, y0), (x1, y1), color, 3)

    overlay_path = output_dir / "stalls_overlay.png"
    if not cv2.imwrite(str(overlay_path), overlay):
        raise RuntimeError(f"unable to write overlay: {overlay_path}")

    payload = {
        "source_image": str(image_path),
        "stalls_overlay_path": str(overlay_path),
        "tower_split_path": str(output_dir / "tower_split.json"),
        "towers": towers_meta,
        "stalls": [stall.to_dict() for stall in all_stalls],
    }
    output_path = output_dir / "stall_detect.json"
    output_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return payload


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("image_path", type=Path)
    parser.add_argument("output_dir", type=Path)
    args = parser.parse_args()
    detect_stalls(args.image_path, args.output_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

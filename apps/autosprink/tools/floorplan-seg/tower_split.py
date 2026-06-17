from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np


RIGHT_CROP_FRAC = 0.84
THRESHOLD = 220
ROW_SMOOTH = 81
ROW_SPLIT_LO_FRAC = 0.28
ROW_SPLIT_HI_FRAC = 0.72
COMPONENT_OPEN_KERNEL = (5, 5)
COMPONENT_CLOSE_KERNEL = (25, 25)
MIN_BBOX_FRAC = 0.08
MAX_BBOX_FRAC = 0.45
MAX_COMPONENT_WIDTH_FRAC = 0.9
MAX_COMPONENT_HEIGHT_FRAC = 0.9
PADDING = 18


@dataclass(frozen=True)
class BBox:
    x: int
    y: int
    w: int
    h: int

    def to_dict(self) -> dict[str, int]:
        return {"x": self.x, "y": self.y, "w": self.w, "h": self.h}


def _load_gray(image_path: Path) -> np.ndarray:
    image = cv2.imread(str(image_path), cv2.IMREAD_GRAYSCALE)
    if image is None:
        raise FileNotFoundError(f"unable to read image: {image_path}")
    return image


def _ink_mask(gray: np.ndarray) -> np.ndarray:
    _, mask = cv2.threshold(gray, THRESHOLD, 255, cv2.THRESH_BINARY_INV)
    mask[:40, :] = 0
    mask[-40:, :] = 0
    mask[:, :40] = 0
    mask[:, -40:] = 0
    return mask


def _find_split_y(mask: np.ndarray) -> int:
    projection = (mask > 0).sum(axis=1).astype(np.float32)
    kernel = np.ones(ROW_SMOOTH, dtype=np.float32) / ROW_SMOOTH
    smooth = np.convolve(projection, kernel, mode="same")
    lo = int(mask.shape[0] * ROW_SPLIT_LO_FRAC)
    hi = int(mask.shape[0] * ROW_SPLIT_HI_FRAC)
    if hi <= lo:
        raise ValueError("invalid split search window")
    return int(np.argmin(smooth[lo:hi]) + lo)


def _tighten_bbox(mask: np.ndarray, bbox: BBox) -> BBox:
    x0 = max(0, bbox.x - PADDING)
    y0 = max(0, bbox.y - PADDING)
    x1 = min(mask.shape[1], bbox.x + bbox.w + PADDING)
    y1 = min(mask.shape[0], bbox.y + bbox.h + PADDING)
    roi = mask[y0:y1, x0:x1]
    ys, xs = np.where(roi > 0)
    if len(xs) == 0:
        return BBox(x0, y0, x1 - x0, y1 - y0)
    tx0 = x0 + int(xs.min())
    ty0 = y0 + int(ys.min())
    tx1 = x0 + int(xs.max()) + 1
    ty1 = y0 + int(ys.max()) + 1
    return BBox(tx0, ty0, tx1 - tx0, ty1 - ty0)


def _select_band_component(
    sheet_mask: np.ndarray,
    band_mask: np.ndarray,
    y_offset: int,
    full_shape: tuple[int, int],
) -> BBox:
    opened = cv2.morphologyEx(
        band_mask,
        cv2.MORPH_OPEN,
        cv2.getStructuringElement(cv2.MORPH_RECT, COMPONENT_OPEN_KERNEL),
    )
    count, _, stats, _ = cv2.connectedComponentsWithStats(opened, 8)
    sheet_area = full_shape[0] * full_shape[1]
    band_h, band_w = band_mask.shape
    candidates: list[tuple[int, BBox]] = []

    for idx in range(1, count):
        x, y, w, h, area = [int(v) for v in stats[idx]]
        bbox_area_frac = (w * h) / sheet_area
        width_frac = w / band_w
        height_frac = h / band_h
        if bbox_area_frac < MIN_BBOX_FRAC or bbox_area_frac > MAX_BBOX_FRAC:
            continue
        if width_frac > MAX_COMPONENT_WIDTH_FRAC:
            continue
        if height_frac > MAX_COMPONENT_HEIGHT_FRAC:
            continue
        candidates.append((area, BBox(x, y + y_offset, w, h)))

    if not candidates:
        raise RuntimeError("unable to isolate floor-plan component")

    _, best = max(candidates, key=lambda item: item[0])
    return _tighten_bbox(sheet_mask, best)


def split_towers(image_path: Path, output_dir: Path) -> dict[str, object]:
    gray = _load_gray(image_path)
    sheet_mask = _ink_mask(gray)

    x_cut = int(gray.shape[1] * RIGHT_CROP_FRAC)
    left_mask = sheet_mask[:, :x_cut]
    closed = cv2.morphologyEx(
        left_mask,
        cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_RECT, COMPONENT_CLOSE_KERNEL),
    )
    split_y = _find_split_y(closed)

    towers = [
        _select_band_component(sheet_mask, closed[:split_y, :], 0, gray.shape),
        _select_band_component(sheet_mask, closed[split_y:, :], split_y, gray.shape),
    ]
    towers.sort(key=lambda bbox: bbox.y)

    output_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "source_image": str(image_path),
        "sheet_size": {"width": int(gray.shape[1]), "height": int(gray.shape[0])},
        "split_y": int(split_y),
        "towers": [],
    }

    color = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
    if color is None:
        raise FileNotFoundError(f"unable to read image in color: {image_path}")

    for idx, bbox in enumerate(towers):
        crop = color[bbox.y : bbox.y + bbox.h, bbox.x : bbox.x + bbox.w]
        out_path = output_dir / f"tower_{idx}.png"
        if not cv2.imwrite(str(out_path), crop):
            raise RuntimeError(f"unable to write crop: {out_path}")
        payload["towers"].append(
            {
                "index": idx,
                "bbox": bbox.to_dict(),
                "image_path": str(out_path),
            }
        )

    json_path = output_dir / "tower_split.json"
    json_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return payload


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("image_path", type=Path)
    parser.add_argument("output_dir", type=Path)
    args = parser.parse_args()
    split_towers(args.image_path, args.output_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

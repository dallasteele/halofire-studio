"""Extract repeated bullseye sprinkler symbols from a rendered plan sheet.

This calibration runner intentionally uses two distinct image paths:
normalized template correlation for primary points and contour hierarchy for
independent count verification. It emits normalized display-page coordinates
so the receipt is resolution-independent. It never claims code compliance.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import cv2
import numpy as np


def parse_pair(value: str) -> tuple[int, int]:
    left, right = value.split(",", 1)
    return int(left), int(right)


def parse_box(value: str) -> tuple[int, int, int, int]:
    values = tuple(int(part) for part in value.split(","))
    if len(values) != 4:
        raise argparse.ArgumentTypeError("box must be x0,y0,x1,y1")
    return values


def canonicalize_js_numbers(value: object) -> object:
    """Match JSON.stringify's integral-number representation for shared receipts."""
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, list):
        return [canonicalize_js_numbers(item) for item in value]
    if isinstance(value, dict):
        return {key: canonicalize_js_numbers(item) for key, item in value.items()}
    return value


def canonical(value: object) -> bytes:
    normalized = canonicalize_js_numbers(value)
    return json.dumps(normalized, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def template_points(image: np.ndarray, crop: tuple[int, int, int, int], template: np.ndarray,
                    threshold: float, min_distance: int) -> list[tuple[int, int, float]]:
    x0, y0, x1, y1 = crop
    response = cv2.matchTemplate(image[y0:y1, x0:x1], template, cv2.TM_CCOEFF_NORMED)
    ys, xs = np.where(response >= threshold)
    order = np.argsort(response[ys, xs])[::-1]
    half_w, half_h = template.shape[1] // 2, template.shape[0] // 2
    kept: list[tuple[int, int, float]] = []
    for index in order:
        x = int(xs[index]) + x0 + half_w
        y = int(ys[index]) + y0 + half_h
        if all((x - prior_x) ** 2 + (y - prior_y) ** 2 > min_distance ** 2
               for prior_x, prior_y, _score in kept):
            kept.append((x, y, float(response[ys[index], xs[index]])))
    return sorted(kept, key=lambda point: (point[1], point[0]))


def independent_contour_count(image: np.ndarray, crop: tuple[int, int, int, int]) -> int:
    x0, y0, x1, y1 = crop
    binary = cv2.threshold(image[y0:y1, x0:x1], 100, 255, cv2.THRESH_BINARY_INV)[1]
    contours, hierarchy = cv2.findContours(binary, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
    if hierarchy is None:
        return 0
    accepted = 0
    for index, contour in enumerate(contours):
        x, y, width, height = cv2.boundingRect(contour)
        area = cv2.contourArea(contour)
        perimeter = cv2.arcLength(contour, True)
        circularity = 4 * np.pi * area / (perimeter * perimeter) if perimeter else 0
        child = hierarchy[0][index][2]
        depth = 0
        while child != -1 and depth < 5:
            depth += 1
            child = hierarchy[0][child][2]
        if (15 <= width <= 32 and 15 <= height <= 32 and .65 <= width / height <= 1.35
                and circularity > .55 and area > 80 and depth >= 2):
            accepted += 1
    return accepted


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("image", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--source-pdf-sha256", required=True)
    parser.add_argument("--crop", required=True, type=parse_box)
    parser.add_argument("--template-center", required=True, type=parse_pair)
    parser.add_argument("--template-size", type=int, default=33)
    parser.add_argument("--threshold", type=float, default=.60)
    parser.add_argument("--min-distance", type=int, default=24)
    parser.add_argument("--expected-count", type=int, required=True)
    parser.add_argument("--display-page-pt", default="2592,1728", type=parse_pair)
    args = parser.parse_args()

    image = cv2.imread(str(args.image), cv2.IMREAD_GRAYSCALE)
    if image is None:
        raise SystemExit("rendered plan image could not be read")
    center_x, center_y = args.template_center
    half = args.template_size // 2
    template = image[center_y - half:center_y + half + 1, center_x - half:center_x + half + 1]
    primary = template_points(image, args.crop, template, args.threshold, args.min_distance)
    threshold_counts = {
        f"{threshold:.2f}": len(template_points(image, args.crop, template, threshold, args.min_distance))
        for threshold in (.58, .59, .60)
    }
    mutated = template.copy()
    cv2.circle(mutated, (half, half), max(2, half // 3), 255, -1)
    mutated_count = len(template_points(image, args.crop, mutated, args.threshold, args.min_distance))
    independent_count = independent_contour_count(image, args.crop)
    width, height = image.shape[1], image.shape[0]
    page_width, page_height = args.display_page_pt
    draft = {
        "artifactType": "halofire.raster-bullseye-head-evidence.v1",
        "projectId": "winter-garden-meetinghouse",
        "sheetId": "FP3",
        "sourcePdfSha256": args.source_pdf_sha256.lower(),
        "renderedImageSha256": hashlib.sha256(args.image.read_bytes()).hexdigest(),
        "renderedImageSizePx": [width, height],
        "displayPageSizePt": [page_width, page_height],
        "planCropPx": list(args.crop),
        "primary": {
            "method": "normalized-template-correlation",
            "threshold": args.threshold,
            "templateCenterPx": [center_x, center_y],
            "templateSizePx": args.template_size,
            "count": len(primary),
        },
        "independent": {
            "method": "thresholded-contour-hierarchy",
            "count": independent_count,
            "maximumCountDelta": 1,
        },
        "adversarial": {
            "thresholdCounts": threshold_counts,
            "centerRemovedTemplateCount": mutated_count,
            "centerRemovedTemplateRejected": mutated_count != args.expected_count,
        },
        "legendExpectedCount": args.expected_count,
        "points": [
            {
                "id": f"wg-fp3-pendent-{index + 1:03d}",
                "normalized": [round(x / width, 9), round(y / height, 9)],
                "displayPdfPtTopLeft": [round(x * page_width / width, 4), round(y * page_height / height, 4)],
                "score": round(score, 6),
            }
            for index, (x, y, score) in enumerate(primary)
        ],
        "projectionReady": False,
        "complianceReady": False,
    }
    passed = (len(primary) == args.expected_count
              and abs(independent_count - args.expected_count) <= 1
              and all(count == args.expected_count for count in threshold_counts.values())
              and draft["adversarial"]["centerRemovedTemplateRejected"])
    draft["status"] = "passed" if passed else "blocked"
    draft["receiptSha256"] = hashlib.sha256(canonical(draft)).hexdigest()
    args.output.write_text(json.dumps(draft, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": draft["status"], "primary": len(primary),
                      "independent": independent_count, "adversarial": draft["adversarial"],
                      "output": str(args.output)}))


if __name__ == "__main__":
    main()

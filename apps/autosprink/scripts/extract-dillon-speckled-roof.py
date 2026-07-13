"""Offline extraction of Dillon slope-roof contours from protected structural PDFs.

The PDFs contain an OCG named ``Roof-Hatch``. AutoCAD/Bluebeam exploded the
speckled hatch into clipped vector strokes, so this script closes only the
small intra-pattern gaps and records a conservative reconstruction tolerance.
It never treats the solid-gray filled recess-floor paths as roof geometry.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import cv2
import fitz
import numpy as np
from shapely.geometry import Point, Polygon


ROOT = Path(__file__).resolve().parents[1]
SOURCE_PATH = ROOT / "src/data/dillon-structural-framing-roof-source.json"
PDF_ROOT = ROOT / "tmp/pdfs/dillon-roof-calibration"
KERNEL_RADIUS_PT = 2
RECONSTRUCTION_TOLERANCE_PT = 4
MIN_COMPONENT_AREA_PT2 = 3_000

SHEETS = {
    "S-020": {
        "pdf": "main-plans/Main Level Framing Plan.pdf",
        "crop": (100, 250, 2300, 1700),
        "arrows": [
            (101009, (2112.28, 1082.12), (0, 1)),
            (101612, (1054.96, 547.40), (0, 1)),
            (107533, (633.88, 1619.12), (0, -1)),
        ],
    },
    "S-021": {
        "pdf": "main-plans/Upper Level Framing.pdf",
        "crop": (100, 250, 2100, 1700),
        "arrows": [
            (19808, (1071.64, 864.08), (0, -1)),
            (19813, (1057.72, 1612.16), (0, 1)),
            (23027, (570.40, 1015.16), (-1, 0)),
        ],
    },
    "TOY-FRAMING": {
        "pdf": "toy-plans/Toy Garage Framing Plan.pdf",
        "crop": (100, 500, 2300, 1700),
        "arrows": [
            (15803, (469.24, 868.64), (0, -1)),
            (30828, (1211.20, 1070.84), (0, 1)),
            (30830, (1654.36, 1257.56), (1, 0)),
            (30832, (1915.00, 1271.96), (1, 0)),
            (30834, (1930.12, 951.20), (1, 0)),
            (30836, (1654.36, 959.96), (1, 0)),
            (32298, (892.60, 1068.68), (0, 1)),
            (32300, (2215.12, 1035.44), (0, -1)),
            (33282, (991.60, 950.96), (0, 1)),
        ],
    },
}


def is_speckle(drawing: dict) -> bool:
    color = drawing.get("color")
    return (
        drawing.get("layer") == "Roof-Hatch"
        and drawing.get("type") == "s"
        and color is not None
        and all(abs(channel - 0.591) < 0.002 for channel in color)
        and abs((drawing.get("width") or 0) - 0.72) < 0.01
    )


def round_point(point) -> list[float]:
    return [round(float(point[0]), 2), round(float(point[1]), 2)]


def contour_points(contour: np.ndarray) -> list[list[float]]:
    simplified = cv2.approxPolyDP(contour, epsilon=4.0, closed=True)
    points = [round_point(entry[0]) for entry in simplified]
    if points and points[0] == points[-1]:
        points.pop()
    return points


def extract_sheet(sheet_id: str, config: dict, pitch_controls: list[dict]) -> dict:
    document = fitz.open(PDF_ROOT / config["pdf"])
    page = document[0]
    crop = config["crop"]
    segments = []
    mask = np.zeros((round(page.rect.height), round(page.rect.width)), dtype=np.uint8)

    for drawing in page.get_drawings(extended=True):
        if not is_speckle(drawing):
            continue
        for item in drawing.get("items") or []:
            if item[0] != "l":
                continue
            start, end = item[1], item[2]
            length = math.hypot(end.x - start.x, end.y - start.y)
            center = ((start.x + end.x) / 2, (start.y + end.y) / 2)
            if length > 6 or not (crop[0] <= center[0] <= crop[2] and crop[1] <= center[1] <= crop[3]):
                continue
            segments.append((start, end, center))
            cv2.line(mask, (round(start.x), round(start.y)), (round(end.x), round(end.y)), 255, 1, cv2.LINE_8)

    kernel_size = KERNEL_RADIUS_PT * 2 + 1
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_size, kernel_size))
    reconstructed = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    component_count, labels, stats, _ = cv2.connectedComponentsWithStats(reconstructed, connectivity=8)
    candidates = []

    for component_label in range(1, component_count):
        area = int(stats[component_label, cv2.CC_STAT_AREA])
        if area < MIN_COMPONENT_AREA_PT2:
            continue
        component_mask = np.where(labels == component_label, 255, 0).astype(np.uint8)
        contours, hierarchy = cv2.findContours(component_mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
        if hierarchy is None:
            continue
        hierarchy = hierarchy[0]
        exterior_indexes = [index for index, entry in enumerate(hierarchy) if entry[3] == -1]
        if not exterior_indexes:
            continue
        exterior_index = max(exterior_indexes, key=lambda index: cv2.contourArea(contours[index]))
        exterior = contour_points(contours[exterior_index])
        holes = [
            contour_points(contours[index])
            for index, entry in enumerate(hierarchy)
            if entry[3] == exterior_index and cv2.contourArea(contours[index]) >= 4
        ]
        source_strokes = sum(
            1 for _start, _end, center in segments if labels[round(center[1]), round(center[0])] == component_label
        )
        candidates.append(
            {
                "exteriorTopLeftPt": exterior,
                "holesTopLeftPt": holes,
                "reconstructedAreaPt2": area,
                "sourceSpeckleStrokeCount": source_strokes,
                "bboxTopLeftPt": [
                    int(stats[component_label, cv2.CC_STAT_LEFT]),
                    int(stats[component_label, cv2.CC_STAT_TOP]),
                    int(stats[component_label, cv2.CC_STAT_LEFT] + stats[component_label, cv2.CC_STAT_WIDTH]),
                    int(stats[component_label, cv2.CC_STAT_TOP] + stats[component_label, cv2.CC_STAT_HEIGHT]),
                ],
            }
        )

    candidates.sort(key=lambda item: (item["bboxTopLeftPt"][0], item["bboxTopLeftPt"][1]))
    polygons = []
    for index, candidate in enumerate(candidates, start=1):
        candidate["id"] = f"{sheet_id.lower()}-speckle-{index}"
        candidate["boundaryStatus"] = "reconstructed-from-exploded-vector-speckle-strokes"
        candidate["reconstructionTolerancePt"] = RECONSTRUCTION_TOLERANCE_PT
        candidate["pitchControlIds"] = []
        candidate["absoluteDatumAssociationStatus"] = "unlinked"
        polygons.append(Polygon(candidate["exteriorTopLeftPt"], candidate["holesTopLeftPt"]))

    arrows = config["arrows"]
    if len(arrows) != len(pitch_controls):
        raise RuntimeError(f"{sheet_id} pitch control count changed")
    enriched_controls = []
    for index, (control, arrow) in enumerate(zip(pitch_controls, arrows, strict=True), start=1):
        drawing_index, tip, direction = arrow
        control_id = f"{sheet_id.lower()}-pitch-{index}"
        distances = [polygon.distance(Point(tip)) for polygon in polygons]
        nearest_index = min(range(len(distances)), key=distances.__getitem__) if distances else None
        linked_index = nearest_index if nearest_index is not None and distances[nearest_index] <= RECONSTRUCTION_TOLERANCE_PT else None
        if linked_index is not None:
            candidates[linked_index]["pitchControlIds"].append(control_id)
        enriched_controls.append(
            {
                **control,
                "id": control_id,
                "arrowSourceDrawingIndex": drawing_index,
                "arrowTipTopLeftPt": round_point(tip),
                "slopeDirectionTopLeftUnit": list(direction),
                "associationStatus": "linked-to-speckled-contour" if linked_index is not None else "unlinked",
                "roofContourId": candidates[linked_index]["id"] if linked_index is not None else None,
                "nearestContourDistancePt": round(distances[nearest_index], 2) if nearest_index is not None else None,
            }
        )

    return {
        "method": "vector Roof-Hatch OCG speckle strokes closed with a 2-point kernel; plan components below 3000 square points excluded",
        "sourceLayer": "Roof-Hatch",
        "sourceStrokeRgb": [0.591, 0.591, 0.591],
        "sourceStrokeWidthPt": 0.72,
        "sourceSpeckleStrokeCount": len(segments),
        "reconstructionTolerancePt": RECONSTRUCTION_TOLERANCE_PT,
        "legendAndTitleBlockExcluded": True,
        "contours": candidates,
        "pitchControls": enriched_controls,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    source = json.loads(SOURCE_PATH.read_text(encoding="utf-8"))
    source["artifactType"] = "halofire.dillon-structural-framing-hatch-classification-source.v3"
    total_strokes = 0
    total_contours = 0
    total_pitch_links = 0

    for sheet in source["sheets"]:
        extraction = extract_sheet(sheet["sheetId"], SHEETS[sheet["sheetId"]], sheet["pitchControls"])
        sheet["slopeRoofLegendText"] = "HATCH AREA INDICATES SLOPE ROOF"
        sheet["speckledRoofExtraction"] = {key: value for key, value in extraction.items() if key != "pitchControls"}
        sheet["pitchControls"] = extraction["pitchControls"]
        sheet["counts"]["slopeRoofSpeckleStrokes"] = extraction["sourceSpeckleStrokeCount"]
        sheet["counts"]["slopeRoofContours"] = len(extraction["contours"])
        sheet["counts"]["pitchLinkedSlopeRoofContours"] = sum(
            1 for contour in extraction["contours"] if contour["pitchControlIds"]
        )
        total_strokes += extraction["sourceSpeckleStrokeCount"]
        total_contours += len(extraction["contours"])
        total_pitch_links += sheet["counts"]["pitchLinkedSlopeRoofContours"]

    source["extractionPolicy"] = (
        "solid-gray vector fills are preserved as recess-floor-at-bathroom rejections; slope-roof candidates are derived only "
        "from the Roof-Hatch optional-content layer's 0.591-gray 0.72-point exploded vector speckle strokes, with a recorded "
        "4-point contour reconstruction tolerance and source arrowhead joins"
    )
    source["roofCandidateStatus"] = "speckled-vector-contours-reconstructed-pitch-and-datum-gated"
    source["counts"] = {
        "slopeRoofSpeckleStrokes": total_strokes,
        "slopeRoofContours": total_contours,
        "pitchLinkedSlopeRoofContours": total_pitch_links,
    }
    output = json.dumps(source, separators=(",", ":")) + "\n"
    if args.write:
        with SOURCE_PATH.open("w", encoding="utf-8", newline="\n") as destination:
            destination.write(output)
    else:
        print(output, end="")


if __name__ == "__main__":
    main()

"""Extract the identical FP1.0/FP2.0 riser primitive from the New Hope as-built PDF."""

from __future__ import annotations

import hashlib
import json
import math
import sys
from pathlib import Path

import fitz


EXPECTED_SHA256 = "ED00E9530C02217BC50EAD2FC3391938E731253949B728B31ED1336F8000F34B"
EXPECTED_PRIMITIVE_SHA256 = "DD2882F7742CFAA5FF5E557C8ACFDED8AD257A7A552743A1FE8B93D1B6D93D7D"
PAGE_DRAWINGS = ((2, 53184, "FP1.0"), (3, 3511, "FP2.0"))


def rounded_point(point: fitz.Point) -> list[float]:
    return [round(point.x, 6), round(point.y, 6)]


def normalize(drawing: dict) -> dict:
    return {
        "rect": [round(value, 6) for value in drawing["rect"]],
        "items": [
            [item[0], *(rounded_point(point) for point in item[1:])]
            for item in drawing["items"]
        ],
        "color": [round(value, 6) for value in drawing["color"]],
        "fill": [round(value, 6) for value in drawing["fill"]],
    }


def digest(normalized: dict) -> str:
    encoded = json.dumps(normalized, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest().upper()


def extract(source: Path) -> dict:
    source_sha = hashlib.sha256(source.read_bytes()).hexdigest().upper()
    if source_sha != EXPECTED_SHA256:
        raise ValueError(f"unexpected as-built PDF SHA256: {source_sha}")

    document = fitz.open(source)
    records = []
    for page_index, drawing_index, sheet in PAGE_DRAWINGS:
        page = document[page_index]
        drawing = page.get_drawings()[drawing_index]
        normalized = normalize(drawing)
        records.append(
            {
                "physicalPage": page_index + 1,
                "sheet": sheet,
                "drawingIndex": drawing_index,
                "normalizedSha256": digest(normalized),
                "itemCount": len(normalized["items"]),
                "rectPdfPt": normalized["rect"],
                "planStationPdfPt": normalized["items"][0][1],
            }
        )

    if records[0]["normalizedSha256"] != EXPECTED_PRIMITIVE_SHA256:
        raise ValueError("FP1.0 riser primitive fingerprint drifted")
    if records[0]["normalizedSha256"] != records[1]["normalizedSha256"]:
        raise ValueError("FP1.0 and FP2.0 riser primitives are not identical")
    coordinate_residual = math.dist(records[0]["planStationPdfPt"], records[1]["planStationPdfPt"])
    if coordinate_residual != 0:
        raise ValueError(f"cross-sheet station residual is not zero: {coordinate_residual}")

    return {
        "artifactType": "halofire.new-hope-asbuilt-riser-station-evidence.v1",
        "projectId": "new-hope-crisis-center-brigham-city-ut",
        "source": {
            "fileName": source.name,
            "sha256": source_sha,
            "pageBoxPdfPt": {"width": 3024, "height": 2160},
        },
        "primitive": {
            "extractor": "PyMuPDF Page.get_drawings",
            "normalizedSha256": EXPECTED_PRIMITIVE_SHA256,
            "itemCount": records[0]["itemCount"],
            "rectPdfPt": records[0]["rectPdfPt"],
            "planStationPdfPt": records[0]["planStationPdfPt"],
            "crossSheetCoordinateResidualPt": coordinate_residual,
            "sheets": records,
        },
        "claims": {
            "identicalCrossSheetRiserPrimitiveReady": True,
            "exactRiserPlanStationReady": True,
            "installedGradeReady": False,
            "fabricationReady": False,
            "fieldReleaseReady": False,
        },
    }


def main() -> int:
    if len(sys.argv) != 3:
        print(f"usage: {Path(sys.argv[0]).name} <as-built.pdf> <output.json>", file=sys.stderr)
        return 2
    artifact = extract(Path(sys.argv[1]))
    Path(sys.argv[2]).write_bytes((json.dumps(artifact, indent=2) + "\n").encode("utf-8"))
    print(json.dumps(artifact["primitive"], indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Build source-only Dillon RCP ceiling-face evidence from the architectural PDFs.

This script deliberately does not read completed sprinkler heads or pipework. It
polygonizes selected black architectural vector strokes, joins only ceiling and
soffit annotations contained by a face, and leaves mixed-surface faces unresolved.
Run with a Python environment containing PyMuPDF and Shapely.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import fitz
from shapely.geometry import LineString, Point
from shapely.ops import polygonize, unary_union


ROOT = Path(__file__).resolve().parents[1]
TMP = ROOT / "tmp" / "pdfs" / "dillon-roof-calibration"
OUTPUT = ROOT / "src" / "data" / "dillon-rcp-vector-face-registry.json"
WIDTHS_PT = {1.14, 1.44, 1.68, 2.22}
ENDPOINT_QUANTIZATION_PT = 0.5

SHEETS = {
    "FP-1": {
        "source_id": "main-rcp-pdf",
        "pdf": TMP / "main-plans" / "6 - MAIN LEVEL REFLECTED CEILING PLAN.pdf",
        "sha256": "ed51fe47cdbb0c95db5d3a4f64117fe2625d3c0bf4e7170c6f3dec0d38ed11ba",
        "analysis": TMP / "fp-1-ceiling-analysis.json",
        "level_id": "main-house-main",
        "transform_method": "sealed-RCP-to-FP1 transform composed with 195-coordinate FP1-to-main-DWG transform",
        "transform_residual_ft": 0.04,
        "pdf_to_dwg": lambda x, y: (155.73611 - y / 13.5, 51.2199 - x / 13.5),
        "transform": {"formula": "dwgX=constantX-pdfY/scale;dwgY=constantY-pdfX/scale", "constantX": 155.73611, "constantY": 51.2199, "scalePtPerFt": 13.5},
    },
    "FP-2": {
        "source_id": "upper-floor-pdf",
        "pdf": TMP / "main-plans" / "5 - UPPER LEVEL PLANS.pdf",
        "sha256": "5175c15b80a53014b0dfd98f1ca5038a70ecb9578e004cda4f954aafc511a564",
        "analysis": TMP / "fp-2-ceiling-analysis.json",
        "level_id": "main-house-upper",
        "transform_method": "177-coordinate cropped upper-ceiling-view to upper-DWG vector match",
        "transform_residual_ft": 0.01637,
        "pdf_to_dwg": lambda x, y: (181.41667 - y / 13.5, 63 - x / 13.5),
        "transform": {"formula": "dwgX=constantX-pdfY/scale;dwgY=constantY-pdfX/scale", "constantX": 181.41667, "constantY": 63, "scalePtPerFt": 13.5},
    },
}


def rounded(value: float, digits: int = 5):
    value = round(float(value), digits)
    return int(value) if value.is_integer() else value


def normalize(value):
    if isinstance(value, float):
        return rounded(value)
    if isinstance(value, list):
        return [normalize(item) for item in value]
    if isinstance(value, dict):
        return {key: normalize(item) for key, item in value.items()}
    return value


def canonical_json(value) -> str:
    return json.dumps(normalize(value), sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def quantized_point(point):
    return tuple(round(float(axis) / ENDPOINT_QUANTIZATION_PT) * ENDPOINT_QUANTIZATION_PT for axis in point)


def extract_lines(page):
    lines = []
    selected = 0
    for drawing in page.get_drawings():
        color = drawing.get("color")
        width = round(float(drawing.get("width") or 0), 2)
        if not color or max(color) >= 0.02 or width not in WIDTHS_PT:
            continue
        for item in drawing["items"]:
            if item[0] != "l":
                continue
            selected += 1
            start = quantized_point(item[1])
            end = quantized_point(item[2])
            if start != end:
                lines.append(LineString([start, end]))
    return lines, selected


def ring_points(ring):
    return [[rounded(x), rounded(y)] for x, y in list(ring.coords)[:-1]]


def transform_ring(points, transform):
    return [[rounded(axis) for axis in transform(x, y)] for x, y in points]


def surface_key(annotation):
    return f"{annotation['kind']}:{rounded(annotation['height'])}"


def build_sheet(sheet_id, config):
    if sha256_file(config["pdf"]) != config["sha256"]:
        raise RuntimeError(f"{sheet_id} architectural PDF hash mismatch")
    analysis = json.loads(config["analysis"].read_text(encoding="utf-8"))
    annotations = analysis["annotations"]
    with fitz.open(config["pdf"]) as document:
        page = document[0]
        lines, selected_lines = extract_lines(page)
        faces = list(polygonize(unary_union(lines)))

    annotated_faces = []
    ordered = sorted(faces, key=lambda face: (face.bounds[1], face.bounds[0], face.bounds[3], face.bounds[2], face.area))
    for source_face_index, face in enumerate(ordered, start=1):
        contained = [row for row in annotations if face.covers(Point(row["topLeft"]))]
        if not contained:
            continue
        exterior_pdf = ring_points(face.exterior)
        holes_pdf = [ring_points(ring) for ring in face.interiors]
        exterior_dwg = transform_ring(exterior_pdf, config["pdf_to_dwg"])
        holes_dwg = [transform_ring(ring, config["pdf_to_dwg"]) for ring in holes_pdf]
        keys = sorted(set(surface_key(row) for row in contained))
        resolved = len(keys) == 1
        dwg_x = [point[0] for point in exterior_dwg]
        dwg_y = [point[1] for point in exterior_dwg]
        record = {
            "id": f"{sheet_id.lower()}-rcp-face-{source_face_index:04d}",
            "sourceFaceIndex": source_face_index,
            "polygonPdfPt": exterior_pdf,
            "holesPdfPt": holes_pdf,
            "polygonDwgFt": exterior_dwg,
            "holesDwgFt": holes_dwg,
            "areaPdfPt2": rounded(face.area),
            "areaFt2": rounded(face.area / (13.5 * 13.5)),
            "boundsDwgFt": {
                "minX": rounded(min(dwg_x)),
                "minY": rounded(min(dwg_y)),
                "maxX": rounded(max(dwg_x)),
                "maxY": rounded(max(dwg_y)),
            },
            "annotationIds": sorted(row["id"] for row in contained),
            "surfaceKeys": keys,
            "surfaceResolved": resolved,
        }
        if resolved:
            record["surfaceKind"] = contained[0]["kind"]
            record["heightAboveFloorFt"] = rounded(contained[0]["height"])
        annotated_faces.append(record)

    resolved = [face for face in annotated_faces if face["surfaceResolved"]]
    return {
        "sheetId": sheet_id,
        "levelId": config["level_id"],
        "source": {
            "sourceId": config["source_id"],
            "sourceSha256": config["sha256"],
            "pageIndex": 0,
            "transformMethod": config["transform_method"],
            "transformResidualFt": config["transform_residual_ft"],
            "pdfToDwgTransform": config["transform"],
        },
        "sourceCounts": {
            "selectedLineSegments": selected_lines,
            "usableLineSegments": len(lines),
            "polygonizedFaces": len(faces),
            "annotatedFaces": len(annotated_faces),
            "singleSurfaceFaces": len(resolved),
            "mixedSurfaceFaces": len(annotated_faces) - len(resolved),
        },
        "faces": annotated_faces,
    }


def main():
    sheets = [build_sheet(sheet_id, config) for sheet_id, config in SHEETS.items()]
    draft = {
        "artifactType": "halofire.dillon-rcp-vector-face-registry.v1",
        "projectName": "Dillon Residence",
        "generationPolicy": {
            "answerKeyUsed": False,
            "completedBidGeometryUsed": False,
            "lineSelection": "black-strokes-width-1.14-1.44-1.68-2.22pt",
            "endpointQuantizationPt": ENDPOINT_QUANTIZATION_PT,
            "faceConstruction": "unary-union-plus-polygonize",
            "surfaceJoin": "source-annotation-point-contained-by-vector-face",
            "mixedSurfacePolicy": "fail-closed-unresolved",
        },
        "sheets": sheets,
        "counts": {
            "totalVectorFaces": sum(sheet["sourceCounts"]["polygonizedFaces"] for sheet in sheets),
            "annotatedFaces": sum(sheet["sourceCounts"]["annotatedFaces"] for sheet in sheets),
            "singleSurfaceFaces": sum(sheet["sourceCounts"]["singleSurfaceFaces"] for sheet in sheets),
            "mixedSurfaceFaces": sum(sheet["sourceCounts"]["mixedSurfaceFaces"] for sheet in sheets),
        },
        "geometryGrounded": True,
        "complete": False,
        "claimStatus": "source-architectural-rcp-vector-faces-not-code-compliance-or-fabrication",
    }
    packet = normalize({**draft, "receiptSha256": hashlib.sha256(canonical_json(draft).encode("utf-8")).hexdigest()})
    OUTPUT.write_bytes((json.dumps(packet, separators=(",", ":"), ensure_ascii=False) + "\n").encode("utf-8"))
    print(json.dumps({"output": str(OUTPUT), "receiptSha256": packet["receiptSha256"], "counts": packet["counts"], "sheets": [{"sheetId": sheet["sheetId"], **sheet["sourceCounts"]} for sheet in sheets]}, indent=2))


if __name__ == "__main__":
    main()

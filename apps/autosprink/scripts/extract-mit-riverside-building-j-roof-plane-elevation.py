#!/usr/bin/env python3
import argparse
import hashlib
import json
import math
from pathlib import Path

import fitz


PROJECT_ID = "mit-riverside-building-j"
PROJECT_NAME = "MIT Riverside - Transportation Building J"
PDF_SHA256 = "08515f43642de408ed1f9fc5ebd35115083b023d62412d5d9bc4301cf146c93c"
PDF_BYTES = 116713715
SECTION_BINDINGS = {
    "section-e": ("f65f41960f27c0a13c60e35b9da36e100b255d92c94c8e895cc25f6ba550a0d5", 427934),
    "section-f": ("7b155ffa696ae89fde463b3f3a318e99956fe1976e73c73bf019f3e40a7eaca7", 304405),
}
PDF_PAGE_INDEX = 105
PDF_POINTS_PER_FOOT = 9.0
PLAN_ORIGIN_PDF_PT = {"x": 470.822113, "y": 876.2995}
MEMBRANE_BOUNDARY_FT = {"minX": 17.666667, "maxX": 75.666667, "minY": 65.5, "maxY": 99.5}


def file_sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def assert_file(path, expected_sha256, expected_bytes, code):
    stat = Path(path).stat()
    if stat.st_size != expected_bytes or file_sha256(path) != expected_sha256:
        raise RuntimeError(code)


def canonical_sha256(value):
    def normalize(item):
        if isinstance(item, dict):
            return {key: normalize(item[key]) for key in sorted(item)}
        if isinstance(item, list):
            return [normalize(entry) for entry in item]
        if isinstance(item, float) and item.is_integer():
            return int(item)
        return item
    payload = json.dumps(normalize(value), ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def rounded(value):
    return round(float(value), 6)


def line_texts(page):
    words = page.get_text("words")
    grouped = {}
    for word in words:
        grouped.setdefault((word[5], word[6]), []).append(word)
    return [" ".join(item[4] for item in sorted(line, key=lambda item: item[7])) for line in grouped.values()]


def require_line(lines, expected):
    if expected not in lines:
        raise RuntimeError(f"MIT_J_ROOF_TEXT_FACT_MISSING_{expected}")
    return expected


def drawing_by_seq(drawings, seqno):
    matches = [drawing for drawing in drawings if drawing["seqno"] == seqno]
    if len(matches) != 1:
        raise RuntimeError(f"MIT_J_ROOF_VECTOR_SEQ_{seqno}_COUNT_{len(matches)}")
    return matches[0]


def line_points(drawing):
    items = [item for item in drawing["items"] if item[0] == "l"]
    if not items:
        raise RuntimeError(f"MIT_J_ROOF_VECTOR_SEQ_{drawing['seqno']}_NO_LINES")
    points = [(float(items[0][1].x), float(items[0][1].y))]
    points.extend((float(item[2].x), float(item[2].y)) for item in items)
    if math.dist(points[0], points[-1]) < 0.001:
        points.pop()
    return points


def registered_point(point):
    x_pt, y_pt = point
    x_ft = (x_pt - PLAN_ORIGIN_PDF_PT["x"]) / PDF_POINTS_PER_FOOT
    y_ft = (y_pt - PLAN_ORIGIN_PDF_PT["y"]) / PDF_POINTS_PER_FOOT
    if abs(x_pt - 629.889) < 0.1:
        x_ft = MEMBRANE_BOUNDARY_FT["minX"]
    if abs(x_pt - 1151.97) < 0.1:
        x_ft = MEMBRANE_BOUNDARY_FT["maxX"]
    if abs(y_pt - 1771.8) < 0.1:
        y_ft = MEMBRANE_BOUNDARY_FT["maxY"]
    return {"x": rounded(x_ft), "y": rounded(y_ft)}


def cricket_face(drawings, face_id, seqno):
    drawing = drawing_by_seq(drawings, seqno)
    if drawing["layer"] != "A-ROOF-MAJR.3D" or drawing["type"] != "f":
        raise RuntimeError(f"MIT_J_CRICKET_VECTOR_SEQ_{seqno}_TYPE")
    pdf_points = line_points(drawing)
    if len(pdf_points) not in (4, 5):
        raise RuntimeError(f"MIT_J_CRICKET_VECTOR_SEQ_{seqno}_VERTICES_{len(pdf_points)}")
    return {
        "id": face_id,
        "sourceLayer": drawing["layer"],
        "sourceSequence": seqno,
        "riseInPer12": 0.5,
        "rawPdfVerticesPt": [{"x": rounded(x), "y": rounded(y)} for x, y in pdf_points],
        "registeredStructuralLocalVerticesFt": [registered_point(point) for point in pdf_points],
    }


def section_line(dump, handle, expected_pitch):
    blocks = {block["name"]: block for block in dump["blockRecords"]}
    matches = []
    for insert in dump["entities"]:
        if insert.get("type") != "INSERT" or "A-ROOF" not in insert.get("layer", ""):
            continue
        for entity in blocks.get(insert.get("name"), {}).get("entities", []):
            if entity.get("type") == "LINE" and entity.get("handle") == handle:
                matches.append((insert, entity))
    if len(matches) != 1:
        raise RuntimeError(f"MIT_J_SECTION_HANDLE_{handle}_COUNT_{len(matches)}")
    insert, entity = matches[0]
    start = entity["startPoint"]
    end = entity["endPoint"]
    dx = end["x"] - start["x"]
    dy = end["y"] - start["y"]
    pitch = dy / dx * 12
    if not math.isclose(pitch, expected_pitch, abs_tol=0.000001):
        raise RuntimeError(f"MIT_J_SECTION_HANDLE_{handle}_PITCH_{pitch}")
    return {
        "handle": handle,
        "blockName": insert["name"],
        "sourceLayer": insert["layer"],
        "startInches": {"sectionAxis": rounded(start["x"]), "elevation": rounded(start["y"])},
        "endInches": {"sectionAxis": rounded(end["x"]), "elevation": rounded(end["y"])},
        "riseInPer12": rounded(pitch),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", required=True)
    parser.add_argument("--section-e-dwg", required=True)
    parser.add_argument("--section-f-dwg", required=True)
    parser.add_argument("--section-e-dump", required=True)
    parser.add_argument("--section-f-dump", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    assert_file(args.pdf, PDF_SHA256, PDF_BYTES, "MIT_J_ARCHITECTURAL_PDF_SOURCE_MISMATCH")
    for key, path in (("section-e", args.section_e_dwg), ("section-f", args.section_f_dwg)):
        expected_sha256, expected_bytes = SECTION_BINDINGS[key]
        assert_file(path, expected_sha256, expected_bytes, f"MIT_J_{key.upper()}_SOURCE_MISMATCH")

    section_e = json.loads(Path(args.section_e_dump).read_text(encoding="utf-8"))
    section_f = json.loads(Path(args.section_f_dump).read_text(encoding="utf-8"))
    if section_e.get("unknownEntityCount") != 0 or section_f.get("unknownEntityCount") != 0:
        raise RuntimeError("MIT_J_SECTION_DWG_UNKNOWN_ENTITIES")

    document = fitz.open(args.pdf)
    page = document[PDF_PAGE_INDEX]
    drawings = page.get_drawings()
    words = page.get_text("words")
    lines = line_texts(page)
    text_facts = {
        "mainPitch": require_line(lines, '1 1/4" : 12" SLOPE'),
        "westPitch": require_line(lines, '1 1/2" : 12" SLOPE'),
        "membranePitch": require_line(lines, '3/8" : 12" SLOPE'),
        "drainCricketPitchCount": sum(word[4] == "1/2:12" and 400 < word[0] < 1300 and 1600 < word[1] < 1800 for word in words),
        "mainLowBod": require_line(lines, '17\'-1" B.O.D.'),
        "mainIntermediateBod": require_line(lines, '19\'-11" B.O.D.'),
        "mainHighBod": require_line(lines, '23\'-4" B.O.D.'),
        "membraneSouthBod": require_line(lines, '12\'-0" B.O.D.'),
        "membraneArea": require_line(lines, 'ROOF AREA: 1,972 SF'),
    }
    if text_facts["drainCricketPitchCount"] != 4:
        raise RuntimeError("MIT_J_DRAIN_CRICKET_PITCH_COUNT")

    scale_segments = [drawing_by_seq(drawings, seqno) for seqno in (18892, 18893, 18894, 18895)]
    scale_min_x = min(drawing["rect"].x0 for drawing in scale_segments)
    scale_max_x = max(drawing["rect"].x1 for drawing in scale_segments)
    if not math.isclose(scale_max_x - scale_min_x, 144, abs_tol=0.001):
        raise RuntimeError("MIT_J_ROOF_SCALE_BAR_REPLAY_MISMATCH")
    dimension_left = drawing_by_seq(drawings, 2928)["rect"].x0
    dimension_right = drawing_by_seq(drawings, 2933)["rect"].x1
    if not math.isclose(dimension_right - dimension_left, 576, abs_tol=0.01):
        raise RuntimeError("MIT_J_ROOF_64FT_DIMENSION_REPLAY_MISMATCH")

    cricket_faces = [
        cricket_face(drawings, "southwest-drain-west-wedge", 4206),
        cricket_face(drawings, "southwest-drain-east-wedge", 4200),
        cricket_face(drawings, "southeast-drain-west-wedge", 4217),
        cricket_face(drawings, "southeast-drain-east-wedge", 4211),
    ]

    section_profiles = {
        "mainStandingSeamCorroboration": section_line(section_e, "D81", 1.25),
        "westStandingSeam": section_line(section_e, "9DC", -1.5),
        "membraneBottomOfDeck": section_line(section_f, "115C", -0.375),
        "membraneRoofSurface": section_line(section_f, "115F", -0.375),
    }

    draft = {
        "artifactType": "halofire.mit-riverside-building-j-roof-plane-elevation-evidence.v1",
        "projectId": PROJECT_ID,
        "projectName": PROJECT_NAME,
        "generationMode": "protected-architectural-pdf-vectors-plus-section-e-f-dwg-profiles",
        "sources": {
            "architecturalBidSet": {"physicalPage": 106, "pageIndex": PDF_PAGE_INDEX, "bytes": PDF_BYTES, "sha256": PDF_SHA256},
            "sectionE": {"bytes": SECTION_BINDINGS["section-e"][1], "sha256": SECTION_BINDINGS["section-e"][0]},
            "sectionF": {"bytes": SECTION_BINDINGS["section-f"][1], "sha256": SECTION_BINDINGS["section-f"][0]},
        },
        "extraction": {"pdfReader": f"PyMuPDF {fitz.VersionBind}", "dwgReader": "@mlightcad/libredwg-web 0.7.7", "unknownSectionEntityCount": 0},
        "planRegistration": {
            "pdfPointsPerFoot": PDF_POINTS_PER_FOOT,
            "scaleBar": {"pdfWidthPt": rounded(scale_max_x - scale_min_x), "sourceWidthFt": 16},
            "overallMainWidthDimension": {"pdfWidthPt": rounded(dimension_right - dimension_left), "sourceWidthFt": 64},
            "originPdfPt": PLAN_ORIGIN_PDF_PT,
            "membraneBoundaryStructuralLocalFt": MEMBRANE_BOUNDARY_FT,
            "boundarySnapToleranceFt": 0.02,
        },
        "roofPlanTextFacts": text_facts,
        "cricketFaces": cricket_faces,
        "sectionProfiles": section_profiles,
        "protectionPlaneConstraints": {
            "mainOpenStructureBod": {"axis": "y", "minYFt": 0, "maxYFt": 60, "minZFt": 17.083333, "maxZFt": 23.333333, "riseInPer12": 1.25},
            "membraneOpenStructureBod": {"axis": "y", "minYFt": 65.5, "maxYFt": 99.5, "minZFt": 13.0625, "maxZFt": 12, "riseInPer12": -0.375},
        },
        "supersessions": [{"artifact": "mit-riverside-building-j-source-only-pitched-candidate.v1", "field": "lower-connected-roof.riseInPer12", "legacyValue": 0.5, "sourceCorrectedValue": 1.5, "reason": "roof-plan text and section-E handle 9DC both prove 1 1/2:12"}],
        "claims": {"sourceCricketVectorsReady": True, "sourceSideViewProfilesReady": True, "sourceProtectionPlaneConstraintsReady": True, "headInstallationZReady": False, "complianceReady": False, "fabricationReady": False, "fieldReleaseReady": False},
    }
    output = {**draft, "receiptSha256": canonical_sha256(draft)}
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes((json.dumps(output, indent=2, ensure_ascii=False) + "\n").encode("utf-8"))
    print(json.dumps({"output": str(output_path), "cricketFaces": len(cricket_faces), "sectionProfiles": len(section_profiles), "receiptSha256": output["receiptSha256"]}, indent=2))


if __name__ == "__main__":
    main()

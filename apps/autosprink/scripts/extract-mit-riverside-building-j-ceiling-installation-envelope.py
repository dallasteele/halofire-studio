#!/usr/bin/env python3
import argparse
import hashlib
import json
import math
from pathlib import Path

import fitz


PROJECT_ID = "mit-riverside-building-j"
ARCHITECTURAL = (116713715, "08515f43642de408ed1f9fc5ebd35115083b023d62412d5d9bc4301cf146c93c")
RCP_DWG = (6423002, "05cdadaa2dd74dd7d02199b7030960864cc30c99044e82de28ca7176188b5658")
APPROVED_FP = (2432530, "6da51cbd5bdbf34861502630311f8d0e3d4c8e3dcb61896ba614ff634fde8421")
MATERIAL_DATA = (1577551, "709d594e3238992b5a0c4380afbf757d5988f9d7490ca49ab34031739beaad9e")
RCP_PAGE_INDEX = 104

X_FT = [0, 15.666667, 17.333333, 30.666667, 39.666667, 45.666667, 61.333333, 76.333333]
X_DWG = [13437.687842947527, 13625.653727606074, 13645.689597076707, 13805.653727606074, 13913.687842947527, 13985.653727606074, 14173.687842947525, 14353.687842947522]
Y_FT = [0, 32.166667, 64.833333, 89.166667, 100.166667]
Y_DWG = [11469.52854430901, 11083.52854430901, 10691.528544309007, 10399.580543635211, 10267.528543428964]

CEILING_BINDINGS = {
    "Slab_2": (9, "J103", ["MIT-J-P-010", "MIT-J-P-012"]),
    "Slab_3": (9, "J102", ["MIT-J-P-001", "MIT-J-P-002"]),
    "Slab_4": (9, "J101", ["MIT-J-P-005", "MIT-J-P-006"]),
    "Slab_5": (10, "J109", ["MIT-J-P-003", "MIT-J-P-004"]),
    "Slab_7": (9, "J104", ["MIT-J-P-008", "MIT-J-P-014"]),
    "Slab_12": (9, "J104", ["MIT-J-P-009", "MIT-J-P-015"]),
    "Slab_14": (9, "southwest-9ft-control", ["MIT-J-P-011"]),
    "Slab_27": (9, "J104", ["MIT-J-P-007", "MIT-J-P-013"]),
}

PDF_CONTROLS = [
    ("J102", "9'-0\"", 543.249329, 1519.630920, 9),
    ("J101", "9'-0\"", 542.362061, 1614.523499, 9),
    ("J103", "9'-0\"", 733.148132, 1648.431702, 9),
    ("J104", "9'-0\"", 958.548157, 1631.262146, 9),
    ("southwest-9ft-control", "9'-0\"", 649.591187, 1745.790588, 9),
    ("J109", "10'-0\"", 828.341187, 1557.892914, 10),
    ("east-8ft-control", "8'-0\"", 1126.842, 1677.657, 8),
    ("J100", "9'", 712.566101, 1593.768250, 9),
]


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def assert_file(path, binding, code):
    size, digest = binding
    if Path(path).stat().st_size != size or sha256(path) != digest:
        raise RuntimeError(code)


def canonical_sha256(value):
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def rounded(value):
    return round(float(value), 6)


def piecewise(value, source, target):
    index = next((i for i, entry in enumerate(source) if value <= entry), len(source) - 1)
    index = max(1, min(index, len(source) - 1))
    ratio = (value - source[index - 1]) / (source[index] - source[index - 1])
    return target[index - 1] + ratio * (target[index] - target[index - 1])


def to_local(point):
    return {
        "x": rounded(piecewise(point["x"], X_DWG, X_FT)),
        "y": rounded(piecewise(point["y"], list(reversed(Y_DWG)), list(reversed(Y_FT)))),
    }


def transform(point, insert, block):
    x = (point["x"] - block["basePoint"]["x"]) * insert.get("xScale", 1)
    y = (point["y"] - block["basePoint"]["y"]) * insert.get("yScale", 1)
    angle = insert.get("rotation", 0)
    return {
        "x": insert["insertionPoint"]["x"] + x * math.cos(angle) - y * math.sin(angle),
        "y": insert["insertionPoint"]["y"] + x * math.sin(angle) + y * math.cos(angle),
    }


def point_in_polygon(point, vertices):
    inside = False
    j = len(vertices) - 1
    for i, current in enumerate(vertices):
        previous = vertices[j]
        if ((current["y"] > point["y"]) != (previous["y"] > point["y"])) and point["x"] < (previous["x"] - current["x"]) * (point["y"] - current["y"]) / (previous["y"] - current["y"]) + current["x"]:
            inside = not inside
        j = i
    return inside


def polygon_area(vertices):
    return abs(sum(point["x"] * vertices[(i + 1) % len(vertices)]["y"] - vertices[(i + 1) % len(vertices)]["x"] * point["y"] for i, point in enumerate(vertices)) / 2)


def extract_zones(dump, heads):
    blocks = {block["name"]: block for block in dump["blockRecords"]}
    zones = []
    for insert in dump["entities"]:
        if insert.get("type") != "INSERT" or "A-CLNG-MTRL" not in insert.get("layer", "") or not insert.get("name", "").startswith("Slab_"):
            continue
        origin = insert["insertionPoint"]
        if not (13350 < origin["x"] < 14450 and 10200 < origin["y"] < 11550):
            continue
        block = blocks.get(insert["name"], {})
        paths = []
        for entity in block.get("entities", []):
            if entity.get("type") == "HATCH":
                for path in entity.get("boundaryPaths", []):
                    if path.get("isClosed") and len(path.get("vertices", [])) >= 3:
                        paths.append((entity, path["vertices"], entity.get("patternName")))
        if not paths:
            for entity in block.get("entities", []):
                if entity.get("type") == "LWPOLYLINE" and entity.get("flag", 0) & 512 and len(entity.get("vertices", [])) >= 3 and "A-CLNG-MTRL" in entity.get("layer", ""):
                    paths.append((entity, entity["vertices"], "closed-ceiling-material-polyline"))
        for source, vertices, pattern in paths:
            local_vertices = [to_local(transform(point, insert, block)) for point in vertices]
            assignments = [{"id": head["id"], "kind": head["kind"]} for head in heads if point_in_polygon(head["structuralRoofLocalFt"], local_vertices)]
            zones.append({
                "id": f"{insert['name']}-{insert['handle']}", "blockName": insert["name"], "insertHandle": insert["handle"],
                "sourceLayer": insert["layer"], "sourceGeometryHandle": source["handle"], "patternName": pattern,
                "structuralLocalVerticesFt": local_vertices, "areaSqFt": rounded(polygon_area(local_vertices)), "headAssignments": assignments,
            })
    return zones


def closest_word(words, text, x, y, tolerance=18):
    candidates = []
    for word in words:
        if word[4] != text:
            continue
        cx, cy = (word[0] + word[2]) / 2, (word[1] + word[3]) / 2
        candidates.append((math.dist((x, y), (cx, cy)), word, cx, cy))
    if not candidates or min(candidates)[0] > tolerance:
        raise RuntimeError(f"MIT_J_RCP_CONTROL_MISSING_{text}_{x}_{y}")
    distance, word, cx, cy = min(candidates)
    return {"text": text, "bboxPt": [rounded(v) for v in word[:4]], "centerPt": {"x": rounded(cx), "y": rounded(cy)}, "matchDistancePt": rounded(distance)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--architectural-pdf", required=True)
    parser.add_argument("--rcp-dwg", required=True)
    parser.add_argument("--rcp-dump", required=True)
    parser.add_argument("--approved-fp", required=True)
    parser.add_argument("--material-data", required=True)
    parser.add_argument("--heads", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    assert_file(args.architectural_pdf, ARCHITECTURAL, "MIT_J_ARCHITECTURAL_SOURCE_MISMATCH")
    assert_file(args.rcp_dwg, RCP_DWG, "MIT_J_RCP_DWG_SOURCE_MISMATCH")
    assert_file(args.approved_fp, APPROVED_FP, "MIT_J_APPROVED_FP_SOURCE_MISMATCH")
    assert_file(args.material_data, MATERIAL_DATA, "MIT_J_MATERIAL_SOURCE_MISMATCH")
    dump = json.loads(Path(args.rcp_dump).read_text(encoding="utf-8"))
    if dump.get("unknownEntityCount") != 0:
        raise RuntimeError("MIT_J_RCP_DWG_UNKNOWN_ENTITIES")
    head_packet = json.loads(Path(args.heads).read_text(encoding="utf-8"))
    heads = head_packet["headAssignments"]
    zones = extract_zones(dump, heads)
    if len(zones) != 20:
        raise RuntimeError(f"MIT_J_CEILING_ZONE_COUNT_{len(zones)}")

    page = fitz.open(args.architectural_pdf)[RCP_PAGE_INDEX]
    words = page.get_text("words")
    controls = []
    for control_id, label, x, y, height in PDF_CONTROLS:
        controls.append({"id": control_id, "ceilingHeightFt": height, "sourceLabel": closest_word(words, label, x, y)})

    zone_by_block = {zone["blockName"]: zone for zone in zones}
    pendent_bindings = []
    for block_name, (height, control_id, expected_ids) in CEILING_BINDINGS.items():
        zone = zone_by_block[block_name]
        actual = [head["id"] for head in zone["headAssignments"] if head["kind"] == "pendent"]
        if actual != expected_ids:
            raise RuntimeError(f"MIT_J_PENDENT_BINDING_{block_name}")
        for head_id in actual:
            pendent_bindings.append({"headId": head_id, "ceilingZoneId": zone["id"], "ceilingHeightFt": height, "controlId": control_id})
    if len(pendent_bindings) != 15 or len({item["headId"] for item in pendent_bindings}) != 15:
        raise RuntimeError("MIT_J_PENDENT_BINDING_COUNT")

    upright_overlap_ids = sorted({head["id"] for zone in zones for head in zone["headAssignments"] if head["kind"] == "upright"})
    if upright_overlap_ids != ["MIT-J-U-045", "MIT-J-U-047", "MIT-J-U-048", "MIT-J-U-049", "MIT-J-U-051", "MIT-J-U-052", "MIT-J-U-053"]:
        raise RuntimeError("MIT_J_ABOVE_CEILING_UPRIGHT_BINDING")

    schedule = {
        "source": {"physicalPage": 2, "sheet": "FP-2", "scheduleTitle": "SPRINKLER SCHEDULE", "transcriptionMode": "pixel-verified-approved-plan-schedule"},
        "pendent": {"count": 15, "position": "PEND", "finish": "CHROME", "temperatureF": 155, "kFactor": 5.6, "nptIn": 0.5, "sin": "TY3231", "manufacturer": "Tyco", "model": "TY-FRB"},
        "upright": {"count": 53, "position": "UPR", "finish": "BRASS", "temperatureF": 200, "kFactor": 5.6, "nptIn": 0.5, "sin": "TY3131", "manufacturer": "Tyco", "model": "TY-FRB"},
    }
    manufacturer = {
        "source": {"document": "TFP171", "revision": "March 2020", "physicalPages": [1, 3, 6]},
        "approvedSinBindings": {"pendent": "TY3231", "upright": "TY3131"},
        "standardPendentFigure": {"physicalPage": 3, "figure": 3, "overallFittingFaceToDeflectorIn": 2.1875, "escutcheonPlateSeatingSurfaceToDeflectorIn": 1.5, "nominalThreadMakeIn": 0.4375},
        "recessedOptionsNotSelectedByApprovedSchedule": [
            {"style": 10, "totalAdjustmentIn": 0.75, "deflectorBelowMountingSurfaceIn": [0.75, 1.25]},
            {"style": 20, "totalAdjustmentIn": 0.5, "deflectorBelowMountingSurfaceIn": [1.0, 1.5]},
        ],
        "installationConclusion": "approved schedule says PEND, not recessed pendent; standard pendent geometry is conditionally usable, but exact installed deflector Z remains null until the ceiling seating-surface/fitting detail is source-proved",
    }

    draft = {
        "artifactType": "halofire.mit-riverside-building-j-ceiling-installation-envelope-evidence.v1", "projectId": PROJECT_ID,
        "generationMode": "protected-rcp-pdf-text-plus-rcp-dwg-ceiling-polygons-plus-approved-fp-schedule-plus-submitted-manufacturer-data",
        "sources": {
            "architecturalBidSet": {"physicalPage": 105, "pageIndex": RCP_PAGE_INDEX, "bytes": ARCHITECTURAL[0], "sha256": ARCHITECTURAL[1]},
            "rcpDwg": {"bytes": RCP_DWG[0], "sha256": RCP_DWG[1]}, "approvedFp": {"bytes": APPROVED_FP[0], "sha256": APPROVED_FP[1]},
            "materialData": {"bytes": MATERIAL_DATA[0], "sha256": MATERIAL_DATA[1]}, "headPacketReceiptSha256": head_packet["receiptSha256"],
        },
        "extraction": {"pdfReader": f"PyMuPDF {fitz.VersionBind}", "dwgReader": "@mlightcad/libredwg-web 0.7.7", "unknownRcpEntityCount": 0},
        "gridRegistration": {"xStructuralFt": X_FT, "xRcpDwg": X_DWG, "yStructuralFt": Y_FT, "yRcpDwg": Y_DWG, "method": "piecewise-exact-cross-drawing-grid-anchor-replay"},
        "ceilingControls": controls, "ceilingZones": zones, "pendentBindings": pendent_bindings, "aboveFinishedCeilingUprightIds": upright_overlap_ids,
        "approvedSprinklerSchedule": schedule, "submittedManufacturerData": manufacturer,
        "counts": {"ceilingZones": len(zones), "pendentHeadsBound": 15, "pendentAt9Ft": 13, "pendentAt10Ft": 2, "aboveFinishedCeilingUprights": 7},
        "claims": {"allPendentCeilingPlanesReady": True, "approvedProductScheduleReady": True, "conditionalStandardPendentGeometryReady": True, "exactInstalledDeflectorZReady": False, "complianceReady": False, "fabricationReady": False, "fieldReleaseReady": False},
    }
    output = {**draft, "receiptSha256": canonical_sha256(draft)}
    destination = Path(args.output)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes((json.dumps(output, indent=2, ensure_ascii=False) + "\n").encode("utf-8"))
    print(json.dumps({"output": str(destination), "receiptSha256": output["receiptSha256"], "counts": output["counts"]}, indent=2))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Extract Building J placement inputs from protected architectural sources only.

This extractor intentionally has no approved-plan, as-built-plan, sprinkler-head,
or completed-layout argument. It replays ceiling material geometry from the raw
RCP DWG dump, ceiling height controls from the architectural PDF, and roof/floor
geometry from independently sealed source evidence.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
from typing import Any

import fitz


PROJECT_ID = "mit-riverside-building-j"
PROJECT_NAME = "MIT Riverside - Transportation Building J"
ARCHITECTURAL = (116713715, "08515f43642de408ed1f9fc5ebd35115083b023d62412d5d9bc4301cf146c93c")
RCP_DWG = (6423002, "05cdadaa2dd74dd7d02199b7030960864cc30c99044e82de28ca7176188b5658")
RCP_PAGE_INDEX = 104

X_FT = [0, 15.666667, 17.333333, 30.666667, 39.666667, 45.666667, 61.333333, 76.333333]
X_DWG = [13437.687842947527, 13625.653727606074, 13645.689597076707, 13805.653727606074, 13913.687842947527, 13985.653727606074, 14173.687842947525, 14353.687842947522]
Y_FT = [0, 32.166667, 64.833333, 89.166667, 100.166667]
Y_DWG = [11469.52854430901, 11083.52854430901, 10691.528544309007, 10399.580543635211, 10267.528543428964]
RCP_X_PT = [470.822342, 592.857697, 626.822632, 746.7966, 827.82019, 861.569153, 1022.821594, 1157.819519]
RCP_Y_PT = [876.28183, 1165.784607, 1459.783142, 1678.745667, 1777.785583]

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


def file_sha256(path: str | Path) -> str:
    """Return the SHA-256 digest for a file without modifying it."""
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def assert_file(path: str | Path, binding: tuple[int, str], code: str) -> None:
    """Fail closed when a protected source file no longer matches its binding."""
    size, digest = binding
    source = Path(path)
    if source.stat().st_size != size or file_sha256(source) != digest:
        raise RuntimeError(code)


def javascript_numbers(value: Any) -> Any:
    """Normalize integral floats as JavaScript JSON.stringify serializes them."""
    if isinstance(value, list):
        return [javascript_numbers(entry) for entry in value]
    if isinstance(value, dict):
        return {key: javascript_numbers(entry) for key, entry in value.items()}
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def canonical_sha256(value: Any) -> str:
    """Hash JSON using the repository's sorted-key JavaScript representation."""
    payload = json.dumps(javascript_numbers(value), sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def assert_receipt(value: dict[str, Any], code: str) -> None:
    """Verify a sealed JSON receipt before using its source-only fields."""
    draft = {key: entry for key, entry in value.items() if key != "receiptSha256"}
    raw_payload = json.dumps(javascript_numbers(draft), separators=(",", ":"), ensure_ascii=False)
    raw_digest = hashlib.sha256(raw_payload.encode("utf-8")).hexdigest()
    if value.get("receiptSha256") not in {canonical_sha256(draft), raw_digest}:
        raise RuntimeError(code)


def rounded(value: float) -> float:
    """Round geometry consistently for deterministic cross-language replay."""
    return round(float(value), 6)


def piecewise(value: float, source: list[float], target: list[float]) -> float:
    """Interpolate a coordinate between adjacent registered grid anchors."""
    if value <= source[0]:
        return target[0]
    if value >= source[-1]:
        return target[-1]
    index = next(index for index in range(1, len(source)) if value <= source[index])
    ratio = (value - source[index - 1]) / (source[index] - source[index - 1])
    return target[index - 1] + ratio * (target[index] - target[index - 1])


def to_local(point: dict[str, float]) -> dict[str, float]:
    """Transform an RCP DWG point to structural-local feet."""
    return {
        "x": rounded(piecewise(point["x"], X_DWG, X_FT)),
        "y": rounded(piecewise(point["y"], list(reversed(Y_DWG)), list(reversed(Y_FT)))),
    }


def transform(point: dict[str, float], insert: dict[str, Any], block: dict[str, Any]) -> dict[str, float]:
    """Apply a DWG block insertion transform to one block-local vertex."""
    x = (point["x"] - block["basePoint"]["x"]) * insert.get("xScale", 1)
    y = (point["y"] - block["basePoint"]["y"]) * insert.get("yScale", 1)
    angle = insert.get("rotation", 0)
    return {
        "x": insert["insertionPoint"]["x"] + x * math.cos(angle) - y * math.sin(angle),
        "y": insert["insertionPoint"]["y"] + x * math.sin(angle) + y * math.cos(angle),
    }


def polygon_area(vertices: list[dict[str, float]]) -> float:
    """Return the absolute shoelace area of a structural-local polygon."""
    return abs(sum(
        point["x"] * vertices[(index + 1) % len(vertices)]["y"]
        - vertices[(index + 1) % len(vertices)]["x"] * point["y"]
        for index, point in enumerate(vertices)
    ) / 2)


def extract_zones(dump: dict[str, Any]) -> list[dict[str, Any]]:
    """Extract ceiling-material polygons without reading any sprinkler answer."""
    blocks = {block["name"]: block for block in dump["blockRecords"]}
    zones: list[dict[str, Any]] = []
    for insert in dump["entities"]:
        if insert.get("type") != "INSERT" or "A-CLNG-MTRL" not in insert.get("layer", "") or not insert.get("name", "").startswith("Slab_"):
            continue
        origin = insert["insertionPoint"]
        if not (13350 < origin["x"] < 14450 and 10200 < origin["y"] < 11550):
            continue
        block = blocks.get(insert["name"], {})
        paths: list[tuple[dict[str, Any], list[dict[str, float]], str]] = []
        for entity in block.get("entities", []):
            if entity.get("type") == "HATCH":
                for path in entity.get("boundaryPaths", []):
                    if path.get("isClosed") and len(path.get("vertices", [])) >= 3:
                        paths.append((entity, path["vertices"], entity.get("patternName") or "HATCH"))
        if not paths:
            for entity in block.get("entities", []):
                if entity.get("type") == "LWPOLYLINE" and entity.get("flag", 0) & 512 and len(entity.get("vertices", [])) >= 3 and "A-CLNG-MTRL" in entity.get("layer", ""):
                    paths.append((entity, entity["vertices"], "closed-ceiling-material-polyline"))
        for source, vertices, pattern in paths:
            local_vertices = [to_local(transform(point, insert, block)) for point in vertices]
            zones.append({
                "id": f"{insert['name']}-{insert['handle']}",
                "blockName": insert["name"],
                "insertHandle": insert["handle"],
                "sourceLayer": insert["layer"],
                "sourceGeometryHandle": source["handle"],
                "patternName": pattern,
                "structuralLocalVerticesFt": local_vertices,
                "areaSqFt": rounded(polygon_area(local_vertices)),
            })
    return zones


def closest_word(words: list[tuple[Any, ...]], text: str, x: float, y: float, tolerance: float = 18) -> dict[str, Any]:
    """Bind a printed ceiling control to its exact protected-PDF word box."""
    candidates = []
    for word in words:
        if word[4] != text:
            continue
        cx, cy = (word[0] + word[2]) / 2, (word[1] + word[3]) / 2
        candidates.append((math.dist((x, y), (cx, cy)), word, cx, cy))
    if not candidates or min(candidates)[0] > tolerance:
        raise RuntimeError(f"MIT_J_SOURCE_PLACEMENT_CONTROL_MISSING_{text}_{x}_{y}")
    distance, word, cx, cy = min(candidates)
    return {
        "text": text,
        "bboxPt": [rounded(value) for value in word[:4]],
        "centerPt": {"x": rounded(cx), "y": rounded(cy)},
        "matchDistancePt": rounded(distance),
    }


def main() -> None:
    """Run the protected-source extraction and write one sealed input packet."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--architectural-pdf", required=True)
    parser.add_argument("--rcp-dwg", required=True)
    parser.add_argument("--rcp-dump", required=True)
    parser.add_argument("--spatial-evidence", required=True)
    parser.add_argument("--roof-evidence", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    assert_file(args.architectural_pdf, ARCHITECTURAL, "MIT_J_SOURCE_PLACEMENT_ARCHITECTURAL_MISMATCH")
    assert_file(args.rcp_dwg, RCP_DWG, "MIT_J_SOURCE_PLACEMENT_RCP_DWG_MISMATCH")
    dump = json.loads(Path(args.rcp_dump).read_text(encoding="utf-8"))
    if dump.get("unknownEntityCount") != 0:
        raise RuntimeError("MIT_J_SOURCE_PLACEMENT_RCP_UNKNOWN_ENTITIES")

    spatial = json.loads(Path(args.spatial_evidence).read_text(encoding="utf-8"))
    roof = json.loads(Path(args.roof_evidence).read_text(encoding="utf-8"))
    assert_receipt(spatial, "MIT_J_SOURCE_PLACEMENT_SPATIAL_RECEIPT_MISMATCH")
    assert_receipt(roof, "MIT_J_SOURCE_PLACEMENT_ROOF_RECEIPT_MISMATCH")
    zones = extract_zones(dump)
    if len(zones) != 20:
        raise RuntimeError(f"MIT_J_SOURCE_PLACEMENT_CEILING_ZONE_COUNT_{len(zones)}")

    page = fitz.open(args.architectural_pdf)[RCP_PAGE_INDEX]
    words = page.get_text("words")
    controls = []
    for control_id, label, x, y, height in PDF_CONTROLS:
        controls.append({
            "id": control_id,
            "ceilingHeightFt": height,
            "sourceLabel": closest_word(words, label, x, y),
            "structuralLocalFt": {
                "x": rounded(piecewise(x, RCP_X_PT, X_FT)),
                "y": rounded(piecewise(y, RCP_Y_PT, Y_FT)),
            },
        })

    draft = {
        "artifactType": "halofire.mit-riverside-building-j-source-placement-inputs.v1",
        "projectId": PROJECT_ID,
        "projectName": PROJECT_NAME,
        "generationMode": "protected-architectural-pdf-plus-raw-rcp-dwg-plus-sealed-source-floor-roof-evidence-no-sprinkler-answer",
        "sources": {
            "architecturalBidSet": {"physicalPage": 105, "pageIndex": RCP_PAGE_INDEX, "bytes": ARCHITECTURAL[0], "sha256": ARCHITECTURAL[1]},
            "rcpDwg": {"bytes": RCP_DWG[0], "sha256": RCP_DWG[1]},
            "rcpDump": {"bytes": Path(args.rcp_dump).stat().st_size, "sha256": file_sha256(args.rcp_dump), "unknownEntityCount": 0},
            "sourceSpatialEvidenceReceiptSha256": spatial["receiptSha256"],
            "sourceRoofEvidenceReceiptSha256": roof["receiptSha256"],
        },
        "coordinateSystem": "exact-structural-roof-local-feet",
        "gridRegistration": {"xStructuralFt": X_FT, "xRcpDwg": X_DWG, "xRcpPdfPt": RCP_X_PT, "yStructuralFt": Y_FT, "yRcpDwg": Y_DWG, "yRcpPdfPt": RCP_Y_PT},
        "floorSlabs": spatial["floorSlabs"],
        "roofRegions": spatial["roofRegions"],
        "roofPlanRegistration": roof["planRegistration"],
        "sectionProfiles": roof["sectionProfiles"],
        "protectionPlaneConstraints": roof["protectionPlaneConstraints"],
        "ceilingControls": controls,
        "ceilingZones": zones,
        "placementPolicy": {
            "hazardAssumption": "ordinary",
            "hazardAssumptionStatus": "internal-alpha-default-not-source-classified-not-code-compliance",
            "maxAreaSqFt": 130,
            "maxSpacingFt": 15,
            "minSpacingFt": 6,
            "ceilingComponentJoinToleranceFt": 0.8,
            "ceilingVoidBridgeToleranceFt": 0.4,
            "singletonSoffitMinimumWidthFt": 3,
            "source": "existing deterministic HaloFire ordinary-hazard internal-alpha policy; empirical candidate only",
        },
        "sequence": {
            "answerArtifactRead": False,
            "completedLayoutRead": False,
            "sourceInputsBuiltAfterHistoricalAnswerExposure": True,
            "freshProjectHoldoutRequired": True,
        },
        "claims": {
            "sourceGeometryReady": True,
            "sourceGeneratedPlacementReady": False,
            "freshProjectPlacementVerified": False,
            "complianceReady": False,
            "hydraulicCalculationReady": False,
            "fabricationReady": False,
            "fieldReleaseReady": False,
        },
    }
    output = {**draft, "receiptSha256": canonical_sha256(draft)}
    destination = Path(args.output)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes((json.dumps(output, indent=2, ensure_ascii=False) + "\n").encode("utf-8"))
    print(json.dumps({
        "output": str(destination),
        "receiptSha256": output["receiptSha256"],
        "ceilingZoneCount": len(zones),
        "answerArtifactRead": False,
    }, indent=2))


if __name__ == "__main__":
    main()

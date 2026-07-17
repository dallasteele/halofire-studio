#!/usr/bin/env python3
"""Extract source-bound New Hope welded wet-main plan registrations."""

from __future__ import annotations

import hashlib
import io
import json
import math
import re
from collections import defaultdict
from pathlib import Path

import fitz
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[3]
FIELD = ROOT / "tmp/pdfs/new-hope-live/field-install.pdf"
AS_BUILT = ROOT / "tmp/pdfs/new-hope-live/as-builts.pdf"
GRAPH = ROOT / "apps/autosprink/src/data/new-hope-native-fab-attachment-graph.json"
SCHEDULE = ROOT / "apps/autosprink/src/data/new-hope-fabrication-end-schedule.json"
OUTPUT = ROOT / "apps/autosprink/src/data/new-hope-wet-welded-main-registration-evidence.json"
PROOF = ROOT / "apps/autosprink/src/data/proofs/new-hope-system-backbone/wet-welded-main-registration-source.png"

FIELD_SHA = "4A47F9A45256DEBB9E5185396BC15526532A3EF420BCBF40EC0BCC0DC5F902B5"
AS_BUILT_SHA = "ED00E9530C02217BC50EAD2FC3391938E731253949B728B31ED1336F8000F34B"
FAB_SHA = "A449B6C8670CEE52955C3D3D57F8169E3091CFA34C943C6723785724F06DDED9"
MEMBER_SHA = "0B64077B62673459C11D2CBC303258C1DD3F0C75735A07BFFA903BAEE79D6135"
LISTING_SHA = "2E01CB3C2C39289846DF0A17A758E6D1DE4F5A682ED139556BD864BF6F8BD734"
PDF_POINTS_PER_FOOT = 9.0
PLAN_ORIGIN = (660.674561, 1118.512451)
PLAN_CLIP = fitz.Rect(500, 530, 1615, 1885)
LABEL_DISTANCE_GATE_PT = 60.0
LABEL_CANDIDATE_UNIQUENESS_GAP_PT = 20.0
HEAVY_CUT_SPAN_GATE_IN = 3.0
ALTERNATE_CUT_SPAN_GATE_IN = 6.0
RED = (0.7529399991035461, 0.0, 0.0)
WHITE = (1.0, 1.0, 1.0)
HEAVY_WIDTH_BY_DIAMETER = {2.5: 2.06766, 3.0: 2.48119}
EXPECTED_LABEL_IDS = [
    *(f"CMA.{index:02d}" for index in range(1, 8)),
    *(f"CMB.{index:02d}" for index in range(1, 10)),
    "CMC.01", "CMC.02", "CMC.03", "CMC.05", "CMC.06", "CMC.08",
    "CMC.09", "CMC.11", "CMC.12", "CMC.13", "CMC.14", "CMC.15",
]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest().upper()


def rounded_box(word: tuple[object, ...]) -> list[float]:
    return [round(float(value), 6) for value in word[:4]]


def normalized_segment(a: fitz.Point, b: fitz.Point) -> tuple[float, float, float, float]:
    left = (round(a.x, 6), round(a.y, 6))
    right = (round(b.x, 6), round(b.y, 6))
    if right < left:
        left, right = right, left
    return left[0], left[1], right[0], right[1]


def plan_ft(point: list[float]) -> list[float]:
    return [
        round((point[0] - PLAN_ORIGIN[0]) / PDF_POINTS_PER_FOOT, 6),
        round((point[1] - PLAN_ORIGIN[1]) / PDF_POINTS_PER_FOOT, 6),
    ]


def distance_to_segment(point: tuple[float, float], centerline: dict[str, object]) -> float:
    px, py = point
    x1, y1 = centerline["fromPdfPt"]
    x2, y2 = centerline["toPdfPt"]
    dx, dy = x2 - x1, y2 - y1
    denominator = dx * dx + dy * dy
    t = max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / denominator)) if denominator else 0.0
    return math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))


def extract_labels(page: fitz.Page) -> list[dict[str, object]]:
    words = page.get_text("words")
    labels = []
    for word in words:
        raw = word[4].strip()
        match = re.search(r"(CM[ABC]\.\d{2})$", raw)
        if not match:
            continue
        piece_id = match.group(1)
        if piece_id not in EXPECTED_LABEL_IDS:
            continue
        row = {
            "pieceId": piece_id,
            "lineName": piece_id[:3],
            "rawSourceText": raw,
            "pieceLabelBoxPdfPt": rounded_box(word),
            "sourceBlock": int(word[5]),
        }
        if piece_id in {"CMC.06", "CMC.08"}:
            dimension_candidates = [
                candidate for candidate in words
                if int(candidate[5]) == int(word[5])
                and candidate[4].strip().startswith("9'-6")
                and (
                    (piece_id == "CMC.08" and candidate[4].strip().endswith("CMC.08"))
                    or (piece_id == "CMC.06" and not candidate[4].strip().endswith("CMC.08"))
                )
            ]
            if len(dimension_candidates) != 1:
                raise RuntimeError(f"{piece_id} must retain exactly one printed 9-foot 6-1/2-inch dimension word")
            dimension = dimension_candidates[0]
            row["printedDimensionEvidence"] = {
                "rawSourceText": dimension[4].strip(),
                "normalizedText": "9'-6 1/2\"",
                "dimensionIn": 114.5,
                "boxPdfPt": rounded_box(dimension),
            }
        labels.append(row)
    labels.sort(key=lambda row: row["pieceId"])
    if [row["pieceId"] for row in labels] != sorted(EXPECTED_LABEL_IDS):
        raise RuntimeError(f"welded-main label inventory changed: {[row['pieceId'] for row in labels]}")
    return labels


def in_plan(a: fitz.Point, b: fitz.Point) -> bool:
    return not (
        max(a.x, b.x) < 300 or min(a.x, b.x) > 1650
        or max(a.y, b.y) < 450 or min(a.y, b.y) > 1900
    )


def extract_heavy_red_centerlines(page: fitz.Page) -> list[dict[str, object]]:
    rows = []
    for drawing_index, drawing in enumerate(page.get_drawings()):
        width = round(float(drawing.get("width") or 0), 5)
        if drawing.get("fill") is not None or drawing.get("color") != RED or width not in set(HEAVY_WIDTH_BY_DIAMETER.values()):
            continue
        for item_index, item in enumerate(drawing["items"]):
            if item[0] != "l":
                continue
            a, b = item[1], item[2]
            length = math.hypot(b.x - a.x, b.y - a.y)
            if length < 0.1 or not in_plan(a, b):
                continue
            normalized = normalized_segment(a, b)
            rows.append({
                "drawingIndex": drawing_index,
                "itemIndex": item_index,
                "widthPt": width,
                "fromPdfPt": [normalized[0], normalized[1]],
                "toPdfPt": [normalized[2], normalized[3]],
                "normalized": normalized,
                "lengthPt": round(length, 6),
            })
    return rows


def extract_red_white_twin_centerlines(page: fitz.Page) -> list[dict[str, object]]:
    by_segment: dict[tuple[float, float, float, float], dict[str, list[dict[str, int]]]] = defaultdict(lambda: defaultdict(list))
    lengths: dict[tuple[float, float, float, float], float] = {}
    for drawing_index, drawing in enumerate(page.get_drawings()):
        color = drawing.get("color")
        if drawing.get("fill") is not None or color not in {RED, WHITE} or abs(float(drawing.get("width") or 0) - 0.01389) > 0.00001:
            continue
        color_name = "red" if color == RED else "white"
        for item_index, item in enumerate(drawing["items"]):
            if item[0] != "l":
                continue
            a, b = item[1], item[2]
            length = math.hypot(b.x - a.x, b.y - a.y)
            if length < 0.1 or not in_plan(a, b):
                continue
            normalized = normalized_segment(a, b)
            by_segment[normalized][color_name].append({"drawingIndex": drawing_index, "itemIndex": item_index})
            lengths[normalized] = length
    rows = []
    for normalized, colors in sorted(by_segment.items()):
        if set(colors) != {"red", "white"}:
            continue
        rows.append({
            "redDrawingIndex": colors["red"][0]["drawingIndex"],
            "redItemIndex": colors["red"][0]["itemIndex"],
            "whiteDrawingIndex": colors["white"][0]["drawingIndex"],
            "whiteItemIndex": colors["white"][0]["itemIndex"],
            "fromPdfPt": [normalized[0], normalized[1]],
            "toPdfPt": [normalized[2], normalized[3]],
            "normalized": normalized,
            "lengthPt": round(lengths[normalized], 6),
        })
    return rows


def source_centerline(row: dict[str, object], as_built: dict[str, object], alternate: bool) -> dict[str, object]:
    common = {
        "widthPt": 0.01389 if alternate else row["widthPt"],
        "representation": "red-white-twin-centerline" if alternate else "diameter-scaled-heavy-red-centerline",
        "fromPdfPt": row["fromPdfPt"],
        "toPdfPt": row["toPdfPt"],
        "fromPlanFt": plan_ft(row["fromPdfPt"]),
        "toPlanFt": plan_ft(row["toPdfPt"]),
    }
    if alternate:
        return {
            **common,
            "fieldRedDrawingIndex": row["redDrawingIndex"],
            "fieldWhiteDrawingIndex": row["whiteDrawingIndex"],
            "asBuiltRedDrawingIndex": as_built["redDrawingIndex"],
            "asBuiltWhiteDrawingIndex": as_built["whiteDrawingIndex"],
            "redItemIndex": row["redItemIndex"],
            "whiteItemIndex": row["whiteItemIndex"],
        }
    return {
        **common,
        "fieldDrawingIndex": row["drawingIndex"],
        "asBuiltDrawingIndex": as_built["drawingIndex"],
        "itemIndex": row["itemIndex"],
    }


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    path = Path("C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf")
    return ImageFont.truetype(str(path), size) if path.exists() else ImageFont.load_default()


def render_proof(page: fitz.Page, mappings: list[dict[str, object]], metrics: dict[str, object]) -> None:
    target_width = 1420
    scale = target_width / PLAN_CLIP.width
    pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), clip=PLAN_CLIP, alpha=False)
    plan = Image.open(io.BytesIO(pixmap.tobytes("png"))).convert("RGB")
    overlay = Image.new("RGBA", plan.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay, "RGBA")

    def local(point: list[float]) -> tuple[float, float]:
        return (point[0] - PLAN_CLIP.x0) * scale, (point[1] - PLAN_CLIP.y0) * scale

    for mapping in mappings:
        centerline = mapping["sourceCenterline"]
        a, b = local(centerline["fromPdfPt"]), local(centerline["toPdfPt"])
        alternate = centerline["representation"] == "red-white-twin-centerline"
        draw.line((*a, *b), fill=(182, 96, 255, 245) if alternate else (255, 168, 56, 230), width=8 if alternate else 6)
        box = mapping["pieceLabelBoxPdfPt"]
        x0, y0 = local(box[:2])
        x1, y1 = local(box[2:])
        draw.rectangle((x0 - 2, y0 - 2, x1 + 2, y1 + 2), outline=(52, 211, 153, 235), width=2)
    plan = Image.alpha_composite(plan.convert("RGBA"), overlay).convert("RGB")
    header = 132
    canvas = Image.new("RGB", (plan.width, plan.height + header), (3, 10, 18))
    canvas.paste(plan, (0, header))
    draw = ImageDraw.Draw(canvas)
    draw.text((20, 17), "New Hope FP1.0 - welded wet-main piece registration", font=font(31, True), fill=(244, 251, 255))
    draw.text((20, 57), "actual field PDF | orange = 25 diameter-scaled heavy centerlines | violet = 3 red/white-twin centerlines", font=font(17), fill=(173, 220, 238))
    draw.text((20, 86), f"{metrics['mappedLabeledUnitCount']}/28 labeled main pieces mapped | 99/169 global units mapped | three unlabeled T-1 typicals held", font=font(18, True), fill=(116, 255, 207))
    draw.text((20, 111), "Direction, grade, fitting takeout, installed Z, 67 threaded units, field routes, fabrication, quote, and release remain unresolved.", font=font(16), fill=(255, 210, 122))
    PROOF.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(PROOF, optimize=True)


def main() -> None:
    if sha256(FIELD) != FIELD_SHA or sha256(AS_BUILT) != AS_BUILT_SHA:
        raise RuntimeError("cached source PDFs do not match their protected hashes")
    graph = json.loads(GRAPH.read_text(encoding="utf-8"))
    schedule = json.loads(SCHEDULE.read_text(encoding="utf-8"))
    if graph["source"]["archiveSha256"] != FAB_SHA or graph["source"]["memberSha256"] != MEMBER_SHA or schedule["source"]["sha256"] != LISTING_SHA:
        raise RuntimeError("native FAB or approved listing identity changed")

    field_page = fitz.open(FIELD)[2]
    as_built_page = fitz.open(AS_BUILT)[2]
    field_labels = extract_labels(field_page)

    field_heavy = extract_heavy_red_centerlines(field_page)
    as_built_heavy = extract_heavy_red_centerlines(as_built_page)
    as_built_heavy_by_segment = {row["normalized"]: row for row in as_built_heavy}
    field_twins = extract_red_white_twin_centerlines(field_page)
    as_built_twins = extract_red_white_twin_centerlines(as_built_page)
    as_built_twins_by_segment = {row["normalized"]: row for row in as_built_twins}

    lines = {row["uniqueId"]: row for row in graph["records"]["lines"] if row["lineName"] in {"CMA", "CMB", "CMC"}}
    native_pipes: dict[str, dict[str, object]] = {}
    t1_records = []
    for pipe in graph["records"]["pipes"]:
        if pipe["parentId"] not in lines or pipe["itemCode"] != 137:
            continue
        piece_id = "T-1" if pipe["pieceName"] == "T-1" else f"{lines[pipe['parentId']]['lineName']}{pipe['pieceName']}"
        if piece_id == "T-1":
            t1_records.append(pipe)
        else:
            native_pipes[piece_id] = pipe
    if set(native_pipes) != set(EXPECTED_LABEL_IDS) or len(t1_records) != 3:
        raise RuntimeError("native welded-main definition inventory changed")

    listing_main = [row for row in schedule["weldedPieces"] if row["lineName"] in {"CMA", "CMB", "CMC"} or row["pieceId"] == "T-1"]
    if len(listing_main) != 29 or sum(row["quantity"] for row in listing_main) != 31 or next(row for row in listing_main if row["pieceId"] == "T-1")["quantity"] != 3:
        raise RuntimeError("approved welded-main listing quantity inventory changed")

    mappings = []
    used_segments = set()
    for label in field_labels:
        pipe = native_pipes[label["pieceId"]]
        nominal_diameter = {23: 2.5, 25: 3.0}[pipe["sizeCode"]]
        expected_width = HEAVY_WIDTH_BY_DIAMETER[nominal_diameter]
        box = label["pieceLabelBoxPdfPt"]
        point = ((box[0] + box[2]) / 2, (box[1] + box[3]) / 2)
        heavy_candidates = []
        for centerline in field_heavy:
            delta_in = pipe["lengthFt"] * 12 - centerline["lengthPt"] / PDF_POINTS_PER_FOOT * 12
            distance = distance_to_segment(point, centerline)
            if centerline["widthPt"] == expected_width and 0 <= delta_in <= HEAVY_CUT_SPAN_GATE_IN and distance <= LABEL_DISTANCE_GATE_PT and centerline["normalized"] in as_built_heavy_by_segment:
                heavy_candidates.append((distance, delta_in, centerline))
        alternate = False
        candidates = heavy_candidates
        if not candidates:
            alternate = True
            candidates = []
            for centerline in field_twins:
                delta_in = pipe["lengthFt"] * 12 - centerline["lengthPt"] / PDF_POINTS_PER_FOOT * 12
                distance = distance_to_segment(point, centerline)
                if 0 <= delta_in <= ALTERNATE_CUT_SPAN_GATE_IN and distance <= LABEL_DISTANCE_GATE_PT and centerline["normalized"] in as_built_twins_by_segment:
                    candidates.append((distance, delta_in, centerline))
        candidates.sort(key=lambda row: (row[0], row[1], row[2]["normalized"]))
        if not candidates:
            raise RuntimeError(f"{label['pieceId']} has no source centerline candidate")
        uniqueness_gap = candidates[1][0] - candidates[0][0] if len(candidates) > 1 else None
        if uniqueness_gap is not None and uniqueness_gap < LABEL_CANDIDATE_UNIQUENESS_GAP_PT:
            raise RuntimeError(f"{label['pieceId']} source centerline association is not unique: gap={uniqueness_gap}")
        distance, delta_in, centerline = candidates[0]
        if centerline["normalized"] in used_segments:
            raise RuntimeError(f"source centerline reused by {label['pieceId']}")
        used_segments.add(centerline["normalized"])
        as_built = (as_built_twins_by_segment if alternate else as_built_heavy_by_segment)[centerline["normalized"]]
        if delta_in > HEAVY_CUT_SPAN_GATE_IN and label["pieceId"] not in {"CMC.06", "CMC.08"}:
            raise RuntimeError(f"unsupported large fitting-takeout span delta for {label['pieceId']}")
        mappings.append({
            "instanceId": label["pieceId"],
            **label,
            "nativePipeUniqueId": pipe["uniqueId"],
            "nativeCutLengthFt": pipe["lengthFt"],
            "nativeNominalDiameterIn": nominal_diameter,
            "sourceCenterline": source_centerline(centerline, as_built, alternate),
            "pieceLabelToCenterlineDistancePt": round(distance, 6),
            "pieceLabelCenterlineUniquenessGapPt": round(uniqueness_gap, 6) if uniqueness_gap is not None else None,
            "sourceCenterlineVsCutSpanDeltaIn": round(delta_in, 6),
            "mappingBasis": "exact-field-as-built-label-native-cut-length-and-diameter-scaled-centerline" if not alternate else "exact-field-as-built-label-native-cut-length-and-red-white-twin-centerline",
            "nativeStationDirection": None,
            "nativeStationDirectionStatus": "unresolved",
        })
    mappings.sort(key=lambda row: row["instanceId"])
    holdouts = [
        {
            "instanceId": f"T-1-{pipe['uniqueId']}",
            "pieceId": "T-1",
            "lineName": "CMC",
            "nativePipeUniqueId": pipe["uniqueId"],
            "nativeCutLengthFt": pipe["lengthFt"],
            "nativeNominalDiameterIn": 3.0,
            "reason": "typical-definition-has-no-distinct-source-label-or-occurrence-station",
        }
        for pipe in sorted(t1_records, key=lambda row: row["uniqueId"])
    ]
    metrics = {
        "weldedMainDefinitionCount": 29,
        "weldedMainListedUnitCount": 31,
        "exactFieldPieceLabelCount": len(field_labels),
        "mappedLabeledUnitCount": len(mappings),
        "mappedHeavyCenterlineCount": sum(row["sourceCenterline"]["representation"] == "diameter-scaled-heavy-red-centerline" for row in mappings),
        "mappedAlternateCenterlineCount": sum(row["sourceCenterline"]["representation"] == "red-white-twin-centerline" for row in mappings),
        "unlabeledTypicalHoldoutCount": len(holdouts),
        "maxPieceLabelToCenterlineDistancePt": max(row["pieceLabelToCenterlineDistancePt"] for row in mappings),
        "maxSourceCenterlineVsCutSpanDeltaIn": max(row["sourceCenterlineVsCutSpanDeltaIn"] for row in mappings),
        "globalListedUnitCount": 169,
        "priorMappedWeldedBranchUnitCount": 71,
        "combinedMappedUnitCount": 71 + len(mappings),
        "globalPieceVectorUnmappedUnitCount": 169 - 71 - len(mappings),
        "threadedHoldoutCount": 67,
    }
    if metrics["mappedLabeledUnitCount"] != 28 or metrics["mappedHeavyCenterlineCount"] != 25 or metrics["mappedAlternateCenterlineCount"] != 3 or metrics["unlabeledTypicalHoldoutCount"] != 3 or metrics["combinedMappedUnitCount"] != 99 or metrics["globalPieceVectorUnmappedUnitCount"] != 70:
        raise RuntimeError(f"welded-main mapping coverage changed: {metrics}")

    evidence = {
        "artifactType": "halofire.new-hope-wet-welded-main-registration-evidence.v1",
        "projectId": "new-hope-crisis-center-brigham-city-ut",
        "sources": {
            "fieldInstall": {"fileName": "24-052_NHCC_INSTALL PLAN.pdf", "sheet": "FP1.0", "physicalPage": 3, "sha256": FIELD_SHA},
            "asBuilt": {"fileName": "New Hope BGC - Brigham City UT_as builts.pdf", "sheet": "FP1.0", "physicalPage": 3, "sha256": AS_BUILT_SHA},
            "nativeFab": {"archiveSha256": FAB_SHA, "memberSha256": MEMBER_SHA},
            "approvedListing": {"sha256": LISTING_SHA},
        },
        "registration": {
            "pdfPointsPerFoot": PDF_POINTS_PER_FOOT,
            "planOriginPdfPt": list(PLAN_ORIGIN),
            "pieceLabelCenterlineDistanceGatePt": LABEL_DISTANCE_GATE_PT,
            "pieceLabelCenterlineUniquenessGapPt": LABEL_CANDIDATE_UNIQUENESS_GAP_PT,
            "heavyCutSpanGateIn": HEAVY_CUT_SPAN_GATE_IN,
            "alternateCutSpanGateIn": ALTERNATE_CUT_SPAN_GATE_IN,
            "heavyCenterlineWidthByNominalDiameterIn": {"2.5": 2.06766, "3": 2.48119},
        },
        "mappings": mappings,
        "holdouts": holdouts,
        "metrics": metrics,
        "claims": {
            "fieldWeldedMainLabelInventoryReady": True,
            "fieldAsBuiltWeldedMainCenterlineParityReady": True,
            "weldedMainLabeledPieceToPlanMappingReady": True,
            "completeWeldedMainPieceToPlanMappingReady": False,
            "pieceToPlanVectorMappingReady": False,
            "nativeStationDirectionReady": False,
            "hydraulicFlowDirectionReady": False,
            "gradeReady": False,
            "fittingTakeoutReady": False,
            "installedElevationReady": False,
            "fabricationReady": False,
            "fieldReleaseReady": False,
        },
    }
    OUTPUT.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8", newline="\n")
    render_proof(field_page, mappings, metrics)
    print(f"wrote {OUTPUT} ({len(mappings)} mapped; {len(holdouts)} held)")
    print(f"wrote {PROOF}")


if __name__ == "__main__":
    main()

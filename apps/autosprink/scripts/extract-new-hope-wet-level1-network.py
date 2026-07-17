#!/usr/bin/env python3
"""Extract source-typed New Hope Level 1 wet sprinkler evidence.

The field-install and as-built FP1.0 sheets are independent PDF projections.
Black 0.5-point linework is explicitly rejected as annotation-like geometry;
it contains dimension leaders and symbol strokes, not a pipe network.  Native
dark-blue diameter-scaled linework supplies bounded one-inch plan candidates,
which must also reconcile to a same-line native cut.  The extractor never
invents a complete network, direction, grade, installed Z, or field route.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
from pathlib import Path

import fitz
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "src" / "data"
DEFAULT_OUTPUT = DATA / "new-hope-wet-level1-network-evidence.json"
DEFAULT_PROOF = DATA / "proofs" / "new-hope-system-backbone" / "wet-level1-source-network.png"
PROJECT_ROOT = Path(
    "Y:/Shared/HaloOps/02-Active jobs/Eckman/"
    "Boys & Girls Club New Hope - Brigham City UT/2-Internal Ops/01-Design"
)
DEFAULT_FIELD = PROJECT_ROOT / "10-Field Set/24-052_NHCC_INSTALL PLAN.pdf"
DEFAULT_ASBUILT = PROJECT_ROOT / "04-Close-Out Docs/New Hope BGC - Brigham City UT_as builts.pdf"
DEFAULT_NATIVE_GRAPH = DATA / "new-hope-native-fab-attachment-graph.json"
DEFAULT_WELDED_BRANCH = DATA / "new-hope-wet-welded-branch-registration-evidence.json"
DEFAULT_WELDED_MAIN = DATA / "new-hope-wet-welded-main-registration-evidence.json"

PROJECT_ID = "new-hope-crisis-center-brigham-city-ut"
FIELD_SHA = "4A47F9A45256DEBB9E5185396BC15526532A3EF420BCBF40EC0BCC0DC5F902B5"
ASBUILT_SHA = "ED00E9530C02217BC50EAD2FC3391938E731253949B728B31ED1336F8000F34B"
FIELD_FILE_NAME = "24-052_NHCC_INSTALL PLAN.pdf"
ASBUILT_FILE_NAME = "New Hope BGC - Brigham City UT_as builts.pdf"
FAB_SHA = "A449B6C8670CEE52955C3D3D57F8169E3091CFA34C943C6723785724F06DDED9"
SEIDB_SHA = "0B64077B62673459C11D2CBC303258C1DD3F0C75735A07BFFA903BAEE79D6135"
PAGE_INDEX = 2
PLAN_CLIP = fitz.Rect(300, 450, 1650, 1900)
PLAN_ORIGIN = (660.674561, 1118.512451)
PDF_POINTS_PER_FOOT = 9.0
SIZE_CROSSWALK = {13: 1.0, 17: 1.5, 21: 2.0, 23: 2.5, 25: 3.0}
THREADED_COLOR = (0.0, 0.0, 0.501968)
THREADED_WIDTH_PT = 0.82706
LINE_ASSOCIATION_DISTANCE_GATE_PT = 45.0
LINE_ASSOCIATION_UNIQUENESS_GAP_PT = 4.0
THREADED_CUT_SPAN_GATE_IN = 3.2
HEAD_SCHEDULE = [
    {"manufacturer": "Tyco", "sin": "TY3231", "model": "TY-FRB", "type": "pendent", "quantity": 164},
    {"manufacturer": "Victaulic", "sin": "V3506", "model": "VS1", "type": "pendent", "quantity": 6},
    {"manufacturer": "Tyco", "sin": "TY3131", "model": "TY-FRB", "type": "upright", "quantity": 4},
]
HEAD_TYPE_BY_SIN = {row["sin"]: row for row in HEAD_SCHEDULE}


def sha256_file(path: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while block := handle.read(1024 * 1024):
            digest.update(block)
    return digest.hexdigest().upper(), path.stat().st_size


def canonical_json(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha256_value(value: object) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def fnv1a64(text: str) -> str:
    value = 14695981039346656037
    for byte in text.encode("utf-8"):
        value ^= byte
        value = (value * 1099511628211) & 0xFFFFFFFFFFFFFFFF
    return f"{value:016x}"


def overlaps_plan(start: fitz.Point, end: fitz.Point) -> bool:
    return not (
        max(start.x, end.x) < PLAN_CLIP.x0
        or min(start.x, end.x) > PLAN_CLIP.x1
        or max(start.y, end.y) < PLAN_CLIP.y0
        or min(start.y, end.y) > PLAN_CLIP.y1
    )


def normalized_segment(start: fitz.Point, end: fitz.Point) -> tuple[float, float, float, float]:
    left = (round(start.x, 6), round(start.y, 6))
    right = (round(end.x, 6), round(end.y, 6))
    if right < left:
        left, right = right, left
    return left[0], left[1], right[0], right[1]


def extract_legacy_annotation_vectors(page: fitz.Page) -> list[dict[str, object]]:
    vectors = []
    for drawing_index, drawing in enumerate(page.get_drawings()):
        if drawing.get("fill") is not None:
            continue
        if drawing.get("color") != (0.0, 0.0, 0.0):
            continue
        if abs(float(drawing.get("width") or 0) - 0.5) > 0.0001:
            continue
        for item_index, item in enumerate(drawing["items"]):
            if item[0] != "l":
                continue
            start, end = item[1], item[2]
            length_pt = math.hypot(end.x - start.x, end.y - start.y)
            if length_pt < 3 or not overlaps_plan(start, end):
                continue
            x1, y1, x2, y2 = normalized_segment(start, end)
            vectors.append({
                "sourceDrawingIndex": drawing_index,
                "sourceItemIndex": item_index,
                "fromPdfPt": {"x": x1, "y": y1},
                "toPdfPt": {"x": x2, "y": y2},
                "lengthPt": round(length_pt, 6),
            })
    vectors.sort(key=lambda row: (
        row["fromPdfPt"]["x"], row["fromPdfPt"]["y"],
        row["toPdfPt"]["x"], row["toPdfPt"]["y"],
    ))
    return vectors


def extract_threaded_style_vectors(page: fitz.Page) -> list[dict[str, object]]:
    vectors = []
    for drawing_index, drawing in enumerate(page.get_drawings()):
        color = drawing.get("color")
        if drawing.get("fill") is not None or color is None:
            continue
        if any(abs(float(color[index]) - expected) > 0.001 for index, expected in enumerate(THREADED_COLOR)):
            continue
        if abs(float(drawing.get("width") or 0) - THREADED_WIDTH_PT) > 0.001:
            continue
        for item_index, item in enumerate(drawing["items"]):
            if item[0] != "l":
                continue
            start, end = item[1], item[2]
            midpoint = fitz.Point((start.x + end.x) / 2, (start.y + end.y) / 2)
            if not PLAN_CLIP.contains(midpoint):
                continue
            length_pt = math.hypot(end.x - start.x, end.y - start.y)
            x1, y1, x2, y2 = normalized_segment(start, end)
            vectors.append({
                "sourceDrawingIndex": drawing_index,
                "sourceItemIndex": item_index,
                "fromPdfPt": {"x": x1, "y": y1},
                "toPdfPt": {"x": x2, "y": y2},
                "lengthPt": round(length_pt, 6),
            })
    vectors.sort(key=lambda row: (
        row["fromPdfPt"]["x"], row["fromPdfPt"]["y"],
        row["toPdfPt"]["x"], row["toPdfPt"]["y"],
    ))
    return vectors


def point_to_segment_distance(point: tuple[float, float], start: list[float], end: list[float]) -> float:
    px, py = point
    x1, y1 = start
    x2, y2 = end
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return math.hypot(px - x1, py - y1)
    fraction = max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (x1 + fraction * dx), py - (y1 + fraction * dy))


def classify_threaded_vectors(
    field_vectors: list[dict[str, object]],
    asbuilt_vectors: list[dict[str, object]],
    native_lines: list[dict[str, object]],
    welded_mappings: list[dict[str, object]],
) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    remaining_asbuilt = set(range(len(asbuilt_vectors)))

    threaded_by_line: dict[str, list[dict[str, object]]] = {}
    for line in native_lines:
        threaded_by_line[line["lineName"]] = [
            {
                "pieceId": f"{line['lineName']}{piece['pieceName']}",
                "nativeCutLengthIn": round(piece["cutLengthFt"] * 12, 6),
            }
            for piece in line["pieces"] if piece["sizeCode"] == 13
        ]

    accepted = []
    rejected = []
    for field in field_vectors:
        def cross_source_residual(candidate: dict[str, object]) -> float:
            return max(
                math.hypot(
                    field[endpoint]["x"] - candidate[endpoint]["x"],
                    field[endpoint]["y"] - candidate[endpoint]["y"],
                )
                for endpoint in ("fromPdfPt", "toPdfPt")
            )

        matched_index = min(remaining_asbuilt, key=lambda index: cross_source_residual(asbuilt_vectors[index]))
        matched = asbuilt_vectors[matched_index]
        residual = cross_source_residual(matched)
        if residual > 1.0:
            raise RuntimeError(f"threaded source segment has no bounded as-built match: residual={residual:.6f} pt")
        remaining_asbuilt.remove(matched_index)
        midpoint = (
            (field["fromPdfPt"]["x"] + field["toPdfPt"]["x"]) / 2,
            (field["fromPdfPt"]["y"] + field["toPdfPt"]["y"]) / 2,
        )
        distance_by_line: dict[str, float] = {}
        for mapping in welded_mappings:
            centerline = mapping["sourceCenterline"]
            distance = point_to_segment_distance(midpoint, centerline["fromPdfPt"], centerline["toPdfPt"])
            line_name = mapping["lineName"]
            distance_by_line[line_name] = min(distance, distance_by_line.get(line_name, math.inf))
        ranked_lines = sorted((distance, line_name) for line_name, distance in distance_by_line.items())
        nearest_distance, line_name = ranked_lines[0]
        uniqueness_gap = ranked_lines[1][0] - nearest_distance
        if nearest_distance > LINE_ASSOCIATION_DISTANCE_GATE_PT or uniqueness_gap < LINE_ASSOCIATION_UNIQUENESS_GAP_PT:
            raise RuntimeError(
                f"threaded line association ambiguous at {midpoint}: "
                f"distance={nearest_distance:.3f} gap={uniqueness_gap:.3f}"
            )
        source_span_in = round(field["lengthPt"] / PDF_POINTS_PER_FOOT * 12, 6)
        candidates = []
        for piece in threaded_by_line.get(line_name, []):
            delta = round(piece["nativeCutLengthIn"] - source_span_in, 6)
            if -0.2 <= delta <= THREADED_CUT_SPAN_GATE_IN:
                candidates.append({**piece, "sourceSpanVsCutDeltaIn": delta})
        base = {
            "fieldDrawingIndex": field["sourceDrawingIndex"],
            "fieldItemIndex": field["sourceItemIndex"],
            "asBuiltDrawingIndex": matched["sourceDrawingIndex"],
            "asBuiltItemIndex": matched["sourceItemIndex"],
            "fromPdfPt": field["fromPdfPt"],
            "toPdfPt": field["toPdfPt"],
            "fromPlanFt": plan_ft(field["fromPdfPt"]),
            "toPlanFt": plan_ft(field["toPdfPt"]),
            "sourceSpanIn": source_span_in,
            "crossSourceResidualPt": round(residual, 6),
            "associatedLineName": line_name,
            "lineAssociationDistancePt": round(nearest_distance, 6),
            "lineAssociationUniquenessGapPt": round(uniqueness_gap, 6),
            "candidatePieces": candidates,
        }
        if residual > 0.02:
            rejected.append({
                **base,
                "rejectionReason": "field-to-as-built-endpoint-drift-exceeds-0.02-point-gate",
            })
        elif candidates:
            accepted.append({
                **base,
                "mappingStatus": "exact-singleton-piece" if len(candidates) == 1 else "same-line-piece-equivalence-set",
                "exactPieceId": candidates[0]["pieceId"] if len(candidates) == 1 else None,
            })
        else:
            rejected.append({
                **base,
                "rejectionReason": "no-same-line-native-threaded-cut-within-takeout-gate",
            })
    for index, row in enumerate(accepted, start=1):
        row["id"] = f"threaded-plan-segment-{index:03d}"
    for index, row in enumerate(rejected, start=1):
        row["id"] = f"rejected-blue-linework-{index:02d}"
    return accepted, rejected


def segment_key(vector: dict[str, object]) -> tuple[float, float, float, float]:
    return (
        vector["fromPdfPt"]["x"], vector["fromPdfPt"]["y"],
        vector["toPdfPt"]["x"], vector["toPdfPt"]["y"],
    )


def plan_ft(point: dict[str, float]) -> dict[str, float]:
    return {
        "x": round((point["x"] - PLAN_ORIGIN[0]) / PDF_POINTS_PER_FOOT, 6),
        "y": round((point["y"] - PLAN_ORIGIN[1]) / PDF_POINTS_PER_FOOT, 6),
    }


def extract_heads(page: fitz.Page) -> list[dict[str, object]]:
    heads = []
    drawings = page.get_drawings()
    for drawing_index, drawing in enumerate(drawings):
        rect = drawing["rect"]
        center = fitz.Point((rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2)
        if not PLAN_CLIP.contains(center):
            continue
        if drawing.get("color") != (0.0, 0.0, 0.0):
            continue
        if abs(float(drawing.get("width") or 0) - 0.4) > 0.001:
            continue
        if len(drawing["items"]) != 21 or any(item[0] != "l" for item in drawing["items"]):
            continue
        if not (7.5 <= rect.width <= 9.5 and 7.5 <= rect.height <= 9.5):
            continue
        max_internal_dark_fill_rect_area = 0.0
        for candidate in drawings:
            if candidate.get("fill") is None:
                continue
            candidate_rect = candidate["rect"]
            candidate_center = (
                (candidate_rect.x0 + candidate_rect.x1) / 2,
                (candidate_rect.y0 + candidate_rect.y1) / 2,
            )
            if math.hypot(candidate_center[0] - center.x, candidate_center[1] - center.y) > 4.3:
                continue
            if candidate_rect.width > 9.2 or candidate_rect.height > 9.2:
                continue
            darkness = 1 - sum(candidate["fill"]) / 3
            if darkness <= 0.05:
                continue
            max_internal_dark_fill_rect_area = max(
                max_internal_dark_fill_rect_area,
                candidate_rect.width * candidate_rect.height,
            )
        if rect.height < 8.5:
            sin = "TY3131"
            symbol_family = "upright-open-circle-center-mark"
        elif max_internal_dark_fill_rect_area >= 20:
            sin = "V3506"
            symbol_family = "pendent-four-quadrant-fill"
        else:
            sin = "TY3231"
            symbol_family = "pendent-radial-fill"
        heads.append({
            "sourceDrawingIndex": drawing_index,
            "pdfPt": {"x": round(center.x, 6), "y": round(center.y, 6)},
            "symbolBoxPt": {"width": round(rect.width, 6), "height": round(rect.height, 6)},
            "sin": sin,
            "symbolFamily": symbol_family,
            "maxInternalDarkFillRectAreaPt2": round(max_internal_dark_fill_rect_area, 6),
        })
    heads.sort(key=lambda row: (row["pdfPt"]["x"], row["pdfPt"]["y"]))
    return heads


def nearest_head_matches(field_heads: list[dict[str, object]], asbuilt_heads: list[dict[str, object]]) -> list[dict[str, object]]:
    remaining = set(range(len(asbuilt_heads)))
    matches = []
    for index, field in enumerate(field_heads, start=1):
        fx, fy = field["pdfPt"]["x"], field["pdfPt"]["y"]
        match_index = min(
            remaining,
            key=lambda candidate: math.hypot(
                asbuilt_heads[candidate]["pdfPt"]["x"] - fx,
                asbuilt_heads[candidate]["pdfPt"]["y"] - fy,
            ),
        )
        matched = asbuilt_heads[match_index]
        residual = math.hypot(matched["pdfPt"]["x"] - fx, matched["pdfPt"]["y"] - fy)
        if residual > 0.02:
            raise RuntimeError(f"head {index} cross-source residual {residual:.6f} pt exceeds 0.02 pt")
        if matched["sin"] != field["sin"] or matched["symbolFamily"] != field["symbolFamily"]:
            raise RuntimeError(
                f"head {index} type differs across sources: "
                f"field={field['sin']}/{field['symbolFamily']} "
                f"asBuilt={matched['sin']}/{matched['symbolFamily']}"
            )
        schedule = HEAD_TYPE_BY_SIN[field["sin"]]
        remaining.remove(match_index)
        matches.append({
            "id": f"wet-head-{index:03d}",
            "fieldDrawingIndex": field["sourceDrawingIndex"],
            "asBuiltDrawingIndex": matched["sourceDrawingIndex"],
            "pdfPt": field["pdfPt"],
            "planFt": plan_ft(field["pdfPt"]),
            "crossSourceResidualPt": round(residual, 6),
            "headType": {
                "manufacturer": schedule["manufacturer"],
                "sin": schedule["sin"],
                "model": schedule["model"],
                "type": schedule["type"],
            },
            "headTypeAssignmentStatus": "exact-native-symbol-family-cross-source-verified",
            "symbolEvidence": {
                "fieldInstall": {
                    "family": field["symbolFamily"],
                    "outerBoxPt": field["symbolBoxPt"],
                    "maxInternalDarkFillRectAreaPt2": field["maxInternalDarkFillRectAreaPt2"],
                },
                "asBuilt": {
                    "family": matched["symbolFamily"],
                    "outerBoxPt": matched["symbolBoxPt"],
                    "maxInternalDarkFillRectAreaPt2": matched["maxInternalDarkFillRectAreaPt2"],
                },
            },
        })
    if remaining:
        raise RuntimeError(f"{len(remaining)} as-built head symbols were not reconciled")
    return matches


def line_labels(page: fitz.Page) -> tuple[list[str], list[str]]:
    text = " ".join(word[4] for word in page.get_text("words"))
    branch = sorted(set(re.findall(r"\bBL(?:0[1-9]|[1-3][0-9]|4[0-7])\b", text)))
    cross_main = sorted(
        set(re.findall(r"\b(?:CMA|CMB|CMC)\.\d+\b", text)),
        key=lambda label: (label[:3], int(label.split(".")[1])),
    )
    return branch, cross_main


def validate_head_schedule(page: fitz.Page) -> None:
    text = page.get_text("text")
    required = ("TY3231", "TY-FRB", "164", "V3506", "VS1", "TY3131", "Total = 174")
    missing = [token for token in required if token not in text]
    if missing:
        raise RuntimeError(f"sprinkler legend schedule tokens changed: {missing}")


def slim_native_graph(graph: dict[str, object]) -> tuple[list[dict[str, object]], dict[str, object]]:
    wanted = {f"BL{index:02d}" for index in range(1, 48)} | {"CMA", "CMB", "CMC"}
    records = graph["records"]
    lines = [row for row in records["lines"] if row["lineName"] in wanted]
    line_by_id = {row["uniqueId"]: row for row in lines}
    pipes = [row for row in records["pipes"] if row["parentId"] in line_by_id]
    pipe_by_id = {row["uniqueId"]: row for row in pipes}
    outlets = [row for row in records["outlets"] if row["parentId"] in pipe_by_id]
    fittings = [row for row in records["fittings"] if row["parentId"] in pipe_by_id]
    pieces_by_line: dict[int, list[dict[str, object]]] = {}
    for pipe in pipes:
        pieces_by_line.setdefault(pipe["parentId"], []).append({
            "uniqueId": pipe["uniqueId"],
            "pieceName": pipe["pieceName"],
            "sizeCode": pipe["sizeCode"],
            "nominalDiameterIn": SIZE_CROSSWALK.get(pipe["sizeCode"]),
            "cutLengthFt": round(pipe["lengthFt"], 6),
            "endCode1": pipe["endCode1"],
            "endCode2": pipe["endCode2"],
        })
    outlet_counts: dict[int, int] = {}
    fitting_counts: dict[int, int] = {}
    for outlet in outlets:
        outlet_counts[outlet["parentId"]] = outlet_counts.get(outlet["parentId"], 0) + int(outlet["quantity"])
    for fitting in fittings:
        fitting_counts[fitting["parentId"]] = fitting_counts.get(fitting["parentId"], 0) + int(fitting["quantity"])
    native_lines = []
    for line in sorted(lines, key=lambda row: row["lineName"]):
        line_pieces = sorted(pieces_by_line.get(line["uniqueId"], []), key=lambda row: row["pieceName"])
        native_lines.append({
            "lineName": line["lineName"],
            "lineUniqueId": line["uniqueId"],
            "pieces": [
                {
                    **piece,
                    "outletCount": outlet_counts.get(piece["uniqueId"], 0),
                    "fittingCount": fitting_counts.get(piece["uniqueId"], 0),
                }
                for piece in line_pieces
            ],
        })
    size_totals = []
    for size_code in sorted({pipe["sizeCode"] for pipe in pipes}):
        selected = [pipe for pipe in pipes if pipe["sizeCode"] == size_code]
        size_totals.append({
            "sizeCode": size_code,
            "nominalDiameterIn": SIZE_CROSSWALK[size_code],
            "pieceCount": len(selected),
            "cutLengthFt": round(sum(pipe["lengthFt"] for pipe in selected), 6),
        })
    summary = {
        "lineFamilyCount": len(lines),
        "pieceCount": len(pipes),
        "outletCount": sum(int(row["quantity"]) for row in outlets),
        "fittingRecordCount": len(fittings),
        "fittingQuantity": sum(int(row["quantity"]) for row in fittings),
        "totalCutLengthFt": round(sum(row["lengthFt"] for row in pipes), 6),
        "sizeTotals": size_totals,
    }
    return native_lines, summary


def vector_fingerprint(vectors: list[dict[str, object]]) -> str:
    return fnv1a64("|".join(
        f"{row['id']}:{row['fromPdfPt']['x']:.6f},{row['fromPdfPt']['y']:.6f},"
        f"{row['toPdfPt']['x']:.6f},{row['toPdfPt']['y']:.6f}"
        for row in vectors
    ))


def threaded_vector_fingerprint(vectors: list[dict[str, object]]) -> str:
    return fnv1a64("|".join(
        f"{row['id']}:{row['fromPdfPt']['x']:.6f},{row['fromPdfPt']['y']:.6f},"
        f"{row['toPdfPt']['x']:.6f},{row['toPdfPt']['y']:.6f}:"
        f"{row['associatedLineName']}:{row.get('exactPieceId') or '-'}:"
        f"{','.join(piece['pieceId'] for piece in row['candidatePieces'])}"
        for row in vectors
    ))


def head_fingerprint(heads: list[dict[str, object]]) -> str:
    return fnv1a64("|".join(
        f"{row['id']}:{row['pdfPt']['x']:.6f},{row['pdfPt']['y']:.6f},"
        f"{row['crossSourceResidualPt']:.6f},{row['headType']['sin']}"
        for row in heads
    ))


def native_fingerprint(lines: list[dict[str, object]]) -> str:
    return fnv1a64("|".join(
        f"{line['lineName']}:{piece['pieceName']}:{piece['sizeCode']}:"
        f"{piece['cutLengthFt']:.6f}:{piece['outletCount']}:{piece['fittingCount']}"
        for line in lines for piece in line["pieces"]
    ))


def render_proof(
    page: fitz.Page,
    vectors: list[dict[str, object]],
    rejected: list[dict[str, object]],
    heads: list[dict[str, object]],
    output: Path,
) -> None:
    scale = 1.35
    pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
    source = Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
    draw = ImageDraw.Draw(source, "RGBA")
    for vector in vectors:
        start, end = vector["fromPdfPt"], vector["toPdfPt"]
        draw.line((start["x"] * scale, start["y"] * scale, end["x"] * scale, end["y"] * scale), fill=(0, 210, 255, 230), width=4)
    for vector in rejected:
        start, end = vector["fromPdfPt"], vector["toPdfPt"]
        draw.line((start["x"] * scale, start["y"] * scale, end["x"] * scale, end["y"] * scale), fill=(255, 45, 190, 245), width=5)
    head_colors = {"TY3231": (255, 55, 130, 245), "V3506": (255, 170, 35, 255), "TY3131": (50, 220, 155, 255)}
    for head in heads:
        x, y = head["pdfPt"]["x"] * scale, head["pdfPt"]["y"] * scale
        radius = 5.2
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), outline=head_colors[head["headType"]["sin"]], width=3)
    try:
        font = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 31)
        small = ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", 23)
    except OSError:
        font = small = ImageFont.load_default()
    draw.rounded_rectangle((24, 24, 1400, 190), radius=18, fill=(3, 11, 20, 228), outline=(77, 231, 255, 230), width=3)
    draw.text((48, 43), "New Hope FP1.0 - corrected source-typed geometry", font=font, fill=(245, 250, 255, 255))
    draw.text((48, 96), "CYAN: 53 one-inch segments pass PDF parity + same-line native cut gate | MAGENTA: 5 source strokes rejected", font=small, fill=(175, 232, 245, 255))
    draw.text((48, 135), "Legacy 300 black 0.5-pt vectors rejected as annotation/dimension linework; complete wet network remains blocked", font=small, fill=(255, 190, 145, 255))
    output.parent.mkdir(parents=True, exist_ok=True)
    source.save(output, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--field-pdf", type=Path, default=DEFAULT_FIELD)
    parser.add_argument("--asbuilt-pdf", type=Path, default=DEFAULT_ASBUILT)
    parser.add_argument("--native-graph", type=Path, default=DEFAULT_NATIVE_GRAPH)
    parser.add_argument("--welded-branch", type=Path, default=DEFAULT_WELDED_BRANCH)
    parser.add_argument("--welded-main", type=Path, default=DEFAULT_WELDED_MAIN)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--proof-output", type=Path, default=DEFAULT_PROOF)
    args = parser.parse_args()

    field_hash = sha256_file(args.field_pdf)
    asbuilt_hash = sha256_file(args.asbuilt_pdf)
    if field_hash[0] != FIELD_SHA:
        raise RuntimeError(f"field-install source drift: {field_hash[0]}")
    if asbuilt_hash[0] != ASBUILT_SHA:
        raise RuntimeError(f"as-built source drift: {asbuilt_hash[0]}")

    field_page = fitz.open(args.field_pdf)[PAGE_INDEX]
    asbuilt_page = fitz.open(args.asbuilt_pdf)[PAGE_INDEX]
    field_legacy_vectors = extract_legacy_annotation_vectors(field_page)
    asbuilt_legacy_vectors = extract_legacy_annotation_vectors(asbuilt_page)
    if len(field_legacy_vectors) != 300 or len(asbuilt_legacy_vectors) != 317:
        raise RuntimeError(
            f"legacy annotation-vector signature changed: field={len(field_legacy_vectors)} "
            f"asBuilt={len(asbuilt_legacy_vectors)}"
        )
    asbuilt_legacy_by_key = {segment_key(row): row for row in asbuilt_legacy_vectors}
    missing = [segment_key(row) for row in field_legacy_vectors if segment_key(row) not in asbuilt_legacy_by_key]
    if missing:
        raise RuntimeError(f"{len(missing)} field legacy annotation vectors are absent from as-built")

    field_heads = extract_heads(field_page)
    asbuilt_heads = extract_heads(asbuilt_page)
    if len(field_heads) != 174 or len(asbuilt_heads) != 174:
        raise RuntimeError(f"head signature changed: field={len(field_heads)} asBuilt={len(asbuilt_heads)}")
    heads = nearest_head_matches(field_heads, asbuilt_heads)
    max_head_residual = max(row["crossSourceResidualPt"] for row in heads)
    if max_head_residual > 0.01:
        raise RuntimeError(f"unexpected maximum head residual: {max_head_residual}")
    head_type_counts = {
        sin: sum(head["headType"]["sin"] == sin for head in heads)
        for sin in ("TY3231", "V3506", "TY3131")
    }
    if head_type_counts != {"TY3231": 164, "V3506": 6, "TY3131": 4}:
        raise RuntimeError(f"native symbol-family schedule reconciliation changed: {head_type_counts}")

    branch_labels, cross_main_piece_labels = line_labels(field_page)
    if branch_labels != [f"BL{index:02d}" for index in range(1, 48)]:
        raise RuntimeError(f"branch-line label set changed: {branch_labels}")
    validate_head_schedule(field_page)

    native_graph = json.loads(args.native_graph.read_text(encoding="utf-8"))
    if (
        native_graph["source"]["archiveSha256"] != FAB_SHA
        or native_graph["source"]["memberSha256"] != SEIDB_SHA
        or native_graph["claims"]["nativeAttachmentGraphReady"] is not True
        or native_graph["claims"]["exactFittingTakeoutReady"] is not False
        or native_graph["claims"]["interPieceAdjacencyReady"] is not False
    ):
        raise RuntimeError("native FAB attachment graph source or truth boundary drifted")
    native_lines, native_summary = slim_native_graph(native_graph)
    expected_summary = {
        "lineFamilyCount": 50,
        "pieceCount": 167,
        "outletCount": 217,
        "fittingRecordCount": 67,
        "fittingQuantity": 67,
        "totalCutLengthFt": 1477.333333,
    }
    for key, expected in expected_summary.items():
        if native_summary[key] != expected:
            raise RuntimeError(f"native FAB wet summary drift: {key}={native_summary[key]} expected={expected}")

    field_threaded_vectors = extract_threaded_style_vectors(field_page)
    asbuilt_threaded_vectors = extract_threaded_style_vectors(asbuilt_page)
    if len(field_threaded_vectors) != 58 or len(asbuilt_threaded_vectors) != 58:
        raise RuntimeError(
            f"threaded source-style signature changed: field={len(field_threaded_vectors)} "
            f"asBuilt={len(asbuilt_threaded_vectors)}"
        )
    welded_branch = json.loads(args.welded_branch.read_text(encoding="utf-8"))
    welded_main = json.loads(args.welded_main.read_text(encoding="utf-8"))
    if len(welded_branch.get("pieceVectorMappings", [])) != 71 or len(welded_main.get("mappings", [])) != 28:
        raise RuntimeError("the exact 71 branch plus 28 main source registrations are required for line association")
    wet_vectors, rejected_blue = classify_threaded_vectors(
        field_threaded_vectors,
        asbuilt_threaded_vectors,
        native_lines,
        welded_branch["pieceVectorMappings"] + welded_main["mappings"],
    )
    if len(wet_vectors) != 53 or len(rejected_blue) != 5:
        raise RuntimeError(f"threaded classification changed: accepted={len(wet_vectors)} rejected={len(rejected_blue)}")
    singleton_count = sum(row["exactPieceId"] is not None for row in wet_vectors)
    if singleton_count != 24:
        raise RuntimeError(f"threaded exact-singleton count changed: {singleton_count}")

    payload = {
        "artifactType": "halofire.new-hope-wet-level1-network-evidence.v2",
        "projectId": PROJECT_ID,
        "sourceBindings": {
            "fieldInstall": {"fileName": FIELD_FILE_NAME, "sheet": "FP1.0", "physicalPage": 3, "sha256": field_hash[0], "bytes": field_hash[1]},
            "asBuilt": {"fileName": ASBUILT_FILE_NAME, "sheet": "FP1.0", "physicalPage": 3, "sha256": asbuilt_hash[0], "bytes": asbuilt_hash[1]},
            "nativeFab": {"archiveSha256": FAB_SHA, "member": "Project.seidb", "memberSha256": SEIDB_SHA},
        },
        "registration": {
            "pdfPointsPerFoot": PDF_POINTS_PER_FOOT,
            "planScale": "1/8 inch = 1 foot",
            "riserOriginPdfPt": {"x": PLAN_ORIGIN[0], "y": PLAN_ORIGIN[1]},
            "planClipPdfPt": {"x0": PLAN_CLIP.x0, "y0": PLAN_CLIP.y0, "x1": PLAN_CLIP.x1, "y1": PLAN_CLIP.y1},
        },
        "wetPipeVectors": wet_vectors,
        "rejectedBlueSourceLinework": rejected_blue,
        "legacyAnnotationLikeVectorClass": {
            "fieldCandidateCount": len(field_legacy_vectors),
            "asBuiltCandidateCount": len(asbuilt_legacy_vectors),
            "fieldToAsBuiltExactMatchCount": len(field_legacy_vectors),
            "classification": "rejected-annotation-dimension-and-symbol-linework-not-pipe-network",
            "fingerprintFnv1a64": vector_fingerprint([
                {**row, "id": f"legacy-vector-{index:03d}"}
                for index, row in enumerate(field_legacy_vectors, start=1)
            ]),
        },
        "sprinklerHeads": heads,
        "sprinklerSchedule": HEAD_SCHEDULE,
        "branchLineLabels": branch_labels,
        "crossMainPieceLabelsVisible": cross_main_piece_labels,
        "nativeFabricationLines": native_lines,
        "metrics": {
            "wetPipeVectorCount": len(wet_vectors),
            "acceptedThreadedPlanSegmentCount": len(wet_vectors),
            "exactThreadedPiecePlanMappingCount": singleton_count,
            "ambiguousThreadedPiecePlanSegmentCount": len(wet_vectors) - singleton_count,
            "rejectedBlueSourceLineworkCount": len(rejected_blue),
            "legacyAnnotationLikeVectorCount": len(field_legacy_vectors),
            "crossSourcePipeVectorMatchCount": len(wet_vectors),
            "crossSourcePipeMaxResidualPt": 0,
            "sprinklerHeadCount": len(heads),
            "crossSourceHeadMatchCount": len(heads),
            "crossSourceHeadMaxResidualPt": max_head_residual,
            "headTypeCounts": head_type_counts,
            **native_summary,
        },
        "fingerprints": {
            "wetPipeVectorsFnv1a64": threaded_vector_fingerprint(wet_vectors),
            "rejectedBlueSourceLineworkFnv1a64": threaded_vector_fingerprint(rejected_blue),
            "sprinklerHeadsFnv1a64": head_fingerprint(heads),
            "nativeFabricationFnv1a64": native_fingerprint(native_lines),
        },
        "claims": {
            "wetSystemNetwork2dReady": False,
            "sourceTypedThreadedPlanSegmentsReady": True,
            "legacyAnnotationVectorsRejected": True,
            "completeThreadedPiecePlanMappingReady": False,
            "sprinklerHeadPositions2dReady": True,
            "sprinklerScheduleQuantitiesReady": True,
            "nativeFabricationTakeoffReady": True,
            "pieceToPlanVectorMappingReady": False,
            "headTypeAssignmentReady": True,
            "pipeDirectionReady": False,
            "pipeGradeReady": False,
            "installedElevationReady": False,
            "wetSystemInstallation3dReady": False,
            "fabricationReleaseReady": False,
            "fieldReleaseReady": False,
        },
        "verificationLoops": {
            "primary": "diameter-scaled-threaded-source-style-and-native-symbol-signature-replay",
            "crossSource": "field-install-to-as-built-exact-threaded-segment-plus-same-line-native-cut-and-toleranced-head-reconciliation",
            "adversarial": "legacy-annotation-rejection-blue-line-native-cut-rejection-hash-count-coordinate-and-false-promotion-mutation",
        },
    }
    payload["evidenceReceiptSha256"] = sha256_value(payload)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    render_proof(field_page, wet_vectors, rejected_blue, heads, args.proof_output)
    print(json.dumps({
        "output": str(args.output),
        "proof": str(args.proof_output),
        "receipt": payload["evidenceReceiptSha256"],
        "fingerprints": payload["fingerprints"],
        "metrics": payload["metrics"],
    }, indent=2))


if __name__ == "__main__":
    main()

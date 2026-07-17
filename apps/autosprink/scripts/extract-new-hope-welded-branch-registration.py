#!/usr/bin/env python3
"""Extract source-bound welded branch-piece registrations from New Hope FP1.0."""

from __future__ import annotations

import hashlib
import io
import itertools
import json
import math
import re
from collections import Counter, defaultdict
from pathlib import Path

import fitz
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[3]
FIELD = ROOT / "tmp/pdfs/new-hope-live/field-install.pdf"
AS_BUILT = ROOT / "tmp/pdfs/new-hope-live/as-builts.pdf"
NETWORK = ROOT / "apps/autosprink/src/data/new-hope-wet-level1-network-evidence.json"
GRAPH = ROOT / "apps/autosprink/src/data/new-hope-native-fab-attachment-graph.json"
SCHEDULE = ROOT / "apps/autosprink/src/data/new-hope-fabrication-end-schedule.json"
OUTPUT = ROOT / "apps/autosprink/src/data/new-hope-wet-welded-branch-registration-evidence.json"
PROOF = ROOT / "apps/autosprink/src/data/proofs/new-hope-system-backbone/wet-welded-branch-registration-source.png"

FIELD_SHA = "4A47F9A45256DEBB9E5185396BC15526532A3EF420BCBF40EC0BCC0DC5F902B5"
AS_BUILT_SHA = "ED00E9530C02217BC50EAD2FC3391938E731253949B728B31ED1336F8000F34B"
PDF_POINTS_PER_FOOT = 9.0
PLAN_ORIGIN = (660.674561, 1118.512451)
OUTLET_GATE_IN = 0.25
CUT_SPAN_GATE_IN = 3.0
LABEL_LINE_DISTANCE_GATE_PT = 12.0
LABEL_LINE_UNIQUENESS_GAP_PT = 2.0
PLAN_CLIP = fitz.Rect(500, 530, 1615, 1885)


def sha256(path: Path) -> str:
    digest = hashlib.sha256(path.read_bytes()).hexdigest().upper()
    return digest


def rounded_box(word: tuple[object, ...]) -> list[float]:
    return [round(float(value), 6) for value in word[:4]]


def normalized_segment(a: fitz.Point, b: fitz.Point) -> tuple[float, float, float, float]:
    left = (round(a.x, 6), round(a.y, 6))
    right = (round(b.x, 6), round(b.y, 6))
    if right < left:
        left, right = right, left
    return left[0], left[1], right[0], right[1]


def extract_heavy_centerlines(page: fitz.Page) -> list[dict[str, object]]:
    centerlines = []
    for drawing_index, drawing in enumerate(page.get_drawings()):
        if drawing.get("color") != (0.0, 0.0, 0.0) or abs(float(drawing.get("width") or 0) - 1.24059) > 0.00001:
            continue
        for item_index, item in enumerate(drawing["items"]):
            if item[0] != "l":
                continue
            a, b = item[1], item[2]
            length = math.hypot(b.x - a.x, b.y - a.y)
            if length < 3 or max(a.x, b.x) < 300 or min(a.x, b.x) > 1650 or max(a.y, b.y) < 450 or min(a.y, b.y) > 1900:
                continue
            centerlines.append({
                "drawingIndex": drawing_index,
                "itemIndex": item_index,
                "fromPdfPt": [round(a.x, 6), round(a.y, 6)],
                "toPdfPt": [round(b.x, 6), round(b.y, 6)],
                "normalized": normalized_segment(a, b),
                "lengthPt": round(length, 6),
            })
    return centerlines


def extract_label_instances(page: fitz.Page, expected: dict[str, list[str]]) -> list[dict[str, object]]:
    words = page.get_text("words")
    wet_lines = set(expected)
    occurrences: list[dict[str, object]] = []
    used_suffix_indices: set[int] = set()
    line_occurrences: Counter[str] = Counter()
    for index, word in enumerate(words):
        line_name = word[4].strip()
        if line_name not in wet_lines:
            continue
        line_occurrences[line_name] += 1
        suffixes = expected[line_name]
        found: list[tuple[int, tuple[object, ...]]] = []
        for candidate_index in range(index + 1, len(words)):
            candidate = words[candidate_index]
            text = candidate[4].strip()
            if re.fullmatch(r"BL\d{2}", text):
                break
            if re.fullmatch(r"\.\d{2}", text) and text[1:] in suffixes and text[1:] not in [entry[1][4][1:] for entry in found]:
                found.append((candidate_index, candidate))
            if len(found) == len(suffixes):
                break
        used_suffix_indices.update(candidate_index for candidate_index, _ in found)
        occurrences.append({
            "lineName": line_name,
            "occurrence": line_occurrences[line_name],
            "lineLabelBoxPdfPt": rounded_box(word),
            "found": found,
            "suffixes": suffixes,
        })

    unassigned = [
        (index, word)
        for index, word in enumerate(words)
        if re.fullmatch(r"\.\d{2}", word[4].strip()) and index not in used_suffix_indices
    ]
    for occurrence in occurrences:
        found_suffixes = {word[4][1:] for _, word in occurrence["found"]}
        for missing in [suffix for suffix in occurrence["suffixes"] if suffix not in found_suffixes]:
            line_box = occurrence["lineLabelBoxPdfPt"]
            line_y = (line_box[1] + line_box[3]) / 2
            candidates = [entry for entry in unassigned if entry[1][4][1:] == missing]
            if not candidates:
                raise RuntimeError(f"missing source label {occurrence['lineName']}.{missing}")
            selected = min(candidates, key=lambda entry: abs((entry[1][1] + entry[1][3]) / 2 - line_y))
            occurrence["found"].append(selected)
            unassigned.remove(selected)
        occurrence["found"].sort(key=lambda entry: int(entry[1][4][1:]))
    if unassigned:
        raise RuntimeError(f"unassigned branch piece suffix labels remain: {[word[4] for _, word in unassigned]}")

    instances = []
    total_occurrences = Counter(occurrence["lineName"] for occurrence in occurrences)
    for occurrence in occurrences:
        for suffix, (_, word) in zip(occurrence["suffixes"], occurrence["found"]):
            piece_id = f"{occurrence['lineName']}.{suffix}"
            instance_id = piece_id
            if total_occurrences[occurrence["lineName"]] > 1:
                instance_id = f"{piece_id}-{chr(64 + occurrence['occurrence'])}"
            instances.append({
                "instanceId": instance_id,
                "pieceId": piece_id,
                "lineName": occurrence["lineName"],
                "lineOccurrence": occurrence["occurrence"],
                "lineLabelBoxPdfPt": occurrence["lineLabelBoxPdfPt"],
                "pieceLabelBoxPdfPt": rounded_box(word),
            })
    return instances


def distance_to_segment(point: tuple[float, float], centerline: dict[str, object]) -> float:
    px, py = point
    x1, y1 = centerline["fromPdfPt"]
    x2, y2 = centerline["toPdfPt"]
    dx, dy = x2 - x1, y2 - y1
    t = max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))


def plan_ft(point: list[float]) -> list[float]:
    return [round((point[0] - PLAN_ORIGIN[0]) / PDF_POINTS_PER_FOOT, 6), round((point[1] - PLAN_ORIGIN[1]) / PDF_POINTS_PER_FOOT, 6)]


def minimum_cost_assignment(costs: list[list[float]]) -> list[int]:
    """Return a deterministic minimum-cost row-to-column assignment (n <= m)."""
    row_count = len(costs)
    column_count = len(costs[0]) if costs else 0
    if not costs or row_count > column_count or any(len(row) != column_count for row in costs):
        raise RuntimeError("assignment cost matrix must be rectangular with rows <= columns")
    u = [0.0] * (row_count + 1)
    v = [0.0] * (column_count + 1)
    matched_row = [0] * (column_count + 1)
    predecessor = [0] * (column_count + 1)
    for row_index in range(1, row_count + 1):
        matched_row[0] = row_index
        column0 = 0
        minimum = [math.inf] * (column_count + 1)
        used = [False] * (column_count + 1)
        while True:
            used[column0] = True
            current_row = matched_row[column0]
            delta = math.inf
            column1 = 0
            for column in range(1, column_count + 1):
                if used[column]:
                    continue
                candidate = costs[current_row - 1][column - 1] - u[current_row] - v[column]
                if candidate < minimum[column]:
                    minimum[column] = candidate
                    predecessor[column] = column0
                if minimum[column] < delta:
                    delta = minimum[column]
                    column1 = column
            for column in range(column_count + 1):
                if used[column]:
                    u[matched_row[column]] += delta
                    v[column] -= delta
                else:
                    minimum[column] -= delta
            column0 = column1
            if matched_row[column0] == 0:
                break
        while True:
            column1 = predecessor[column0]
            matched_row[column0] = matched_row[column1]
            column0 = column1
            if column0 == 0:
                break
    assignment = [-1] * row_count
    for column in range(1, column_count + 1):
        if matched_row[column]:
            assignment[matched_row[column] - 1] = column - 1
    return assignment


def build_piece_vector_bijection(
    label_instances: list[dict[str, object]],
    centerlines: list[dict[str, object]],
    as_built_by_segment: dict[tuple[float, float, float, float], dict[str, object]],
    pipes: dict[str, dict[str, object]],
) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    dummy_count = len(label_instances) - len(centerlines)
    if dummy_count != 4:
        raise RuntimeError("the welded branch inventory must retain exactly four non-centerline units")
    incompatible_cost = 1_000_000_000.0
    dummy_cost = 1_000_000.0
    candidate_rows: list[list[dict[str, object]]] = []
    costs: list[list[float]] = []
    for label_index, instance in enumerate(label_instances):
        box = instance["pieceLabelBoxPdfPt"]
        point = ((box[0] + box[2]) / 2, (box[1] + box[3]) / 2)
        pipe = pipes[instance["pieceId"]]
        candidates: list[dict[str, object]] = []
        row = []
        for centerline_index, centerline in enumerate(centerlines):
            cut_span_delta_in = pipe["lengthFt"] * 12 - centerline["lengthPt"] / PDF_POINTS_PER_FOOT * 12
            distance = distance_to_segment(point, centerline)
            compatible = 0 <= cut_span_delta_in <= CUT_SPAN_GATE_IN
            candidates.append({
                "centerlineIndex": centerline_index,
                "distancePt": distance,
                "cutSpanDeltaIn": cut_span_delta_in,
                "compatible": compatible,
            })
            row.append(distance * 1_000 + cut_span_delta_in + centerline_index / 100_000 if compatible else incompatible_cost)
        row.extend(dummy_cost + dummy_index / 100_000 + label_index / 10_000_000 for dummy_index in range(dummy_count))
        candidate_rows.append(candidates)
        costs.append(row)
    assignment = minimum_cost_assignment(costs)
    mappings = []
    holdouts = []
    for instance, candidates, assigned_column in zip(label_instances, candidate_rows, assignment):
        pipe = pipes[instance["pieceId"]]
        compatible_candidates = [candidate for candidate in candidates if candidate["compatible"]]
        if assigned_column >= len(centerlines):
            reason = (
                "no-heavy-centerline-with-native-cut-length-closure"
                if not compatible_candidates
                else "no-one-to-one-compatible-heavy-centerline"
            )
            holdouts.append({
                **instance,
                "nativePipeUniqueId": pipe["uniqueId"],
                "nativeCutLengthFt": pipe["lengthFt"],
                "compatibleHeavyCenterlineCount": len(compatible_candidates),
                "reason": reason,
            })
            continue
        candidate = candidates[assigned_column]
        if not candidate["compatible"]:
            raise RuntimeError(f"incompatible centerline assigned to {instance['instanceId']}")
        centerline = centerlines[assigned_column]
        as_built = as_built_by_segment[centerline["normalized"]]
        mappings.append({
            **instance,
            "nativePipeUniqueId": pipe["uniqueId"],
            "nativeCutLengthFt": pipe["lengthFt"],
            "sourceCenterline": {
                "fieldDrawingIndex": centerline["drawingIndex"],
                "asBuiltDrawingIndex": as_built["drawingIndex"],
                "itemIndex": centerline["itemIndex"],
                "widthPt": 1.24059,
                "fromPdfPt": centerline["fromPdfPt"],
                "toPdfPt": centerline["toPdfPt"],
                "fromPlanFt": plan_ft(centerline["fromPdfPt"]),
                "toPlanFt": plan_ft(centerline["toPdfPt"]),
            },
            "pieceLabelToCenterlineDistancePt": round(candidate["distancePt"], 6),
            "sourceCenterlineVsCutSpanDeltaIn": round(candidate["cutSpanDeltaIn"], 6),
            "mappingBasis": "exhaustive-one-to-one-native-cut-length-and-field-as-built-centerline-bijection",
            "nativeStationDirection": None,
            "nativeStationDirectionStatus": "unresolved",
        })
    mappings.sort(key=lambda row: row["instanceId"])
    holdouts.sort(key=lambda row: row["instanceId"])
    mapped_segments = [tuple(row["sourceCenterline"]["fromPdfPt"] + row["sourceCenterline"]["toPdfPt"]) for row in mappings]
    if len(mappings) != 67 or len(set(mapped_segments)) != 67 or len(holdouts) != 4:
        raise RuntimeError("the label/length assignment no longer forms the exact 67-centerline bijection")
    return mappings, holdouts


def heads_on_centerline(centerline: dict[str, object], heads: list[dict[str, object]]) -> list[dict[str, object]]:
    x1, y1 = centerline["fromPdfPt"]
    x2, y2 = centerline["toPdfPt"]
    dx, dy = x2 - x1, y2 - y1
    length = math.hypot(dx, dy)
    ux, uy = dx / length, dy / length
    matches = []
    for head in heads:
        x, y = head["pdfPt"]["x"], head["pdfPt"]["y"]
        station = (x - x1) * ux + (y - y1) * uy
        perpendicular = abs((x - x1) * uy - (y - y1) * ux)
        if -0.1 <= station <= length + 0.1 and perpendicular <= 0.03:
            matches.append({"head": head, "sourceStationPt": station})
    return sorted(matches, key=lambda entry: entry["sourceStationPt"])


def fit_registration(centerline: dict[str, object], pipe: dict[str, object], outlets: list[dict[str, object]], heads: list[dict[str, object]]) -> list[dict[str, object]]:
    unique_outlets = []
    seen_distances = set()
    for outlet in sorted(outlets, key=lambda entry: entry["distanceFt"]):
        key = round(outlet["distanceFt"], 9)
        if key not in seen_distances:
            seen_distances.add(key)
            unique_outlets.append(outlet)
    if len(unique_outlets) < 2:
        return []
    observed = heads_on_centerline(centerline, heads)
    if len(observed) < len(unique_outlets):
        return []
    cut_span_delta_in = pipe["lengthFt"] * 12 - centerline["lengthPt"] / PDF_POINTS_PER_FOOT * 12
    if not 0 <= cut_span_delta_in <= 3:
        return []

    x1, y1 = centerline["fromPdfPt"]
    x2, y2 = centerline["toPdfPt"]
    length = centerline["lengthPt"]
    ux, uy = (x2 - x1) / length, (y2 - y1) / length
    fits = []
    for combination in itertools.combinations(observed, len(unique_outlets)):
        for sign in (1, -1):
            ordered = combination if sign == 1 else tuple(reversed(combination))
            origins = [
                match["sourceStationPt"] - sign * outlet["distanceFt"] * PDF_POINTS_PER_FOOT
                for match, outlet in zip(ordered, unique_outlets)
            ]
            origin = sum(origins) / len(origins)
            residuals_in = [
                (match["sourceStationPt"] - (origin + sign * outlet["distanceFt"] * PDF_POINTS_PER_FOOT)) / PDF_POINTS_PER_FOOT * 12
                for match, outlet in zip(ordered, unique_outlets)
            ]
            max_residual = max(abs(value) for value in residuals_in)
            cut_end = origin + sign * pipe["lengthFt"] * PDF_POINTS_PER_FOOT
            low, high = sorted((origin, cut_end))
            if max_residual > OUTLET_GATE_IN or low > 0.01 or high < length - 0.01:
                continue
            cut_from = [round(x1 + ux * origin, 6), round(y1 + uy * origin, 6)]
            cut_to = [round(x1 + ux * cut_end, 6), round(y1 + uy * cut_end, 6)]
            mapped_outlets = []
            for match, outlet, residual in zip(ordered, unique_outlets, residuals_in):
                mapped_outlets.append({
                    "nativeOutletUniqueId": outlet["uniqueId"],
                    "nativeOutletDistanceFt": outlet["distanceFt"],
                    "headId": match["head"]["id"],
                    "headPdfPt": [match["head"]["pdfPt"]["x"], match["head"]["pdfPt"]["y"]],
                    "residualIn": round(residual, 6),
                })
            fits.append({
                "nativeStationDirection": "source-drawing-forward" if sign == 1 else "source-drawing-reverse",
                "fabricationCutVector": {"fromPdfPt": cut_from, "toPdfPt": cut_to, "fromPlanFt": plan_ft(cut_from), "toPlanFt": plan_ft(cut_to)},
                "mappedOutlets": mapped_outlets,
                "maxOutletResidualIn": round(max_residual, 6),
                "sourceCenterlineVsCutSpanDeltaIn": round(cut_span_delta_in, 6),
            })
    return fits


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    path = Path("C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf")
    return ImageFont.truetype(str(path), size) if path.exists() else ImageFont.load_default()


def render_proof(page: fitz.Page, piece_vector_mappings: list[dict[str, object]], registrations: list[dict[str, object]], piece_vector_holdouts: list[dict[str, object]], metrics: dict[str, object]) -> None:
    target_width = 1420
    scale = target_width / PLAN_CLIP.width
    pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), clip=PLAN_CLIP, alpha=False)
    plan = Image.open(io.BytesIO(pixmap.tobytes("png"))).convert("RGB")
    overlay = Image.new("RGBA", plan.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay, "RGBA")

    def local(point: list[float]) -> tuple[float, float]:
        return (point[0] - PLAN_CLIP.x0) * scale, (point[1] - PLAN_CLIP.y0) * scale

    for mapping in piece_vector_mappings:
        source = mapping["sourceCenterline"]
        source_a, source_b = local(source["fromPdfPt"]), local(source["toPdfPt"])
        draw.line((*source_a, *source_b), fill=(53, 222, 255, 210), width=5)
        box = mapping["pieceLabelBoxPdfPt"]
        x0, y0 = local(box[:2])
        x1, y1 = local(box[2:])
        draw.rectangle((x0 - 2, y0 - 2, x1 + 2, y1 + 2), outline=(52, 211, 153, 235), width=2)
    for index, registration in enumerate(registrations, 1):
        cut = registration["fabricationCutVector"]
        cut_a, cut_b = local(cut["fromPdfPt"]), local(cut["toPdfPt"])
        draw.line((*cut_a, *cut_b), fill=(255, 43, 214, 235), width=4)
        for mapped in registration["mappedOutlets"]:
            x, y = local(mapped["headPdfPt"])
            draw.ellipse((x - 7, y - 7, x + 7, y + 7), fill=(3, 12, 28, 220), outline=(255, 214, 74, 255), width=3)
        label_x, label_y = local(registration["sourceCenterline"]["toPdfPt"])
        draw.ellipse((label_x - 12, label_y - 12, label_x + 12, label_y + 12), fill=(3, 12, 28, 230), outline=(255, 255, 255, 180), width=2)
        text = str(index)
        draw.text((label_x - 5, label_y - 8), text, font=font(13, True), fill="white")
    for holdout in piece_vector_holdouts:
        box = holdout["pieceLabelBoxPdfPt"]
        x0, y0 = local(box[:2])
        x1, y1 = local(box[2:])
        draw.rectangle((x0 - 4, y0 - 4, x1 + 4, y1 + 4), outline=(255, 86, 103, 255), width=4)
    plan = Image.alpha_composite(plan.convert("RGBA"), overlay).convert("RGB")
    header = 132
    canvas = Image.new("RGB", (plan.width, plan.height + header), (3, 10, 18))
    canvas.paste(plan, (0, header))
    draw = ImageDraw.Draw(canvas)
    draw.text((20, 17), "New Hope FP1.0 - welded branch piece registration", font=font(31, True), fill=(244, 251, 255))
    draw.text((20, 57), "actual field PDF | cyan = 67 label/length-mapped centerlines | magenta = 15 direction-registered cuts | red = four held labels", font=font(17), fill=(173, 220, 238))
    draw.text((20, 86), f"{metrics['pieceVectorMappedUnitCount']}/71 piece vectors mapped | all 67 heavy centerlines consumed once | {metrics['registeredUnitCount']} station directions | {metrics['mappedNativeOutletCount']} outlets", font=font(18, True), fill=(116, 255, 207))
    draw.text((20, 111), "Hydraulic flow, drainage grade, fitting takeout, installed Z, and 102 of 169 global listed units remain unresolved.", font=font(16), fill=(255, 210, 122))
    PROOF.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(PROOF, optimize=True)


def main() -> None:
    if sha256(FIELD) != FIELD_SHA or sha256(AS_BUILT) != AS_BUILT_SHA:
        raise RuntimeError("cached source PDFs do not match their protected hashes")
    network = json.loads(NETWORK.read_text(encoding="utf-8"))
    graph = json.loads(GRAPH.read_text(encoding="utf-8"))
    schedule = json.loads(SCHEDULE.read_text(encoding="utf-8"))
    wet_lines = {f"BL{index:02d}" for index in range(1, 48)}
    expected: dict[str, list[str]] = defaultdict(list)
    for piece in schedule["weldedPieces"]:
        if piece["lineName"] in wet_lines:
            expected[piece["lineName"]].append(piece["pieceId"].split(".", 1)[1])
    expected = {key: sorted(set(values), key=int) for key, values in expected.items()}

    field_page = fitz.open(FIELD)[2]
    as_built_page = fitz.open(AS_BUILT)[2]
    label_instances = extract_label_instances(field_page, expected)
    field_centerlines = extract_heavy_centerlines(field_page)
    as_built_centerlines = extract_heavy_centerlines(as_built_page)
    as_built_by_segment = {centerline["normalized"]: centerline for centerline in as_built_centerlines}
    if len(field_centerlines) != 67 or len(as_built_centerlines) != 67 or set(centerline["normalized"] for centerline in field_centerlines) != set(as_built_by_segment):
        raise RuntimeError("the 67 heavy branch centerlines no longer replay exactly across both PDFs")

    line_records = {record["uniqueId"]: record for record in graph["records"]["lines"] if record["lineName"] in wet_lines}
    pipes = {
        f"{line_records[pipe['parentId']]['lineName']}{pipe['pieceName']}": pipe
        for pipe in graph["records"]["pipes"]
        if pipe["parentId"] in line_records
    }
    outlets_by_pipe: dict[int, list[dict[str, object]]] = defaultdict(list)
    for outlet in graph["records"]["outlets"]:
        outlets_by_pipe[outlet["parentId"]].append(outlet)

    piece_vector_mappings, piece_vector_holdouts = build_piece_vector_bijection(
        label_instances,
        field_centerlines,
        as_built_by_segment,
        pipes,
    )

    registrations = []
    unresolved = []
    for instance in label_instances:
        piece_box = instance["pieceLabelBoxPdfPt"]
        point = ((piece_box[0] + piece_box[2]) / 2, (piece_box[1] + piece_box[3]) / 2)
        ranked = sorted((distance_to_segment(point, centerline), index, centerline) for index, centerline in enumerate(field_centerlines))
        nearest_distance, _, centerline = ranked[0]
        uniqueness_gap = ranked[1][0] - nearest_distance
        pipe = pipes[instance["pieceId"]]
        unique_outlet_count = len({round(outlet["distanceFt"], 9) for outlet in outlets_by_pipe[pipe["uniqueId"]]})
        if nearest_distance > LABEL_LINE_DISTANCE_GATE_PT or uniqueness_gap < LABEL_LINE_UNIQUENESS_GAP_PT:
            unresolved.append({**instance, "nativePipeUniqueId": pipe["uniqueId"], "uniqueNativeOutletStationCount": unique_outlet_count, "reason": "source-centerline-label-association-not-unique", "nearestCenterlineDistancePt": round(nearest_distance, 6), "nearestCenterlineUniquenessGapPt": round(uniqueness_gap, 6)})
            continue
        fits = fit_registration(centerline, pipe, outlets_by_pipe[pipe["uniqueId"]], network["sprinklerHeads"])
        if len(fits) != 1:
            reason = "fewer-than-two-unique-native-outlet-stations" if unique_outlet_count < 2 else "native-outlet-head-cut-vector-closure-not-unique"
            unresolved.append({**instance, "nativePipeUniqueId": pipe["uniqueId"], "uniqueNativeOutletStationCount": unique_outlet_count, "reason": reason, "nearestCenterlineDistancePt": round(nearest_distance, 6), "nearestCenterlineUniquenessGapPt": round(uniqueness_gap, 6)})
            continue
        as_built = as_built_by_segment[centerline["normalized"]]
        fit = fits[0]
        registrations.append({
            **instance,
            "nativePipeUniqueId": pipe["uniqueId"],
            "nativeCutLengthFt": pipe["lengthFt"],
            "sourceCenterline": {
                "fieldDrawingIndex": centerline["drawingIndex"],
                "asBuiltDrawingIndex": as_built["drawingIndex"],
                "itemIndex": centerline["itemIndex"],
                "widthPt": 1.24059,
                "fromPdfPt": centerline["fromPdfPt"],
                "toPdfPt": centerline["toPdfPt"],
                "fromPlanFt": plan_ft(centerline["fromPdfPt"]),
                "toPlanFt": plan_ft(centerline["toPdfPt"]),
            },
            "pieceLabelToCenterlineDistancePt": round(nearest_distance, 6),
            "pieceLabelCenterlineUniquenessGapPt": round(uniqueness_gap, 6),
            **fit,
        })

    registrations.sort(key=lambda row: row["instanceId"])
    unresolved.sort(key=lambda row: row["instanceId"])
    registration_by_id = {row["instanceId"]: row for row in registrations}
    for mapping in piece_vector_mappings:
        registration = registration_by_id.get(mapping["instanceId"])
        if registration:
            mapping["nativeStationDirection"] = registration["nativeStationDirection"]
            mapping["nativeStationDirectionStatus"] = "native-outlet-registered"
    reason_counts = dict(sorted(Counter(row["reason"] for row in unresolved).items()))
    metrics = {
        "weldedBranchDefinitionCount": 69,
        "weldedBranchUnitCount": 71,
        "exactFieldPieceLabelCount": len(label_instances),
        "fieldAsBuiltHeavyCenterlineCount": len(field_centerlines),
        "pieceVectorMappedUnitCount": len(piece_vector_mappings),
        "pieceVectorHoldoutCount": len(piece_vector_holdouts),
        "pieceVectorMappedHeavyCenterlineCount": len({tuple(row["sourceCenterline"]["fromPdfPt"] + row["sourceCenterline"]["toPdfPt"]) for row in piece_vector_mappings}),
        "maxPieceVectorCutSpanDeltaIn": max(row["sourceCenterlineVsCutSpanDeltaIn"] for row in piece_vector_mappings),
        "maxPieceLabelToMappedCenterlineDistancePt": max(row["pieceLabelToCenterlineDistancePt"] for row in piece_vector_mappings),
        "registeredUnitCount": len(registrations),
        "mappedNativeOutletCount": sum(len(row["mappedOutlets"]) for row in registrations),
        "maxOutletResidualIn": max(row["maxOutletResidualIn"] for row in registrations),
        "unresolvedUnitCount": len(unresolved),
        "unresolvedReasonCounts": reason_counts,
        "globalListedUnitCount": 169,
        "globalPieceVectorUnmappedUnitCount": 169 - len(piece_vector_mappings),
    }
    expected_registration_ids = {
        "BL01.02", "BL06.01", "BL10.02", "BL16.01", "BL19.02", "BL27.01",
        "BL34.01-A", "BL34.01-B", "BL35.01-A", "BL35.01-B", "BL42.01",
        "BL43.01", "BL44.02", "BL46.01", "BL47.01",
    }
    expected_piece_vector_holdout_ids = {"BL03.01", "BL03.02", "BL04.01", "BL04.02"}
    if metrics["registeredUnitCount"] != 15 or metrics["mappedNativeOutletCount"] != 36 or metrics["unresolvedUnitCount"] != 56 or {row["instanceId"] for row in registrations} != expected_registration_ids:
        raise RuntimeError(f"registration coverage changed unexpectedly: {metrics}; ids={[row['instanceId'] for row in registrations]}")
    if metrics["pieceVectorMappedUnitCount"] != 67 or metrics["pieceVectorMappedHeavyCenterlineCount"] != 67 or {row["instanceId"] for row in piece_vector_holdouts} != expected_piece_vector_holdout_ids:
        raise RuntimeError(f"piece-vector bijection changed unexpectedly: {metrics}; holdouts={[row['instanceId'] for row in piece_vector_holdouts]}")
    evidence = {
        "artifactType": "halofire.new-hope-wet-welded-branch-registration-evidence.v2",
        "projectId": "new-hope-crisis-center-brigham-city-ut",
        "sources": {
            "fieldInstall": {"fileName": "24-052_NHCC_INSTALL PLAN.pdf", "sheet": "FP1.0", "physicalPage": 3, "sha256": FIELD_SHA},
            "asBuilt": {"fileName": "New Hope BGC - Brigham City UT_as builts.pdf", "sheet": "FP1.0", "physicalPage": 3, "sha256": AS_BUILT_SHA},
            "nativeFab": {"archiveSha256": "A449B6C8670CEE52955C3D3D57F8169E3091CFA34C943C6723785724F06DDED9", "memberSha256": "0B64077B62673459C11D2CBC303258C1DD3F0C75735A07BFFA903BAEE79D6135"},
        },
        "registration": {"pdfPointsPerFoot": PDF_POINTS_PER_FOOT, "planOriginPdfPt": list(PLAN_ORIGIN), "outletResidualGateIn": OUTLET_GATE_IN, "cutSpanGateIn": CUT_SPAN_GATE_IN, "pieceLabelCenterlineDistanceGatePt": LABEL_LINE_DISTANCE_GATE_PT, "pieceLabelCenterlineUniquenessGapPt": LABEL_LINE_UNIQUENESS_GAP_PT},
        "labelInstances": label_instances,
        "pieceVectorMappings": piece_vector_mappings,
        "pieceVectorHoldouts": piece_vector_holdouts,
        "registrations": registrations,
        "unresolved": unresolved,
        "metrics": metrics,
        "claims": {
            "weldedBranchLabelInventoryReady": True,
            "fieldAsBuiltHeavyCenterlineParityReady": True,
            "weldedBranchPieceVectorBijectionReady": True,
            "scopedPieceToPlanVectorMappingReady": True,
            "scopedFabricationStationDirectionReady": True,
            "completeWeldedBranchPieceMappingReady": False,
            "pieceToPlanVectorMappingReady": False,
            "hydraulicFlowDirectionReady": False,
            "gradeReady": False,
            "installedElevationReady": False,
            "fabricationReady": False,
            "fieldReleaseReady": False,
        },
    }
    OUTPUT.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8", newline="\n")
    render_proof(field_page, piece_vector_mappings, registrations, piece_vector_holdouts, metrics)
    print(f"wrote {OUTPUT} ({len(piece_vector_mappings)} vectors; {len(registrations)} direction registrations)")
    print(f"wrote {PROOF}")


if __name__ == "__main__":
    main()

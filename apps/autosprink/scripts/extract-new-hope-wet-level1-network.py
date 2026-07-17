#!/usr/bin/env python3
"""Extract and cross-check New Hope's Level 1 wet sprinkler network.

The field-install and as-built FP1.0 sheets are treated as independent PDF
projections.  Native black 0.5-point linework supplies the plan network;
native 21-segment symbols supply sprinkler positions.  The FAB attachment
graph supplies line, cut-piece, outlet, and fitting identities, but this
extractor intentionally does not invent a piece-to-plan mapping or installed Z.
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
HEAD_SCHEDULE = [
    {"manufacturer": "Tyco", "sin": "TY3231", "model": "TY-FRB", "type": "pendent", "quantity": 164},
    {"manufacturer": "Victaulic", "sin": "V3506", "model": "VS1", "type": "pendent", "quantity": 6},
    {"manufacturer": "Tyco", "sin": "TY3131", "model": "TY-FRB", "type": "upright", "quantity": 4},
]


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


def extract_wet_vectors(page: fitz.Page) -> list[dict[str, object]]:
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
    for drawing_index, drawing in enumerate(page.get_drawings()):
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
        heads.append({
            "sourceDrawingIndex": drawing_index,
            "pdfPt": {"x": round(center.x, 6), "y": round(center.y, 6)},
            "symbolBoxPt": {"width": round(rect.width, 6), "height": round(rect.height, 6)},
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
        remaining.remove(match_index)
        matches.append({
            "id": f"wet-head-{index:03d}",
            "fieldDrawingIndex": field["sourceDrawingIndex"],
            "asBuiltDrawingIndex": matched["sourceDrawingIndex"],
            "pdfPt": field["pdfPt"],
            "planFt": plan_ft(field["pdfPt"]),
            "crossSourceResidualPt": round(residual, 6),
            "headType": None,
            "headTypeAssignmentStatus": "schedule-quantity-known-coordinate-assignment-unresolved",
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


def head_fingerprint(heads: list[dict[str, object]]) -> str:
    return fnv1a64("|".join(
        f"{row['id']}:{row['pdfPt']['x']:.6f},{row['pdfPt']['y']:.6f},"
        f"{row['crossSourceResidualPt']:.6f}"
        for row in heads
    ))


def native_fingerprint(lines: list[dict[str, object]]) -> str:
    return fnv1a64("|".join(
        f"{line['lineName']}:{piece['pieceName']}:{piece['sizeCode']}:"
        f"{piece['cutLengthFt']:.6f}:{piece['outletCount']}:{piece['fittingCount']}"
        for line in lines for piece in line["pieces"]
    ))


def render_proof(page: fitz.Page, vectors: list[dict[str, object]], heads: list[dict[str, object]], output: Path) -> None:
    scale = 1.35
    pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
    source = Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
    draw = ImageDraw.Draw(source, "RGBA")
    for vector in vectors:
        start, end = vector["fromPdfPt"], vector["toPdfPt"]
        draw.line((start["x"] * scale, start["y"] * scale, end["x"] * scale, end["y"] * scale), fill=(0, 210, 255, 230), width=4)
    for head in heads:
        x, y = head["pdfPt"]["x"] * scale, head["pdfPt"]["y"] * scale
        radius = 5.2
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), outline=(255, 55, 130, 245), width=3)
    try:
        font = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 31)
        small = ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", 23)
    except OSError:
        font = small = ImageFont.load_default()
    draw.rounded_rectangle((24, 24, 1045, 150), radius=18, fill=(3, 11, 20, 228), outline=(77, 231, 255, 230), width=3)
    draw.text((48, 43), "New Hope FP1.0 - source-native wet network", font=font, fill=(245, 250, 255, 255))
    draw.text((48, 96), "300 pipe vectors | 174 head centers | field-install = as-built", font=small, fill=(175, 232, 245, 255))
    output.parent.mkdir(parents=True, exist_ok=True)
    source.save(output, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--field-pdf", type=Path, default=DEFAULT_FIELD)
    parser.add_argument("--asbuilt-pdf", type=Path, default=DEFAULT_ASBUILT)
    parser.add_argument("--native-graph", type=Path, default=DEFAULT_NATIVE_GRAPH)
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
    field_vectors = extract_wet_vectors(field_page)
    asbuilt_vectors = extract_wet_vectors(asbuilt_page)
    if len(field_vectors) != 300 or len(asbuilt_vectors) != 317:
        raise RuntimeError(f"wet-vector signature changed: field={len(field_vectors)} asBuilt={len(asbuilt_vectors)}")
    asbuilt_by_key = {segment_key(row): row for row in asbuilt_vectors}
    missing = [segment_key(row) for row in field_vectors if segment_key(row) not in asbuilt_by_key]
    if missing:
        raise RuntimeError(f"{len(missing)} field wet vectors are absent from as-built")

    wet_vectors = []
    for index, field in enumerate(field_vectors, start=1):
        matched = asbuilt_by_key[segment_key(field)]
        wet_vectors.append({
            "id": f"wet-vector-{index:03d}",
            "fieldDrawingIndex": field["sourceDrawingIndex"],
            "fieldItemIndex": field["sourceItemIndex"],
            "asBuiltDrawingIndex": matched["sourceDrawingIndex"],
            "asBuiltItemIndex": matched["sourceItemIndex"],
            "fromPdfPt": field["fromPdfPt"],
            "toPdfPt": field["toPdfPt"],
            "fromPlanFt": plan_ft(field["fromPdfPt"]),
            "toPlanFt": plan_ft(field["toPdfPt"]),
            "lengthFt": round(field["lengthPt"] / PDF_POINTS_PER_FOOT, 6),
            "crossSourceResidualPt": 0,
        })

    field_heads = extract_heads(field_page)
    asbuilt_heads = extract_heads(asbuilt_page)
    if len(field_heads) != 174 or len(asbuilt_heads) != 174:
        raise RuntimeError(f"head signature changed: field={len(field_heads)} asBuilt={len(asbuilt_heads)}")
    heads = nearest_head_matches(field_heads, asbuilt_heads)
    max_head_residual = max(row["crossSourceResidualPt"] for row in heads)
    if max_head_residual > 0.01:
        raise RuntimeError(f"unexpected maximum head residual: {max_head_residual}")

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

    payload = {
        "artifactType": "halofire.new-hope-wet-level1-network-evidence.v1",
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
        "sprinklerHeads": heads,
        "sprinklerSchedule": HEAD_SCHEDULE,
        "branchLineLabels": branch_labels,
        "crossMainPieceLabelsVisible": cross_main_piece_labels,
        "nativeFabricationLines": native_lines,
        "metrics": {
            "wetPipeVectorCount": len(wet_vectors),
            "fieldWetVectorLengthPt": round(sum(row["lengthFt"] * PDF_POINTS_PER_FOOT for row in wet_vectors), 6),
            "asBuiltCandidateVectorCount": len(asbuilt_vectors),
            "asBuiltNonPlanDetailVectorCount": len(asbuilt_vectors) - len(wet_vectors),
            "crossSourcePipeVectorMatchCount": len(wet_vectors),
            "crossSourcePipeMaxResidualPt": 0,
            "sprinklerHeadCount": len(heads),
            "crossSourceHeadMatchCount": len(heads),
            "crossSourceHeadMaxResidualPt": max_head_residual,
            **native_summary,
        },
        "fingerprints": {
            "wetPipeVectorsFnv1a64": vector_fingerprint(wet_vectors),
            "sprinklerHeadsFnv1a64": head_fingerprint(heads),
            "nativeFabricationFnv1a64": native_fingerprint(native_lines),
        },
        "claims": {
            "wetSystemNetwork2dReady": True,
            "sprinklerHeadPositions2dReady": True,
            "sprinklerScheduleQuantitiesReady": True,
            "nativeFabricationTakeoffReady": True,
            "pieceToPlanVectorMappingReady": False,
            "headTypeAssignmentReady": False,
            "pipeDirectionReady": False,
            "pipeGradeReady": False,
            "installedElevationReady": False,
            "wetSystemInstallation3dReady": False,
            "fabricationReleaseReady": False,
            "fieldReleaseReady": False,
        },
        "verificationLoops": {
            "primary": "native-field-install-vector-and-symbol-signature-replay",
            "crossSource": "field-install-to-as-built-exact-pipe-and-toleranced-head-coordinate-reconciliation-plus-native-FAB-takeoff",
            "adversarial": "hash-count-coordinate-residual-line-family-piece-length-and-false-promotion-rejection",
        },
    }
    payload["evidenceReceiptSha256"] = sha256_value(payload)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    render_proof(field_page, wet_vectors, heads, args.proof_output)
    print(json.dumps({
        "output": str(args.output),
        "proof": str(args.proof_output),
        "receipt": payload["evidenceReceiptSha256"],
        "fingerprints": payload["fingerprints"],
        "metrics": payload["metrics"],
    }, indent=2))


if __name__ == "__main__":
    main()

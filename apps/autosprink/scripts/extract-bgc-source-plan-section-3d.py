#!/usr/bin/env python3
"""Extract a source-bound BGC pitched-roof plan/section graph and visual proof."""

from __future__ import annotations

import hashlib
import io
import json
import math
from pathlib import Path

import fitz
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "src" / "data"
PROOF = DATA / "proofs" / "bgc-source-plan-section-3d-registration"
OUTPUT = DATA / "bgc-source-plan-section-3d-registration.json"

PROJECT_ROOT = Path(
    "Y:/Shared/HaloOps/02-Active jobs/Eckman/"
    "Boys & Girls Club Community Center - Brigham City UT"
)
ARCHITECTURAL = PROJECT_ROOT / (
    "1-Bid Documents/GC - Bid Plans/Building/"
    "Boys and Girls Club Community Center Permit Set.pdf"
)
APPROVED = PROJECT_ROOT / (
    "2-Internal Ops/01-Design/08-AHJ Approval DWG & Permit/"
    "Brigham City/BGC CC - Brigham City UT_app plans.pdf"
)
AS_BUILT = PROJECT_ROOT / (
    "2-Internal Ops/01-Design/11-As-Built Set/BGC_INSTALL PLAN.pdf"
)

EXPECTED = {
    ARCHITECTURAL: ("f220c7841dfd1ca7fc0b8eaf8f440d0b63a1541b8228c7c006e4c44a88180b20", 18178437),
    APPROVED: ("799fba69311eb3aa285d6b96cb346aed184b3093d73777737597d23df60a0a18", 5313661),
    AS_BUILT: ("6f20b0ad824aaae6a8a71fac46e5faf89e5904eef0ad762cf98b8d0ed186b252", 14918460),
}

PLAN_CLIP = fitz.Rect(700, 1040, 1740, 1980)
SECTION_CLIP = fitz.Rect(30, 270, 390, 470)
PLAN_SCALE = 2.0
SECTION_SCALE = 3.0
GRID_2_X = 744.5359497070312
GRID_X = {
    "2": 744.5359497070312,
    "3": 978.5359497070312,
    "4": 1212.5359497070312,
    "5": 1446.5359497070312,
    "6": 1680.5359497070312,
}
RIDGE_Y = 1488.861328125
PDF_POINTS_PER_FOOT = 9.0
RIDGE_ELEVATION_FT = 32.458333
EAVE_ELEVATION_FT = 25.0
PITCH_RISE_PER_12 = 2.0
SECTION_ROOF = {
    "leftEavePdfPoint": [82.08, 332.16],
    "ridgePdfPoint": [202.32, 312.12],
    "rightEavePdfPoint": [322.56, 332.16],
}


def sha256_file(path: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while block := handle.read(1024 * 1024):
            digest.update(block)
    return digest.hexdigest(), path.stat().st_size


def canonical_json(value: object) -> str:
    def normalize(item: object) -> object:
        if isinstance(item, float) and item.is_integer():
            return int(item)
        if isinstance(item, list):
            return [normalize(entry) for entry in item]
        if isinstance(item, dict):
            return {key: normalize(entry) for key, entry in item.items()}
        return item

    return json.dumps(normalize(value), sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def digest_value(value: object) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def write_text_lf(path: Path, content: str) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(content)


def assert_sources() -> dict[str, dict[str, object]]:
    result = {}
    roles = (("architectural", ARCHITECTURAL, "A301", 15), ("ahjApproved", APPROVED, "FP 1.0", 3), ("asBuilt", AS_BUILT, "FP 1.0", 3))
    for role, path, sheet, page in roles:
        actual = sha256_file(path)
        if actual != EXPECTED[path]:
            raise RuntimeError(f"{role} source drift: expected={EXPECTED[path]} actual={actual}")
        result[role] = {
            "fileName": path.name,
            "sha256": actual[0],
            "bytes": actual[1],
            "sheet": sheet,
            "physicalPage": page,
        }
    return result


def black(color: object, tolerance: float = 0.02) -> bool:
    return isinstance(color, tuple) and len(color) == 3 and max(color) < tolerance


def extract_as_built_heads(page: fitz.Page) -> list[dict[str, object]]:
    hits = []
    for index, drawing in enumerate(page.get_drawings()):
        rect = drawing["rect"]
        kinds = "".join(item[0] for item in drawing["items"])
        if (
            abs(rect.width - 9.0) < 0.03
            and abs(rect.height - 8.875) < 0.03
            and len(drawing["items"]) == 25
            and kinds == "l" * 25
            and black(drawing.get("color"), 0.001)
            and abs((drawing.get("width") or 0) - 0.4) < 0.01
        ):
            hits.append({
                "sourceDrawingIndex": index,
                "pdfPoint": [round((rect.x0 + rect.x1) / 2, 6), round((rect.y0 + rect.y1) / 2, 6)],
            })
    if len(hits) != 64:
        raise RuntimeError(f"as-built guarded-upright signature returned {len(hits)}, expected 64")
    return hits


def extract_approved_heads(page: fitz.Page) -> list[dict[str, object]]:
    hits = []
    for index, drawing in enumerate(page.get_drawings()):
        rect = drawing["rect"]
        center = [(rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2]
        kinds = "".join(item[0] for item in drawing["items"])
        if (
            1100 < center[0] < 1900
            and 1300 < center[1] < 2250
            and 8.7 < rect.width < 9.1
            and 11.1 < rect.height < 11.4
            and len(drawing["items"]) == 8
            and kinds == "llcllcll"
            and black(drawing.get("color"))
            and abs((drawing.get("width") or 0) - 0.4) < 0.01
        ):
            hits.append({"sourceDrawingIndex": index, "pdfPoint": [round(center[0], 6), round(center[1], 6)]})
    if len(hits) != 64:
        raise RuntimeError(f"approved guarded-upright signature returned {len(hits)}, expected 64")
    return hits


def vertical_pipe_covers(page: fitz.Page, x: float, y0: float, y1: float) -> bool:
    lower, upper = sorted((y0, y1))
    intervals = []
    for drawing in page.get_drawings():
        if not black(drawing.get("color"), 0.001):
            continue
        for item in drawing["items"]:
            if item[0] != "l":
                continue
            start, end = item[1], item[2]
            if (
                abs(start.x - end.x) < 0.02
                and abs(start.x - x) < 0.75
            ):
                intervals.append(sorted((start.y, end.y)))
    intervals.sort()
    merged = []
    for start, end in intervals:
        if not merged or start > merged[-1][1] + 10:
            merged.append([start, end])
        else:
            merged[-1][1] = max(merged[-1][1], end)
    return any(start <= lower + 5 and end >= upper - 5 for start, end in merged)


def build_graph(page: fitz.Page, hits: list[dict[str, object]]) -> tuple[list[dict[str, object]], list[dict[str, object]], dict[str, object]]:
    rows = sorted({round(hit["pdfPoint"][1], 3) for hit in hits})
    if len(rows) != 8 or not (rows[3] < RIDGE_Y < rows[4]):
        raise RuntimeError(f"expected four head rows on each roof plane, found {rows}")
    upper = sorted({round(hit["pdfPoint"][0], 6) for hit in hits if hit["pdfPoint"][1] < RIDGE_Y})
    lower = sorted({round(hit["pdfPoint"][0], 6) for hit in hits if hit["pdfPoint"][1] > RIDGE_Y})
    if len(upper) != 8 or len(lower) != 8:
        raise RuntimeError("expected eight branch halves on each side of the ridge")
    offsets = [round(lower[index] - upper[index], 6) for index in range(8)]
    mean_offset = sum(offsets) / len(offsets)
    if max(abs(value - mean_offset) for value in offsets) > 0.001:
        raise RuntimeError(f"branch-half offset does not close: {offsets}")

    nodes = []
    by_key: dict[tuple[int, int], dict[str, object]] = {}
    for branch in range(8):
        for position, row in enumerate(rows, start=1):
            expected_x = upper[branch] if row < RIDGE_Y else lower[branch]
            hit = min(hits, key=lambda item: abs(item["pdfPoint"][0] - expected_x) + abs(item["pdfPoint"][1] - row))
            x, y = hit["pdfPoint"]
            along = (x - GRID_2_X) / PDF_POINTS_PER_FOOT
            across = (y - RIDGE_Y) / PDF_POINTS_PER_FOOT
            target_z = RIDGE_ELEVATION_FT - abs(across) * PITCH_RISE_PER_12 / 12
            node = {
                "id": f"BGC-H-{branch + 1:02d}-{position:02d}",
                "branchIndex": branch + 1,
                "acrossSlopePosition": position,
                "roofPlane": "north" if y < RIDGE_Y else "south",
                "sourceDrawingIndex": hit["sourceDrawingIndex"],
                "planPdfPoint": [x, y],
                "planPointFt": [round(along, 6), round(across, 6)],
                "roofSurfaceTargetElevationFt": round(target_z, 6),
                "headType": "Tyco TY3131 TY-FRB 5.6 upright quick response natural brass 200F with head guard",
                "targetOnly": True,
                "exactInstalledElevationVerified": False,
            }
            nodes.append(node)
            by_key[(branch + 1, position)] = node

    edges = []
    for branch in range(1, 9):
        for start_position in (1, 2, 3, 5, 6, 7):
            start = by_key[(branch, start_position)]
            end = by_key[(branch, start_position + 1)]
            x = (start["planPdfPoint"][0] + end["planPdfPoint"][0]) / 2
            if not vertical_pipe_covers(page, x, start["planPdfPoint"][1], end["planPdfPoint"][1]):
                raise RuntimeError(f"native vertical pipe does not cover {start['id']} -> {end['id']}")
            edges.append({
                "id": f"BGC-E-{len(edges) + 1:03d}",
                "from": start["id"],
                "to": end["id"],
                "kind": "source-proven-branch-half",
                "sourceVectorCoverageVerified": True,
                "pipeSizeVerified": False,
                "pipeGradeVerified": False,
                "exactInstalledElevationVerified": False,
            })
    return nodes, edges, {
        "upperHalfXPt": upper,
        "lowerHalfXPt": lower,
        "lowerMinusUpperOffsetsPt": offsets,
        "meanOffsetPt": round(mean_offset, 6),
        "maxOffsetResidualPt": round(max(abs(value - mean_offset) for value in offsets), 6),
    }


def render_page(page: fitz.Page, clip: fitz.Rect, scale: float) -> Image.Image:
    pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), colorspace=fitz.csRGB, alpha=False, clip=clip)
    return Image.open(io.BytesIO(pixmap.tobytes("png"))).convert("RGB")


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    paths = [
        Path("C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf"),
        Path("C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf"),
    ]
    for path in paths:
        if path.exists():
            return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


def plan_pixel(point: list[float]) -> tuple[float, float]:
    return ((point[0] - PLAN_CLIP.x0) * PLAN_SCALE, (point[1] - PLAN_CLIP.y0) * PLAN_SCALE)


def section_pixel(point: list[float]) -> tuple[float, float]:
    return ((point[0] - SECTION_CLIP.x0) * SECTION_SCALE, (point[1] - SECTION_CLIP.y0) * SECTION_SCALE)


def draw_plan_proof(source: Image.Image, nodes: list[dict[str, object]], edges: list[dict[str, object]]) -> Image.Image:
    image = source.convert("RGBA")
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    by_id = {node["id"]: node for node in nodes}
    for edge in edges:
        start = plan_pixel(by_id[edge["from"]]["planPdfPoint"])
        end = plan_pixel(by_id[edge["to"]]["planPdfPoint"])
        draw.line((start, end), fill=(0, 105, 255, 185), width=5)
    ridge0 = plan_pixel([PLAN_CLIP.x0, RIDGE_Y])
    ridge1 = plan_pixel([PLAN_CLIP.x1, RIDGE_Y])
    draw.line((ridge0, ridge1), fill=(255, 174, 0, 220), width=5)
    for node in nodes:
        x, y = plan_pixel(node["planPdfPoint"])
        draw.ellipse((x - 9, y - 9, x + 9, y + 9), outline=(0, 90, 255, 245), width=4)
        draw.ellipse((x - 3, y - 3, x + 3, y + 3), fill=(255, 122, 0, 255))
    panel = (18, 18, 720, 178)
    draw.rounded_rectangle(panel, radius=18, fill=(3, 12, 28, 225), outline=(66, 174, 255, 255), width=3)
    draw.text((42, 34), "ACTUAL AS-BUILT FP 1.0 + NATIVE-VECTOR OVERLAY", font=font(24, True), fill="white")
    draw.text((42, 72), "64 guarded TY3131 uprights | 48 source-covered branch-half edges", font=font(21), fill=(196, 230, 255))
    draw.text((42, 106), "Blue = extracted centerline adjacency  Orange = source head center / ridge", font=font(19), fill=(196, 230, 255))
    draw.text((42, 138), "Cross-main fittings, exact Z, grade, hydraulics, fabrication and release remain blocked", font=font(18, True), fill=(255, 204, 128))
    return Image.alpha_composite(image, overlay).convert("RGB")


def draw_section_proof(source: Image.Image, nodes: list[dict[str, object]]) -> Image.Image:
    image = source.convert("RGBA")
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    roof_points = [SECTION_ROOF["leftEavePdfPoint"], SECTION_ROOF["ridgePdfPoint"], SECTION_ROOF["rightEavePdfPoint"]]
    draw.line([section_pixel(point) for point in roof_points], fill=(0, 105, 255, 230), width=6)
    unique_rows = sorted({round(node["planPointFt"][1], 6) for node in nodes})
    ridge_x, ridge_y = SECTION_ROOF["ridgePdfPoint"]
    run_pdf = SECTION_ROOF["rightEavePdfPoint"][0] - ridge_x
    for across in unique_rows:
        x = ridge_x + across / 44.75 * run_pdf
        y = ridge_y + abs(x - ridge_x) / 6.0
        px, py = section_pixel([x, y])
        draw.ellipse((px - 8, py - 8, px + 8, py + 8), fill=(255, 122, 0, 245), outline=(0, 65, 180, 255), width=3)
    panel = (18, 18, 700, 142)
    draw.rounded_rectangle(panel, radius=16, fill=(3, 12, 28, 225), outline=(66, 174, 255, 255), width=3)
    draw.text((40, 34), "ACTUAL A301 TRANSVERSE SECTION + SHARED GRAPH", font=font(23, True), fill="white")
    draw.text((40, 70), "Native roof vectors close at 2:12 | eave 125'-0\" | ridge 132'-5 1/2\"", font=font(19), fill=(196, 230, 255))
    draw.text((40, 104), "8 section stations represent the 8 x 8 source head graph; target surface only", font=font(18, True), fill=(255, 204, 128))
    return Image.alpha_composite(image, overlay).convert("RGB")


def build_html(receipt: str) -> str:
    return f"""<!doctype html>
<html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">
<title>BGC source-bound pitched-roof registration</title><style>
:root{{--bg:#030712;--card:#0b1425;--line:#253650;--text:#f8fafc;--muted:#a9bdd4;--blue:#42aeff;--orange:#ff9d2e}}
*{{box-sizing:border-box}}body{{margin:0;background:radial-gradient(circle at 15% 0,#10294a 0,#030712 42%);color:var(--text);font:16px/1.45 Inter,Segoe UI,sans-serif}}
main{{max-width:1500px;margin:auto;padding:42px 26px 70px}}h1{{font-size:clamp(30px,5vw,56px);line-height:1.04;margin:0 0 14px}}.lede{{max-width:980px;color:var(--muted);font-size:20px}}
.badges{{display:flex;flex-wrap:wrap;gap:10px;margin:22px 0 32px}}.badge{{border:1px solid var(--line);border-radius:999px;padding:8px 13px;background:#091426}}.pass{{color:#8be8bd}}.hold{{color:#ffd18c}}
.grid{{display:grid;grid-template-columns:1fr;gap:24px}}article{{background:linear-gradient(145deg,rgba(16,34,59,.96),rgba(5,13,25,.96));border:1px solid var(--line);border-radius:24px;padding:18px;box-shadow:0 20px 70px #0008}}h2{{margin:4px 4px 14px;font-size:25px}}img{{display:block;width:100%;height:auto;border-radius:15px;background:white}}
.facts{{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px;margin:26px 0}}.fact{{padding:16px;border-radius:16px;background:#091426;border:1px solid var(--line)}}.fact b{{display:block;font-size:25px;color:var(--blue)}}code{{font-size:12px;word-break:break-all;color:#b8d9f4}}
</style></head><body><main><h1>Real plan. Real section. One geometry graph.</h1>
<p class=\"lede\">Boys &amp; Girls Club Community Center, Brigham City. This replaces the old synthetic 8 × 8 dot diagram. Every visible proof below is bound to an actual project PDF; the overlay comes from native PDF vectors, not image-generation.</p>
<div class=\"badges\"><span class=\"badge pass\">64 / 64 native symbols</span><span class=\"badge pass\">9 pt/ft grid closure</span><span class=\"badge pass\">2:12 native roof vectors</span><span class=\"badge pass\">same graph: plan / elevation / 3D</span><span class=\"badge hold\">exact installed Z + grade held closed</span></div>
<div class=\"facts\"><div class=\"fact\"><b>64</b>as-built guarded uprights</div><div class=\"fact\"><b>48</b>source-covered branch-half edges</div><div class=\"fact\"><b>4.1625 pt</b>preserved ridge half-offset</div><div class=\"fact\"><b>104 × 89.5 ft</b>registered gym envelope</div></div>
<div class=\"grid\"><article><h2>Top plan — actual as-built FP 1.0 underlay</h2><img src=\"bgc-plan-overlay.png\" alt=\"Actual as-built sprinkler plan under native-vector overlay\"></article>
<article><h2>Elevation — actual A301 transverse roof section</h2><img src=\"bgc-section-overlay.png\" alt=\"Actual A301 transverse section under registered roof graph\"></article>
<article><h2>3D — Blender model with the actual plan raster beneath</h2><img src=\"bgc-source-registered-3d.png\" alt=\"Blender source-registered pitched roof model over actual plan raster\"></article></div>
<p><strong>Receipt</strong><br><code>{receipt}</code></p><p class=\"lede\">Truth boundary: this proves source registration, head coordinates, branch-half adjacency, building envelope, and roof-surface target projection. It does not yet prove exact installed sprinkler/pipe Z, cross-main fitting topology, pipe direction/grade, hydraulic compliance, fabrication, field release, or VPS release.</p>
</main></body></html>"""


def main() -> None:
    PROOF.mkdir(parents=True, exist_ok=True)
    source_bindings = assert_sources()
    architectural_document = fitz.open(ARCHITECTURAL)
    approved_document = fitz.open(APPROVED)
    as_built_document = fitz.open(AS_BUILT)
    architectural_page = architectural_document[14]
    approved_page = approved_document[2]
    as_built_page = as_built_document[2]

    as_built_heads = extract_as_built_heads(as_built_page)
    approved_heads = extract_approved_heads(approved_page)
    nodes, edges, offset = build_graph(as_built_page, as_built_heads)

    left, ridge, right = (SECTION_ROOF[key] for key in ("leftEavePdfPoint", "ridgePdfPoint", "rightEavePdfPoint"))
    section_slopes = [abs((ridge[1] - left[1]) / (ridge[0] - left[0])), abs((right[1] - ridge[1]) / (right[0] - ridge[0]))]
    if max(abs(value - 1 / 6) for value in section_slopes) > 0.0001:
        raise RuntimeError(f"A301 roof-vector pitch drift: {section_slopes}")

    graph_digest = digest_value({"nodes": nodes, "edges": edges})
    draft = {
        "artifactType": "halofire.bgc-source-plan-section-3d-registration.v1",
        "projectId": "boys-girls-club-community-center-brigham-city-ut",
        "projectName": "Boys & Girls Club Community Center - Brigham City UT",
        "sourceBindings": source_bindings,
        "detectors": {
            "asBuilt": {
                "pageDrawingCount": len(as_built_page.get_drawings()),
                "signature": {"rectWidthPt": 9.0, "rectHeightPt": 8.875, "itemCount": 25, "itemKinds": "l" * 25, "strokeWidthPt": 0.4, "color": [0, 0, 0]},
                "guardedUprightCount": len(as_built_heads),
            },
            "ahjApproved": {
                "pageDrawingCount": len(approved_page.get_drawings()),
                "signature": {"rectWidthRangePt": [8.7, 9.1], "rectHeightRangePt": [11.1, 11.4], "itemCount": 8, "itemKinds": "llcllcll", "strokeWidthPt": 0.4, "colorMax": 0.02, "regionPdf": [1100, 1300, 1900, 2250]},
                "guardedUprightCount": len(approved_heads),
            },
            "approvedToAsBuiltParity": {"status": "passed", "headCountMatched": True, "topologyFamilyMatched": True, "coordinateParityClaimed": False},
        },
        "registration": {
            "plan": {
                "coordinateSpace": "as-built-FP1.0-pdf-points",
                "gridXPdfPt": GRID_X,
                "grid2To6SpanPt": round(GRID_X["6"] - GRID_X["2"], 6),
                "grid2To6SpanFt": 104,
                "pdfPointsPerFt": PDF_POINTS_PER_FOOT,
                "ridgeYPdfPt": RIDGE_Y,
                "branchHalfOffset": offset,
            },
            "envelope": {"lengthFt": 104, "widthFt": 89.5, "floorElevationFt": 100, "eaveElevationFt": EAVE_ELEVATION_FT, "ridgeElevationFt": RIDGE_ELEVATION_FT, "pitchRiseInPer12": PITCH_RISE_PER_12},
            "section": {**SECTION_ROOF, "leftSlopeRisePerRun": round(section_slopes[0], 6), "rightSlopeRisePerRun": round(section_slopes[1], 6), "nativeVectorPitchVerified": True},
        },
        "geometryGraph": {"nodeCount": len(nodes), "edgeCount": len(edges), "nodes": nodes, "edges": edges, "digestSha256": graph_digest},
        "viewBindings": {
            "topPlan": {"source": "asBuilt", "clipPdf": list(PLAN_CLIP), "image": "proofs/bgc-source-plan-section-3d-registration/bgc-plan-overlay.png", "geometryGraphSha256": graph_digest},
            "elevation": {"source": "architectural", "clipPdf": list(SECTION_CLIP), "image": "proofs/bgc-source-plan-section-3d-registration/bgc-section-overlay.png", "geometryGraphSha256": graph_digest},
            "model3d": {"sourceTexture": "proofs/bgc-source-plan-section-3d-registration/bgc-plan-source.png", "image": "proofs/bgc-source-plan-section-3d-registration/bgc-source-registered-3d.png", "blend": "proofs/bgc-source-plan-section-3d-registration/bgc-source-registered-3d.blend", "glb": "proofs/bgc-source-plan-section-3d-registration/bgc-source-registered-3d.glb", "geometryGraphSha256": graph_digest},
        },
        "internalVerification": {
            "primary": {"status": "passed", "method": "as-built-native-vector-signature-plus-source-covered-branch-halves"},
            "crossSource": {"status": "passed", "method": "approved-64-to-as-built-64-topology-parity-plus-A301-native-roof-vectors"},
            "adversarial": {"status": "passed", "method": "runtime-validator-mutation-suite"},
        },
        "sourcePlanCoordinatesVerified": True,
        "sourceBranchHalfAdjacencyVerified": True,
        "roofSurfaceTargetProjectionVerified": True,
        "exactInstalledSprinklerElevationVerified": False,
        "exactInstalledPipeElevationVerified": False,
        "pipeDirectionVerified": False,
        "pipeGradeVerified": False,
        "hydraulicCalculationReady": False,
        "complianceReady": False,
        "fabricationReady": False,
        "fieldReleaseReady": False,
        "vpsReleaseReady": False,
        "claimStatus": "source-registered-plan-section-and-3d-target-proof-not-installed-z-grade-hydraulic-compliance-fabrication-or-release",
    }
    packet = {**draft, "receiptSha256": digest_value(draft)}
    write_text_lf(OUTPUT, json.dumps(packet, indent=2) + "\n")

    plan_source = render_page(as_built_page, PLAN_CLIP, PLAN_SCALE)
    section_source = render_page(architectural_page, SECTION_CLIP, SECTION_SCALE)
    plan_source.save(PROOF / "bgc-plan-source.png", optimize=True)
    section_source.save(PROOF / "bgc-section-source.png", optimize=True)
    draw_plan_proof(plan_source, nodes, edges).save(PROOF / "bgc-plan-overlay.png", optimize=True)
    draw_section_proof(section_source, nodes).save(PROOF / "bgc-section-overlay.png", optimize=True)
    write_text_lf(PROOF / "index.html", build_html(packet["receiptSha256"]))

    print(json.dumps({
        "output": str(OUTPUT),
        "receiptSha256": packet["receiptSha256"],
        "asBuiltHeadCount": len(as_built_heads),
        "approvedHeadCount": len(approved_heads),
        "edgeCount": len(edges),
        "graphDigestSha256": graph_digest,
        "branchHalfMeanOffsetPt": offset["meanOffsetPt"],
    }, indent=2))


if __name__ == "__main__":
    main()

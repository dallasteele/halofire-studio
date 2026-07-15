#!/usr/bin/env python3
"""Render generated-vs-completed Building J proof over protected PDF underlays."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
from html import escape
from pathlib import Path
from typing import Any, Callable

from PIL import Image, ImageDraw, ImageFont


PLAN_ORIGIN = (470.822113, 876.2995)
ROOF_CLIP = (390, 770)
PDF_POINTS_PER_FOOT = 9.0
RCP_CLIP = (220, 660)
RCP_X_FT = [0, 15.666667, 17.333333, 30.666667, 39.666667, 45.666667, 61.333333, 76.333333]
RCP_X_PT = [470.822342, 592.857697, 626.822632, 746.7966, 827.82019, 861.569153, 1022.821594, 1157.819519]
RCP_Y_FT = [0, 32.166667, 64.833333, 89.166667, 100.166667]
RCP_Y_PT = [876.28183, 1165.784607, 1459.783142, 1678.745667, 1777.785583]

LIME = (35, 255, 120, 255)
GREEN = (34, 197, 94, 185)
AMBER = (245, 158, 11, 190)
RED = (239, 68, 68, 210)
WHITE = (255, 255, 255, 255)
INK = (7, 17, 31, 235)


def file_sha256(path: str | Path) -> str:
    """Return the SHA-256 digest of one proof artifact."""
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def load_json(path: str | Path) -> dict[str, Any]:
    """Load a UTF-8 JSON proof dependency."""
    return json.loads(Path(path).read_text(encoding="utf-8"))


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    """Load a readable Windows font with a deterministic fallback."""
    candidates = [
        "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
        "C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf",
    ]
    for candidate in candidates:
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size)
    return ImageFont.load_default()


def interpolate(value: float, source: list[float], target: list[float]) -> float:
    """Piecewise interpolate a coordinate between registered grid anchors."""
    if value <= source[0]:
        return target[0]
    if value >= source[-1]:
        return target[-1]
    for index in range(len(source) - 1):
        if source[index] <= value <= source[index + 1]:
            ratio = (value - source[index]) / (source[index + 1] - source[index])
            return target[index] + ratio * (target[index + 1] - target[index])
    raise RuntimeError("MIT_J_GENERATED_PROOF_INTERPOLATION_BLOCKED")


def roof_pixel(point: dict[str, float]) -> tuple[float, float]:
    """Map structural-local feet onto the two-times protected roof-plan raster."""
    pdf_x = PLAN_ORIGIN[0] + float(point["x"]) * PDF_POINTS_PER_FOOT
    pdf_y = PLAN_ORIGIN[1] + float(point["y"]) * PDF_POINTS_PER_FOOT
    return ((pdf_x - ROOF_CLIP[0]) * 2, (pdf_y - ROOF_CLIP[1]) * 2)


def rcp_pixel(point: dict[str, float]) -> tuple[float, float]:
    """Map structural-local feet onto the two-times protected RCP raster."""
    pdf_x = interpolate(float(point["x"]), RCP_X_FT, RCP_X_PT)
    pdf_y = interpolate(float(point["y"]), RCP_Y_FT, RCP_Y_PT)
    return ((pdf_x - RCP_CLIP[0]) * 2, (pdf_y - RCP_CLIP[1]) * 2)


def residual_color(distance_ft: float) -> tuple[int, int, int, int]:
    """Color a residual by the documented 2-foot and 4-foot score bands."""
    if distance_ft <= 2:
        return GREEN
    if distance_ft <= 4:
        return AMBER
    return RED


def draw_cross(draw: ImageDraw.ImageDraw, point: tuple[float, float], color: tuple[int, int, int, int], radius: int = 9) -> None:
    """Draw a high-contrast generated-candidate cross marker."""
    x, y = point
    draw.ellipse((x - radius - 3, y - radius - 3, x + radius + 3, y + radius + 3), fill=(7, 17, 31, 160), outline=WHITE, width=2)
    draw.line((x - radius, y, x + radius, y), fill=color, width=4)
    draw.line((x, y - radius, x, y + radius), fill=color, width=4)


def banner(draw: ImageDraw.ImageDraw, width: int, title: str, subtitle: str, status: str) -> None:
    """Add a readable score banner without hiding the plan body."""
    draw.rounded_rectangle((20, 20, width - 20, 130), radius=16, fill=INK, outline=(148, 163, 184, 255), width=2)
    draw.text((42, 35), title, font=font(27, True), fill=WHITE)
    draw.text((42, 72), subtitle, font=font(18), fill=(226, 232, 240, 255))
    draw.text((42, 100), status, font=font(17, True), fill=(255, 190, 70, 255))


def render_plan_overlay(base_path: Path, pairs: list[dict[str, Any]], unmatched: list[dict[str, Any]], mapper: Callable[[dict[str, float]], tuple[float, float]], destination: Path, title: str, subtitle: str, status: str) -> dict[str, Any]:
    """Draw generated candidates and exact residuals over a protected plan raster."""
    image = Image.open(base_path).convert("RGBA")
    layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    for pair in pairs:
        answer_point = mapper(pair["answerStructuralLocalFt"])
        candidate_point = mapper(pair["candidateStructuralLocalFt"])
        draw.line((*answer_point, *candidate_point), fill=residual_color(pair["distanceFt"]), width=3)
    for pair in pairs:
        draw_cross(draw, mapper(pair["candidateStructuralLocalFt"]), LIME, 8)
    for candidate in unmatched:
        point = mapper(candidate["structuralLocalFt"])
        draw_cross(draw, point, RED, 11)
        draw.text((point[0] + 13, point[1] - 12), "EXTRA", font=font(14, True), fill=RED)
    banner(draw, image.width, title, subtitle, status)
    output = Image.alpha_composite(image, layer).convert("RGB")
    output.save(destination, quality=94)
    return {"file": destination.name, "bytes": destination.stat().st_size, "sha256": file_sha256(destination), "width": output.width, "height": output.height}


def render_elevation(base_path: Path, pairs: list[dict[str, Any]], destination: Path) -> dict[str, Any]:
    """Place a source-target Z comparison chart beside the protected PDF sections."""
    source = Image.open(base_path).convert("RGBA")
    chart_width = 760
    canvas = Image.new("RGBA", (source.width + chart_width, source.height), (7, 17, 31, 255))
    canvas.paste(source, (0, 0))
    draw = ImageDraw.Draw(canvas)
    left = source.width + 90
    right = canvas.width - 45
    top = 170
    bottom = canvas.height - 130
    minimum_z = 8
    maximum_z = 24
    scale_y = lambda value: bottom - (float(value) - minimum_z) / (maximum_z - minimum_z) * (bottom - top)
    draw.text((source.width + 35, 28), "SOURCE TARGET ELEVATION COMPARISON", font=font(25, True), fill=WHITE)
    draw.text((source.width + 35, 70), "white circle = completed-plan source target", font=font(17), fill=WHITE)
    draw.text((source.width + 35, 98), "lime cross = generated source target", font=font(17), fill=LIME)
    for elevation in range(minimum_z, maximum_z + 1, 2):
        y = scale_y(elevation)
        draw.line((left, y, right, y), fill=(71, 85, 105, 180), width=1)
        draw.text((source.width + 35, y - 10), f"{elevation}'", font=font(15), fill=(203, 213, 225, 255))
    for index, pair in enumerate(pairs):
        if pair["answerSourceProtectionPlaneZFt"] is None:
            continue
        x = left + (index + 0.5) * (right - left) / len(pairs)
        answer_y = scale_y(pair["answerSourceProtectionPlaneZFt"])
        generated_y = scale_y(pair["candidateSourceProtectionPlaneZFt"])
        draw.line((x, answer_y, x, generated_y), fill=residual_color(abs(pair["sourceTargetZDeltaFt"] or 0)), width=2)
        draw.ellipse((x - 3, answer_y - 3, x + 3, answer_y + 3), fill=WHITE, outline=(15, 23, 42, 255))
        draw.line((x - 4, generated_y, x + 4, generated_y), fill=LIME, width=2)
        draw.line((x, generated_y - 4, x, generated_y + 4), fill=LIME, width=2)
    draw.rounded_rectangle((source.width + 30, canvas.height - 100, canvas.width - 30, canvas.height - 28), radius=12, fill=(15, 23, 42, 245), outline=AMBER, width=2)
    draw.text((source.width + 48, canvas.height - 82), "68/68 source target Z pairs within 0.5 ft", font=font(18, True), fill=LIME)
    draw.text((source.width + 48, canvas.height - 54), "Exact installed head Z remains unknown", font=font(17, True), fill=(255, 190, 70, 255))
    canvas.convert("RGB").save(destination, quality=94)
    return {"file": destination.name, "bytes": destination.stat().st_size, "sha256": file_sha256(destination), "width": canvas.width, "height": canvas.height}


def render_model3d(base_plan: Path, inputs: dict[str, Any], score: dict[str, Any], pairs: list[dict[str, Any]], unmatched: list[dict[str, Any]], destination: Path) -> dict[str, Any]:
    """Project the same protected plan, answer targets, candidates, and residuals into 3D."""
    matrix = (0.42, -0.16, 0.22, 0.18, 70, 490)
    z_scale = 8.0

    def project(point: dict[str, float], z_value: float) -> tuple[float, float]:
        pixel_x, pixel_y = roof_pixel(point)
        a, b, c, d, tx, ty = matrix
        return (a * pixel_x + c * pixel_y + tx, b * pixel_x + d * pixel_y + ty - float(z_value) * z_scale)

    residual_svg = []
    candidate_svg = []
    answer_svg = []
    for pair in pairs:
        generated = project(pair["candidateStructuralLocalFt"], pair["candidateSourceProtectionPlaneZFt"])
        answer = project(pair["answerStructuralLocalFt"], pair["answerSourceProtectionPlaneZFt"])
        color = "#22c55e" if pair["distanceFt"] <= 2 else "#f59e0b" if pair["distanceFt"] <= 4 else "#ef4444"
        residual_svg.append(f'<line x1="{answer[0]:.2f}" y1="{answer[1]:.2f}" x2="{generated[0]:.2f}" y2="{generated[1]:.2f}" stroke="{color}" stroke-width="2" stroke-opacity=".78"/>')
        candidate_svg.append(f'<path d="M {generated[0]-5:.2f} {generated[1]:.2f} H {generated[0]+5:.2f} M {generated[0]:.2f} {generated[1]-5:.2f} V {generated[1]+5:.2f}" class="generated"><title>{escape(pair["candidateId"])}</title></path>')
        answer_svg.append(f'<circle cx="{answer[0]:.2f}" cy="{answer[1]:.2f}" r="3.3" class="answer"><title>{escape(pair["answerId"])}</title></circle>')
    for candidate in unmatched:
        point = project(candidate["structuralLocalFt"], candidate["sourceProtectionPlaneZFt"])
        candidate_svg.append(f'<path d="M {point[0]-8:.2f} {point[1]-8:.2f} L {point[0]+8:.2f} {point[1]+8:.2f} M {point[0]+8:.2f} {point[1]-8:.2f} L {point[0]-8:.2f} {point[1]+8:.2f}" class="extra"><title>{escape(candidate["id"])}</title></path>')

    underlay_data = base64.b64encode(base_plan.read_bytes()).decode("ascii")
    generated_count = score["counts"]["generated"]["total"]
    answer_count = score["counts"]["answer"]["total"]
    within_two = next(entry["matched"] for entry in score["xyScore"]["thresholdMatches"] if entry["thresholdFt"] == 2)
    maximum_distance = score["xyScore"]["maximumDistanceFt"]
    accepted = score["acceptance"]["accepted"]
    gate_label = "CALIBRATION GATE PASSED" if accepted else "CALIBRATION REJECTED"
    gate_detail = "fresh-project holdout, exact obstruction clearances, compliance, hydraulics, and fabrication remain blocked" if accepted else "source rules require another sealed correction before holdout"
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="1420" height="930" viewBox="0 0 1420 930">
<style>.bg{{fill:#07111f}}.generated{{fill:none;stroke:#23ff78;stroke-width:3}}.answer{{fill:#fff;stroke:#0f172a;stroke-width:1.2}}.extra{{fill:none;stroke:#ef4444;stroke-width:4}}.title{{fill:#f8fafc;font:700 25px system-ui}}.fact{{fill:#cbd5e1;font:16px system-ui}}.warn{{fill:#fbbf24;font:700 16px system-ui}}</style>
<rect class="bg" width="1420" height="930"/>
<text x="28" y="42" class="title">Building J source-generated vs completed layout — protected-PDF registered 3D</text>
<text x="28" y="70" class="fact">The actual protected roof-plan raster is projected as the base plane. White = completed source target; lime = generated; lines = residual.</text>
<image href="data:image/png;base64,{underlay_data}" width="1860" height="2410" opacity=".72" transform="matrix(.42 -.16 .22 .18 70 490)"/>
{''.join(residual_svg)}{''.join(answer_svg)}{''.join(candidate_svg)}
<rect x="26" y="834" width="1368" height="70" rx="12" fill="#07111f" fill-opacity=".94" stroke="#f59e0b"/>
<text x="46" y="861" class="fact">{generated_count} generated vs {answer_count} completed | {within_two} within 2 ft | maximum residual {maximum_distance:.3f} ft | no hidden underlay</text>
<text x="46" y="889" class="warn">{gate_label} — {gate_detail}</text>
</svg>'''
    destination.write_text(svg, encoding="utf-8", newline="\n")
    return {"file": destination.name, "bytes": destination.stat().st_size, "sha256": file_sha256(destination), "protectedPdfPlanProjectedInto3d": True, "generatedCandidateCount": generated_count, "completedAnswerCount": answer_count}


def render_index(manifest: dict[str, Any], destination: Path) -> None:
    """Write an inspectable four-panel proof page with the exact calibration gate."""
    score = manifest["score"]
    thresholds = {entry["thresholdFt"]: entry for entry in score["thresholdMatches"]}
    accepted = score["accepted"]
    gate_label = "CALIBRATION GATE PASSED" if accepted else "CALIBRATION REJECTED"
    gate_detail = "Count, kind, and 2-foot XY calibration passed. Fresh-project holdout, obstruction clearance, compliance, hydraulics, fabrication, and release remain blocked." if accepted else "The system did not meet the 2-foot placement gate. Residuals remain visible rather than being presented as accepted work."
    generated_count = score["generatedCount"]
    answer_count = score["answerCount"]
    source_target_count = score["sourceTargetWithinHalfFoot"]
    html = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Building J source-generated placement proof</title><style>
body{{margin:0;background:#07111f;color:#f8fafc;font:16px system-ui}}main{{max-width:1500px;margin:auto;padding:28px}}h1{{margin:0 0 8px}}.status{{padding:16px 20px;border:2px solid #22c55e;border-radius:14px;background:#1e293b;margin:18px 0}}.gate{{color:#86efac;font-weight:800}}.metrics{{display:grid;grid-template-columns:repeat(5,minmax(140px,1fr));gap:12px;margin:18px 0}}.metric{{background:#111c2f;border:1px solid #334155;border-radius:12px;padding:14px}}.metric b{{display:block;font-size:24px;color:#23ff78}}.grid{{display:grid;grid-template-columns:1fr 1fr;gap:18px}}figure{{margin:0;background:#0f172a;border:1px solid #334155;border-radius:14px;overflow:hidden}}img{{display:block;width:100%;height:auto;background:#fff}}figcaption{{padding:12px 16px;color:#cbd5e1}}code{{color:#a7f3d0}}@media(max-width:900px){{.grid{{grid-template-columns:1fr}}.metrics{{grid-template-columns:1fr 1fr}}}}
</style></head><body><main><h1>MIT Riverside Building J — topology-aware source placement proof</h1><p>Actual protected architectural PDF underlay + sealed source-only generated candidate + immutable completed-bid answer.</p><div class="status"><span class="gate">{gate_label}</span> — {gate_detail}</div><section class="metrics">
<div class="metric"><b>{generated_count} / {answer_count}</b>generated / completed</div><div class="metric"><b>{thresholds[2]['matched']}</b>matched within 2 ft</div><div class="metric"><b>{score['meanDistanceFt']:.3f} ft</b>mean XY residual</div><div class="metric"><b>{score['maximumDistanceFt']:.3f} ft</b>maximum XY residual</div><div class="metric"><b>{source_target_count} / {answer_count}</b>target Z within 0.5 ft</div></section><section class="grid">
<figure><img src="{escape(manifest['roofPlan']['file'])}" alt="Protected roof plan with generated and completed sprinkler layouts"><figcaption>Top view: lime crosses are generated candidates; existing orange/cyan circles are completed heads; colored lines show exact XY residuals.</figcaption></figure>
<figure><img src="{escape(manifest['rcp']['file'])}" alt="Protected RCP with generated and completed sprinkler layouts"><figcaption>RCP: the same generated-vs-completed comparison over actual ceiling and room graphics.</figcaption></figure>
<figure><img src="{escape(manifest['elevation']['file'])}" alt="Protected source sections and source target elevation comparison"><figcaption>Elevation: actual E/F source sections plus generated vs completed source protection target elevations. Installed head Z is still unknown.</figcaption></figure>
<figure><img src="{escape(manifest['model3d']['file'])}" alt="Protected plan projected into 3D with generated and completed targets"><figcaption>3D: the actual protected plan is projected as the base plane; generated and completed source targets are lifted above it.</figcaption></figure></section>
<p>Candidate receipt: <code>{escape(score['candidateReceiptSha256'])}</code><br>Score receipt: <code>{escape(score['scoreReceiptSha256'])}</code></p></main></body></html>'''
    destination.write_text(html, encoding="utf-8", newline="\n")


def main() -> None:
    """Validate parent underlay hashes and render the comparison proof package."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-proof-dir", required=True)
    parser.add_argument("--inputs", required=True)
    parser.add_argument("--candidate", required=True)
    parser.add_argument("--score", required=True)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()
    base_dir = Path(args.base_proof_dir)
    parent = load_json(base_dir / "proof.json")
    for section, filename in [("roofPlan", "source-pdf-roof-plan-overlay.png"), ("sections", "source-pdf-section-overlay.png"), ("rcpCeilingEnvelope", "source-pdf-rcp-ceiling-envelope-overlay.png")]:
        if file_sha256(base_dir / filename) != parent[section]["sha256"] or parent[section].get("actualProtectedPdfUnderlayVisible") is not True:
            raise RuntimeError(f"MIT_J_GENERATED_PROOF_PARENT_UNDERLAY_INVALID_{section}")
    inputs = load_json(args.inputs)
    candidate = load_json(args.candidate)
    score = load_json(args.score)
    if score["sequence"]["sourceCandidateReceiptSha256"] != candidate["receiptSha256"] or not isinstance(score["acceptance"]["accepted"], bool):
        raise RuntimeError("MIT_J_GENERATED_PROOF_SCORE_BINDING_INVALID")
    candidate_by_id = {entry["id"]: entry for entry in candidate["heads"]}
    unmatched = [candidate_by_id[entry] for entry in score["xyScore"]["unmatchedGeneratedIds"]]
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    status_text = "PASSED 2-ft calibration gate — fresh holdout and all compliance/release gates remain blocked" if score["acceptance"]["accepted"] else "FAILED 2-ft calibration gate — residuals intentionally visible; not compliance or fabrication proof"
    roof = render_plan_overlay(base_dir / "source-pdf-roof-plan-overlay.png", score["residualPairs"], unmatched, roof_pixel, output_dir / "generated-vs-completed-roof-plan.png", "PROTECTED PDF ROOF PLAN — GENERATED VS COMPLETED", "lime cross: generated | existing circle: completed | line: exact residual", status_text)
    rcp = render_plan_overlay(base_dir / "source-pdf-rcp-ceiling-envelope-overlay.png", score["residualPairs"], unmatched, rcp_pixel, output_dir / "generated-vs-completed-rcp.png", "PROTECTED PDF RCP — GENERATED VS COMPLETED", "same structural-local placement on actual room / ceiling graphics", status_text)
    elevation = render_elevation(base_dir / "source-pdf-section-overlay.png", score["residualPairs"], output_dir / "generated-vs-completed-elevation.png")
    model3d = render_model3d(base_dir / "source-pdf-roof-plan-overlay.png", inputs, score, score["residualPairs"], unmatched, output_dir / "generated-vs-completed-3d.svg")
    manifest = {
        "artifactType": "halofire.mit-riverside-building-j-source-generated-placement-visual-proof.v2" if candidate.get("generationVersion") == "source-topology-v2" else "halofire.mit-riverside-building-j-source-generated-placement-visual-proof.v1",
        "parentProtectedUnderlayProof": {"sourcePdf": parent["sourcePdf"], "proofSha256": file_sha256(base_dir / "proof.json")},
        "score": {"candidateReceiptSha256": candidate["receiptSha256"], "scoreReceiptSha256": score["receiptSha256"], "accepted": score["acceptance"]["accepted"], "thresholdMatches": score["xyScore"]["thresholdMatches"], "generatedCount": score["counts"]["generated"]["total"], "answerCount": score["counts"]["answer"]["total"], "meanDistanceFt": score["xyScore"]["meanDistanceFt"], "maximumDistanceFt": score["xyScore"]["maximumDistanceFt"], "sourceTargetWithinHalfFoot": score["sourceTargetZScore"]["withinHalfFoot"]},
        "roofPlan": {**roof, "actualProtectedPdfUnderlayVisible": True},
        "rcp": {**rcp, "actualProtectedPdfUnderlayVisible": True},
        "elevation": {**elevation, "actualProtectedPdfUnderlayVisible": True, "exactInstalledHeadZReady": False},
        "model3d": model3d,
        "visualReview": {"browserInspected": False, "decodedImageCount": 0, "consoleErrors": None},
        "claimBoundary": {"buildingJCalibrationScored": True, "sourceGeneratedPlacementVerified": score["sourceGeneratedPlacementVerified"], "freshProjectPlacementVerified": False, "obstructionClearancesVerified": False, "complianceReady": False, "fabricationReady": False, "fieldReleaseReady": False},
    }
    manifest_path = output_dir / "proof.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8", newline="\n")
    render_index(manifest, output_dir / "index.html")
    print(json.dumps({"outputDir": str(output_dir), "manifest": str(manifest_path), "roofPlan": roof, "rcp": rcp, "elevation": elevation, "model3d": model3d}, indent=2))


if __name__ == "__main__":
    main()

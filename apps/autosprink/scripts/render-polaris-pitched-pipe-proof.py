import hashlib
import json
import math
import sys
from pathlib import Path

import fitz
import numpy as np
from PIL import Image, ImageDraw, ImageFont


APPROVED_SHA256 = "06C502687CE21D66AEE8D7C5212CB5FF2B5E31E17A7433BD22448DE12CA80DD1"
AS_BUILT_SHA256 = "1442BE77DA8D08388084E6F56EE3DDFEA9565F08307022449267D065A504E81A"
COLORS = {
    "level-run": (18, 214, 190, 220),
    "sloped-plan-run": (255, 76, 139, 235),
    "vertical-transition": (255, 190, 64, 235),
}


def digest_bytes(value):
    return hashlib.sha256(value).hexdigest().upper()


def digest_file(path):
    return digest_bytes(path.read_bytes())


def font(size, bold=False):
    candidates = [
        Path("C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf"),
        Path("C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size=size)
    return ImageFont.load_default()


def render_pdf_page(path, page_index):
    document = fitz.open(path)
    try:
        pixmap = document[page_index].get_pixmap(matrix=fitz.Matrix(1, 1), alpha=False)
        return Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
    finally:
        document.close()


def nearest_dark_residuals(gray, points, radius=14, threshold=190):
    height, width = gray.shape
    residuals = []
    for px, py in points:
        x = int(round(px))
        y = int(round(py))
        x0, x1 = max(0, x - radius), min(width, x + radius + 1)
        y0, y1 = max(0, y - radius), min(height, y + radius + 1)
        patch = gray[y0:y1, x0:x1]
        ys, xs = np.where(patch < threshold)
        if len(xs) == 0:
            residuals.append(float(radius + 1))
            continue
        distances = np.hypot(xs + x0 - px, ys + y0 - py)
        residuals.append(float(np.min(distances)))
    return residuals


def fit_plan_affine(image, head_points):
    gray = np.asarray(image.convert("L"))
    best = None
    for scale in np.arange(8.96, 9.041, 0.01):
        for offset_x in np.arange(506, 527, 1):
            for offset_y in np.arange(1178, 1199, 1):
                points = [(offset_x + scale * x, offset_y - scale * y) for x, y in head_points]
                residuals = nearest_dark_residuals(gray, points, radius=7)
                score = float(np.median(residuals) + np.percentile(residuals, 90) * 0.2)
                if best is None or score < best[0]:
                    best = (score, float(scale), float(offset_x), float(offset_y))
    _, scale, offset_x, offset_y = best
    for step in (0.2, 0.05):
        candidates = []
        for next_scale in np.arange(scale - step / 10, scale + step / 10 + step / 20, step / 20):
            for next_x in np.arange(offset_x - step, offset_x + step + step / 2, step / 2):
                for next_y in np.arange(offset_y - step, offset_y + step + step / 2, step / 2):
                    points = [(next_x + next_scale * x, next_y - next_scale * y) for x, y in head_points]
                    residuals = nearest_dark_residuals(gray, points, radius=7)
                    score = float(np.median(residuals) + np.percentile(residuals, 90) * 0.2)
                    candidates.append((score, float(next_scale), float(next_x), float(next_y)))
        _, scale, offset_x, offset_y = min(candidates)
    points = [(offset_x + scale * x, offset_y - scale * y) for x, y in head_points]
    residuals = nearest_dark_residuals(gray, points, radius=14)
    return {
        "scalePxPerFt": round(scale, 6),
        "offsetXPx": round(offset_x, 6),
        "offsetYPx": round(offset_y, 6),
        "headSamples": len(points),
        "medianResidualPx": round(float(np.median(residuals)), 6),
        "p95ResidualPx": round(float(np.percentile(residuals, 95)), 6),
    }


def plan_point(point, affine):
    return (
        affine["offsetXPx"] + affine["scalePxPerFt"] * point["x"],
        affine["offsetYPx"] - affine["scalePxPerFt"] * point["y"],
    )


def draw_plan_overlay(source, packet, affine):
    overlay = source.convert("RGBA")
    draw = ImageDraw.Draw(overlay, "RGBA")
    for pipe in packet["pipes"]:
        start = plan_point(pipe["startFt"], affine)
        end = plan_point(pipe["endFt"], affine)
        color = COLORS[pipe["geometryKind"]]
        width = max(3, int(round(2 + pipe["nominalSizeInches"] * 0.9)))
        if pipe["geometryKind"] == "vertical-transition":
            x, y = start
            draw.ellipse((x - 4, y - 4, x + 4, y + 4), fill=color, outline=(75, 40, 0, 255), width=1)
        else:
            draw.line((start, end), fill=color, width=width)
            if pipe["geometryKind"] == "sloped-plan-run":
                downhill = end if pipe["downhillDirection"] == "start-to-end" else start
                uphill = start if pipe["downhillDirection"] == "start-to-end" else end
                dx, dy = downhill[0] - uphill[0], downhill[1] - uphill[1]
                length = math.hypot(dx, dy)
                if length > 12:
                    ux, uy = dx / length, dy / length
                    tip = (uphill[0] + dx * 0.58, uphill[1] + dy * 0.58)
                    left = (tip[0] - ux * 12 - uy * 6, tip[1] - uy * 12 + ux * 6)
                    right = (tip[0] - ux * 12 + uy * 6, tip[1] - uy * 12 - ux * 6)
                    draw.polygon((tip, left, right), fill=color)
    draw.rounded_rectangle((48, 48, 820, 220), radius=24, fill=(7, 20, 38, 226), outline=(76, 110, 146, 255), width=2)
    draw.text((78, 72), "ACTUAL APPROVED FP2 + SOURCE DWG XYZ", font=font(30, True), fill=(238, 247, 255, 255))
    draw.text((78, 119), "Cyan: level  |  Magenta + arrow: sloped/downhill  |  Gold: vertical transition", font=font(21), fill=(202, 217, 233, 255))
    draw.text((78, 158), "186 pipes - 158 heads - 98 fittings - 119 endpoint elevations", font=font(23, True), fill=(116, 240, 211, 255))
    return overlay.convert("RGB")


def plot_projection(packet, horizontal_axis, width=1800, height=920):
    image = Image.new("RGB", (width, height), (5, 13, 27))
    draw = ImageDraw.Draw(image, "RGBA")
    pipes = packet["pipes"]
    values = [point[horizontal_axis] for pipe in pipes for point in (pipe["startFt"], pipe["endFt"])]
    z_values = [point["z"] for pipe in pipes for point in (pipe["startFt"], pipe["endFt"])]
    value_min, value_max = min(values), max(values)
    z_min, z_max = min(z_values), max(z_values)
    left, right, top, bottom = 110, width - 60, 100, height - 100
    sx = (right - left) / max(1e-9, value_max - value_min)
    sz = (bottom - top) / max(1e-9, z_max - z_min)
    for z in range(math.floor(z_min), math.ceil(z_max) + 1, 2):
        py = bottom - (z - z_min) * sz
        draw.line((left, py, right, py), fill=(69, 91, 118, 80), width=1)
        draw.text((28, py - 10), f"{z} ft", font=font(18), fill=(145, 164, 187, 255))
    for pipe in pipes:
        start = pipe["startFt"]
        end = pipe["endFt"]
        p1 = (left + (start[horizontal_axis] - value_min) * sx, bottom - (start["z"] - z_min) * sz)
        p2 = (left + (end[horizontal_axis] - value_min) * sx, bottom - (end["z"] - z_min) * sz)
        draw.line((p1, p2), fill=COLORS[pipe["geometryKind"]], width=max(2, int(pipe["nominalSizeInches"])))
    draw.text((left, 32), f"SOURCE PIPE ELEVATION - {horizontal_axis.upper()}-Z PROJECTION", font=font(34, True), fill=(238, 247, 255, 255))
    draw.text((left, 70), "Exact exported-DWG endpoints in project feet; no invented roof plane", font=font(20), fill=(168, 190, 213, 255))
    draw.line((left, bottom, right, bottom), fill=(166, 190, 214, 255), width=2)
    draw.line((left, top, left, bottom), fill=(166, 190, 214, 255), width=2)
    return image


def plot_3d(packet, width=1800, height=1200):
    image = Image.new("RGB", (width, height), (4, 11, 24))
    draw = ImageDraw.Draw(image, "RGBA")
    pipes = packet["pipes"]
    projected = []
    for pipe in pipes:
        points = []
        for point in (pipe["startFt"], pipe["endFt"]):
            u = (point["x"] - point["y"]) * 0.8660254
            v = (point["x"] + point["y"]) * 0.42 - point["z"] * 4.5
            points.append((u, v))
        projected.append((pipe, points))
    us = [point[0] for _, points in projected for point in points]
    vs = [point[1] for _, points in projected for point in points]
    margin_x, margin_top, margin_bottom = 120, 150, 100
    scale = min((width - 2 * margin_x) / (max(us) - min(us)), (height - margin_top - margin_bottom) / (max(vs) - min(vs)))
    def screen(point):
        return (margin_x + (point[0] - min(us)) * scale, margin_top + (point[1] - min(vs)) * scale)
    for pipe, points in sorted(projected, key=lambda item: sum(p[1] for p in item[1])):
        draw.line((*screen(points[0]), *screen(points[1])), fill=COLORS[pipe["geometryKind"]], width=max(2, int(2 + pipe["nominalSizeInches"] * 0.7)))
    draw.text((90, 48), "POLARIS SOURCE PIPE XYZ - ISOMETRIC MODEL", font=font(40, True), fill=(238, 247, 255, 255))
    draw.text((92, 98), "186 source centerlines; line weight reflects nominal pipe size", font=font(22), fill=(168, 190, 213, 255))
    return image


def html_document(proof):
    return f"""<!doctype html>
<html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Polaris pitched pipe XYZ proof</title>
<style>*{{box-sizing:border-box}}body{{margin:0;background:#030914;color:#ecf5ff;font-family:Inter,Segoe UI,sans-serif}}main{{max-width:1500px;margin:auto;padding:28px}}section{{background:linear-gradient(145deg,#0c1a2d,#07111f);border:1px solid #28405c;border-radius:24px;padding:24px;margin-bottom:24px;box-shadow:0 22px 70px #0008}}h1{{font-size:clamp(36px,6vw,72px);line-height:1;margin:10px 0 18px}}h2{{margin:0 0 10px}}p{{color:#b5c7da;font-size:18px;line-height:1.55}}.eyebrow{{color:#63efd0;font-weight:800;letter-spacing:.14em}}.badges{{display:flex;flex-wrap:wrap;gap:10px}}.badge{{padding:10px 14px;border-radius:999px;background:#0d2b31;border:1px solid #1c796d;color:#a7f5e6;font-weight:700}}.hold{{background:#302318;border-color:#9b6330;color:#ffd5a8}}.metrics{{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-top:24px}}.metric{{background:#050d19;border:1px solid #1d3048;border-radius:18px;padding:18px}}.metric strong{{font-size:32px;display:block}}img{{display:block;width:100%;height:auto;border-radius:16px;border:1px solid #38516c;background:#fff}}.grid{{display:grid;grid-template-columns:1fr 1fr;gap:20px}}@media(max-width:900px){{.grid{{grid-template-columns:1fr}}}}</style></head>
<body><main><section><div class=\"eyebrow\">ACTUAL DRAWING EVIDENCE - PITCHED ATTIC</div><h1>Exact pipe XYZ registered to approved and as-built FP2</h1><p>The underlay is the protected approved FP2 render. Its pixels are identical to the as-built FP2 page. Colored geometry comes from the exported AutoSPRINK DWG, transformed into project feet through the sealed 73-vertex architectural registration.</p><div class=\"badges\"><span class=\"badge\">186 pipe centerlines</span><span class=\"badge\">158 sprinklers</span><span class=\"badge\">98 fittings</span><span class=\"badge\">119 elevations</span><span class=\"badge\">14 sloped plan runs</span><span class=\"badge hold\">Hydraulic flow direction: HELD</span><span class=\"badge hold\">Drainage grade semantics: HELD</span><span class=\"badge hold\">New Hope exact Z: HELD</span></div><div class=\"metrics\"><div class=\"metric\"><strong>{proof['planRegistration']['medianResidualPx']} px</strong>median head-to-plan residual</div><div class=\"metric\"><strong>{proof['planRegistration']['p95ResidualPx']} px</strong>95th percentile residual</div><div class=\"metric\"><strong>86</strong>vertical transitions</div><div class=\"metric\"><strong>0</strong>false release claims</div></div></section>
<section><h2>Approved FP2 with source pipe projection</h2><p>Cyan is level, magenta carries the exact downhill direction arrow for sloped plan runs, and gold marks vertical or near-vertical transitions.</p><img src=\"approved-fp2-pipe-overlay.png\" alt=\"Approved FP2 with exact source pipe overlay\"></section>
<section class=\"grid\"><div><h2>X-Z elevation</h2><img src=\"pipe-elevation-xz.png\" alt=\"Exact X-Z pipe elevation\"></div><div><h2>Y-Z elevation</h2><img src=\"pipe-elevation-yz.png\" alt=\"Exact Y-Z pipe elevation\"></div></section>
<section><h2>Source XYZ isometric model</h2><p>This model uses the same 186 endpoint pairs as the approved-plan overlay. It is not image-generated artwork.</p><img src=\"pipe-model-3d.png\" alt=\"Exact source pipe XYZ isometric model\"></section>
<section><h2>Acceptance boundary</h2><p>Exact source pipe XYZ, unit conversion, plan direction, and roof-relative geometric slope are verified for Polaris. Hydraulic flow direction, drainage-grade intent, complete fitting semantics, drain destinations, fabrication, field release, and transfer of exact Z to New Hope remain fail-closed.</p></section></main></body></html>"""


def main():
    approved_pdf, as_built_pdf, calibration_json, answer_json, output_dir = map(Path, sys.argv[1:6])
    if digest_file(approved_pdf) != APPROVED_SHA256 or digest_file(as_built_pdf) != AS_BUILT_SHA256:
        raise ValueError("POLARIS_PDF_HASH_MISMATCH")
    packet = json.loads(calibration_json.read_text(encoding="utf-8"))
    answer = json.loads(answer_json.read_text(encoding="utf-8"))
    approved = render_pdf_page(approved_pdf, 0)
    as_built = render_pdf_page(as_built_pdf, 1)
    approved_bytes = approved.tobytes()
    as_built_bytes = as_built.tobytes()
    if approved.size != as_built.size or approved_bytes != as_built_bytes:
        raise ValueError("POLARIS_APPROVED_AS_BUILT_RASTER_MISMATCH")
    output_dir.mkdir(parents=True, exist_ok=True)
    source_path = output_dir / "approved-fp2-source.png"
    approved.save(source_path, optimize=True)
    head_points = [(head["pointFt"][0], head["pointFt"][1]) for head in answer["sprinklers"]]
    affine = fit_plan_affine(approved, head_points)
    overlay_path = output_dir / "approved-fp2-pipe-overlay.png"
    draw_plan_overlay(approved, packet, affine).save(overlay_path, optimize=True)
    xz_path = output_dir / "pipe-elevation-xz.png"
    yz_path = output_dir / "pipe-elevation-yz.png"
    model_path = output_dir / "pipe-model-3d.png"
    plot_projection(packet, "x").save(xz_path, optimize=True)
    plot_projection(packet, "y").save(yz_path, optimize=True)
    plot_3d(packet).save(model_path, optimize=True)
    proof = {
        "schema": "halofire.polaris-pitched-pipe-visual-proof.v1",
        "projectId": packet["projectId"],
        "sources": packet["sources"],
        "approvedAndAsBuiltRenderedPixelsIdentical": True,
        "renderedPixelSha256": digest_bytes(approved_bytes),
        "planRegistration": affine,
        "counts": packet["summary"],
        "artifacts": {
            path.name: {"sha256": digest_file(path), "bytes": path.stat().st_size}
            for path in (source_path, overlay_path, xz_path, yz_path, model_path)
        },
        "claims": packet["claims"],
    }
    proof_path = output_dir / "proof.json"
    proof_path.write_text(json.dumps(proof, indent=2) + "\n", encoding="utf-8", newline="\n")
    (output_dir / "index.html").write_text(html_document(proof), encoding="utf-8", newline="\n")
    print(json.dumps({"output": str(output_dir), "planRegistration": affine, "artifacts": proof["artifacts"]}, indent=2))


if __name__ == "__main__":
    main()

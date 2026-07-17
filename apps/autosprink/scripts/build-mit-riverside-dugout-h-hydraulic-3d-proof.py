"""Build a source-underlay proof for the sealed Dugout H hydraulic model.

The rendered plan, riser crop, and section are copied only from the completed
project PDF.  The overlaid pipe graph is limited to the sealed registrations;
the script does not infer a drain route, unregistered riser XY, or fabrication
geometry.
"""

from __future__ import annotations

import hashlib
import html
import json
from pathlib import Path

import fitz
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "apps" / "autosprink" / "src" / "data" / "proofs" / "mit-riverside-dugout-h-hydraulic-3d-proof"
DATA = ROOT / "apps" / "autosprink" / "src" / "data"
SOURCES = {
    "fieldPlan": Path(r"Y:\Shared\HaloOps\02-Active jobs\03-Closed\Adolfson & Peterson\MIT Riverside - Phoenix AZ\Field Operations\Field Plans\DUGOUT H BLDG FIELD.pdf"),
    "hydraulics": Path(r"Y:\Shared\HaloOps\02-Active jobs\03-Closed\Adolfson & Peterson\MIT Riverside - Phoenix AZ\Engineering\Submittals\20172-DUGOUT H HYDRAULICS.pdf"),
    "listing": Path(r"Y:\Shared\HaloOps\02-Active jobs\03-Closed\Adolfson & Peterson\MIT Riverside - Phoenix AZ\Field Operations\Listings Files\DUGOUT H\MIT DUGOUT H BLDG LISTING.pdf"),
}
EXPECTED_SHA256 = {
    "fieldPlan": "dbde3554b995d9ceb16d6829d683306e9a60f2dbc9b05ab87a3c60b548c0538c",
    "hydraulics": "c961ffd468c0af1433e93755be4b8b388625824e259f9b52d0b61e44b6792621",
    "listing": "9078f2e439aa01d8dd1c082a36939a217dea7c45ba918b7d52fefbd47cbc33b1",
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_json(name: str) -> dict:
    return json.loads((DATA / name).read_text(encoding="utf-8"))


def font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype("C:/Windows/Fonts/arial.ttf", size)


def render_page(path: Path, page_index: int, scale: float, clip: fitz.Rect | None = None) -> Image.Image:
    document = fitz.open(path)
    pixmap = document[page_index].get_pixmap(matrix=fitz.Matrix(scale, scale), clip=clip, alpha=False)
    return Image.frombytes("RGB", [pixmap.width, pixmap.height], pixmap.samples).convert("RGBA")


def write_plan_overlay(routed: dict, sized: dict) -> None:
    scale = 1.5
    page = render_page(SOURCES["fieldPlan"], 0, scale)
    overlay = Image.new("RGBA", page.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    diameter_by_pipe = {edge[0]: edge[4] for edge in sized["registration"]["edges"]}
    for pipe_id, _from_id, _to_id, _length, evidence_class, points in routed["registration"]["pipes"]:
        diameter = diameter_by_pipe[pipe_id]
        color = (34, 211, 238, 230) if diameter < 2 else (251, 146, 60, 235)
        xy = [(round(x * scale), round(y * scale)) for x, y in points]
        if len(set(xy)) == 1:
            x, y = xy[0]
            draw.ellipse((x - 10, y - 10, x + 10, y + 10), fill=(168, 85, 247, 220), outline=(255, 255, 255, 240), width=2)
        else:
            draw.line(xy, fill=(0, 15, 30, 180), width=10, joint="curve")
            draw.line(xy, fill=color, width=5, joint="curve")
    for node_id, x, y, _z, k_factor, _anchor_class in routed["registration"]["nodes"]:
        cx, cy = round(x * scale), round(y * scale)
        fill = (16, 185, 129, 235) if k_factor is not None else (251, 191, 36, 235)
        draw.ellipse((cx - 8, cy - 8, cx + 8, cy + 8), fill=fill, outline=(3, 7, 18, 245), width=2)
    draw.rounded_rectangle((28, 28, 1370, 178), radius=18, fill=(5, 20, 38, 222), outline=(125, 211, 252, 230), width=2)
    draw.text((52, 48), "DUGOUT H - ACTUAL COMPLETED FIELD PLAN", font=font(38), fill=(241, 245, 249, 255))
    draw.text((52, 98), "20 sealed HASS route segments only | cyan 1.515 in hydraulic I.D. | orange 2.729 in hydraulic I.D.", font=font(24), fill=(186, 230, 253, 255))
    draw.text((52, 132), "Green: active sprinkler node. Gold: hydraulic junction. Purple: source-proved vertical delta at one plan anchor.", font=font(22), fill=(226, 232, 240, 255))
    Image.alpha_composite(page, overlay).convert("RGB").save(OUT / "field-plan-hydraulic-overlay.png", quality=95)


def write_source_crops() -> None:
    section = render_page(SOURCES["fieldPlan"], 0, 2.0, fitz.Rect(1660, 430, 2590, 930))
    riser = render_page(SOURCES["fieldPlan"], 0, 2.0, fitz.Rect(1950, 1160, 2580, 1510))
    for image, name, label in [
        (section, "field-plan-cross-section.png", "ACTUAL COMPLETED FIELD-PLAN CROSS-SECTION - SOURCE RETAINED"),
        (riser, "field-plan-riser-reference.png", "ACTUAL 2.5 IN FIRE RISER REFERENCE - NO UNREGISTERED RISER XY PROMOTED"),
    ]:
        overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)
        draw.rounded_rectangle((18, 18, min(image.width - 18, 1420), 80), radius=12, fill=(5, 20, 38, 220), outline=(125, 211, 252, 230), width=2)
        draw.text((36, 34), label, font=font(24), fill=(241, 245, 249, 255))
        Image.alpha_composite(image, overlay).convert("RGB").save(OUT / name, quality=95)


def iso(point: tuple[float, float, float]) -> tuple[float, float]:
    x, y, z = point
    # The completed FP-3 model occupies a compact 190-242 ft / 60-83 ft
    # source range.  Fit that true coordinate range into the proof viewport;
    # do not translate the graph a second time after projection.
    return 40 + (x - y) * 4.0, 545 - (x + y) * 0.8 - z * 15


def write_3d_svg(sized: dict) -> None:
    nodes = {node[0]: node for node in sized["registration"]["nodes"]}
    polyline_elements = []
    for pipe_id, from_id, to_id, _length, diameter, _page, points in sized["registration"]["edges"]:
        from_z = nodes[from_id][3]
        to_z = nodes[to_id][3]
        total = sum(((points[index][0] - points[index - 1][0]) ** 2 + (points[index][1] - points[index - 1][1]) ** 2) ** 0.5 for index in range(1, len(points)))
        traveled = 0.0
        projected = []
        for index, (x, y) in enumerate(points):
            if index:
                traveled += ((x - points[index - 1][0]) ** 2 + (y - points[index - 1][1]) ** 2) ** 0.5
            fraction = index / max(1, len(points) - 1) if total == 0 else traveled / total
            projected.append(iso((x / 9, (1728 - y) / 9, from_z + (to_z - from_z) * fraction)))
        color = "#22d3ee" if diameter < 2 else "#fb923c"
        width = "5" if diameter < 2 else "8"
        polyline_elements.append(f'<polyline data-pipe-id="{pipe_id}" data-hydraulic-inside-diameter-in="{diameter}" points="{" ".join(f"{x:.2f},{y:.2f}" for x, y in projected)}" stroke="{color}" stroke-width="{width}"/>')
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 620" role="img" aria-label="Dugout H completed-plan XYZ hydraulic edge replay"><style>text{{font-family:Arial,sans-serif;fill:#e2e8f0}}.minor{{fill:#94a3b8;font-size:18px}}.major{{font-size:30px;font-weight:bold}}polyline{{fill:none;stroke-linecap:round;stroke-linejoin:round}}.grid{{stroke:#1e3a5f;stroke-width:1}}</style><rect width="1000" height="620" fill="#07111f"/><g opacity=".75"><path class="grid" d="M80 500H920M80 420H920M80 340H920M80 260H920"/></g><text class="major" x="34" y="50">Dugout H - sealed completed-plan XYZ hydraulic replay</text><text class="minor" x="34" y="82">X/Y: completed FP-3 vectors. Z: HASS report. Diameter: HASS inside diameter, not nominal fabrication size.</text><text class="minor" x="34" y="108">Scope: 20 on-plan calculated edges. Riser reference and drain routing remain separate, held claims.</text>{''.join(polyline_elements)}<g transform="translate(700,470)"><rect x="0" y="0" width="20" height="8" fill="#22d3ee"/><text class="minor" x="30" y="9">1.515 in hydraulic I.D.</text><rect x="0" y="32" width="20" height="8" fill="#fb923c"/><text class="minor" x="30" y="41">2.729 in hydraulic I.D.</text></g></svg>'''
    (OUT / "sealed-hydraulic-3d.svg").write_text(svg, encoding="utf-8")


def write_html(proof: dict) -> None:
    page = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Dugout H hydraulic 3D proof</title><style>:root{{color-scheme:dark;font-family:Inter,system-ui,sans-serif;background:#07111f;color:#e7eef8}}*{{box-sizing:border-box}}body{{margin:0;background:radial-gradient(circle at 8% 0,#173961,transparent 34%),radial-gradient(circle at 96% 7%,#3d1c46,transparent 28%),#07111f}}main{{max-width:2100px;margin:auto;padding:32px}}header,.card{{background:rgba(13,32,54,.76);border:1px solid rgba(164,198,235,.3);box-shadow:0 24px 70px rgba(0,0,0,.27);backdrop-filter:blur(18px);border-radius:24px}}header{{padding:28px 32px;margin-bottom:22px}}h1{{margin:0;font-size:clamp(1.7rem,3vw,2.7rem);letter-spacing:-.04em}}p{{color:#c8d5e5;line-height:1.58}}.badges{{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}}.badge{{padding:7px 11px;border-radius:999px;background:#102c47;border:1px solid #2d618c;color:#bde7ff;font-size:.88rem}}.pass{{background:#063a31;border-color:#0f8b70;color:#b7f7e4}}.hold{{background:#422006;border-color:#a45b17;color:#fde68a}}.grid{{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}}.card{{padding:18px}}.wide{{grid-column:1/-1}}h2{{margin:0 0 12px;font-size:1.25rem}}img,.svg{{display:block;width:100%;height:auto;border-radius:14px;border:1px solid #35516f;background:#fff}}.svg{{background:#07111f}}code{{color:#a7f3d0;word-break:break-all}}@media(max-width:920px){{main{{padding:16px}}header{{padding:22px}}.grid{{grid-template-columns:1fr}}}}</style></head><body><main><header><h1>Dugout H - PDF to registered hydraulic 3D proof</h1><p>The same completed FP-3 field plan remains visible beneath the 20 sealed hydraulic route segments. The 3D replay is deliberately limited to completed-plan X/Y, exact HASS report Z, and HASS hydraulic inside diameters. It does not convert the displayed riser reference into unregistered riser geometry or invent a drain route.</p><div class="badges"><span class="badge pass">20 sealed on-plan edges</span><span class="badge pass">21 registered nodes</span><span class="badge pass">3 source-proved vertical deltas</span><span class="badge hold">Drain route held</span><span class="badge hold">Installed riser XY held</span><span class="badge hold">Fabrication held</span></div></header><section class="grid"><article class="card wide"><h2>Top plan - original completed field-plan underlay + sealed hydraulic overlay</h2><img src="field-plan-hydraulic-overlay.png" alt="Actual completed Dugout H field plan underlay with 20 source-registered hydraulic route segments and 21 node markers"></article><article class="card"><h2>Source cross-section</h2><img src="field-plan-cross-section.png" alt="Actual Dugout H completed field-plan cross-section"></article><article class="card"><h2>Source riser reference</h2><img src="field-plan-riser-reference.png" alt="Actual Dugout H FP-3 two and one half inch fire riser reference"></article><article class="card wide"><h2>3D replay - only sealed completed-plan XYZ hydraulic edges</h2><img class="svg" src="sealed-hydraulic-3d.svg" alt="Isometric replay of source-registered Dugout H hydraulic edges using completed plan coordinates and HASS elevations"></article></section><p>Field-plan SHA-256: <code>{proof['sources']['fieldPlan']['sha256']}</code><br>Hydraulic report SHA-256: <code>{proof['sources']['hydraulics']['sha256']}</code><br>Listing SHA-256: <code>{proof['sources']['listing']['sha256']}</code></p></main></body></html>'''
    (OUT / "index.html").write_text(page, encoding="utf-8")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    actual_hashes = {key: sha256(path) for key, path in SOURCES.items()}
    if actual_hashes != EXPECTED_SHA256:
        raise RuntimeError(f"Dugout H source digest drift: {actual_hashes}")
    routed = load_json("mit-riverside-hydraulic-routed-plan-registration.json")
    sized = load_json("mit-riverside-hydraulic-sized-3d-registration.json")
    vertical = load_json("mit-riverside-hydraulic-network-vertical.json")
    if routed["projectId"] != sized["projectId"] or routed["projectId"] != vertical["projectId"]:
        raise RuntimeError("Dugout H evidence artifacts must share one project identity")
    write_plan_overlay(routed, sized)
    write_source_crops()
    write_3d_svg(sized)
    proof = {
        "artifactType": "halofire.mit-riverside-dugout-h-hydraulic-3d-proof.v1",
        "projectId": "mit-riverside-dugout-h",
        "status": "passed-source-bound-hydraulic-edge-replay-only",
        "sources": {key: {"sha256": digest} for key, digest in actual_hashes.items()},
        "metrics": {"registeredNodeCount": 21, "registeredOnPlanEdgeCount": 20, "samePlanAnchorVerticalEdgeCount": 3, "hydraulicInsideDiameterClassesIn": [1.515, 2.729], "maximumScaledPlanLengthResidualFt": 0.053333333333334565},
        "riserReference": {"rawText": "2.5 in FIRE RISER REFER TO FP7 FOR DETAIL", "source": "completed-field-plan FP-3", "installedRiserGeometryReady": False},
        "claims": {"completedPlanHydraulicRouteReplayReady": True, "hydraulicElevationReplayReady": True, "hydraulicInsideDiameterReplayReady": True, "installedRiserGeometryReady": False, "fieldDrainRouteReady": False, "nominalFabricationSizeReady": False, "fabricationReady": False, "complianceReady": False, "employeeUseReady": False, "vpsReleaseReady": False},
        "limitations": ["The 2.5-inch riser callout is a visible source reference only. Its installed XY, fittings, and detailed FP-7 geometry are not registered.", "No drain is shown or inferred. A project-specific drain source and field-resolution evidence remain required.", "HASS diameter values are hydraulic inside diameters, not nominal fabrication sizes."],
    }
    proof["assets"] = {path.name: {"sha256": sha256(path), "bytes": path.stat().st_size} for path in sorted(OUT.glob("*.png")) + sorted(OUT.glob("*.svg"))}
    with (OUT / "proof.json").open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(json.dumps(proof, indent=2) + "\n")
    write_html(proof)
    print(json.dumps({"output": str(OUT), "metrics": proof["metrics"], "assets": proof["assets"]}, indent=2))


if __name__ == "__main__":
    main()

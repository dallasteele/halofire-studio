#!/usr/bin/env python3
import argparse
import base64
import hashlib
import json
import math
from html import escape
from pathlib import Path

import fitz


PDF_BYTES = 116713715
PDF_SHA256 = "08515f43642de408ed1f9fc5ebd35115083b023d62412d5d9bc4301cf146c93c"
ROOF_PAGE_INDEX = 105
SECTION_PAGE_INDEX = 109
RCP_PAGE_INDEX = 104
PLAN_ORIGIN = fitz.Point(470.822113, 876.2995)
PDF_POINTS_PER_FOOT = 9.0
ROOF_CLIP = fitz.Rect(390, 770, 1320, 1975)
SECTION_CLIP = fitz.Rect(930, 95, 2075, 940)
RCP_CLIP = fitz.Rect(220, 660, 1270, 2040)
RCP_X_FT = [0, 15.666667, 17.333333, 30.666667, 39.666667, 45.666667, 61.333333, 76.333333]
RCP_X_PT = [470.822342, 592.857697, 626.822632, 746.7966, 827.82019, 861.569153, 1022.821594, 1157.819519]
RCP_Y_FT = [0, 32.166667, 64.833333, 89.166667, 100.166667]
RCP_Y_PT = [876.28183, 1165.784607, 1459.783142, 1678.745667, 1777.785583]

COLORS = {
    "main-standing-seam": (0.05, 0.38, 0.95),
    "west-lower-standing-seam": (0.95, 0.55, 0.03),
    "membrane-base": (0.02, 0.65, 0.60),
    "cricket": (0.90, 0.12, 0.15),
    "upright": (1.0, 0.36, 0.02),
    "pendent": (0.0, 0.65, 0.90),
}


def file_sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def assert_source(path):
    if Path(path).stat().st_size != PDF_BYTES or file_sha256(path) != PDF_SHA256:
        raise RuntimeError("MIT_J_SOURCE_UNDERLAY_PDF_MISMATCH")


def plan_point(point):
    return fitz.Point(PLAN_ORIGIN.x + float(point["x"]) * PDF_POINTS_PER_FOOT, PLAN_ORIGIN.y + float(point["y"]) * PDF_POINTS_PER_FOOT)


def draw_closed_polygon(page, vertices, color, fill_opacity=0.10, width=3.0):
    points = [plan_point(point) for point in vertices]
    shape = page.new_shape()
    shape.draw_polyline(points + [points[0]])
    shape.finish(color=color, fill=color, fill_opacity=fill_opacity, width=width, closePath=True)
    shape.commit(overlay=True)


def draw_cross(page, point, color=(0.72, 0.0, 0.72), radius=7):
    p = plan_point(point)
    page.draw_line(fitz.Point(p.x - radius, p.y), fitz.Point(p.x + radius, p.y), color=color, width=2.5, overlay=True)
    page.draw_line(fitz.Point(p.x, p.y - radius), fitz.Point(p.x, p.y + radius), color=color, width=2.5, overlay=True)


def render_roof_overlay(pdf_path, spatial, roof_packet, destination):
    document = fitz.open(pdf_path)
    page = document[ROOF_PAGE_INDEX]
    for region in spatial["roofBaseRegions"]:
        draw_closed_polygon(page, region["structuralLocalVerticesFt"], COLORS[region["id"]], 0.08, 4.0)
        centroid_x = sum(point["x"] for point in region["structuralLocalVerticesFt"]) / len(region["structuralLocalVerticesFt"])
        centroid_y = sum(point["y"] for point in region["structuralLocalVerticesFt"]) / len(region["structuralLocalVerticesFt"])
        label = {"main-standing-seam": "MAIN 1.25:12", "west-lower-standing-seam": "WEST 1.5:12", "membrane-base": "MEMBRANE 0.375:12"}[region["id"]]
        p = plan_point({"x": centroid_x, "y": centroid_y})
        page.insert_text(fitz.Point(p.x - 40, p.y), label, fontsize=10, fontname="hebo", color=COLORS[region["id"]], overlay=True)

    for face in roof_packet["sourceCricketFaces"]:
        draw_closed_polygon(page, face["registeredStructuralLocalVerticesFt"], COLORS["cricket"], 0.18, 2.5)

    for head in roof_packet["headAssignments"]:
        p = plan_point(head["structuralRoofLocalFt"])
        color = COLORS[head["kind"]]
        page.draw_circle(p, 4.8 if head["kind"] == "pendent" else 3.8, color=color, fill=(1, 1, 1), width=2.2, overlay=True)

    anchors = [
        ({"x": 0, "y": 0}, "A (0,0)"),
        ({"x": 61.333333, "y": 64.833333}, "B (J.G/J.3)"),
        ({"x": 17.666667, "y": 99.5}, "C membrane SW"),
        ({"x": 75.666667, "y": 99.5}, "D membrane SE"),
    ]
    for point, label in anchors:
        draw_cross(page, point)
        p = plan_point(point)
        page.insert_text(fitz.Point(p.x + 8, p.y - 8), label, fontsize=8, fontname="hebo", color=(0.72, 0.0, 0.72), overlay=True)

    page.draw_rect(fitz.Rect(405, 788, 1085, 842), color=(0.02, 0.05, 0.10), fill=(1, 1, 1), fill_opacity=0.90, width=1.2, overlay=True)
    page.insert_text(fitz.Point(420, 807), "PROTECTED PDF ROOF PLAN + REGISTERED SOURCE GEOMETRY", fontsize=12, fontname="hebo", color=(0.02, 0.05, 0.10), overlay=True)
    page.insert_text(fitz.Point(420, 826), "orange upright | cyan pendent | magenta registration anchors | red exact drain wedges", fontsize=8.5, color=(0.02, 0.05, 0.10), overlay=True)
    pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), clip=ROOF_CLIP, alpha=False)
    pixmap.save(destination)
    return {"pixelWidth": pixmap.width, "pixelHeight": pixmap.height, "sourcePage": 106, "sourcePageIndex": ROOF_PAGE_INDEX}


def line_exists(page, expected, tolerance=0.08):
    ax, ay, bx, by = expected
    for drawing in page.get_drawings():
        if drawing.get("layer") != "A-ROOF-MAJR.3D":
            continue
        for item in drawing["items"]:
            if item[0] != "l":
                continue
            start, end = item[1], item[2]
            direct = math.dist((start.x, start.y), (ax, ay)) + math.dist((end.x, end.y), (bx, by))
            reverse = math.dist((start.x, start.y), (bx, by)) + math.dist((end.x, end.y), (ax, ay))
            if min(direct, reverse) <= tolerance:
                return True
    return False


def render_section_overlay(pdf_path, destination):
    document = fitz.open(pdf_path)
    page = document[SECTION_PAGE_INDEX]
    profiles = [
        ("E MAIN 1.25:12", (1062.42, 209.30, 1675.85, 145.40), COLORS["main-standing-seam"]),
        ("E WEST 1.5:12", (1661.80, 226.59, 1982.73, 266.71), COLORS["west-lower-standing-seam"]),
        ("F MAIN 1.25:12", (1061.72, 697.73, 1675.14, 633.83), COLORS["main-standing-seam"]),
        ("F MEMBRANE 0.375:12", (1661.10, 728.01, 1967.10, 737.57), COLORS["membrane-base"]),
    ]
    for label, coordinates, color in profiles:
        if not line_exists(page, coordinates):
            raise RuntimeError(f"MIT_J_SOURCE_SECTION_VECTOR_MISSING_{label}")
        ax, ay, bx, by = coordinates
        page.draw_line(fitz.Point(ax, ay), fitz.Point(bx, by), color=color, width=7, stroke_opacity=0.62, overlay=True)
        label_point = fitz.Point(min(ax, bx) + 18, min(ay, by) - 10)
        page.insert_text(label_point, label, fontsize=10, fontname="hebo", color=color, overlay=True)
    page.draw_rect(fitz.Rect(950, 105, 1660, 151), color=(0.02, 0.05, 0.10), fill=(1, 1, 1), fill_opacity=0.90, width=1.2, overlay=True)
    page.insert_text(fitz.Point(968, 124), "PROTECTED PDF E/F SECTIONS + EXACT A-ROOF-MAJR VECTOR REPLAY", fontsize=11, fontname="hebo", color=(0.02, 0.05, 0.10), overlay=True)
    page.insert_text(fitz.Point(968, 141), "source roof profiles only; no projected sprinkler elevation or compliance claim", fontsize=8.5, color=(0.02, 0.05, 0.10), overlay=True)
    pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), clip=SECTION_CLIP, alpha=False)
    pixmap.save(destination)
    return {"pixelWidth": pixmap.width, "pixelHeight": pixmap.height, "sourcePage": 110, "sourcePageIndex": SECTION_PAGE_INDEX, "sourceProfiles": len(profiles)}


def interpolate(value, source, target):
    if value <= source[0]:
        return target[0]
    if value >= source[-1]:
        return target[-1]
    for index in range(len(source) - 1):
        if source[index] <= value <= source[index + 1]:
            ratio = (value - source[index]) / (source[index + 1] - source[index])
            return target[index] + ratio * (target[index + 1] - target[index])
    raise RuntimeError("MIT_J_RCP_INTERPOLATION_BLOCKED")


def rcp_point(point):
    return fitz.Point(interpolate(float(point["x"]), RCP_X_FT, RCP_X_PT), interpolate(float(point["y"]), RCP_Y_FT, RCP_Y_PT))


def render_rcp_ceiling_overlay(pdf_path, evidence, ceiling_packet, destination):
    document = fitz.open(pdf_path)
    page = document[RCP_PAGE_INDEX]
    pendent_zone_ids = {binding["ceilingZoneId"] for binding in evidence["pendentBindings"]}
    upright_overlap = set(evidence["aboveFinishedCeilingUprightIds"])
    for zone in evidence["ceilingZones"]:
        vertices = [rcp_point(point) for point in zone["structuralLocalVerticesFt"]]
        head_ids = {head["id"] for head in zone["headAssignments"]}
        if zone["id"] in pendent_zone_ids:
            color = (0.0, 0.48, 0.92)
            opacity = 0.10
        elif head_ids & upright_overlap:
            color = (0.75, 0.05, 0.75)
            opacity = 0.09
        else:
            color = (0.25, 0.30, 0.38)
            opacity = 0.04
        shape = page.new_shape()
        shape.draw_polyline(vertices + [vertices[0]])
        shape.finish(color=color, fill=color, fill_opacity=opacity, width=2.2, closePath=True)
        shape.commit(overlay=True)

    for head in ceiling_packet["headAssignments"]:
        p = rcp_point(head["structuralRoofLocalFt"])
        if head["kind"] == "pendent":
            color, radius = (0.0, 0.65, 0.90), 4.8
        elif head["finishedCeilingOverlap"]:
            color, radius = (0.78, 0.02, 0.78), 4.4
        else:
            color, radius = (1.0, 0.36, 0.02), 3.6
        page.draw_circle(p, radius, color=color, fill=(1, 1, 1), width=2.0, overlay=True)

    control_by_id = {control["id"]: control for control in evidence["ceilingControls"]}
    labeled = set()
    for binding in evidence["pendentBindings"]:
        if binding["ceilingZoneId"] in labeled:
            continue
        labeled.add(binding["ceilingZoneId"])
        zone = next(zone for zone in evidence["ceilingZones"] if zone["id"] == binding["ceilingZoneId"])
        cx = sum(point["x"] for point in zone["structuralLocalVerticesFt"]) / len(zone["structuralLocalVerticesFt"])
        cy = sum(point["y"] for point in zone["structuralLocalVerticesFt"]) / len(zone["structuralLocalVerticesFt"])
        p = rcp_point({"x": cx, "y": cy})
        control = control_by_id[binding["controlId"]]
        page.insert_text(fitz.Point(p.x - 14, p.y), f"{control['ceilingHeightFt']}'", fontsize=9, fontname="hebo", color=(0.0, 0.25, 0.70), overlay=True)

    page.draw_rect(fitz.Rect(235, 676, 1135, 732), color=(0.02, 0.05, 0.10), fill=(1, 1, 1), fill_opacity=0.91, width=1.2, overlay=True)
    page.insert_text(fitz.Point(250, 696), "PROTECTED RCP + 20 EXACT CEILING-MATERIAL POLYGONS", fontsize=12, fontname="hebo", color=(0.02, 0.05, 0.10), overlay=True)
    page.insert_text(fitz.Point(250, 716), "cyan: 15 TY3231 pendents | magenta: 7 above-ceiling TY3131 uprights | exact installed Z remains null", fontsize=8.5, color=(0.02, 0.05, 0.10), overlay=True)
    pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), clip=RCP_CLIP, alpha=False)
    pixmap.save(destination)
    return {"file": destination.name, "pixelWidth": pixmap.width, "pixelHeight": pixmap.height, "sourcePage": 105, "sourcePageIndex": RCP_PAGE_INDEX, "ceilingZoneCount": 20, "pendentCeilingPlaneCount": 15, "aboveFinishedCeilingUprightCount": 7, "exactInstalledHeadZReady": False}


def render_registered_3d(spatial, roof_packet, underlay_path, destination):
    matrix = (0.42, -0.16, 0.22, 0.18, 70, 490)
    z_scale = 8.0

    def source_pixel(point):
        pdf = plan_point(point)
        return ((pdf.x - ROOF_CLIP.x0) * 2, (pdf.y - ROOF_CLIP.y0) * 2)

    def project(point, z=0):
        x, y = source_pixel(point)
        a, b, c, d, tx, ty = matrix
        return (a * x + c * y + tx, b * x + d * y + ty - z * z_scale)

    def z_for(region_id, point):
        y = float(point["y"])
        if region_id == "main-standing-seam":
            return 17.083333 + y * 1.25 / 12
        if region_id == "west-lower-standing-seam":
            return 15 - (y - 65.5) * 1.5 / 12
        return 13.0625 - (y - 65.5) * 0.375 / 12

    def points_attribute(points):
        return " ".join(f"{x:.2f},{y:.2f}" for x, y in points)

    surfaces = []
    guides = []
    for region in spatial["roofBaseRegions"]:
        vertices = region["structuralLocalVerticesFt"]
        base_points = [project(point) for point in vertices]
        roof_points = [project(point, z_for(region["id"], point)) for point in vertices]
        color = {"main-standing-seam": "#2563eb", "west-lower-standing-seam": "#f59e0b", "membrane-base": "#14b8a6"}[region["id"]]
        for base, roof in zip(base_points, roof_points):
            guides.append(f'<line x1="{base[0]:.2f}" y1="{base[1]:.2f}" x2="{roof[0]:.2f}" y2="{roof[1]:.2f}" class="guide"/>')
        surfaces.append(f'<polygon points="{points_attribute(roof_points)}" fill="{color}" fill-opacity=".40" stroke="{color}" stroke-width="3"/>')

    targets = []
    for head in roof_packet["headAssignments"]:
        if head["sourceProtectionPlaneZFt"] is None:
            continue
        x, y = project(head["structuralRoofLocalFt"], head["sourceProtectionPlaneZFt"])
        targets.append(f'<circle cx="{x:.2f}" cy="{y:.2f}" r="3.2" class="target"><title>{escape(head["id"])}</title></circle>')

    anchors = [
        ({"x": 0, "y": 0}, "A"), ({"x": 61.333333, "y": 64.833333}, "B"),
        ({"x": 17.666667, "y": 99.5}, "C"), ({"x": 75.666667, "y": 99.5}, "D"),
    ]
    anchor_svg = []
    for point, label in anchors:
        x, y = project(point)
        anchor_svg.append(f'<circle cx="{x:.2f}" cy="{y:.2f}" r="8" class="anchor"/><text x="{x + 12:.2f}" y="{y - 7:.2f}" class="anchorLabel">{label}</text>')

    underlay_data = base64.b64encode(underlay_path.read_bytes()).decode("ascii")
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="1420" height="930" viewBox="0 0 1420 930">
<style>.bg{{fill:#07111f}}.underlayFrame{{fill:none;stroke:#cbd5e1;stroke-width:2}}.guide{{stroke:#f8fafc;stroke-opacity:.45;stroke-width:1.5;stroke-dasharray:5 5}}.target{{fill:#fff;stroke:#0f172a;stroke-width:1}}.anchor{{fill:#d946ef;stroke:#fff;stroke-width:2}}.anchorLabel{{fill:#f5d0fe;font:700 18px system-ui}}.title{{fill:#f8fafc;font:700 26px system-ui}}.fact{{fill:#cbd5e1;font:16px system-ui}}.warn{{fill:#fbbf24;font:700 16px system-ui}}</style>
<rect class="bg" width="1420" height="930"/>
<text x="28" y="42" class="title">Building J protected-PDF registered 3D roof reconstruction</text>
<text x="28" y="70" class="fact">The actual source roof plan is the base plane; A/B/C/D are the same registration anchors as the top view.</text>
<g><image href="data:image/png;base64,{underlay_data}" width="1860" height="2410" opacity=".72" transform="matrix(.42 -.16 .22 .18 70 490)"/></g>
{''.join(guides)}{''.join(surfaces)}{''.join(targets)}{''.join(anchor_svg)}
<rect x="26" y="842" width="1368" height="62" rx="12" fill="#07111f" fill-opacity=".92" stroke="#334155"/>
<text x="46" y="868" class="fact">3 source roof surfaces lifted from the protected PDF plane | 53 white source protection targets | 15 cyan pendent XY markers remain on the underlay</text>
<text x="46" y="892" class="warn">REGISTERED SOURCE GEOMETRY — NOT INSTALLED HEAD Z, COMPLIANCE, FABRICATION, OR FIELD RELEASE</text>
</svg>'''
    destination.write_bytes(svg.encode("utf-8"))
    return {"file": destination.name, "bytes": destination.stat().st_size, "sha256": file_sha256(destination), "sourcePdfPlanProjectedInto3d": True, "registrationAnchorCount": 4, "roofSurfaceCount": 3, "sourceProtectionTargetCount": len(targets), "pendingPendentXyCount": 15}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", required=True)
    parser.add_argument("--spatial", required=True)
    parser.add_argument("--roof-packet", required=True)
    parser.add_argument("--ceiling-evidence", required=True)
    parser.add_argument("--ceiling-packet", required=True)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()
    assert_source(args.pdf)
    spatial = json.loads(Path(args.spatial).read_text(encoding="utf-8"))
    roof_packet = json.loads(Path(args.roof_packet).read_text(encoding="utf-8"))
    ceiling_evidence = json.loads(Path(args.ceiling_evidence).read_text(encoding="utf-8"))
    ceiling_packet = json.loads(Path(args.ceiling_packet).read_text(encoding="utf-8"))
    if spatial.get("receiptSha256") != roof_packet.get("sourceSpatialBoundariesReceiptSha256"):
        raise RuntimeError("MIT_J_SOURCE_UNDERLAY_SPATIAL_RECEIPT_MISMATCH")
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    top_path = output_dir / "source-pdf-roof-plan-overlay.png"
    section_path = output_dir / "source-pdf-section-overlay.png"
    rcp_path = output_dir / "source-pdf-rcp-ceiling-envelope-overlay.png"
    model3d_path = output_dir / "source-pdf-registered-3d.svg"
    top = render_roof_overlay(args.pdf, spatial, roof_packet, top_path)
    section = render_section_overlay(args.pdf, section_path)
    rcp = render_rcp_ceiling_overlay(args.pdf, ceiling_evidence, ceiling_packet, rcp_path)
    model3d = render_registered_3d(spatial, roof_packet, top_path, model3d_path)
    top["bytes"] = top_path.stat().st_size
    top["sha256"] = file_sha256(top_path)
    section["bytes"] = section_path.stat().st_size
    section["sha256"] = file_sha256(section_path)
    rcp["bytes"] = rcp_path.stat().st_size
    rcp["sha256"] = file_sha256(rcp_path)
    manifest = {
        "artifactType": "halofire.mit-riverside-building-j-source-underlay-visual-proof.v1",
        "sourcePdf": {"bytes": PDF_BYTES, "sha256": PDF_SHA256},
        "roofPlan": {**top, "file": top_path.name, "actualProtectedPdfUnderlayVisible": True, "registeredHeadCount": len(roof_packet["headAssignments"]), "registeredCricketFaceCount": len(roof_packet["sourceCricketFaces"])},
        "sections": {**section, "file": section_path.name, "actualProtectedPdfUnderlayVisible": True},
        "rcpCeilingEnvelope": {**rcp, "actualProtectedPdfUnderlayVisible": True},
        "model3d": model3d,
        "claimBoundary": {"sourceRegistrationReady": True, "installedHeadElevationReady": False, "complianceReady": False, "fabricationReady": False, "fieldReleaseReady": False},
    }
    manifest_path = output_dir / "proof.json"
    manifest_path.write_bytes((json.dumps(manifest, indent=2) + "\n").encode("utf-8"))
    print(json.dumps({"top": str(top_path), "section": str(section_path), "rcp": str(rcp_path), "model3d": str(model3d_path), "manifest": str(manifest_path)}, indent=2))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Render protected-PDF proof for the Building J sanitized source topology."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
from html import escape
from pathlib import Path
from typing import Any

import fitz
from PIL import Image, ImageDraw, ImageFont


ARCHITECTURAL_SHA256 = "08515f43642de408ed1f9fc5ebd35115083b023d62412d5d9bc4301cf146c93c"
RCP_PAGE_INDEX = 104
MECHANICAL_PAGE_INDEX = 118
STRUCTURAL_PAGE_INDEX = 83
X_FT = [0, 15.666667, 17.333333, 30.666667, 39.666667, 45.666667, 61.333333, 76.333333]
X_RCP_PT = [470.822342, 592.857697, 626.822632, 746.7966, 827.82019, 861.569153, 1022.821594, 1157.819519]
Y_FT = [0, 32.166667, 64.833333, 90.166667, 100.166667]
Y_RCP_PT = [876.28183, 1165.784607, 1459.783142, 1678.745667, 1777.785583]


def file_sha256(path: str | Path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def piecewise(value: float, source: list[float], target: list[float]) -> float:
    pairs = sorted(zip(source, target), key=lambda entry: entry[0])
    if value <= pairs[0][0]:
        return pairs[0][1] + (value - pairs[0][0]) * (pairs[1][1] - pairs[0][1]) / (pairs[1][0] - pairs[0][0])
    if value >= pairs[-1][0]:
        return pairs[-1][1] + (value - pairs[-1][0]) * (pairs[-1][1] - pairs[-2][1]) / (pairs[-1][0] - pairs[-2][0])
    right = next(index for index in range(1, len(pairs)) if value <= pairs[index][0])
    left = right - 1
    ratio = (value - pairs[left][0]) / (pairs[right][0] - pairs[left][0])
    return pairs[left][1] + ratio * (pairs[right][1] - pairs[left][1])


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
        "C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf",
    ]
    for candidate in candidates:
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size)
    return ImageFont.load_default()


def render_clip(page: fitz.Page, clip: fitz.Rect, scale: float = 1.5) -> Image.Image:
    pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), clip=clip, alpha=False)
    return Image.open(io.BytesIO(pixmap.tobytes("png"))).convert("RGB")


def fit_panel(image: Image.Image, size: tuple[int, int], background: str = "#ffffff") -> tuple[Image.Image, float, tuple[int, int]]:
    width, height = size
    ratio = min(width / image.width, height / image.height)
    resized = image.resize((round(image.width * ratio), round(image.height * ratio)), Image.Resampling.LANCZOS)
    panel = Image.new("RGB", size, background)
    offset = ((width - resized.width) // 2, (height - resized.height) // 2)
    panel.paste(resized, offset)
    return panel, ratio, offset


def draw_rcp_panel(document: fitz.Document, topology: dict[str, Any], size: tuple[int, int]) -> Image.Image:
    clip = fitz.Rect(450, 850, 1180, 1800)
    raw = render_clip(document[RCP_PAGE_INDEX], clip)
    panel, ratio, offset = fit_panel(raw, size)
    draw = ImageDraw.Draw(panel, "RGBA")
    render_scale = 1.5 * ratio

    def point(local: dict[str, float]) -> tuple[float, float]:
        pdf_x = piecewise(local["x"], X_FT, X_RCP_PT)
        pdf_y = piecewise(local["y"], Y_FT, Y_RCP_PT)
        return offset[0] + (pdf_x - clip.x0) * render_scale, offset[1] + (pdf_y - clip.y0) * render_scale

    for wall in topology["wallMaterialPolygons"]:
        points = [point(entry) for entry in wall["structuralLocalVerticesFt"]]
        if len(points) >= 3:
            draw.line(points + [points[0]], fill=(59, 130, 246, 65), width=1)
    for room in topology["rooms"]:
        points = [point(entry) for entry in room["structuralLocalVerticesFt"]]
        draw.line(points + [points[0]], fill=(0, 210, 255, 220), width=4)
        center = point(room["sourceFloorLabelLocalFt"])
        draw.rounded_rectangle((center[0] - 27, center[1] - 14, center[0] + 27, center[1] + 14), 5, fill=(6, 20, 40, 205))
        draw.text((center[0], center[1]), room["id"], anchor="mm", fill="#ffffff", font=font(15, True))
    for door in topology["doorOpenings"]:
        center = point(door["structuralLocalCenterFt"])
        draw.ellipse((center[0] - 5, center[1] - 5, center[0] + 5, center[1] + 5), fill=(255, 0, 208, 230))
    for label in topology["openToStructureLabels"]:
        center = point(label["structuralLocalFt"])
        draw.line((center[0] - 8, center[1], center[0] + 8, center[1]), fill=(25, 255, 105, 255), width=4)
        draw.line((center[0], center[1] - 8, center[0], center[1] + 8), fill=(25, 255, 105, 255), width=4)
    return panel


def draw_mechanical_panel(document: fitz.Document, topology: dict[str, Any], size: tuple[int, int]) -> Image.Image:
    clip = fitz.Rect(1450, 300, 2200, 950)
    raw = render_clip(document[MECHANICAL_PAGE_INDEX], clip)
    panel, ratio, offset = fit_panel(raw, size)
    draw = ImageDraw.Draw(panel, "RGBA")
    render_scale = 1.5 * ratio

    def bbox_center(entry: dict[str, Any]) -> tuple[float, float]:
        bbox = entry["sourceBboxPt"]
        return offset[0] + ((bbox[0] + bbox[2]) / 2 - clip.x0) * render_scale, offset[1] + ((bbox[1] + bbox[3]) / 2 - clip.y0) * render_scale

    for equipment in topology["mechanicalEquipmentLabels"]:
        center = bbox_center(equipment)
        draw.ellipse((center[0] - 13, center[1] - 13, center[0] + 13, center[1] + 13), fill=(255, 159, 10, 100), outline=(255, 102, 0, 255), width=4)
        draw.text((center[0] + 16, center[1] - 8), equipment["equipmentTag"], fill="#7a2500", font=font(13, True))
    for duct in topology["mechanicalDuctSizeLabels"]:
        center = bbox_center(duct)
        draw.rectangle((center[0] - 16, center[1] - 9, center[0] + 16, center[1] + 9), outline=(155, 70, 255, 255), width=3)
    return panel


def draw_structural_pdf_panel(document: fitz.Document, size: tuple[int, int]) -> Image.Image:
    raw = render_clip(document[STRUCTURAL_PAGE_INDEX], fitz.Rect(90, 620, 1120, 2070), 1.2)
    panel, _, _ = fit_panel(raw, size)
    return panel


def draw_normalized_panel(topology: dict[str, Any], size: tuple[int, int]) -> Image.Image:
    panel = Image.new("RGB", size, "#07111f")
    draw = ImageDraw.Draw(panel, "RGBA")
    margin = 45

    def point(local: dict[str, float]) -> tuple[float, float]:
        return margin + (local["x"] + 3) / 83 * (size[0] - 2 * margin), size[1] - margin - (local["y"] + 3) / 110 * (size[1] - 2 * margin)

    for beam in topology["structuralBeamLines"]:
        draw.line((point(beam["startStructuralLocalFt"]), point(beam["endStructuralLocalFt"])), fill=(255, 193, 7, 165), width=2)
    for room in topology["rooms"]:
        points = [point(entry) for entry in room["structuralLocalVerticesFt"]]
        draw.line(points + [points[0]], fill=(0, 210, 255, 230), width=3)
        center = point(room["sourceFloorLabelLocalFt"])
        draw.text(center, room["id"], anchor="mm", fill="#ffffff", font=font(14, True))
    for equipment in topology["mechanicalEquipmentLabels"]:
        center = point(equipment["structuralLocalFt"])
        draw.ellipse((center[0] - 5, center[1] - 5, center[0] + 5, center[1] + 5), fill=(255, 112, 0, 255))
    for label in topology["openToStructureLabels"]:
        center = point(label["structuralLocalFt"])
        draw.line((center[0] - 6, center[1], center[0] + 6, center[1]), fill=(35, 255, 120, 255), width=3)
        draw.line((center[0], center[1] - 6, center[0], center[1] + 6), fill=(35, 255, 120, 255), width=3)
    draw.text((22, 20), "NORMALIZED SOURCE TOPOLOGY - NOT A SPRINKLER LAYOUT", fill="#f8fafc", font=font(19, True))
    draw.text((22, size[1] - 32), "cyan rooms | yellow structural lines | orange MEP labels | green O.T.S.", fill="#cbd5e1", font=font(14))
    return panel


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--architectural-pdf", required=True)
    parser.add_argument("--topology", required=True)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()
    if file_sha256(args.architectural_pdf) != ARCHITECTURAL_SHA256:
        raise RuntimeError("MIT_J_SOURCE_TOPOLOGY_PROOF_PDF_MISMATCH")
    topology = json.loads(Path(args.topology).read_text(encoding="utf-8"))
    if topology.get("artifactType") != "halofire.mit-riverside-building-j-source-topology-inputs.v1" or topology.get("sequence", {}).get("answerArtifactRead") is not False:
        raise RuntimeError("MIT_J_SOURCE_TOPOLOGY_PROOF_INPUT_BLOCKED")
    document = fitz.open(args.architectural_pdf)
    panel_size = (1120, 700)
    panels = [
        draw_rcp_panel(document, topology, panel_size),
        draw_mechanical_panel(document, topology, panel_size),
        draw_structural_pdf_panel(document, panel_size),
        draw_normalized_panel(topology, panel_size),
    ]
    canvas = Image.new("RGB", (2300, 1580), "#07111f")
    draw = ImageDraw.Draw(canvas)
    draw.text((32, 22), "MIT Riverside Building J - protected-source topology proof", fill="#f8fafc", font=font(30, True))
    draw.text((32, 62), "Actual PDF RCP, M-101, and S2.1 underlays. No completed sprinkler answer was used.", fill="#cbd5e1", font=font(18))
    positions = [(20, 110), (1160, 110), (20, 850), (1160, 850)]
    titles = [
        "A-102 RCP: rooms, doors, and O.T.S. labels",
        "M-101 mechanical: equipment and duct labels",
        "S2.1 structural: actual Building J roof-framing plan",
        "Sanitized coordinate replay across source disciplines",
    ]
    for panel, position, title in zip(panels, positions, titles):
        canvas.paste(panel, position)
        draw.text((position[0] + 12, position[1] + 10), title, fill="#07111f" if position != positions[-1] else "#f8fafc", font=font(18, True), stroke_width=2, stroke_fill="#ffffff" if position != positions[-1] else "#07111f")
    draw.rounded_rectangle((30, 1535, 2270, 1572), 9, fill="#7c2d12", outline="#f97316", width=2)
    draw.text((50, 1553), "FAIL-CLOSED: source label inventory is ready; exact MEP footprints, member depths, and obstruction clearances are not ready.", anchor="lm", fill="#fff7ed", font=font(17, True))
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    image_path = output_dir / "source-topology-proof.png"
    canvas.save(image_path, "PNG", optimize=True)
    manifest = {
        "artifactType": "halofire.mit-riverside-building-j-source-topology-visual-proof.v1",
        "topologyReceiptSha256": topology["receiptSha256"],
        "sourcePdfSha256": ARCHITECTURAL_SHA256,
        "sourcePages": {"rcp": 105, "mechanical": 119, "structuralRoofFraming": 84},
        "image": {"file": image_path.name, "bytes": image_path.stat().st_size, "sha256": file_sha256(image_path), "width": canvas.width, "height": canvas.height},
        "counts": {
            "rooms": len(topology["rooms"]),
            "doors": len(topology["doorOpenings"]),
            "openToStructureLabels": len(topology["openToStructureLabels"]),
            "structuralBeamLines": len(topology["structuralBeamLines"]),
            "mechanicalEquipmentLabels": len(topology["mechanicalEquipmentLabels"]),
            "mechanicalDuctSizeLabels": len(topology["mechanicalDuctSizeLabels"]),
        },
        "visualReview": {"browserInspected": False, "decodedImageCount": 0, "consoleErrors": None},
        "claims": topology["claims"],
    }
    manifest_path = output_dir / "proof.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8", newline="\n")
    html = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Building J source topology proof</title><style>body{{margin:0;background:#07111f;color:#f8fafc;font:16px system-ui}}main{{max-width:1800px;margin:auto;padding:28px}}img{{display:block;width:100%;height:auto;border:1px solid #334155;border-radius:14px}}.warn{{padding:16px;border:2px solid #f97316;background:#431407;border-radius:12px;margin:16px 0}}code{{color:#a7f3d0}}</style></head><body><main><h1>Building J protected-source topology proof</h1><p>Actual A-102, M-101, and S2.1 underlays. No completed sprinkler answer was used.</p><div class="warn">Source topology inventory is ready. Exact obstruction footprints and clearances remain fail-closed.</div><img src="{escape(image_path.name)}" alt="Protected PDF and structural source topology proof"><p>Topology receipt: <code>{escape(topology['receiptSha256'])}</code></p></main></body></html>'''
    (output_dir / "index.html").write_text(html, encoding="utf-8", newline="\n")
    print(json.dumps({"output": str(image_path), "manifest": str(manifest_path), "sha256": manifest["image"]["sha256"]}, indent=2))


if __name__ == "__main__":
    main()

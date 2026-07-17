#!/usr/bin/env python3
"""Render the scoped BL34/BL35 native-outlet registration over the real FP1.0 PDF."""

from __future__ import annotations

import hashlib
import io
import json
from pathlib import Path

import fitz
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[3]
DATA = ROOT / "apps/autosprink/src/data/new-hope-wet-quantity-placement-evidence.json"
FIELD = ROOT / "tmp/pdfs/new-hope-live/field-install.pdf"
AS_BUILT = ROOT / "tmp/pdfs/new-hope-live/as-builts.pdf"
OUTPUT = ROOT / "apps/autosprink/src/data/proofs/new-hope-system-backbone/wet-quantity-placement-source.png"
ZOOM = 2.35
PANEL_W = 552
PANEL_H = 432
HEADER_H = 132
GAP = 20


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = [
        Path("C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf"),
        Path("C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def line_item(page: fitz.Page, drawing_index: int, item_index: int) -> tuple[float, float, float, float]:
    drawing = page.get_drawings()[drawing_index]
    if abs(float(drawing["width"]) - 1.24059) > 0.00001 or drawing["color"] != (0.0, 0.0, 0.0):
        raise RuntimeError(f"drawing {drawing_index} no longer has the expected black 1.24059-point centerline style")
    item = drawing["items"][item_index]
    if item[0] != "l":
        raise RuntimeError(f"drawing {drawing_index}/{item_index} is no longer a line")
    return item[1].x, item[1].y, item[2].x, item[2].y


def same_segment(actual: tuple[float, float, float, float], expected: dict[str, object]) -> bool:
    ax, ay, bx, by = actual
    start = [round(min(ax, bx), 6), round(ay if ax <= bx else by, 6)]
    end = [round(max(ax, bx), 6), round(by if ax <= bx else ay, 6)]
    return all(abs(left - right) <= 0.000001 for left, right in zip(start + end, expected["fromPdfPt"] + expected["toPdfPt"]))


def render_clip(page: fitz.Page, clip: fitz.Rect) -> Image.Image:
    pixmap = page.get_pixmap(matrix=fitz.Matrix(ZOOM, ZOOM), clip=clip, alpha=False)
    image = Image.open(io.BytesIO(pixmap.tobytes("png"))).convert("RGB")
    return image.resize((PANEL_W, PANEL_H), Image.Resampling.LANCZOS)


def local(point: list[float], clip: fitz.Rect) -> tuple[float, float]:
    return ((point[0] - clip.x0) * PANEL_W / clip.width, (point[1] - clip.y0) * PANEL_H / clip.height)


def draw_registration(panel: Image.Image, clip: fitz.Rect, instances: list[tuple[dict[str, object], dict[str, object]]], title: str) -> None:
    draw = ImageDraw.Draw(panel, "RGBA")
    draw.rounded_rectangle((10, 10, 265, 48), radius=13, fill=(3, 12, 28, 225), outline=(77, 231, 255, 255), width=2)
    draw.text((24, 18), title, font=font(19, True), fill=(244, 251, 255, 255))
    for definition, instance in instances:
        source = instance["sourceCenterline"]
        cut = instance["fabricationCutVector"]
        source_a, source_b = local(source["fromPdfPt"], clip), local(source["toPdfPt"], clip)
        cut_a, cut_b = local(cut["fromPdfPt"], clip), local(cut["toPdfPt"], clip)
        draw.line((*source_a, *source_b), fill=(77, 231, 255, 235), width=7)
        draw.line((cut_a[0], cut_a[1] - 7, cut_b[0], cut_b[1] - 7), fill=(255, 53, 212, 255), width=4)
        for point in (cut_a, cut_b):
            draw.line((point[0], point[1] - 15, point[0], point[1] + 9), fill=(255, 53, 212, 255), width=4)
        for head in instance["mappedOutletHeads"]:
            x, y = local(head["pdfPt"], clip)
            draw.ellipse((x - 9, y - 9, x + 9, y + 9), fill=(4, 17, 30, 180), outline=(255, 211, 77, 255), width=4)
            draw.ellipse((x - 2, y - 2, x + 2, y + 2), fill=(255, 255, 255, 255))
        box = instance["lineLabelBoxPdfPt"]
        x0, y0 = local(box[:2], clip)
        x1, y1 = local(box[2:], clip)
        draw.rectangle((x0 - 3, y0 - 3, x1 + 3, y1 + 3), outline=(52, 211, 153, 255), width=3)
        label = f"{instance['instanceId']}  max outlet residual {instance['maxOutletResidualIn']:.3f} in"
        label_x = max(16, min(source_a[0], PANEL_W - 365))
        label_y = source_a[1] + 18
        draw.rounded_rectangle((label_x, label_y, label_x + 350, label_y + 34), radius=10, fill=(3, 12, 28, 225), outline=(255, 255, 255, 60), width=1)
        draw.text((label_x + 10, label_y + 8), label, font=font(14, True), fill=(229, 244, 255, 255))


def main() -> None:
    evidence = json.loads(DATA.read_text(encoding="utf-8"))
    if sha256(FIELD) != evidence["sources"]["fieldInstall"]["sha256"] or sha256(AS_BUILT) != evidence["sources"]["asBuilt"]["sha256"]:
        raise RuntimeError("the cached FP1.0 PDFs no longer match the bound evidence hashes")

    field_doc = fitz.open(FIELD)
    as_built_doc = fitz.open(AS_BUILT)
    field_page = field_doc[2]
    as_built_page = as_built_doc[2]
    flattened: list[tuple[dict[str, object], dict[str, object]]] = []
    for definition in evidence["definitions"]:
        for instance in definition["instances"]:
            source = instance["sourceCenterline"]
            field_segment = line_item(field_page, source["fieldDrawingIndex"], source["itemIndex"])
            as_built_segment = line_item(as_built_page, source["asBuiltDrawingIndex"], source["itemIndex"])
            if not same_segment(field_segment, source) or not same_segment(as_built_segment, source):
                raise RuntimeError(f"{instance['instanceId']} centerline does not replay identically across both PDFs")
            flattened.append((definition, instance))

    clips = [fitz.Rect(1380, 650, 1615, 830), fitz.Rect(1380, 1575, 1615, 1755)]
    panels = [render_clip(field_page, clip) for clip in clips]
    upper = [row for row in flattened if row[1]["sourceCenterline"]["fromPdfPt"][1] < 1000]
    lower = [row for row in flattened if row[1]["sourceCenterline"]["fromPdfPt"][1] > 1000]
    draw_registration(panels[0], clips[0], upper, "UPPER FP1.0 INSTANCES")
    draw_registration(panels[1], clips[1], lower, "LOWER FP1.0 INSTANCES")

    width = PANEL_W * 2 + GAP * 3
    canvas = Image.new("RGB", (width, PANEL_H + HEADER_H + GAP), (3, 10, 18))
    draw = ImageDraw.Draw(canvas)
    draw.text((20, 18), "New Hope FP1.0 - native FAB outlet registration", font=font(32, True), fill=(244, 251, 255))
    draw.text((20, 58), "actual field PDF underlay | cyan = drawn centerline | magenta = FAB cut vector | gold = mapped outlets", font=font(18), fill=(173, 220, 238))
    draw.text((20, 87), "4 repeated units | 8/8 native outlets | max residual 0.010 in | field and as-built vectors identical", font=font(18, True), fill=(116, 255, 207))
    draw.text((20, 111), "Cut vectors extend about 1.7 in beyond drawn spans; fitting takeout remains a separate unresolved release input.", font=font(16), fill=(255, 210, 122))
    for index, panel in enumerate(panels):
        canvas.paste(panel, (GAP + index * (PANEL_W + GAP), HEADER_H))
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(OUTPUT, optimize=True)
    print(f"wrote {OUTPUT} ({canvas.width}x{canvas.height})")


if __name__ == "__main__":
    main()

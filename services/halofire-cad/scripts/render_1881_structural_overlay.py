"""Render source-PDF overlays for the 1881 structural extraction acceptance gate."""
from __future__ import annotations

import json
from pathlib import Path

import fitz
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[3]
DATA = ROOT / "output/visual-proof/1881-structural-source-overlay-data.json"
OUTPUT = ROOT / "output/visual-proof/1881-structural-source-overlay.png"
OUTPUT_JPEG = ROOT / "output/visual-proof/1881-structural-source-overlay-review.jpg"
PAGES = (51, 52, 63, 64)


def _font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    try:
        return ImageFont.truetype("arial.ttf", size)
    except OSError:
        return ImageFont.load_default()


def _raw_point(record: dict, point: list[float], height_pt: float) -> tuple[float, float]:
    match = record["grid_match"]
    scale = record["scale_ft_per_pdf_point"]
    x_ft = point[0] - match["dx"]
    y_ft = point[1] - match["dy"]
    return x_ft / scale, height_pt - y_ft / scale


def _render_panel(document: fitz.Document, record: dict) -> Image.Image:
    page = document[record["page_number"] - 1]
    pixmap = page.get_pixmap(matrix=fitz.Matrix(1, 1), alpha=False)
    image = Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
    draw = ImageDraw.Draw(image, "RGBA")
    for column in record["columns"]:
        bounds = column["markerBoundsFt"]
        corners = [
            _raw_point(record, [bounds["minX"], bounds["minY"]], page.rect.height),
            _raw_point(record, [bounds["maxX"], bounds["maxY"]], page.rect.height),
        ]
        left, right = sorted((corners[0][0], corners[1][0]))
        top, bottom = sorted((corners[0][1], corners[1][1]))
        draw.rectangle((left, top, right, bottom), fill=(0, 220, 255, 50), outline=(0, 120, 220, 230), width=2)
    for member in record["joists"]:
        draw.line((*_raw_point(record, member["a"], page.rect.height),
                   *_raw_point(record, member["b"], page.rect.height)), fill=(30, 180, 80, 190), width=2)
    for member in record["beams"]:
        draw.line((*_raw_point(record, member["a"], page.rect.height),
                   *_raw_point(record, member["b"], page.rect.height)), fill=(220, 30, 130, 230), width=3)
    banner_h = 58
    draw.rectangle((0, 0, image.width, banner_h), fill=(8, 20, 38, 235))
    title = (
        f"SOURCE PDF p{record['page_number']} / area {record['role'].upper()}   "
        f"columns {len(record['columns'])}   beams {len(record['beams'])}   joists {len(record['joists'])}   "
        f"registration residual {record['grid_match']['medianErrFt']:.4f} ft"
    )
    draw.text((18, 16), title, font=_font(22), fill=(255, 255, 255, 255))
    return image


def main() -> None:
    payload = json.loads(DATA.read_text(encoding="utf-8"))
    by_page = {record["page_number"]: record for record in payload["pages"]}
    document = fitz.open(payload["source_structural_pdf_path"])
    panels = [_render_panel(document, by_page[page]) for page in PAGES]
    target_w = 1300
    resized = []
    for panel in panels:
        height = round(panel.height * target_w / panel.width)
        resized.append(panel.resize((target_w, height), Image.Resampling.LANCZOS))
    gap = 18
    header = 96
    panel_h = max(panel.height for panel in resized)
    canvas = Image.new("RGB", (target_w * 2 + gap * 3, header + panel_h * 2 + gap * 3), (10, 18, 31))
    draw = ImageDraw.Draw(canvas)
    draw.text((gap, 18), "COOPERATIVE 1881 — SOURCE-BOUND STRUCTURAL EXTRACTION", font=_font(30), fill=(245, 248, 255))
    draw.text((gap, 58), "cyan = measured column marker envelope   magenta = beam centerline   green = joist centerline", font=_font(20), fill=(167, 189, 214))
    for index, panel in enumerate(resized):
        x = gap + (index % 2) * (target_w + gap)
        y = header + gap + (index // 2) * (panel_h + gap)
        canvas.paste(panel, (x, y))
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(OUTPUT, quality=94)
    canvas.save(OUTPUT_JPEG, quality=94, subsampling=0)
    print(OUTPUT)
    print(OUTPUT_JPEG)


if __name__ == "__main__":
    main()

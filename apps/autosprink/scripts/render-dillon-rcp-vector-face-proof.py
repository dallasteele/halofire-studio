"""Render the sealed Dillon RCP face registry over the actual source PDF pages."""

from __future__ import annotations

import json
from pathlib import Path

import fitz
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "src" / "data"
OUT = DATA / "proofs" / "dillon-rcp-vector-faces"
SCALE = 0.65
PDFS = {
    "FP-1": ROOT / "tmp" / "pdfs" / "dillon-roof-calibration" / "main-plans" / "6 - MAIN LEVEL REFLECTED CEILING PLAN.pdf",
    "FP-2": ROOT / "tmp" / "pdfs" / "dillon-roof-calibration" / "main-plans" / "5 - UPPER LEVEL PLANS.pdf",
}


def font(size=18, bold=False):
    candidates = [Path("C:/Windows/Fonts/arialbd.ttf") if bold else Path("C:/Windows/Fonts/arial.ttf")]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def page_point(page, point):
    rotated = fitz.Point(point[0], point[1]) * page.rotation_matrix
    return (rotated.x * SCALE, rotated.y * SCALE)


def dwg_to_pdf(source, point):
    transform = source["pdfToDwgTransform"]
    scale = transform["scalePtPerFt"]
    return ((transform["constantY"] - point[1]) * scale, (transform["constantX"] - point[0]) * scale)


def render_sheet(sheet, vertical_sheet):
    with fitz.open(PDFS[sheet["sheetId"]]) as document:
        page = document[0]
        pixmap = page.get_pixmap(matrix=fitz.Matrix(SCALE, SCALE), alpha=False)
        image = Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples).convert("RGBA")
        overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay, "RGBA")

        for face in sheet["faces"]:
            polygon = [page_point(page, point) for point in face["polygonPdfPt"]]
            if face["surfaceResolved"]:
                draw.polygon(polygon, fill=(34, 197, 94, 38), outline=(22, 163, 74, 220), width=3)
            else:
                draw.polygon(polygon, fill=(236, 72, 153, 62), outline=(219, 39, 119, 245), width=5)

        face_heads = [entry for entry in vertical_sheet["headAssignments"] if entry.get("sourceFaceId")]
        face_pipes = [entry for entry in vertical_sheet["pipeAssignments"] if entry.get("endpointSourceFaceIds")]
        for pipe in face_pipes:
            points = [page_point(page, dwg_to_pdf(sheet["source"], point)) for point in pipe["planDwgFt"]]
            draw.line(points, fill=(8, 145, 178, 255), width=6)
        for head in face_heads:
            x, y = page_point(page, dwg_to_pdf(sheet["source"], head["planPointDwgFt"]))
            radius = 6
            draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=(250, 204, 21, 255), outline=(17, 24, 39, 255), width=2)

        image = Image.alpha_composite(image, overlay)
        draw = ImageDraw.Draw(image, "RGBA")
        box = (18, 18, 820, 150)
        draw.rounded_rectangle(box, radius=12, fill=(3, 7, 18, 224), outline=(125, 211, 252, 230), width=2)
        draw.text((38, 34), f"{sheet['sheetId']} · ACTUAL HASHED ARCHITECTURAL RCP UNDERLAY", fill=(240, 249, 255, 255), font=font(22, True))
        counts = sheet["sourceCounts"]
        draw.text((38, 70), f"green: {counts['singleSurfaceFaces']} sealed faces   magenta: {counts['mixedSurfaceFaces']} mixed/rejected", fill=(186, 230, 253, 255), font=font(17))
        draw.text((38, 99), f"yellow: {len(face_heads)} heads with face-bound Z   cyan: {len(face_pipes)} pipe segments fully inside one face", fill=(254, 240, 138, 255), font=font(17))
        draw.text((38, 126), "No proximity joins · no default flat height · unresolved geometry omitted from 3D", fill=(253, 164, 175, 255), font=font(16, True))
        target = OUT / f"{sheet['sheetId'].lower()}-actual-rcp-face-overlay.png"
        image.convert("RGB").save(target, quality=94)
        return target.name, len(face_heads), len(face_pipes)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    registry = json.loads((DATA / "dillon-rcp-vector-face-registry.json").read_text(encoding="utf-8"))
    vertical = json.loads((DATA / "dillon-vertical-registration.json").read_text(encoding="utf-8"))
    rendered = []
    for sheet in registry["sheets"]:
        vertical_sheet = next(entry for entry in vertical["sheets"] if entry["sheetId"] == sheet["sheetId"])
        rendered.append((sheet, *render_sheet(sheet, vertical_sheet)))
    cards = "".join(
        f'<section><h2>{sheet["sheetId"]}</h2><p>{heads} heads and {pipes} pipe segments inherit Z from sealed architectural RCP vector faces.</p><img src="{name}" alt="{sheet["sheetId"]} actual architectural RCP with sealed and rejected face overlays"></section>'
        for sheet, name, heads, pipes in rendered
    )
    html = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Dillon actual RCP vector-face proof</title><style>body{{margin:0;background:#07111f;color:#e0f2fe;font:15px/1.5 system-ui;padding:24px}}h1,h2{{margin:.2em 0}}header,section{{max-width:1500px;margin:0 auto 22px}}header{{border:1px solid #0e7490;background:#082f49;padding:18px;border-radius:14px}}section{{background:#0f172a;padding:16px;border:1px solid #334155;border-radius:14px}}img{{display:block;width:100%;height:auto;background:white;border-radius:8px}}code{{color:#fde68a}}.blocked{{color:#fda4af;font-weight:700}}</style></head><body><header><h1>Dillon actual-PDF RCP → source-bound 3D ceiling-face proof</h1><p>Source PDFs are identified by SHA-256 <code>{registry['sheets'][0]['source']['sourceSha256']}</code> and <code>{registry['sheets'][1]['source']['sourceSha256']}</code>. The vector replay found {registry['counts']['singleSurfaceFaces']} single-surface faces and kept all {registry['counts']['mixedSurfaceFaces']} mixed CLG/SOFFIT faces <span class="blocked">unresolved</span>.</p><p>This proves a partial architectural ceiling-surface join only. It does not claim whole-building roof planes, sprinkler code compliance, hydraulics, manufacturer deflector offsets, fabrication, approval, or field release.</p></header>{cards}</body></html>"""
    (OUT / "index.html").write_bytes(html.encode("utf-8"))
    print(json.dumps({"output": str(OUT), "files": [name for _, name, _, _ in rendered], "registryReceiptSha256": registry["receiptSha256"], "verticalReceiptSha256": vertical["receiptSha256"]}, indent=2))


if __name__ == "__main__":
    main()

"""Render the failed fresh pitched-roof holdout on its real PDF underlays."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import fitz
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "src" / "data"
OUT = DATA / "proofs" / "ironwood-seminary-pitched-holdout"
SOURCE = Path(r"Y:\Shared\HaloOps\02-Active jobs\03-Closed\Porter Brother\Ironwood LDS Seminary Annex-Queen Creek AZ\COM_Ironstone rittenhouse addition_Drawings.pdf")
ANSWER = Path(r"Y:\Shared\HaloOps\02-Active jobs\03-Closed\Porter Brother\Ironwood LDS Seminary Annex-Queen Creek AZ\IronwoodSeminary-Plans-AsBuid-10.23.20 .pdf")
FONT_PATH = Path(r"C:\Windows\Fonts\segoeui.ttf")
FONT_BOLD_PATH = Path(r"C:\Windows\Fonts\segoeuib.ttf")


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT_BOLD_PATH if bold else FONT_PATH), size)


def render_page(pdf: Path, page_index: int, scale: float = 2.0) -> Image.Image:
    doc = fitz.open(pdf)
    page = doc[page_index]
    pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
    return Image.frombytes("RGB", [pix.width, pix.height], pix.samples)


def banner(image: Image.Image, title: str, subtitle: str, color: tuple[int, int, int]) -> Image.Image:
    height = 150
    canvas = Image.new("RGB", (image.width, image.height + height), "white")
    canvas.paste(image, (0, height))
    draw = ImageDraw.Draw(canvas)
    draw.rectangle((0, 0, canvas.width, height), fill=color)
    draw.text((35, 20), title, fill="white", font=font(45, True))
    draw.text((35, 82), subtitle, fill="white", font=font(25))
    return canvas


def marker(draw: ImageDraw.ImageDraw, x: float, y: float, kind: str, label: str) -> None:
    color = (220, 38, 38) if kind == "pendent" else (25, 90, 210)
    radius = 17
    draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=(255, 255, 255), outline=color, width=7)
    if kind == "upright":
        draw.line((x - 13, y + 13, x + 13, y - 13), fill=color, width=6)
    else:
        draw.ellipse((x - 6, y - 6, x + 6, y + 6), fill=color)
    draw.rounded_rectangle((x + 20, y - 19, x + 105, y + 19), radius=9, fill=(255, 255, 255), outline=color, width=3)
    draw.text((x + 29, y - 15), label, fill=color, font=font(20, True))


def source_xy(head: dict) -> tuple[float, float]:
    # Registration is to the printed A101 dimensions, never to answer heads.
    return 3855 + 18.5 * head["localFt"]["x"], 901 + 19.06 * head["localFt"]["y"]


def rcp_xy(head: dict) -> tuple[float, float]:
    # Independent A102 RCP registration from the new-work wall rectangle.
    return 4120 + 17.6 * head["localFt"]["x"], 750 + 17.6 * head["localFt"]["y"]


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_svg(candidate: dict) -> Path:
    target = OUT / "source-pdf-registered-3d.svg"
    p_heads = [h for h in candidate["heads"] if h["kind"] == "pendent"]
    u_heads = [h for h in candidate["heads"] if h["kind"] == "upright"]

    def iso(x: float, y: float, z: float) -> tuple[float, float]:
        return 245 + x * 15.2 + y * 6.7, 680 - z * 22 + y * 4.3

    walls = []
    for y0, y1 in ((0, 12.46875), (30.427084, 42.895834)):
        a = iso(0, y0, 0); b = iso(19.197917, y0, 0); c = iso(19.197917, y1, 0); d = iso(0, y1, 0)
        at = iso(0, y0, 8); bt = iso(19.197917, y0, 8); ct = iso(19.197917, y1, 8); dt = iso(0, y1, 8)
        walls.extend([
            f'<polygon points="{a[0]},{a[1]} {b[0]},{b[1]} {bt[0]},{bt[1]} {at[0]},{at[1]}" fill="#e6eef8" stroke="#64748b"/>',
            f'<polygon points="{b[0]},{b[1]} {c[0]},{c[1]} {ct[0]},{ct[1]} {bt[0]},{bt[1]}" fill="#d5e2f2" stroke="#64748b"/>',
            f'<polygon points="{at[0]},{at[1]} {bt[0]},{bt[1]} {iso(19.197917,y0+(y1-y0)/2,10.598)[0]},{iso(19.197917,y0+(y1-y0)/2,10.598)[1]} {iso(0,y0+(y1-y0)/2,10.598)[0]},{iso(0,y0+(y1-y0)/2,10.598)[1]}" fill="#7f9fbe" fill-opacity=".75" stroke="#24415c"/>',
            f'<polygon points="{iso(0,y0+(y1-y0)/2,10.598)[0]},{iso(0,y0+(y1-y0)/2,10.598)[1]} {iso(19.197917,y0+(y1-y0)/2,10.598)[0]},{iso(19.197917,y0+(y1-y0)/2,10.598)[1]} {ct[0]},{ct[1]} {dt[0]},{dt[1]}" fill="#597d9f" fill-opacity=".72" stroke="#24415c"/>',
        ])
    connector_y0, connector_y1 = 19.197917, 23.697917
    ca = iso(0, connector_y0, 0); cb = iso(19.197917, connector_y0, 0)
    cc = iso(19.197917, connector_y1, 0); cd = iso(0, connector_y1, 0)
    cat = iso(0, connector_y0, 8); cbt = iso(19.197917, connector_y0, 8)
    cct = iso(19.197917, connector_y1, 8); cdt = iso(0, connector_y1, 8)
    cap_a = iso(0, connector_y0, 9); cap_b = iso(19.197917, connector_y0, 9)
    cap_c = iso(19.197917, connector_y1, 9); cap_d = iso(0, connector_y1, 9)
    walls.extend([
        f'<polygon points="{ca[0]},{ca[1]} {cb[0]},{cb[1]} {cbt[0]},{cbt[1]} {cat[0]},{cat[1]}" fill="#edf2f7" stroke="#64748b"/>',
        f'<polygon points="{cb[0]},{cb[1]} {cc[0]},{cc[1]} {cct[0]},{cct[1]} {cbt[0]},{cbt[1]}" fill="#dbe7f3" stroke="#64748b"/>',
        f'<polygon points="{cap_a[0]},{cap_a[1]} {cap_b[0]},{cap_b[1]} {cap_c[0]},{cap_c[1]} {cap_d[0]},{cap_d[1]}" fill="#fdba74" fill-opacity=".40" stroke="#ea580c" stroke-width="4" stroke-dasharray="12 8"/>',
    ])
    markers = []
    for head in p_heads + u_heads:
        x, y = iso(head["localFt"]["x"], head["localFt"]["y"], (head["sourceProtectionPlaneZFt"] or 108) - 100)
        color = "#dc2626" if head["kind"] == "pendent" else "#195ad2"
        short_id = "".join(head["id"].split("-")[-2:])
        markers.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="7" fill="white" stroke="{color}" stroke-width="4"/><text x="{x+10:.1f}" y="{y-8:.1f}" font-size="13" fill="{color}">{short_id}</text>')
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1050 760">
<rect width="1050" height="760" fill="#f7fafc"/>
<text x="35" y="52" font-family="Segoe UI" font-size="30" font-weight="700" fill="#102a43">PDF-derived 3D transfer candidate</text>
<text x="35" y="84" font-family="Segoe UI" font-size="17" fill="#486581">A101 room extents + A102 roof plan + A201 5:12 sections + S300 framing</text>
<g stroke-width="2">{''.join(walls)}</g>
<line x1="725" y1="420" x2="{(cap_a[0]+cap_c[0])/2:.1f}" y2="{(cap_a[1]+cap_c[1])/2:.1f}" stroke="#c2410c" stroke-width="3"/>
<text x="725" y="405" font-family="Segoe UI" font-size="15" font-weight="700" fill="#c2410c">MISSED CONNECTOR ATTIC VOLUME</text>
<g>{''.join(markers)}</g>
<rect x="690" y="120" width="325" height="250" rx="18" fill="white" stroke="#cbd5e1"/>
<text x="715" y="160" font-family="Segoe UI" font-size="21" font-weight="700" fill="#102a43">Sealed candidate</text>
<text x="715" y="198" font-family="Segoe UI" font-size="18" fill="#dc2626">6 finished-ceiling targets</text>
<text x="715" y="230" font-family="Segoe UI" font-size="18" fill="#195ad2">4 pitched-attic targets</text>
<text x="715" y="278" font-family="Segoe UI" font-size="18" font-weight="700" fill="#9b1c1c">Completed answer: 6 attic</text>
<text x="715" y="310" font-family="Segoe UI" font-size="17" fill="#9b1c1c">Connector attic volume missed</text>
<text x="35" y="724" font-family="Segoe UI" font-size="15" fill="#7b341e">Model is source-registered evidence, not an installation, obstruction, hydraulic, fabrication, or compliance release model.</text>
</svg>'''
    target.write_bytes(svg.encode("utf-8"))
    return target


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    candidate = json.loads((DATA / "ironwood-seminary-pitched-holdout-candidate.json").read_text(encoding="utf-8"))
    score = json.loads((DATA / "ironwood-seminary-pitched-holdout-score.json").read_text(encoding="utf-8"))

    floor = render_page(SOURCE, 11)
    floor_draw = ImageDraw.Draw(floor)
    for head in candidate["heads"]:
        x, y = source_xy(head)
        y += 22 if head["kind"] == "pendent" else -22
        marker(floor_draw, x, y, head["kind"], head["id"].split("-")[-2] + head["id"].split("-")[-1])
    floor = banner(floor, "A101 — generated targets on the actual protected floor-plan PDF", "Red = finished ceiling · Blue = pitched concealed volume · Candidate sealed before answer open", (25, 54, 83))
    floor_path = OUT / "source-a101-generated-overlay.png"
    floor.save(floor_path)

    rcp = render_page(SOURCE, 12)
    rcp_draw = ImageDraw.Draw(rcp)
    for head in candidate["heads"]:
        x, y = rcp_xy(head)
        y += 22 if head["kind"] == "pendent" else -22
        marker(rcp_draw, x, y, head["kind"], head["id"].split("-")[-2] + head["id"].split("-")[-1])
    rcp_draw.rounded_rectangle((4060, 680, 4520, 1660), radius=25, outline=(255, 154, 0), width=9)
    rcp = banner(rcp, "A102 — generated targets on the actual protected RCP / roof-plan PDF", "The orange box is the new pitched annex. No completed sprinkler drawing is used as this underlay.", (31, 78, 71))
    rcp_path = OUT / "source-a102-generated-overlay.png"
    rcp.save(rcp_path)

    section = render_page(SOURCE, 13)
    sd = ImageDraw.Draw(section)
    sd.rounded_rectangle((1550, 1180, 3380, 1980), radius=30, outline=(25, 90, 210), width=10)
    sd.text((1585, 1210), "5:12 pitched section / ceiling framing source", fill=(25, 90, 210), font=font(34, True))
    section = banner(section, "A201 — elevation and pitched-section source used for Z geometry", "Wall plate datum 108'-0\"; roof target is source-plane only. Exact installed Z remains unset.", (66, 48, 97))
    section_path = OUT / "source-a201-elevation-overlay.png"
    section.save(section_path)

    answer = render_page(ANSWER, 0)
    addition = answer.crop((3150, 500, 4350, 1900))
    schedule = answer.crop((2550, 1900, 4300, 2700))
    panel = Image.new("RGB", (3050, 1570), "white")
    panel.paste(addition, (30, 140))
    panel.paste(schedule.resize((1750, 800)), (1270, 140))
    pd = ImageDraw.Draw(panel)
    pd.rectangle((0, 0, panel.width, 120), fill=(126, 29, 29))
    pd.text((30, 20), "COMPLETED AS-BUILT ANSWER — actual PDF", fill="white", font=font(44, True))
    pd.text((30, 82), "Schedule proves 6 concealed pendent + 6 upright attic = 12; sealed candidate produced 6 + 4 = 10", fill="white", font=font(24))
    pd.rounded_rectangle((1900, 1030, 3000, 1495), radius=24, fill=(255, 247, 237), outline=(194, 65, 12), width=6)
    pd.text((1940, 1070), "FRESH HOLDOUT FAILED", fill=(154, 52, 18), font=font(40, True))
    pd.text((1940, 1140), "PASS  pendent count: 6 / 6", fill=(22, 101, 52), font=font(29, True))
    pd.text((1940, 1195), "FAIL  attic upright count: 4 / 6", fill=(185, 28, 28), font=font(29, True))
    pd.text((1940, 1260), "Two connector-attic heads missing.", fill=(127, 29, 29), font=font(25))
    pd.text((1940, 1310), "XY acceptance was not scored after", fill=(127, 29, 29), font=font(23))
    pd.text((1940, 1345), "count/kind failure; no candidate retune.", fill=(127, 29, 29), font=font(23))
    answer_path = OUT / "completed-asbuilt-answer-and-schedule.png"
    panel.save(answer_path)

    model_path = write_svg(candidate)
    files = [floor_path, rcp_path, section_path, answer_path, model_path]
    proof = {
        "artifactType": "halofire.visual-proof.v1",
        "projectId": candidate["projectId"],
        "candidateReceiptSha256": candidate["receiptSha256"],
        "scoreReceiptSha256": score["receiptSha256"],
        "sourcePdfSha256": "b80b399aa219dd91344d68ad8637e22e165a87d7726427764348ead7ef21cba6",
        "answerPdfSha256": "b255334e85905cb0694bdb697393eac5aae66647e67e4b5f5ba59d16811957d9",
        "files": [{"file": path.name, "sha256": sha(path)} for path in files],
        "visualReview": {"browserInspected": False, "decodedImageCount": 0, "consoleErrors": None, "actualPdfUnderlaysPresent": True, "failureVisiblyDisclosed": True},
        "acceptance": score["acceptance"],
        "claimBoundary": {"freshProjectPlacementVerified": False, "complianceReady": False, "fabricationReady": False, "fieldReleaseReady": False},
    }
    (OUT / "proof.json").write_bytes((json.dumps(proof, indent=2) + "\n").encode("utf-8"))
    cards = "\n".join(f'<figure><img src="{path.name}" alt="{path.stem}"><figcaption>{path.stem.replace("-", " ")}</figcaption></figure>' for path in files)
    html = f'''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ironwood pitched holdout proof</title><style>
body{{margin:0;background:#07111d;color:#e6edf5;font-family:Inter,Segoe UI,sans-serif}}header{{padding:34px 5vw;background:linear-gradient(135deg,#102a43,#7e1d1d)}}h1{{margin:0 0 12px;font-size:clamp(30px,5vw,58px)}}.fail{{display:inline-block;padding:9px 15px;border-radius:999px;background:#fecaca;color:#7f1d1d;font-weight:800}}main{{padding:28px 4vw 70px}}.summary{{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-bottom:28px}}.metric,figure{{background:#102131;border:1px solid #29445f;border-radius:18px;box-shadow:0 18px 45px #0007}}.metric{{padding:18px}}.metric strong{{display:block;font-size:30px}}figure{{margin:0 0 26px;overflow:hidden}}img{{display:block;width:100%;height:auto;background:white}}figcaption{{padding:14px 18px;text-transform:capitalize;color:#b9c9d8}}.boundary{{padding:22px;border:2px solid #ef4444;background:#3f1318;border-radius:16px;font-weight:700}}@media(max-width:800px){{.summary{{grid-template-columns:1fr 1fr}}}}</style></head><body>
<header><span class="fail">FRESH HOLDOUT FAILED</span><h1>Ironwood pitched-roof transfer proof</h1><p>Actual A101 / A102 / A201 PDF underlays and the actual completed as-built answer. Candidate sealed at cb697e5e before answer open.</p></header><main>
<section class="summary"><div class="metric"><strong>10</strong>sealed candidate heads</div><div class="metric"><strong>12</strong>completed as-built heads</div><div class="metric"><strong>6 / 6</strong>pendent parity</div><div class="metric"><strong>4 / 6</strong>attic upright failure</div></section>
{cards}
<p class="boundary">Fresh-project placement, obstruction clearance, compliance, hydraulics, fabrication, and field release remain blocked. The candidate was not retuned after the answer was opened.</p>
</main></body></html>'''
    (OUT / "index.html").write_bytes(html.encode("utf-8"))
    print(json.dumps({"status": "passed", "output": str(OUT), "files": [path.name for path in files], "accepted": False}, indent=2))


if __name__ == "__main__":
    main()

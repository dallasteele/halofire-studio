from __future__ import annotations

import argparse
import io
import json
from pathlib import Path

import fitz
from PIL import Image, ImageDraw, ImageFont


DEFAULT_PDF = Path(r"Y:\Shared\HaloOps\02-Active jobs\03-Closed\Adolfson & Peterson\MIT Riverside - Phoenix AZ\Bid Files\18_434 Riverside Bid Set 050820-1.pdf")
CLIP = fitz.Rect(220, 660, 1270, 2040)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", type=Path, default=DEFAULT_PDF)
    parser.add_argument("--evidence", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    evidence = json.loads(args.evidence.read_text(encoding="utf-8"))
    with fitz.open(args.pdf) as document:
        pixmap = document[104].get_pixmap(matrix=fitz.Matrix(4, 4), clip=CLIP, alpha=False)
        image = Image.open(io.BytesIO(pixmap.tobytes("png"))).convert("RGB")
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default(size=22)
    for head in evidence["heads"]:
        x = (head["sourceRcpPdfPointPt"]["x"] - CLIP.x0) * 4
        y = (head["sourceRcpPdfPointPt"]["y"] - CLIP.y0) * 4
        color = (0, 165, 190) if head["kind"] == "pendent" else (230, 126, 20)
        draw.ellipse((x - 19, y - 19, x + 19, y + 19), outline=(255, 255, 255), width=8)
        draw.ellipse((x - 19, y - 19, x + 19, y + 19), outline=color, width=5)
    for point in evidence["sourceRcpObservations"]["openToStructureLabelCentersPt"]:
        x = (point["x"] - CLIP.x0) * 4
        y = (point["y"] - CLIP.y0) * 4
        draw.rectangle((x - 18, y - 12, x + 18, y + 12), outline=(0, 150, 80), width=5)
    legend = "SOURCE RCP PAGE 105 - 53 UPRIGHT (ORANGE), 15 PENDENT (CYAN), 11 O.T.S. LABELS (GREEN); XY ONLY - NO Z/PLANE CLAIM"
    draw.rectangle((20, 20, 3450, 72), fill=(7, 17, 31))
    draw.text((36, 33), legend, font=font, fill=(255, 255, 255))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    image.save(args.output)
    print(json.dumps({"output": str(args.output), "width": image.width, "height": image.height, "heads": len(evidence["heads"]), "otsLabels": len(evidence["sourceRcpObservations"]["openToStructureLabelCentersPt"])}, indent=2))


if __name__ == "__main__":
    main()

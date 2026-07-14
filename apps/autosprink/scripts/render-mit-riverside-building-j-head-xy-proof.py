from __future__ import annotations

import argparse
import io
import json
from pathlib import Path

import fitz
from PIL import Image, ImageDraw, ImageFont


DEFAULT_PDF = Path(r"Y:\Shared\HaloOps\02-Active jobs\03-Closed\Adolfson & Peterson\MIT Riverside - Phoenix AZ\Engineering\City Approved FS Plans\State Fire Marshal Approved Plan Set.pdf")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", type=Path, default=DEFAULT_PDF)
    parser.add_argument("--evidence", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    evidence = json.loads(args.evidence.read_text(encoding="utf-8"))
    with fitz.open(args.pdf) as document:
        pixmap = document[1].get_pixmap(matrix=fitz.Matrix(4, 4), clip=fitz.Rect(1250, 120, 2450, 1500), alpha=False)
        image = Image.open(io.BytesIO(pixmap.tobytes("png"))).convert("RGB")
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default(size=22)
    for head in evidence["heads"]:
        x = head["cropPixel"]["x"]
        y = head["cropPixel"]["y"]
        color = (0, 165, 190) if head["kind"] == "pendent" else (230, 126, 20)
        draw.ellipse((x - 19, y - 19, x + 19, y + 19), outline=(255, 255, 255), width=8)
        draw.ellipse((x - 19, y - 19, x + 19, y + 19), outline=color, width=5)
    excluded = evidence["excludedSymbols"][0]["pagePointPt"]
    excluded_x = (1342 - excluded["y"]) * 4
    excluded_y = (excluded["x"] - 120) * 4
    draw.line((excluded_x - 20, excluded_y - 20, excluded_x + 20, excluded_y + 20), fill=(180, 0, 180), width=8)
    draw.line((excluded_x - 20, excluded_y + 20, excluded_x + 20, excluded_y - 20), fill=(180, 0, 180), width=8)
    legend = "EXACT VECTOR XY OVERLAY — 53 UPRIGHT (ORANGE) + 15 PENDENT (CYAN) = 68; CROSSED VALVE EXCLUDED (MAGENTA)"
    draw.rectangle((20, 20, 3200, 70), fill=(7, 17, 31))
    draw.text((36, 32), legend, font=font, fill=(255, 255, 255))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    image.save(args.output)
    print(json.dumps({"output": str(args.output), "width": image.width, "height": image.height, "heads": len(evidence["heads"]), "excluded": 1}, indent=2))


if __name__ == "__main__":
    main()

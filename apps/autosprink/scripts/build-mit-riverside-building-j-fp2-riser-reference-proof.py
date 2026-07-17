"""Render the FP-2 to FP-7 riser reference without promoting generic detail geometry."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import fitz
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
CORPUS = Path(r"Y:\Shared\HaloOps\02-Active jobs\03-Closed\Adolfson & Peterson\MIT Riverside - Phoenix AZ")
APPROVED = CORPUS / "Engineering/City Approved FS Plans/State Fire Marshal Approved Plan Set.pdf"
AS_BUILT = CORPUS / "Field Operations/As Builts/State Fire Marshal Approved Plan Set_As Builts.pdf"
APPROVED_SHA256 = "6da51cbd5bdbf34861502630311f8d0e3d4c8e3dcb61896ba614ff634fde8421"
AS_BUILT_SHA256 = "b7a8c3c2faceacba6c41437f773af650cdcc84eddc44cc5a88e1e563ac052207"
PLAN_PAGE_INDEX = 1
DETAIL_PAGE_INDEX = 6
PLAN_RENDER_CROP = fitz.Rect(1250, 120, 2450, 1500)
PLAN_CALLOUT_PIXEL_CROP = (3300, 1800, 4800, 3600)
DETAIL_PIXEL_CROP = (3200, 300, 4700, 2500)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_utf8_lf(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as output:
        output.write(content)


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in (Path(r"C:\Windows\Fonts\arialbd.ttf" if bold else r"C:\Windows\Fonts\arial.ttf"), Path(r"C:\Windows\Fonts\segoeuib.ttf" if bold else r"C:\Windows\Fonts\segoeui.ttf")):
        if path.exists():
            return ImageFont.truetype(str(path), size=size)
    return ImageFont.load_default(size=size)


def page_image(path: Path, page_index: int, matrix: fitz.Matrix, clip: fitz.Rect | None = None) -> Image.Image:
    with fitz.open(path) as document:
        pixmap = document[page_index].get_pixmap(matrix=matrix, clip=clip, alpha=False)
    return Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-data", type=Path, default=ROOT / "src/data/mit-riverside-building-j-fp2-riser-reference.json")
    parser.add_argument("--output-proof", type=Path, default=ROOT / "src/data/proofs/mit-riverside-building-j-fp2-riser-reference")
    args = parser.parse_args()
    if digest(APPROVED) != APPROVED_SHA256 or digest(AS_BUILT) != AS_BUILT_SHA256:
        raise RuntimeError("Building J approved/as-built source digest drift")
    plan_approved = page_image(APPROVED, PLAN_PAGE_INDEX, fitz.Matrix(4, 4), PLAN_RENDER_CROP).crop(PLAN_CALLOUT_PIXEL_CROP)
    plan_as_built = page_image(AS_BUILT, PLAN_PAGE_INDEX, fitz.Matrix(4, 4), PLAN_RENDER_CROP).crop(PLAN_CALLOUT_PIXEL_CROP)
    detail_approved = page_image(APPROVED, DETAIL_PAGE_INDEX, fitz.Matrix(2, 2)).crop(DETAIL_PIXEL_CROP)
    detail_as_built = page_image(AS_BUILT, DETAIL_PAGE_INDEX, fitz.Matrix(2, 2)).crop(DETAIL_PIXEL_CROP)
    if plan_approved.size != plan_as_built.size or plan_approved.tobytes() != plan_as_built.tobytes():
        raise RuntimeError("approved/as-built FP-2 riser-callout crop differs")
    if detail_approved.size != detail_as_built.size or detail_approved.tobytes() != detail_as_built.tobytes():
        raise RuntimeError("approved/as-built FP-7 riser-detail crop differs")
    canvas = Image.new("RGB", (plan_approved.width + detail_approved.width + 84, max(plan_approved.height, detail_approved.height) + 196), (7, 17, 31))
    draw = ImageDraw.Draw(canvas)
    draw.text((32, 26), "TRANSPORTATION J: FP-2 RISER REFERENCE TO FP-7", font=font(36, True), fill=(241, 245, 249))
    draw.text((32, 76), "Source evidence only. FP-2 names a 3 in fire riser; FP-7 is a generic wet-riser detail with a visible 4 in base pipe. Do not merge them into installed geometry.", font=font(20), fill=(186, 230, 253))
    canvas.paste(plan_approved, (24, 150))
    canvas.paste(detail_approved, (plan_approved.width + 60, 150))
    draw.rectangle((24, 150, 24 + plan_approved.width, 150 + plan_approved.height), outline=(34, 211, 238), width=5)
    draw.rectangle((plan_approved.width + 60, 150, plan_approved.width + 60 + detail_approved.width, 150 + detail_approved.height), outline=(249, 115, 22), width=5)
    draw.text((36, 160), "FP-2: 3 in FIRE RISER REFER TO FP7", font=font(20, True), fill=(8, 47, 73))
    draw.text((plan_approved.width + 72, 160), "FP-7: FIRE RISER DETAIL (generic detail)", font=font(20, True), fill=(124, 45, 18))
    args.output_proof.mkdir(parents=True, exist_ok=True)
    image_path = args.output_proof / "fp2-to-fp7-riser-reference.png"
    canvas.save(image_path)
    artifact = {
        "artifactType": "halofire.mit-riverside-building-j-fp2-riser-reference.v1",
        "projectId": "mit-riverside-building-j",
        "status": "passed-cross-sheet-reference-only",
        "sources": {"approved": {"sha256": APPROVED_SHA256}, "asBuilt": {"sha256": AS_BUILT_SHA256}, "fp2": {"physicalPage": 2, "sheet": "FP-2"}, "fp7": {"physicalPage": 7, "sheet": "FP-7"}},
        "observedSourceReference": {"fp2Callout": "3 in FIRE RISER REFER TO FP7 FOR DETAIL", "fp7Title": "FIRE RISER DETAIL", "fp2RiserNominalIn": 3, "fp7GenericBasePipeIn": 4, "approvedAsBuiltFp2CropIdentical": True, "approvedAsBuiltFp7CropIdentical": True},
        "claims": {"fp2ToFp7RiserReferenceReady": True, "installedRiserGeometryReady": False, "installedRiserLocationBoundToCenterline": False, "installedRiserElevationReady": False, "fieldDrainRouteReady": False, "hydraulicClosureReady": False, "fabricationReady": False, "employeeUseReady": False, "vpsReleaseReady": False},
        "limitations": ["FP-7 is a generic wet-riser detail. Its visible 4 in base-pipe notation conflicts with the FP-2 project callout's 3 in riser notation and is not propagated into project geometry.", "No installed riser endpoint, elevation, pipe material, fittings, drain route, hydraulic connection, fabrication, employee-use, or release claim is made."],
        "image": {"file": image_path.name, "sha256": digest(image_path), "bytes": image_path.stat().st_size},
    }
    write_utf8_lf(args.output_data, json.dumps(artifact, indent=2) + "\n")
    write_utf8_lf(args.output_proof / "proof.json", json.dumps(artifact, indent=2) + "\n")
    html = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Transportation J riser reference proof</title><style>body{{margin:0;min-height:100vh;font-family:Inter,system-ui,sans-serif;color:#e7eef8;background:radial-gradient(circle at 10% 0,#183e62,transparent 34%),#07111f}}main{{max-width:1840px;margin:auto;padding:32px}}section{{padding:28px;border-radius:24px;background:rgba(13,32,54,.72);border:1px solid rgba(164,198,235,.28);box-shadow:0 20px 60px rgba(0,0,0,.25);backdrop-filter:blur(18px)}}h1{{margin:0;font-size:clamp(1.7rem,3vw,2.6rem)}}p{{line-height:1.55;color:#c8d5e5}}img{{width:100%;border-radius:16px;border:1px solid #35516f}}.badges{{display:flex;gap:10px;flex-wrap:wrap;margin:18px 0}}span{{padding:7px 11px;border-radius:999px;border:1px solid #a45b17;background:#422006;color:#fde68a}}.ok{{border-color:#0f8b70;background:#063a31;color:#b7f7e4}}</style></head><body><main><section><h1>Transportation J - FP-2 to FP-7 riser reference</h1><p>The plan calls out a 3 in fire riser and points to FP-7. FP-7 is retained beside it as source evidence, with its generic 4 in base-pipe detail visibly distinct. This is a cross-sheet reference, not installed riser geometry.</p><div class="badges"><span class="ok">FP-2 reference retained</span><span class="ok">FP-7 detail retained</span><span>Installed geometry and drains held</span></div><img src="{image_path.name}" alt="Actual FP-2 three inch fire riser reference beside actual FP-7 Fire Riser Detail"></section></main></body></html>'''
    write_utf8_lf(args.output_proof / "index.html", html)
    print(json.dumps(artifact, indent=2))


if __name__ == "__main__":
    main()

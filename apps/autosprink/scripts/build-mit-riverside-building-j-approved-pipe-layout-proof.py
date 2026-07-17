"""Render an approved/as-built FP-2 pipe-layout underlay with exact head XY only."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import fitz
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CORPUS = Path(r"Y:\Shared\HaloOps\02-Active jobs\03-Closed\Adolfson & Peterson\MIT Riverside - Phoenix AZ")
APPROVED_RELATIVE = Path("Engineering/City Approved FS Plans/State Fire Marshal Approved Plan Set.pdf")
AS_BUILT_RELATIVE = Path("Field Operations/As Builts/State Fire Marshal Approved Plan Set_As Builts.pdf")
APPROVED_SHA256 = "6da51cbd5bdbf34861502630311f8d0e3d4c8e3dcb61896ba614ff634fde8421"
AS_BUILT_SHA256 = "b7a8c3c2faceacba6c41437f773af650cdcc84eddc44cc5a88e1e563ac052207"
PHYSICAL_PAGE = 2
PAGE_INDEX = 1
# This rotated-renderer crop contains the complete Transportation J plan and FP-2 title.
RENDER_CROP = fitz.Rect(1250, 120, 2450, 1500)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_utf8_lf(path: Path, content: str) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as output:
        output.write(content)


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        Path(r"C:\Windows\Fonts\arialbd.ttf" if bold else r"C:\Windows\Fonts\arial.ttf"),
        Path(r"C:\Windows\Fonts\segoeuib.ttf" if bold else r"C:\Windows\Fonts\segoeui.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size=size)
    return ImageFont.load_default(size=size)


def render_page(path: Path) -> tuple[bytes, Image.Image]:
    with fitz.open(path) as document:
        if document.page_count <= PAGE_INDEX:
            raise RuntimeError(f"{path.name} does not contain physical page {PHYSICAL_PAGE}")
        pixmap = document[PAGE_INDEX].get_pixmap(matrix=fitz.Matrix(4, 4), clip=RENDER_CROP, alpha=False)
    return pixmap.samples, Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--corpus-root", type=Path, default=DEFAULT_CORPUS)
    parser.add_argument("--head-evidence", type=Path, default=ROOT / "src/data/mit-riverside-building-j-head-coordinate-evidence.json")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "src/data/proofs/mit-riverside-building-j-approved-pipe-layout")
    args = parser.parse_args()

    approved = args.corpus_root / APPROVED_RELATIVE
    as_built = args.corpus_root / AS_BUILT_RELATIVE
    if digest(approved) != APPROVED_SHA256:
        raise RuntimeError("approved FP-2 source digest drift")
    if digest(as_built) != AS_BUILT_SHA256:
        raise RuntimeError("as-built FP-2 source digest drift")
    evidence = json.loads(args.head_evidence.read_text(encoding="utf-8"))
    if evidence.get("answerDocuments", {}).get("physicalPage") != PHYSICAL_PAGE:
        raise RuntimeError("head evidence is not bound to approved FP-2")
    if evidence.get("answerDocuments", {}).get("approvedSha256") != APPROVED_SHA256:
        raise RuntimeError("head evidence approved digest drift")
    if evidence.get("answerDocuments", {}).get("asBuiltSha256") != AS_BUILT_SHA256:
        raise RuntimeError("head evidence as-built digest drift")
    if evidence.get("counts") != {"pendent": 15, "upright": 53, "total": 68}:
        raise RuntimeError("expected Building J head counts changed")

    approved_pixels, image = render_page(approved)
    as_built_pixels, as_built_image = render_page(as_built)
    if image.size != as_built_image.size or approved_pixels != as_built_pixels:
        raise RuntimeError("approved and as-built FP-2 rendered crops differ")

    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((18, 18, image.width - 18, 132), radius=18, fill=(7, 17, 31), outline=(75, 101, 130), width=3)
    draw.text((42, 39), "APPROVED FP-2 PIPE LAYOUT - TRANSPORTATION J", font=font(36, True), fill=(241, 245, 249))
    draw.text((42, 84), "Original approved pipework remains visible. Colored rings are exact approved/as-built head XY only; no route is synthesized.", font=font(22), fill=(186, 230, 253))
    for head in evidence["heads"]:
        x = head["cropPixel"]["x"]
        y = head["cropPixel"]["y"]
        color = (249, 115, 22) if head["kind"] == "upright" else (6, 182, 212)
        draw.ellipse((x - 19, y - 19, x + 19, y + 19), outline=(255, 255, 255), width=8)
        draw.ellipse((x - 19, y - 19, x + 19, y + 19), outline=color, width=5)
    excluded = evidence["excludedSymbols"][0]["pagePointPt"]
    excluded_x = (1342 - excluded["y"]) * 4
    excluded_y = (excluded["x"] - 120) * 4
    draw.line((excluded_x - 20, excluded_y - 20, excluded_x + 20, excluded_y + 20), fill=(217, 70, 239), width=8)
    draw.line((excluded_x - 20, excluded_y + 20, excluded_x + 20, excluded_y - 20), fill=(217, 70, 239), width=8)

    args.output_dir.mkdir(parents=True, exist_ok=True)
    image_path = args.output_dir / "approved-fp2-pipe-underlay-head-overlay.png"
    image.save(image_path)
    image_sha = digest(image_path)
    proof = {
        "artifactType": "halofire.mit-riverside-building-j-approved-pipe-layout-proof.v1",
        "projectId": evidence["projectId"],
        "projectName": evidence["projectName"],
        "status": "passed-source-underlay-only",
        "sources": {
            "approved": {"sha256": APPROVED_SHA256, "physicalPage": PHYSICAL_PAGE, "pageIndex": PAGE_INDEX, "role": "approved-fire-sprinkler-piping-plan"},
            "asBuilt": {"sha256": AS_BUILT_SHA256, "physicalPage": PHYSICAL_PAGE, "pageIndex": PAGE_INDEX, "role": "as-built-fire-sprinkler-piping-plan"},
            "headEvidence": {"file": args.head_evidence.name, "receiptSha256": evidence["answerEvidenceReceiptSha256"], "approvedAsBuiltVectorSymbolsIdentical": True},
        },
        "render": {"renderer": "PyMuPDF", "scale": 4, "rotatedRendererCrop": list(RENDER_CROP), "approvedAsBuiltPixelsIdentical": True, "pixelWidth": image.width, "pixelHeight": image.height},
        "headOverlay": {"total": 68, "upright": 53, "pendent": 15, "crossedValveExcluded": 1, "coordinateBasis": "immutable approved/as-built FP-2 vector symbols"},
        "image": {"file": image_path.name, "sha256": image_sha, "bytes": image_path.stat().st_size},
        "claims": {
            "actualApprovedPipeworkVisible": True,
            "approvedAsBuiltPipeUnderlayIdentical": True,
            "exactHeadXyRegistered": True,
            "semanticPipeNetworkExtracted": False,
            "pipeSizesAndFittingsExtracted": False,
            "pipeElevationsExtracted": False,
            "hydraulicNetworkReady": False,
            "codeComplianceReady": False,
            "fabricationReady": False,
            "employeeUseReady": False,
            "vpsReleaseReady": False,
        },
        "limitations": [
            "This is an approved-plan underlay proof, not a generated pipe-routing result.",
            "Original pipe linework remains visible but is not yet decomposed into semantic mains, branch lines, fittings, sizes, elevations, or hydraulic graph edges.",
            "No code, fabrication, field-release, employee-use, or VPS-release claim is made.",
        ],
    }
    write_utf8_lf(args.output_dir / "proof.json", json.dumps(proof, indent=2) + "\n")
    html = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Transportation J approved pipe layout proof</title><style>
:root{{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:#07111f}}*{{box-sizing:border-box}}body{{margin:0;min-height:100vh;background:radial-gradient(circle at 12% 0%,#15365a 0,transparent 34%),radial-gradient(circle at 90% 12%,#2a1757 0,transparent 30%),#07111f;color:#e7eef8}}main{{max-width:1840px;margin:auto;padding:34px}}header,.glass{{background:rgba(13,32,54,.72);border:1px solid rgba(164,198,235,.28);box-shadow:0 20px 60px rgba(0,0,0,.25);backdrop-filter:blur(18px);border-radius:24px}}header{{padding:28px 32px;margin-bottom:22px}}h1{{margin:0;font-size:clamp(1.6rem,3vw,2.55rem);letter-spacing:-.04em}}p{{color:#c8d5e5;line-height:1.55}}.badges{{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}}.badge{{padding:7px 11px;border-radius:999px;background:#102c47;border:1px solid #2d618c;color:#bde7ff;font-size:.86rem}}.hold{{background:#422006;border-color:#a45b17;color:#fde68a}}.proof{{padding:18px}}img{{display:block;width:100%;height:auto;border-radius:16px;border:1px solid #35516f}}.grid{{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin:20px 0}}.metric{{padding:18px}}.metric b{{display:block;font-size:1.45rem;color:#f8fafc}}.metric span{{color:#9fb4c9;font-size:.9rem}}code{{color:#a7f3d0;word-break:break-all}}@media(max-width:760px){{main{{padding:16px}}header{{padding:22px}}.grid{{grid-template-columns:1fr}}}}
</style></head><body><main><header><h1>Transportation J - approved FP-2 pipe layout</h1><p>The original City-approved and as-built piping plan is the visible underlay. This proof overlays only the 68 immutable approved/as-built head coordinates, so an operator can inspect the real branch layout, pipe directions, cross-section callouts, hydraulic box, and riser reference before any routing engine acts.</p><div class="badges"><span class="badge">Approved/as-built crop pixel-identical</span><span class="badge">53 upright + 15 pendent heads</span><span class="badge hold">Semantic pipe graph still held</span></div></header><section class="glass proof"><img src="{image_path.name}" alt="Actual approved FP-2 Transportation J fire sprinkler piping plan with exact upright and pendent head-coordinate rings"><div class="grid"><div class="glass metric"><b>FP-2 / page 2</b><span>Approved and as-built source page</span></div><div class="glass metric"><b>68 exact XY heads</b><span>Original vector symbols, not generated placements</span></div><div class="glass metric"><b>0 synthesized routes</b><span>Pipe sizes, elevations, hydraulics, and release remain closed</span></div></div><p>Approved PDF SHA-256: <code>{APPROVED_SHA256}</code></p></section></main></body></html>'''
    write_utf8_lf(args.output_dir / "index.html", html)
    print(json.dumps({"output": str(args.output_dir), "imageSha256": image_sha, "headOverlay": proof["headOverlay"], "claims": proof["claims"]}, indent=2))


if __name__ == "__main__":
    main()

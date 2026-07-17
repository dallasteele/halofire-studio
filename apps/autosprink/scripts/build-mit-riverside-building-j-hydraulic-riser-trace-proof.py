"""Render Transportation J's source-bound hydraulic riser trace without claiming field geometry.

Inputs are the sealed approved/as-built plan set and the project-specific Transportation
hydraulic calculation. Outputs are a replayable JSON receipt plus an HTML/PNG proof page.
The calculation proves only its calculated node/pipe topology; it cannot establish the
installed riser XY, material, fittings, drains, or fabrication state.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

import fitz
from PIL import Image, ImageDraw, ImageFont
from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
CORPUS = Path(r"Y:\Shared\HaloOps\02-Active jobs\03-Closed\Adolfson & Peterson\MIT Riverside - Phoenix AZ")
APPROVED = CORPUS / "Engineering/City Approved FS Plans/State Fire Marshal Approved Plan Set.pdf"
AS_BUILT = CORPUS / "Field Operations/As Builts/State Fire Marshal Approved Plan Set_As Builts.pdf"
HYDRAULICS = CORPUS / "Engineering/Submittals/20172-TRANSPORTATION HYDRAULICS.pdf"
APPROVED_SHA256 = "6da51cbd5bdbf34861502630311f8d0e3d4c8e3dcb61896ba614ff634fde8421"
AS_BUILT_SHA256 = "b7a8c3c2faceacba6c41437f773af650cdcc84eddc44cc5a88e1e563ac052207"
HYDRAULICS_SHA256 = "2eaa513af17071a822f98d6be7afb909533bcb7ce2578466414cfc7563f2fce5"
FP2_PAGE_INDEX = 1
HYDRAULIC_NODES_PAGE_INDEX = 1
HYDRAULIC_PIPES_PAGE_INDEX = 3
FP2_RENDER_CROP = fitz.Rect(1250, 120, 2450, 1500)
FP2_CALLOUT_PIXEL_CROP = (3300, 1800, 4800, 3600)
HYDRAULIC_NODES_CROP = fitz.Rect(0, 150, 612, 670)
HYDRAULIC_PIPES_CROP = fitz.Rect(0, 330, 612, 735)


def digest(path: Path) -> str:
    """Return a source file's immutable SHA-256 digest."""
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_utf8_lf(path: Path, content: str) -> None:
    """Write deterministic UTF-8/LF output after creating the parent directory."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as output:
        output.write(content)


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    """Load an available Windows UI font with a deterministic fallback."""
    paths = (Path(r"C:\Windows\Fonts\arialbd.ttf" if bold else r"C:\Windows\Fonts\arial.ttf"), Path(r"C:\Windows\Fonts\segoeuib.ttf" if bold else r"C:\Windows\Fonts\segoeui.ttf"))
    for path in paths:
        if path.exists():
            return ImageFont.truetype(str(path), size=size)
    return ImageFont.load_default(size=size)


def page_image(path: Path, page_index: int, matrix: fitz.Matrix, clip: fitz.Rect | None = None) -> Image.Image:
    """Render one source PDF page, optionally clipped, into an RGB raster."""
    with fitz.open(path) as document:
        pixmap = document[page_index].get_pixmap(matrix=matrix, clip=clip, alpha=False)
    return Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)


def required_line(text: str, prefix: str) -> str:
    """Return a precise calculation row or reject source layout/text drift."""
    for line in text.splitlines():
        if line.lstrip().startswith(prefix):
            return line.strip()
    raise RuntimeError(f"Transportation hydraulic source is missing required row: {prefix}")


def required_source_node_line(text: str) -> str:
    """Select the node-analysis SRC row, never the earlier water-supply table row."""
    for line in text.splitlines():
        if line.lstrip().startswith("SRC ") and "SOURCE" in line:
            return line.strip()
    raise RuntimeError("Transportation hydraulic source is missing the node-analysis SRC row")


def calculated_trace(nodes_text: str, pipes_text: str) -> dict[str, object]:
    """Extract only the named hydraulic calculation topology used by the evidence receipt."""
    node_rows = {tag: required_line(nodes_text, f"{tag} ") for tag in ("TOR", "BOR", "UG", "UG6", "BF1", "BF2")}
    node_rows["SRC"] = required_source_node_line(nodes_text)
    for tag, elevation, pressure in (("TOR", "11.0", "41.7"), ("BOR", "1.0", "48.9"), ("UG", "-3.0", "51.1"), ("UG6", "-3.0", "52.0"), ("BF1", "3.0", "50.0"), ("BF2", "3.0", "55.0")):
        if elevation not in node_rows[tag] or pressure not in node_rows[tag]:
            raise RuntimeError(f"Transportation hydraulic {tag} row drifted from expected elevation/pressure")
    if "1.5" not in node_rows["SRC"] or "55.8" not in node_rows["SRC"] or "327.4" not in node_rows["SRC"]:
        raise RuntimeError("Transportation hydraulic supply row drifted from expected calculated demand")
    pipe_requirements = {
        "19": ("3.342", "50.17", "15", "20"),
        "20": ("3.342", "36.67", "20", "TOR"),
        "21": ("3.342", "10.00", "TOR", "BOR"),
        "22": ("4.150", "4.00", "BOR", "UG"),
        "23": ("4.150", "10.00", "UG", "UG6"),
        "24": ("8.380", "717.00", "UG6", "BF1"),
        "26": ("8.380", "32.00", "BF2", "SRC"),
    }
    for tag, required_tokens in pipe_requirements.items():
        expression = re.compile(rf"Pipe:\s+{tag}\s+.*?(?=Pipe:|\Z)", re.DOTALL)
        match = expression.search(pipes_text)
        if match is None or any(token not in match.group(0) for token in required_tokens):
            raise RuntimeError(f"Transportation hydraulic pipe {tag} is missing or drifted")
    return {
        "calculationOnly": True,
        "jobTitle": "TRANSPORTATION J",
        "demand": {"sprinklerGpm": 327.4, "withHoseGpm": 577.4, "borPressurePsi": 48.9},
        "nodes": [
            {"tag": "TOR", "elevationFt": 11.0, "pressurePsi": 41.7, "sourcePage": 2, "sourceRow": node_rows["TOR"]},
            {"tag": "BOR", "elevationFt": 1.0, "pressurePsi": 48.9, "sourcePage": 2, "sourceRow": node_rows["BOR"]},
            {"tag": "UG", "elevationFt": -3.0, "pressurePsi": 51.1, "sourcePage": 2, "sourceRow": node_rows["UG"]},
            {"tag": "UG6", "elevationFt": -3.0, "pressurePsi": 52.0, "sourcePage": 2, "sourceRow": node_rows["UG6"]},
            {"tag": "BF1", "elevationFt": 3.0, "pressurePsi": 50.0, "sourcePage": 2, "sourceRow": node_rows["BF1"]},
            {"tag": "BF2", "elevationFt": 3.0, "pressurePsi": 55.0, "sourcePage": 2, "sourceRow": node_rows["BF2"]},
            {"tag": "SRC", "elevationFt": 1.5, "pressurePsi": 55.8, "sprinklerDemandGpm": 327.4, "sourcePage": 2, "sourceRow": node_rows["SRC"]},
        ],
        "pipeChain": [
            {"tag": 19, "hydraulicDiameterIn": 3.342, "lengthFt": 50.17, "from": "15", "to": "20", "sourcePage": 4},
            {"tag": 20, "hydraulicDiameterIn": 3.342, "lengthFt": 36.67, "from": "20", "to": "TOR", "sourcePage": 4},
            {"tag": 21, "hydraulicDiameterIn": 3.342, "lengthFt": 10.0, "from": "TOR", "to": "BOR", "sourcePage": 4},
            {"tag": 22, "hydraulicDiameterIn": 4.15, "lengthFt": 4.0, "from": "BOR", "to": "UG", "sourcePage": 4},
            {"tag": 23, "hydraulicDiameterIn": 4.15, "lengthFt": 10.0, "from": "UG", "to": "UG6", "sourcePage": 4},
            {"tag": 24, "hydraulicDiameterIn": 8.38, "lengthFt": 717.0, "from": "UG6", "to": "BF1", "sourcePage": 4},
            {"tag": 26, "hydraulicDiameterIn": 8.38, "lengthFt": 32.0, "from": "BF2", "to": "SRC", "sourcePage": 4},
        ],
    }


def fit(image: Image.Image, width: int, height: int) -> Image.Image:
    """Contain an image in a proof tile without distorting source drawings."""
    copy = image.copy()
    copy.thumbnail((width, height), Image.Resampling.LANCZOS)
    return copy


def main() -> None:
    """Replay source evidence and write the hydraulic riser-trace receipt/proof."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-data", type=Path, default=ROOT / "src/data/mit-riverside-building-j-hydraulic-riser-trace.json")
    parser.add_argument("--output-proof", type=Path, default=ROOT / "src/data/proofs/mit-riverside-building-j-hydraulic-riser-trace")
    args = parser.parse_args()
    if digest(APPROVED) != APPROVED_SHA256 or digest(AS_BUILT) != AS_BUILT_SHA256 or digest(HYDRAULICS) != HYDRAULICS_SHA256:
        raise RuntimeError("Building J hydraulic riser-trace source digest drift")
    with PdfReader(str(HYDRAULICS)) as reader:
        nodes_text = reader.pages[HYDRAULIC_NODES_PAGE_INDEX].extract_text() or ""
        pipes_text = reader.pages[HYDRAULIC_PIPES_PAGE_INDEX].extract_text() or ""
    trace = calculated_trace(nodes_text, pipes_text)
    fp2_approved = page_image(APPROVED, FP2_PAGE_INDEX, fitz.Matrix(4, 4), FP2_RENDER_CROP).crop(FP2_CALLOUT_PIXEL_CROP)
    fp2_as_built = page_image(AS_BUILT, FP2_PAGE_INDEX, fitz.Matrix(4, 4), FP2_RENDER_CROP).crop(FP2_CALLOUT_PIXEL_CROP)
    if fp2_approved.size != fp2_as_built.size or fp2_approved.tobytes() != fp2_as_built.tobytes():
        raise RuntimeError("approved/as-built FP-2 riser-callout crop differs")
    node_page = page_image(HYDRAULICS, HYDRAULIC_NODES_PAGE_INDEX, fitz.Matrix(2, 2), HYDRAULIC_NODES_CROP)
    pipe_page = page_image(HYDRAULICS, HYDRAULIC_PIPES_PAGE_INDEX, fitz.Matrix(2, 2), HYDRAULIC_PIPES_CROP)
    tile_width, tile_height = 1300, 920
    canvas = Image.new("RGB", (tile_width + 48, tile_height * 3 + 274), (7, 17, 31))
    draw = ImageDraw.Draw(canvas)
    draw.text((32, 24), "TRANSPORTATION J: SOURCE-BOUND HYDRAULIC RISER TRACE", font=font(35, True), fill=(241, 245, 249))
    draw.text((32, 76), "FP-2's 3 in callout is retained beside the Transportation calculation's TOR/BOR/UG topology. Values are calculation evidence only—not installed geometry or drain routing.", font=font(18), fill=(186, 230, 253))
    tiles = [(fp2_approved, "FP-2 PROJECT CALLOUT"), (node_page, "HYDRAULICS P2: NODES"), (pipe_page, "HYDRAULICS P4: PIPE CHAIN")]
    for index, (image, title) in enumerate(tiles):
        x = 24
        y = 174 + index * (tile_height + 24)
        draw.rounded_rectangle((x, y, x + tile_width, y + tile_height), radius=16, fill=(12, 31, 52), outline=(34, 211, 238) if index == 0 else (249, 115, 22), width=4)
        rendered = fit(image, tile_width - 30, tile_height - 80)
        canvas.paste(rendered, (x + (tile_width - rendered.width) // 2, y + 54 + (tile_height - 80 - rendered.height) // 2))
        draw.text((x + 18, y + 16), title, font=font(20, True), fill=(224, 242, 254))
    args.output_proof.mkdir(parents=True, exist_ok=True)
    image_path = args.output_proof / "fp2-hydraulic-riser-trace.png"
    canvas.save(image_path)
    artifact = {
        "artifactType": "halofire.mit-riverside-building-j-hydraulic-riser-trace.v1",
        "projectId": "mit-riverside-building-j",
        "status": "passed-calculation-topology-only",
        "sources": {
            "approved": {"sha256": APPROVED_SHA256, "fp2PhysicalPage": 2},
            "asBuilt": {"sha256": AS_BUILT_SHA256, "fp2PhysicalPage": 2},
            "transportationHydraulics": {"sha256": HYDRAULICS_SHA256, "nodeAnalysisPhysicalPage": 2, "pipeDataPhysicalPage": 4},
        },
        "approvedAsBuiltFp2CalloutIdentical": True,
        "fp2Callout": "3 in FIRE RISER REFER TO FP7 FOR DETAIL",
        "calculatedTrace": trace,
        "claims": {
            "calculatedHydraulicRiserTraceReady": True,
            "installedRiserGeometryReady": False,
            "installedRiserLocationBoundToCenterline": False,
            "installedRiserMaterialReady": False,
            "installedRiserFittingsReady": False,
            "fieldDrainRouteReady": False,
            "fabricationReady": False,
            "employeeUseReady": False,
            "vpsReleaseReady": False,
        },
        "limitations": [
            "The Transportation hydraulic calculation establishes calculated node elevations, pressure, demand, and pipe-chain values only. It does not establish as-built XY geometry, material, actual fitting selection, or field installation.",
            "No drain is shown or inferred by this hydraulic trace. A dedicated project drain source is required before routing or quoting drains.",
            "The FP-2 callout's 3 in nominal riser language is retained separately from the hydraulic report's 3.342 in diameter field; neither is converted into installed geometry without source-bound coordinate evidence.",
        ],
        "image": {"file": image_path.name, "sha256": digest(image_path), "bytes": image_path.stat().st_size},
    }
    write_utf8_lf(args.output_data, json.dumps(artifact, indent=2) + "\n")
    write_utf8_lf(args.output_proof / "proof.json", json.dumps(artifact, indent=2) + "\n")
    html = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Transportation J hydraulic riser trace</title><style>body{{margin:0;min-height:100vh;font-family:Inter,system-ui,sans-serif;color:#e7eef8;background:radial-gradient(circle at 10% 0,#183e62,transparent 34%),#07111f}}main{{max-width:3200px;margin:auto;padding:32px}}section{{padding:28px;border-radius:24px;background:rgba(13,32,54,.72);border:1px solid rgba(164,198,235,.28);box-shadow:0 20px 60px rgba(0,0,0,.25);backdrop-filter:blur(18px)}}h1{{margin:0;font-size:clamp(1.7rem,3vw,2.6rem)}}p{{line-height:1.55;color:#c8d5e5}}img{{width:100%;border-radius:16px;border:1px solid #35516f}}.badges{{display:flex;gap:10px;flex-wrap:wrap;margin:18px 0}}span{{padding:7px 11px;border-radius:999px;border:1px solid #a45b17;background:#422006;color:#fde68a}}.ok{{border-color:#0f8b70;background:#063a31;color:#b7f7e4}}</style></head><body><main><section><h1>Transportation J - hydraulic riser trace</h1><p>Actual FP-2 and Transportation hydraulic source pages are retained together. TOR, BOR, underground, supply, demand, and hydraulic pipe-chain values are calculation evidence only. Installed XY, materials, fittings, drains, fabrication, and release remain held.</p><div class="badges"><span class="ok">Project calculation topology retained</span><span class="ok">FP-2 callout retained</span><span>Field geometry and drains held</span></div><img src="{image_path.name}" alt="Actual FP-2 riser callout beside Transportation hydraulic node and pipe calculation pages"></section></main></body></html>'''
    write_utf8_lf(args.output_proof / "index.html", html)
    print(json.dumps(artifact, indent=2))


if __name__ == "__main__":
    main()

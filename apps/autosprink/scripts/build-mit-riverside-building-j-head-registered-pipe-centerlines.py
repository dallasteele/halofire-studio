"""Extract source-registered FP-2 pipe centerlines without inventing pipe semantics."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

import fitz
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CORPUS = Path(r"Y:\Shared\HaloOps\02-Active jobs\03-Closed\Adolfson & Peterson\MIT Riverside - Phoenix AZ")
APPROVED_RELATIVE = Path("Engineering/City Approved FS Plans/State Fire Marshal Approved Plan Set.pdf")
AS_BUILT_RELATIVE = Path("Field Operations/As Builts/State Fire Marshal Approved Plan Set_As Builts.pdf")
APPROVED_SHA256 = "6da51cbd5bdbf34861502630311f8d0e3d4c8e3dcb61896ba614ff634fde8421"
AS_BUILT_SHA256 = "b7a8c3c2faceacba6c41437f773af650cdcc84eddc44cc5a88e1e563ac052207"
PAGE_INDEX = 1
PHYSICAL_PAGE = 2
PLAN_CLIP = (120.0, 120.0, 1500.0, 1342.0)
RENDER_CROP = fitz.Rect(1250, 120, 2450, 1500)
PIPE_STROKE_RGB = (0.0, 0.0, 0.0)
PIPE_STROKE_WIDTH_PT = 0.722
WIDTH_EPSILON = 0.001
MIN_SEGMENT_LENGTH_PT = 8.0
HEAD_CONTACT_TOLERANCE_PT = 8.0
CONNECTIVITY_TOLERANCE_PT = 0.25
POINTS_PER_FOOT = 9.0


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_utf8_lf(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as output:
        output.write(content)


def point_segment_distance(point: tuple[float, float], start: tuple[float, float], end: tuple[float, float]) -> float:
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    denominator = dx * dx + dy * dy
    fraction = 0.0 if denominator == 0 else max(0.0, min(1.0, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / denominator))
    return math.dist(point, (start[0] + fraction * dx, start[1] + fraction * dy))


def orientation(first: tuple[float, float], second: tuple[float, float], third: tuple[float, float]) -> float:
    return (second[0] - first[0]) * (third[1] - first[1]) - (second[1] - first[1]) * (third[0] - first[0])


def segment_distance(first_start: tuple[float, float], first_end: tuple[float, float], second_start: tuple[float, float], second_end: tuple[float, float]) -> float:
    first_a = orientation(first_start, first_end, second_start)
    first_b = orientation(first_start, first_end, second_end)
    second_a = orientation(second_start, second_end, first_start)
    second_b = orientation(second_start, second_end, first_end)
    if first_a * first_b <= 0 and second_a * second_b <= 0:
        return 0.0
    return min(
        point_segment_distance(first_start, second_start, second_end),
        point_segment_distance(first_end, second_start, second_end),
        point_segment_distance(second_start, first_start, first_end),
        point_segment_distance(second_end, first_start, first_end),
    )


def inside_plan(point: tuple[float, float]) -> bool:
    return PLAN_CLIP[0] <= point[0] <= PLAN_CLIP[2] and PLAN_CLIP[1] <= point[1] <= PLAN_CLIP[3]


def extract_candidates(pdf_path: Path, heads: list[dict]) -> list[dict]:
    candidates: list[dict] = []
    with fitz.open(pdf_path) as document:
        page = document[PAGE_INDEX]
        for drawing_index, drawing in enumerate(page.get_drawings()):
            if drawing["color"] != PIPE_STROKE_RGB or abs((drawing["width"] or 0.0) - PIPE_STROKE_WIDTH_PT) > WIDTH_EPSILON:
                continue
            for item_index, item in enumerate(drawing["items"]):
                if item[0] != "l":
                    continue
                start = (float(item[1].x), float(item[1].y))
                end = (float(item[2].x), float(item[2].y))
                length = math.dist(start, end)
                if length < MIN_SEGMENT_LENGTH_PT or not inside_plan(start) or not inside_plan(end):
                    continue
                head_ids = [
                    head["id"]
                    for head in heads
                    if point_segment_distance((head["pagePointPt"]["x"], head["pagePointPt"]["y"]), start, end) <= HEAD_CONTACT_TOLERANCE_PT
                ]
                candidates.append({
                    "sourceDrawingIndex": drawing_index,
                    "sourceItemIndex": item_index,
                    "startPt": [round(start[0], 6), round(start[1], 6)],
                    "endPt": [round(end[0], 6), round(end[1], 6)],
                    "lengthPt": round(length, 6),
                    "headIdsWithinContactTolerance": head_ids,
                })
    return candidates


def select_head_registered_centerlines(candidates: list[dict]) -> tuple[set[int], set[int]]:
    seeds = {index for index, candidate in enumerate(candidates) if candidate["headIdsWithinContactTolerance"]}
    active = set(seeds)
    changed = True
    while changed:
        changed = False
        for candidate_index, candidate in enumerate(candidates):
            if candidate_index in active:
                continue
            start = tuple(candidate["startPt"])
            end = tuple(candidate["endPt"])
            if any(
                segment_distance(start, end, tuple(candidates[active_index]["startPt"]), tuple(candidates[active_index]["endPt"])) <= CONNECTIVITY_TOLERANCE_PT
                for active_index in active
            ):
                active.add(candidate_index)
                changed = True
    return seeds, active


def candidate_signature(candidates: list[dict]) -> list[dict]:
    return [
        {
            "sourceDrawingIndex": candidate["sourceDrawingIndex"],
            "sourceItemIndex": candidate["sourceItemIndex"],
            "startPt": candidate["startPt"],
            "endPt": candidate["endPt"],
            "lengthPt": candidate["lengthPt"],
            "headIdsWithinContactTolerance": candidate["headIdsWithinContactTolerance"],
        }
        for candidate in candidates
    ]


def render_page(pdf_path: Path) -> Image.Image:
    with fitz.open(pdf_path) as document:
        pixmap = document[PAGE_INDEX].get_pixmap(matrix=fitz.Matrix(4, 4), clip=RENDER_CROP, alpha=False)
    return Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)


def image_point(point: list[float]) -> tuple[float, float]:
    return ((1342.0 - point[1]) * 4.0, (point[0] - 120.0) * 4.0)


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [Path(r"C:\Windows\Fonts\arialbd.ttf" if bold else r"C:\Windows\Fonts\arial.ttf"), Path(r"C:\Windows\Fonts\segoeuib.ttf" if bold else r"C:\Windows\Fonts\segoeui.ttf")]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size=size)
    return ImageFont.load_default(size=size)


def build_artifacts(corpus_root: Path, head_evidence_path: Path, data_output: Path, proof_output: Path) -> dict:
    approved = corpus_root / APPROVED_RELATIVE
    as_built = corpus_root / AS_BUILT_RELATIVE
    if digest(approved) != APPROVED_SHA256 or digest(as_built) != AS_BUILT_SHA256:
        raise RuntimeError("approved/as-built FP-2 source digest drift")
    evidence = json.loads(head_evidence_path.read_text(encoding="utf-8"))
    if evidence.get("answerDocuments", {}).get("approvedSha256") != APPROVED_SHA256 or evidence.get("counts", {}).get("total") != 68:
        raise RuntimeError("immutable Building J head evidence drift")
    heads = evidence["heads"]
    approved_candidates = extract_candidates(approved, heads)
    as_built_candidates = extract_candidates(as_built, heads)
    if candidate_signature(approved_candidates) != candidate_signature(as_built_candidates):
        raise RuntimeError("approved/as-built eligible FP-2 vector candidates differ")
    seed_indices, active_indices = select_head_registered_centerlines(approved_candidates)
    selected = []
    for output_index, candidate_index in enumerate(sorted(active_indices), start=1):
        candidate = approved_candidates[candidate_index]
        selection = "head-contact-seed" if candidate_index in seed_indices else "geometric-connector-to-head-registered-network"
        selected.append({
            "id": f"MIT-J-FP2-CL-{output_index:03d}",
            **candidate,
            "planLengthFt": round(candidate["lengthPt"] / POINTS_PER_FOOT, 6),
            "selection": selection,
            "role": "unknown-source-registered-centerline",
            "pipeSize": None,
            "fitting": None,
            "flowDirection": None,
            "elevation": None,
            "grade": None,
        })
    covered_head_ids = sorted({head_id for candidate in selected for head_id in candidate["headIdsWithinContactTolerance"]})
    all_head_ids = sorted(head["id"] for head in heads)
    if covered_head_ids != all_head_ids:
        raise RuntimeError(f"head-registered centerline selection does not cover all heads: {sorted(set(all_head_ids) - set(covered_head_ids))}")
    proof_output.mkdir(parents=True, exist_ok=True)
    image = render_page(approved)
    as_built_image = render_page(as_built)
    if image.size != as_built_image.size or image.tobytes() != as_built_image.tobytes():
        raise RuntimeError("approved/as-built FP-2 render crop differs")
    draw = ImageDraw.Draw(image)
    for candidate in selected:
        draw.line((image_point(candidate["startPt"]), image_point(candidate["endPt"])), fill=(16, 185, 129), width=9)
    for head in heads:
        x, y = image_point([head["pagePointPt"]["x"], head["pagePointPt"]["y"]])
        color = (249, 115, 22) if head["kind"] == "upright" else (6, 182, 212)
        draw.ellipse((x - 15, y - 15, x + 15, y + 15), outline=(255, 255, 255), width=7)
        draw.ellipse((x - 15, y - 15, x + 15, y + 15), outline=color, width=4)
    draw.rounded_rectangle((18, 18, image.width - 18, 142), radius=18, fill=(7, 17, 31), outline=(75, 101, 130), width=3)
    draw.text((42, 38), "APPROVED FP-2 HEAD-REGISTERED PIPE CENTERLINES", font=font(36, True), fill=(241, 245, 249))
    draw.text((42, 84), "Green = source vector selected by head contact and topology. No role, size, fitting, flow, or elevation is inferred.", font=font(22), fill=(186, 230, 253))
    image_path = proof_output / "approved-fp2-head-registered-centerlines.png"
    image.save(image_path)
    artifact = {
        "artifactType": "halofire.mit-riverside-building-j-head-registered-pipe-centerlines.v1",
        "projectId": evidence["projectId"],
        "status": "passed-source-registered-centerlines-only",
        "sources": {
            "approved": {"sha256": APPROVED_SHA256, "physicalPage": PHYSICAL_PAGE, "pageIndex": PAGE_INDEX},
            "asBuilt": {"sha256": AS_BUILT_SHA256, "physicalPage": PHYSICAL_PAGE, "pageIndex": PAGE_INDEX},
            "headEvidence": {"file": head_evidence_path.name, "receiptSha256": evidence["answerEvidenceReceiptSha256"]},
        },
        "selection": {
            "pipeStrokeColorRgb": list(PIPE_STROKE_RGB),
            "pipeStrokeWidthPt": PIPE_STROKE_WIDTH_PT,
            "minimumSegmentLengthPt": MIN_SEGMENT_LENGTH_PT,
            "headContactTolerancePt": HEAD_CONTACT_TOLERANCE_PT,
            "connectivityTolerancePt": CONNECTIVITY_TOLERANCE_PT,
            "pointsPerFoot": POINTS_PER_FOOT,
            "colorOnlySelectionAllowed": False,
            "approvedAsBuiltEligibleVectorCandidatesIdentical": True,
            "eligibleCandidateCount": len(approved_candidates),
            "headContactSeedCount": len(seed_indices),
            "acceptedCenterlineCount": len(selected),
            "unselectedEligibleCandidateCount": len(approved_candidates) - len(selected),
            "coveredImmutableHeadCount": len(covered_head_ids),
        },
        "centerlines": selected,
        "claims": {
            "sourceRegisteredPipeCenterlinesReady": True,
            "allImmutableHeadsCovered": True,
            "semanticPipeNetworkExtracted": False,
            "pipeRolesExtracted": False,
            "pipeSizesAndFittingsExtracted": False,
            "pipeElevationsExtracted": False,
            "gradeDirectionExtracted": False,
            "drainsAndRisersExtracted": False,
            "hydraulicNetworkReady": False,
            "codeComplianceReady": False,
            "fabricationReady": False,
            "employeeUseReady": False,
            "vpsReleaseReady": False,
        },
        "limitations": [
            "This identifies source-registered vector centerlines only; it does not assign semantic pipe roles.",
            "A candidate must match the approved/as-built vector signature and have a head-contact or geometric connection to the seeded head-registered set; color alone is rejected.",
            "Pipe sizes, fittings, flow direction, elevation, grade, drainage, riser closure, hydraulics, compliance, fabrication, employee use, and release remain unavailable from this artifact.",
        ],
        "image": {"file": image_path.name, "sha256": digest(image_path), "bytes": image_path.stat().st_size},
    }
    write_utf8_lf(data_output, json.dumps(artifact, indent=2) + "\n")
    write_utf8_lf(proof_output / "proof.json", json.dumps(artifact, indent=2) + "\n")
    html = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Transportation J source-registered centerlines</title><style>:root{{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:#07111f}}*{{box-sizing:border-box}}body{{margin:0;min-height:100vh;background:radial-gradient(circle at 12% 0%,#15365a 0,transparent 34%),radial-gradient(circle at 90% 12%,#2a1757 0,transparent 30%),#07111f;color:#e7eef8}}main{{max-width:1840px;margin:auto;padding:34px}}header,.glass{{background:rgba(13,32,54,.72);border:1px solid rgba(164,198,235,.28);box-shadow:0 20px 60px rgba(0,0,0,.25);backdrop-filter:blur(18px);border-radius:24px}}header{{padding:28px 32px;margin-bottom:22px}}h1{{margin:0;font-size:clamp(1.6rem,3vw,2.55rem);letter-spacing:-.04em}}p{{color:#c8d5e5;line-height:1.55}}.badges{{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}}.badge{{padding:7px 11px;border-radius:999px;background:#102c47;border:1px solid #2d618c;color:#bde7ff;font-size:.86rem}}.accept{{background:#063a31;border-color:#0f8b70;color:#b7f7e4}}.hold{{background:#422006;border-color:#a45b17;color:#fde68a}}.proof{{padding:18px}}img{{display:block;width:100%;height:auto;border-radius:16px;border:1px solid #35516f}}.grid{{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin:20px 0}}.metric{{padding:18px}}.metric b{{display:block;font-size:1.45rem;color:#f8fafc}}.metric span{{color:#9fb4c9;font-size:.9rem}}code{{color:#a7f3d0;word-break:break-all}}@media(max-width:760px){{main{{padding:16px}}header{{padding:22px}}.grid{{grid-template-columns:1fr}}}}</style></head><body><main><header><h1>Transportation J - source-registered pipe centerlines</h1><p>Green vectors are native approved/as-built FP-2 centerlines selected only when they share the sealed black 0.722-point vector signature and are connected to the 68 immutable head coordinates. The original plan remains the underlay for inspection.</p><div class="badges"><span class="badge accept">{len(selected)} accepted source centerlines</span><span class="badge accept">{len(covered_head_ids)} / 68 exact heads covered</span><span class="badge hold">Pipe roles, sizes, elevations, hydraulics held</span></div></header><section class="glass proof"><img src="{image_path.name}" alt="Actual approved Transportation J FP-2 sprinkler piping plan with source-registered green centerlines and exact head-coordinate rings"><div class="grid"><div class="glass metric"><b>{len(approved_candidates)} candidates</b><span>Eligible native black 0.722-point plan vectors</span></div><div class="glass metric"><b>{len(selected)} accepted</b><span>Head-contact seed plus geometric network selection</span></div><div class="glass metric"><b>{len(approved_candidates) - len(selected)} held</b><span>Eligible linework excluded from the accepted set</span></div></div><p>Approved PDF SHA-256: <code>{APPROVED_SHA256}</code></p></section></main></body></html>'''
    write_utf8_lf(proof_output / "index.html", html)
    return artifact


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--corpus-root", type=Path, default=DEFAULT_CORPUS)
    parser.add_argument("--head-evidence", type=Path, default=ROOT / "src/data/mit-riverside-building-j-head-coordinate-evidence.json")
    parser.add_argument("--data-output", type=Path, default=ROOT / "src/data/mit-riverside-building-j-head-registered-pipe-centerlines.json")
    parser.add_argument("--proof-output", type=Path, default=ROOT / "src/data/proofs/mit-riverside-building-j-head-registered-pipe-centerlines")
    args = parser.parse_args()
    artifact = build_artifacts(args.corpus_root, args.head_evidence, args.data_output, args.proof_output)
    print(json.dumps({"output": str(args.data_output), "selection": artifact["selection"], "claims": artifact["claims"]}, indent=2))


if __name__ == "__main__":
    main()

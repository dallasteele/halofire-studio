from __future__ import annotations

import argparse
import json
from pathlib import Path

import fitz


DEFAULT_ROOT = Path(r"Y:\Shared\HaloOps\02-Active jobs\03-Closed\Adolfson & Peterson\MIT Riverside - Phoenix AZ")
PLAN_CLIP_UNROTATED = fitz.Rect(120, 142, 1500, 1342)
BLACK = (0.0, 0.0, 0.0)


def is_outer_symbol_circle(drawing: dict) -> bool:
    rect = drawing["rect"]
    return (
        drawing["type"] == "s"
        and drawing.get("color") == BLACK
        and 8.8 <= rect.width <= 9.2
        and 8.8 <= rect.height <= 9.2
        and len(drawing["items"]) == 4
        and all(item[0] == "c" for item in drawing["items"])
        and PLAN_CLIP_UNROTATED.contains(rect)
    )


def center(rect: fitz.Rect) -> tuple[float, float]:
    return ((rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2)


def centered_circle_count(drawings: list[dict], point: tuple[float, float]) -> int:
    x, y = point
    return sum(
        1
        for drawing in drawings
        if drawing["type"] == "s"
        and drawing.get("color") == BLACK
        and len(drawing["items"]) == 4
        and all(item[0] == "c" for item in drawing["items"])
        and abs(center(drawing["rect"])[0] - x) < 0.01
        and abs(center(drawing["rect"])[1] - y) < 0.01
    )


def has_crossed_valve_mark(drawings: list[dict], point: tuple[float, float]) -> bool:
    x, y = point
    diagonals = []
    for drawing in drawings:
        rect = drawing["rect"]
        if (
            drawing["type"] == "s"
            and drawing.get("color") == BLACK
            and len(drawing["items"]) == 1
            and drawing["items"][0][0] == "l"
            and 5.5 <= rect.width <= 6.5
            and 7 <= rect.height <= 8
            and rect.intersects(fitz.Rect(x - 6, y - 6, x + 6, y + 6))
        ):
            start, finish = drawing["items"][0][1:3]
            diagonals.append((finish.y - start.y) / (finish.x - start.x))
    return len(diagonals) == 2 and min(diagonals) < 0 < max(diagonals)


def extract(page: fitz.Page) -> tuple[list[dict], list[dict]]:
    drawings = page.get_drawings()
    candidates = sorted({center(drawing["rect"]) for drawing in drawings if is_outer_symbol_circle(drawing)})
    symbols = []
    excluded = []
    for point in candidates:
        circle_count = centered_circle_count(drawings, point)
        if circle_count == 13:
            kind = "pendent"
        elif circle_count == 1 and has_crossed_valve_mark(drawings, point):
            excluded.append({"kind": "crossed-valve", "pagePointPt": {"x": round(point[0], 6), "y": round(point[1], 6)}})
            continue
        elif circle_count == 1:
            kind = "upright"
        else:
            raise RuntimeError(f"unclassified Building J symbol at {point}: {circle_count} centered circles")
        symbols.append({"kind": kind, "pagePointPt": {"x": round(point[0], 6), "y": round(point[1], 6)}, "centeredCircleCount": circle_count})
    return symbols, excluded


def localize(symbol: dict, registration: dict) -> dict:
    page_x = symbol["pagePointPt"]["x"]
    page_y = symbol["pagePointPt"]["y"]
    crop_x = (1342 - page_y) * 4
    crop_y = (page_x - 120) * 4
    local_x = registration["x"]["feetPerPixel"] * crop_x + registration["x"]["interceptFeet"]
    local_y = registration["y"]["feetPerPixel"] * crop_y + registration["y"]["interceptFeet"]
    return {
        **symbol,
        "cropPixel": {"x": round(crop_x, 6), "y": round(crop_y, 6)},
        "localFt": {"x": round(local_x, 6), "y": round(local_y, 6)},
        "zFt": None,
        "sourceProtectionPlaneId": None,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--corpus-root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--registration", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    registration_packet = json.loads(args.registration.read_text(encoding="utf-8"))
    grid = registration_packet["gridRegistration"]
    approved_path = args.corpus_root / "Engineering" / "City Approved FS Plans" / "State Fire Marshal Approved Plan Set.pdf"
    asbuilt_path = args.corpus_root / "Field Operations" / "As Builts" / "State Fire Marshal Approved Plan Set_As Builts.pdf"
    with fitz.open(approved_path) as approved, fitz.open(asbuilt_path) as asbuilt:
        approved_symbols, approved_excluded = extract(approved[1])
        asbuilt_symbols, asbuilt_excluded = extract(asbuilt[1])
    if approved_symbols != asbuilt_symbols or approved_excluded != asbuilt_excluded:
        raise RuntimeError("approved/as-built Building J vector symbol extraction differs")
    localized = [localize(symbol, grid) for symbol in approved_symbols]
    localized.sort(key=lambda symbol: (symbol["localFt"]["y"], symbol["localFt"]["x"], symbol["kind"]))
    counters = {"upright": 0, "pendent": 0}
    for symbol in localized:
        counters[symbol["kind"]] += 1
        prefix = "U" if symbol["kind"] == "upright" else "P"
        symbol["id"] = f"MIT-J-{prefix}-{counters[symbol['kind']]:03d}"
    if counters != {"upright": 53, "pendent": 15} or len(localized) != 68 or len(approved_excluded) != 1:
        raise RuntimeError(f"Building J schedule reconciliation failed: {counters}, symbols={len(localized)}, excluded={len(approved_excluded)}")
    output = {
        "artifactType": "halofire.mit-riverside-building-j-head-coordinate-evidence.v1",
        "projectId": "mit-riverside-building-j",
        "projectName": "MIT Riverside - Transportation Building J",
        "answerCalibrationCommit": "cd6d38f0",
        "answerEvidenceReceiptSha256": registration_packet["receiptSha256"],
        "answerDocuments": {
            "approvedSha256": "6da51cbd5bdbf34861502630311f8d0e3d4c8e3dcb61896ba614ff634fde8421",
            "asBuiltSha256": "b7a8c3c2faceacba6c41437f773af650cdcc84eddc44cc5a88e1e563ac052207",
            "physicalPage": 2,
        },
        "extraction": {
            "method": "PyMuPDF vector-path classification on immutable approved/as-built page 2",
            "pageCoordinateSystem": "unrotated PDF points",
            "planClipUnrotatedPt": [120, 142, 1500, 1342],
            "outerCircleWidthPt": 9,
            "pendentCenteredCircleCount": 13,
            "uprightCenteredCircleCount": 1,
            "candidateOuterCircleCount": 69,
            "excludedCrossedValveCount": 1,
            "approvedAsBuiltVectorSymbolsIdentical": True,
            "approvedAsBuiltMaximumCoordinateDeltaPt": 0,
        },
        "counts": {"pendent": counters["pendent"], "upright": counters["upright"], "total": len(localized)},
        "excludedSymbols": approved_excluded,
        "heads": localized,
        "claims": {
            "exactAnswerHeadCoordinatesReady": True,
            "headElevationsReady": False,
            "wholeRoofHeadPlaneAssignmentReady": False,
            "sourceGeneratedPitchedPlacementVerified": False,
            "complianceReady": False,
            "fabricationReady": False,
            "fieldReleaseReady": False,
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(args.output), "counts": output["counts"], "excluded": approved_excluded}, indent=2))


if __name__ == "__main__":
    main()

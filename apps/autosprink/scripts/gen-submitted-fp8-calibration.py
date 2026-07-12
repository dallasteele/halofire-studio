"""Generate a sealed Level 8 finished-bid calibration packet.

This is an offline evidence extractor, not a design/approval engine. It registers
the two rotated FP-8 plan views to the current A-108 plan coordinate system,
extracts submitted pipe/head vectors, joins DA-3 callouts to the submitted
hydraulic node table, and records the repeated non-combustible attic note.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import re
import subprocess
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = Path(os.environ.get(
    "COOPERATIVE_1881_SOURCE_ROOT",
    r"C:\Users\dalla\OneDrive\Documents\HaloFire\tmp\pdfs\egnyte-1881",
))
FIRE_PDF = SOURCE_ROOT / "cooperative-1881-fire-sprinkler-r2.pdf"
HYDRAULIC_PDF = SOURCE_ROOT / "cooperative-1881-hydraulics-r2.pdf"
PLAN_PATH = ROOT / "src/data/plan-levels.cooperative-1881.json"
ROOF_PATH = ROOT / "src/data/roof-reconstruction.cooperative-1881.json"
OUTPUT_PATH = ROOT / "src/data/submitted-fp8-calibration.cooperative-1881.json"

EXPECTED_FIRE_SHA256 = "bae3cbfeb4c93812fe9a5a168dcf3e16836a6d13a3a75bb33c147cc1ebc0ac29"
EXPECTED_HYDRAULIC_SHA256 = "389c8943c4bac1f6eeac9a884cd91da8f29920ef513cf7b0be48ae2da8de18fb"
ATTIC_NOTE = "ATTIC SPACE WILL BE FILLED WITH NON-COMBUSTIBLE INSULATION"

# Yellow DA-3 callout to black leader endpoint, read from the vector FP-8 page.
# Coordinates are PyMuPDF page points (top-left origin). The generator verifies
# every id against the submitted DA-3 node-analysis table before sealing output.
DA3_LEADER_ENDPOINTS = {
    "1007": (2761.5, 1901.2), "1008": (2761.5, 1970.6),
    "1496": (2766.6, 1848.4), "1525": (2766.6, 1892.2),
    "1542": (2766.6, 1901.2), "1577": (2586.6, 1901.2),
    "1602": (2820.3, 1901.2), "1626": (2766.6, 1961.6),
    "1657": (2586.6, 1970.6), "1658": (2766.6, 1970.6),
    "1730": (2820.3, 1970.6), "3922": (2564.5, 1895.7),
    "3933": (2640.6, 1901.2), "3974": (2640.6, 1970.6),
    "3980": (2546.6, 1980.3), "4032": (2824.8, 1901.2),
    "4074": (2824.8, 1970.6),
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def receipt_from_output_file() -> str:
    script = (
        "import fs from'node:fs';"
        "import{sealSubmittedSprinklerCalibration as seal}from'./src/engine/submitted-sprinkler-calibration.js';"
        "const p=JSON.parse(fs.readFileSync('./src/data/submitted-fp8-calibration.cooperative-1881.json'));"
        "delete p.evidenceReceiptSha256;"
        "process.stdout.write((await seal(p)).evidenceReceiptSha256);"
    )
    completed = subprocess.run(
        ["node", "--input-type=module", "-e", script], cwd=ROOT,
        text=True, capture_output=True, check=True,
    )
    return completed.stdout.strip()


def fit_line(pairs):
    count = len(pairs)
    sx = sum(item[0] for item in pairs)
    sy = sum(item[1] for item in pairs)
    sxx = sum(item[0] * item[0] for item in pairs)
    sxy = sum(item[0] * item[1] for item in pairs)
    slope = (count * sxy - sx * sy) / (count * sxx - sx * sx)
    intercept = (sy - slope * sx) / count
    rms = math.sqrt(sum((slope * x + intercept - y) ** 2 for x, y in pairs) / count)
    return slope, intercept, rms


def point_in_polygon(point, polygon):
    x, y = point
    inside = False
    for index, current in enumerate(polygon):
        previous = polygon[index - 1]
        x1, y1 = previous
        x2, y2 = current
        if ((y2 > y) != (y1 > y)) and x < (x1 - x2) * (y - y2) / (y1 - y2) + x2:
            inside = not inside
    return inside


def distance_to_segment(point, start, end):
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    denom = dx * dx + dy * dy
    t = 0 if denom == 0 else max(0, min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / denom))
    return math.dist(point, (start[0] + t * dx, start[1] + t * dy))


def source_binding(source_sha, physical_page, rendered_sha, sheet_id):
    return {
        "sourcePdfSha256": source_sha,
        "physicalPageNumber": physical_page,
        "pageIndex": physical_page - 1,
        "renderedPageSha256": rendered_sha,
        "sheetId": sheet_id,
        "coordinateSpace": "pdf-points",
        "renderProfile": {
            "renderer": "PyMuPDF", "rendererVersion": fitz.VersionBind,
            "matrixScale": 2.5, "colorspace": "rgb", "alpha": False,
        },
    }


def rendered_page_sha(page):
    pixmap = page.get_pixmap(matrix=fitz.Matrix(2.5, 2.5), colorspace=fitz.csRGB, alpha=False)
    return hashlib.sha256(pixmap.tobytes("png")).hexdigest()


def parse_elevation(token):
    match = re.match(r"^(-?)(\d+)'-(\d+)", token.replace("�", ""))
    if not match:
        raise ValueError(f"unsupported submitted elevation token: {token}")
    sign = -1 if match.group(1) else 1
    return sign * (int(match.group(2)) + int(match.group(3)) / 12)


def parse_hydraulic_nodes(page_text):
    lines = [line.strip() for line in page_text.splitlines()]
    starts = [index for index in range(len(lines) - 1)
              if re.match(r"^\d+$", lines[index]) and re.match(r"^-?\d+'-\d+", lines[index + 1])]
    result = {}
    for position, start in enumerate(starts):
        end = starts[position + 1] if position + 1 < len(starts) else len(lines)
        block = lines[start:end]
        numeric_tail = [item for item in block[2:] if re.match(r"^[0-9.]+$", item)]
        if len(numeric_tail) < 2:
            continue
        node_id, elevation = block[:2]
        pressure, discharge = numeric_tail[-2:]
        fitting_lines = block[2:block.index(pressure)] if pressure in block else []
        fittings = " ".join(fitting_lines)
        result[node_id] = {
            "nodeId": node_id,
            "elevationFt": round(parse_elevation(elevation), 6),
            "sourceElevationText": elevation.replace("�", ""),
            "fittings": fittings,
            "pressurePsi": float(pressure),
            "dischargeGpm": float(discharge),
            "nodeKind": "sprinkler" if fittings.startswith("Spr(") else "pipe",
        }
    return result


def main():
    fire_sha = sha256_file(FIRE_PDF)
    hydraulic_sha = sha256_file(HYDRAULIC_PDF)
    if fire_sha != EXPECTED_FIRE_SHA256:
        raise RuntimeError(f"fire PDF hash mismatch: {fire_sha}")
    if hydraulic_sha != EXPECTED_HYDRAULIC_SHA256:
        raise RuntimeError(f"hydraulic PDF hash mismatch: {hydraulic_sha}")

    plan_data = json.loads(PLAN_PATH.read_text(encoding="utf-8"))
    roof_data = json.loads(ROOF_PATH.read_text(encoding="utf-8"))
    level8 = next(item for item in plan_data["levels"] if item["level"] == 8)
    footprint = level8["plan"]["footprintFt"]
    labels = level8["plan"]["labels"]
    target_x = {}
    target_y = {}
    for label in labels:
        text = str(label.get("text", ""))
        if re.match(r"^(?:[0-9]|[12][0-9])$", text) and 20 < label["yFt"] < 125:
            target_x[text] = label["xFt"]
        if re.match(r"^[A-M]$", text) and label["xFt"] > 330 and 30 < label["yFt"] < 120:
            target_y[text] = label["yFt"]

    fire = fitz.open(FIRE_PDF)
    fp8 = fire[11]
    words = fp8.get_text("words")

    def make_registration(view_id):
        north = view_id == "north"
        number_words = [word for word in words if re.match(r"^(?:[0-9]|[12][0-9]|30)$", word[4]) and (
            (north and (abs(word[0] - 2131.8) < 20 or abs(word[0] - 2905.1) < 20)
             and 650 < word[1] < 2200 and int(word[4]) <= 15)
            or (not north and (abs(word[0] - 559.2) < 20 or abs(word[0] - 1332.5) < 20)
                and 150 < word[1] < 1750 and int(word[4]) >= 15)
        )]
        letter_words = [word for word in words if re.match(r"^[A-M]$", word[4]) and (
            (north and word[0] > 2000 and 500 < word[1] < 650)
            or (not north and word[0] < 1500 and 1800 < word[1] < 1950)
        )]
        x_pairs = [(((word[1] + word[3]) / 2), target_x[word[4]]) for word in number_words if word[4] in target_x]
        y_pairs = [(((word[0] + word[2]) / 2), target_y[word[4]]) for word in letter_words if word[4] in target_y]
        x_slope, x_intercept, x_rms = fit_line(x_pairs)
        y_slope, y_intercept, y_rms = fit_line(y_pairs)
        return {
            "viewId": view_id,
            "sourceSheetId": "FP-8-R2",
            "targetSheetId": "A-108",
            "transform": {
                "planXFromSourceTopY": [round(x_slope, 12), round(x_intercept, 9)],
                "planYFromSourceX": [round(y_slope, 12), round(y_intercept, 9)],
            },
            "controls": {
                "numberGridLabels": sorted({word[4] for word in number_words if word[4] in target_x}, key=lambda item: int(item)),
                "letterGridLabels": sorted({word[4] for word in letter_words if word[4] in target_y}),
                "planXRmsResidualFt": round(x_rms, 6),
                "planYRmsResidualFt": round(y_rms, 6),
            },
        }

    registrations = [make_registration("south"), make_registration("north")]
    registration_map = {item["viewId"]: item for item in registrations}

    def transform(view_id, source_point):
        data = registration_map[view_id]["transform"]
        x_fit = data["planXFromSourceTopY"]
        y_fit = data["planYFromSourceX"]
        return [
            round(x_fit[0] * source_point.y + x_fit[1], 6),
            round(y_fit[0] * source_point.x + y_fit[1], 6),
        ]

    drawings = fp8.get_drawings()
    pipe_segments = []
    for view_id in ("south", "north"):
        x_min, x_max = ((500, 1500) if view_id == "south" else (2000, 3000))
        seen = set()
        for drawing in drawings:
            color = drawing.get("color") or (-1, -1, -1)
            width = drawing.get("width") or 0
            orange = abs(color[0] - 1) < .01 and abs(color[1] - .502) < .01 and abs(color[2] - .251) < .01
            green = abs(color[0]) < .01 and abs(color[1] - .498) < .01 and abs(color[2]) < .01
            if not ((orange and abs(width - 1.03383) < .02) or (green and abs(width - .5) < .02)):
                continue
            for item in drawing["items"]:
                if item[0] != "l" or not (x_min < item[1].x < x_max and x_min < item[2].x < x_max):
                    continue
                start = transform(view_id, item[1])
                end = transform(view_id, item[2])
                if math.dist(start, end) < 1 or not (point_in_polygon(start, footprint) or point_in_polygon(end, footprint)):
                    continue
                ordered = sorted((start, end))
                key = tuple(round(value, 3) for point in ordered for value in point)
                if key in seen:
                    continue
                seen.add(key)
                pipe_segments.append({
                    "id": f"{view_id}-pipe-{len(pipe_segments) + 1}",
                    "sourceViewId": view_id,
                    "fromPlanFt": start,
                    "toPlanFt": end,
                    "submittedColorRole": "primary-orange" if orange else "secondary-green",
                })

    def nearest_pipe(point, view_id):
        values = [
            distance_to_segment(point, segment["fromPlanFt"], segment["toPlanFt"])
            for segment in pipe_segments if segment["sourceViewId"] == view_id
        ]
        return min(values) if values else math.inf

    heads = []
    seen_heads = set()
    for view_id in ("south", "north"):
        x_min, x_max = ((500, 1500) if view_id == "south" else (2000, 3000))
        for drawing in drawings:
            rect = drawing["rect"]
            if drawing.get("color") != (0.0, 0.0, 0.0) or abs((drawing.get("width") or 0) - .5) >= .01:
                continue
            if not (x_min < rect.x0 and rect.x1 < x_max):
                continue
            circular = abs(rect.width - 6.4) < .15 and abs(rect.height - 6.4) < .15
            sidewall = abs(rect.width - 10.4) < .15 and rect.height < .15
            if not (circular or sidewall):
                continue
            center = transform(view_id, fitz.Point((rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2))
            nearest = nearest_pipe(center, view_id)
            if nearest > .6 or not point_in_polygon(center, footprint):
                continue
            key = (round(center[0], 2), round(center[1], 2))
            if key in seen_heads:
                continue
            seen_heads.add(key)
            heads.append({
                "id": f"{view_id}-head-{len(heads) + 1}",
                "sourceViewId": view_id,
                "positionPlanFt": center,
                "symbolClass": "round-standard-spray-reference" if circular else "horizontal-sidewall-reference",
                "nearestSubmittedPipeFt": round(nearest, 6),
            })

    hydraulics = fitz.open(HYDRAULIC_PDF)
    da3_page = hydraulics[19]
    hydraulic_nodes = parse_hydraulic_nodes(da3_page.get_text("text"))
    submitted_nodes = []
    for node_id, endpoint in DA3_LEADER_ENDPOINTS.items():
        if node_id not in hydraulic_nodes:
            raise RuntimeError(f"FP-8 callout {node_id} missing from submitted DA-3 node table")
        submitted_nodes.append({
            **hydraulic_nodes[node_id],
            "planPointFt": transform("north", fitz.Point(*endpoint)),
            "sourceViewId": "north",
            "calloutRegistration": "yellow-node-callout-to-black-vector-leader-endpoint",
            "protectionSurfaceKind": "level8-ceiling-or-sky-balcony-not-pitched-roof",
        })

    attic_pages = []
    for physical_page in range(5, 13):
        page = fire[physical_page - 1]
        if ATTIC_NOTE not in page.get_text("text").upper():
            raise RuntimeError(f"physical page {physical_page} is missing the submitted attic note")
        attic_pages.append(source_binding(
            fire_sha, physical_page, rendered_page_sha(page), f"submitted-fire-physical-{physical_page}",
        ))

    fp8_render_sha = rendered_page_sha(fp8)
    da3_render_sha = rendered_page_sha(da3_page)
    source_bindings = [
        {"id": "target-architectural-A108", "binding": level8["plan"]["sourceBinding"]},
        {"id": "target-roof-A121", "binding": next(item["binding"] for item in roof_data["sourceBindings"] if item["id"] == "roof-plan-A121")},
        {"id": "submitted-fire-FP8-r2", "binding": source_binding(fire_sha, 12, fp8_render_sha, "FP-8-R2")},
        {"id": "submitted-hydraulic-DA3-r2", "binding": source_binding(hydraulic_sha, 20, da3_render_sha, "DA-3-node-analysis-R2")},
    ]

    draft = {
        "artifactType": "halofire.submitted-sprinkler-calibration.v1",
        "projectName": "The Cooperative 1881 - Salt Lake City UT",
        "level": 8,
        "units": "ft",
        "sourceBindings": source_bindings,
        "viewRegistrations": registrations,
        "submittedTopView": {"pipeSegments": pipe_segments, "heads": heads},
        "submittedElevationView": {
            "hydraulicNodes": submitted_nodes,
            "sourcePageRole": "DA-3 submitted node analysis",
        },
        "atticProtectionBasis": {
            "sourceNote": ATTIC_NOTE,
            "physicalPages": list(range(5, 13)),
            "pageBindings": attic_pages,
            "interpretation": "The submitted design keeps Level 8 ceiling/sky-balcony nodes separate from the pitched roof planes; it does not prove a universal code exemption.",
        },
        "coverage": {
            "complete": False,
            "registeredViews": ["FP-8 south", "FP-8 north", "DA-3 node analysis"],
            "headCount": len(heads),
            "pipeSegmentCount": len(pipe_segments),
            "hydraulicNodeCount": len(submitted_nodes),
            "unresolved": [
                "remaining-FP8-symbol-classes-not-vector-classified",
                "submitted-node-callouts-outside-DA3-not-plan-registered",
                "code-compliance-and-approval-not-inferred-from-submitted-reference",
            ],
        },
        "claimStatus": "completed-bid-calibration-reference-not-code-compliance-or-approval",
    }
    # Round-trip through JSON before sealing so Python numeric subclasses and
    # renderer values are exactly the values the JavaScript verifier will read.
    draft = json.loads(json.dumps(draft, ensure_ascii=False))
    draft["evidenceReceiptSha256"] = "0" * 64
    OUTPUT_PATH.write_text(json.dumps(draft, indent=2) + "\n", encoding="utf-8")
    draft["evidenceReceiptSha256"] = receipt_from_output_file()
    OUTPUT_PATH.write_text(json.dumps(draft, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(OUTPUT_PATH),
        "receipt": draft["evidenceReceiptSha256"],
        "coverage": draft["coverage"],
        "registrationResiduals": [item["controls"] for item in registrations],
    }, indent=2))


if __name__ == "__main__":
    main()

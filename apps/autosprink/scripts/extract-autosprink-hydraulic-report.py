from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import defaultdict
from pathlib import Path

import fitz


PIPE_TYPES = {
    "AO": "arm-over",
    "BL": "branch-line",
    "CM": "cross-main",
    "DN": "drain",
    "DR": "drop",
    "DY": "dynamic",
    "FM": "feed-main",
    "FR": "feed-riser",
    "MS": "miscellaneous",
    "OR": "outrigger",
    "RN": "riser-nipple",
    "S": "supply",
    "UG": "underground",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def text_in(words: list[tuple], x_min: float, x_max: float, y: float, tolerance: float = 2.8) -> str | None:
    matches = [word for word in words if x_min <= word[0] < x_max and abs(word[1] - y) <= tolerance]
    matches.sort(key=lambda word: word[0])
    value = " ".join(str(word[4]) for word in matches).strip()
    return value or None


def number(value: str | None) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except ValueError:
        return None


def feet(value: str | None) -> float | None:
    if value is None:
        return None
    compact = value.strip().replace('"', "")
    match = re.fullmatch(r"(-)?(\d+)'-(\d+)?([¼½¾�])?", compact)
    if not match:
        return None
    fraction = {None: 0.0, "¼": 0.25, "½": 0.5, "¾": 0.75, "�": 0.5}[match.group(4)]
    result = int(match.group(2)) + (int(match.group(3) or 0) + fraction) / 12
    return round(-result if match.group(1) else result, 6)


def extract_segment(words: list[tuple], y: float, page_number: int, route: int) -> dict:
    top = y
    downstream = y + 8.7
    upstream = y + 18.0
    pipe_type = text_in(words, 30, 80, top)
    downstream_node = text_in(words, 30, 80, downstream)
    upstream_node = text_in(words, 30, 80, upstream)
    if pipe_type not in PIPE_TYPES or not downstream_node or not upstream_node:
        raise ValueError(f"HYDRAULIC_SEGMENT_PARSE_FAILED:{page_number}:{route}:{y}")
    downstream_elevation = text_in(words, 90, 155, downstream)
    upstream_elevation = text_in(words, 90, 155, upstream)
    return {
        "page": page_number,
        "route": route,
        "pipeType": pipe_type,
        "pipeRole": PIPE_TYPES[pipe_type],
        "diameterInternalInches": number(text_in(words, 95, 155, top)),
        "flowGpm": number(text_in(words, 155, 215, top)),
        "velocityFps": number(text_in(words, 215, 265, top)),
        "hazenWilliamsC": number(text_in(words, 265, 325, top)),
        "frictionLossPsiPerFt": number(text_in(words, 325, 445, top)),
        "lengthRaw": text_in(words, 490, 523, top),
        "lengthFt": feet(text_in(words, 490, 523, top)),
        "pressureFrictionPsi": number(text_in(words, 535, 580, top)),
        "downstreamNode": downstream_node,
        "downstreamElevationRaw": downstream_elevation,
        "downstreamElevationFt": feet(downstream_elevation),
        "downstreamDischargeGpm": number(text_in(words, 155, 215, downstream)),
        "downstreamKFactor": number(text_in(words, 215, 265, downstream)),
        "downstreamPressurePsi": number(text_in(words, 265, 325, downstream)),
        "downstreamFittings": text_in(words, 325, 490, downstream, 3.2),
        "equivalentLengthRaw": text_in(words, 490, 523, downstream),
        "pressureElevationPsi": number(text_in(words, 535, 580, downstream)),
        "upstreamNode": upstream_node,
        "upstreamElevationRaw": upstream_elevation,
        "upstreamElevationFt": feet(upstream_elevation),
        "upstreamPressurePsi": number(text_in(words, 265, 325, upstream)),
        "upstreamFittings": text_in(words, 325, 490, upstream, 3.2),
        "totalLengthRaw": text_in(words, 490, 523, upstream),
        "pressureVelocityPsi": number(text_in(words, 535, 580, upstream)),
        "hydraulicFlowDirection": f"{upstream_node}-to-{downstream_node}",
    }


def extract_report(source_path: Path, expected_sha256: str) -> dict:
    actual_sha256 = sha256(source_path)
    if actual_sha256 != expected_sha256.upper():
        raise ValueError("HYDRAULIC_REPORT_SHA256_MISMATCH")

    document = fitz.open(source_path)
    first_page_text = document[0].get_text()
    description_match = re.search(r"Report Description:\s*([^\n]+)", first_page_text)
    job_match = re.search(r"Job Number:\s*([^\n]+)", first_page_text)
    if not description_match or not job_match:
        raise ValueError("HYDRAULIC_REPORT_IDENTITY_MISSING")

    segments = []
    current_route = 0
    hydraulic_pages = []
    for page_index, page in enumerate(document):
        if "Hydraulic Analysis" not in page.get_text():
            continue
        page_number = page_index + 1
        hydraulic_pages.append(page_number)
        words = page.get_text("words")
        route_events = []
        for block in page.get_text("blocks"):
            match = re.match(r"^[^A-Za-z0-9]*Route\s+(\d+)", block[4].strip())
            if match:
                route_events.append((block[1], int(match.group(1))))
        row_events = sorted(
            (word[1], word[4])
            for word in words
            if word[4] in PIPE_TYPES
            and word[0] < 60
            and word[1] > 70
            and number(text_in(words, 95, 155, word[1])) is not None
        )
        events = [(y, "route", route) for y, route in route_events]
        events.extend((y, "row", pipe_type) for y, pipe_type in row_events)
        for y, kind, value in sorted(events, key=lambda event: (event[0], event[1] != "route")):
            if kind == "route":
                current_route = int(value)
                continue
            if current_route <= 0:
                raise ValueError(f"HYDRAULIC_ROUTE_CONTEXT_MISSING:{page_number}:{y}")
            segments.append(extract_segment(words, y, page_number, current_route))

    if not segments:
        raise ValueError("HYDRAULIC_SEGMENTS_MISSING")

    nodes: dict[str, dict] = {}
    route_counts: dict[int, int] = defaultdict(int)
    pipe_role_counts: dict[str, int] = defaultdict(int)
    for segment in segments:
        route_counts[segment["route"]] += 1
        pipe_role_counts[segment["pipeRole"]] += 1
        for side in ("downstream", "upstream"):
            node_id = segment[f"{side}Node"]
            elevation_raw = segment[f"{side}ElevationRaw"]
            elevation_ft = segment[f"{side}ElevationFt"]
            if node_id not in nodes:
                nodes[node_id] = {
                    "nodeId": node_id,
                    "elevationRaw": elevation_raw,
                    "elevationFt": elevation_ft,
                    "roles": [side],
                }
            else:
                if nodes[node_id]["elevationFt"] != elevation_ft:
                    raise ValueError(f"HYDRAULIC_NODE_ELEVATION_CONFLICT:{node_id}")
                if side not in nodes[node_id]["roles"]:
                    nodes[node_id]["roles"].append(side)

    source_segments = [segment for segment in segments if segment["upstreamNode"] == "1"]
    if len(source_segments) != 1 or source_segments[0]["pipeType"] != "UG":
        raise ValueError("HYDRAULIC_SOURCE_NODE_CLOSURE_FAILED")

    result = {
        "schema": "halofire.autosprink-hydraulic-report.v1",
        "source": {
            "fileName": source_path.name,
            "byteLength": source_path.stat().st_size,
            "sha256": actual_sha256,
            "parser": f"PyMuPDF {fitz.VersionBind}",
        },
        "identity": {
            "jobNumber": job_match.group(1).strip(),
            "reportDescription": description_match.group(1).strip(),
        },
        "directionSemantics": {
            "sourceColumnLabels": ["Downstream", "Upstream"],
            "hydraulicFlowDirection": "upstream-to-downstream",
            "note": "Flow direction is taken from the report's explicit upstream/downstream node columns, not geometric slope or drawing orientation.",
        },
        "summary": {
            "pageCount": len(document),
            "hydraulicAnalysisPages": hydraulic_pages,
            "routeCount": len(route_counts),
            "segmentCount": len(segments),
            "nodeCount": len(nodes),
            "routeSegmentCounts": {str(key): route_counts[key] for key in sorted(route_counts)},
            "pipeRoleCounts": {key: pipe_role_counts[key] for key in sorted(pipe_role_counts)},
            "sourceNode": "1",
            "sourceClosureReady": True,
        },
        "nodes": sorted(nodes.values(), key=lambda node: (int(node["nodeId"]) if node["nodeId"].isdigit() else 10**9, node["nodeId"])),
        "segments": segments,
        "claims": {
            "sourceHashVerified": True,
            "reportIdentityReady": True,
            "hydraulicDirectionReady": True,
            "sourceNodeClosureReady": True,
            "dwgGeometryBindingReady": False,
            "wholeSystemHydraulicFlowReady": False,
            "drainageGradeSemanticsReady": False,
            "fabricationReady": False,
            "fieldReleaseReady": False,
        },
    }
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source_pdf", type=Path)
    parser.add_argument("expected_sha256")
    parser.add_argument("output_json", type=Path)
    args = parser.parse_args()
    result = extract_report(args.source_pdf, args.expected_sha256)
    args.output_json.parent.mkdir(parents=True, exist_ok=True)
    args.output_json.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({"output": str(args.output_json), "identity": result["identity"], "summary": result["summary"]}, indent=2))


if __name__ == "__main__":
    main()

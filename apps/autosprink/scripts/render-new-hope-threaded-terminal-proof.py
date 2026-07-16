#!/usr/bin/env python3
"""Render actual-PDF top/elevation evidence for CMI.23-CMI.42 terminals."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import fitz


EXPECTED_APPROVED_SHA = "5A770222363228C2766605A695FEE9B6CB1F7B49C296204E09B691100253D9D5"
EXPECTED_FIELD_SHA = "4A47F9A45256DEBB9E5185396BC15526532A3EF420BCBF40EC0BCC0DC5F902B5"
EXPECTED_LISTING_SHA = "2E01CB3C2C39289846DF0A17A758E6D1DE4F5A682ED139556BD864BF6F8BD734"
APPROVED_FP20_PAGE = 4
FIELD_FP10_PAGE = 2
LISTING_PAGE_42 = 41
INK = (0.02, 0.05, 0.10)
ORANGE = (0.96, 0.34, 0.08)
CYAN = (0.00, 0.65, 0.78)
YELLOW = (0.97, 0.75, 0.05)
RED = (0.82, 0.06, 0.12)
GRAY = (0.25, 0.31, 0.39)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest().upper()


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def label(page: fitz.Page, point: fitz.Point, text: str, color: tuple[float, float, float]) -> None:
    width = max(80, len(text) * 7.2)
    rect = fitz.Rect(point.x - width / 2, point.y - 18, point.x + width / 2, point.y + 6)
    page.draw_rect(rect, color=INK, fill=(1, 1, 1), fill_opacity=0.90, width=1, overlay=True)
    page.insert_textbox(rect, text, fontsize=11, fontname="hebo", color=color, align=fitz.TEXT_ALIGN_CENTER, overlay=True)


def header(page: fitz.Page, title: str, subtitle: str) -> None:
    rect = fitz.Rect(70, 55, page.rect.width - 70, 145)
    page.draw_rect(rect, color=INK, fill=(1, 1, 1), fill_opacity=0.94, width=2, overlay=True)
    page.insert_text(fitz.Point(95, 92), title, fontsize=24, fontname="hebo", color=INK, overlay=True)
    page.insert_text(fitz.Point(95, 125), subtitle, fontsize=13, color=INK, overlay=True)


def draw_top_page(output: fitz.Document, approved: fitz.Document, graph: dict, annotations: dict) -> None:
    source_page = approved[APPROVED_FP20_PAGE]
    page = output.new_page(width=source_page.rect.width, height=source_page.rect.height)
    page.show_pdf_page(page.rect, approved, APPROVED_FP20_PAGE)
    node_by_id = {node["id"]: node for node in graph["nodes"]}
    edge_by_id = {edge["id"]: edge for edge in graph["edges"]}
    groups = annotations["armOverFabricationEvidence"]["groups"]
    bindings = annotations["armOverFabricationEvidence"]["terminalSprinklerBindings"]
    cmi_groups = [group for group in groups if group["id"] in {"cmi-long-terminal-arm-overs", "cmi-short-terminal-arm-overs"}]
    cmi_edge_ids = {edge_id for group in cmi_groups for edge_id in group["sourceEdgeIds"]}
    rendered = 0
    for binding in bindings:
        if binding["sourceEdgeId"] not in cmi_edge_ids:
            continue
        edge = edge_by_id[binding["sourceEdgeId"]]
        start_raw = node_by_id[edge["fromNodeId"]]["pdfPt"]
        end_raw = node_by_id[edge["toNodeId"]]["pdfPt"]
        start = fitz.Point(start_raw["x"], start_raw["y"])
        end = fitz.Point(end_raw["x"], end_raw["y"])
        page.draw_line(start, end, color=ORANGE, width=13, stroke_opacity=0.78, overlay=True)
        terminal_node = next(
            node_by_id[node_id]
            for node_id in (edge["fromNodeId"], edge["toNodeId"])
            if binding["sprinklerId"] in node_by_id[node_id].get("sprinklerIds", [])
        )
        terminal_raw = terminal_node["pdfPt"]
        terminal = fitz.Point(terminal_raw["x"], terminal_raw["y"])
        page.draw_circle(terminal, 13, color=YELLOW, fill=YELLOW, fill_opacity=0.82, width=2, overlay=True)
        group = next(group for group in cmi_groups if binding["sourceEdgeId"] in group["sourceEdgeIds"])
        label(page, fitz.Point((start.x + end.x) / 2, (start.y + end.y) / 2), "/".join(group["pieceIds"]), ORANGE)
        rendered += 1

    direct_endpoints = [
        ("canonical-node-132", "head-060"),
        ("canonical-node-134", "head-059"),
        ("canonical-node-135", "head-066"),
        ("canonical-node-136", "head-065"),
        ("canonical-node-139", "head-064"),
        ("canonical-node-140", "head-063"),
        ("canonical-node-141", "head-058"),
        ("canonical-node-142", "head-057"),
        ("canonical-node-127", "head-067"),
        ("canonical-node-128", "head-061"),
        ("canonical-node-129", "head-062"),
        ("canonical-node-130", "head-068"),
    ]
    for _node_id, head_id in direct_endpoints:
        source_nodes = [node for node in graph["nodes"] if head_id in node.get("sprinklerIds", [])]
        if len(source_nodes) != 1:
            raise ValueError(f"expected one source-plan node for {head_id}, got {len(source_nodes)}")
        raw = source_nodes[0]["pdfPt"]
        point = fitz.Point(raw["x"], raw["y"])
        page.draw_circle(point, 15, color=CYAN, fill=(1, 1, 1), fill_opacity=0.45, width=5, overlay=True)
        page.insert_text(fitz.Point(point.x + 14, point.y - 10), head_id.replace("head-", "H"), fontsize=8, fontname="hebo", color=CYAN, overlay=True)

    if rendered != 4 or len(direct_endpoints) != 12:
        raise ValueError("unexpected top-view terminal inventory")
    header(
        page,
        "NEW HOPE CMI.23-CMI.42 - ACTUAL FP2.0 TOP VIEW",
        "4 approved horizontal arm-over routes | 12 exact direct carrier/head endpoints | equal piece identities remain intentionally unresolved",
    )
    legend = fitz.Rect(1835, 720, 2860, 930)
    page.draw_rect(legend, color=INK, fill=(1, 1, 1), fill_opacity=0.93, width=2, overlay=True)
    page.draw_line(fitz.Point(1870, 765), fitz.Point(1960, 765), color=ORANGE, width=12, overlay=True)
    page.insert_text(fitz.Point(1980, 770), "approved horizontal one-inch route; label is an exact two-piece equivalence set", fontsize=10, color=INK, overlay=True)
    page.draw_circle(fitz.Point(1915, 815), 13, color=CYAN, width=5, overlay=True)
    page.insert_text(fitz.Point(1980, 820), "direct carrier/head endpoint; candidate pieces CMI.31-CMI.42", fontsize=10, color=INK, overlay=True)
    page.insert_text(fitz.Point(1870, 875), "NO fabricated piece-to-endpoint identity is selected on this sheet.", fontsize=11, fontname="hebo", color=RED, overlay=True)
    page.insert_text(fitz.Point(1870, 905), "Top view proves XY and endpoint sets; exact takeout and pipe-centerline Z remain blocked.", fontsize=10, color=INK, overlay=True)


def draw_armover_schematic(page: fitz.Page, y: float, title: str, horizontal: str, follower: str, heads: str) -> None:
    page.insert_text(fitz.Point(130, y), title, fontsize=17, fontname="hebo", color=INK, overlay=True)
    x0 = 180
    page.draw_line(fitz.Point(x0, y + 58), fitz.Point(x0 + 430, y + 58), color=ORANGE, width=14, overlay=True)
    page.draw_line(fitz.Point(x0 + 430, y + 58), fitz.Point(x0 + 430, y - 42), color=CYAN, width=14, overlay=True)
    page.draw_circle(fitz.Point(x0 + 430, y - 55), 13, color=YELLOW, fill=YELLOW, width=2, overlay=True)
    page.insert_text(fitz.Point(x0, y + 90), horizontal, fontsize=13, color=ORANGE, overlay=True)
    page.insert_text(fitz.Point(x0 + 460, y + 10), follower, fontsize=13, color=CYAN, overlay=True)
    page.insert_text(fitz.Point(x0 + 460, y - 37), heads, fontsize=12, color=INK, overlay=True)


def draw_elevation_page(output: fitz.Document, field: fitz.Document, listing: fitz.Document) -> None:
    page = output.new_page(width=3024, height=2160)
    page.draw_rect(page.rect, fill=(0.965, 0.975, 0.99), color=(0.965, 0.975, 0.99), overlay=True)
    header(
        page,
        "CMI THREADED TERMINALS - ELEVATION EVIDENCE BOUNDARY",
        "Actual FP1.0 building section + actual listing page 42 | schematic classes only; no pipe is placed into the section without exact Z",
    )

    section_clip = fitz.Rect(1180, 0, 2760, 470)
    section_dest = fitz.Rect(80, 185, 1990, 750)
    page.show_pdf_page(section_dest, field, FIELD_FP10_PAGE, clip=section_clip)
    page.draw_rect(section_dest, color=INK, width=2, overlay=True)
    page.insert_text(fitz.Point(105, 725), "ACTUAL FIELD FP1.0 BUILDING SECTION - PIPE OVERLAY WITHHELD: per-piece Z is not published", fontsize=13, fontname="hebo", color=RED, overlay=True)

    listing_clip = fitz.Rect(25, 285, 590, 625)
    listing_dest = fitz.Rect(2070, 185, 2940, 925)
    page.show_pdf_page(listing_dest, listing, LISTING_PAGE_42, clip=listing_clip)
    page.draw_rect(listing_dest, color=INK, width=2, overlay=True)
    page.insert_text(fitz.Point(2090, 955), "ACTUAL LISTING PAGE 42 - exact cut lengths, T-T ends, and fitting families", fontsize=12, fontname="hebo", color=INK, overlay=True)

    draw_armover_schematic(page, 930, "SHORT ARM-OVER CLASS", "CMI.23 / CMI.27 - 20 in horizontal", "CMI.24 / CMI.28 - 8.5 in follower", "H053 / H056 endpoint set")
    draw_armover_schematic(page, 1220, "LONG ARM-OVER CLASS", "CMI.25 / CMI.29 - 80.5 in horizontal", "CMI.26 / CMI.30 - 1.5 in follower", "H035 / H036 endpoint set")

    page.insert_text(fitz.Point(130, 1540), "DIRECT VERTICAL NIPPLE CLASSES - 12 exact carrier/head endpoints", fontsize=18, fontname="hebo", color=INK, overlay=True)
    classes = [
        ("CMI.31-CMI.35", "5 pieces x 10 in", 10, ORANGE),
        ("CMI.36/.37/.39/.40", "4 pieces x 9.5 in", 9.5, CYAN),
        ("CMI.38/.41/.42", "3 pieces x 9 in", 9, YELLOW),
    ]
    x = 160
    for ids, count, length, color in classes:
        height = length * 24
        page.draw_line(fitz.Point(x + 120, 1910), fitz.Point(x + 120, 1910 - height), color=color, width=24, overlay=True)
        page.draw_circle(fitz.Point(x + 120, 1895 - height), 15, color=color, fill=color, overlay=True)
        page.insert_text(fitz.Point(x, 1955), ids, fontsize=14, fontname="hebo", color=INK, overlay=True)
        page.insert_text(fitz.Point(x, 1985), count, fontsize=13, color=GRAY, overlay=True)
        x += 560

    boundary = fitz.Rect(1840, 1110, 2920, 2015)
    page.draw_rect(boundary, color=RED, fill=(1, 1, 1), fill_opacity=0.95, width=3, overlay=True)
    page.insert_text(fitz.Point(1890, 1160), "FAIL-CLOSED IDENTITY BOUNDARY", fontsize=22, fontname="hebo", color=RED, overlay=True)
    lines = [
        "PROVED",
        "- 20 exact CMI.23-CMI.42 piece identities",
        "- 20 exact cut lengths and fitting families",
        "- 4 approved horizontal FP2.0 routes",
        "- 12 exact direct carrier/head endpoints",
        "- 7 deterministic equivalence classes",
        "",
        "NOT PROVED",
        "- exact piece-to-route identity inside equal classes",
        "- exact direct nipple-to-head identity",
        "- connection takeout",
        "- complete vertical offsets and whole-system Z",
        "",
        "7,664,025,600 exact identity assignments remain.",
        "No assignment is fabricated by this proof.",
    ]
    y = 1225
    for text in lines:
        page.insert_text(fitz.Point(1890, y), text, fontsize=15 if text in {"PROVED", "NOT PROVED"} else 13, fontname="hebo" if text in {"PROVED", "NOT PROVED"} else "helv", color=RED if text in {"NOT PROVED", "7,664,025,600 exact identity assignments remain."} else INK, overlay=True)
        y += 45


def render(args: argparse.Namespace) -> None:
    approved_path = Path(args.approved_pdf)
    field_path = Path(args.field_pdf)
    listing_path = Path(args.listing_pdf)
    hashes = {
        "approved": sha256(approved_path),
        "field": sha256(field_path),
        "listing": sha256(listing_path),
    }
    expected = {"approved": EXPECTED_APPROVED_SHA, "field": EXPECTED_FIELD_SHA, "listing": EXPECTED_LISTING_SHA}
    if hashes != expected:
        raise ValueError(f"source hash mismatch: {hashes}")

    data_root = Path(args.data_root)
    graph = load_json(data_root / "new-hope-approved-fp20-plan-graph.json")
    annotations = load_json(data_root / "new-hope-approved-fp20-operational-annotations.json")
    if graph["source"]["sha256"] != EXPECTED_APPROVED_SHA:
        raise ValueError("plan graph source hash mismatch")

    approved = fitz.open(approved_path)
    field = fitz.open(field_path)
    listing = fitz.open(listing_path)
    output = fitz.open()
    draw_top_page(output, approved, graph, annotations)
    draw_elevation_page(output, field, listing)
    output.set_metadata({
        "title": "New Hope CMI threaded terminal top and elevation evidence",
        "subject": "Actual PDF underlays with fail-closed CMI.23-CMI.42 geometry classes",
        "keywords": "Halo Fire, New Hope, FP2.0, CMI, threaded terminals, elevation, Bluebeam",
        "creationDate": "D:20260716000000-07'00'",
        "modDate": "D:20260716000000-07'00'",
    })
    output_pdf = Path(args.output_pdf)
    output_png = Path(args.output_png)
    output_pdf.parent.mkdir(parents=True, exist_ok=True)
    output_png.parent.mkdir(parents=True, exist_ok=True)
    output.save(output_pdf, garbage=4, deflate=True, no_new_id=True)
    output.close()
    approved.close()
    field.close()
    listing.close()

    with fitz.open(output_pdf) as proof:
        contact = fitz.open()
        contact_page = contact.new_page(width=1512, height=2160)
        contact_page.show_pdf_page(fitz.Rect(0, 0, 1512, 1080), proof, 0)
        contact_page.show_pdf_page(fitz.Rect(0, 1080, 1512, 2160), proof, 1)
        pixmap = contact_page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5), colorspace=fitz.csRGB, alpha=False)
        pixmap.save(output_png)
        contact.close()
    print(json.dumps({
        "sourceSha256": hashes,
        "outputPdf": str(output_pdf),
        "outputPng": str(output_png),
        "pageCount": 2,
        "threadedPieceCount": 20,
        "approvedHorizontalRouteCount": 4,
        "directCarrierHeadEndpointCount": 12,
        "exactAssignmentCandidateCount": 7664025600,
    }, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--approved-pdf", required=True)
    parser.add_argument("--field-pdf", required=True)
    parser.add_argument("--listing-pdf", required=True)
    parser.add_argument("--data-root", default="apps/autosprink/src/data")
    parser.add_argument("--output-pdf", default="output/pdf/new-hope-threaded-terminal-top-elevation-proof.pdf")
    parser.add_argument("--output-png", default="output/pdf/new-hope-threaded-terminal-top-elevation-proof.png")
    render(parser.parse_args())


if __name__ == "__main__":
    main()

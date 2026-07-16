#!/usr/bin/env python3
"""Render a Bluebeam-compatible CML/CMI adjacency overlay on approved FP2.0."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import fitz


EXPECTED_PDF_SHA256 = "5A770222363228C2766605A695FEE9B6CB1F7B49C296204E09B691100253D9D5"
PAGE_INDEX = 4
PLAN_CLIP = fitz.Rect(470, 720, 1740, 1850)
COLORS = {
    "source": (0.10, 0.42, 0.95),
    "lower": (0.96, 0.36, 0.08),
    "upper": (0.00, 0.66, 0.78),
    "junction": (0.96, 0.78, 0.08),
    "ink": (0.02, 0.05, 0.10),
}


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def collect_bindings(annotations: dict) -> list[dict]:
    evidence = annotations["fabricationLineEvidence"]
    cml = next(
        entry for entry in evidence["primaryLineBindings"] if entry["lineName"] == "CML"
    )
    cmi = []
    for key in (
        "remainingCmiPieceBindings",
        "crossMainPieceBindings",
        "verticalOutletBindings",
        "lowPointPieceBindings",
        "ridgeChainPieceBindings",
    ):
        cmi.extend(
            entry
            for entry in evidence[key]
            if entry.get("pieceId", "").startswith("CMI.")
        )
    cmi.sort(key=lambda entry: int(entry["pieceId"].split(".")[1]))
    if len(cmi) != 22 or len({entry["pieceId"] for entry in cmi}) != 22:
        raise ValueError("expected exactly CMI.01-CMI.22")
    return [
        {
            "pieceId": "CML.01",
            "sourceEdgeIds": cml["sourceEdgeIds"],
            "group": "source",
        },
        *[
            {
                "pieceId": entry["pieceId"],
                "sourceEdgeIds": entry["sourceEdgeIds"],
                "group": "lower" if int(entry["pieceId"].split(".")[1]) <= 13 else "upper",
            }
            for entry in cmi
        ],
    ]


def center(points: list[fitz.Point]) -> fitz.Point:
    return fitz.Point(
        sum(point.x for point in points) / len(points),
        sum(point.y for point in points) / len(points),
    )


def draw_label(page: fitz.Page, point: fitz.Point, text: str, color: tuple[float, float, float]) -> None:
    width = 39 if text == "CML.01" else 36
    rect = fitz.Rect(point.x - width / 2, point.y - 8, point.x + width / 2, point.y + 5)
    page.draw_rect(rect, color=COLORS["ink"], fill=(1, 1, 1), fill_opacity=0.88, width=0.7, overlay=True)
    page.insert_textbox(
        rect,
        text,
        fontsize=6.5,
        fontname="hebo",
        color=color,
        align=fitz.TEXT_ALIGN_CENTER,
        overlay=True,
    )


def render(args: argparse.Namespace) -> None:
    source_path = Path(args.pdf)
    digest = hashlib.sha256(source_path.read_bytes()).hexdigest().upper()
    if digest != EXPECTED_PDF_SHA256:
        raise ValueError(f"approved PDF hash mismatch: {digest}")

    data_root = Path(args.data_root)
    plan_graph = load_json(data_root / "new-hope-approved-fp20-plan-graph.json")
    annotations = load_json(data_root / "new-hope-approved-fp20-operational-annotations.json")
    if plan_graph["source"]["sha256"] != EXPECTED_PDF_SHA256:
        raise ValueError("plan graph source hash mismatch")

    node_by_id = {node["id"]: node for node in plan_graph["nodes"]}
    edge_by_id = {edge["id"]: edge for edge in plan_graph["edges"]}
    bindings = collect_bindings(annotations)

    source = fitz.open(source_path)
    output = fitz.open()
    page = output.new_page(width=source[PAGE_INDEX].rect.width, height=source[PAGE_INDEX].rect.height)
    page.show_pdf_page(page.rect, source, PAGE_INDEX)

    rendered_edge_ids: set[str] = set()
    label_queue: list[tuple[fitz.Point, str, tuple[float, float, float]]] = []
    for binding in bindings:
        color = COLORS[binding["group"]]
        points: list[fitz.Point] = []
        for edge_id in binding["sourceEdgeIds"]:
            edge = edge_by_id.get(edge_id)
            if not edge or edge["kind"] != "visible-source-pipe":
                raise ValueError(f"missing visible source edge {edge_id} for {binding['pieceId']}")
            start_raw = node_by_id[edge["fromNodeId"]]["pdfPt"]
            end_raw = node_by_id[edge["toNodeId"]]["pdfPt"]
            start = fitz.Point(start_raw["x"], start_raw["y"])
            end = fitz.Point(end_raw["x"], end_raw["y"])
            page.draw_line(start, end, color=color, width=7.0, stroke_opacity=0.64, overlay=True)
            points.extend((start, end))
            rendered_edge_ids.add(edge_id)
        label_queue.append((center(points), binding["pieceId"], color))

    if len(bindings) != 23 or len(rendered_edge_ids) != 66:
        raise ValueError(f"unexpected proof inventory: {len(bindings)} pieces / {len(rendered_edge_ids)} edges")

    for point, text, color in label_queue:
        draw_label(page, point, text, color)

    junction_raw = next(
        node["pdfPt"]
        for node in plan_graph["nodes"]
        if node["sourceSegmentId"] == "pipe-058" and node["sourceParameter"] == 1
    )
    junction = fitz.Point(junction_raw["x"], junction_raw["y"])
    page.draw_circle(junction, 10, color=COLORS["junction"], fill=COLORS["junction"], fill_opacity=0.72, width=1.5, overlay=True)

    header = fitz.Rect(500, 742, 1695, 805)
    page.draw_rect(header, color=COLORS["ink"], fill=(1, 1, 1), fill_opacity=0.93, width=1.2, overlay=True)
    page.insert_text(fitz.Point(520, 765), "PROTECTED APPROVED FP2.0 + NEW HOPE CML/CMI WELDED CONNECTION GRAPH", fontsize=13, fontname="hebo", color=COLORS["ink"], overlay=True)
    page.insert_text(fitz.Point(520, 789), "23 exact native pieces | 22 same-project junctions | 45 native outlets | yellow = CMI.03 bifurcation | connection takeout and whole-project adjacency remain blocked", fontsize=8.2, color=COLORS["ink"], overlay=True)

    legend_y = 824
    for label, color in (("CML.01 source", COLORS["source"]), ("CMI.01-CMI.13 lower chain", COLORS["lower"]), ("CMI.14-CMI.22 upper chain", COLORS["upper"])):
        page.draw_line(fitz.Point(520, legend_y), fitz.Point(565, legend_y), color=color, width=6, stroke_opacity=0.72, overlay=True)
        page.insert_text(fitz.Point(575, legend_y + 3), label, fontsize=7.5, color=COLORS["ink"], overlay=True)
        legend_y += 18

    output_pdf = Path(args.output_pdf)
    output_png = Path(args.output_png)
    output_pdf.parent.mkdir(parents=True, exist_ok=True)
    output_png.parent.mkdir(parents=True, exist_ok=True)
    output.set_metadata({
        "title": "New Hope FP2.0 CML/CMI welded adjacency proof",
        "subject": "Protected approved plan underlay with bounded same-project connection evidence",
        "keywords": "Halo Fire, New Hope, FP2.0, CML, CMI, Bluebeam overlay",
        "creationDate": "D:20260715000000-07'00'",
        "modDate": "D:20260715000000-07'00'",
    })
    output.save(output_pdf, garbage=4, deflate=True, no_new_id=True)
    output.close()
    source.close()

    with fitz.open(output_pdf) as verification:
        pixmap = verification[0].get_pixmap(matrix=fitz.Matrix(2, 2), clip=PLAN_CLIP, colorspace=fitz.csRGB, alpha=False)
        pixmap.save(output_png)
    print(json.dumps({
        "sourceSha256": digest,
        "outputPdf": str(output_pdf),
        "outputPng": str(output_png),
        "pieceCount": len(bindings),
        "renderedSourceEdgeCount": len(rendered_edge_ids),
    }, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", required=True)
    parser.add_argument("--data-root", default="apps/autosprink/src/data")
    parser.add_argument("--output-pdf", default="output/pdf/new-hope-cml-cmi-welded-adjacency-overlay.pdf")
    parser.add_argument("--output-png", default="output/pdf/new-hope-cml-cmi-welded-adjacency-overlay.png")
    render(parser.parse_args())


if __name__ == "__main__":
    main()

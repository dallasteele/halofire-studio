"""halofire_ingest — 4-layer PDF takeoff pipeline.

M2 week 7 scope: Layer 1 (pdfplumber vector extraction) is real.
Layers 2-4 stubbed with clear escalation path.

Flow:
  - If input is IFC → route to ifc_import.py (not shown; M1 week 3)
  - If input is DWG → reject until M2 week 8 (DWG support via ezdxf read)
  - If input is PDF:
      1. Run L1 (vector extraction)
      2. If L1 confidence ≥ 0.8 → return L1 result
      3. Else run L2 (opencv raster) — M2 week 7
      4. If L2 confidence ≥ 0.8 → merge + return
      5. Else run L3 (CubiCasa5k ML) — M2 week 8
      6. Polish with L4 (Claude Vision semantic labeling) — M2 week 8
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from .registry import Tool, register


INPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "mode": {"type": "string", "enum": ["pdf", "ifc", "dwg"]},
        "path": {
            "type": "string",
            "description": "Local filesystem path to the uploaded file",
        },
        "page_index": {
            "type": "integer",
            "default": 0,
            "description": "Which page to parse (0-based)",
        },
        "force_layer": {
            "type": "string",
            "enum": ["l1", "l2", "l3", "l4", "auto"],
            "default": "auto",
            "description": "Debug: force a specific layer even if L1 succeeds",
        },
    },
    "required": ["mode", "path"],
}


async def invoke(args: dict[str, Any]) -> str:
    mode = args.get("mode")
    path = str(args.get("path") or "")
    if not path or not os.path.isfile(path):
        return f"INGEST: file not found: {path}"

    if mode == "ifc":
        return (
            "INGEST ifc: IFC parsing runs client-side via @thatopen/components "
            "in @halofire/ifc. Gateway just stores the file + returns its path; "
            "the browser does the walk. See packages/halofire-ifc/src/import.ts."
        )

    if mode == "dwg":
        return (
            "INGEST dwg: DWG support ships M2 week 8. Server-side ezdxf read "
            "for DXF + Teigha ODC for native DWG. Until then, ask the architect "
            "to export IFC or PDF."
        )

    if mode == "pdf":
        return await _ingest_pdf(path, int(args.get("page_index", 0)), str(args.get("force_layer", "auto")))

    return f"INGEST: unknown mode: {mode}"


async def _ingest_pdf(path: str, page_index: int, force_layer: str) -> str:
    # ── Layer 1: pdfplumber vector extraction ───────────────────────────
    from pdf_pipeline.vector import extract_vectors  # type: ignore[import-not-found]

    try:
        l1 = extract_vectors(path, page_index)
    except (RuntimeError, OSError) as e:
        return f"INGEST L1 error: {e}"

    result_json = l1.to_json()
    lines = [
        f"INGEST PDF: {Path(path).name}  page {page_index}",
        f"  Page size: {l1.page_width_pt:.0f} × {l1.page_height_pt:.0f} pt",
        "",
        f"L1 (pdfplumber vector): {len(l1.lines)} lines extracted",
        f"  Confidence: {l1.confidence:.2f}",
        f"  Text fragments: {len(l1.text_fragments)}",
    ]
    sw = result_json.get("linewidth_distribution", {})
    if sw.get("top_widths"):
        lines.append(f"  Top stroke widths: {sw['top_widths']}")

    if l1.warnings:
        for w in l1.warnings:
            lines.append(f"  WARNING: {w}")

    # ── Escalation decision ──────────────────────────────────────────────
    if force_layer == "l1" or (l1.confidence >= 0.8 and force_layer == "auto"):
        lines.append("")
        lines.append(
            f"DONE at L1 (confidence {l1.confidence:.2f} >= 0.8 threshold)"
            if l1.confidence >= 0.8
            else "DONE at L1 (forced)"
        )
        lines.append("")
        lines.append(
            "Next: classify walls from parallel line pairs, extract rooms, "
            "infer hazard classes from text near centroids. Implementation "
            "lands in M2 week 10 once Claude Vision (L4) is available for "
            "semantic polish."
        )
        return "\n".join(lines)

    # Would escalate — layers 2-4 aren't implemented yet
    lines.append("")
    lines.append(
        f"L1 confidence {l1.confidence:.2f} < 0.8 threshold. Would escalate to:"
    )
    lines.append("  L2 opencv Hough (raster fallback) — M2 week 7")
    lines.append("  L3 CubiCasa5k pretrained ML — M2 week 8")
    lines.append("  L4 Claude Vision semantic labeling — M2 week 8")
    lines.append("")
    lines.append(
        "For now, returning L1 result even at low confidence. Caller can "
        "inspect lines + text fragments and decide whether to reshoot the "
        "PDF with vector output or wait for L2+."
    )
    return "\n".join(lines)


register(
    Tool(
        name="halofire_ingest",
        description=(
            "Parse an uploaded architect file. PDF goes through a 4-layer "
            "pipeline (L1 pdfplumber vectors, L2 opencv Hough, L3 CubiCasa5k "
            "pretrained, L4 Claude Vision polish). IFC routes to browser-side "
            "@thatopen/components. DWG pending M2 week 8. L1 is real today, "
            "L2-L4 stubbed with clear escalation thresholds."
        ),
        input_schema=INPUT_SCHEMA,
        invoke=invoke,
    )
)

"""halofire_ingest — 4-layer PDF takeoff pipeline stub.

Layers (all free):
  L1 pdfplumber  — vector extraction
  L2 opencv      — Hough line detection + template matching
  L3 CubiCasa5k  — pretrained floor-plan segmentation
  L4 Claude Vision — semantic labeling + ambiguity polish
"""
from __future__ import annotations

from typing import Any

from .registry import Tool, register


INPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "mode": {"type": "string", "enum": ["pdf", "ifc", "dwg"]},
        "job_id": {"type": "string", "description": "Multipart upload job id"},
        "force_all_layers": {"type": "boolean", "default": False},
    },
    "required": ["mode", "job_id"],
}


async def invoke(args: dict[str, Any]) -> str:
    job_id = args.get("job_id")
    mode = args.get("mode")
    return (
        f"INGEST (stub) mode={mode} job={job_id}. "
        "Phase M2 wires L1 pdfplumber + L2 opencv + L3 CubiCasa + L4 Claude Vision."
    )


register(
    Tool(
        name="halofire_ingest",
        description=(
            "Parse an uploaded architect file (PDF/IFC/DWG) into a structured "
            "scene. PDF path uses a 4-layer free pipeline (pdfplumber + opencv + "
            "CubiCasa5k + Claude Vision) that escalates on confidence."
        ),
        input_schema=INPUT_SCHEMA,
        invoke=invoke,
    )
)

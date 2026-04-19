"""halofire_export — generate AHJ-ready sheet set + schedules + proposal."""
from __future__ import annotations

from typing import Any

from .registry import Tool, register


INPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "mode": {
            "type": "string",
            "enum": [
                "pdf_plan",
                "dxf",
                "ifc",
                "cut_sheets",
                "proposal",
                "sheet_set",
            ],
        },
        "scene_id": {"type": "string"},
        "sheet": {
            "type": "string",
            "description": "Sheet number (e.g. FP-3.0) for single-sheet export",
        },
        "output_path": {"type": "string"},
    },
    "required": ["mode", "scene_id"],
}


async def invoke(args: dict[str, Any]) -> str:
    return (
        f"EXPORT (stub) mode={args.get('mode')}. "
        "Phase M1 week 5 wires pdf_plan single-sheet via draft_plan.py + jsPDF. "
        "Full AHJ sheet set in M3."
    )


register(
    Tool(
        name="halofire_export",
        description=(
            "Export deliverables: pdf_plan (single floor plan), dxf (CAD exchange), "
            "ifc (BIM round-trip), cut_sheets (manufacturer submittals), "
            "proposal (customer-facing PDF), sheet_set (full AHJ submittal)."
        ),
        input_schema=INPUT_SCHEMA,
        invoke=invoke,
    )
)

"""halofire_export — generate AHJ-ready sheet set + schedules + proposal.

M1 week 5: `pdf_plan` single-sheet plan rendering via the vendored
matplotlib renderer (drafting_matplotlib.draw). Accepts an equipment
schedule in YAML shape; returns a base64 PNG (acts as PDF-equivalent
at this stage; real PDF output uses reportlab in M2).

M3 grows this to a full AHJ sheet-set (FP-0 through FP-5) with ezdxf
DXF export, reportlab PDF plotting, cut-sheet assembly, and engineer
stamp overlay.
"""
from __future__ import annotations

import base64
import io
import os
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
        "schedule": {
            "type": "object",
            "description": (
                "Equipment schedule matching the YAML shape from "
                "skills/3d-procedural-authoring/schedules/*.yaml (project, "
                "room, zones, equipment[])"
            ),
        },
        "output_path": {
            "type": "string",
            "description": "Where to write the output file on the server",
        },
        "sheet": {
            "type": "string",
            "description": "Sheet number (e.g. FP-3.0) for sheet_set mode",
        },
    },
    "required": ["mode"],
}


async def invoke(args: dict[str, Any]) -> str:
    mode = args.get("mode")

    if mode == "pdf_plan":
        return await _render_pdf_plan(args)

    if mode == "dxf":
        return (
            "EXPORT dxf (M2 week 10 scope): draft_plan.py ezdxf path. "
            "Vendored module at services/halopenclaw-gateway/drafting_ezdxf.py "
            "pending."
        )

    if mode in ("ifc", "cut_sheets", "proposal", "sheet_set"):
        return (
            f"EXPORT {mode} (M3 scope): full AHJ sheet-set generator with "
            f"title blocks, dimensioning, schedules, cut-sheet assembly, "
            f"proposal PDF, hydraulic placard. Ships weeks 21-22."
        )

    return f"unknown mode: {mode}"


async def _render_pdf_plan(args: dict[str, Any]) -> str:
    schedule = args.get("schedule")
    if not schedule or not isinstance(schedule, dict):
        return (
            "pdf_plan: 'schedule' object required. Expected shape from "
            "skills/3d-procedural-authoring/schedules/*.yaml"
        )

    out_path = str(args.get("output_path") or "")
    try:
        from drafting_matplotlib import draw  # type: ignore[import-not-found]
    except ImportError as e:
        return f"drafting_matplotlib not importable: {e}"

    # If no output path, write to in-memory and return base64
    if not out_path:
        tmp_path = "/tmp/halofire_plan.png" if os.name != "nt" else os.path.join(
            os.environ.get("TEMP", "."), "halofire_plan.png"
        )
        draw(schedule, tmp_path)
        try:
            with open(tmp_path, "rb") as f:
                png_bytes = f.read()
            os.unlink(tmp_path)
        except OSError as e:
            return f"failed to read/remove tmp plan: {e}"
        b64 = base64.b64encode(png_bytes).decode("ascii")
        return (
            f"EXPORT pdf_plan:\n"
            f"  Rendered {len(png_bytes)} bytes PNG (base64 below)\n"
            f"  Equipment count: {len(schedule.get('equipment', []))}\n"
            f"  Zones: {len(schedule.get('zones', []))}\n"
            f"\n"
            f"BASE64:{b64[:200]}... (truncated; full payload {len(b64)} chars)"
        )

    # Named output path
    draw(schedule, out_path)
    try:
        size = os.path.getsize(out_path)
    except OSError:
        size = 0
    return (
        f"EXPORT pdf_plan:\n"
        f"  Wrote {size} bytes to {out_path}\n"
        f"  Equipment count: {len(schedule.get('equipment', []))}\n"
        f"  Zones: {len(schedule.get('zones', []))}"
    )


register(
    Tool(
        name="halofire_export",
        description=(
            "Export deliverables from a Halofire scene + schedule. M1 ships "
            "pdf_plan single-sheet rendering via matplotlib. M2 adds DXF "
            "(ezdxf). M3 adds full AHJ sheet-set (FP-0..FP-5), cut-sheet "
            "PDF assembly, proposal PDF, engineer stamp overlay."
        ),
        input_schema=INPUT_SCHEMA,
        invoke=invoke,
    )
)

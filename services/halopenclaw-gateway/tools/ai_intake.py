"""halofire_ai_intake — full agent-driven Building extraction.

Wraps the halofire-cad `00-intake` agent. Walks every floor-plan page
in the PDF, runs wall clustering + room polygonization, and returns a
`Building` JSON that every downstream AI agent (classifier, placer,
router, hydraulic, drafter) consumes.

Distinct from the lower-level `halofire_ingest` tool: that returns raw
L1 vectors + confidence. This returns the structured Building.
"""
from __future__ import annotations

import importlib
import json
import os
import sys
from pathlib import Path
from typing import Any

from .registry import Tool, register


# Put halofire-cad on the import path — keep one sys.path mutation at
# module import rather than in every call.
_HFCAD = Path(__file__).resolve().parents[2] / "halofire-cad"
if str(_HFCAD) not in sys.path:
    sys.path.insert(0, str(_HFCAD))


INPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "pdf_path": {"type": "string"},
        "project_id": {"type": "string", "default": "demo"},
    },
    "required": ["pdf_path"],
}


def _load_agent():
    """Load the intake agent module — dir name starts with a digit so
    regular `import agents.00-intake.agent` doesn't work. Use importlib
    with a file path.
    """
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "halofire_intake_agent",
        _HFCAD / "agents" / "00-intake" / "agent.py",
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot locate intake agent.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


async def invoke(args: dict[str, Any]) -> str:
    pdf = str(args.get("pdf_path") or "")
    project_id = str(args.get("project_id") or "demo")
    if not pdf or not os.path.isfile(pdf):
        return f"AI_INTAKE: file not found: {pdf}"

    try:
        agent = _load_agent()
    except Exception as e:
        return f"AI_INTAKE: agent load failed: {e}"

    try:
        bldg = agent.intake_file(pdf, project_id)
    except Exception as e:
        return f"AI_INTAKE: intake_file error: {e}"

    data = bldg.model_dump()
    wall_total = sum(len(l["walls"]) for l in data["levels"])
    room_total = sum(len(l["rooms"]) for l in data["levels"])

    # Save full output for caller pickup (JSON > 10kb doesn't fit
    # comfortably in a tool-call response).
    out_dir = Path(os.environ.get("TEMP", ".")) / "halofire"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{project_id}_building.json"
    out_path.write_text(json.dumps(data, indent=2), encoding="utf-8")

    lines = [
        f"AI_INTAKE {project_id}",
        f"  source: {pdf}",
        f"  levels found: {len(data['levels'])}",
        f"  walls extracted: {wall_total}",
        f"  rooms polygonized: {room_total}",
        f"  full Building JSON: {out_path}",
    ]
    for lvl in data["levels"][:8]:
        lines.append(
            f"    {lvl['id']:<12} {lvl['name']:<32} "
            f"walls={len(lvl['walls']):>4} rooms={len(lvl['rooms']):>3}"
        )
    if len(data["levels"]) > 8:
        lines.append(f"    ... {len(data['levels']) - 8} more levels")
    lines.append("")
    lines.append(
        "[L1 pdfplumber-only intake. L2 opencv + L3 CubiCasa5k + L4 "
        "Claude Vision layered refinement ship Phase 2 of the plan.]"
    )
    return "\n".join(lines)


register(
    Tool(
        name="halofire_ai_intake",
        description=(
            "Agent-driven PDF → Building extraction. Runs the 4-layer "
            "ingest pipeline (L1 vector now, L2/L3/L4 stubs) over every "
            "floor-plan page in the PDF, clusters thick orthogonal "
            "strokes into walls, polygonizes rooms, and returns a "
            "structured Building JSON for downstream agents."
        ),
        input_schema=INPUT_SCHEMA,
        invoke=invoke,
    )
)

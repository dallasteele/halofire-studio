"""halofire_ai_pipeline — run the full CAD pipeline as a single tool call.

Dispatches the orchestrator: intake → classify → place → route →
hydraulic → rulecheck → bom → labor → proposal → submittal.
"""
from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path
from typing import Any

from .registry import Tool, register


_HFCAD = Path(__file__).resolve().parents[2] / "halofire-cad"
if str(_HFCAD) not in sys.path:
    sys.path.insert(0, str(_HFCAD))


def _orchestrator():
    spec = importlib.util.spec_from_file_location(
        "hf_orchestrator", _HFCAD / "orchestrator.py",
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("orchestrator unavailable")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


INPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "pdf_path": {"type": "string"},
        "project_id": {"type": "string", "default": "demo"},
        "out_dir": {"type": "string"},
    },
    "required": ["pdf_path", "project_id"],
}


async def invoke(args: dict[str, Any]) -> str:
    pdf = str(args.get("pdf_path") or "")
    pid = str(args.get("project_id") or "demo")
    out = args.get("out_dir")
    if not pdf or not os.path.isfile(pdf):
        return f"AI_PIPELINE: file not found: {pdf}"

    orch = _orchestrator()
    try:
        summary = orch.run_pipeline(
            pdf, project_id=pid,
            out_dir=Path(out) if out else None,
        )
    except Exception as e:
        return f"AI_PIPELINE: exception: {e}"

    lines = [
        f"AI_PIPELINE project={pid}",
    ]
    for step in summary.get("steps", []):
        name = step.get("step", "?")
        rest = ", ".join(f"{k}={v}" for k, v in step.items() if k != "step")
        lines.append(f"  [{name:<10}] {rest}")
    lines.append("")
    lines.append("Files:")
    for k, v in summary.get("files", {}).items():
        lines.append(f"  {k:<10} {v}")
    return "\n".join(lines)


register(
    Tool(
        name="halofire_ai_pipeline",
        description=(
            "Run the full HaloFire CAD pipeline end-to-end on an architect "
            "PDF. Produces building/design/violations/proposal/bom/labor "
            "JSON + proposal.pdf + proposal.xlsx + design.dxf + design.ifc "
            "+ design.glb in the project's deliverables directory."
        ),
        input_schema=INPUT_SCHEMA,
        invoke=invoke,
    )
)

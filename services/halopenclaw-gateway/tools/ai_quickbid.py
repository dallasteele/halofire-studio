"""halofire_quickbid — 60s fast-path estimator."""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any

from .registry import Tool, register


_HFCAD = Path(__file__).resolve().parents[2] / "halofire-cad"
if str(_HFCAD) not in sys.path:
    sys.path.insert(0, str(_HFCAD))


def _orchestrator():
    spec = importlib.util.spec_from_file_location(
        "hf_orchestrator_qb", _HFCAD / "orchestrator.py",
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("orchestrator unavailable")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


INPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "total_sqft": {"type": "number"},
        "project_id": {"type": "string", "default": "demo"},
        "level_count": {"type": "integer", "default": 1},
        "standpipe_count": {"type": "integer", "default": 0},
        "dry_systems": {"type": "integer", "default": 0},
        "hazard_mix": {
            "type": "object",
            "description": "Fractions, e.g. {\"light\": 0.7, \"ordinary_i\": 0.3}",
        },
    },
    "required": ["total_sqft"],
}


async def invoke(args: dict[str, Any]) -> str:
    orch = _orchestrator()
    try:
        result = orch.run_quickbid(
            total_sqft=float(args.get("total_sqft", 0)),
            project_id=str(args.get("project_id", "demo")),
            level_count=int(args.get("level_count", 1)),
            standpipe_count=int(args.get("standpipe_count", 0)),
            dry_systems=int(args.get("dry_systems", 0)),
            hazard_mix=args.get("hazard_mix"),
        )
    except Exception as e:
        return f"QUICKBID: exception: {e}"

    lines = [
        f"QUICKBID project={result['project_id']}",
        f"  Total sqft: {result['total_sqft']:,.0f}",
        f"  Confidence: {result['confidence']}",
        f"  TOTAL: ${result['total_usd']:,.2f}",
        "",
        "Breakdown:",
    ]
    for k, v in result["breakdown"].items():
        lines.append(f"  {k:<22} ${v:>12,.2f}")
    lines.append("")
    lines.append(f"  {result['note']}")
    return "\n".join(lines)


register(
    Tool(
        name="halofire_quickbid",
        description=(
            "60-second fast-path bid estimator. Uses sqft × hazard-mix × "
            "$/sqft rates plus standard add-ons (standpipes, FDC, dry "
            "systems, permits, mobilizations). Returns ballpark total "
            "with ~80% confidence."
        ),
        input_schema=INPUT_SCHEMA,
        invoke=invoke,
    )
)

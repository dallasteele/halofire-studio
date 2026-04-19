"""halofire_route_pipe — pipe network routing + sizing."""
from __future__ import annotations

from typing import Any

from .registry import Tool, register


INPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "mode": {
            "type": "string",
            "enum": ["manual_segment", "auto_tree", "auto_loop", "auto_grid"],
        },
        "scene_id": {"type": "string"},
        "heads": {"type": "array", "description": "Head IDs to connect"},
        "riser_id": {"type": "string"},
        "pipe_material": {
            "type": "string",
            "enum": ["steel_sch10", "steel_sch40", "cpvc", "copper"],
        },
    },
    "required": ["mode", "scene_id"],
}


async def invoke(args: dict[str, Any]) -> str:
    return (
        f"ROUTE_PIPE (stub) mode={args.get('mode')}. "
        "Phase M1 week 4 wires manual_segment. Auto-tree in M3 week 13-15."
    )


register(
    Tool(
        name="halofire_route_pipe",
        description=(
            "Route pipe network. Manual_segment for user-drawn runs; "
            "auto_tree/loop/grid for automated layouts per NFPA 13."
        ),
        input_schema=INPUT_SCHEMA,
        invoke=invoke,
    )
)

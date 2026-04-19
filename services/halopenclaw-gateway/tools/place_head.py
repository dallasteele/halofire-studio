"""halofire_place_head — place sprinkler heads on a scene."""
from __future__ import annotations

from typing import Any

from .registry import Tool, register


INPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "mode": {
            "type": "string",
            "enum": ["manual", "auto_grid", "at_coords"],
            "description": (
                "manual: user-driven single placement; "
                "auto_grid: NFPA 13 max-spacing grid per room; "
                "at_coords: place at explicit [x,y,z] list."
            ),
        },
        "scene_id": {"type": "string"},
        "room_id": {"type": "string", "description": "Room to populate (auto_grid)"},
        "head_model": {"type": "string", "description": "SKU from catalog"},
        "positions": {
            "type": "array",
            "description": "[x,y,z] triples (at_coords mode)",
        },
        "hazard_class": {
            "type": "string",
            "enum": ["light", "ordinary_i", "ordinary_ii", "extra_i", "extra_ii"],
        },
    },
    "required": ["mode", "scene_id"],
}


async def invoke(args: dict[str, Any]) -> str:
    return (
        f"PLACE_HEAD (stub) mode={args.get('mode')} scene={args.get('scene_id')}. "
        "Phase M1 week 3 wires manual placement. Auto-grid in M2 week 10."
    )


register(
    Tool(
        name="halofire_place_head",
        description=(
            "Place sprinkler head(s) on a scene. Manual mode for user clicks, "
            "auto_grid for NFPA 13 max-spacing grid per room, at_coords for "
            "explicit positions."
        ),
        input_schema=INPUT_SCHEMA,
        invoke=invoke,
    )
)

"""halofire_calc — hydraulic calculations per NFPA 13."""
from __future__ import annotations

from typing import Any

from .registry import Tool, register


INPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "mode": {
            "type": "string",
            "enum": ["hazen_williams", "density_area", "remote_area", "supply_check"],
        },
        "scene_id": {"type": "string"},
        "hazard_class": {
            "type": "string",
            "enum": ["light", "ordinary_i", "ordinary_ii", "extra_i", "extra_ii"],
        },
        "water_supply": {
            "type": "object",
            "properties": {
                "static_psi": {"type": "number"},
                "residual_psi": {"type": "number"},
                "flow_gpm": {"type": "number"},
            },
            "description": "From hydrant flow test",
        },
    },
    "required": ["mode", "scene_id"],
}


async def invoke(args: dict[str, Any]) -> str:
    return (
        f"CALC (stub) mode={args.get('mode')}. "
        "Phase M1 week 4 wires Hazen-Williams single-branch. "
        "Density-area + remote-area in M3 week 16-18."
    )


register(
    Tool(
        name="halofire_calc",
        description=(
            "Run hydraulic calculations: Hazen-Williams friction loss, "
            "density-area method, remote-area identification, water-supply "
            "demand-vs-supply check. Per NFPA 13 Ch 23."
        ),
        input_schema=INPUT_SCHEMA,
        invoke=invoke,
    )
)

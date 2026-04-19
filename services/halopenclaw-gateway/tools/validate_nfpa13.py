"""halofire_validate — audit a scene against NFPA 13 rules + structural sanity.

M1: shell structural audit (walls touch floor, ceiling closed, no floating
actors). M3: full NFPA 13 rule engine.
"""
from __future__ import annotations

from typing import Any

from .registry import Tool, register


INPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "mode": {
            "type": "string",
            "enum": ["nfpa13", "shell", "hydraulic", "completeness"],
            "description": "Which validation pass to run.",
        },
        "scene": {
            "type": "object",
            "description": "Halofire scene JSON (Pascal node tree + sprinkler layer)",
        },
    },
    "required": ["mode", "scene"],
}


async def invoke(args: dict[str, Any]) -> str:
    mode = args.get("mode")
    scene = args.get("scene", {})
    node_count = len(scene.get("nodes", []))

    if mode == "shell":
        return (
            f"SHELL_AUDIT (stub): {node_count} nodes in scene. "
            "Phase M1 week 1 implements wall-touches-floor check per NFPA 13 §9.2."
        )
    if mode == "nfpa13":
        return (
            f"NFPA13_AUDIT (stub): {node_count} nodes. "
            "Phase M3 implements Ch 8-11 rule engine with code citations."
        )
    if mode == "hydraulic":
        return (
            "HYDRAULIC_AUDIT (stub): Phase M3 implements demand vs supply "
            "curve check, remote-area identification, Hazen-Williams trace."
        )
    if mode == "completeness":
        return (
            "COMPLETENESS_AUDIT (stub): Phase M3 implements 8-phase drafting "
            "workflow verification (Research/Program/Options/.../AsBuilt)."
        )
    return f"unknown mode: {mode}"


register(
    Tool(
        name="halofire_validate",
        description=(
            "Validate a Halofire scene against NFPA 13 rules, structural sanity, "
            "hydraulic adequacy, or completeness of the 8-phase drafting workflow."
        ),
        input_schema=INPUT_SCHEMA,
        invoke=invoke,
    )
)

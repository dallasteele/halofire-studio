"""halofire_generate_building — MCP tool for the procedural building
generator (Phase J).

Takes a BuildingGenSpec, produces a Building + optional GLB shell,
saves both under the project's deliverables dir, returns the paths.
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
from pathlib import Path
from typing import Any

from .registry import Tool, register


_HFCAD = Path(__file__).resolve().parents[2] / "halofire-cad"
if str(_HFCAD) not in sys.path:
    sys.path.insert(0, str(_HFCAD))


def _load_bg():
    spec = importlib.util.spec_from_file_location(
        "hf_bg_tool", _HFCAD / "agents" / "14-building-gen" / "agent.py",
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("building-gen agent missing")
    m = importlib.util.module_from_spec(spec)
    sys.modules["hf_bg_tool"] = m
    spec.loader.exec_module(m)
    return m


def _load_glb():
    spec = importlib.util.spec_from_file_location(
        "hf_bg_glb_tool", _HFCAD / "agents" / "14-building-gen" / "glb.py",
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("building-gen glb missing")
    m = importlib.util.module_from_spec(spec)
    sys.modules["hf_bg_glb_tool"] = m
    spec.loader.exec_module(m)
    return m


INPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "project_id": {"type": "string", "default": "demo"},
        "total_sqft_target": {"type": "number", "default": 100000},
        "stories": {"type": "integer", "default": 4},
        "garage_levels": {"type": "integer", "default": 2},
        "aspect_ratio": {"type": "number", "default": 1.5},
        "emit_glb": {"type": "boolean", "default": True},
        "out_dir": {"type": "string"},
    },
}


async def invoke(args: dict[str, Any]) -> str:
    project_id = str(args.get("project_id") or "demo")
    total_sqft = float(args.get("total_sqft_target") or 100000)
    stories = int(args.get("stories") or 4)
    garage_levels = int(args.get("garage_levels") or 2)
    aspect = float(args.get("aspect_ratio") or 1.5)
    emit_glb = bool(args.get("emit_glb", True))

    bg = _load_bg()
    try:
        spec = bg._default_residential_spec(
            total_sqft, stories=stories, garage_levels=garage_levels,
        )
        spec.project_id = project_id
        spec.aspect_ratio = aspect
        bldg = bg.generate_building(spec)
    except Exception as e:
        return f"BUILDING_GEN_FAILED: {e}"

    out_dir = Path(
        args.get("out_dir")
        or (
            Path(__file__).resolve().parents[1]
            / "data" / project_id / "deliverables"
        )
    )
    out_dir.mkdir(parents=True, exist_ok=True)
    bldg_path = out_dir / "building_synthetic.json"
    bldg_path.write_text(
        bldg.model_dump_json(indent=2), encoding="utf-8",
    )

    glb_path: str = ""
    if emit_glb:
        glb = _load_glb()
        try:
            glb_path = glb.building_to_glb(
                bldg, out_dir / "building_shell.glb",
            )
        except Exception as e:
            glb_path = f"ERROR: {e}"

    fp = bldg.metadata.get("footprint_m", {})
    lines = [
        f"BUILDING_GEN project={project_id}",
        f"  levels: {len(bldg.levels)}",
        f"  footprint: {fp.get('width', '?')} m × {fp.get('length', '?')} m",
        f"  total_sqft: {bldg.total_sqft:.0f}",
        f"  synthesized: {bldg.metadata.get('synthesized', False)}",
        f"  building JSON: {bldg_path}",
    ]
    if emit_glb:
        lines.append(f"  GLB shell: {glb_path}")
    return "\n".join(lines)


register(
    Tool(
        name="halofire_generate_building",
        description=(
            "Procedural parametric building generator. Produces a "
            "plausible multi-story building with walls / rooms / stair "
            "shafts / slab geometry, saves Building JSON + GLB shell. "
            "Output is clearly marked synthesized=True so downstream "
            "consumers never confuse it with an architect's real "
            "model. Use for demos, regression fixtures, and stress "
            "tests."
        ),
        input_schema=INPUT_SCHEMA,
        invoke=invoke,
    )
)

"""halofire_place_head — compute sprinkler head placement positions.

M1 week 3: auto_grid + at_coords modes. Manual mode is a pass-through
(the studio UI handles click-to-place directly on its Pascal node tree).

auto_grid algorithm (M1 basic):
  Given a rectangular room bbox + hazard class, compute the NFPA 13
  max-spacing grid so each head covers <= max_coverage_sq_ft and is
  <= max_distance_from_wall_ft from each wall.

  Start from a corner:
    row_pitch = min(max_spacing_ft, room_short_dim / ceil(room_short_dim / max_spacing_ft))
    col_pitch = similar for long axis
    first_offset = max_distance_from_wall_ft (actually half the pitch, whichever is smaller)

  Then emit a grid of [x, y, z=ceiling_z] positions.

Hazard-class limits from skills/3d-procedural-authoring knowledge +
NFPA 13-2022 §11.2.3 + §11.2.3.1.1 Table (abbreviated):

    hazard          max_coverage_sq_ft   max_spacing_ft   max_from_wall_ft
    light           225                  15               7.5
    ordinary_i      130                  15               7.5
    ordinary_ii     130                  15               7.5
    extra_i         100                  12               6.0
    extra_ii        100                  12               6.0
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

from .registry import Tool, register


HAZARD_LIMITS: dict[str, dict[str, float]] = {
    "light":       {"max_coverage_sq_ft": 225, "max_spacing_ft": 15, "max_from_wall_ft": 7.5},
    "ordinary_i":  {"max_coverage_sq_ft": 130, "max_spacing_ft": 15, "max_from_wall_ft": 7.5},
    "ordinary_ii": {"max_coverage_sq_ft": 130, "max_spacing_ft": 15, "max_from_wall_ft": 7.5},
    "extra_i":     {"max_coverage_sq_ft": 100, "max_spacing_ft": 12, "max_from_wall_ft": 6.0},
    "extra_ii":    {"max_coverage_sq_ft": 100, "max_spacing_ft": 12, "max_from_wall_ft": 6.0},
}


INPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "mode": {
            "type": "string",
            "enum": ["manual", "auto_grid", "at_coords"],
        },
        "scene_id": {"type": "string"},
        "room_bbox_cm": {
            "type": "object",
            "description": "For auto_grid: {min:[x,y,z], max:[x,y,z]} room bounds",
            "properties": {
                "min": {"type": "array", "items": {"type": "number"}},
                "max": {"type": "array", "items": {"type": "number"}},
            },
        },
        "ceiling_z_cm": {"type": "number"},
        "hazard_class": {
            "type": "string",
            "enum": ["light", "ordinary_i", "ordinary_ii", "extra_i", "extra_ii"],
        },
        "head_model": {
            "type": "string",
            "description": "Catalog SKU (e.g., SM_Head_Pendant_Standard_K56)",
        },
        "positions_cm": {
            "type": "array",
            "description": "For at_coords: explicit [x,y,z] triples",
        },
    },
    "required": ["mode", "scene_id"],
}


@dataclass
class Placement:
    x_cm: float
    y_cm: float
    z_cm: float
    head_model: str

    def to_json(self) -> dict[str, Any]:
        return {
            "x_cm": round(self.x_cm, 1),
            "y_cm": round(self.y_cm, 1),
            "z_cm": round(self.z_cm, 1),
            "head_model": self.head_model,
        }


def _compute_auto_grid(
    bbox_min: list[float],
    bbox_max: list[float],
    ceiling_z_cm: float,
    hazard: str,
    head_model: str,
) -> list[Placement]:
    limits = HAZARD_LIMITS.get(hazard)
    if not limits:
        raise ValueError(f"unknown hazard class: {hazard}")

    # Convert NFPA feet-based limits to cm (30.48 cm/ft)
    max_sp_cm = limits["max_spacing_ft"] * 30.48
    max_wall_cm = limits["max_from_wall_ft"] * 30.48
    max_cov_sq_cm = limits["max_coverage_sq_ft"] * 929.03  # sq ft → sq cm

    room_w = bbox_max[0] - bbox_min[0]
    room_l = bbox_max[1] - bbox_min[1]

    # Pick a spacing that satisfies BOTH max_spacing and max_coverage.
    # coverage per head = pitch_x * pitch_y ≤ max_cov_sq_cm.
    # If max_sp² ≤ max_cov_sq_cm, spacing is spacing-limited; else coverage-limited.
    if max_sp_cm * max_sp_cm <= max_cov_sq_cm:
        target_pitch = max_sp_cm
    else:
        target_pitch = math.sqrt(max_cov_sq_cm)

    # Number of rows/cols to cover the room; derive actual pitch from that
    cols = max(1, math.ceil((room_w - 2 * max_wall_cm) / target_pitch) + 1)
    rows = max(1, math.ceil((room_l - 2 * max_wall_cm) / target_pitch) + 1)
    # Ensure at least 1 head per axis
    pitch_x = (room_w - 2 * max_wall_cm) / max(1, cols - 1) if cols > 1 else 0
    pitch_y = (room_l - 2 * max_wall_cm) / max(1, rows - 1) if rows > 1 else 0

    # If room is smaller than 2×max_wall on an axis, just center one head
    if room_w <= 2 * max_wall_cm:
        pitch_x = 0
        cols = 1
    if room_l <= 2 * max_wall_cm:
        pitch_y = 0
        rows = 1

    # Corner offset: max_wall_cm if cols>1 else center
    x0 = bbox_min[0] + (max_wall_cm if cols > 1 else room_w / 2)
    y0 = bbox_min[1] + (max_wall_cm if rows > 1 else room_l / 2)

    placements: list[Placement] = []
    for j in range(rows):
        for i in range(cols):
            x = x0 + i * pitch_x
            y = y0 + j * pitch_y
            placements.append(Placement(x, y, ceiling_z_cm, head_model))
    return placements


async def invoke(args: dict[str, Any]) -> str:
    mode = args.get("mode")
    scene_id = args.get("scene_id")
    head_model = str(args.get("head_model") or "SM_Head_Pendant_Standard_K56")

    if mode == "manual":
        return (
            "MANUAL: click-to-place handled directly by the Halofire Studio UI "
            "against its Pascal node tree. No gateway compute needed."
        )

    if mode == "at_coords":
        positions = args.get("positions_cm") or []
        placements = [
            Placement(p[0], p[1], p[2], head_model)
            for p in positions
            if isinstance(p, list) and len(p) >= 3
        ]
        lines = [
            f"PLACE_HEAD at_coords: {len(placements)} heads in scene '{scene_id}'",
            f"  Head model: {head_model}",
        ]
        for p in placements[:10]:
            lines.append(f"  @ ({p.x_cm:.1f}, {p.y_cm:.1f}, {p.z_cm:.1f}) cm")
        if len(placements) > 10:
            lines.append(f"  ... {len(placements) - 10} more")
        return "\n".join(lines) + "\n[positions ready for scene-graph injection]"

    if mode == "auto_grid":
        bbox = args.get("room_bbox_cm") or {}
        bbox_min = bbox.get("min") or [0, 0, 0]
        bbox_max = bbox.get("max") or [0, 0, 0]
        ceiling_z = float(args.get("ceiling_z_cm") or bbox_max[2] if len(bbox_max) >= 3 else 300.0)
        hazard = str(args.get("hazard_class") or "light")

        placements = _compute_auto_grid(
            list(bbox_min), list(bbox_max), ceiling_z, hazard, head_model,
        )
        limits = HAZARD_LIMITS.get(hazard, {})
        room_sq_ft = (
            ((bbox_max[0] - bbox_min[0]) / 30.48)
            * ((bbox_max[1] - bbox_min[1]) / 30.48)
        )
        coverage_per_head = room_sq_ft / max(1, len(placements))
        lines = [
            f"AUTO_GRID: hazard={hazard}, {len(placements)} heads generated",
            f"  Room: {(bbox_max[0] - bbox_min[0])/100:.2f}m × "
            f"{(bbox_max[1] - bbox_min[1])/100:.2f}m "
            f"(= {room_sq_ft:.0f} sq ft)",
            f"  Per-hazard limits: max spacing {limits.get('max_spacing_ft')}ft, "
            f"max from wall {limits.get('max_from_wall_ft')}ft, "
            f"max coverage {limits.get('max_coverage_sq_ft')} sq ft",
            f"  Actual coverage per head: {coverage_per_head:.0f} sq ft "
            f"(≤ {limits.get('max_coverage_sq_ft')} required)",
            f"  Head model: {head_model}",
            f"  Ceiling z: {ceiling_z:.0f}cm",
            "",
            "Grid positions (first 20):",
        ]
        for p in placements[:20]:
            lines.append(f"  @ ({p.x_cm:.1f}, {p.y_cm:.1f}, {p.z_cm:.1f})")
        if len(placements) > 20:
            lines.append(f"  ... {len(placements) - 20} more")
        lines.append("")
        lines.append("[NFPA 13-2022 §11.2.3.1.1 max spacing + §11.2.3.2.1 max from wall]")
        return "\n".join(lines)

    return f"unknown mode: {mode}. Valid: manual, auto_grid, at_coords"


register(
    Tool(
        name="halofire_place_head",
        description=(
            "Compute sprinkler head positions. manual=pass-through (UI handles); "
            "auto_grid=NFPA 13 max-spacing grid over a room bbox for a given "
            "hazard class, returns head positions in cm; at_coords=spawn at "
            "explicit [x,y,z] positions. All output cites NFPA 13 sections."
        ),
        input_schema=INPUT_SCHEMA,
        invoke=invoke,
    )
)

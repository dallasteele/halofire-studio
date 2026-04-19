"""halofire_validate — audit a scene against NFPA 13 rules + structural sanity.

Ported from the ClaudeBot skill tools/validate_shell.py that caught the
5-iteration floating-walls bug in the UE cafeteria build. Same algorithm,
scene format adapted for Halofire's node-tree (Pascal schema + sprinkler layer).

Scene JSON expected shape (subset relevant to validation):
  {
    "nodes": [
      {
        "id": "uuid", "type": "wall"|"slab"|"column"|"head"|"pipe"|...,
        "bbox_world": {"min": [x,y,z], "max": [x,y,z]},  // world-space in cm
        "folder": "Level/Walls/South",                    // optional grouping
        "metadata": {...}
      },
      ...
    ],
    "units": "cm" | "m"
  }
"""
from __future__ import annotations

from typing import Any, Iterable

from .registry import Tool, register


INPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "mode": {
            "type": "string",
            "enum": ["nfpa13", "shell", "hydraulic", "completeness", "collisions"],
            "description": (
                "shell: structural actors touch floor + ceiling aligns; "
                "collisions: pairwise AABB overlap detection; "
                "nfpa13: NFPA 13 rule engine (M3); "
                "hydraulic: supply-vs-demand check (M3); "
                "completeness: 8-phase drafting workflow audit (M3)."
            ),
        },
        "scene": {
            "type": "object",
            "description": "Halofire scene JSON",
        },
        "tolerance_cm": {
            "type": "number",
            "default": 2.0,
            "description": "Shell-audit Z tolerance (±cm)",
        },
        "margin_cm": {
            "type": "number",
            "default": 5.0,
            "description": "Collision-audit margin (cm of permitted overlap)",
        },
    },
    "required": ["mode", "scene"],
}


async def invoke(args: dict[str, Any]) -> str:
    mode = args.get("mode")
    scene = args.get("scene") or {}

    if mode == "shell":
        return _shell_audit(scene, tol_cm=float(args.get("tolerance_cm", 2.0)))
    if mode == "collisions":
        return _collision_audit(scene, margin_cm=float(args.get("margin_cm", 5.0)))
    if mode == "nfpa13":
        return (
            "NFPA13_AUDIT (M3 scope): full Ch 8-11 rule engine with code citations. "
            "M1 provides only the shell + collisions audits."
        )
    if mode == "hydraulic":
        return (
            "HYDRAULIC_AUDIT (M3 scope): Hazen-Williams trace, remote-area "
            "identification, demand-vs-supply curve comparison."
        )
    if mode == "completeness":
        return (
            "COMPLETENESS_AUDIT (M3 scope): 8-phase drafting-first workflow "
            "artifacts check (Research, Program, Options, Plan, Schedule, "
            "Elevations, 3D Build, As-built)."
        )
    return f"unknown mode: {mode}"


# ── Shell audit ─────────────────────────────────────────────────────────────


def _iter_nodes(scene: dict[str, Any]) -> Iterable[dict[str, Any]]:
    return scene.get("nodes") or []


def _structural_nodes(scene: dict[str, Any]) -> list[dict[str, Any]]:
    """Nodes that should have their bottom at Z=0 (floor level).

    Includes: walls, columns, all structure items. Excludes: heads (ceiling),
    pipes (routed arbitrary), floor tiles themselves (they ARE the floor),
    ceiling tiles (hang from wall top).
    """
    out: list[dict[str, Any]] = []
    for n in _iter_nodes(scene):
        folder = (n.get("folder") or "").lower()
        node_type = (n.get("type") or "").lower()
        if node_type in ("wall", "column", "beam"):
            out.append(n)
        elif "walls" in folder or "structure" in folder:
            out.append(n)
    return out


def _bbox_min_z(node: dict[str, Any]) -> float | None:
    bbox = node.get("bbox_world") or {}
    mn = bbox.get("min")
    if not mn or len(mn) < 3:
        return None
    return float(mn[2])


def _shell_audit(scene: dict[str, Any], tol_cm: float) -> str:
    structural = _structural_nodes(scene)
    if not structural:
        return (
            f"SHELL_AUDIT: SKIP — no structural nodes found in scene "
            f"({len(list(_iter_nodes(scene)))} total nodes)"
        )

    floating: list[tuple[str, float, float, str]] = []  # label, min_z, max_z, folder
    for n in structural:
        min_z = _bbox_min_z(n)
        if min_z is None:
            continue
        if abs(min_z) > tol_cm:
            label = n.get("metadata", {}).get("label") or n.get("id") or "(unnamed)"
            folder = n.get("folder") or "(no folder)"
            bbox = n.get("bbox_world") or {}
            mx = bbox.get("max", [0, 0, 0])
            max_z = float(mx[2]) if len(mx) >= 3 else 0.0
            floating.append((str(label), min_z, max_z, folder))

    if not floating:
        return (
            f"SHELL_AUDIT: PASS — {len(structural)} structural nodes audited, "
            f"all touch Z=0 (±{tol_cm}cm)."
        )

    lines = [
        f"SHELL_AUDIT: FAIL — {len(floating)} of {len(structural)} structural "
        f"nodes do NOT touch the floor."
    ]
    for label, min_z, max_z, folder in floating[:25]:
        lines.append(
            f"  FLOATING: {label:45s} bottom_z={min_z:+.1f}  top_z={max_z:+.1f}  "
            f"({folder})"
        )
    if len(floating) > 25:
        lines.append(f"  ... {len(floating) - 25} more")
    lines.append(
        "\nFix rule: node Z = -bbox.min.z on the source mesh (= 0 for "
        "bottom-pivot meshes). See ClaudeBot skill: "
        "tools/spatial_primitives.py#place_on_floor_z"
    )
    return "\n".join(lines)


# ── Collision audit ─────────────────────────────────────────────────────────


def _bbox_intersects(a: dict, b: dict, margin: float) -> bool:
    amin = a.get("min") or [0, 0, 0]
    amax = a.get("max") or [0, 0, 0]
    bmin = b.get("min") or [0, 0, 0]
    bmax = b.get("max") or [0, 0, 0]
    return (
        amin[0] + margin <= bmax[0] and bmin[0] + margin <= amax[0]
        and amin[1] + margin <= bmax[1] and bmin[1] + margin <= amax[1]
        and amin[2] + margin <= bmax[2] and bmin[2] + margin <= amax[2]
    )


_INTENTIONAL_PAIRS = [
    ("ceiling", "wall"),
    ("floor", "wall"),
    ("pipe", "wall"),   # pipes penetrate walls legitimately
    ("pipe", "slab"),
]


def _is_intentional_pair(f_a: str, f_b: str) -> bool:
    for a, b in _INTENTIONAL_PAIRS:
        if (a in f_a and b in f_b) or (b in f_a and a in f_b):
            return True
    return False


def _collision_audit(scene: dict[str, Any], margin_cm: float) -> str:
    nodes = [n for n in _iter_nodes(scene) if n.get("bbox_world")]
    if not nodes:
        return "COLLISIONS: SKIP — no bbox_world data on nodes"

    pairs: list[tuple[str, str, str, str]] = []
    for i, a in enumerate(nodes):
        for j in range(i + 1, len(nodes)):
            b = nodes[j]
            fa = (a.get("folder") or "").lower()
            fb = (b.get("folder") or "").lower()
            if fa == fb:
                continue
            if _is_intentional_pair(fa, fb):
                continue
            if _bbox_intersects(a["bbox_world"], b["bbox_world"], margin_cm):
                la = str(a.get("metadata", {}).get("label") or a.get("id") or "?")
                lb = str(b.get("metadata", {}).get("label") or b.get("id") or "?")
                pairs.append((la, fa, lb, fb))

    if not pairs:
        return (
            f"COLLISIONS: PASS — {len(nodes)} nodes, 0 unintended overlaps "
            f"(margin {margin_cm}cm)"
        )
    lines = [f"COLLISIONS: FAIL — {len(pairs)} overlapping pairs"]
    for la, fa, lb, fb in pairs[:30]:
        lines.append(f"  {la} ({fa}) <-> {lb} ({fb})")
    if len(pairs) > 30:
        lines.append(f"  ... {len(pairs) - 30} more")
    return "\n".join(lines)


# ── Registration ────────────────────────────────────────────────────────────


register(
    Tool(
        name="halofire_validate",
        description=(
            "Validate a Halofire scene. M1 ships shell (structural floor-contact) "
            "and collisions (pairwise AABB overlap) audits. M3 adds full NFPA 13 "
            "rule engine, hydraulic demand-vs-supply, and 8-phase drafting-"
            "workflow completeness check."
        ),
        input_schema=INPUT_SCHEMA,
        invoke=invoke,
    )
)

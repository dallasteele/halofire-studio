"""halofire_route_pipe — pipe-network routing + sizing.

M1 week 4 scope: manual_segment (user-drawn runs) + auto_tree (first-cut
minimum-spanning-tree on head positions, return to riser).

M3 adds: auto_loop, auto_grid, obstruction-aware routing, joist-following.
"""
from __future__ import annotations

from dataclasses import dataclass
from math import hypot
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
        "heads": {
            "type": "array",
            "description": (
                "For auto_tree: list of head positions "
                "[{id, x_cm, y_cm, z_cm}]"
            ),
        },
        "riser": {
            "type": "object",
            "description": "For auto_tree: {id, x_cm, y_cm, z_cm} riser location",
        },
        "start": {
            "type": "object",
            "description": "For manual_segment: {x_cm, y_cm, z_cm} start",
        },
        "end": {
            "type": "object",
            "description": "For manual_segment: {x_cm, y_cm, z_cm} end",
        },
        "pipe_schedule": {"type": "string", "enum": ["sch10", "sch40"], "default": "sch10"},
        "pipe_material": {"type": "string", "default": "steel_new"},
    },
    "required": ["mode", "scene_id"],
}


@dataclass
class Node:
    id: str
    x: float
    y: float
    z: float


@dataclass
class Segment:
    from_id: str
    to_id: str
    length_cm: float
    length_ft: float


def _dist_cm(a: Node, b: Node) -> float:
    return hypot(hypot(a.x - b.x, a.y - b.y), a.z - b.z)


def _mst_from_riser(heads: list[Node], riser: Node) -> list[Segment]:
    """Prim's MST from riser out to all heads. Simple, correct, not
    optimized for thousands of heads.
    """
    nodes = [riser] + heads
    in_tree = {riser.id}
    segments: list[Segment] = []
    # Node map for lookup
    by_id = {n.id: n for n in nodes}

    while len(in_tree) < len(nodes):
        best: tuple[float, Node, Node] | None = None
        for inside_id in in_tree:
            inside = by_id[inside_id]
            for outside in nodes:
                if outside.id in in_tree:
                    continue
                d = _dist_cm(inside, outside)
                if best is None or d < best[0]:
                    best = (d, inside, outside)
        if best is None:
            break
        d, u, v = best
        in_tree.add(v.id)
        segments.append(
            Segment(
                from_id=u.id,
                to_id=v.id,
                length_cm=d,
                length_ft=d / 30.48,
            )
        )
    return segments


def _pipe_size_for_head_count(head_count: int, schedule: str = "sch10") -> float:
    """NFPA 13 §28.5 pipe schedule method (light-hazard) — simplified.

    Number of heads on a branch → min nominal pipe size (inches):
      1 head: 1"
      2 heads: 1.25"
      3 heads: 1.5"
      4-5 heads: 2"
      6-10 heads: 2.5"
      11-30 heads: 3"
      31+ heads: 4" or larger (calc required)
    """
    if head_count <= 1: return 1.0
    if head_count <= 2: return 1.25
    if head_count <= 3: return 1.5
    if head_count <= 5: return 2.0
    if head_count <= 10: return 2.5
    if head_count <= 30: return 3.0
    return 4.0


async def invoke(args: dict[str, Any]) -> str:
    mode = args.get("mode")
    scene_id = args.get("scene_id")

    if mode == "manual_segment":
        s = args.get("start") or {}
        e = args.get("end") or {}
        try:
            sx, sy, sz = float(s["x_cm"]), float(s["y_cm"]), float(s["z_cm"])
            ex, ey, ez = float(e["x_cm"]), float(e["y_cm"]), float(e["z_cm"])
        except (KeyError, TypeError, ValueError):
            return "manual_segment: 'start' + 'end' objects with x_cm/y_cm/z_cm required"
        dist_cm = hypot(hypot(ex - sx, ey - sy), ez - sz)
        return (
            f"ROUTE manual_segment scene={scene_id}\n"
            f"  From: ({sx:.1f}, {sy:.1f}, {sz:.1f}) cm\n"
            f"  To:   ({ex:.1f}, {ey:.1f}, {ez:.1f}) cm\n"
            f"  Length: {dist_cm:.1f}cm ({dist_cm / 30.48:.2f}ft)\n"
            f"  Pipe: {args.get('pipe_schedule', 'sch10')} "
            f"{args.get('pipe_material', 'steel_new')}"
        )

    if mode == "auto_tree":
        raw_heads = args.get("heads") or []
        raw_riser = args.get("riser") or {}
        if not raw_heads or not raw_riser:
            return "auto_tree: 'heads' (>=1) + 'riser' required"
        try:
            heads = [
                Node(
                    id=str(h.get("id") or f"H{i}"),
                    x=float(h["x_cm"]),
                    y=float(h["y_cm"]),
                    z=float(h["z_cm"]),
                )
                for i, h in enumerate(raw_heads)
            ]
            riser = Node(
                id=str(raw_riser.get("id") or "RISER"),
                x=float(raw_riser["x_cm"]),
                y=float(raw_riser["y_cm"]),
                z=float(raw_riser["z_cm"]),
            )
        except (KeyError, TypeError, ValueError) as e:
            return f"auto_tree: bad head/riser shape: {e}"

        segments = _mst_from_riser(heads, riser)
        total_len_cm = sum(s.length_cm for s in segments)
        schedule = str(args.get("pipe_schedule", "sch10"))

        # Count downstream heads per segment for pipe sizing (simplified:
        # just use the head count for the single-branch case; proper
        # sizing needs a real tree walk)
        lines = [
            f"ROUTE auto_tree scene={scene_id}",
            f"  Heads: {len(heads)}",
            f"  Riser: {riser.id} @ ({riser.x:.0f}, {riser.y:.0f}, {riser.z:.0f}) cm",
            f"  Segments (MST): {len(segments)}",
            f"  Total pipe length: {total_len_cm / 100:.2f}m ({total_len_cm / 30.48:.1f}ft)",
            f"  Min pipe size for {len(heads)} heads ({schedule}):"
            f" {_pipe_size_for_head_count(len(heads), schedule)}in"
            f" [NFPA 13-2022 §28.5 pipe schedule method]",
            "",
            "Segments (first 20):",
        ]
        for s in segments[:20]:
            lines.append(
                f"  {s.from_id} → {s.to_id:<10}  {s.length_cm:7.1f}cm  "
                f"({s.length_ft:.2f}ft)"
            )
        if len(segments) > 20:
            lines.append(f"  ... {len(segments) - 20} more")
        lines.append("")
        lines.append(
            "[auto_tree is a Prim's MST first-cut — does not route through "
            "joists or around obstructions. M3 adds obstruction-aware "
            "routing + joist-parallel preference.]"
        )
        return "\n".join(lines)

    if mode in ("auto_loop", "auto_grid"):
        return (
            f"ROUTE {mode} (M3 scope): gridded systems (§28.7 / 28.8) use a "
            f"combination of mains + feed mains + cross mains + branch lines "
            f"with multiple flow paths. Implementation M3 week 19-20 once "
            f"the base tree router + hydraulic calc are stable."
        )

    return f"unknown mode: {mode}"


register(
    Tool(
        name="halofire_route_pipe",
        description=(
            "Pipe network routing + basic sizing. M1 ships: manual_segment "
            "(measure a user-drawn run) and auto_tree (Prim's MST from riser "
            "to all heads with pipe-schedule sizing per NFPA 13 §28.5). "
            "M3 adds auto_loop + auto_grid + obstruction-aware routing."
        ),
        input_schema=INPUT_SCHEMA,
        invoke=invoke,
    )
)

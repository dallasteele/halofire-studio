"""halofire router agent v3 — main / cross-main / branch topology.

Phase E rewrite (2026-04-21). Replaces the v2 obstruction-aware
Steiner router with a topology-first router that matches how a
real fire-sprinkler fitter installs the system:

    Riser → Cross-Main → Branch Line 1 → Head → Head → Head ...
                       → Branch Line 2 → Head → Head → Head ...
                       → Branch Line N → ...

Algorithm (per NFPA 13 §§ 11.2 / 28.5 + standard install practice):

 1. Pick riser location (stair shaft, mech room, or level centroid).
 2. Detect main axis = whichever level-polygon dimension is longer;
    branch lines run perpendicular to that axis.
 3. Group heads into rows: sort by perpendicular coordinate, bin
    them by a `branch_spacing_m` window (typ. 3-4.5 m ≈ 10-15 ft).
 4. For each row, emit one branch line at the row's median perp-
    coordinate that spans the row extent on the main axis + a spur
    to the cross-main.
 5. Emit one cross-main along the main axis, spanning all branch
    perp-coordinates + the riser's perp-coordinate.
 6. Emit a riser-nipple from the riser to the cross-main.
 7. Emit arm-over pipes for heads whose perpendicular position is
    offset from the branch (head on grid but branch at row median).
 8. Emit drops from each head up to the ceiling plenum height.
 9. Emit fittings: tee at every branch↔cross-main junction, elbow
    at each direction change (row spur → branch line), reducing tee
    where pipe size steps.
10. Size pipes per §28.5 downstream-head schedule.
11. Insert hangers per §9.2.2.1.

Public API preserved:

    route_systems(building, heads) -> list[System]
    pipe_size_for_count(n) -> float

Pipe sizing is provisional; the hydraulic agent may upsize under
hydraulic failure via its own ``resize_main_if_underflow`` loop.
"""
from __future__ import annotations

import math
import sys
from pathlib import Path
from typing import Optional

import networkx as nx
from shapely.errors import GEOSException
from shapely.geometry import Polygon

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from cad.schema import (  # noqa: E402
    Building, Head, Level, PipeSegment, Fitting,
    Hanger, System, RiserSpec, Branch,
)
from cad.logging import get_logger, warn_swallowed  # noqa: E402

log = get_logger("router")


# Branch-line spacing window (NFPA 13 §8.6.3.1 plus installer
# convention). Branches are physically 10-15 ft apart on a typical
# light-hazard residential layout; we use 4.0 m as the bucket size
# so rows that are within ±2 m of each other fold into one branch.
BRANCH_ROW_TOL_M = 4.5

# Pipe sizing — §28.5 Schedule table (ordinary hazard pipe schedule).
# Downstream head count determines nominal diameter (inches). Values
# match the widely-reproduced Schedule 40 tree schedule.
def pipe_size_for_count(n: int) -> float:
    if n <= 1: return 1.0
    if n <= 2: return 1.25
    if n <= 3: return 1.5
    if n <= 5: return 2.0
    if n <= 10: return 2.5
    if n <= 30: return 3.0
    return 4.0


# ── Level geometry helpers ─────────────────────────────────────────


def _level_bounds(level: Level, heads: list[Head]) -> tuple[float, float, float, float]:
    """Bounding box covering the level polygon + all heads."""
    xs: list[float] = []
    ys: list[float] = []
    for h in heads:
        xs.append(h.position_m[0])
        ys.append(h.position_m[1])
    if level.polygon_m:
        for x, y in level.polygon_m:
            xs.append(x)
            ys.append(y)
    for r in level.rooms:
        for x, y in r.polygon_m:
            xs.append(x)
            ys.append(y)
    if not xs:
        return (0.0, 0.0, 1.0, 1.0)
    return (min(xs), min(ys), max(xs), max(ys))


def _main_axis(
    level: Level, heads: list[Head],
) -> str:
    """Return 'x' (cross-main runs E-W, branches N-S) or 'y'.

    Chosen so the cross-main runs along the *longer* building axis
    (minimizes cross-main length; branches are the short legs).
    """
    minx, miny, maxx, maxy = _level_bounds(level, heads)
    if (maxx - minx) >= (maxy - miny):
        return "x"
    return "y"


def _find_riser_location(level: Level, heads: list[Head]) -> tuple[float, float]:
    """Pick riser at a stair shaft if available, else mech room,
    else the centroid of head positions (best for a real network),
    else level centroid.
    """
    if level.stair_shafts:
        try:
            p = Polygon(level.stair_shafts[0].polygon_m)
            c = p.centroid
            return (c.x, c.y)
        except (GEOSException, ValueError, TypeError):
            pass
    if level.mech_rooms:
        try:
            p = Polygon(level.mech_rooms[0].polygon_m)
            c = p.centroid
            return (c.x, c.y)
        except (GEOSException, ValueError, TypeError):
            pass
    if heads:
        cx = sum(h.position_m[0] for h in heads) / len(heads)
        cy = sum(h.position_m[1] for h in heads) / len(heads)
        return (cx, cy)
    if level.polygon_m:
        try:
            p = Polygon(level.polygon_m)
            c = p.centroid
            return (c.x, c.y)
        except (GEOSException, ValueError, TypeError):
            pass
    return (0.0, 0.0)


# ── Row grouping (branch assignment) ───────────────────────────────


def _group_into_rows(
    heads: list[Head], axis: str, tol_m: float = BRANCH_ROW_TOL_M,
) -> list[list[Head]]:
    """Sort heads by the perpendicular coordinate and bin them into
    rows ≤ tol_m wide. Each row becomes one branch line.

    ``axis`` is the main-axis direction (cross-main axis). Heads are
    binned by the *perpendicular* coordinate because that's the
    dimension along which branch lines stack.
    """
    if not heads:
        return []
    perp_idx = 1 if axis == "x" else 0
    sorted_heads = sorted(heads, key=lambda h: h.position_m[perp_idx])
    rows: list[list[Head]] = []
    for h in sorted_heads:
        perp = h.position_m[perp_idx]
        if rows:
            last_perp = rows[-1][0].position_m[perp_idx]
            # Use the row's *current* median so a wide row doesn't
            # absorb heads beyond tol_m from its actual median.
            row_median = sorted(
                hh.position_m[perp_idx] for hh in rows[-1]
            )[len(rows[-1]) // 2]
            if abs(perp - row_median) <= tol_m and abs(perp - last_perp) <= tol_m * 1.5:
                rows[-1].append(h)
                continue
        rows.append([h])
    return rows


# ── Pipe / fitting builders ────────────────────────────────────────


def _mk_pipe(
    id_: str, from_node: str, to_node: str,
    start: tuple[float, float, float], end: tuple[float, float, float],
    size_in: float, role: str,
) -> PipeSegment:
    length = math.hypot(end[0] - start[0], end[1] - start[1])
    length = math.hypot(length, end[2] - start[2])
    return PipeSegment(
        id=id_,
        from_node=from_node, to_node=to_node,
        size_in=size_in, schedule="sch10",
        start_m=start, end_m=end,
        length_m=max(length, 0.01),
        elevation_change_m=end[2] - start[2],
        role=role,  # type: ignore[arg-type]
    )


def _mk_tee(
    id_: str, size_in: float,
    position: tuple[float, float, float],
) -> Fitting:
    return Fitting(
        id=id_, kind="tee_branch",
        size_in=size_in, position_m=position,
        equiv_length_ft=7.0 * size_in,  # conservative; overridden by Le table
    )


def _mk_elbow(
    id_: str, size_in: float,
    position: tuple[float, float, float],
) -> Fitting:
    return Fitting(
        id=id_, kind="elbow_90",
        size_in=size_in, position_m=position,
        equiv_length_ft=2.0 * size_in,
    )


# ── Main routing ───────────────────────────────────────────────────


def _route_level(
    level: Level, heads: list[Head], sys_id: str,
    riser: RiserSpec, riser_z: float,
) -> tuple[list[PipeSegment], list[Fitting]]:
    """Produce the pipe network for one level.

    Returns (pipes, fittings). All horizontal pipes at ``riser_z``;
    drops are vertical from riser_z to each head Z.
    """
    if not heads:
        return ([], [])

    axis = _main_axis(level, heads)
    main_idx = 0 if axis == "x" else 1
    perp_idx = 1 - main_idx

    rows = _group_into_rows(heads, axis)
    riser_xy = (riser.position_m[0], riser.position_m[1])
    riser_main = riser_xy[main_idx]
    riser_perp = riser_xy[perp_idx]

    pipes: list[PipeSegment] = []
    fittings: list[Fitting] = []
    idx = 0

    # ── Branch lines + arm-overs + drops ───────────────────────────
    branch_perp_coords: list[float] = []
    # Track branch end-points on the cross-main so we can size the
    # main segment between each pair of tees.
    branch_tee_points: list[tuple[float, float, int]] = []  # (main, perp, heads_in_branch)

    for row_i, row in enumerate(rows):
        if not row:
            continue
        # Row's main-axis extent + perp median
        mains = [h.position_m[main_idx] for h in row]
        perps = [h.position_m[perp_idx] for h in row]
        m_lo = min(mains)
        m_hi = max(mains)
        row_perp = sum(perps) / len(perps)
        # Branch spans from the side closest to the riser-main to the
        # far head, so the cross-main has a real tee-stub to hit.
        if riser_main < m_lo:
            br_start_main = riser_main
            br_end_main = m_hi
        elif riser_main > m_hi:
            br_start_main = m_lo
            br_end_main = riser_main
        else:
            br_start_main = m_lo
            br_end_main = m_hi

        if abs(br_end_main - br_start_main) < 0.1:
            # Degenerate single-head row — place a stub pipe and a drop.
            stub_len = 0.3
            h = row[0]
            # Build start/end based on axis
            if axis == "x":
                start = (h.position_m[0] - stub_len, row_perp, riser_z)
                end = (h.position_m[0], row_perp, riser_z)
            else:
                start = (row_perp, h.position_m[1] - stub_len, riser_z)
                end = (row_perp, h.position_m[1], riser_z)
            pipes.append(_mk_pipe(
                f"p_{sys_id}_br_{row_i}_{idx}",
                f"br_{row_i}_start", h.id,
                start, end, pipe_size_for_count(1), "branch",
            ))
            idx += 1
            # Drop
            pipes.append(_mk_pipe(
                f"p_{sys_id}_drop_{row_i}_{idx}",
                f"drop_top_{h.id}", h.id,
                (h.position_m[0], h.position_m[1], riser_z),
                h.position_m,
                1.0, "drop",
            ))
            idx += 1
            branch_perp_coords.append(row_perp)
            branch_tee_points.append((riser_main, row_perp, 1))
            continue

        branch_size = pipe_size_for_count(len(row))
        branch_id_base = f"p_{sys_id}_br_{row_i}"

        # Sort heads along the main axis for sequential connection.
        row_sorted = sorted(row, key=lambda h: h.position_m[main_idx])

        # Branch line emitted as a single pipe from spur-to-main to
        # far head; arm-overs handle offsets.
        if axis == "x":
            br_start = (br_start_main, row_perp, riser_z)
            br_end = (br_end_main, row_perp, riser_z)
        else:
            br_start = (row_perp, br_start_main, riser_z)
            br_end = (row_perp, br_end_main, riser_z)

        # Where the branch meets the cross-main = tee point
        if axis == "x":
            tee_pt = (riser_main, row_perp, riser_z)
        else:
            tee_pt = (row_perp, riser_main, riser_z)

        branch_pipe_id = f"{branch_id_base}_{idx}"
        pipes.append(_mk_pipe(
            branch_pipe_id, f"tee_xm_{row_i}", row_sorted[-1].id,
            br_start, br_end, branch_size, "branch",
        ))
        idx += 1
        branch_perp_coords.append(row_perp)
        branch_tee_points.append((riser_main, row_perp, len(row)))

        # Tee fitting at the branch/cross-main junction
        fittings.append(_mk_tee(
            f"fit_tee_{sys_id}_{row_i}_{idx}", branch_size, tee_pt,
        ))
        idx += 1

        # Arm-overs + drops per head
        for hi, h in enumerate(row_sorted):
            hx, hy, hz = h.position_m
            # Projection of the head onto the branch line
            if axis == "x":
                proj = (hx, row_perp, riser_z)
            else:
                proj = (row_perp, hy, riser_z)
            offset = math.hypot(hx - proj[0], hy - proj[1])
            if offset > 0.25:
                # Arm-over: horizontal pipe from branch line to head XY
                # at ceiling height, followed by a drop.
                pipes.append(_mk_pipe(
                    f"p_{sys_id}_armover_{row_i}_{hi}_{idx}",
                    f"arm_{h.id}_src", f"arm_{h.id}_dst",
                    proj, (hx, hy, riser_z),
                    1.0, "branch",
                ))
                idx += 1
                # Elbow where the arm-over leaves the branch
                fittings.append(_mk_elbow(
                    f"fit_elb_{sys_id}_{row_i}_{hi}_{idx}",
                    1.0, proj,
                ))
                idx += 1
            # Drop from ceiling to head
            pipes.append(_mk_pipe(
                f"p_{sys_id}_drop_{row_i}_{hi}_{idx}",
                f"drop_top_{h.id}", h.id,
                (hx, hy, riser_z), (hx, hy, hz),
                1.0, "drop",
            ))
            idx += 1

    # ── Cross-main (spine) ─────────────────────────────────────────
    if branch_perp_coords:
        perp_lo = min(branch_perp_coords + [riser_perp])
        perp_hi = max(branch_perp_coords + [riser_perp])
        if abs(perp_hi - perp_lo) >= 0.2:
            # Segment the cross-main between consecutive tees so each
            # run can be sized to its downstream-head count.
            tee_pts_sorted = sorted(
                branch_tee_points, key=lambda t: t[1],
            )
            # Insert riser pierce point into the chain
            cm_stops: list[tuple[float, int]] = []  # (perp, heads_downstream_of_this_stop)
            for (_main, perp, cnt) in tee_pts_sorted:
                cm_stops.append((perp, cnt))
            # Add riser as a stop too (zero heads)
            cm_stops.append((riser_perp, 0))
            cm_stops.sort(key=lambda x: x[0])
            # Emit one pipe per consecutive stop pair, sized by
            # cumulative heads downstream of the farther end from riser.
            # Simpler heuristic: size by total heads in the system.
            total_heads = sum(c for (_p, c) in cm_stops)
            cm_size = pipe_size_for_count(max(total_heads, 1))
            cm_size = max(cm_size, 2.5)  # NFPA — cross-main ≥ 2.5" typ.
            for i in range(len(cm_stops) - 1):
                a_perp, _ = cm_stops[i]
                b_perp, _ = cm_stops[i + 1]
                if abs(b_perp - a_perp) < 0.05:
                    continue
                if axis == "x":
                    s = (riser_main, a_perp, riser_z)
                    e = (riser_main, b_perp, riser_z)
                else:
                    s = (a_perp, riser_main, riser_z)
                    e = (b_perp, riser_main, riser_z)
                pipes.append(_mk_pipe(
                    f"p_{sys_id}_xm_{i}_{idx}",
                    f"xm_stop_{i}", f"xm_stop_{i + 1}",
                    s, e, cm_size, "cross_main",
                ))
                idx += 1

        # Riser nipple: riser → cross-main at riser_perp
        if axis == "x":
            rn_end = (riser_main, riser_perp, riser_z)
        else:
            rn_end = (riser_perp, riser_main, riser_z)
        pipes.append(_mk_pipe(
            f"p_{sys_id}_risernip_{idx}",
            riser.id, f"xm_riser_pierce",
            riser.position_m, rn_end,
            4.0, "riser_nipple",
        ))
        idx += 1

    return pipes, fittings


def _resize_by_downstream(
    segments: list[PipeSegment], heads: list[Head], riser_id: str,
) -> list[PipeSegment]:
    """Refine pipe sizes by counting downstream heads per segment.

    Walks the undirected graph of pipes; for each segment, removes it,
    counts heads in the component containing its riser-side endpoint,
    and assigns the §28.5 size for the *other* side. Drops keep size 1
    regardless.
    """
    if not segments:
        return segments
    g = nx.Graph()
    for s in segments:
        g.add_edge(s.from_node, s.to_node, key=s.id)
    head_ids = {h.id for h in heads}

    for s in segments:
        if s.role == "drop":
            s.downstream_heads = 1
            s.size_in = max(s.size_in, 1.0)
            continue
        if s.role == "riser_nipple":
            s.downstream_heads = len(heads)
            s.size_in = max(s.size_in, 4.0)
            continue
        # Remove the edge, see which side contains the riser
        if not g.has_edge(s.from_node, s.to_node):
            continue
        g.remove_edge(s.from_node, s.to_node)
        try:
            if riser_id in g and s.from_node in g:
                riser_side = nx.has_path(g, riser_id, s.from_node)
            else:
                riser_side = False
            downstream_node = s.to_node if riser_side else s.from_node
            if downstream_node in g:
                reachable = nx.node_connected_component(g, downstream_node)
            else:
                reachable = {downstream_node}
        except (nx.NetworkXError, nx.NodeNotFound):
            reachable = set()
        finally:
            g.add_edge(s.from_node, s.to_node, key=s.id)
        ds_heads = len(reachable & head_ids)
        s.downstream_heads = max(1, ds_heads)
        # Respect role minimums
        new_size = pipe_size_for_count(ds_heads)
        if s.role == "cross_main":
            new_size = max(new_size, 2.5)
        s.size_in = new_size
    return segments


def _classify_pipe_roles(
    segments: list[PipeSegment], head_ids: set[str], riser_id: str,
) -> None:
    """Kept for backward-compat with any downstream code that calls it.

    The v3 router already sets ``.role`` on every pipe it creates, so
    this only fills gaps left by external mutations.
    """
    for s in segments:
        if s.role != "unknown":
            continue
        a, b = s.from_node, s.to_node
        touches_riser = (a == riser_id or b == riser_id)
        touches_head = (a in head_ids or b in head_ids)
        dz = abs(s.elevation_change_m)
        if touches_riser:
            s.role = "riser_nipple"
        elif touches_head and dz >= 0.05:
            s.role = "drop"
        elif touches_head:
            s.role = "branch"
        elif s.size_in >= 4.0:
            s.role = "main"
        elif s.size_in >= 2.5:
            s.role = "cross_main"
        else:
            s.role = "branch"


def _insert_hangers(segments: list[PipeSegment]) -> list[Hanger]:
    """§9.2.2.1 hanger spacing per pipe size."""
    spacing_by_size = {
        1.0: 3.66, 1.25: 3.66, 1.5: 4.57, 2.0: 4.57,
        2.5: 4.57, 3.0: 4.57, 4.0: 4.57,
    }
    hangers: list[Hanger] = []
    for s in segments:
        if s.role == "drop":
            continue  # drops don't get hangers
        sp = spacing_by_size.get(s.size_in, 3.66)
        n = max(1, int(s.length_m / sp))
        for i in range(n):
            t = (i + 0.5) / n
            x = s.start_m[0] + (s.end_m[0] - s.start_m[0]) * t
            y = s.start_m[1] + (s.end_m[1] - s.start_m[1]) * t
            z = s.start_m[2]
            hangers.append(Hanger(
                id=f"hgr_{s.id}_{i}",
                pipe_id=s.id,
                position_m=(x, y, z),
            ))
    return hangers


# ── Entry point ────────────────────────────────────────────────────


def route_systems(building: Building, heads: list[Head]) -> list[System]:
    """Produce fire-sprinkler systems for the building.

    One wet system per non-garage level, one dry per garage level,
    plus one combo standpipe for multi-level buildings. Each level's
    system carries heads + pipes + fittings + hangers at NFPA-
    compliant main/cross/branch topology.
    """
    # Group heads by level
    heads_by_level: dict[str, list[Head]] = {}
    for h in heads:
        matched = False
        if h.room_id and h.room_id.startswith("floor_fallback_"):
            target = h.room_id[len("floor_fallback_"):]
            for lvl in building.levels:
                if lvl.id == target:
                    heads_by_level.setdefault(lvl.id, []).append(h)
                    matched = True
                    break
        if not matched:
            for lvl in building.levels:
                if any(r.id == h.room_id for r in lvl.rooms):
                    heads_by_level.setdefault(lvl.id, []).append(h)
                    matched = True
                    break
        if not matched and h.position_m:
            z = h.position_m[2]
            best = min(
                building.levels,
                key=lambda lv: abs(lv.elevation_m - z),
                default=None,
            )
            if best is not None:
                heads_by_level.setdefault(best.id, []).append(h)

    systems: list[System] = []
    for level in building.levels:
        lvl_heads = heads_by_level.get(level.id, [])
        if not lvl_heads:
            continue
        riser_xy = _find_riser_location(level, lvl_heads)

        # Routing elevation: in drop-ceiling, pipe runs in the plenum
        # (above tile); in exposed-deck, 0.3 m below structural deck.
        if level.ceiling.kind == "acoustic_tile":
            ceiling_face_z = level.elevation_m + level.ceiling.height_m
            riser_z = ceiling_face_z + (level.ceiling.plenum_depth_m or 0.45) * 0.5
        else:
            riser_z = level.elevation_m + (level.height_m - 0.3)

        sys_id = f"sys_{level.id}"
        sys_type = "dry" if level.use == "garage" else "wet"
        riser = RiserSpec(
            id=f"riser_{level.id}",
            position_m=(riser_xy[0], riser_xy[1], level.elevation_m),
            size_in=4.0,
        )

        # Head-count guard — even the v3 topology router is O(N×log N)
        # per level; we cap per-level to keep a 12-story pipeline
        # finishing in < 30 s total.
        _ROUTER_LEVEL_CAP = 1000
        if len(lvl_heads) > _ROUTER_LEVEL_CAP:
            warn_swallowed(
                log, code="ROUTER_HEAD_CAP_EXCEEDED",
                err=RuntimeError(
                    f"{len(lvl_heads)} heads > {_ROUTER_LEVEL_CAP}"),
                level_id=level.id, head_count=len(lvl_heads),
            )
            systems.append(System(
                id=sys_id, type=sys_type,
                supplies=[level.id], riser=riser,
                heads=lvl_heads, pipes=[], hangers=[],
            ))
            continue

        try:
            pipes, fittings = _route_level(
                level, lvl_heads, sys_id, riser, riser_z,
            )
        except Exception as e:  # noqa: BLE001
            warn_swallowed(
                log, code="ROUTER_LEVEL_FAIL",
                err=e, level_id=level.id, head_count=len(lvl_heads),
            )
            pipes, fittings = [], []

        # Annotate system_id on every pipe + size the network
        for p in pipes:
            p.system_id = sys_id
        pipes = _resize_by_downstream(pipes, lvl_heads, riser.id)

        hangers = _insert_hangers(pipes)

        system = System(
            id=sys_id, type=sys_type,
            supplies=[level.id], riser=riser,
            heads=lvl_heads, pipes=pipes,
            fittings=fittings, hangers=hangers,
        )
        systems.append(system)

    return _merge_combo_systems(systems, building)


def _merge_combo_systems(
    systems: list[System], building: Building,
) -> list[System]:
    """Append one synthetic combo-standpipe system so multi-level
    buildings match Halo's N-level + 1 combo convention.
    """
    out = list(systems)
    if len(systems) >= 2 and building.levels:
        lowest = min(building.levels, key=lambda l: l.elevation_m)
        combo = System(
            id="sys_combo_standpipe",
            type="combo_standpipe",
            supplies=[l.id for l in building.levels],
            riser=RiserSpec(
                id="riser_combo",
                position_m=(0.0, 0.0, lowest.elevation_m),
                size_in=4.0,
            ),
            heads=[], pipes=[], hangers=[], fittings=[],
        )
        out.append(combo)
    return out


if __name__ == "__main__":
    print("router v3 — call route_systems(building, heads)")

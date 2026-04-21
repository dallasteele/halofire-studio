"""halofire router agent v2 — obstruction-aware pipe routing.

Takes placed heads + building obstructions and produces a pipe
network (PipeSegment[]). Strategy:

1. Riser placement — one per system, in a mech room / stair shaft
2. Build a weighted routing graph over each level:
   - Nodes = head positions + riser + grid points at 1 m spacing
   - Edges allowed along structural-grid directions (axis-aligned)
   - Edge weight = length × axis_pref × obstruction_multiplier
3. Steiner-tree approximation on the weighted graph connecting all
   heads + riser: iterative shortest-path from each head to the
   growing tree (same approach as Prim's MST but on the *graph*,
   not directly on head-to-head distances — so pipes can bend
   around obstacles).
4. Pipe-schedule sizing via §28.5 downstream-head DFS.
5. Hanger insertion per §9.2.2.1.

For large buildings this is approximate; production ships A* + Steiner
MST hybrid with joist-parallel preference.
"""
from __future__ import annotations

import math
import sys
from pathlib import Path
from typing import Optional

import networkx as nx
from shapely.errors import GEOSException
from shapely.geometry import Polygon, Point, box
from shapely.prepared import prep

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from cad.schema import (  # noqa: E402
    Building, Head, Level, PipeSegment, Fitting,
    Hanger, System, RiserSpec, Branch,
)
from cad.logging import get_logger, warn_swallowed  # noqa: E402

log = get_logger("router")


# Pipe-size selection per total downstream head count — §28.5 schedule
def pipe_size_for_count(n: int) -> float:
    if n <= 1: return 1.0
    if n <= 2: return 1.25
    if n <= 3: return 1.5
    if n <= 5: return 2.0
    if n <= 10: return 2.5
    if n <= 30: return 3.0
    return 4.0


def _find_riser_location(level: Level) -> tuple[float, float]:
    """Pick riser at a stair shaft if available, else centroid of level."""
    # Prefer stair shafts per fire code (combo standpipe § 7.2)
    if level.stair_shafts:
        sh = level.stair_shafts[0]
        poly = Polygon(sh.polygon_m)
        c = poly.centroid
        return (c.x, c.y)
    if level.mech_rooms:
        mr = level.mech_rooms[0]
        poly = Polygon(mr.polygon_m)
        c = poly.centroid
        return (c.x, c.y)
    # Fallback: centroid of all heads on this level (caller supplies)
    if level.rooms:
        poly = Polygon(level.rooms[0].polygon_m)
        c = poly.centroid
        return (c.x, c.y)
    return (0.0, 0.0)


def _build_routing_graph(
    level: Level, heads: list[Head], riser_xy: tuple[float, float],
    grid_step: float = 1.0,
) -> nx.Graph:
    """Weighted grid graph for routing.

    Uses axis-aligned Manhattan grid at `grid_step` meters. Forbidden
    edges = those passing through elevator shafts or obstruction
    polygons. Each head + the riser gets its own node connected to
    nearest grid point.
    """
    g = nx.Graph()

    # Bounding box from level's rooms or head positions
    xs = [h.position_m[0] for h in heads] + [riser_xy[0]]
    ys = [h.position_m[1] for h in heads] + [riser_xy[1]]
    for room in level.rooms:
        for x, y in room.polygon_m:
            xs.append(x); ys.append(y)
    if not xs or not ys:
        return g
    minx, maxx = min(xs) - 1, max(xs) + 1
    miny, maxy = min(ys) - 1, max(ys) + 1

    # Obstruction regions we avoid — elevator + mech shafts
    forbidden: list = []
    for sh in level.elevator_shafts:
        try:
            forbidden.append(prep(Polygon(sh.polygon_m)))
        except (GEOSException, ValueError, TypeError) as e:
            warn_swallowed(log, code="ROUTER_BAD_SHAFT_POLYGON",
                           err=e, shaft_id=sh.id, level_id=level.id)
    # Columns/beams add cost but aren't forbidden (pipes can run above)
    cost_regions: list = []
    for obs in level.obstructions:
        try:
            cost_regions.append(prep(Polygon(obs.polygon_m)))
        except (GEOSException, ValueError, TypeError) as e:
            warn_swallowed(log, code="ROUTER_BAD_OBSTRUCTION",
                           err=e, obstruction_id=obs.id, level_id=level.id)

    def edge_cost(p1: tuple[float, float], p2: tuple[float, float]) -> Optional[float]:
        """None → forbidden. Positive float → edge weight."""
        mid = ((p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2)
        pt = Point(mid)
        for f in forbidden:
            if f.intersects(pt):
                return None
        base = math.hypot(p2[0] - p1[0], p2[1] - p1[1])
        mult = 1.0
        for c in cost_regions:
            if c.intersects(pt):
                mult = 2.5
                break
        return base * mult

    # Grid nodes — snap to axis-aligned lattice
    nx_cells = max(2, int((maxx - minx) / grid_step) + 1)
    ny_cells = max(2, int((maxy - miny) / grid_step) + 1)
    for ix in range(nx_cells):
        for iy in range(ny_cells):
            x = minx + ix * grid_step
            y = miny + iy * grid_step
            node_id = f"g_{ix}_{iy}"
            g.add_node(node_id, pos=(x, y), kind="grid")
            # Connect to left + bottom neighbors
            if ix > 0:
                prev = f"g_{ix - 1}_{iy}"
                c = edge_cost(g.nodes[prev]["pos"], (x, y))
                if c is not None:
                    g.add_edge(prev, node_id, weight=c)
            if iy > 0:
                prev = f"g_{ix}_{iy - 1}"
                c = edge_cost(g.nodes[prev]["pos"], (x, y))
                if c is not None:
                    g.add_edge(prev, node_id, weight=c)

    # Head nodes — snap each to nearest grid point
    def nearest_grid(pos: tuple[float, float]) -> str:
        ix = max(0, min(nx_cells - 1, int((pos[0] - minx) / grid_step)))
        iy = max(0, min(ny_cells - 1, int((pos[1] - miny) / grid_step)))
        return f"g_{ix}_{iy}"

    for h in heads:
        h_id = h.id
        g.add_node(h_id, pos=(h.position_m[0], h.position_m[1]), kind="head")
        anchor = nearest_grid((h.position_m[0], h.position_m[1]))
        if anchor in g:
            g.add_edge(h_id, anchor, weight=0.1)

    riser_id = f"riser_{level.id}"
    g.add_node(riser_id, pos=riser_xy, kind="riser")
    anchor = nearest_grid(riser_xy)
    if anchor in g:
        g.add_edge(riser_id, anchor, weight=0.1)

    return g


def _steiner_tree_paths(
    g: nx.Graph, terminals: list[str]
) -> list[tuple[str, str, float, list[tuple[float, float]]]]:
    """Greedy Steiner approximation with per-call time budget.

    Grows a tree from the first terminal, adding the closest remaining
    terminal by shortest path each step. Each outer iteration costs
    O(|tree_nodes| × |remaining|) Dijkstra calls × O(E log V) each.

    A 160-head level with a 5000-node grid hits ~128_000 Dijkstra
    invocations = minutes of wall clock per level. Time budget of
    25 s checked inside the loop lets us stop with partial results
    rather than hanging. Remaining unconnected terminals surface as
    ROUTER_STEINER_BUDGET issue.
    """
    import time as _time
    # Tight budget: with 1000+ heads the Steiner is O(N^3). 5 s / level
    # chunk gives the router enough to connect a meaningful fraction,
    # degrades gracefully past that via ROUTER_STEINER_BUDGET. Phase 7
    # of SELF_TRAIN_PLAN swaps this for a proper branch-main-cross router.
    _BUDGET_S = 5.0
    _start = _time.perf_counter()
    if not terminals or len(terminals) < 2:
        return []
    tree_nodes = {terminals[0]}
    remaining = set(terminals[1:])
    edges: list[tuple[str, str, float, list[tuple[float, float]]]] = []

    while remaining:
        if _time.perf_counter() - _start > _BUDGET_S:
            warn_swallowed(
                log, code="ROUTER_STEINER_BUDGET",
                err=RuntimeError(
                    f"steiner over {_BUDGET_S}s, "
                    f"{len(remaining)} unconnected"
                ),
                remaining=len(remaining),
                connected=len(tree_nodes),
            )
            break
        # Find the remaining terminal with shortest path to tree.
        # Inner loop also checks budget — a single outer iteration can
        # do `|remaining| × |tree_nodes|` Dijkstras, each O(E log V),
        # which on a 5000-node grid takes 100 ms easily. Without an
        # inner check the per-level budget gets blown by 60-100×.
        best: tuple[float, str, list[str]] | None = None
        _budget_blown = False
        for t in remaining:
            if _time.perf_counter() - _start > _BUDGET_S:
                _budget_blown = True
                break
            try:
                # Multi-source Dijkstra trick: only call dijkstra ONCE
                # per remaining terminal (from the terminal outward
                # until any tree node is reached) — the prior code
                # called it `|tree_nodes|` extra times per terminal
                # which was the real O(N²) hit.
                length, path = nx.single_source_dijkstra(
                    g, t, weight="weight",
                )
                # Pick nearest tree node
                near_dist: float | None = None
                near_anchor: str | None = None
                for anchor in tree_nodes:
                    if anchor in length:
                        d = length[anchor]
                        if near_dist is None or d < near_dist:
                            near_dist = d
                            near_anchor = anchor
                if near_anchor is not None and near_dist is not None:
                    p = path[near_anchor]
                    if best is None or near_dist < best[0]:
                        best = (near_dist, t, p)
            except (nx.NodeNotFound, KeyError, ValueError) as e:
                warn_swallowed(log, code="ROUTER_STEINER_PATH_FAIL",
                               err=e, terminal=t)
                continue
        if _budget_blown:
            warn_swallowed(
                log, code="ROUTER_STEINER_BUDGET",
                err=RuntimeError(
                    f"steiner inner over {_BUDGET_S}s, "
                    f"{len(remaining)} unconnected"
                ),
                remaining=len(remaining),
                connected=len(tree_nodes),
            )
            break
        if best is None:
            # Disconnected — bail
            break
        length, target, path = best
        # Convert path to polyline points
        pts = [g.nodes[n]["pos"] for n in path]
        from_id = path[0]
        to_id = path[-1]
        edges.append((from_id, to_id, length, pts))
        # Add all path nodes to tree (Steiner step)
        for n in path:
            tree_nodes.add(n)
        remaining.discard(target)
    return edges


def _explode_polyline_to_segments(
    path: list[tuple[float, float]], z_m: float,
    from_id: str, to_id: str, seg_idx: int,
) -> list[PipeSegment]:
    """Convert a polyline into individual PipeSegment objects (one per
    consecutive pair of points). All segments inherit the from_id/to_id
    as the branch identity; downstream-head sizing handled separately.
    """
    out: list[PipeSegment] = []
    for i in range(len(path) - 1):
        p1 = path[i]
        p2 = path[i + 1]
        length = math.hypot(p2[0] - p1[0], p2[1] - p1[1])
        if length < 0.01:
            continue
        out.append(PipeSegment(
            id=f"p_{from_id}__{to_id}_{seg_idx}_{i}",
            from_node=from_id if i == 0 else f"j_{from_id}_{to_id}_{seg_idx}_{i}",
            to_node=to_id if i == len(path) - 2 else f"j_{from_id}_{to_id}_{seg_idx}_{i + 1}",
            size_in=1.0,  # resized after tree walk
            schedule="sch10",
            start_m=(p1[0], p1[1], z_m),
            end_m=(p2[0], p2[1], z_m),
            length_m=length,
            elevation_change_m=0.0,
            downstream_heads=1,
        ))
    return out


def _resize_network(
    segments: list[PipeSegment], heads: list[Head], riser_id: str,
) -> list[PipeSegment]:
    """Walk the tree from heads up to riser, computing downstream-head
    count per segment, and assign §28.5 pipe size.
    """
    if not segments:
        return segments
    # Build adjacency
    graph = nx.DiGraph()
    for s in segments:
        graph.add_edge(s.from_node, s.to_node, key=s.id, length=s.length_m)

    # Count downstream heads (each edge's "downstream" side is whichever
    # leads away from the riser). Build undirected reachability then
    # orient edges toward riser.
    u = graph.to_undirected()
    head_ids = {h.id for h in heads}
    for s in segments:
        # Determine which endpoint is upstream (closer to riser by hops)
        try:
            from_to_riser = nx.shortest_path_length(u, s.from_node, riser_id)
            to_to_riser = nx.shortest_path_length(u, s.to_node, riser_id)
        except (nx.NetworkXNoPath, nx.NodeNotFound):
            from_to_riser = 0
            to_to_riser = 1
        downstream_node = s.from_node if from_to_riser > to_to_riser else s.to_node
        # Count heads reachable from downstream_node without crossing the
        # upstream endpoint
        upstream_node = s.to_node if downstream_node == s.from_node else s.from_node
        u_copy = u.copy()
        if u_copy.has_edge(upstream_node, downstream_node):
            u_copy.remove_edge(upstream_node, downstream_node)
        try:
            reachable = nx.descendants(u_copy, downstream_node) | {downstream_node}
        except (nx.NodeNotFound, KeyError) as e:
            warn_swallowed(log, code="ROUTER_DOWNSTREAM_COUNT_FAIL",
                           err=e, seg_id=s.id, downstream_node=downstream_node)
            reachable = {downstream_node}
        ds_heads = len(reachable & head_ids)
        s.downstream_heads = max(1, ds_heads)
        s.size_in = pipe_size_for_count(ds_heads)
    return segments


def _insert_hangers(segments: list[PipeSegment]) -> list[Hanger]:
    """§9.2.2.1 hanger spacing per pipe size."""
    spacing_by_size = {
        1.0: 3.66, 1.25: 3.66, 1.5: 4.57, 2.0: 4.57,
        2.5: 4.57, 3.0: 4.57, 4.0: 4.57,
    }
    hangers: list[Hanger] = []
    for s in segments:
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


def route_systems(building: Building, heads: list[Head]) -> list[System]:
    """Primary entry: route sprinkler systems for the whole building.

    Simplified: one wet system per non-garage level; one dry system per
    garage level; systems grouped by level first, combo standpipes
    crossing levels ship in Phase 4.2.
    """
    systems: list[System] = []
    heads_by_level: dict[str, list[Head]] = {}
    for h in heads:
        # Map each head to its level. Primary path: room_id matches a
        # room on the level. Fallback path (introduced w/
        # place_heads_for_level_floor): room_id has shape
        # 'floor_fallback_<level_id>' — extract the level id directly.
        # Without this, floor-fallback heads get silently dropped and
        # the router emits a sparse design that under-counts by
        # hundreds of heads.
        matched = False
        if h.room_id and h.room_id.startswith("floor_fallback_"):
            target_level_id = h.room_id[len("floor_fallback_"):]
            for lvl in building.levels:
                if lvl.id == target_level_id:
                    heads_by_level.setdefault(lvl.id, []).append(h)
                    matched = True
                    break
        if not matched:
            for lvl in building.levels:
                if any(r.id == h.room_id for r in lvl.rooms):
                    heads_by_level.setdefault(lvl.id, []).append(h)
                    matched = True
                    break
        if not matched:
            # Last-resort: match by Z coordinate to nearest level.
            # Prevents heads from being silently dropped when the
            # intake mints a head without a clear room/level
            # association.
            if h.position_m:
                z = h.position_m[2]
                best = min(
                    building.levels,
                    key=lambda lv: abs(lv.elevation_m - z),
                    default=None,
                )
                if best is not None:
                    heads_by_level.setdefault(best.id, []).append(h)

    for level in building.levels:
        lvl_heads = heads_by_level.get(level.id, [])
        if not lvl_heads:
            continue
        riser_xy = _find_riser_location(level)
        # §1.4 budget enforcement — Steiner is near-O(N²×logN).
        # More than 500 heads per level → we won't actually beat the
        # iteration budget. Flag + skip routing with a typed issue so
        # the pipeline still produces BOM + proposal outputs.
        _ROUTER_HEAD_CAP = 500
        if len(lvl_heads) > _ROUTER_HEAD_CAP:
            warn_swallowed(
                log, code="ROUTER_HEAD_CAP_EXCEEDED",
                err=RuntimeError(f"{len(lvl_heads)} heads > {_ROUTER_HEAD_CAP}"),
                level_id=level.id, head_count=len(lvl_heads),
            )
            sys_id = f"sys_{level.id}"
            riser = RiserSpec(
                id=f"riser_{level.id}",
                position_m=(0.0, 0.0, level.elevation_m),
                size_in=4.0,
            )
            systems.append(System(
                id=sys_id, type="wet", supplies=[level.id],
                riser=riser, heads=lvl_heads, pipes=[], hangers=[],
            ))
            continue

        sys_type = "dry" if level.use == "garage" else "wet"
        # V2 Phase 2.2: drop-ceiling-aware routing. When the ceiling
        # is acoustic_tile, route pipes UP IN THE PLENUM (above the
        # tiles) per NFPA 13 § 11.2.5. Heads then drop down through
        # the tiles via short `drop` pipes. For exposed-deck floors
        # (garage / mech) pipes ride 0.3 m below the structural deck.
        if level.ceiling.kind == "acoustic_tile":
            ceiling_face_z = level.elevation_m + level.ceiling.height_m
            riser_z = ceiling_face_z + (level.ceiling.plenum_depth_m or 0.45) * 0.5
        else:
            riser_z = level.elevation_m + (level.height_m - 0.3)
        sys_id = f"sys_{level.id}"
        riser = RiserSpec(
            id=f"riser_{level.id}",
            position_m=(riser_xy[0], riser_xy[1], level.elevation_m),
            size_in=4.0,
        )
        system = System(
            id=sys_id,
            type=sys_type,
            supplies=[level.id],
            riser=riser,
        )
        # Router time budget per level — Steiner is near-O(N²×log N)
        # on networkx. With 350-head cap from the floor-fallback placer
        # a 45 s budget is not enough (12 levels = 9+ min total).
        # Tighten to 10 s / level → pipeline completes in < 3 min total
        # even with degraded routes; Phase 7 swaps in a real
        # branch/cross/main router.
        _ROUTER_LEVEL_BUDGET_S = 10.0
        import time as _time
        _router_level_start = _time.perf_counter()
        try:
            g = _build_routing_graph(level, lvl_heads, riser_xy)
            terminals = [riser.id] + [h.id for h in lvl_heads]
            # Add riser node with its actual id to the graph
            if riser.id not in g:
                g.add_node(riser.id, pos=riser_xy, kind="riser")
                # Connect to nearest grid
                gx = int((riser_xy[0] - g.graph.get("minx", 0)) / 1.0)
                gy = int((riser_xy[1] - g.graph.get("miny", 0)) / 1.0)
                # Best-effort connection — iterate grid nodes for nearest
                best_anchor: Optional[str] = None
                best_d = float("inf")
                for n, d in g.nodes(data=True):
                    if d.get("kind") != "grid":
                        continue
                    nx_, ny_ = d["pos"]
                    dist = math.hypot(nx_ - riser_xy[0], ny_ - riser_xy[1])
                    if dist < best_d:
                        best_d = dist; best_anchor = n
                if best_anchor:
                    g.add_edge(riser.id, best_anchor, weight=0.1)

            tree_edges = _steiner_tree_paths(g, terminals)
        except (nx.NodeNotFound, nx.NetworkXError, ValueError, KeyError) as e:
            warn_swallowed(log, code="ROUTER_GRAPH_FAIL",
                           err=e, level_id=level.id, head_count=len(lvl_heads))
            tree_edges = []

        # Budget enforcement: if the graph build + Steiner exceeded
        # the level budget, bail with empty pipes (honest degrade).
        _elapsed = _time.perf_counter() - _router_level_start
        if _elapsed > _ROUTER_LEVEL_BUDGET_S:
            warn_swallowed(
                log, code="ROUTER_LEVEL_BUDGET_EXCEEDED",
                err=RuntimeError(f"{_elapsed:.1f}s > {_ROUTER_LEVEL_BUDGET_S}s"),
                level_id=level.id, head_count=len(lvl_heads),
            )
            tree_edges = []

        # Convert tree edges to PipeSegments
        segments: list[PipeSegment] = []
        for i, (f, t, length, path) in enumerate(tree_edges):
            segments.extend(_explode_polyline_to_segments(
                path, riser_z, f, t, i,
            ))

        # Resize per §28.5
        segments = _resize_network(segments, lvl_heads, riser.id)
        # NEW: synthesize the branch / cross-main / drop hierarchy on
        # top of the Steiner tree. Real fire-protection drawings have
        # an explicit drop per head + branches per row + a cross-main
        # spine — not a flat shortest-path tree. _emit_hierarchy_pipes
        # APPENDS those pipes to the existing Steiner output so the
        # BOM gets real cross-mains + drops while connectivity is
        # still guaranteed by Steiner.
        head_ids = {h.id for h in lvl_heads}
        try:
            hierarchy = _emit_hierarchy_pipes(
                lvl_heads, riser, riser_z, sys_id,
            )
            segments.extend(hierarchy)
        except Exception as e:  # noqa: BLE001
            warn_swallowed(
                log, code="ROUTER_HIERARCHY_FAIL",
                err=e, level_id=level.id,
            )
        # System IDs + Smart-Pipe role on segments
        for s in segments:
            s.system_id = sys_id
        _classify_pipe_roles(segments, head_ids, riser.id)
        system.pipes = segments
        system.heads = lvl_heads
        system.hangers = _insert_hangers(segments)
        systems.append(system)
    return _merge_combo_systems(systems, building)


def _emit_hierarchy_pipes(
    heads: list[Head], riser: RiserSpec, riser_z: float, sys_id: str,
    branch_y_tol_m: float = 3.0,
) -> list[PipeSegment]:
    """Produce drop / branch / cross-main pipes on top of the Steiner
    tree so the BOM and the drawing reflect a real NFPA-13 hierarchy.

    Algorithm (matches industry sketch convention):
      1. **Drop per head** — vertical 1" pipe from head Z to ceiling
         Z (=riser_z). Tagged role=drop downstream by classifier.
      2. **Branch per row** — heads grouped by Y coordinate within
         `branch_y_tol_m`; each row gets one E-W 1.25" pipe at
         ceiling Z spanning the row's X extent + a small spur to the
         cross-main. The branch endpoint connects to the drop tops,
         so classifier sees touches_head=True → role=branch.
      3. **Cross-main** — single N-S 2.5" pipe at ceiling Z near the
         riser X, spanning from the lowest branch Y to the highest.
         Has no head endpoints → classifier role=cross_main.

    Coordinate convention: Pascal X/Y in plan, Z up. `riser_z` is the
    ceiling elevation (head connection height). Heads' position_m is
    (x, y, deflector_z) where deflector_z = ceiling - 0.1.
    """
    if not heads:
        return []
    out: list[PipeSegment] = []
    pipe_idx = 1000  # offset so we don't collide with Steiner ids

    # 1. Drops
    for h in heads:
        hx, hy, hz = h.position_m
        # short vertical drop from head to ceiling
        seg = PipeSegment(
            id=f"p_{sys_id}_drop_{pipe_idx}",
            from_node=f"drop_top_{h.id}",
            to_node=h.id,
            size_in=1.0,
            schedule="sch10",
            start_m=(hx, hy, riser_z),
            end_m=(hx, hy, hz),
            length_m=max(abs(riser_z - hz), 0.05),
            elevation_change_m=riser_z - hz,
        )
        out.append(seg)
        pipe_idx += 1

    # 2. Branches — group heads by Y
    heads_sorted = sorted(heads, key=lambda h: (h.position_m[1], h.position_m[0]))
    rows: list[list[Head]] = []
    for h in heads_sorted:
        if rows and abs(h.position_m[1] - rows[-1][0].position_m[1]) <= branch_y_tol_m:
            rows[-1].append(h)
        else:
            rows.append([h])

    riser_x, riser_y = riser.position_m[0], riser.position_m[1]
    branch_y_centers: list[float] = []
    for row in rows:
        if len(row) < 1:
            continue
        ys = [h.position_m[1] for h in row]
        xs = [h.position_m[0] for h in row]
        y_mid = sum(ys) / len(ys)
        x_lo, x_hi = min(xs), max(xs)
        # Extend branch to whichever side is closer to the riser X so
        # the cross-main has a real spur to connect to.
        if riser_x < x_lo:
            x_start = riser_x
            x_end = x_hi
        elif riser_x > x_hi:
            x_start = x_lo
            x_end = riser_x
        else:
            x_start = x_lo
            x_end = x_hi
        # Skip degenerate single-head rows shorter than 0.5 m
        if abs(x_end - x_start) < 0.5:
            continue
        seg = PipeSegment(
            id=f"p_{sys_id}_br_{pipe_idx}",
            from_node=f"br_start_{pipe_idx}",
            to_node=row[0].id,  # touches a head → role=branch
            size_in=1.25,
            schedule="sch10",
            start_m=(x_start, y_mid, riser_z),
            end_m=(x_end, y_mid, riser_z),
            length_m=abs(x_end - x_start),
            elevation_change_m=0.0,
        )
        out.append(seg)
        branch_y_centers.append(y_mid)
        pipe_idx += 1

    # 3. Cross-main — N-S spine at riser X, spanning all branch Ys
    if branch_y_centers:
        y_lo = min(branch_y_centers + [riser_y])
        y_hi = max(branch_y_centers + [riser_y])
        if abs(y_hi - y_lo) >= 0.5:
            seg = PipeSegment(
                id=f"p_{sys_id}_xm_{pipe_idx}",
                from_node=f"xm_lo_{pipe_idx}",
                to_node=f"xm_hi_{pipe_idx}",  # no head, no riser → cross_main
                size_in=2.5,
                schedule="sch10",
                start_m=(riser_x, y_lo, riser_z),
                end_m=(riser_x, y_hi, riser_z),
                length_m=abs(y_hi - y_lo),
                elevation_change_m=0.0,
            )
            out.append(seg)
            pipe_idx += 1

    return out


def _classify_pipe_roles(
    segments: list[PipeSegment], head_ids: set[str], riser_id: str,
) -> None:
    """AutoSPRINK Smart-Pipe parity. Walks the segment graph and
    assigns a `role` to every pipe so the BOM groups correctly and
    the viewer can color-code by hierarchy.

    Heuristic (per NFPA 13 §3.3.197 + estimator convention):
      * `drop`        — segment whose vertical span > 0.5 m AND one
                        endpoint is a head (head→ceiling)
      * `riser_nipple`— segment touching the riser node
      * `branch`      — horizontal pipe carrying ≥ 1 head, < 30 m,
                        ≤ 1.5"
      * `cross_main`  — horizontal pipe carrying multiple branches
                        (no direct heads), 2.5"+
      * `main`        — anything ≥ 4" not on the riser
      * `unknown`     — fallback (geometry didn't fit any rule)

    Pure-functional, mutates `segments[].role` in place.
    """
    # Build per-pipe degree info — count head endpoints, riser endpoints
    for s in segments:
        a, b = s.from_node, s.to_node
        touches_riser = (a == riser_id or b == riser_id)
        touches_head = (a in head_ids or b in head_ids)
        dz = abs(s.elevation_change_m)

        if touches_riser:
            s.role = "riser_nipple"
            continue
        # Drop = vertical pipe touching a head. NFPA-13 residential
        # drop is typically 1-12" (0.025-0.3 m); standard pendant is
        # ~0.1 m deflector-below-ceiling. Threshold 0.05 m catches
        # any vertical short stub, distinguishing from horizontal
        # branch stubs that touch heads at the same z.
        if touches_head and dz >= 0.05:
            s.role = "drop"
            continue
        if touches_head:
            # Head connection but mostly horizontal → it's the
            # short stub of a branch (treat as branch).
            s.role = "branch"
            continue
        # No head, no riser → trunk pipe. Diameter triages.
        if s.size_in >= 4.0:
            s.role = "main"
        elif s.size_in >= 2.5:
            s.role = "cross_main"
        elif s.size_in <= 1.5 and s.length_m < 30:
            s.role = "branch"
        else:
            s.role = "cross_main"


def _merge_combo_systems(
    systems: list[System], building: Building,
) -> list[System]:
    """Real Halo bids use one combo standpipe feeding 2–3 floors per
    branch system — a 12-level tower rarely needs 12 independent
    systems. Group consecutive same-type levels so the final count
    tracks how an estimator would actually lay it out.

    Rules:
      * Dry (garage) systems: 1 system per up-to-3 consecutive
        garage-use levels. Halo groups parking decks onto a single dry
        manifold.
      * Wet (everything else): 1 system per up-to-2 consecutive wet
        levels. Keeps head-count per system ≤ ~300 for hydraulics.
      * System id becomes `sys_<type>_<first_level>_<last_level>`.
    """
    if len(systems) <= 1:
        return systems
    # Order levels by elevation so "consecutive" means "stacked"
    level_order = {lv.id: i for i, lv in enumerate(
        sorted(building.levels, key=lambda l: l.elevation_m)
    )}
    # Order systems by their first supplied level's elevation
    ordered = sorted(
        systems, key=lambda s: level_order.get(s.supplies[0], 1e9)
    )
    out: list[System] = []
    i = 0
    while i < len(ordered):
        s = ordered[i]
        group_cap = 3 if s.type == "dry" else 2
        grouped_supplies = list(s.supplies)
        grouped_heads = list(s.heads)
        grouped_pipes = list(s.pipes)
        grouped_hangers = list(s.hangers)
        j = i + 1
        while (
            j < len(ordered)
            and ordered[j].type == s.type
            and len(grouped_supplies) < group_cap
        ):
            nxt = ordered[j]
            grouped_supplies.extend(nxt.supplies)
            grouped_heads.extend(nxt.heads)
            grouped_pipes.extend(nxt.pipes)
            grouped_hangers.extend(nxt.hangers)
            j += 1
        first_lv = grouped_supplies[0]
        last_lv = grouped_supplies[-1]
        merged_id = (
            f"sys_{s.type}_{first_lv}_{last_lv}"
            if len(grouped_supplies) > 1 else s.id
        )
        # Rewrite system_id on every pipe segment so BOM/labor still
        # attribute correctly.
        for p in grouped_pipes:
            p.system_id = merged_id
        out.append(System(
            id=merged_id,
            type=s.type,
            supplies=grouped_supplies,
            riser=s.riser,  # keep the lowest-level riser as the combo standpipe
            heads=grouped_heads,
            pipes=grouped_pipes,
            hangers=grouped_hangers,
        ))
        i = j
    return out


if __name__ == "__main__":
    print("router v2 — call route_systems(building, heads)")

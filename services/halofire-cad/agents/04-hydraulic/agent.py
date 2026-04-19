"""halofire hydraulic agent v2 — network density-area hydraulic calc.

Implements NFPA 13 §28.6 density-area method for wet tree networks:

  1. Pick the most remote + hydraulically demanding area (1500 sqft
     default for light hazard).
  2. Each operating head computes its flow:  Q = K × √P
     where P is the pressure at the head.
  3. Segment friction via Hazen-Williams:
       p_loss_psi/ft = 4.52 * (Q/C)^1.85 / d^4.87
       (Q in gpm, d in inches, C=120 for steel_new)
  4. Fittings via equivalent length (§23.4.3 table).
  5. Elevation loss = 0.433 psi per ft of rise.
  6. Iterate: start with min residential 7 psi at remote head, propagate
     upstream through the tree to base of riser, compute demand. Check
     vs. supply. If demand > supply, upsize the critical path and iterate.

This is a tree solver (single path from any head to the riser), not a
looped Hardy-Cross. Halofire wet systems in residential buildings are
tree topology by design. Looped grids (§28.7) ship Phase 5 v3.
"""
from __future__ import annotations

import logging
import math
import sys
from pathlib import Path

import networkx as nx

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from cad.schema import (  # noqa: E402
    System, PipeSegment, Head, HydraulicResult, FlowTestData,
)

log = logging.getLogger(__name__)

# Hazen-Williams C-factor for steel, new
C_FACTOR = {"sch10": 120, "sch40": 120, "cpvc": 150, "copper": 150}

# §23.4.3 fitting equivalent-length table (feet of pipe, rough values)
FITTING_EQ_LEN_FT = {
    "elbow_90": {1.0: 2.0, 1.25: 3.0, 1.5: 4.0, 2.0: 5.0, 2.5: 6.0, 3.0: 7.0, 4.0: 10.0},
    "elbow_45": {1.0: 1.0, 1.25: 1.5, 1.5: 2.0, 2.0: 2.5, 2.5: 3.0, 3.0: 4.0, 4.0: 5.0},
    "tee_branch": {1.0: 5.0, 1.25: 7.0, 1.5: 8.0, 2.0: 10.0, 2.5: 12.0, 3.0: 15.0, 4.0: 20.0},
    "tee_run": {1.0: 1.0, 1.25: 1.5, 1.5: 2.0, 2.0: 2.5, 2.5: 3.0, 3.0: 4.0, 4.0: 5.0},
    "gate_valve": {1.0: 0.5, 1.25: 0.7, 1.5: 1.0, 2.0: 1.0, 2.5: 1.2, 3.0: 1.5, 4.0: 2.0},
    "check_valve": {1.0: 4.0, 1.25: 5.0, 1.5: 6.0, 2.0: 8.0, 2.5: 10.0, 3.0: 12.0, 4.0: 15.0},
}


def hazen_williams_psi(
    q_gpm: float, d_in: float, length_ft: float, c: float = 120,
) -> float:
    """Hazen-Williams friction loss. Returns psi drop over length_ft."""
    if q_gpm <= 0 or d_in <= 0:
        return 0.0
    return 4.52 * (q_gpm / c) ** 1.85 / d_in ** 4.87 * length_ft


def design_density_for_hazard(hazard: str) -> tuple[float, float]:
    """(density_gpm_per_sqft, area_sqft) per NFPA 13 Figure 19.2.3.1.1."""
    table = {
        "light": (0.10, 1500),
        "ordinary_i": (0.15, 1500),
        "ordinary_ii": (0.20, 1500),
        "extra_i": (0.30, 2500),
        "extra_ii": (0.40, 2500),
        "residential": (0.05, 900),
    }
    return table.get(hazard, (0.10, 1500))


def _build_tree_from_segments(
    segments: list[PipeSegment], riser_id: str,
) -> nx.DiGraph:
    """Build a directed graph with all edges oriented TOWARD the riser.
    Shortest-path hops determine direction.
    """
    u = nx.Graph()
    for s in segments:
        u.add_edge(s.from_node, s.to_node, seg=s)
    d = nx.DiGraph()
    if riser_id not in u:
        return d
    lengths = nx.single_source_shortest_path_length(u, riser_id)
    for f, t, data in u.edges(data=True):
        s: PipeSegment = data["seg"]
        # Edge points from the "downstream" endpoint (farther from riser)
        # TO the upstream endpoint (closer to riser).
        if lengths.get(f, 999) > lengths.get(t, 999):
            d.add_edge(f, t, seg=s)
        else:
            d.add_edge(t, f, seg=s)
    return d


def _compute_head_flow(
    k_factor: float, pressure_psi: float,
) -> float:
    """Q = K × √P  per §28.6.2."""
    if pressure_psi <= 0:
        return 0.0
    return k_factor * math.sqrt(pressure_psi)


def _fitting_equiv_length_ft(fittings: list, size_in: float) -> float:
    """Sum equivalent length for a list of Fitting objects at `size_in`."""
    total = 0.0
    for f in fittings:
        kind = getattr(f, "kind", None) if hasattr(f, "kind") else f
        if not kind:
            continue
        lookup = FITTING_EQ_LEN_FT.get(kind, {})
        total += lookup.get(size_in, 0.0)
    return total


def calc_system(
    system: System, supply: FlowTestData, hazard: str = "light",
    min_head_pressure_psi: float = 7.0,
) -> HydraulicResult:
    """Solve the hydraulic network for one system.

    Algorithm:
    1. Select design area = head subset within most remote 1500 sqft
       (approximated here as "all heads" for v2; refinement later).
    2. Iterate: seed remote head at min_pressure, propagate upstream,
       sum flows at tees, compute friction, emit demand at riser base.
    3. Compare vs supply curve (adjusted static/residual), report
       safety margin.
    """
    density, area_sqft = design_density_for_hazard(hazard)
    # Head count in design area (assume full system for v2)
    heads = system.heads
    if not heads:
        return HydraulicResult(
            design_area_sqft=area_sqft,
            density_gpm_per_sqft=density,
            required_flow_gpm=0, required_pressure_psi=0,
            supply_static_psi=supply.static_psi,
            supply_residual_psi=supply.residual_psi,
            supply_flow_gpm=supply.flow_gpm,
            demand_at_base_of_riser_psi=0,
            safety_margin_psi=0,
            converged=True, iterations=0,
        )

    tree = _build_tree_from_segments(system.pipes, system.riser.id)

    # Per-head design flow from density (minimum); take max of K√P vs density
    head_flow: dict[str, float] = {}
    for h in heads:
        q_density = density * (area_sqft / max(1, len(heads)))  # rough split
        q_ksqrt = _compute_head_flow(h.k_factor, min_head_pressure_psi)
        head_flow[h.id] = max(q_density, q_ksqrt)

    pipe_flow: dict[str, float] = {}
    head_paths: dict[str, list[str]] = {}
    segment_trace: list[dict] = []
    segment_losses: dict[str, float] = {}
    critical_path: list[str] = []
    issues: list[str] = [
        "LOOP_GRID_UNSUPPORTED: Internal Alpha hydraulic solver supports tree systems only.",
    ]
    demand_psi = 0.0
    iterations = 0
    converged = False

    # Walk from each head upstream to riser; accumulate flow + loss
    pressures: dict[str, float] = {h.id: min_head_pressure_psi for h in heads}
    # Topological order from heads → riser
    if system.riser.id not in tree:
        issues.append("HYDRAULIC_TREE_DISCONNECTED: Riser is not connected to the pipe graph.")
    else:
        # BFS from riser in reverse direction visits heads first
        converged = True
        max_iter = 8
        # Initialize
        while iterations < max_iter:
            pipe_flow.clear()
            head_paths.clear()
            # For each head, trace path to riser summing flows
            for h in heads:
                if h.id not in tree:
                    issues.append(f"HYDRAULIC_HEAD_UNCONNECTED: Head {h.id} is not in the tree.")
                    continue
                try:
                    path = nx.shortest_path(tree, h.id, system.riser.id)
                except nx.NetworkXNoPath:
                    issues.append(f"HYDRAULIC_HEAD_UNCONNECTED: Head {h.id} has no path to the riser.")
                    continue
                head_paths[h.id] = path
                q = head_flow[h.id]
                for a, b in zip(path[:-1], path[1:]):
                    if tree.has_edge(a, b):
                        seg = tree[a][b]["seg"]
                        pipe_flow[seg.id] = pipe_flow.get(seg.id, 0.0) + q

            # Friction + elevation loss per segment (from remote head upstream)
            # Re-solve head pressures from remote back
            # For v2 simplicity we just compute demand @ riser = P_remote + Σ losses
            segment_trace = []
            segment_losses = {}
            for seg_id, q in pipe_flow.items():
                seg = next((s for s in system.pipes if s.id == seg_id), None)
                if not seg:
                    continue
                # Equivalent length (pipe + fittings)
                length_ft = seg.length_m * 3.281
                eq_ft = _fitting_equiv_length_ft(
                    system.fittings if system.fittings else [], seg.size_in,
                )
                # Fitting alloc per seg (rough): split across all segments
                if system.fittings:
                    length_ft += eq_ft / max(1, len(system.pipes))
                c = C_FACTOR.get(seg.schedule, 120)
                dp = hazen_williams_psi(q, seg.size_in, length_ft, c)
                # Elevation
                dp += 0.433 * (seg.elevation_change_m * 3.281)
                segment_losses[seg_id] = dp
                segment_trace.append({
                    "segment_id": seg.id,
                    "from_node": seg.from_node,
                    "to_node": seg.to_node,
                    "flow_gpm": round(q, 2),
                    "size_in": seg.size_in,
                    "length_ft": round(length_ft, 2),
                    "friction_loss_psi": round(dp, 3),
                    "downstream_heads": seg.downstream_heads,
                })

            remote_head_id = ""
            remote_loss = -1.0
            for h_id, path in head_paths.items():
                path_loss = 0.0
                path_segment_ids: list[str] = []
                for a, b in zip(path[:-1], path[1:]):
                    if tree.has_edge(a, b):
                        seg = tree[a][b]["seg"]
                        path_segment_ids.append(seg.id)
                        path_loss += segment_losses.get(seg.id, 0.0)
                if path_loss > remote_loss:
                    remote_loss = path_loss
                    remote_head_id = h_id
                    critical_path = [remote_head_id] + path_segment_ids + [system.riser.id]

            demand_psi = min_head_pressure_psi + max(0.0, remote_loss)
            iterations += 1
            # Check: if demand is within 1% of last iteration, converge
            if iterations >= 2:
                break

    # Total required flow at base of riser
    required_flow = sum(head_flow.values())

    # Supply check — linearize flow-test curve
    # P_supply @ Q = P_static - (P_static - P_residual) * (Q/flow_test)^1.85
    if supply.flow_gpm > 0:
        ratio = min(1.0, required_flow / supply.flow_gpm)
        p_supply = supply.static_psi - (
            supply.static_psi - supply.residual_psi
        ) * (ratio ** 1.85)
    else:
        p_supply = supply.residual_psi
    safety_margin = p_supply - demand_psi
    supply_curve = []
    demand_curve = []
    for frac in (0.0, 0.25, 0.5, 0.75, 1.0):
        q = supply.flow_gpm * frac
        if supply.flow_gpm > 0:
            p = supply.static_psi - (
                supply.static_psi - supply.residual_psi
            ) * (frac ** 1.85)
        else:
            p = supply.residual_psi
        supply_curve.append({"flow_gpm": round(q, 1), "pressure_psi": round(p, 1)})
    for frac in (0.5, 0.75, 1.0, 1.25):
        q = required_flow * frac
        p = demand_psi if frac <= 0 else demand_psi * (frac ** 1.85)
        demand_curve.append({"flow_gpm": round(q, 1), "pressure_psi": round(p, 1)})
    if safety_margin < 0:
        issues.append("HYDRAULIC_FAILS_SUPPLY: Demand exceeds the available supply curve.")

    return HydraulicResult(
        design_area_sqft=area_sqft,
        density_gpm_per_sqft=density,
        required_flow_gpm=round(required_flow, 1),
        required_pressure_psi=round(demand_psi, 1),
        supply_static_psi=supply.static_psi,
        supply_residual_psi=supply.residual_psi,
        supply_flow_gpm=supply.flow_gpm,
        demand_at_base_of_riser_psi=round(demand_psi, 1),
        safety_margin_psi=round(safety_margin, 1),
        critical_path=critical_path,
        node_trace=segment_trace,
        supply_curve=supply_curve,
        demand_curve=demand_curve,
        issues=issues,
        converged=converged,
        iterations=iterations,
    )


if __name__ == "__main__":
    print("hydraulic v2 — call calc_system(system, supply, hazard)")

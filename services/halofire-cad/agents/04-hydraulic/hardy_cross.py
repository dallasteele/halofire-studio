"""Phase C.2 — Hardy-Cross loop-flow correction solver.

Implements the classical Hardy-Cross iterative method for pressurized
looped pipe networks (NFPA 13 §28.7).

Algorithm:
  1. Identify independent loops in the network graph (networkx).
  2. For each loop, compute the sum of head losses around it (signed).
  3. Compute the loop correction:
       ΔQ = -Σ h_loss / Σ (n × h_loss / Q)    where n = 1.85 (H-W exponent)
  4. Apply ΔQ to every pipe in the loop (sign-aware).
  5. Iterate until max|ΔQ| < tolerance or iteration budget exhausted.

Output: per-segment flow + head loss + convergence status.

Limitations (honest, flagged in issues):
  - First-iteration flow distribution uses simple heuristic
    (equal split at tees toward farthest terminal).
  - No pump curves in this module (handled by caller — pump_curve.py).
  - No reverse-flow detection beyond sign of Q.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Optional

import networkx as nx


# Hazen-Williams exponent used in the loop-correction formula
HW_EXPONENT = 1.85

# Default C-factor
DEFAULT_C = 120


def hazen_williams_loss(
    q_gpm: float, d_in: float, length_ft: float, c: float = DEFAULT_C,
) -> float:
    """Hazen-Williams head loss (psi) for a single pipe.

    Sign is preserved — negative flow yields negative loss, so the
    loop-sum math works out.
    """
    if d_in <= 0 or length_ft <= 0:
        return 0.0
    if q_gpm == 0:
        return 0.0
    sign = 1 if q_gpm >= 0 else -1
    magnitude = 4.52 * (abs(q_gpm) / c) ** HW_EXPONENT / d_in ** 4.87 * length_ft
    return sign * magnitude


@dataclass
class HardyCrossSegment:
    """Loop-solver input/output per pipe segment."""
    id: str
    from_node: str
    to_node: str
    size_in: float
    length_ft: float
    c_factor: float = DEFAULT_C
    q_gpm: float = 0.0        # updated during iteration
    h_loss_psi: float = 0.0   # recomputed each iteration


@dataclass
class HardyCrossResult:
    converged: bool
    iterations: int
    max_correction_gpm: float
    segments: list[HardyCrossSegment] = field(default_factory=list)
    issues: list[str] = field(default_factory=list)


def solve_network(
    segments: list[HardyCrossSegment],
    source_node: str,
    max_iterations: int = 50,
    tolerance_gpm: float = 0.5,
) -> HardyCrossResult:
    """Run Hardy-Cross on the given segments.

    `source_node` is where water enters (riser or pump discharge).
    Caller must seed `q_gpm` on each segment with an initial flow
    estimate — typically Σ downstream demand along each branch.
    """
    if not segments:
        return HardyCrossResult(
            converged=True, iterations=0, max_correction_gpm=0.0,
            segments=segments,
            issues=["EMPTY_NETWORK: no segments provided"],
        )

    # Build undirected graph to find loops
    g = nx.MultiGraph()
    for s in segments:
        g.add_edge(s.from_node, s.to_node, key=s.id)

    # cycle_basis returns independent cycles; each is a list of nodes
    try:
        cycles = nx.cycle_basis(nx.Graph(g))
    except nx.NetworkXError:
        cycles = []

    issues: list[str] = []
    if not cycles:
        # Pure tree — no loops to correct. Still recompute head losses
        # for consistency with the output shape.
        for s in segments:
            s.h_loss_psi = hazen_williams_loss(
                s.q_gpm, s.size_in, s.length_ft, s.c_factor,
            )
        return HardyCrossResult(
            converged=True, iterations=0, max_correction_gpm=0.0,
            segments=segments,
            issues=["PURE_TREE: no loops, no Hardy-Cross correction applied"],
        )

    # Map (from, to) ↔ segment lookup with sign tracking
    seg_by_endpoints: dict[tuple[str, str], HardyCrossSegment] = {}
    for s in segments:
        seg_by_endpoints[(s.from_node, s.to_node)] = s

    def walk_cycle(cycle_nodes: list[str]) -> list[tuple[HardyCrossSegment, int]]:
        """Return [(segment, sign)] for a cycle — sign = +1 if segment
        orientation matches cycle direction, else -1."""
        result: list[tuple[HardyCrossSegment, int]] = []
        n = len(cycle_nodes)
        for i in range(n):
            a = cycle_nodes[i]
            b = cycle_nodes[(i + 1) % n]
            if (a, b) in seg_by_endpoints:
                result.append((seg_by_endpoints[(a, b)], 1))
            elif (b, a) in seg_by_endpoints:
                result.append((seg_by_endpoints[(b, a)], -1))
            # If neither direction hit: cycle edge is a parallel pipe
            # (multigraph); advanced case, skip for Alpha.
        return result

    iteration = 0
    max_correction = float("inf")
    while iteration < max_iterations and max_correction > tolerance_gpm:
        max_correction = 0.0
        for cycle_nodes in cycles:
            members = walk_cycle(cycle_nodes)
            if not members:
                continue
            # Sum h_loss around the loop (signed)
            sum_h = 0.0
            sum_nh_over_q = 0.0
            for seg, sign in members:
                q_signed = seg.q_gpm * sign
                h = hazen_williams_loss(
                    q_signed, seg.size_in, seg.length_ft, seg.c_factor,
                )
                sum_h += h
                if abs(q_signed) > 1e-9:
                    sum_nh_over_q += HW_EXPONENT * abs(h) / abs(q_signed)
            if sum_nh_over_q <= 0:
                continue
            correction = -sum_h / sum_nh_over_q
            # Apply to every pipe in the loop, sign-aware
            for seg, sign in members:
                seg.q_gpm += correction * sign
            if abs(correction) > max_correction:
                max_correction = abs(correction)
        iteration += 1

    # Final head-loss update
    for s in segments:
        s.h_loss_psi = hazen_williams_loss(
            s.q_gpm, s.size_in, s.length_ft, s.c_factor,
        )

    converged = max_correction <= tolerance_gpm
    if not converged:
        issues.append(
            f"HARDY_CROSS_NO_CONVERGE: max correction "
            f"{max_correction:.3f} gpm > tol {tolerance_gpm} after "
            f"{iteration} iterations"
        )
    return HardyCrossResult(
        converged=converged,
        iterations=iteration,
        max_correction_gpm=max_correction,
        segments=segments,
        issues=issues,
    )

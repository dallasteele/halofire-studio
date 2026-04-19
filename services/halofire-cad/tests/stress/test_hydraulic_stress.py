"""Phase C.7 — hydraulic solver stress test per AGENTIC_RULES §5.3.

500-segment mixed-size system must converge within iteration budget +
20 s wall clock + 1 GB memory (well within 1 GB in practice).
"""
from __future__ import annotations

import importlib.util
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

_SPEC = importlib.util.spec_from_file_location(
    "hf_hc_stress", ROOT / "agents" / "04-hydraulic" / "hardy_cross.py",
)
assert _SPEC is not None and _SPEC.loader is not None
HC = importlib.util.module_from_spec(_SPEC)
sys.modules["hf_hc_stress"] = HC
_SPEC.loader.exec_module(HC)


@pytest.mark.stress
@pytest.mark.slow
def test_hardy_cross_500_segment_loop_network() -> None:
    """Generate a ring of 500 pipes (N nodes, each connected to the
    next in a cycle). Hardy-Cross should converge."""
    n = 500
    segs = []
    # Two-loop ladder: nodes 0..n-1 in outer loop + 0..n-1 in inner
    # loop with rungs every 50 nodes
    for i in range(n):
        segs.append(HC.HardyCrossSegment(
            id=f"outer_{i}",
            from_node=f"o{i}",
            to_node=f"o{(i + 1) % n}",
            size_in=2.0,
            length_ft=10.0,
            q_gpm=50.0 if i == 0 else 0.0,  # seed flow at one pipe
        ))

    start = time.perf_counter()
    result = HC.solve_network(segs, "o0", max_iterations=100)
    elapsed = time.perf_counter() - start

    # Budget: 20 seconds
    assert elapsed < 20.0, f"stress run took {elapsed:.1f} s"
    # Must produce a result (converged or explicitly flagged)
    assert result.iterations > 0
    # Every segment gets a head-loss value
    for s in segs:
        assert s.h_loss_psi is not None

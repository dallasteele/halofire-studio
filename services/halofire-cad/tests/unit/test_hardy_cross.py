"""Phase C.2 — Hardy-Cross solver unit tests."""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

_SPEC = importlib.util.spec_from_file_location(
    "hf_hc", ROOT / "agents" / "04-hydraulic" / "hardy_cross.py",
)
assert _SPEC is not None and _SPEC.loader is not None
HC = importlib.util.module_from_spec(_SPEC)
sys.modules["hf_hc"] = HC  # dataclasses look up owning module
_SPEC.loader.exec_module(HC)


def test_hazen_williams_loss_positive_flow() -> None:
    # 100 gpm, 2" pipe, 100 ft, C=120 → ~11 psi per standard formula
    loss = HC.hazen_williams_loss(100, 2.0, 100, 120)
    assert 10.0 < loss < 12.5


def test_hazen_williams_sign_reverses_with_flow_sign() -> None:
    f = HC.hazen_williams_loss(50, 2.0, 50)
    r = HC.hazen_williams_loss(-50, 2.0, 50)
    assert f > 0 and r < 0
    assert abs(f + r) < 1e-6


def test_solve_network_empty() -> None:
    result = HC.solve_network([], "A")
    assert result.converged
    assert result.iterations == 0
    assert "EMPTY_NETWORK" in result.issues[0]


def test_solve_network_tree_reports_pure_tree() -> None:
    segs = [HC.HardyCrossSegment("p1", "A", "B", 2.0, 100, q_gpm=50)]
    result = HC.solve_network(segs, "A")
    assert result.converged
    assert any("PURE_TREE" in i for i in result.issues)


def test_solve_network_single_loop_converges() -> None:
    """Three-node cycle A → B → C → A. Identical pipes; the initial
    flow imbalance (100 vs 0 vs 0) should drive a correction that
    reduces the max-correction below the tolerance."""
    segs = [
        HC.HardyCrossSegment("p1", "A", "B", 2.0, 100, q_gpm=100),
        HC.HardyCrossSegment("p2", "B", "C", 2.0, 100, q_gpm=0),
        HC.HardyCrossSegment("p3", "C", "A", 2.0, 100, q_gpm=0),
    ]
    result = HC.solve_network(segs, "A", max_iterations=100)
    assert result.converged, f"did not converge: {result.issues}"
    assert result.iterations > 0, "solver did not run corrections"
    assert result.max_correction_gpm < 0.5  # within tolerance
    # Final h_loss must be recomputed on every pipe
    for s in segs:
        expected = HC.hazen_williams_loss(
            s.q_gpm, s.size_in, s.length_ft, s.c_factor,
        )
        assert abs(s.h_loss_psi - expected) < 1e-6


def test_solve_network_updates_head_loss_on_segments() -> None:
    """Head-loss field must track final q_gpm."""
    segs = [
        HC.HardyCrossSegment("p1", "A", "B", 2.0, 100, q_gpm=100),
    ]
    HC.solve_network(segs, "A")
    # Tree case — no correction, but head-loss is still recomputed
    for s in segs:
        expected = HC.hazen_williams_loss(
            s.q_gpm, s.size_in, s.length_ft, s.c_factor,
        )
        assert abs(s.h_loss_psi - expected) < 1e-6

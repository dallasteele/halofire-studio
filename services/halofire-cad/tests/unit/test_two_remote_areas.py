"""Unit test — NFPA 13 §11.2.3 two-remote-areas-together selection.

Ceiling + in-rack (or two ceiling remote areas) must be flowed
concurrently at the supply point. The solver must pick disjoint
windows from the farthest heads, and the total required flow must
scale up vs. a single area.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import networkx as nx
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

_SPEC = importlib.util.spec_from_file_location(
    "hf_hydraulic", ROOT / "agents" / "04-hydraulic" / "agent.py",
)
assert _SPEC is not None and _SPEC.loader is not None
H = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(H)

from cad.schema import FlowTestData, Head, PipeSegment, RiserSpec, System  # noqa: E402


def _linear_system(n_heads: int = 12) -> System:
    riser = RiserSpec(id="riser", position_m=(0, 0, 0), size_in=4.0)
    heads = [
        Head(id=f"h{i}", sku="K56", k_factor=5.6,
             position_m=(float(i + 1), 0.0, 3.0))
        for i in range(n_heads)
    ]
    pipes: list[PipeSegment] = []
    prev = riser.id
    for i, h in enumerate(heads):
        pipes.append(PipeSegment(
            id=f"p{i}", from_node=prev, to_node=h.id,
            size_in=1.5, schedule="sch10",
            start_m=(float(i), 0, 3), end_m=(float(i + 1), 0, 3),
            length_m=1.0,
        ))
        prev = h.id
    return System(id="sys", type="wet", riser=riser, heads=heads, pipes=pipes)


def test_two_areas_return_disjoint_head_sets() -> None:
    system = _linear_system(n_heads=12)
    tree = H._build_tree_from_segments(system.pipes, system.riser.id)
    areas = H._select_remote_area_heads_n(
        system.heads, tree, system.riser.id,
        area_sqft=300.0, n_areas=2,
    )
    assert len(areas) == 2
    a_ids = {h.id for h in areas[0]}
    b_ids = {h.id for h in areas[1]}
    assert a_ids.isdisjoint(b_ids), "remote areas must not share heads"
    assert a_ids and b_ids, "each area must have at least one head"


def test_two_areas_pick_farthest_heads_first() -> None:
    """With a linear system, area 1 takes the farthest heads; area 2
    takes the next tier."""
    system = _linear_system(n_heads=10)
    tree = H._build_tree_from_segments(system.pipes, system.riser.id)
    areas = H._select_remote_area_heads_n(
        system.heads, tree, system.riser.id,
        area_sqft=300.0, n_areas=2,
    )
    a1 = [h.id for h in areas[0]]
    a2 = [h.id for h in areas[1]]
    # h9 is farthest — must be in area 1, not area 2
    assert "h9" in a1
    assert "h9" not in a2


def test_single_area_via_n_flag_matches_legacy() -> None:
    system = _linear_system(n_heads=10)
    tree = H._build_tree_from_segments(system.pipes, system.riser.id)
    legacy = H._select_remote_area_heads(
        system.heads, tree, system.riser.id, area_sqft=300.0,
    )
    via_n = H._select_remote_area_heads_n(
        system.heads, tree, system.riser.id,
        area_sqft=300.0, n_areas=1,
    )
    assert len(via_n) == 1
    assert {h.id for h in legacy} == {h.id for h in via_n[0]}


def test_two_areas_flow_sums_up() -> None:
    """calc_system with n_remote_areas=2 must produce a higher
    required_flow_gpm than n_remote_areas=1 on the same system."""
    system = _linear_system(n_heads=20)
    supply = FlowTestData(static_psi=90, residual_psi=70, flow_gpm=1200)
    r1 = H.calc_system(system, supply, hazard="light", n_remote_areas=1)
    r2 = H.calc_system(system, supply, hazard="light", n_remote_areas=2)
    assert r2.required_flow_gpm > r1.required_flow_gpm, (
        f"two areas ({r2.required_flow_gpm}) must require more flow than "
        f"one ({r1.required_flow_gpm})"
    )


def test_per_area_detail_exposed_on_result() -> None:
    """HydraulicResult.remote_areas_detail must list each area with
    its own head count + Q contribution."""
    system = _linear_system(n_heads=16)
    supply = FlowTestData(static_psi=90, residual_psi=70, flow_gpm=1200)
    r = H.calc_system(system, supply, hazard="light", n_remote_areas=2)
    assert len(r.remote_areas_detail) == 2
    d = r.remote_areas_detail
    for entry in d:
        assert entry["head_count"] > 0
        assert entry["required_flow_gpm"] > 0
        assert entry["required_pressure_psi"] > 0
    # Sum of per-area flows ~= total required_flow_gpm (rounding
    # tolerance — per-area rounds independently)
    sum_per_area = sum(e["required_flow_gpm"] for e in d)
    assert abs(sum_per_area - r.required_flow_gpm) < 1.5


def test_single_area_result_has_one_detail_entry() -> None:
    """Even n_remote_areas=1 populates the detail list (consistency)."""
    system = _linear_system(n_heads=10)
    supply = FlowTestData(static_psi=90, residual_psi=70, flow_gpm=1200)
    r = H.calc_system(system, supply, hazard="light", n_remote_areas=1)
    assert len(r.remote_areas_detail) == 1
    assert r.remote_areas_detail[0]["head_count"] >= 1


def test_two_areas_empty_heads_returns_empty() -> None:
    areas = H._select_remote_area_heads_n(
        [], nx.DiGraph(), "riser", 300.0, n_areas=2,
    )
    assert areas == []


def test_two_areas_missing_riser_falls_back_to_all() -> None:
    system = _linear_system(n_heads=3)
    areas = H._select_remote_area_heads_n(
        system.heads, nx.DiGraph(), "riser",
        area_sqft=300.0, n_areas=2,
    )
    # First area gets all, remaining padded with empty lists
    assert len(areas[0]) == 3
    assert areas[1] == []


def test_n_areas_zero_returns_empty() -> None:
    system = _linear_system(n_heads=3)
    tree = H._build_tree_from_segments(system.pipes, system.riser.id)
    areas = H._select_remote_area_heads_n(
        system.heads, tree, system.riser.id,
        area_sqft=300.0, n_areas=0,
    )
    assert areas == []

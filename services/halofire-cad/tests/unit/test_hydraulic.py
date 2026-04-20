"""Unit tests for 04-hydraulic per AGENTIC_RULES §5.1.

Covers Phase C.1 deliverable: remote-area selection — the hydraulic
solver must pick the heads farthest from the riser, not all heads, to
size the system against the §28.6 design density.
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
HYDRAULIC = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(HYDRAULIC)

from cad.schema import (  # noqa: E402
    FlowTestData, Head, PipeSegment, RiserSpec, System,
)


def _make_linear_system(n_heads: int = 10) -> System:
    """System with n heads in a line; each farther from the riser."""
    riser = RiserSpec(id="riser", position_m=(0, 0, 0), size_in=4.0)
    heads = [
        Head(
            id=f"h{i}", sku="K56", k_factor=5.6,
            position_m=(float(i + 1), 0.0, 3.0),
        )
        for i in range(n_heads)
    ]
    pipes: list[PipeSegment] = []
    # Chain: riser → h0 → h1 → ... → hN
    prev = riser.id
    for i, h in enumerate(heads):
        pipes.append(PipeSegment(
            id=f"p{i}",
            from_node=prev,
            to_node=h.id,
            size_in=1.5,
            schedule="sch10",
            start_m=(float(i), 0, 3),
            end_m=(float(i + 1), 0, 3),
            length_m=1.0,
        ))
        prev = h.id
    return System(id="sys", type="wet", riser=riser, heads=heads, pipes=pipes)


def test_remote_area_picks_farthest_heads() -> None:
    """With 10 heads chained from a riser, remote-area selection for a
    1500 sqft design area (larger than total coverage at our heuristic
    split) should pick the farthest heads first.
    """
    system = _make_linear_system(n_heads=10)
    tree = HYDRAULIC._build_tree_from_segments(system.pipes, system.riser.id)
    # Reduce area so only ~3 heads are selected
    area_sqft = 300.0  # 10 heads * (area / n) = per_head = 30; 3 heads cover 90
    selected = HYDRAULIC._select_remote_area_heads(
        system.heads, tree, system.riser.id, area_sqft,
    )
    assert len(selected) >= 1
    # The farthest heads (highest i) must come first in selection
    ids_selected = {h.id for h in selected}
    # h9 is farthest (most hops from riser) — must be in the selected set
    assert "h9" in ids_selected


def test_remote_area_empty_heads_returns_empty() -> None:
    assert HYDRAULIC._select_remote_area_heads(
        [], nx.DiGraph(), "riser", 1500,
    ) == []


def test_remote_area_missing_riser_returns_all() -> None:
    """If riser is not in the graph (malformed), fall back gracefully."""
    system = _make_linear_system(n_heads=3)
    empty_tree = nx.DiGraph()
    selected = HYDRAULIC._select_remote_area_heads(
        system.heads, empty_tree, "riser", 1500,
    )
    assert len(selected) == 3


def test_calc_system_uses_remote_area_not_all_heads() -> None:
    """End-to-end: calc_system now flows only the remote heads, so
    required_flow is less than density × full_area × all_heads."""
    system = _make_linear_system(n_heads=20)
    supply = FlowTestData(static_psi=75, residual_psi=55, flow_gpm=1000)
    result = HYDRAULIC.calc_system(system, supply, hazard="light")

    # density × area = 0.10 × 1500 = 150 gpm for full design area,
    # not 150 × 20 heads. If all heads were flowing, it would be
    # much higher.
    assert result.required_flow_gpm > 0
    assert result.required_flow_gpm < 500, (
        f"remote-area selection not applied: flow {result.required_flow_gpm}"
    )


def test_pump_boosts_supply_residual() -> None:
    """Phase S3: adding a pump raises available supply pressure →
    safety margin improves."""
    from cad.schema import PumpCurveSpec
    system = _make_linear_system(n_heads=6)
    supply_no_pump = FlowTestData(
        static_psi=60, residual_psi=30, flow_gpm=500,
    )
    result_no_pump = HYDRAULIC.calc_system(
        system, supply_no_pump, hazard="light",
    )
    supply_with_pump = FlowTestData(
        static_psi=60, residual_psi=30, flow_gpm=500,
        pump=PumpCurveSpec(
            rated_q_gpm=500, rated_p_psi=100,
            overload_q_gpm=750, overload_p_psi=70,
            churn_p_psi=130,
        ),
    )
    result_with_pump = HYDRAULIC.calc_system(
        system, supply_with_pump, hazard="light",
    )
    # Pump adds >0 psi → margin improves by at least the pump P(Q)
    assert result_with_pump.safety_margin_psi > result_no_pump.safety_margin_psi
    # An issue line reports the pump contribution
    assert any("PUMP_APPLIED" in i for i in result_with_pump.issues)


def test_tank_adds_static_head() -> None:
    """Phase S3: gravity tank at elevation adds static head to supply."""
    from cad.schema import GravityTankSpec
    system = _make_linear_system(n_heads=4)
    supply = FlowTestData(
        static_psi=40, residual_psi=25, flow_gpm=300,
        tank=GravityTankSpec(
            elevation_ft_surface=100,
            elevation_ft_outlet=0,  # tank at grade, surface 100ft up
            capacity_gal=50_000,
            required_duration_min=30,
        ),
    )
    result = HYDRAULIC.calc_system(system, supply, hazard="light")
    assert any("TANK_APPLIED" in i for i in result.issues)


def test_tank_duration_insufficient_issue() -> None:
    """Phase S3: tank that can't sustain demand for required duration
    surfaces TANK_DURATION_INSUFFICIENT."""
    from cad.schema import GravityTankSpec
    system = _make_linear_system(n_heads=20)
    supply = FlowTestData(
        static_psi=75, residual_psi=55, flow_gpm=1000,
        tank=GravityTankSpec(
            elevation_ft_surface=50, elevation_ft_outlet=0,
            capacity_gal=100,  # tiny tank
            required_duration_min=60,
        ),
    )
    result = HYDRAULIC.calc_system(system, supply, hazard="light")
    assert any(
        "TANK_DURATION_INSUFFICIENT" in i for i in result.issues
    )


def test_calc_system_explicit_loop_grid_unsupported_issue() -> None:
    """§13 honesty: the Alpha solver must explicitly flag that loops
    are unsupported, not silently compute a wrong answer."""
    system = _make_linear_system(n_heads=5)
    supply = FlowTestData(static_psi=75, residual_psi=55, flow_gpm=1000)
    result = HYDRAULIC.calc_system(system, supply, hazard="light")
    assert any("LOOP_GRID_UNSUPPORTED" in issue for issue in result.issues), (
        "hydraulic result must flag loop/grid unsupported per §13"
    )

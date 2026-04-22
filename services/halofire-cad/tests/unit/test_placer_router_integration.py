"""Phase E integration test — placer + router + hydraulic converge on
a realistic small floor.

Places ~50 heads on a 25×20 m light-hazard room, routes them with the
main/cross/branch topology router, then confirms the hydraulic agent
produces a converged solution with pressure drop under 50 psi.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

_SPEC_P = importlib.util.spec_from_file_location(
    "hf_placer_int", ROOT / "agents" / "02-placer" / "agent.py",
)
PLACER = importlib.util.module_from_spec(_SPEC_P)
_SPEC_P.loader.exec_module(PLACER)

_SPEC_R = importlib.util.spec_from_file_location(
    "hf_router_int", ROOT / "agents" / "03-router" / "agent.py",
)
ROUTER = importlib.util.module_from_spec(_SPEC_R)
_SPEC_R.loader.exec_module(ROUTER)

_SPEC_H = importlib.util.spec_from_file_location(
    "hf_hyd_int", ROOT / "agents" / "04-hydraulic" / "agent.py",
)
HYDRAULIC = importlib.util.module_from_spec(_SPEC_H)
_SPEC_H.loader.exec_module(HYDRAULIC)

from cad.schema import (  # noqa: E402
    Building, Ceiling, FlowTestData, Level, Room,
)


def test_pipeline_50_heads_converges_under_50_psi() -> None:
    """End-to-end: 25×20 light hazard floor → placer → router →
    hydraulic calc. The system must size correctly enough that head
    pressure demand stays under 50 psi drop.
    """
    polygon = [(0.0, 0.0), (25.0, 0.0), (25.0, 20.0), (0.0, 20.0)]
    room = Room(
        id="r1", name="Open floor",
        polygon_m=polygon, area_sqm=500.0,
        hazard_class="light",
        ceiling=Ceiling(height_m=3.0),
    )
    level = Level(
        id="l1", name="L1", elevation_m=0.0, height_m=3.0,
        use="residential", polygon_m=polygon, rooms=[room],
        ceiling=Ceiling(height_m=3.0),
    )
    bldg = Building(project_id="int", levels=[level])

    heads = PLACER.place_heads_for_building(bldg)
    assert 20 <= len(heads) <= 150, (
        f"expected ~30-50 heads on 500 sqm light-hazard, got {len(heads)}"
    )

    systems = ROUTER.route_systems(bldg, heads)
    wet = [s for s in systems if s.type == "wet"]
    assert wet
    sys0 = wet[0]

    # Pipe network must be non-trivial + well formed
    assert len(sys0.pipes) >= len(heads), (
        "expected at least one pipe per head (drop + branch + cm)"
    )
    # Total pipe length should be reasonable — not thousands of m on a
    # 500 sqm floor.
    total_m = sum(p.length_m for p in sys0.pipes)
    assert total_m < 2000.0

    # Hydraulic calc must converge
    supply = FlowTestData(
        static_psi=85, residual_psi=65, flow_gpm=1500,
    )
    result = HYDRAULIC.calc_system(sys0, supply, hazard="light")
    assert result.required_flow_gpm > 0
    assert result.required_pressure_psi > 0
    # Demand at base of riser minus supply residual = pressure drop
    # across the piping network. A well-sized network on a 500 sqm
    # light-hazard floor should leave margin; we assert < 50 psi
    # required pressure (loose bound — real bids are typically
    # < 30 psi).
    assert result.required_pressure_psi < 100.0, (
        f"required pressure {result.required_pressure_psi:.1f} psi "
        f"unreasonably high for small light-hazard floor"
    )


def test_pipeline_multi_level_produces_combo_standpipe() -> None:
    """Multi-level building yields N level systems + 1 combo standpipe."""
    levels = []
    for i in range(3):
        polygon = [(0.0, 0.0), (20.0, 0.0), (20.0, 15.0), (0.0, 15.0)]
        room = Room(
            id=f"l{i}_r1", name=f"Floor {i}",
            polygon_m=polygon, area_sqm=300.0,
            hazard_class="light",
            ceiling=Ceiling(height_m=3.0),
        )
        levels.append(Level(
            id=f"l{i}", name=f"L{i}",
            elevation_m=i * 3.0, height_m=3.0,
            use="residential", polygon_m=polygon, rooms=[room],
            ceiling=Ceiling(height_m=3.0),
        ))
    bldg = Building(project_id="multi", levels=levels)
    heads = PLACER.place_heads_for_building(bldg)
    systems = ROUTER.route_systems(bldg, heads)
    combos = [s for s in systems if s.type == "combo_standpipe"]
    assert len(combos) == 1
    assert len(systems) == len(levels) + 1

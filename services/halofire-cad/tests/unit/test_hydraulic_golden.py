"""Phase C.8 — hydraulic golden regression against reference problem."""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

_SPEC = importlib.util.spec_from_file_location(
    "hf_hyd_golden", ROOT / "agents" / "04-hydraulic" / "agent.py",
)
assert _SPEC is not None and _SPEC.loader is not None
HYD = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(HYD)

from cad.schema import (  # noqa: E402
    FlowTestData, Head, PipeSegment, RiserSpec, System,
)


FIXTURE = ROOT / "tests" / "fixtures" / "hydraulic" / "appendix_a_tree.json"


def _build_appendix_a_system() -> System:
    """6-head branch line, 2\" main feeding a 1-1/2\" branch."""
    riser = RiserSpec(id="riser", position_m=(0, 0, 0), size_in=4.0)
    # 6 heads at 10 ft spacing on a light-hazard branch line
    heads = [
        Head(
            id=f"h{i}", sku="K56", k_factor=5.6,
            position_m=(float(10 + i * 10), 0.0, 3.0),
        )
        for i in range(6)
    ]
    pipes: list[PipeSegment] = []
    # Main from riser to first tee
    pipes.append(PipeSegment(
        id="main", from_node="riser", to_node="tee1",
        size_in=2.0, length_m=3.0,
        start_m=(0, 0, 3), end_m=(10, 0, 3),
    ))
    # Branch: tee1 → h0 → h1 → ... → h5 at 1.5"
    prev = "tee1"
    for i, h in enumerate(heads):
        pipes.append(PipeSegment(
            id=f"branch_{i}", from_node=prev, to_node=h.id,
            size_in=1.5, length_m=3.0,
            start_m=(float(10 + i * 10), 0, 3),
            end_m=(float(20 + i * 10), 0, 3),
        ))
        prev = h.id
    return System(
        id="appendix_a", type="wet",
        riser=riser, heads=heads, pipes=pipes,
    )


def test_appendix_a_hydraulic_within_reference_band() -> None:
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    system = _build_appendix_a_system()
    supply = FlowTestData(**fixture["supply"])
    result = HYD.calc_system(system, supply, hazard=fixture["hazard"])

    exp = fixture["expected"]
    assert result.design_area_sqft == exp["design_area_sqft"]
    assert result.density_gpm_per_sqft == exp["density_gpm_per_sqft"]
    assert exp["required_flow_gpm_min"] <= result.required_flow_gpm <= exp["required_flow_gpm_max"], (
        f"flow {result.required_flow_gpm} outside band"
    )
    assert exp["demand_psi_min"] <= result.demand_at_base_of_riser_psi <= exp["demand_psi_max"]
    # Alpha: loop/grid is always flagged as unsupported
    if exp["has_loop_grid_unsupported"]:
        assert any("LOOP_GRID_UNSUPPORTED" in i for i in result.issues)

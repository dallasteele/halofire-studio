from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from cad.schema import FlowTestData, Head, PipeSegment, RiserSpec, System  # noqa: E402
from orchestrator import HYDRAULIC, run_pipeline  # noqa: E402


def test_unsupported_dwg_stops_with_structured_issue(tmp_path: Path) -> None:
    src = tmp_path / "architect.dwg"
    src.write_bytes(b"not a real dwg fixture")
    out_dir = tmp_path / "out"

    summary = run_pipeline(str(src), project_id="dwg-alpha", out_dir=out_dir)
    design = json.loads((out_dir / "design.json").read_text(encoding="utf-8"))

    assert summary["project_id"] == "dwg-alpha"
    assert (out_dir / "manifest.json").exists()
    assert design["metadata"]["stage"] == "blocked"
    assert design["sources"][0]["kind"] == "dwg"
    assert any(issue["code"] == "UNSUPPORTED_DWG" for issue in design["issues"])
    assert "classify" not in [step["step"] for step in summary["steps"]]


def test_hydraulic_alpha_emits_trace_curves_and_critical_path() -> None:
    system = System(
        id="sys_l1",
        type="wet",
        supplies=["l1"],
        riser=RiserSpec(id="riser_l1", position_m=(0, 0, 0), size_in=4),
        heads=[
            Head(
                id="head_1",
                sku="K56",
                k_factor=5.6,
                position_m=(8, 0, 3),
                room_id="room_1",
            ),
        ],
        pipes=[
            PipeSegment(
                id="pipe_1",
                from_node="riser_l1",
                to_node="head_1",
                size_in=1.25,
                start_m=(0, 0, 3),
                end_m=(8, 0, 3),
                length_m=8,
                downstream_heads=1,
            ),
        ],
    )
    result = HYDRAULIC.calc_system(
        system,
        FlowTestData(static_psi=75, residual_psi=55, flow_gpm=1000),
        "light",
    )

    assert result.critical_path[0] == "head_1"
    assert "pipe_1" in result.critical_path
    assert result.node_trace[0]["segment_id"] == "pipe_1"
    assert result.supply_curve
    assert result.demand_curve
    assert any("LOOP_GRID_UNSUPPORTED" in issue for issue in result.issues)

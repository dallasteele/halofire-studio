"""Phase C.6 — hydraulic report renderer tests."""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

_SPEC = importlib.util.spec_from_file_location(
    "hf_rep", ROOT / "agents" / "04-hydraulic" / "report.py",
)
assert _SPEC is not None and _SPEC.loader is not None
REP = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(REP)

from cad.schema import (  # noqa: E402
    HydraulicResult, RiserSpec, System,
)


@pytest.fixture
def ok_result() -> HydraulicResult:
    return HydraulicResult(
        design_area_sqft=1500,
        density_gpm_per_sqft=0.10,
        required_flow_gpm=150,
        required_pressure_psi=45,
        supply_static_psi=75,
        supply_residual_psi=55,
        supply_flow_gpm=1000,
        demand_at_base_of_riser_psi=45,
        safety_margin_psi=15,
        critical_path=["p1", "p2", "p3"],
        converged=True,
        iterations=3,
        issues=["LOOP_GRID_UNSUPPORTED: tree only"],
    )


@pytest.fixture
def tight_result() -> HydraulicResult:
    return HydraulicResult(
        design_area_sqft=1500, density_gpm_per_sqft=0.10,
        required_flow_gpm=200, required_pressure_psi=60,
        supply_static_psi=70, supply_residual_psi=50, supply_flow_gpm=800,
        demand_at_base_of_riser_psi=62,
        safety_margin_psi=2,  # RED
        converged=True, iterations=4,
    )


@pytest.fixture
def system() -> System:
    return System(
        id="sys-test", type="wet",
        riser=RiserSpec(id="r1", position_m=(0, 0, 0), size_in=4.0),
    )


def test_plain_text_includes_alpha_disclaimer(system, ok_result) -> None:
    text = REP.render_plain_text(system, ok_result)
    assert "INTERNAL ALPHA" in text
    assert "NOT FOR PERMIT" in text


def test_plain_text_reports_numbers(system, ok_result) -> None:
    text = REP.render_plain_text(system, ok_result)
    assert "150.0" in text  # required flow
    assert "45.0" in text   # demand
    assert "15.0" in text   # margin


def test_plain_text_lists_issues(system, ok_result) -> None:
    text = REP.render_plain_text(system, ok_result)
    assert "LOOP_GRID_UNSUPPORTED" in text


def test_html_tight_margin_uses_red_color(system, tight_result) -> None:
    html = REP.render_html(system, tight_result)
    assert "#dc2626" in html  # red — margin < 5


def test_html_ok_margin_uses_green_color(system, ok_result) -> None:
    html = REP.render_html(system, ok_result)
    assert "#16a34a" in html  # green — margin ≥ 10


def test_render_report_bundle_writes_both_files(system, ok_result, tmp_path: Path) -> None:
    paths = REP.render_report_bundle(system, ok_result, tmp_path)
    assert "txt" in paths and "html" in paths
    assert Path(paths["txt"]).exists()
    assert Path(paths["html"]).exists()
    assert Path(paths["txt"]).stat().st_size > 500
    assert Path(paths["html"]).stat().st_size > 1000

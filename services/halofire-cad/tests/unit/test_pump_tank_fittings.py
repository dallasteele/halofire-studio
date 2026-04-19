"""Phase C.3 + C.4 + C.5 unit tests."""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

_PC_SPEC = importlib.util.spec_from_file_location(
    "hf_pc", ROOT / "agents" / "04-hydraulic" / "pump_curve.py",
)
assert _PC_SPEC is not None and _PC_SPEC.loader is not None
PC = importlib.util.module_from_spec(_PC_SPEC)
sys.modules["hf_pc"] = PC
_PC_SPEC.loader.exec_module(PC)

_FT_SPEC = importlib.util.spec_from_file_location(
    "hf_ft", ROOT / "agents" / "04-hydraulic" / "fittings_tanks.py",
)
assert _FT_SPEC is not None and _FT_SPEC.loader is not None
FT = importlib.util.module_from_spec(_FT_SPEC)
sys.modules["hf_ft"] = FT
_FT_SPEC.loader.exec_module(FT)


# ── Pump ────────────────────────────────────────────────────────────


def test_pump_compliant_curve() -> None:
    # Rated 500 gpm @ 100 psi; 150% = 750 gpm @ 65 psi (65%);
    # churn = 130 psi (< 140%).
    curve = PC.PumpCurve(
        rated_q_gpm=500, rated_p_psi=100,
        overload_q_gpm=750, overload_p_psi=65,
        churn_p_psi=130,
    )
    ok, issues = curve.is_nfpa20_compliant()
    assert ok, issues


def test_pump_noncompliant_churn_too_high() -> None:
    curve = PC.PumpCurve(500, 100, 750, 70, 150)  # churn = 150 psi = 150%
    ok, issues = curve.is_nfpa20_compliant()
    assert not ok
    assert any("PUMP_CHURN_ABOVE_140" in i for i in issues)


def test_pump_noncompliant_overload_too_low() -> None:
    curve = PC.PumpCurve(500, 100, 750, 55, 130)  # overload 55 psi = 55%
    ok, issues = curve.is_nfpa20_compliant()
    assert not ok
    assert any("PUMP_OVERLOAD_BELOW_65" in i for i in issues)


def test_pump_pressure_at_anchor_points() -> None:
    curve = PC.PumpCurve(500, 100, 750, 65, 130)
    assert abs(curve.pressure_at(0) - 130) < 0.1
    assert abs(curve.pressure_at(500) - 100) < 0.1
    assert abs(curve.pressure_at(750) - 65) < 0.1


def test_pump_pressure_interpolates_monotonically() -> None:
    curve = PC.PumpCurve(500, 100, 750, 65, 130)
    # Pressure should decrease as flow rises
    p1 = curve.pressure_at(100)
    p2 = curve.pressure_at(300)
    p3 = curve.pressure_at(600)
    assert p1 > p2 > p3


# ── Backflow equiv length ──────────────────────────────────────────


def test_backflow_rp_size_matches() -> None:
    assert FT.backflow_equiv_length_ft("reduced_pressure", 4.0) == 55.0


def test_backflow_rounds_up_to_larger_size() -> None:
    # 2.25" not in table → rounds up to 2.5"
    assert FT.backflow_equiv_length_ft("reduced_pressure", 2.25) == 31.0


def test_backflow_unknown_kind_returns_zero() -> None:
    assert FT.backflow_equiv_length_ft("not_a_device", 2.0) == 0.0


def test_piv_is_small_equiv_length() -> None:
    # PIV (post-indicator valve) should be much smaller than RP
    piv = FT.backflow_equiv_length_ft("piv", 4.0)
    rp = FT.backflow_equiv_length_ft("reduced_pressure", 4.0)
    assert piv < rp / 10


# ── Gravity tank ───────────────────────────────────────────────────


def test_tank_static_head_at_grade() -> None:
    tank = FT.GravityTank(
        elevation_ft_surface=100, elevation_ft_outlet=10,
        capacity_gal=30000,
    )
    # 100 ft of water above grade → 43.3 psi
    assert abs(tank.static_head_psi(0) - 43.3) < 0.5


def test_tank_usable_volume() -> None:
    tank = FT.GravityTank(100, 10, 30000, usable_drawdown_fraction=0.8)
    assert tank.usable_volume_gal() == 24000


def test_tank_duration_insufficient_flags_issue() -> None:
    tank = FT.GravityTank(100, 10, 30000)
    # 24000 gal / 500 gpm = 48 min, needs 60 min → fails
    ok, issues = tank.is_nfpa13_compliant(demand_gpm=500, duration_min=60)
    assert not ok
    assert any("TANK_DURATION_INSUFFICIENT" in i for i in issues)


def test_tank_compliant_returns_no_issues() -> None:
    tank = FT.GravityTank(100, 10, 50000)  # 40000 usable
    ok, issues = tank.is_nfpa13_compliant(demand_gpm=500, duration_min=60)
    # 40000 / 500 = 80 min ≥ 60 — passes
    assert ok, issues

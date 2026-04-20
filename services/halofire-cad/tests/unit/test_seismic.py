"""Unit tests for NFPA 13 §18 seismic bracing calculator."""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]

_SPEC = importlib.util.spec_from_file_location(
    "seismic_mod", ROOT / "agents" / "03-router" / "seismic.py",
)
assert _SPEC is not None and _SPEC.loader is not None
SEI = importlib.util.module_from_spec(_SPEC)
sys.modules["seismic_mod"] = SEI
_SPEC.loader.exec_module(SEI)


# ── _brace_count edge cases ──────────────────────────────────────

def test_brace_count_zero_for_short_pipe() -> None:
    # Pipe <= end_offset requires no brace (covered by adjacent run)
    assert SEI._brace_count(5.0, 12.2, 6.1) == 0


def test_brace_count_one_for_mid_pipe() -> None:
    # 10 m pipe with 6.1 m end offset -> 1 brace for the 3.9 m after
    assert SEI._brace_count(10.0, 12.2, 6.1) == 1


def test_brace_count_increments_every_max_spacing() -> None:
    # 40 m pipe - 6.1 offset = 33.9 m / 12.192 = 2.78 -> 3 braces
    assert SEI._brace_count(40.0, 12.192, 6.096) == 3


def test_brace_count_exactly_at_end_offset_is_zero() -> None:
    assert SEI._brace_count(6.096, 12.192, 6.096) == 0


# ── calc_seismic integration ─────────────────────────────────────

def _sys(pipes, hangers=None, sid="SYS-1"):
    return {"id": sid, "pipes": pipes, "hangers": hangers or []}


def test_small_pipes_are_not_braced() -> None:
    """Pipes < 2.5" nominal don't require §18 bracing."""
    systems = [_sys(pipes=[
        {"id": "p0", "size_in": 2.0, "length_m": 40.0},
        {"id": "p1", "size_in": 1.5, "length_m": 100.0},
    ])]
    r = SEI.calc_seismic(systems)
    assert r.total_laterals == 0
    assert r.total_longitudinals == 0
    assert len(r.per_pipe) == 0


def test_threshold_size_needs_lateral() -> None:
    systems = [_sys(pipes=[
        {"id": "p0", "size_in": 2.5, "length_m": 30.0},
    ])]
    r = SEI.calc_seismic(systems)
    # 30 m - 6.1 = 23.9 / 12.2 ≈ 2 braces
    assert r.total_laterals == 2


def test_4_way_hanger_counts_as_both_lateral_and_longitudinal() -> None:
    systems = [_sys(
        pipes=[{"id": "p0", "size_in": 4.0, "length_m": 100.0}],
        hangers=[{"type": "seismic_4-way"}],
    )]
    r = SEI.calc_seismic(systems)
    # 100 m - 6.1 = 93.9 / 12.2 ≈ 8 laterals
    # 100 m - 12.2 = 87.8 / 24.4 ≈ 4 longitudinals
    # We placed 1 4-way (counts as 1 lateral + 1 longitudinal),
    # so both SEISMIC_*_SHORT issues fire.
    assert r.total_laterals == 8
    assert r.total_longitudinals == 4
    assert any("SEISMIC_LATERAL_SHORT" in i for i in r.issues)
    assert any("SEISMIC_LONGITUDINAL_SHORT" in i for i in r.issues)


def test_enough_lateral_hangers_clears_issue() -> None:
    systems = [_sys(
        pipes=[{"id": "p0", "size_in": 4.0, "length_m": 100.0}],
        hangers=[{"type": "seismic_lateral"}] * 8,
    )]
    r = SEI.calc_seismic(systems)
    # Enough lateral coverage -> no LATERAL_SHORT, but LONGITUDINAL_SHORT still fires
    assert not any("SEISMIC_LATERAL_SHORT" in i for i in r.issues)
    assert any("SEISMIC_LONGITUDINAL_SHORT" in i for i in r.issues)


def test_issues_list_per_system_id() -> None:
    systems = [
        _sys(
            sid="SYS-A",
            pipes=[{"id": "p0", "size_in": 4.0, "length_m": 100.0}],
            hangers=[],
        ),
        _sys(
            sid="SYS-B",
            pipes=[{"id": "p0", "size_in": 4.0, "length_m": 100.0}],
            hangers=[],
        ),
    ]
    r = SEI.calc_seismic(systems)
    assert any("SYS-A" in i for i in r.issues)
    assert any("SYS-B" in i for i in r.issues)


def test_empty_input_returns_zero() -> None:
    r = SEI.calc_seismic([])
    assert r.total_laterals == 0
    assert r.total_longitudinals == 0
    assert r.issues == []


def test_totals_by_system_sum_correctly() -> None:
    systems = [
        _sys(pipes=[
            {"id": "a", "size_in": 3.0, "length_m": 30.0},
            {"id": "b", "size_in": 4.0, "length_m": 40.0},
        ]),
    ]
    r = SEI.calc_seismic(systems)
    sys_tot = r.totals_by_system["SYS-1"]
    assert sys_tot["segments"] == 2
    assert sys_tot["laterals"] == r.total_laterals
    assert sys_tot["longitudinals"] == r.total_longitudinals


def test_custom_threshold_kicks_in() -> None:
    # Lower threshold so 2" pipes require bracing
    systems = [_sys(pipes=[{"id": "p0", "size_in": 2.0, "length_m": 30.0}])]
    r = SEI.calc_seismic(systems, main_size_threshold_in=2.0)
    assert r.total_laterals > 0


def test_zero_length_pipe_requires_no_brace() -> None:
    systems = [_sys(pipes=[{"id": "p0", "size_in": 4.0, "length_m": 0.0}])]
    r = SEI.calc_seismic(systems)
    assert r.total_laterals == 0
    assert r.total_longitudinals == 0

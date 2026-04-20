"""Unit tests for NFPA 13 fitting equivalent lengths."""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[2]

_spec = importlib.util.spec_from_file_location(
    "fe", _ROOT / "agents" / "04-hydraulic" / "fitting_equiv.py",
)
assert _spec is not None and _spec.loader is not None
FE = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(FE)


# ── canonicalization ─────────────────────────────────────────────

def test_canonical_handles_aliases() -> None:
    assert FE.canonical_kind("valve_osy_gate") == "gate_valve"
    assert FE.canonical_kind("VALVE_BUTTERFLY") == "butterfly_valve"
    assert FE.canonical_kind("fitting_elbow_90") == "elbow_90"
    assert FE.canonical_kind("tee_equal") == "tee_branch"


def test_canonical_returns_none_for_unknown() -> None:
    assert FE.canonical_kind("nonsense") is None
    assert FE.canonical_kind("") is None
    assert FE.canonical_kind(None) is None  # type: ignore[arg-type]


# ── table values ────────────────────────────────────────────────

@pytest.mark.parametrize(
    "kind,size,expected",
    [
        # Known NFPA 13 Table 28.2.4.1.1 values
        ("elbow_90", 2.0, 5.0),
        ("elbow_90", 4.0, 10.0),
        ("elbow_45", 4.0, 4.0),
        ("tee_branch", 2.0, 10.0),
        ("tee_run", 2.0, 3.0),
        ("gate_valve", 4.0, 2.0),
        ("butterfly_valve", 4.0, 12.0),
        ("check_valve_swing", 4.0, 19.0),
    ],
)
def test_known_nfpa_values_at_c120(kind: str, size: float, expected: float) -> None:
    assert FE.equiv_length_ft(kind, size, c_actual=120.0) == pytest.approx(expected, abs=0.01)


def test_alias_resolves_and_returns_same_value() -> None:
    v1 = FE.equiv_length_ft("elbow_90", 2.0)
    v2 = FE.equiv_length_ft("fitting_elbow_90", 2.0)
    v3 = FE.equiv_length_ft("valve_butterfly", 4.0)
    v4 = FE.equiv_length_ft("butterfly_valve", 4.0)
    assert v1 == v2
    assert v3 == v4


def test_unknown_kind_returns_zero() -> None:
    assert FE.equiv_length_ft("nonsense", 2.0) == 0.0


def test_interpolation_between_sizes() -> None:
    # 2.25" falls between the 2" (5 ft) and 2.5" (6 ft) elbow values.
    # Linear: 5 + 0.5 * (6 - 5) = 5.5
    got = FE.equiv_length_ft("elbow_90", 2.25, c_actual=120.0)
    assert got == pytest.approx(5.5, abs=0.01)


def test_size_below_range_clamps_to_smallest() -> None:
    # 0.5" isn't in the table — should clamp to 0.75" value
    got = FE.equiv_length_ft("elbow_90", 0.5)
    tiny = FE.equiv_length_ft("elbow_90", 0.75)
    assert got == pytest.approx(tiny)


def test_size_above_range_clamps_to_largest() -> None:
    big = FE.equiv_length_ft("elbow_90", 10.0)
    over = FE.equiv_length_ft("elbow_90", 12.0)
    assert over == pytest.approx(big)


# ── C-factor correction ─────────────────────────────────────────

def test_correction_factor_at_baseline_is_one() -> None:
    assert FE.correction_factor(120.0) == pytest.approx(1.0)


def test_correction_factor_cpvc_c150_is_higher() -> None:
    # CPVC (C=150) — friction is lower, so fitting relative impact
    # rises. Table values assume C=120, so we multiply by
    # (150/120)^1.852 ≈ 1.51.
    cf = FE.correction_factor(150.0)
    assert cf == pytest.approx(1.511, abs=0.01)


def test_correction_factor_old_steel_c100_is_lower() -> None:
    # C=100 → factor < 1.0
    cf = FE.correction_factor(100.0)
    assert cf < 1.0
    assert cf == pytest.approx(0.71, abs=0.02)


def test_equiv_length_scales_with_c_actual() -> None:
    at_120 = FE.equiv_length_ft("elbow_90", 2.0, c_actual=120.0)
    at_150 = FE.equiv_length_ft("elbow_90", 2.0, c_actual=150.0)
    assert at_150 > at_120
    assert at_150 / at_120 == pytest.approx(FE.correction_factor(150.0), abs=0.005)


# ── aggregate helper ────────────────────────────────────────────

def test_total_equiv_length_with_string_list() -> None:
    fittings = ["elbow_90", "elbow_90", "tee_branch", "gate_valve"]
    total = FE.total_equiv_length_ft(fittings, size_in=2.0)
    # 5 + 5 + 10 + 1 = 21 ft at C=120
    assert total == pytest.approx(21.0)


def test_total_equiv_length_with_objects() -> None:
    class _F:
        def __init__(self, kind: str) -> None:
            self.kind = kind

    fittings = [_F("elbow_90"), _F("tee_branch"), _F("valve_osy_gate")]
    total = FE.total_equiv_length_ft(fittings, size_in=2.0)
    # 5 + 10 + 1 = 16 ft
    assert total == pytest.approx(16.0)


def test_total_equiv_length_skips_unknown_gracefully() -> None:
    fittings = ["elbow_90", "nonsense_fitting", "tee_branch"]
    total = FE.total_equiv_length_ft(fittings, size_in=2.0)
    # 5 + 0 + 10 = 15 ft
    assert total == pytest.approx(15.0)


def test_total_equiv_length_empty_returns_zero() -> None:
    assert FE.total_equiv_length_ft([], size_in=2.0) == 0.0

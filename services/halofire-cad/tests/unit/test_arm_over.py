"""Unit tests for obstruction-aware head placement (NFPA 13 §14.2.9)."""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]

_SPEC = importlib.util.spec_from_file_location(
    "arm_over", ROOT / "agents" / "02-placer" / "arm_over.py",
)
assert _SPEC is not None and _SPEC.loader is not None
AO = importlib.util.module_from_spec(_SPEC)
# Register in sys.modules BEFORE exec so dataclass forward refs
# ("Obstruction") resolve against this module.
sys.modules["arm_over"] = AO
_SPEC.loader.exec_module(AO)


def test_clear_position_is_unchanged() -> None:
    obs = [AO.Obstruction(0.0, 0.0, 1.0, 1.0)]
    r = AO.shift_for_obstructions(10.0, 10.0, obs)
    assert r.shifted is False
    assert r.reason == "clear"
    assert (r.x, r.y) == (10.0, 10.0)
    assert r.distance_m == 0.0


def test_head_inside_obstruction_is_pushed_out() -> None:
    # 0.6x0.6 column at origin, head placed right at its center
    obs = [AO.Obstruction(-0.3, -0.3, 0.3, 0.3)]
    r = AO.shift_for_obstructions(0.0, 0.0, obs, clearance_m=0.3)
    assert r.shifted is True
    # Must be outside the expanded 1.2×1.2 buffer
    buf = obs[0].expanded(0.3)
    assert not buf.contains(r.x, r.y)


def test_head_in_buffer_only_shifts_minimally() -> None:
    """A head 0.4 m from the column (buffer = 0.91 m) should move
    just far enough to clear — ~0.51 m, not a full meter."""
    obs = [AO.Obstruction(0.0, 0.0, 1.0, 1.0)]
    r = AO.shift_for_obstructions(1.4, 0.5, obs)  # 0.4 m east of column
    assert r.shifted is True
    # Expanded buffer runs to x = 1.91. Head at 1.4 moves +dx = 0.51
    assert pytest.approx(r.x, abs=0.02) == 1.91
    assert pytest.approx(r.distance_m, abs=0.02) == 0.51


def test_over_max_shift_gives_up_and_flags() -> None:
    # Huge obstruction — escape distance exceeds MAX_SHIFT_M
    big = AO.Obstruction(0.0, 0.0, 10.0, 10.0)
    # Head deep inside — 5 m from every edge
    r = AO.shift_for_obstructions(5.0, 5.0, [big], clearance_m=0.5)
    assert r.shifted is False
    assert r.reason == "over_max_shift"
    assert r.distance_m > AO.MAX_SHIFT_M


def test_two_overlapping_buffers_resolve() -> None:
    a = AO.Obstruction(0.0, 0.0, 1.0, 1.0)
    b = AO.Obstruction(1.8, 0.0, 2.8, 1.0)
    # Head sits between them — within buffer of both
    r = AO.shift_for_obstructions(1.4, 0.5, [a, b], clearance_m=0.5)
    # Either clear or flagged — as long as we don't loop forever
    if r.shifted:
        buf_a = a.expanded(0.5)
        buf_b = b.expanded(0.5)
        assert not buf_a.contains(r.x, r.y)
        assert not buf_b.contains(r.x, r.y)


def test_edge_of_expanded_buffer_is_not_inside() -> None:
    # Head exactly on the clearance radius should be treated as clear.
    obs = [AO.Obstruction(0.0, 0.0, 1.0, 1.0)]
    # Exactly 0.91 m east of the column's east edge
    r = AO.shift_for_obstructions(1.0 + AO.DEFAULT_CLEARANCE_M + 0.001,
                                  0.5, obs)
    assert r.shifted is False
    assert r.reason == "clear"


def test_shift_result_is_frozen_dataclass() -> None:
    r = AO.ShiftResult(x=0.0, y=0.0, shifted=False,
                       distance_m=0.0, reason="clear")
    with pytest.raises(Exception):  # noqa: PT011 — frozen dataclass raises
        r.x = 1.0  # type: ignore[misc]


def test_obstruction_expanded_grows_outward_by_clearance() -> None:
    o = AO.Obstruction(5.0, 5.0, 6.0, 6.0)
    e = o.expanded(0.5)
    assert e.x0 == 4.5 and e.y0 == 4.5
    assert e.x1 == 6.5 and e.y1 == 6.5


def test_contains_is_strictly_inside() -> None:
    """Edges count as CLEAR so shifts that land on the boundary don't
    re-trigger on the next iteration."""
    o = AO.Obstruction(0.0, 0.0, 1.0, 1.0)
    assert o.contains(0.5, 0.5) is True     # interior
    assert o.contains(0.0, 0.0) is False    # corner is clear
    assert o.contains(1.0, 0.5) is False    # edge is clear
    assert o.contains(1.01, 0.5) is False   # outside


def test_empty_obstructions_is_noop() -> None:
    r = AO.shift_for_obstructions(42.0, 17.0, [])
    assert r.shifted is False
    assert (r.x, r.y) == (42.0, 17.0)

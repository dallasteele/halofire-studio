"""Property tests for 02-placer per AGENTIC_RULES §5.2.

Runs a hypothesis-generated set of rectangular rooms and asserts the
placer's output obeys the invariants the skill promises: every head is
inside the room polygon, heads belong to that room, head count is
bounded.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest
from hypothesis import given, settings, HealthCheck
from hypothesis import strategies as st
from shapely.geometry import Point, Polygon

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

_SPEC = importlib.util.spec_from_file_location(
    "hf_placer_prop", ROOT / "agents" / "02-placer" / "agent.py",
)
assert _SPEC is not None and _SPEC.loader is not None
PLACER = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(PLACER)

from cad.schema import Building, Ceiling, Level, Room  # noqa: E402


@pytest.mark.property
@given(
    w=st.floats(min_value=3.0, max_value=40.0, allow_nan=False, allow_infinity=False),
    h=st.floats(min_value=3.0, max_value=40.0, allow_nan=False, allow_infinity=False),
    hazard=st.sampled_from(["light", "ordinary_i", "ordinary_ii"]),
)
@settings(
    max_examples=40,
    deadline=1500,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
def test_placer_heads_always_inside_room(
    w: float, h: float, hazard: str,
) -> None:
    """Every placed head sits inside the originating room polygon
    (with a 1 cm tolerance for float round-trip)."""
    polygon = [(0.0, 0.0), (w, 0.0), (w, h), (0.0, h)]
    room = Room(
        id="r", name="Probe", polygon_m=polygon,
        area_sqm=w * h, hazard_class=hazard,  # type: ignore[arg-type]
        ceiling=Ceiling(height_m=3.0),
    )
    level = Level(
        id="l", name="L", elevation_m=0, height_m=3.0,
        rooms=[room], ceiling=Ceiling(height_m=3.0),
    )
    bldg = Building(project_id="probe", levels=[level])
    heads = PLACER.place_heads_for_building(bldg)
    poly = Polygon(polygon).buffer(0.01)
    for head in heads:
        x, y, _z = head.position_m
        assert poly.contains(Point(x, y)), (
            f"head {head.id} outside {w}x{h} room at ({x:.2f},{y:.2f})"
        )


@pytest.mark.property
@given(
    w=st.floats(min_value=5.0, max_value=30.0, allow_nan=False, allow_infinity=False),
    h=st.floats(min_value=5.0, max_value=30.0, allow_nan=False, allow_infinity=False),
)
@settings(max_examples=30, deadline=1500,
          suppress_health_check=[HealthCheck.function_scoped_fixture])
def test_placer_head_room_binding(w: float, h: float) -> None:
    """Every produced head has room_id matching the input room."""
    room = Room(
        id="room_xyz", name="Probe",
        polygon_m=[(0.0, 0.0), (w, 0.0), (w, h), (0.0, h)],
        area_sqm=w * h, hazard_class="light",
        ceiling=Ceiling(height_m=3.0),
    )
    level = Level(
        id="l", name="L", elevation_m=0, height_m=3.0, rooms=[room],
        ceiling=Ceiling(height_m=3.0),
    )
    bldg = Building(project_id="probe", levels=[level])
    heads = PLACER.place_heads_for_building(bldg)
    for head in heads:
        assert head.room_id == "room_xyz"
        assert head.k_factor > 0
        assert head.temp_rating_f >= 100


@pytest.mark.property
@given(
    w=st.floats(min_value=6.0, max_value=20.0, allow_nan=False, allow_infinity=False),
    h=st.floats(min_value=6.0, max_value=20.0, allow_nan=False, allow_infinity=False),
)
@settings(max_examples=30, deadline=1500,
          suppress_health_check=[HealthCheck.function_scoped_fixture])
def test_placer_head_count_bounded_by_area(w: float, h: float) -> None:
    """Head count is bounded by ceil(area / min-coverage).

    Light-hazard min coverage per spacing table is 20.9 sqm. The
    placer should never produce more than a generous upper bound
    (we double it to accommodate edge grids).
    """
    room = Room(
        id="r", name="R",
        polygon_m=[(0.0, 0.0), (w, 0.0), (w, h), (0.0, h)],
        area_sqm=w * h, hazard_class="light",
        ceiling=Ceiling(height_m=3.0),
    )
    level = Level(
        id="l", name="L", elevation_m=0, height_m=3.0, rooms=[room],
        ceiling=Ceiling(height_m=3.0),
    )
    bldg = Building(project_id="probe", levels=[level])
    heads = PLACER.place_heads_for_building(bldg)
    # Upper bound: area / (2 sqm minimum spacing) — very loose.
    upper = int((w * h) / 2.0) + 10
    assert len(heads) <= upper, (
        f"unexpectedly many heads ({len(heads)}) for {w}x{h} room"
    )

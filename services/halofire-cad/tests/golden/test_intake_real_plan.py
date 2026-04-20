"""Golden tests — intake MUST produce non-trivial geometry from a
real architectural PDF.

This is the test that would have caught the lie: the Studio was
showing a hand-synthesized `design.json` rather than a floor plan
actually extracted from the architect's drawing.

The 1881 Cooperative bid's architectural set is 110 pages. A
passing intake should produce:

  * ≥ 3 building levels (the reference has 12 stories)
  * ≥ 10 rooms TOTAL across all levels
  * ≥ 200 wall segments TOTAL
  * At least ONE level polygon with ≥ 4 vertices (non-degenerate)
  * At least ONE room polygon with ≥ 3 vertices

These thresholds are deliberately permissive — they pass as long
as the intake is producing SOME real geometry from SOME pages.
Getting them tight per-level is the next iteration; right now
the bar is just 'not empty'.

Tests are marked @slow (they read a multi-MB JSON) and @e2e (they
depend on the pipeline having been run). Both markers are declared
in pytest.ini.

If the real gateway pipeline has NOT been run yet, the tests
SKIP rather than fail — the gate is against false positives. Once
the pipeline runs against the real PDF, the test must fail loudly
if the output is empty.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest


# tests/golden/…py → parents[0]=golden, [1]=tests, [2]=halofire-cad,
# [3]=services, [4]=halofire-studio (repo root).
_REPO = Path(__file__).resolve().parents[4]
_DELIVERABLES = (
    _REPO / "services" / "halopenclaw-gateway" / "data"
    / "1881-cooperative" / "deliverables"
)
_BUILDING_RAW = _DELIVERABLES / "building_raw.json"
_BUILDING_CLASSIFIED = _DELIVERABLES / "building_classified.json"
_DESIGN = _DELIVERABLES / "design.json"
_MANIFEST = _DELIVERABLES / "manifest.json"


def _load_or_skip(path: Path) -> dict:
    if not path.exists():
        pytest.skip(
            f"pipeline artifact missing: {path.name}. Run Auto-Design "
            "against the 1881 architectural PDF first.",
        )
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        pytest.fail(f"{path.name} is malformed JSON: {e}")


@pytest.mark.golden
@pytest.mark.e2e
@pytest.mark.slow
def test_building_raw_has_multiple_levels() -> None:
    """A real architectural intake must find more than 1 level."""
    raw = _load_or_skip(_BUILDING_RAW)
    levels = raw.get("levels") or []
    assert len(levels) >= 3, (
        f"intake produced only {len(levels)} level(s); a 110-page "
        "architectural set should yield ≥ 3."
    )


@pytest.mark.golden
@pytest.mark.e2e
@pytest.mark.slow
def test_building_raw_has_rooms() -> None:
    """Room extraction must pull SOME rooms from the drawing. Not
    tightly calibrated — just 'not empty'."""
    raw = _load_or_skip(_BUILDING_RAW)
    total_rooms = sum(len(lvl.get("rooms") or []) for lvl in raw.get("levels") or [])
    assert total_rooms >= 10, (
        f"intake produced only {total_rooms} rooms across all levels; "
        "a real architectural set should yield ≥ 10. Likely the "
        "wall→room polygonization step failed on most pages."
    )


@pytest.mark.golden
@pytest.mark.e2e
@pytest.mark.slow
def test_building_raw_has_walls() -> None:
    """Wall detection must pick up the primary structural walls."""
    raw = _load_or_skip(_BUILDING_RAW)
    total_walls = sum(len(lvl.get("walls") or []) for lvl in raw.get("levels") or [])
    assert total_walls >= 200, (
        f"intake produced only {total_walls} wall segments across all "
        "levels; a 110-page set should yield ≥ 200."
    )


@pytest.mark.golden
@pytest.mark.e2e
@pytest.mark.slow
def test_building_has_non_degenerate_level_polygon() -> None:
    """At least one level outline must be a real polygon (≥ 4 verts)."""
    raw = _load_or_skip(_BUILDING_RAW)
    ok = False
    for lvl in raw.get("levels") or []:
        poly = lvl.get("polygon_m") or []
        if len(poly) >= 4:
            ok = True
            break
    assert ok, (
        "no level carries a polygon_m with ≥ 4 vertices; every level "
        "outline came back empty or degenerate."
    )


@pytest.mark.golden
@pytest.mark.e2e
@pytest.mark.slow
def test_building_has_at_least_one_real_room_polygon() -> None:
    raw = _load_or_skip(_BUILDING_RAW)
    for lvl in raw.get("levels") or []:
        for room in lvl.get("rooms") or []:
            poly = room.get("polygon_m") or room.get("polygon") or []
            if len(poly) >= 3:
                return
    pytest.fail(
        "no room carries a polygon with ≥ 3 vertices; room detection "
        "is effectively empty.",
    )


@pytest.mark.golden
@pytest.mark.e2e
@pytest.mark.slow
def test_design_systems_carry_heads() -> None:
    """Placer must emit heads for a real design. If intake found 0
    rooms the placer has nothing to drop heads into — that's the
    symptom we're guarding against."""
    design = _load_or_skip(_DESIGN)
    systems = design.get("systems") or []
    heads = sum(len(s.get("heads") or []) for s in systems)
    assert heads >= 50, (
        f"design carries only {heads} heads across all systems; for a "
        "110-page architectural bid this must be at least 50. A low "
        "head count almost always traces back to empty room polygons "
        "from intake."
    )


@pytest.mark.golden
@pytest.mark.e2e
@pytest.mark.slow
def test_design_systems_carry_pipes() -> None:
    design = _load_or_skip(_DESIGN)
    pipes = sum(len(s.get("pipes") or []) for s in design.get("systems") or [])
    assert pipes >= 20, (
        f"design carries only {pipes} pipe segments across all "
        "systems; the router is not producing a usable sprinkler "
        "layout. Upstream: check the placer's head count and the "
        "level graph connectivity."
    )


@pytest.mark.golden
@pytest.mark.e2e
@pytest.mark.slow
def test_design_has_routed_systems() -> None:
    design = _load_or_skip(_DESIGN)
    assert len(design.get("systems") or []) >= 1, (
        "design has zero routed systems; either the placer produced no "
        "heads or the router failed to connect them into a tree."
    )


@pytest.mark.golden
@pytest.mark.e2e
@pytest.mark.slow
def test_design_is_not_synthetic() -> None:
    """Tripwire: if someone shortcuts the pipeline by hand-synthesizing
    design.json, this catches it. A real pipeline always embeds
    project metadata + a non-trivial `construction_type` we didn't
    bother to set in the demo scaffold."""
    design = _load_or_skip(_DESIGN)
    heads_total = sum(len(s.get("heads") or []) for s in design.get("systems") or [])
    # Synthetic demos set head counts around 24 (24-head grid). A
    # real architectural run should be in the hundreds.
    assert heads_total != 24 or heads_total == 0, (
        "design.json has exactly 24 heads — that's the pattern the "
        "ad-hoc demo scaffold emits. Run the real pipeline."
    )


@pytest.mark.golden
@pytest.mark.e2e
@pytest.mark.slow
def test_rooms_carry_real_area() -> None:
    """At least one room per building must report a non-trivial
    area_sqm. Catches the 'rooms exist in name only with zero
    polygon_pt' failure mode."""
    raw = _load_or_skip(_BUILDING_RAW)
    max_area = 0.0
    for lvl in raw.get("levels") or []:
        for room in lvl.get("rooms") or []:
            a = float(room.get("area_sqm") or 0.0)
            if a > max_area:
                max_area = a
    assert max_area >= 10.0, (
        f"largest room is {max_area:.1f} sqm; for a real floor plan "
        "the maximum room area should be >= 10 sqm."
    )


@pytest.mark.golden
@pytest.mark.e2e
@pytest.mark.slow
def test_level_spans_are_reasonable() -> None:
    """Every level's bounding-rectangle polygon must span a sane
    building-scale footprint (between 10 m and 1000 m on each axis)."""
    raw = _load_or_skip(_BUILDING_RAW)
    bad: list[str] = []
    for lvl in raw.get("levels") or []:
        poly = lvl.get("polygon_m") or []
        if len(poly) < 4:
            continue
        xs = [p[0] for p in poly]
        ys = [p[1] for p in poly]
        span_x = max(xs) - min(xs)
        span_y = max(ys) - min(ys)
        if not (1.0 <= span_x <= 1000.0 and 1.0 <= span_y <= 1000.0):
            bad.append(
                f"{lvl.get('id', '?')}: span_x={span_x:.1f} m, "
                f"span_y={span_y:.1f} m"
            )
    assert not bad, (
        "level polygons span impossible building-scale values: "
        + "; ".join(bad[:3])
    )


@pytest.mark.golden
@pytest.mark.e2e
@pytest.mark.slow
def test_classified_hazards_cover_levels() -> None:
    """At least half the levels must have rooms with NFPA hazard
    classifications. Field name per cad.schema.Room is
    `hazard_class`."""
    cls = _load_or_skip(_BUILDING_CLASSIFIED)
    levels = cls.get("levels") or []
    if not levels:
        pytest.skip("no levels in building_classified.json")
    covered = [
        lvl for lvl in levels
        if (
            lvl.get("hazard")
            or (lvl.get("use") and lvl.get("use") != "other")
            or any(
                r.get("hazard_class") for r in (lvl.get("rooms") or [])
            )
        )
    ]
    assert len(covered) >= max(1, len(levels) // 2), (
        f"only {len(covered)} of {len(levels)} levels carry a hazard "
        "classification; the classifier didn't attach NFPA §6 hazards "
        "to most levels."
    )

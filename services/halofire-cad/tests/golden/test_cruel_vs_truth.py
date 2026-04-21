"""Cruel tests — compare pipeline output to ground-truth numbers
Halo actually submitted, not to made-up absolute thresholds.

These are allowed to fail for now. Each failure prints the delta
vs truth so the next engineer sees EXACTLY how far off we are.
Phase 2 of SELF_TRAIN_PLAN.md. The ratchet moves forward only
when the delta shrinks.

Skip semantics:
  * If truth.duckdb is empty (fresh clone, no seed) → skip.
  * If the pipeline hasn't run → skip (load_or_skip pattern).
  * Otherwise → report delta and assert it's within tolerance.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

# _HERE is services/halofire-cad/tests/golden/. parents[0]=tests,
# [1]=halofire-cad, [2]=services, [3]=halofire-studio (repo root).
_HERE = Path(__file__).resolve().parent
_REPO = _HERE.parents[3]
sys.path.insert(0, str(_HERE.parents[1]))  # services/halofire-cad

try:
    from truth.db import open_db, truth_for  # noqa: E402
except Exception:  # noqa: BLE001
    pytest.skip(
        "truth DB unavailable; seed via services/halofire-cad/truth/seed_1881.py",
        allow_module_level=True,
    )

_DELIVERABLES = (
    _REPO / "services" / "halopenclaw-gateway" / "data"
    / "1881-cooperative" / "deliverables"
)
_DESIGN = _DELIVERABLES / "design.json"
_PROPOSAL = _DELIVERABLES / "proposal.json"
_BUILDING_RAW = _DELIVERABLES / "building_raw.json"


def _truth_or_skip():
    t = truth_for("1881-cooperative")
    if t is None:
        pytest.skip(
            "No truth seeded for 1881-cooperative; run "
            "`python services/halofire-cad/truth/seed_1881.py`.",
        )
    return t


def _load_or_skip(path: Path) -> dict:
    if not path.exists():
        pytest.skip(f"pipeline artifact missing: {path.name}.")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        pytest.fail(f"{path.name} is malformed JSON: {e}")


def _delta(actual: float, truth: float) -> float:
    """Ratio |actual - truth| / truth. Zero when exactly matching."""
    if truth == 0:
        return float("inf") if actual != 0 else 0.0
    return abs(actual - truth) / abs(truth)


# ── counts ───────────────────────────────────────────────────────

@pytest.mark.cruel
@pytest.mark.golden
@pytest.mark.e2e
def test_head_count_within_15pct_of_truth() -> None:
    """Our placer's head_count must be within ±15% of what Halo
    shipped. 1881 truth: 1303 heads. Current pipeline output
    landed at ~583. That's ~55% under — a real failure."""
    truth = _truth_or_skip()
    if truth.head_count is None:
        pytest.skip("truth.head_count is null")
    design = _load_or_skip(_DESIGN)
    actual = sum(len(s.get("heads") or []) for s in design.get("systems") or [])
    delta = _delta(actual, truth.head_count)
    assert delta <= 0.15, (
        f"head_count: actual={actual}, truth={truth.head_count}, "
        f"delta={delta:.0%} (tolerance 15%). "
        "Fix the placer to cover more rooms + honor NFPA §8.6 "
        "spacing."
    )


@pytest.mark.cruel
@pytest.mark.golden
@pytest.mark.e2e
def test_system_count_matches_truth() -> None:
    """Halo split 1881 into 7 systems (garage dry + wet ceilings).
    Our router should pick up at least that many zones."""
    truth = _truth_or_skip()
    if truth.system_count is None:
        pytest.skip("truth.system_count is null")
    design = _load_or_skip(_DESIGN)
    actual = len(design.get("systems") or [])
    # Systems are the zoning decision — tight tolerance.
    assert actual == truth.system_count, (
        f"system_count: actual={actual}, truth={truth.system_count}. "
        "Zoning decisions (wet/dry/standpipe/per-level) must match "
        "the human designer's split exactly or the bid is mis-scoped."
    )


@pytest.mark.cruel
@pytest.mark.golden
@pytest.mark.e2e
def test_level_count_matches_truth() -> None:
    truth = _truth_or_skip()
    if truth.level_count is None:
        pytest.skip("truth.level_count is null")
    raw = _load_or_skip(_BUILDING_RAW)
    actual = len(raw.get("levels") or [])
    assert actual == truth.level_count, (
        f"level_count: actual={actual}, truth={truth.level_count}. "
        "Title-block OCR is supposed to drive level detection; "
        "losing or inventing levels = wrong bid."
    )


# ── pricing ─────────────────────────────────────────────────────

@pytest.mark.cruel
@pytest.mark.golden
@pytest.mark.e2e
def test_total_bid_within_15pct_of_truth() -> None:
    """Bid price within ±15% of Halo's actual quote.
    1881 truth: $538,792.35. Current pipeline output around $145k
    (~73% under). The gap is a head-count cascade: fewer heads →
    fewer pipes → lower labor."""
    truth = _truth_or_skip()
    if truth.total_bid_usd is None:
        pytest.skip("truth.total_bid_usd is null")
    proposal = _load_or_skip(_PROPOSAL)
    actual = float((proposal.get("pricing") or {}).get("total_usd") or 0.0)
    delta = _delta(actual, float(truth.total_bid_usd))
    assert delta <= 0.15, (
        f"total_bid_usd: actual=${actual:,.2f}, "
        f"truth=${truth.total_bid_usd:,.2f}, delta={delta:.0%} "
        "(tolerance 15%). Cascades from head_count + pipe_total_ft "
        "accuracy — fix those first."
    )


@pytest.mark.cruel
@pytest.mark.golden
@pytest.mark.e2e
def test_pipe_total_ft_within_20pct_of_truth() -> None:
    truth = _truth_or_skip()
    if truth.pipe_total_ft is None:
        pytest.skip(
            "truth.pipe_total_ft is null — Phase 1b needs as-built "
            "DWG parse to fill this in.",
        )
    design = _load_or_skip(_DESIGN)
    total_m = 0.0
    for s in design.get("systems") or []:
        for p in s.get("pipes") or []:
            total_m += float(p.get("length_m") or 0.0)
    actual_ft = total_m * 3.281
    delta = _delta(actual_ft, float(truth.pipe_total_ft))
    assert delta <= 0.20, (
        f"pipe_total_ft: actual={actual_ft:.0f} ft, "
        f"truth={truth.pipe_total_ft:.0f} ft, delta={delta:.0%} "
        "(tolerance 20%)."
    )


# ── hydraulics ──────────────────────────────────────────────────

@pytest.mark.cruel
@pytest.mark.golden
@pytest.mark.e2e
def test_hydraulic_gpm_within_10pct_of_truth() -> None:
    truth = _truth_or_skip()
    if truth.hydraulic_gpm is None:
        pytest.skip(
            "truth.hydraulic_gpm is null — Phase 1b loads it from "
            "the approved hydraulic calc PDF.",
        )
    design = _load_or_skip(_DESIGN)
    # Take the worst-case (max) demand across all systems
    demands = [
        float((s.get("hydraulic") or {}).get("required_flow_gpm") or 0.0)
        for s in design.get("systems") or []
    ]
    actual = max(demands) if demands else 0.0
    delta = _delta(actual, float(truth.hydraulic_gpm))
    assert delta <= 0.10, (
        f"hydraulic_gpm: actual={actual:.0f}, "
        f"truth={truth.hydraulic_gpm:.0f}, delta={delta:.0%} "
        "(tolerance 10%)."
    )


# ── intake quality ──────────────────────────────────────────────

@pytest.mark.cruel
@pytest.mark.golden
def test_no_level_has_more_than_300_walls() -> None:
    """A real residential floor plan has 50-150 wall runs after
    chaining. Pages where CubiCasa returns 900+ walls are almost
    always misreading dimension hatching, exit signage, or section
    cut lines as walls. The downstream visualizer renders each as a
    300mm × 3m extruded box — a 900-wall page produces a porcupine.

    Threshold: > 300 walls/level = noise. The intake's wall
    pairing/chaining should compress these into runs."""
    _truth_or_skip()
    if not _DESIGN.exists():
        pytest.skip("design.json missing")
    design = json.loads(_DESIGN.read_text(encoding="utf-8"))
    bad: list[tuple[str, int]] = []
    for lvl in design.get("building", {}).get("levels", []):
        n = len(lvl.get("walls") or [])
        if n > 300:
            bad.append((lvl.get("name", "?"), n))
    if bad:
        details = ", ".join(f"{n}={c} walls" for n, c in bad)
        raise AssertionError(
            f"{len(bad)} level(s) have > 300 walls — CubiCasa is "
            f"reading dimension hatching as walls. Wall-chaining or "
            f"a per-level wall cap would help: {details}"
        )


@pytest.mark.cruel
@pytest.mark.golden
def test_router_emits_real_hierarchy() -> None:
    """Real fire sprinkler systems are 3-tier: heads → branches →
    cross-mains → riser. Per NFPA 13 § 13.2.4, every system needs
    branches AND cross-mains AND a riser nipple. A flat Steiner
    output (only 'branch' + 'riser_nipple') means there's no
    cross-main consolidation — the BOM has zero 2.5"+ pipe and the
    drawing has no trunk to follow.

    Cruel test: every system must have >= 1 cross_main pipe AND
    >= 1 drop. Today the Steiner router emits 0 of each → FAIL
    until iter-7 router rewrite lands."""
    _truth_or_skip()
    if not _DESIGN.exists():
        pytest.skip("design.json missing")
    design = json.loads(_DESIGN.read_text(encoding="utf-8"))
    bad: list[str] = []
    for sys in design.get("systems", []):
        roles: dict[str, int] = {}
        for p in sys.get("pipes") or []:
            r = p.get("role") or "unset"
            roles[r] = roles.get(r, 0) + 1
        if roles.get("cross_main", 0) < 1 or roles.get("drop", 0) < 1:
            bad.append(f"{sys.get('id', '?')}: {roles}")
    if bad:
        raise AssertionError(
            f"{len(bad)} system(s) emit a flat Steiner tree (no "
            f"cross-mains or no drops): {'; '.join(bad[:3])}"
        )


@pytest.mark.cruel
@pytest.mark.golden
def test_pipes_are_classified_by_role() -> None:
    """Real fire-protection drawings name every pipe by its role —
    drop, branch, cross-main, main, riser-nipple. AutoSPRINK does
    this via Smart Pipe; the BOM groups by role; the drawing
    color-codes by role.

    Cruel test: design.json's `systems[].pipes[].role` should be one
    of {drop, branch, cross_main, main, riser_nipple} for at least
    90 % of pipes. Today every pipe is unset/'branch' — this test
    fails until the router classifies."""
    _truth_or_skip()
    if not _DESIGN.exists():
        pytest.skip("design.json missing")
    design = json.loads(_DESIGN.read_text(encoding="utf-8"))
    valid = {"drop", "branch", "cross_main", "main", "riser_nipple"}
    total = 0
    classified = 0
    role_counts: dict[str, int] = {}
    for sys in design.get("systems", []):
        for p in sys.get("pipes") or []:
            total += 1
            r = p.get("role") or ""
            role_counts[r] = role_counts.get(r, 0) + 1
            if r in valid:
                classified += 1
    if total == 0:
        pytest.skip("no pipes in design.json")
    frac = classified / total
    if frac < 0.90:
        raise AssertionError(
            f"Only {classified}/{total} pipes ({frac:.0%}) classified "
            f"with a valid role. Role counts: {role_counts}. Need "
            f"Smart Pipe-style classification before BOM grouping "
            f"and color-coded visualization can land."
        )


@pytest.mark.cruel
@pytest.mark.golden
def test_each_kept_level_has_realistic_polygon_area() -> None:
    """Every level the intake KEEPS must have a realistic floor-plate
    area. < 100 sqm means `_trace_outer_boundary_m` fell into a tiny
    micro-loop CubiCasa accidentally closed (a corner detail or a
    label box) instead of the building outline. Convex hull is the
    safer fallback in that case.

    1881 floor plates are 1 000-2 500 sqm; we use 100 sqm as the
    minimum-realistic threshold (a parking ramp closet).
    """
    _truth_or_skip()
    if not _DESIGN.exists():
        pytest.skip("design.json missing")
    design = json.loads(_DESIGN.read_text(encoding="utf-8"))
    from shapely.geometry import Polygon
    bad: list[tuple[str, float]] = []
    for lvl in design.get("building", {}).get("levels", []):
        poly = lvl.get("polygon_m") or []
        if len(poly) < 3:
            bad.append((lvl.get("name", "?"), 0.0))
            continue
        try:
            a = Polygon(poly).area
        except Exception:  # noqa: BLE001
            a = 0.0
        if a < 100.0:
            bad.append((lvl.get("name", "?"), a))
    if bad:
        details = ", ".join(f"{n}={a:.1f}sqm" for n, a in bad)
        raise AssertionError(
            f"{len(bad)} level(s) have polygon area < 100 sqm "
            f"(intake outline failed → falling back to convex hull "
            f"would help): {details}"
        )


# ── viewport coherence (UI side, run separately as smoke test) ──

# (Slab-thickness check is a UI-side concern — Pascal's SlabNode
#  uses `elevation` as the slab thickness, NOT the floor's height
#  above ground. Setting it to 30 m for the top floor produced
#  30 m-thick concrete blocks instead of 0.2 m slabs. The fix lives
#  in apps/editor/components/halofire/AutoDesignPanel.tsx — slab
#  elevation is hardcoded to 0.2 m and Pascal's level-system handles
#  vertical stacking via LevelNode.level.)


# ── interior detail ─────────────────────────────────────────────

@pytest.mark.cruel
@pytest.mark.golden
def test_levels_have_columns_or_obstructions() -> None:
    """A real residential or commercial floor has 6-30 structural
    columns (parking decks have grids, towers have a core + outer
    columns). Pages with 0 obstructions and 0 columns mean intake
    didn't synthesize the column grid — the visualization will
    look hollow and the placer's coverage analysis can't dodge
    spray shadows.
    """
    _truth_or_skip()
    if not _DESIGN.exists():
        pytest.skip("design.json missing")
    design = json.loads(_DESIGN.read_text(encoding="utf-8"))
    bad: list[str] = []
    for lvl in design.get("building", {}).get("levels", []):
        obs = lvl.get("obstructions") or []
        col_count = sum(1 for o in obs if o.get("kind") == "column")
        if col_count < 1:
            bad.append(f"{lvl.get('name', '?')}: 0 columns")
    if bad:
        raise AssertionError(
            f"{len(bad)} level(s) have no columns: "
            f"{'; '.join(bad[:5])}"
        )


# ── stack coherence ─────────────────────────────────────────────

@pytest.mark.cruel
@pytest.mark.golden
def test_floor_plates_have_similar_footprint() -> None:
    """A real high-rise has consistent floor plates — residential
    floors above the podium share the same outline. Stacking widely
    different polygons per page produces a Jenga tower of mismatched
    slabs, not a building.

    Test: every level's polygon area must be within 50 % of the
    median area. This forces the intake (or downstream level
    canonicalization) to pick a representative footprint and reuse
    it instead of letting per-page CubiCasa noise dictate every
    floor's shape.
    """
    _truth_or_skip()
    if not _DESIGN.exists():
        pytest.skip("design.json missing")
    design = json.loads(_DESIGN.read_text(encoding="utf-8"))
    from shapely.geometry import Polygon
    areas: list[tuple[str, float]] = []
    for lvl in design.get("building", {}).get("levels", []):
        poly = lvl.get("polygon_m") or []
        a = Polygon(poly).area if len(poly) >= 3 else 0.0
        areas.append((lvl.get("name", "?"), a))
    if not areas:
        pytest.skip("no levels")
    sorted_areas = sorted(a for _, a in areas)
    median = sorted_areas[len(sorted_areas) // 2]
    if median <= 0:
        pytest.skip("zero-area median")
    bad = [
        (n, a) for n, a in areas
        if abs(a - median) / median > 0.5
    ]
    if bad:
        details = ", ".join(f"{n}={a:.0f}sqm" for n, a in bad)
        raise AssertionError(
            f"{len(bad)} level(s) have area > 50 % off median "
            f"({median:.0f} sqm). Use one canonical floor polygon "
            f"per podium-tier instead of per-page CubiCasa noise. "
            f"Outliers: {details}"
        )


# ── completeness ────────────────────────────────────────────────

@pytest.mark.cruel
@pytest.mark.golden
def test_level_count_within_25pct_of_truth() -> None:
    """The previous test (test_level_count_matches_truth) demands
    EXACT match, which fails when CubiCasa fumbles a few residential
    floors. Within ±25 % is what an estimator would tolerate from a
    first-pass auto-bid that the human will correct upstairs.
    """
    _truth_or_skip()
    if not _DESIGN.exists():
        pytest.skip("design.json missing")
    design = json.loads(_DESIGN.read_text(encoding="utf-8"))
    actual = len(design.get("building", {}).get("levels", []))
    truth = truth_for("1881-cooperative").level_count
    delta = abs(actual - truth) / truth
    assert delta <= 0.25, (
        f"level_count {actual} vs truth {truth} = {delta:.0%} "
        f"(tolerance 25 %). Synthesize fumbled floors before claiming "
        f"a complete bid."
    )


# ── geometry sanity ─────────────────────────────────────────────

@pytest.mark.cruel
@pytest.mark.golden
def test_drops_are_short_vertical() -> None:
    """A 'drop' pipe is the short vertical sprig from ceiling to head
    deflector. NFPA-13 + estimator convention: 1-12 inches (0.025 -
    0.30 m). If a "drop" is multi-metres long it means we mis-rotated
    a horizontal pipe through the axis-flip bug or routed a head's
    drop across the building.
    """
    _truth_or_skip()
    if not _DESIGN.exists():
        pytest.skip("design.json missing")
    design = json.loads(_DESIGN.read_text(encoding="utf-8"))
    bad: list[tuple[str, float, float, float, float, float, float]] = []
    for sys in design.get("systems", []):
        for p in sys.get("pipes") or []:
            if p.get("role") != "drop":
                continue
            s = p.get("start_m") or [0, 0, 0]
            e = p.get("end_m") or [0, 0, 0]
            dx = e[0] - s[0]
            dy = e[1] - s[1]
            dz = e[2] - s[2]
            horizontal = (dx * dx + dy * dy) ** 0.5
            vertical = abs(dz)
            # Drop should be: vertical >> horizontal, |dz| < 1 m
            if vertical > 1.5 or horizontal > 0.2:
                bad.append((p["id"], *s, *e))
    if bad:
        sample = bad[:3]
        raise AssertionError(
            f"{len(bad)} 'drop' pipe(s) aren't short verticals. "
            f"Sample: {sample}"
        )


@pytest.mark.cruel
@pytest.mark.golden
def test_pipes_within_building_envelope() -> None:
    """No pipe should be outside the building bbox. After the axis-
    flip bug, a "horizontal" cross-main spanning plan-Y 0→160 m
    would sit at three.js Y=160 m — way above the building. This
    test catches that by asserting every pipe endpoint Z (elevation)
    is within [0, top_floor + 5 m].
    """
    _truth_or_skip()
    if not _DESIGN.exists():
        pytest.skip("design.json missing")
    design = json.loads(_DESIGN.read_text(encoding="utf-8"))
    levels = design.get("building", {}).get("levels", [])
    if not levels:
        pytest.skip("no levels")
    max_elev = max(
        (lvl.get("elevation_m", 0) + lvl.get("height_m", 3)) for lvl in levels
    )
    bad: list[tuple[str, float]] = []
    for sys in design.get("systems", []):
        for p in sys.get("pipes") or []:
            for end_label, end in (("start", p.get("start_m")), ("end", p.get("end_m"))):
                if not end:
                    continue
                z = end[2]
                if z < -0.5 or z > max_elev + 5.0:
                    bad.append((f"{p['id']}.{end_label}", z))
    if bad:
        sample = bad[:5]
        raise AssertionError(
            f"{len(bad)} pipe endpoint(s) outside building Z-envelope "
            f"(0 ≤ z ≤ {max_elev + 5:.1f} m). Sample: {sample}"
        )


@pytest.mark.cruel
@pytest.mark.golden
def test_cross_mains_are_horizontal() -> None:
    """Cross-mains run horizontally at ceiling height. After axis
    fix, |dz| should be tiny (< 0.5 m) and horizontal length 1-50 m.
    A cross-main with dz=160m means the axis flip regressed.
    """
    _truth_or_skip()
    if not _DESIGN.exists():
        pytest.skip("design.json missing")
    design = json.loads(_DESIGN.read_text(encoding="utf-8"))
    bad: list[tuple[str, float, float]] = []
    for sys in design.get("systems", []):
        for p in sys.get("pipes") or []:
            if p.get("role") != "cross_main":
                continue
            s = p.get("start_m") or [0, 0, 0]
            e = p.get("end_m") or [0, 0, 0]
            dx = e[0] - s[0]
            dy = e[1] - s[1]
            dz = e[2] - s[2]
            horizontal = (dx * dx + dy * dy) ** 0.5
            if abs(dz) > 0.5:
                bad.append((p["id"], horizontal, dz))
    if bad:
        sample = bad[:3]
        raise AssertionError(
            f"{len(bad)} 'cross_main' pipe(s) have |dz| > 0.5 m "
            f"(should be horizontal). Sample (id, horiz, dz): {sample}"
        )


# ── corrections accounting ──────────────────────────────────────

@pytest.mark.cruel
@pytest.mark.golden
def test_open_corrections_count_under_threshold() -> None:
    """Exit criterion for Internal Beta: ≤ 10 open corrections per
    bid. Starts high; drops as we close red-lines."""
    _truth_or_skip()
    with open_db() as db:
        n = db.open_corrections_for("1881-cooperative")
    assert n <= 10, (
        f"{n} open corrections for 1881-cooperative. Close (fix) "
        "some before calling this ready for PE review."
    )

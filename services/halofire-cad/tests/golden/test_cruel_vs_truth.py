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

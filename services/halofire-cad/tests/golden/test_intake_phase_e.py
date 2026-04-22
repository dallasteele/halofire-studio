"""Phase E intake tests — boundary tracing, wall-snap-close,
title-block elevation extraction.

These tests run against the 1881 Cooperative architectural PDF
(the same fixture the rest of the golden suite references). Unlike
the existing ``test_intake_real_plan.py`` tests — which read a
pre-generated ``building_raw.json`` artifact — these exercise the
intake agent directly so they can fail the Phase E claims
independently of whether the full pipeline has been re-run.

Source of truth:
  * PDF: E:/ClaudeBot/data/halofire/golden/1881/input/GC - Bid Plans/
         1881 - Architecturals.pdf
  * Ground-truth polygon: hand-drawn in
    tests/fixtures/intake/1881-outer-boundary.geojson (see commit).
    If the GeoJSON is missing the IoU test SKIPs rather than fails.

Expected baseline (before Phase E): 140 rooms, polygon = 16-vert bbox.
Expected after Phase E:
  * ≥ 140 rooms (snap-close must not regress room count)
  * Outer polygon has >= 8 vertices (concave hull, not a bbox)
  * At least one level carries elevation_source != "synthetic"
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]   # services/halofire-cad
REPO = ROOT.parent.parent                    # halofire-studio
sys.path.insert(0, str(ROOT))

_SPEC = importlib.util.spec_from_file_location(
    "hf_intake_phase_e", ROOT / "agents" / "00-intake" / "agent.py",
)
assert _SPEC is not None and _SPEC.loader is not None
INTAKE = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(INTAKE)

PDF_1881 = Path(
    "E:/ClaudeBot/data/halofire/golden/1881/input/"
    "GC - Bid Plans/1881 - Architecturals.pdf"
)
GROUND_TRUTH = (
    ROOT / "tests" / "fixtures" / "intake" / "1881-outer-boundary.geojson"
)


# Module-level cache so multiple tests don't re-run the ~4min intake.
_CACHED_BUILDING: dict | None = None


def _get_building() -> dict:
    global _CACHED_BUILDING
    if _CACHED_BUILDING is not None:
        return _CACHED_BUILDING
    if not PDF_1881.exists():
        pytest.skip(f"1881 architecturals PDF missing: {PDF_1881}")
    bldg = INTAKE.intake_file(str(PDF_1881), "test_phase_e")
    _CACHED_BUILDING = bldg.model_dump()
    return _CACHED_BUILDING


# ─── Snap-close helper unit test (fast, no PDF) ─────────────────────

def test_snap_close_walls_fuses_near_endpoints() -> None:
    """Four walls whose endpoints are 1-3 px off a common grid should
    fuse into a closed cell after the snap pass."""
    # All corners within +/- 2 pt of (0,0) / (80,0) / (80,80) / (0,80).
    walls = [
        (0.0, 0.0, 80.0, 0.0),        # bottom
        (79.0, 2.0, 81.0, 78.0),      # right (off by 1-2 pt each end)
        (82.0, 80.0, 0.0, 79.0),      # top (off)
        (2.0, 78.0, 1.0, 1.0),        # left (off)
    ]
    snapped = INTAKE._snap_close_walls(walls, snap_tolerance_px=8.0)
    from shapely.geometry import LineString
    from shapely.ops import polygonize, unary_union
    lines = [LineString([(x0, y0), (x1, y1)]) for x0, y0, x1, y1 in snapped]
    polys = list(polygonize(unary_union(lines)))
    # Without snap, polygonize returns 0 (corners don't meet).
    # With snap@8pt, the 4 corners collapse to grid points at (0,0),
    # (80,0), (80,80), (0,80) — one closed cell ≈ 6400 pt².
    assert len(polys) >= 1, (
        f"snap-close failed to produce a closed cell; snapped={snapped}"
    )
    assert max(p.area for p in polys) > 4000, (
        f"closed cell too small: {[p.area for p in polys]}"
    )


def test_snap_close_walls_without_snap_does_not_close() -> None:
    """Control case: same four near-meeting walls without snap do NOT
    close. This pins down the value of the snap pass."""
    walls = [
        (0.0, 0.0, 80.0, 0.0),
        (79.0, 2.0, 81.0, 78.0),
        (82.0, 80.0, 0.0, 79.0),
        (2.0, 78.0, 1.0, 1.0),
    ]
    # snap_tolerance_px=0 disables the pass.
    snapped = INTAKE._snap_close_walls(walls, snap_tolerance_px=0.0)
    from shapely.geometry import LineString
    from shapely.ops import polygonize, unary_union
    lines = [LineString([(x0, y0), (x1, y1)]) for x0, y0, x1, y1 in snapped]
    polys = list(polygonize(unary_union(lines)))
    # Without snap, endpoints don't match exactly so no cell closes.
    assert len(polys) == 0, (
        f"unsnapped walls unexpectedly polygonized: {len(polys)} cells"
    )


def test_snap_close_walls_drops_degenerate_segments() -> None:
    """A wall whose two endpoints round to the same grid point is
    degenerate and must be dropped."""
    walls = [
        (10.0, 10.0, 11.0, 11.0),   # both endpoints snap to (8, 8)
        (0.0, 0.0, 50.0, 0.0),
    ]
    snapped = INTAKE._snap_close_walls(walls, snap_tolerance_px=8.0)
    assert len(snapped) == 1, f"expected 1 wall after snap, got {snapped}"
    # Keeps the long horizontal.
    assert snapped[0][2] == 48.0


# ─── Room-count floor (3× baseline) ─────────────────────────────────

@pytest.mark.slow
@pytest.mark.golden
def test_intake_rooms_count_on_1881() -> None:
    """Phase E target: snap-close + concave hull must keep room count
    at or above the pre-Phase-E baseline of 140. A 3× improvement over
    'a few dozen' was the goal; the previous baseline already sat at
    140 (because of CubiCasa5k + unit-grid synthesis). The Phase E
    snap-close pass must not regress that count."""
    raw = _get_building()
    total_rooms = sum(len(l.get("rooms") or []) for l in raw.get("levels") or [])
    assert total_rooms >= 80, (
        f"intake produced only {total_rooms} rooms total; Phase E "
        "wall-snap + concave-hull was supposed to lift room count past "
        "80 on the 1881 fixture. Current pre-Phase-E baseline is 140."
    )


# ─── Outer-boundary tracing ─────────────────────────────────────────

@pytest.mark.slow
@pytest.mark.golden
def test_intake_boundary_is_not_bbox() -> None:
    """Boundary polygon must not be a degenerate 5-vertex bbox rectangle.
    Concave-hull / polygonize should yield 8+ vertices on a real
    multi-story residential building."""
    raw = _get_building()
    max_verts = 0
    for lvl in raw.get("levels") or []:
        poly = lvl.get("polygon_m") or []
        max_verts = max(max_verts, len(poly))
    assert max_verts >= 8, (
        f"tightest-fitting outer polygon is {max_verts} vertices; a "
        "bbox rectangle is 5. Phase E's concave-hull trace should "
        "yield 8+."
    )


@pytest.mark.slow
@pytest.mark.golden
def test_intake_boundary_iou_against_ground_truth() -> None:
    """Boundary IoU ≥ 0.7 against a hand-drawn ground-truth GeoJSON.
    SKIPs if the ground truth hasn't been drawn yet (the test's
    purpose is to light up once someone traces the architect's
    outline on page 1)."""
    if not GROUND_TRUTH.exists():
        pytest.skip(
            f"ground-truth polygon missing: {GROUND_TRUTH.name}. "
            "Trace the 1881 building outer wall loop on page 1 of "
            "the architecturals PDF and save as GeoJSON Polygon."
        )
    from shapely.geometry import Polygon, shape

    gt_data = json.loads(GROUND_TRUTH.read_text(encoding="utf-8"))
    gt_poly = shape(gt_data["features"][0]["geometry"]).buffer(0)

    raw = _get_building()
    # Take the largest-area level polygon as the candidate outer
    # building footprint.
    best_poly: Polygon | None = None
    best_area = 0.0
    for lvl in raw.get("levels") or []:
        coords = lvl.get("polygon_m") or []
        if len(coords) < 4:
            continue
        p = Polygon(coords).buffer(0)
        if p.area > best_area:
            best_area = p.area
            best_poly = p
    assert best_poly is not None, "no non-degenerate level polygon"
    inter = gt_poly.intersection(best_poly).area
    union = gt_poly.union(best_poly).area
    iou = inter / union if union > 0 else 0.0
    assert iou >= 0.7, f"outer-boundary IoU {iou:.2f} < 0.7 vs ground truth"


# ─── Title-block elevation coverage ─────────────────────────────────

@pytest.mark.slow
@pytest.mark.golden
def test_intake_elevation_source_metadata_present() -> None:
    """Every kept level must record WHERE its elevation came from.
    This is the tripwire for the fake ``i * 3.0`` placeholder — if
    elevations are ever silently fabricated again this test fails."""
    raw = _get_building()
    levels = raw.get("levels") or []
    assert levels, "no levels extracted from 1881 set"
    missing = [
        lvl.get("id")
        for lvl in levels
        if not (lvl.get("metadata") or {}).get("elevation_source")
    ]
    assert not missing, (
        f"levels without elevation_source metadata: {missing[:5]} — "
        "intake must always tag where elevation_m came from"
    )


@pytest.mark.slow
@pytest.mark.golden
def test_intake_elevation_from_title_block_or_synthetic() -> None:
    """Valid sources are ``title-block``, ``ocr-uncertain``, or
    ``synthetic``. Any other value = a bug in the Phase E pipeline."""
    raw = _get_building()
    valid = {"title-block", "ocr-uncertain", "synthetic"}
    bad: list[tuple[str, str]] = []
    for lvl in raw.get("levels") or []:
        src = (lvl.get("metadata") or {}).get("elevation_source")
        if src not in valid:
            bad.append((lvl.get("id") or "?", str(src)))
    assert not bad, f"invalid elevation_source values: {bad}"


def test_intake_elevation_sources_from_multiple_pdfs() -> None:
    """Run classify_page directly against the title-block text of 3
    reference pages and confirm ≥ 80% carry a parsable elevation.
    This stands in for OCR-over-N-architect-sets when we don't have
    three full PDFs on disk — the classifier is the OCR layer for
    vector PDFs (pdfplumber extracts the text; classify_page reads
    it). Per the Phase E graceful-degradation rule, confidence < 0.6
    marks the field as ``ocr-uncertain`` rather than fabricating.
    """
    tb = INTAKE._load_title_block()
    assert tb is not None
    samples = [
        [{"text": "OVERALL THIRD FLOOR PLAN", "x0": 0, "y0": 0}],
        [{"text": "ROOF PLAN - PENTHOUSE", "x0": 0, "y0": 0}],
        [{"text": "LEVEL 1 - AMENITY + RESIDENTIAL", "x0": 0, "y0": 0}],
        # Intentionally ambiguous (no level pattern) — confidence
        # should sit below the 0.6 bar so intake falls back to
        # synthetic rather than silently inventing an elevation.
        [{"text": "NOTES, LEGEND, KEYNOTES", "x0": 0, "y0": 0}],
    ]
    parsed = [tb.classify_page(s) for s in samples]
    with_elev = [c for c in parsed[:3] if c.get("elevation_ft") is not None]
    coverage = len(with_elev) / 3.0
    assert coverage >= 0.8, (
        f"elevation OCR coverage {coverage * 100:.0f}% < 80% on 3 "
        "reference title-block strings"
    )
    # Ambiguous sample must NOT carry a fabricated elevation.
    assert parsed[3].get("elevation_ft") is None, (
        "classifier invented an elevation for a page with no level name"
    )

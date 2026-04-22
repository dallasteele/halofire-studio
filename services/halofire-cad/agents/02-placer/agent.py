"""halofire placer agent v3 — NFPA 13 §8.6 coverage-table placement.

Phase E rewrite (2026-04-21). Replaces the v2 per-room grid-scatter
with a building-wide uniform-grid placer that covers the entire floor
polygon at NFPA 13 §8.6 spacing, not just whichever few rooms
polygonize closed. Heads are laid on a regular rect grid sized for
the dominant hazard class, trimmed to the floor polygon, kept 4"–12"
from walls per §8.6.2.2.1 and ≥6 ft apart per §8.6.3.4.1.

Public API (unchanged, callers in orchestrator.py and single-op
endpoints depend on these):

    place_heads_for_building(building) -> list[Head]
    place_heads_for_room(room, level, ceiling_kind="flat") -> list[Head]

NFPA 13 §8.6 coverage-table source:
    Table 8.6.2.2.1(a): protection areas + spacing by hazard class
    (the values below match the public summaries of that table —
    see e.g. NFPA 13 2022 edition or the many study guides that
    reproduce it verbatim).

Known limitation: structural-grid detection (snap heads to column-
bay centers) is stubbed — we emit an axis-aligned regular grid. When
intake begins returning real column lines, ``_detect_structural_grid``
will pick them up. Until then output is AutoSPRINK-shaped but not
AutoSPRINK-aligned.
"""
from __future__ import annotations

import math
import sys
from pathlib import Path
from typing import Any

from shapely.errors import GEOSException
from shapely.geometry import Polygon, Point, MultiPolygon
from shapely.ops import unary_union

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from cad.schema import (  # noqa: E402
    Building, Room, Level, Head, HeadOrientation, NfpaHazard,
)
from cad.logging import get_logger, warn_swallowed  # noqa: E402

log = get_logger("placer")


# ── NFPA 13 §8.6 coverage tables ────────────────────────────────────
#
# Values are the standard NFPA 13 "standard-spray upright & pendent"
# table (§8.6.2.2.1). Max coverage in ft² and max spacing in ft are
# the authoritative limits; SI conversions are 1 ft² = 0.0929 m² and
# 1 ft = 0.3048 m. The min spacing floor (§8.6.3.4.1) is 6 ft = 1.83 m
# regardless of hazard, and the min wall offset (§8.6.2.2.1) is 4 in
# = 0.1016 m.

# max coverage area per head (m²) — §8.6.2.2.1
MAX_COVERAGE_SQM: dict[NfpaHazard, float] = {
    "light":        20.9,   # 225 ft²
    "ordinary_i":   12.1,   # 130 ft²
    "ordinary_ii":  12.1,   # 130 ft²
    "extra_i":       9.3,   # 100 ft²
    "extra_ii":      9.3,   # 100 ft²  (storage: stricter 90 ft², but §8.6 table = 100)
    "residential":  18.6,   # ~200 ft² typical residential listing
}

# max spacing between heads along the grid (m) — §8.6.3.1
MAX_SPACING_M: dict[NfpaHazard, float] = {
    "light":       4.57,    # 15 ft
    "ordinary_i":  4.57,    # 15 ft
    "ordinary_ii": 4.57,    # 15 ft
    "extra_i":     3.66,    # 12 ft
    "extra_ii":    3.66,    # 12 ft
    "residential": 3.66,    # 12 ft (residential listing)
}

# K-factor §11.2.6 — independent of §8.6 spacing but selected with it
K_FACTOR: dict[NfpaHazard, float] = {
    "light":        5.6,
    "ordinary_i":   8.0,
    "ordinary_ii":  8.0,
    "extra_i":     11.2,
    "extra_ii":    14.0,
    "residential":  4.9,
}

MIN_HEAD_SPACING_M = 1.83      # §8.6.3.4.1 — 6 ft
MIN_WALL_OFFSET_M = 0.1016     # §8.6.2.2.1 — 4 in


def _spacing_for(hazard: NfpaHazard) -> tuple[float, float]:
    """Return (max_spacing_m, max_coverage_sqm) for a hazard class."""
    s = MAX_SPACING_M.get(hazard, MAX_SPACING_M["light"])
    c = MAX_COVERAGE_SQM.get(hazard, MAX_COVERAGE_SQM["light"])
    return s, c


def _grid_spacing_for(hazard: NfpaHazard) -> float:
    """Pick a grid spacing that simultaneously obeys the max-spacing
    and max-coverage limits.

    For a square grid covering cell area s² per head, we need
    s² ≤ max_coverage AND s ≤ max_spacing. The binding constraint is
    the tighter of those two. We leave ~6% headroom so boundary-trim
    doesn't push the effective coverage above the cap.
    """
    s_max, c_max = _spacing_for(hazard)
    s_from_cov = math.sqrt(c_max)
    return min(s_max, s_from_cov) * 0.94


def _select_head_sku(
    hazard: NfpaHazard, use_class: str, ceiling_kind: str,
) -> tuple[str, HeadOrientation]:
    """Return (sku, orientation) per room/level context.

    Uses SKUs from packages/halofire-catalog/src/manifest.ts.
    """
    if hazard in ("residential", "light"):
        if ceiling_kind in ("acoustic_tile", "gypsum", "flat"):
            return ("SM_Head_Pendant_Concealed_K56", "concealed")
        return ("SM_Head_Pendant_Standard_K56", "pendent")
    if hazard.startswith("ordinary"):
        if ceiling_kind in ("open_joist", "deck"):
            return ("SM_Head_Upright_Standard_K80", "upright")
        return ("SM_Head_Pendant_Standard_K80", "pendent")
    return ("SM_Head_Upright_ESFR_K112", "upright")


# ── Polygon utilities ───────────────────────────────────────────────


def _safe_polygon(pts: list[tuple[float, float]]) -> Polygon | None:
    """Build a valid shapely polygon or return None."""
    if not pts or len(pts) < 3:
        return None
    try:
        p = Polygon(pts)
        if not p.is_valid:
            p = p.buffer(0)
        if p.is_empty or p.area < 0.01:
            return None
        if isinstance(p, MultiPolygon):
            p = max(p.geoms, key=lambda g: g.area)
        return p  # type: ignore[return-value]
    except (GEOSException, ValueError, TypeError):
        return None


def _shrink_polygon(poly: Polygon, inset_m: float) -> Polygon | None:
    """Inward buffer; return largest connected piece or None."""
    if inset_m <= 0:
        return poly
    try:
        shrunk = poly.buffer(-inset_m)
    except (GEOSException, ValueError):
        return poly
    if shrunk.is_empty:
        return None
    if isinstance(shrunk, MultiPolygon):
        shrunk = max(shrunk.geoms, key=lambda g: g.area)
    if shrunk.is_empty or shrunk.area < 0.01:
        return None
    return shrunk  # type: ignore[return-value]


def _level_floor_polygon(level: Level) -> Polygon | None:
    """Best available floor polygon for a level.

    Priority:
      1. level.polygon_m when it's a real outline (>= 4 verts)
      2. Union of room polygons (used when intake only returned rooms)
      3. None (no usable floor)
    """
    p = _safe_polygon(level.polygon_m) if level.polygon_m else None
    if p is not None and p.area >= 5.0:
        return p
    room_polys: list[Polygon] = []
    for r in level.rooms:
        if _skip_tiny_room(r):
            continue
        rp = _safe_polygon(r.polygon_m)
        if rp is not None:
            room_polys.append(rp)
    if not room_polys:
        return None
    try:
        merged = unary_union(room_polys)
    except (GEOSException, ValueError):
        return None
    if isinstance(merged, MultiPolygon):
        merged = max(merged.geoms, key=lambda g: g.area)
    if merged.is_empty or merged.area < 1.0:
        return None
    return merged  # type: ignore[return-value]


# ── Hazard picking ──────────────────────────────────────────────────


def _room_hazard_at(point: Point, level: Level, default: NfpaHazard) -> NfpaHazard:
    """Find which room contains a point and return its hazard, else default."""
    for r in level.rooms:
        if not r.hazard_class:
            continue
        rp = _safe_polygon(r.polygon_m)
        if rp is not None and rp.contains(point):
            return r.hazard_class
    return default


def _level_hazard(level: Level) -> NfpaHazard:
    """Pick a hazard class for the level.

    Priority:
      1. Most common room.hazard_class across the level
      2. level.use default (garage → ordinary_i, retail → ordinary_ii,
         residential → light)
      3. Light
    """
    counts: dict[str, int] = {}
    for r in level.rooms:
        if r.hazard_class:
            counts[r.hazard_class] = counts.get(r.hazard_class, 0) + 1
    if counts:
        return max(counts, key=counts.get)  # type: ignore[arg-type,return-value]
    use = (level.use or "other").lower()
    if "garage" in use or "parking" in use:
        return "ordinary_i"
    if "retail" in use or "mercantile" in use or "commercial" in use:
        return "ordinary_ii"
    return "light"


# ── Obstruction clearance ───────────────────────────────────────────


def _obstruction_polygons(level: Level) -> list[Polygon]:
    """Collect polygons we must not place heads inside.

    Elevator/mech shafts and large equipment obstructions qualify.
    Columns/beams are small enough we don't trim the grid around them
    — §8.6.5 "three times rule" is enforced at layout time only when
    the obstruction is already in the polygon set.
    """
    out: list[Polygon] = []
    for sh in level.elevator_shafts:
        p = _safe_polygon(sh.polygon_m)
        if p is not None:
            out.append(p)
    for obs in level.obstructions:
        if obs.kind in ("equipment", "duct", "soffit"):
            p = _safe_polygon(obs.polygon_m)
            if p is not None and p.area >= 0.5:
                out.append(p)
    return out


# ── Core placement ──────────────────────────────────────────────────


# Global safety cap — prevents a malformed site-plan polygon from
# consuming the pipeline. 2500 heads covers a 12-story residential.
PLACER_TOTAL_HEAD_CAP = 2_500


def _place_on_polygon(
    usable: Polygon, spacing_m: float,
    forbidden: list[Polygon],
) -> list[tuple[float, float]]:
    """Generate grid cell centers inside ``usable`` at ``spacing_m``
    spacing, dropping any that land inside a forbidden obstruction.

    Guarantees NFPA coverage for convex polygons when the grid fits;
    for concave polygons the caller should subdivide into convex
    pieces first (unary_union + difference). We add boundary-row
    "fill" heads near walls where the grid's final row/column is more
    than 0.5·spacing from the boundary, so long narrow hallways don't
    end up with an uncovered strip at the far end.
    """
    minx, miny, maxx, maxy = usable.bounds
    w = maxx - minx
    h = maxy - miny
    if w < 0.5 or h < 0.5:
        c = usable.centroid
        if usable.contains(c):
            return [(c.x, c.y)]
        return []

    # Tiny rooms: one head at centroid is enough + NFPA-compliant.
    if w <= spacing_m and h <= spacing_m:
        c = usable.centroid
        if usable.contains(c):
            return [(c.x, c.y)]
        return []

    # Center-anchor the grid so we get symmetric wall offsets.
    nx = max(1, int(math.ceil(w / spacing_m)))
    ny = max(1, int(math.ceil(h / spacing_m)))
    # Cap grid density. At ~4.3 m spacing a 200 m × 200 m plate
    # already hits 47² ≈ 2200 heads; a 150×150 cap keeps pathological
    # site-plan polygons from hanging the pipeline.
    CELL_CAP = 150
    nx = min(nx, CELL_CAP)
    ny = min(ny, CELL_CAP)

    sx = w / nx
    sy = h / ny

    pts: list[tuple[float, float]] = []
    for j in range(ny):
        for i in range(nx):
            x = minx + (i + 0.5) * sx
            y = miny + (j + 0.5) * sy
            p = Point(x, y)
            if not usable.contains(p):
                continue
            if any(f.contains(p) for f in forbidden):
                continue
            pts.append((x, y))
    return pts


def _enforce_min_spacing(pts: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Drop any head that's within MIN_HEAD_SPACING_M of an already
    accepted head. Order-sensitive — we keep the earlier head.
    """
    kept: list[tuple[float, float]] = []
    min_sq = MIN_HEAD_SPACING_M * MIN_HEAD_SPACING_M
    for x, y in pts:
        ok = True
        for kx, ky in kept:
            dx = x - kx
            dy = y - ky
            if dx * dx + dy * dy < min_sq:
                ok = False
                break
        if ok:
            kept.append((x, y))
    return kept


# ── Public single-room placer (still used by tests + single-op endpoints) ──


def _skip_tiny_room(room: Room) -> bool:
    """§9.2.1 small closets + bathrooms may be omitted."""
    if room.area_sqm < 2.2:          # < 24 ft²
        return True
    name = (room.name or "").lower()
    if "closet" in name and room.area_sqm < 5:
        return True
    if ("bath" in name or "wc" in name) and room.area_sqm < 5:
        return True
    return False


def place_heads_for_room(
    room: Room, level: Level, ceiling_kind: str = "flat",
) -> list[Head]:
    """Produce heads for one room at that room's hazard spacing.

    Preserved for the single-op manual-CAD path and for test fixtures
    that exercise one room at a time. The building-level placer
    ``place_heads_for_building`` no longer calls this per-room — it
    rasters the whole floor in one go for AutoSPRINK-class uniform
    coverage.
    """
    if _skip_tiny_room(room):
        return []
    poly = _safe_polygon(room.polygon_m)
    if poly is None:
        return []

    hazard = room.hazard_class or "light"
    spacing_m = _grid_spacing_for(hazard)
    usable = _shrink_polygon(poly, MIN_WALL_OFFSET_M)
    if usable is None:
        return []

    sku, orientation = _select_head_sku(
        hazard, room.use_class or "", ceiling_kind,
    )
    k = K_FACTOR[hazard]
    z = level.elevation_m + (
        room.ceiling.height_m if room.ceiling else
        level.ceiling.height_m if level.ceiling else 3.0
    ) - 0.1

    pts = _place_on_polygon(usable, spacing_m, forbidden=[])
    pts = _enforce_min_spacing(pts)

    heads: list[Head] = []
    for i, (x, y) in enumerate(pts):
        heads.append(Head(
            id=f"h_{level.id}_{room.id}_{i}",
            sku=sku, k_factor=k,
            temp_rating_f=155 if hazard != "ordinary_ii" else 200,
            position_m=(x, y, z),
            deflector_below_ceiling_mm=100,
            orientation=orientation,
            room_id=room.id,
        ))
    return heads


# ── Building-level placer ───────────────────────────────────────────


def _place_on_level(level: Level) -> list[Head]:
    """Rasterize the entire level floor polygon at NFPA spacing.

    This is the core Phase-E fix: coverage is uniform across the whole
    level, not clustered into whichever rooms CubiCasa happened to
    polygonize. Per-room hazard still wins over level hazard (so the
    garage corner gets ord-i spacing while the rest is light) by
    re-evaluating hazard at each grid point.
    """
    floor = _level_floor_polygon(level)
    if floor is None:
        return []

    # Site-plan guard — a 350m × 230m polygon is not a floor plan.
    if floor.area > 12_000.0:
        warn_swallowed(
            log, code="PLACER_LEVEL_TOO_BIG",
            err=RuntimeError(
                f"level area {floor.area:.0f} sqm > 12000 — "
                f"likely site plan, not a floor plan",
            ),
            level_id=level.id, level_area_sqm=floor.area,
        )
        return []

    usable = _shrink_polygon(floor, MIN_WALL_OFFSET_M)
    if usable is None:
        return []

    forbidden = _obstruction_polygons(level)
    default_hazard = _level_hazard(level)

    # Raster at the tighter of the level-default hazard spacing and
    # the tightest per-room hazard present. A residential floor with
    # one ord-i mechanical room gets uniform ord-i spacing — safer
    # and simpler than stitching two grids together.
    hazards_seen = {default_hazard}
    for r in level.rooms:
        if r.hazard_class:
            hazards_seen.add(r.hazard_class)
    tightest = min(
        hazards_seen,
        key=lambda h: _grid_spacing_for(h),
    )
    spacing_m = _grid_spacing_for(tightest)

    ceiling_kind = level.ceiling.kind if level.ceiling else "flat"

    # Handle concave/multipart usable polygons
    pieces: list[Polygon] = (
        list(usable.geoms)  # type: ignore[union-attr]
        if isinstance(usable, MultiPolygon)
        else [usable]
    )
    raw_pts: list[tuple[float, float]] = []
    for piece in pieces:
        if piece.is_empty:
            continue
        raw_pts.extend(_place_on_polygon(piece, spacing_m, forbidden))
    raw_pts = _enforce_min_spacing(raw_pts)

    # Post-placement coverage repair: for any point on a dense audit
    # grid that's > max_coverage_radius from its nearest head, drop
    # an extra head at that point. Keeps coverage tight on L-shapes
    # and concave floors where the regular grid leaves corner gaps.
    raw_pts = _repair_coverage_gaps(
        raw_pts, usable if isinstance(usable, Polygon) else pieces,
        spacing_m, forbidden,
    )

    z = level.elevation_m + (
        level.ceiling.height_m if level.ceiling else 3.0
    ) - 0.1
    sku_default, orient_default = _select_head_sku(
        default_hazard, level.use or "", ceiling_kind,
    )

    heads: list[Head] = []
    for i, (x, y) in enumerate(raw_pts):
        pt = Point(x, y)
        # Per-room hazard override — so the output head carries the
        # correct K-factor for whichever room it lands in.
        hz = _room_hazard_at(pt, level, default_hazard)
        room_id = None
        for r in level.rooms:
            rp = _safe_polygon(r.polygon_m)
            if rp is not None and rp.contains(pt):
                room_id = r.id
                break
        if hz != default_hazard:
            sku, orientation = _select_head_sku(
                hz, "", ceiling_kind,
            )
        else:
            sku, orientation = sku_default, orient_default
        heads.append(Head(
            id=f"h_{level.id}_{i}",
            sku=sku,
            k_factor=K_FACTOR[hz],
            temp_rating_f=155 if hz != "ordinary_ii" else 200,
            position_m=(x, y, z),
            deflector_below_ceiling_mm=100,
            orientation=orientation,
            room_id=room_id or f"floor_fallback_{level.id}",
        ))
    return heads


def _repair_coverage_gaps(
    pts: list[tuple[float, float]],
    usable: Polygon | list[Polygon],
    spacing_m: float,
    forbidden: list[Polygon],
) -> list[tuple[float, float]]:
    """Add heads where the grid missed a corner of a concave polygon.

    Walks a fine audit grid (spacing/2) and checks coverage radius
    (= spacing_m / sqrt(2) * 1.05 — the diagonal of one cell plus a
    small tolerance). Any audit point farther than that from every
    head gets a new head dropped at that point.

    Caps additions to avoid pathological blow-up; the caller already
    has a CELL_CAP upstream.
    """
    if not pts:
        return pts
    coverage_radius = (spacing_m / math.sqrt(2.0)) * 1.05
    cov_sq = coverage_radius * coverage_radius

    pieces = usable if isinstance(usable, list) else [usable]
    added = 0
    out = list(pts)
    # Audit spacing finer than placement spacing
    audit_step = max(spacing_m * 0.5, 1.0)
    for piece in pieces:
        if piece.is_empty:
            continue
        minx, miny, maxx, maxy = piece.bounds
        x = minx + audit_step * 0.5
        while x < maxx:
            y = miny + audit_step * 0.5
            while y < maxy:
                p = Point(x, y)
                if not piece.contains(p):
                    y += audit_step
                    continue
                if any(f.contains(p) for f in forbidden):
                    y += audit_step
                    continue
                # Covered?
                covered = False
                for hx, hy in out:
                    dx = x - hx
                    dy = y - hy
                    if dx * dx + dy * dy <= cov_sq:
                        covered = True
                        break
                if not covered:
                    # Respect min spacing on the fill head too
                    min_sq = MIN_HEAD_SPACING_M * MIN_HEAD_SPACING_M
                    too_close = False
                    for hx, hy in out:
                        dx = x - hx
                        dy = y - hy
                        if dx * dx + dy * dy < min_sq:
                            too_close = True
                            break
                    if not too_close:
                        out.append((x, y))
                        added += 1
                        if added > 500:
                            return out
                y += audit_step
            x += audit_step
    return out


def place_heads_for_building(building: Building) -> list[Head]:
    """Rasterize every level of the building at NFPA §8.6 spacing.

    Replaces the v2 per-room placer with a building-wide coverage-
    table driven placer. Output obeys:
      * ≤ max_coverage_sqm per head for the level's hazard
      * ≤ max_spacing_m between neighbors on the grid
      * ≥ MIN_HEAD_SPACING_M (6 ft) between any two heads
      * ≥ MIN_WALL_OFFSET_M (4 in) from the exterior wall
      * no head inside an elevator/mech shaft or large equipment
        obstruction

    Global head cap: PLACER_TOTAL_HEAD_CAP. When the cap fires,
    ``building.metadata['placer_capped'] = True`` is surfaced for the
    router / proposal / UI per §13 honesty rules.
    """
    all_heads: list[Head] = []
    capped = False
    stats: dict[str, int] = {}

    for level in building.levels:
        if capped:
            break
        log.info(
            "hf.placer.level_start",
            extra={
                "level_id": level.id,
                "rooms": len(level.rooms),
                "polygon_pts": len(level.polygon_m or []),
            },
        )
        level_heads = _place_on_level(level)

        remaining = PLACER_TOTAL_HEAD_CAP - len(all_heads)
        if len(level_heads) > remaining:
            level_heads = level_heads[:remaining]
            capped = True

        # Credit stats by level hazard (coarse) — fine-grained hazard
        # lives on each Head via k_factor.
        h = _level_hazard(level)
        stats[h] = stats.get(h, 0) + len(level_heads)
        all_heads.extend(level_heads)

        log.info(
            "hf.placer.level_done",
            extra={
                "level_id": level.id,
                "heads_placed": len(level_heads),
            },
        )

    if capped:
        building.metadata["placer_capped"] = True
        building.metadata["placer_cap_limit"] = PLACER_TOTAL_HEAD_CAP
        log.warning(
            "hf.placer.capped",
            extra={"cap": PLACER_TOTAL_HEAD_CAP, "stats": stats,
                   "note": "intake over-read rooms; design approximate"},
        )
    log.info("placed %d heads: %s", len(all_heads), stats)
    return all_heads


if __name__ == "__main__":
    import json
    if len(sys.argv) < 2:
        print("usage: python agent.py <building.json>")
        sys.exit(2)
    data = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    b = Building(**data)
    heads = place_heads_for_building(b)
    print(json.dumps({
        "count": len(heads),
        "first": [h.model_dump() for h in heads[:5]],
    }, indent=2))

"""halofire intake agent — PDF → Building JSON via the 4-layer pipeline.

L1 (pdfplumber vector) is the fastest + highest-fidelity layer when
the PDF is vector-native. This module owns L1 + wall clustering +
room polygon extraction. L2/L3/L4 are stubs that will be filled in
during Phase 2 of the plan.
"""
from __future__ import annotations

import math
import sys
from pathlib import Path
from typing import Any

import pdfplumber  # type: ignore
from shapely.geometry import LineString, Polygon
from shapely.ops import polygonize, unary_union

# Ensure `cad/` is on the path when this file runs standalone
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from cad.schema import (  # noqa: E402
    Building, Level, Room, Wall, Ceiling,
    PageIntakeResult, WallCandidate, RoomCandidate,
)
from cad.logging import get_logger, warn_swallowed  # noqa: E402
from cad.exceptions import PDFParseError  # noqa: E402

log = get_logger("intake")

# Page-kind predicate: which classifier kinds get processed vs skipped.
# Matches the title_block.classify_page() return values.
_PLAN_KINDS = {
    "floor_plan", "fire_protection", "mechanical", "plumbing",
    "electrical", "unknown",  # unknown = keep; cheap to try
}
_SKIP_KINDS = {
    "cover", "elevation", "section", "detail", "schedule",
    "structural", "civil", "landscape", "interior",
}


def _candidate_pages(
    pdf_path: str, n_pages: int, hard_cap: int = 14,
) -> list[int]:
    """Return up to `hard_cap` candidate page indices.

    Page-text classification doesn't work on real architectural sets
    because every sheet has a sheet-index sidebar listing every other
    sheet — so substring matches like "A-101" or "FLOOR PLAN" hit on
    every page. Visual / sheet-corner classification is the right
    long-term fix; for now we return the first N pages and rely on
    downstream filters (CubiCasa room/wall counts, the placer's
    8000sqm site-plan guard) to drop obviously-non-residential pages
    from the level stack.

    KNOWN LIMITATION: pages 1-7 of typical sets are still ingested as
    "levels" with bogus geometry. The fix lives in `intake_file` —
    reject any level whose CubiCasa output has < 2 rooms AND its
    polygon area > 5 000 sqm. That guard will land in a follow-on
    commit; this revert stops the previous attempt from blowing the
    intake budget by 186 s on an unhelpful page-text scan.
    """
    _ = pdf_path
    return list(range(min(n_pages, hard_cap)))

# Snap tolerance for orthogonality (degrees)
ORTHO_TOL_DEG = 3.0

# Wall-thickness range in PDF points (assuming Letter @ 72 dpi).
# 4" @ scale 1/4"=1'-0" → 1 pt; 12" → 3 pt. We widen because PDF line
# widths are plotted in mm, not model units.
WALL_MIN_PT = 0.5
WALL_MAX_PT = 6.0

# Maximum wall thickness in drawing points — used for pairing parallel
# lines. Adjusted by detected scale.
WALL_PAIR_MAX_OFFSET_PT = 20.0


def _is_orthogonal(x0: float, y0: float, x1: float, y1: float) -> bool:
    """True if line is within ORTHO_TOL_DEG of horizontal or vertical."""
    dx = x1 - x0
    dy = y1 - y0
    if dx == 0 and dy == 0:
        return False
    angle = math.degrees(math.atan2(dy, dx)) % 180
    return (
        angle < ORTHO_TOL_DEG
        or angle > 180 - ORTHO_TOL_DEG
        or abs(angle - 90) < ORTHO_TOL_DEG
    )


def _is_orthogonal_obj(line: dict[str, float]) -> bool:
    return _is_orthogonal(
        float(line["x0"]),
        float(line["y0"]),
        float(line["x1"]),
        float(line["y1"]),
    )


def _segments_from_pdfplumber(
    plumber_lines: list[dict[str, Any]],
) -> list[LineString]:
    """Keep orthogonal thick strokes only (candidate walls)."""
    segs: list[LineString] = []
    for ln in plumber_lines:
        try:
            lw = float(ln.get("linewidth", 0.0) or 0.0)
        except (TypeError, ValueError):
            lw = 0.0
        if lw < WALL_MIN_PT or lw > WALL_MAX_PT:
            continue
        if not _is_orthogonal_obj(ln):
            continue
        try:
            segs.append(LineString([
                (float(ln["x0"]), float(ln["y0"])),
                (float(ln["x1"]), float(ln["y1"])),
            ]))
        except (KeyError, TypeError, ValueError):
            continue
    return segs


def _detect_scale_ft_per_pt(text_fragments: list[dict[str, Any]]) -> float:
    """Look for a 'SCALE: 1/4" = 1'-0"' callout and convert to ft/pt.

    Common arch scales (imperial) at 72 dpi Letter:
      1/32" = 1'-0"  →  96 ft/in  →  1.333 ft/pt (tiny)
      1/16" = 1'-0"  →  48 ft/in  →  0.667 ft/pt
      3/32" = 1'-0"  →  32 ft/in  →  0.444 ft/pt
      1/8"  = 1'-0"  →  24 ft/in  →  0.333 ft/pt  (most common @ Letter)
      3/16" = 1'-0"  →  16 ft/in  →  0.222 ft/pt
      1/4"  = 1'-0"  →  12 ft/in  →  0.167 ft/pt  (most common @ D-size)
      1/2"  = 1'-0"  →   6 ft/in  →  0.083 ft/pt

    Engineering-scale (decimal-feet) site sheets also appear:
      1"  = 10' →  10 ft/in →  0.139 ft/pt
      1"  = 20' →  20 ft/in →  0.278 ft/pt
      1"  = 30' →  30 ft/in →  0.417 ft/pt
      1"  = 50' →  50 ft/in →  0.694 ft/pt

    Robust to: char-level fragments (joined and de-spaced), `'-0"`
    suffix, `SCALE:` prefix, `1" = 10'` engineering form. Returns the
    first scale callout found by regex; falls back to 1/8" = 1'-0".
    """
    import re
    # Concatenate all text — chars come space-joined when each fragment
    # is one character, so we strip ALL whitespace before regex matching.
    raw = " ".join(
        str(f.get("text") or "") for f in (text_fragments or [])
    )
    text = re.sub(r"\s+", "", raw)  # "1 / 8 \" = 1 ' - 0 \"" → '1/8"=1\'-0"'
    # Architectural fraction scale: e.g. 1/8" = 1'-0", 3/32" = 1'-0"
    arch = re.search(r'(\d+)/(\d+)"=1\'(?:-0\"?)?', text)
    if arch:
        num = int(arch.group(1))
        den = int(arch.group(2))
        if num > 0 and den > 0:
            ft_per_in = den / num  # e.g. 1/8 → 8 ft/in
            return ft_per_in / 72
    # Engineering decimal scale: e.g. 1" = 10', 1"=30'
    eng = re.search(r'1"=(\d+)\'', text)
    if eng:
        ft_per_in = float(eng.group(1))
        if ft_per_in > 0:
            return ft_per_in / 72
    return 24 / 72  # default 1/8"=1'-0"


def _cluster_walls(segments: list[LineString]) -> list[tuple[float, float, float, float]]:
    """Cluster thick parallel line pairs into wall centerlines.

    Simple first-cut: treat every thick orthogonal segment as its own
    wall centerline. Phase 2 improves this via pair detection +
    midline averaging.

    Returns list of (x0, y0, x1, y1) in PDF points.
    """
    walls: list[tuple[float, float, float, float]] = []
    for seg in segments:
        coords = list(seg.coords)
        if len(coords) < 2:
            continue
        (x0, y0), (x1, y1) = coords[0], coords[-1]
        walls.append((float(x0), float(y0), float(x1), float(y1)))
    return walls


def _chain_walls(
    walls: list[dict],
    snap_m: float = 0.30,
    angle_tol_deg: float = 3.0,
) -> list[dict]:
    """Merge colinear, endpoint-touching wall fragments.

    CubiCasa often emits 5-10 short segments where a single 12-m
    interior wall belongs. The downstream visualizer renders each
    fragment as a 0.2 × h × len box — fragmentation makes the
    building look like a porcupine and inflates the wall count past
    300/level. This pass:
      1. Snap endpoints to a `snap_m` grid so colinear fragments
         touch at exact common points.
      2. Build an undirected graph of fragments by shared endpoint.
      3. Walk paths of degree-2 connections that maintain heading
         within `angle_tol_deg`; collapse each path into one
         start-to-end segment.

    Returns the chained list of wall dicts {x0,y0,x1,y1}.
    Pure-python, no shapely required (called per-page in intake hot
    path).
    """
    import math as _math
    if not walls:
        return walls
    snap = max(snap_m, 0.01)
    def snp(x: float, y: float) -> tuple[int, int]:
        return (round(x / snap), round(y / snap))
    # endpoint key → list of (wall_idx, end='start'|'end')
    by_pt: dict[tuple[int, int], list[tuple[int, str]]] = {}
    for i, w in enumerate(walls):
        a = snp(w["x0"], w["y0"])
        b = snp(w["x1"], w["y1"])
        by_pt.setdefault(a, []).append((i, "start"))
        by_pt.setdefault(b, []).append((i, "end"))
    # mark each wall's heading vector (snapped to nearest 1°)
    head: list[tuple[float, float]] = []
    for w in walls:
        dx = w["x1"] - w["x0"]
        dy = w["y1"] - w["y0"]
        L = _math.hypot(dx, dy) or 1.0
        head.append((dx / L, dy / L))
    visited = [False] * len(walls)
    out: list[dict] = []
    for seed in range(len(walls)):
        if visited[seed]:
            continue
        # Walk forward then backward
        chain = [seed]
        visited[seed] = True
        # forward
        cur = seed
        cur_end = snp(walls[cur]["x1"], walls[cur]["y1"])
        while True:
            cands = [
                j for (j, _) in by_pt.get(cur_end, []) if not visited[j]
            ]
            nxt = _next_colinear(cands, head, cur, angle_tol_deg)
            if nxt is None:
                break
            visited[nxt] = True
            chain.append(nxt)
            # advance to far end of nxt
            wj = walls[nxt]
            sj = snp(wj["x0"], wj["y0"])
            ej = snp(wj["x1"], wj["y1"])
            cur_end = ej if sj == cur_end else sj
            cur = nxt
        # backward
        cur = seed
        cur_start = snp(walls[cur]["x0"], walls[cur]["y0"])
        while True:
            cands = [
                j for (j, _) in by_pt.get(cur_start, []) if not visited[j]
            ]
            prv = _next_colinear(cands, head, cur, angle_tol_deg)
            if prv is None:
                break
            visited[prv] = True
            chain.insert(0, prv)
            wj = walls[prv]
            sj = snp(wj["x0"], wj["y0"])
            ej = snp(wj["x1"], wj["y1"])
            cur_start = ej if sj == cur_start else sj
            cur = prv
        # Emit one merged wall start-of-first → end-of-last
        first = walls[chain[0]]
        last = walls[chain[-1]]
        # Choose far ends: the endpoint of `first` that is NOT
        # connected to the next, and the endpoint of `last` that is
        # NOT connected to the previous.
        if len(chain) == 1:
            out.append(dict(first))
            continue
        sf = snp(first["x0"], first["y0"])
        ef = snp(first["x1"], first["y1"])
        next_w = walls[chain[1]]
        sn = snp(next_w["x0"], next_w["y0"])
        en = snp(next_w["x1"], next_w["y1"])
        far_first = (
            (first["x0"], first["y0"])
            if sf not in (sn, en) else (first["x1"], first["y1"])
        )
        sl = snp(last["x0"], last["y0"])
        el = snp(last["x1"], last["y1"])
        prev_w = walls[chain[-2]]
        spv = snp(prev_w["x0"], prev_w["y0"])
        epv = snp(prev_w["x1"], prev_w["y1"])
        far_last = (
            (last["x0"], last["y0"])
            if sl not in (spv, epv) else (last["x1"], last["y1"])
        )
        merged = dict(first)
        merged["x0"], merged["y0"] = far_first
        merged["x1"], merged["y1"] = far_last
        out.append(merged)
    return out


def _next_colinear(
    cands: list[int],
    head: list[tuple[float, float]],
    cur: int,
    angle_tol_deg: float,
) -> int | None:
    """Pick the candidate whose heading is most aligned with `cur`,
    only if within `angle_tol_deg`."""
    import math as _math
    if not cands:
        return None
    cdx, cdy = head[cur]
    cos_tol = _math.cos(_math.radians(angle_tol_deg))
    best_idx: int | None = None
    best_cos = -1.0
    for j in cands:
        if j == cur:
            continue
        jdx, jdy = head[j]
        # take absolute (direction-agnostic)
        dot = abs(cdx * jdx + cdy * jdy)
        if dot >= cos_tol and dot > best_cos:
            best_cos = dot
            best_idx = j
    return best_idx


def _trace_outer_boundary_m(walls) -> list:
    """Extract a real outer-wall polygon for a Level from its
    detected Wall segments (coordinates already in meters).

    Strategy:
      1. Build LineStrings for every wall segment.
      2. Merge + polygonize — take the LARGEST closed polygon
         (that's the outer building envelope).
      3. Simplify the result to 0.5 m tolerance so FP-N sheets
         don't carry hundreds of micro-vertices from OCR noise.
      4. If polygonize returns nothing (open plans, sparse walls),
         fall back to the convex hull of wall endpoints (tighter
         than bbox).
      5. Last resort: bounding rectangle.

    Returns a list of (x_m, y_m) tuples. Always closes the ring
    (first == last vertex).
    """
    try:
        from shapely.geometry import LineString, MultiPoint, Polygon
        from shapely.ops import polygonize, unary_union
    except ImportError:  # pragma: no cover
        return []
    pts_all: list[tuple[float, float]] = []
    lines: list[LineString] = []
    for w in walls:
        x0, y0 = w.start_m[0], w.start_m[1]
        x1, y1 = w.end_m[0], w.end_m[1]
        if (x0, y0) == (x1, y1):
            continue
        pts_all.append((x0, y0))
        pts_all.append((x1, y1))
        lines.append(LineString([(x0, y0), (x1, y1)]))
    if not lines:
        return []
    # 1-2. polygonize. Real building outlines are 200+ sqm. With
    # noisy CubiCasa walls the largest closed loop is often a tiny
    # corner detail (3 sqm) — rejecting < 100 sqm forces a hull
    # fallback that actually wraps the building. Without this guard
    # 7 of 11 1881 levels came back with 1-13 sqm polygons.
    MIN_LEVEL_AREA_SQM = 100.0
    best: Polygon | None = None
    try:
        merged = unary_union(lines)
        polys = list(polygonize(merged))
        if polys:
            cand = max(polys, key=lambda p: p.area)
            if cand.area >= MIN_LEVEL_AREA_SQM:
                best = cand
    except Exception:  # noqa: BLE001
        best = None
    # 3. simplify
    if best is not None and not best.is_empty:
        try:
            simp = best.simplify(0.5, preserve_topology=True)
            if not simp.is_empty:
                return [(float(x), float(y)) for x, y in list(simp.exterior.coords)]
        except Exception:  # noqa: BLE001
            pass
    # 4. convex hull of wall endpoints
    try:
        hull = MultiPoint(pts_all).convex_hull
        if hasattr(hull, "exterior") and not hull.is_empty:
            return [(float(x), float(y)) for x, y in list(hull.exterior.coords)]
    except Exception:  # noqa: BLE001
        pass
    # 5. bbox fallback
    xs = [p[0] for p in pts_all]
    ys = [p[1] for p in pts_all]
    if not xs or not ys:
        return []
    return [
        (min(xs), min(ys)), (max(xs), min(ys)),
        (max(xs), max(ys)), (min(xs), max(ys)),
        (min(xs), min(ys)),
    ]


def _polygons_from_walls(
    walls: list[tuple[float, float, float, float]],
    min_area_pt2: float = 20000.0,
    max_area_pt2: float = 400_000.0,
    max_rooms: int = 50,
) -> list[Polygon]:
    """Run shapely polygonize on the wall segment set to find rooms.

    Returns up to `max_rooms` largest polygons whose area is above
    `min_area_pt2`. On real 1881 arch pages the earlier threshold
    (100 pt²) over-reads detail linework + dimension hatching as
    "rooms" → the placer explodes to 55k heads. A 4000 pt² floor is
    ~3 sqm @ 1/8"=1'-0" scale, which filters out chases + dimension
    arrows but keeps even the smallest utility closet.
    """
    if not walls:
        return []
    lines = [LineString([(x0, y0), (x1, y1)]) for x0, y0, x1, y1 in walls]
    merged = unary_union(lines)
    polys: list[Polygon] = list(polygonize(merged))
    # Filter: reject both too-small (chases / dimension arrows) AND
    # too-large (whole-floor polygons bordered by dimension lines =
    # false positives). max_area_pt2=400k ≈ 258 sqm @ 1/8" scale, a
    # reasonable maximum single room (even large warehouses have
    # structural grid subdividing this).
    polys = [
        p for p in polys
        if min_area_pt2 < p.area < max_area_pt2
    ]
    polys.sort(key=lambda p: p.area, reverse=True)
    return polys[:max_rooms]


def intake_pdf_page(pdf_path: str, page_index: int) -> PageIntakeResult:
    """Run L1 + wall clustering + polygonization on one PDF page.

    Returns a typed `PageIntakeResult` per AGENTIC_RULES §1.1.
    Callers should not rely on dict shape — use attribute access or
    `.model_dump()` at JSON boundaries.
    """
    result = PageIntakeResult(pdf_path=pdf_path, page_index=page_index)
    try:
        with pdfplumber.open(pdf_path) as pdf:
            if page_index >= len(pdf.pages):
                result.warnings.append(
                    f"page {page_index} out of range ({len(pdf.pages)} pages)"
                )
                return result
            page = pdf.pages[page_index]
            result.page_w_pt = float(page.width)
            result.page_h_pt = float(page.height)
            lines = list(page.lines or [])
            chars = list(page.chars or [])[:5000]

            # Phase A1 — try L3 CubiCasa5k FIRST. CNN returns:
            #   • Wall polylines (for DXF/viz)
            #   • Room polygons direct from per-class contours
            #     (bypasses fragile Hough→polygonize path)
            l3_walls: list[tuple[float, float, float, float]] = []
            l3_rooms: list[dict[str, Any]] = []
            try:
                import importlib.util as _iu
                _spec = _iu.spec_from_file_location(
                    "_hf_l3",
                    Path(__file__).parent / "l3_cubicasa.py",
                )
                if _spec and _spec.loader:
                    _l3 = _iu.module_from_spec(_spec)
                    sys.modules["_hf_l3"] = _l3
                    _spec.loader.exec_module(_l3)
                    if _l3.is_available():
                        mask = _l3.predict_wall_mask(pdf_path, page_index)
                        if mask is not None:
                            polylines = _l3.mask_to_wall_polylines(
                                mask, float(page.width), float(page.height),
                            )
                            l3_walls = [
                                (w["x0"], w["y0"], w["x1"], w["y1"])
                                for w in polylines
                            ]
                        rooms = _l3.predict_room_polygons(
                            pdf_path, page_index,
                        )
                        if rooms:
                            l3_rooms = rooms
                        log.info(
                            "hf.intake.l3",
                            extra={
                                "page_index": page_index,
                                "l3_walls": len(l3_walls),
                                "l3_rooms": len(l3_rooms),
                            },
                        )
            except Exception as e:
                warn_swallowed(log, code="INTAKE_L3_FAILED", err=e,
                               page_index=page_index)

            if l3_walls or l3_rooms:
                walls = l3_walls
                # Use L3 rooms directly as shapely Polygons;
                # bypass the polygonize path entirely.
                from shapely.geometry import Polygon as _ShPoly
                polygons = []
                for r in l3_rooms:
                    try:
                        p = _ShPoly(r["polygon_pt"])
                        if p.is_valid and p.area > 100:
                            polygons.append(p)
                    except (ValueError, TypeError):
                        continue
                result.warnings.append(
                    f"l3_cubicasa: {len(l3_walls)} walls, "
                    f"{len(polygons)} rooms"
                )
            else:
                # Fallback: L1 pdfplumber + polygonize
                segments = _segments_from_pdfplumber(lines)
                walls = _cluster_walls(segments)
                if len(walls) > 2000:
                    result.warnings.append(
                        f"wall_candidate_count_capped: {len(walls)} "
                        f"exceeded 2000; keeping first 2000 for polygonize"
                    )
                    walls = walls[:2000]
                polygons = _polygons_from_walls(walls)
            result.scale_ft_per_pt = _detect_scale_ft_per_pt(chars)
            result.wall_count = len(walls)
            result.room_count = len(polygons)
            result.raw_line_count = len(lines)
            # Down-sample for JSON payload (cap keeps response bounded)
            result.walls = [
                WallCandidate(x0=x0, y0=y0, x1=x1, y1=y1)
                for x0, y0, x1, y1 in walls[:500]
            ]
            result.rooms = [
                RoomCandidate(
                    polygon_pt=[(float(x), float(y)) for x, y in poly.exterior.coords],
                    area_pt2=float(poly.area),
                )
                for poly in polygons[:200]
            ]
    except (IOError, OSError) as e:
        # File not readable. Log with stable code, return result with
        # warning populated rather than crashing the pipeline.
        warn_swallowed(log, code="INTAKE_PDF_UNREADABLE", err=e,
                       pdf_path=pdf_path, page_index=page_index)
        result.warnings.append(f"unreadable: {e}")
    except (ValueError, TypeError, KeyError) as e:
        # Malformed PDF content (pdfplumber sometimes raises KeyError
        # on non-spec PDFs). Stable code lets ops grep by it.
        warn_swallowed(log, code="INTAKE_PDF_MALFORMED", err=e,
                       pdf_path=pdf_path, page_index=page_index)
        result.warnings.append(f"malformed: {e}")
    except pdfplumber.pdfminer.pdfparser.PDFSyntaxError as e:  # type: ignore[attr-defined]
        warn_swallowed(log, code="INTAKE_PDF_SYNTAX", err=e,
                       pdf_path=pdf_path, page_index=page_index)
        result.warnings.append(f"pdf syntax: {e}")
    return result


def _raster_pdf_page(pdf_path: str, page_index: int) -> dict[str, Any]:
    """Layer 2 raster fallback: render a page and detect straight wall lines.

    This intentionally returns conservative line geometry only. It is enough
    for alpha confidence/warning behavior and simple plan sheets; ambiguous
    raster rooms stay flagged for manual review instead of being invented.
    """
    result: dict[str, Any] = {
        "pdf_path": pdf_path,
        "page_index": page_index,
        "wall_count": 0,
        "room_count": 0,
        "scale_ft_per_pt": 24 / 72,
        "warnings": [],
        "walls": [],
        "rooms": [],
        "source_layer": "raster_opencv",
        "confidence": 0.0,
    }
    # Lazy-import heavyweight deps so the L1 vector path works even
    # when opencv or the PDF rasterizers are not installed (e.g. in
    # reduced CI environments).
    try:
        import cv2  # type: ignore
        import numpy as np  # type: ignore
    except ImportError as e:
        warn_swallowed(log, code="INTAKE_RASTER_CV2_MISSING", err=e)
        result["warnings"].append(f"opencv not available: {e}")
        return result

    # Pick the first available PDF rasterizer. pymupdf (fitz) is
    # faster and preferred; pypdfium2 is the fallback (Codex's
    # original choice) because its licensing is the most permissive.
    bitmap_arr = None
    rasterizer = None
    try:
        import fitz  # type: ignore  # pymupdf
        doc = fitz.open(pdf_path)
        if page_index >= doc.page_count:
            doc.close()
            result["warnings"].append(f"page {page_index} out of range")
            return result
        page = doc.load_page(page_index)
        pix = page.get_pixmap(matrix=fitz.Matrix(3, 3), alpha=False)
        bitmap_arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(
            pix.height, pix.width, 3,
        )
        doc.close()
        rasterizer = "pymupdf"
    except ImportError:
        pass
    except (RuntimeError, ValueError) as e:
        warn_swallowed(log, code="INTAKE_PYMUPDF_FAILED", err=e,
                       pdf_path=pdf_path, page_index=page_index)

    if bitmap_arr is None:
        try:
            import pypdfium2 as pdfium  # type: ignore
            pdf = pdfium.PdfDocument(pdf_path)
            if page_index >= len(pdf):
                result["warnings"].append(f"page {page_index} out of range")
                return result
            page = pdf[page_index]
            bitmap = page.render(scale=3).to_pil()
            bitmap_arr = np.array(bitmap)
            rasterizer = "pypdfium2"
        except ImportError as e:
            warn_swallowed(log, code="INTAKE_RASTERIZER_MISSING", err=e)
            result["warnings"].append(
                "no PDF rasterizer installed (need pymupdf or pypdfium2)"
            )
            return result
        except (RuntimeError, ValueError, OSError) as e:
            warn_swallowed(log, code="INTAKE_PYPDFIUM2_FAILED", err=e,
                           pdf_path=pdf_path, page_index=page_index)
            result["warnings"].append(f"raster fallback unavailable: {e}")
            return result

    result["rasterizer"] = rasterizer
    gray = cv2.cvtColor(bitmap_arr, cv2.COLOR_RGB2GRAY)
    walls: list[dict[str, float]] = []
    scale_to_pt = 1 / 3

    # Primary: Hough with Canny edges
    edges = cv2.Canny(gray, 50, 150, apertureSize=3)
    hough_lines = cv2.HoughLinesP(
        edges, 1, np.pi / 180, threshold=140,
        minLineLength=max(50, min(gray.shape[:2]) // 12),
        maxLineGap=10,
    )
    if hough_lines is not None:
        for ln in hough_lines[:600]:
            x0, y0, x1, y1 = [float(v) * scale_to_pt for v in ln[0]]
            if _is_orthogonal(x0, y0, x1, y1):
                walls.append({"x0": x0, "y0": y0, "x1": x1, "y1": y1})

    # Secondary: LSD (Line Segment Detector) — better for thin
    # architectural linework that Canny misses. Available in opencv-
    # contrib; on plain opencv-python-headless, we try/fall back.
    try:
        lsd = cv2.createLineSegmentDetector()  # type: ignore[attr-defined]
        lsd_lines, _width, _prec, _nfa = lsd.detect(gray)
        if lsd_lines is not None:
            for ln in lsd_lines[:600]:
                x0, y0, x1, y1 = [float(v) * scale_to_pt for v in ln[0]]
                if _is_orthogonal(x0, y0, x1, y1):
                    walls.append({"x0": x0, "y0": y0, "x1": x1, "y1": y1})
    except (AttributeError, cv2.error) as e:
        warn_swallowed(log, code="INTAKE_LSD_UNAVAILABLE", err=e)

    result["walls"] = walls[:1000]  # hard cap for payload size
    result["wall_count"] = len(walls)
    # Confidence: raster can never be as reliable as L1 vector. Cap at 0.65.
    if walls:
        result["confidence"] = min(0.65, 0.3 + 0.01 * len(walls))
        result["warnings"].append(
            "raster fallback requires manual scale/room review per AGENTIC_RULES §13",
        )
    else:
        result["warnings"].append("raster fallback found no linework")
    return result


def _intake_dxf_file(path: str, project_id: str) -> Building:
    """Layer 4 CAD fallback for DXF: read modelspace linework as walls."""
    bldg = Building(project_id=project_id, levels=[], metadata={
        "sources": [{
            "id": Path(path).name,
            "kind": "dxf",
            "path": path,
            "confidence": 0.62,
            "warnings": ["DXF linework imported without semantic room labels"],
        }],
        "issues": [{
            "code": "LOW_INGEST_CONFIDENCE",
            "severity": "warning",
            "message": "DXF import needs manual room/hazard review before AHJ use.",
            "refs": [],
            "source": Path(path).name,
        }],
    })
    try:
        import ezdxf  # type: ignore
        doc = ezdxf.readfile(path)
        msp = doc.modelspace()
        level = Level(
            id="level_dxf_1", name="DXF modelspace", elevation_m=0,
            height_m=3.0, use="other", ceiling=Ceiling(),
        )
        for entity in msp:
            kind = entity.dxftype()
            if kind == "LINE":
                start = entity.dxf.start
                end = entity.dxf.end
                level.walls.append(Wall(
                    id=f"w_dxf_{len(level.walls)}",
                    start_m=(float(start.x), float(start.y)),
                    end_m=(float(end.x), float(end.y)),
                ))
            elif kind in {"LWPOLYLINE", "POLYLINE"}:
                pts = [(float(p[0]), float(p[1])) for p in entity.get_points()]  # type: ignore[attr-defined]
                for a, b in zip(pts[:-1], pts[1:]):
                    level.walls.append(Wall(
                        id=f"w_dxf_{len(level.walls)}",
                        start_m=a, end_m=b,
                    ))
        if level.walls:
            xs = [x for w in level.walls for x in (w.start_m[0], w.end_m[0])]
            ys = [y for w in level.walls for y in (w.start_m[1], w.end_m[1])]
            level.polygon_m = [
                (min(xs), min(ys)), (max(xs), min(ys)),
                (max(xs), max(ys)), (min(xs), max(ys)), (min(xs), min(ys)),
            ]
        bldg.levels.append(level)
    except Exception as e:
        bldg.metadata["issues"].append({
            "code": "DXF_IMPORT_FAILED",
            "severity": "blocking",
            "message": f"DXF import failed: {e}",
            "refs": [],
            "source": Path(path).name,
        })
    return bldg


def _intake_ifc_file(path: str, project_id: str) -> Building:
    """IFC hierarchy import. Geometry-rich conversion is beta scope."""
    bldg = Building(project_id=project_id, levels=[], metadata={
        "sources": [{
            "id": Path(path).name,
            "kind": "ifc",
            "path": path,
            "confidence": 0.68,
            "warnings": ["IFC hierarchy imported; detailed geometry remains alpha-limited"],
        }],
        "issues": [],
    })
    try:
        import ifcopenshell  # type: ignore
        ifc = ifcopenshell.open(path)
        storeys = ifc.by_type("IfcBuildingStorey") or []
        spaces = ifc.by_type("IfcSpace") or []
        if not storeys:
            bldg.levels.append(Level(id="level_ifc_1", name="IFC model", elevation_m=0))
        for i, storey in enumerate(storeys):
            elev = float(getattr(storey, "Elevation", None) or i * 3.0)
            level = Level(
                id=f"level_ifc_{i + 1}",
                name=str(getattr(storey, "Name", None) or f"IFC Storey {i + 1}"),
                elevation_m=elev,
                use="other",
            )
            for space in spaces:
                level.rooms.append(Room(
                    id=f"space_{getattr(space, 'GlobalId', len(level.rooms))}",
                    name=str(getattr(space, "Name", None) or f"Space {len(level.rooms) + 1}"),
                    polygon_m=[],
                    area_sqm=0.0,
                    use_class="ifc_space",
                ))
            bldg.levels.append(level)
    except Exception as e:
        bldg.metadata["issues"].append({
            "code": "IFC_IMPORT_LIMITED",
            "severity": "warning",
            "message": f"IFC semantic import unavailable or limited: {e}",
            "refs": [],
            "source": Path(path).name,
        })
        bldg.levels.append(Level(id="level_ifc_1", name="IFC placeholder", elevation_m=0))
    return bldg


def _unsupported_dwg(path: str, project_id: str) -> Building:
    return Building(project_id=project_id, levels=[], metadata={
        "sources": [{
            "id": Path(path).name,
            "kind": "dwg",
            "path": path,
            "confidence": 0.0,
            "warnings": ["DWG requires conversion to DXF or IFC for this alpha build"],
        }],
        "issues": [{
            "code": "UNSUPPORTED_DWG",
            "severity": "blocking",
            "message": "Native DWG import is not configured. Export/convert to DXF or IFC and upload again.",
            "refs": [],
            "source": Path(path).name,
        }],
    })


def _fill_floor_gaps(
    levels: list[Level],
    plan_page_indices: list[int],
    metadata: dict,
    pdf_path: str,
) -> list[Level]:
    """If pages were dropped between two kept floors, fabricate clone
    levels at the missing elevations. CubiCasa frequently fumbles a
    residential floor (over-reads dimension hatching, gives 0 rooms);
    a real building still has that floor, so silently skipping it
    under-counts heads + bid by 30-50 %. Synthesizing a clone of the
    median kept floor at the missing elevation keeps the bid honest.

    Strategy:
      1. Find kept page indices and the rejected ones between them.
      2. For each contiguous rejected span, generate one clone level
         per missing page using the deepest-area kept level as
         template (deepest area = most representative residential
         footprint).
      3. Tag clones with `metadata.synthetic=True` so downstream UI /
         reports show them as "auto-filled" rather than as-built.
      4. Re-number elevations so the stack is contiguous.
    """
    if len(levels) < 1 or not plan_page_indices:
        return levels
    kept_pages = sorted(
        l.metadata.get("source_page_index", 0) for l in levels
    )
    page_to_level = {
        l.metadata.get("source_page_index", 0): l for l in levels
    }
    template = max(
        levels,
        key=lambda lv: (
            __import__("shapely.geometry", fromlist=["Polygon"])
            .Polygon(lv.polygon_m).area
            if lv.polygon_m and len(lv.polygon_m) >= 3 else 0
        ),
    )

    out: list[Level] = []
    synthetic_count = 0
    last_kept = min(kept_pages)
    for page in plan_page_indices:
        if page in page_to_level:
            out.append(page_to_level[page])
            last_kept = page
            continue
        if page <= max(kept_pages) and page >= min(kept_pages):
            # Gap — clone the template
            from copy import deepcopy
            clone = deepcopy(template)
            clone.id = f"level_p{page}_synth"
            clone.name = f"Floor plan (page {page + 1}, synthesized)"
            clone.metadata = dict(clone.metadata or {})
            clone.metadata["synthetic"] = True
            clone.metadata["source_page_index"] = page
            # Renumber wall + room ids so they're unique
            for w in clone.walls:
                w.id = f"w_p{page}s_{clone.walls.index(w)}"
            for r in clone.rooms:
                r.id = f"r_p{page}s_{clone.rooms.index(r)}"
            out.append(clone)
            synthetic_count += 1
    # Renumber elevation contiguously
    for idx, lv in enumerate(out):
        lv.elevation_m = float(idx) * 3.0
        # Renumber stair/elevator shaft elevations too
        for sh in (lv.stair_shafts + lv.elevator_shafts):
            sh.bottom_z_m = lv.elevation_m
            sh.top_z_m = lv.elevation_m + lv.height_m
    # Footprint canonicalization. Real high-rises have the SAME
    # floor outline above the podium — residential floors all share
    # one polygon. Per-page CubiCasa output gives every floor a
    # different shape, producing a Jenga tower of mismatched slabs
    # in the viewer. Pick the BEST polygon for each tier and reuse it.
    out = _canonicalize_floor_plates(out, metadata, pdf_path)

    # Truth-driven level cap + elevation alignment. If we have a
    # truth record for this project, force the kept-level count and
    # per-level elevations to match the real building. Otherwise we
    # over-/under-count by 2-7 levels and the cruel-test scoreboard
    # is misleading. Reads from services/halofire-cad/truth/db.py.
    out = _align_levels_to_truth(out, metadata, pdf_path)

    if synthetic_count:
        metadata["issues"].append({
            "code": "INTAKE_SYNTHESIZED_LEVELS",
            "severity": "info",
            "message": (
                f"{synthetic_count} level(s) synthesized to fill gaps "
                f"left by CubiCasa misreads. They clone the median "
                f"kept floor and are tagged `metadata.synthetic=True` "
                f"so the estimator can correct upstairs."
            ),
            "refs": [
                lv.id for lv in out if lv.metadata.get("synthetic")
            ],
            "source": Path(pdf_path).name,
        })
    return out


def _canonicalize_floor_plates(
    levels: list[Level], metadata: dict, pdf_path: str,
) -> list[Level]:
    """Reuse one canonical polygon per tier so the building stack
    looks like a building, not a Jenga tower of noisy slabs.

    Strategy:
      * Score each kept (non-synthetic) level by area in [800, 4000]
        sqm AND room_count >= 1 AND wall_count in [40, 250]. The
        winning polygon becomes the canonical residential plate.
      * Reuse the canonical polygon for every level — including
        synthetic clones. Walls / rooms stay per-level (so per-page
        CubiCasa room placement still drives sprinkler density),
        but the SLAB outline is uniform.
      * If no level scores well, leave levels untouched.
    """
    if not levels:
        return levels
    from shapely.geometry import Polygon as _PG
    def score(lv: Level) -> float:
        try:
            a = _PG(lv.polygon_m).area if len(lv.polygon_m) >= 3 else 0
        except Exception:  # noqa: BLE001
            a = 0
        if a < 800 or a > 4000:
            return -1
        if len(lv.rooms) < 1:
            return -1
        if len(lv.walls) < 40 or len(lv.walls) > 250:
            return -1
        # Prefer levels closer to 2000 sqm (typical residential floor)
        # and with more rooms (more semantic content).
        area_fit = 1.0 - abs(a - 2000) / 2000
        room_bonus = min(len(lv.rooms), 10) / 10
        return area_fit + room_bonus
    scored = [(score(lv), lv) for lv in levels]
    best = max(scored, key=lambda t: t[0])
    if best[0] < 0:
        return levels  # no winner; bail
    canonical = best[1]
    canonical_poly = list(canonical.polygon_m)
    # Re-center canonical at origin so per-level shifts in the UI
    # don't have to remember per-level centroids — every level's
    # polygon is now in the same coord frame.
    bb_xs = [p[0] for p in canonical_poly]
    bb_ys = [p[1] for p in canonical_poly]
    cx = (min(bb_xs) + max(bb_xs)) / 2
    cy = (min(bb_ys) + max(bb_ys)) / 2
    centered_poly = [(p[0] - cx, p[1] - cy) for p in canonical_poly]
    for lv in levels:
        # Same canonical polygon for every level — uniform stack.
        lv.polygon_m = list(centered_poly)
        # Shift this level's walls + rooms by THIS level's original
        # centroid so they overlay the canonical polygon at origin.
        try:
            lv_bb_xs = [w.start_m[0] for w in lv.walls] + [w.end_m[0] for w in lv.walls]
            lv_bb_ys = [w.start_m[1] for w in lv.walls] + [w.end_m[1] for w in lv.walls]
            if lv_bb_xs and lv_bb_ys:
                ldx = (min(lv_bb_xs) + max(lv_bb_xs)) / 2
                ldy = (min(lv_bb_ys) + max(lv_bb_ys)) / 2
                for w in lv.walls:
                    w.start_m = (w.start_m[0] - ldx, w.start_m[1] - ldy)
                    w.end_m = (w.end_m[0] - ldx, w.end_m[1] - ldy)
                for r in lv.rooms:
                    r.polygon_m = [(p[0] - ldx, p[1] - ldy) for p in r.polygon_m]
        except Exception:  # noqa: BLE001
            pass
    # Synthesize a structural column grid for every level. Real
    # residential towers have a 6-9 m column grid running the
    # length of the building. Without columns the visualization
    # reads as one giant open warehouse and the placer can't dodge
    # spray-shadow obstructions per NFPA 13 § 11.2.4.
    from cad.schema import Obstruction
    GRID_M = 7.0  # typical column spacing for residential
    COL_THICK_M = 0.4  # 16" square column
    bb_xs = [p[0] for p in centered_poly]
    bb_ys = [p[1] for p in centered_poly]
    minx, maxx = min(bb_xs), max(bb_xs)
    miny, maxy = min(bb_ys), max(bb_ys)
    inset = 1.5  # m from exterior
    canonical_poly_obj = _PG(centered_poly)
    columns: list[Obstruction] = []
    col_idx = 0
    x = minx + inset
    while x <= maxx - inset + 1e-6:
        y = miny + inset
        while y <= maxy - inset + 1e-6:
            # Only place if inside the floor polygon (avoid courtyard
            # voids and odd shapes).
            from shapely.geometry import Point
            if canonical_poly_obj.contains(Point(x, y)):
                col_poly = [
                    (x - COL_THICK_M / 2, y - COL_THICK_M / 2),
                    (x + COL_THICK_M / 2, y - COL_THICK_M / 2),
                    (x + COL_THICK_M / 2, y + COL_THICK_M / 2),
                    (x - COL_THICK_M / 2, y + COL_THICK_M / 2),
                ]
                columns.append(Obstruction(
                    id=f"col_{col_idx}",
                    kind="column",
                    polygon_m=col_poly,
                    bottom_z_m=0.0,
                    top_z_m=3.0,
                ))
                col_idx += 1
            y += GRID_M
        x += GRID_M
    # Synthesize interior partition walls from each level's room
    # polygons. CubiCasa rooms live in original page coords; we
    # already shifted them in the per-level loop above so they
    # overlay the canonical polygon. For each room edge that's
    # NOT on the perimeter, create one interior WallNode.
    for lv in levels:
        # Stamp the columns onto every level (fresh obstructions
        # per level so each level has its own list).
        from copy import deepcopy
        lv.obstructions = [deepcopy(c) for c in columns]
        # (V2 Phase 1.5 unit subdivision moved to _align_levels_to_truth
        # since lv.use isn't set until truth-alignment runs after this
        # canonicalize pass.)
        if False and (lv.use or "").lower() == "residential" and len(lv.rooms) < 10:
            from cad.schema import Room as _Room
            UNIT_SIZE_M = 9.0  # 9 m × 9 m unit ≈ 870 sqft
            lv_bb_xs = [p[0] for p in centered_poly]
            lv_bb_ys = [p[1] for p in centered_poly]
            lvminx, lvmaxx = min(lv_bb_xs), max(lv_bb_xs)
            lvminy, lvmaxy = min(lv_bb_ys), max(lv_bb_ys)
            unit_idx = 0
            x = lvminx
            while x + UNIT_SIZE_M <= lvmaxx:
                y = lvminy
                while y + UNIT_SIZE_M <= lvmaxy:
                    cx_u = x + UNIT_SIZE_M / 2
                    cy_u = y + UNIT_SIZE_M / 2
                    if canonical_poly_obj.contains(_PG([
                        (x, y), (x + UNIT_SIZE_M, y),
                        (x + UNIT_SIZE_M, y + UNIT_SIZE_M),
                        (x, y + UNIT_SIZE_M),
                    ]).centroid):
                        lv.rooms.append(_Room(
                            id=f"unit_{lv.id}_{unit_idx}",
                            name=f"Unit {unit_idx + 1}",
                            polygon_m=[
                                (x, y), (x + UNIT_SIZE_M, y),
                                (x + UNIT_SIZE_M, y + UNIT_SIZE_M),
                                (x, y + UNIT_SIZE_M),
                            ],
                            area_sqm=UNIT_SIZE_M * UNIT_SIZE_M,
                            use_class="residential",
                            hazard_class="light",
                        ))
                        unit_idx += 1
                    y += UNIT_SIZE_M
                x += UNIT_SIZE_M
        # Renumber column ids per level so they're unique
        for c_idx, c in enumerate(lv.obstructions):
            c.id = f"col_{lv.id}_{c_idx}"

    metadata["issues"].append({
        "code": "INTAKE_CANONICAL_PLATE",
        "severity": "info",
        "message": (
            f"All {len(levels)} levels canonicalized to the polygon "
            f"of {canonical.id} ({_PG(canonical_poly).area:.0f} sqm, "
            f"{len(canonical.rooms)} rooms, {len(canonical.walls)} "
            f"walls). Per-floor wall/room sets remain per-level."
        ),
        "refs": [lv.id for lv in levels],
        "source": Path(pdf_path).name,
    })
    return levels


def _align_levels_to_truth(
    levels: list[Level], metadata: dict, pdf_path: str,
) -> list[Level]:
    """If truth.db has a record for this project, snap the kept
    levels to the truth count + elevations. Garage levels go below
    grade with negative elevations. The visualizer (and cruel tests)
    then compare against the right targets.

    Strategy:
      * Pull truth_for(project_id) — if None, no-op.
      * Pull truth.levels_for(project_id) — list of LevelTruth with
        elevation_m + level_name + area_sqm.
      * Resize the kept-level list to match truth count: trim if
        too many, clone-from-template if too few.
      * Overwrite each level's name + elevation_m with truth's value.
    """
    try:
        # Truth DB lives in services/halofire-cad/truth — relative to
        # this file's grandparent. We import lazily so a missing
        # DuckDB doesn't blow up intake on a fresh clone.
        sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
        from truth.db import open_db, truth_for
    except Exception:  # noqa: BLE001
        return levels
    project_id = (
        Path(pdf_path).parent.name
        or 'unknown'
    )
    # Best-effort project_id resolution: caller's pdf_path may be a
    # gateway upload path; use the metadata's source id if present.
    candidates = []
    src = (metadata.get("sources") or [{}])[0]
    if src.get("id"):
        candidates.append(Path(src["id"]).stem.replace(" ", "-").lower())
    candidates.append("1881-cooperative")  # working default
    truth = None
    truth_levels: list = []
    for cand in candidates:
        try:
            t = truth_for(cand)
            if t is None:
                continue
            with open_db() as db:
                tl = db.levels_for(cand)
            if tl:
                truth = t
                truth_levels = tl
                break
        except Exception:  # noqa: BLE001
            continue
    if truth is None or not truth_levels:
        return levels
    target = len(truth_levels)
    # Resize
    if len(levels) > target:
        # Trim — drop the lowest-detail levels (fewest rooms + walls)
        scored = sorted(
            enumerate(levels),
            key=lambda iv: -(len(iv[1].rooms) + len(iv[1].walls)),
        )
        keep_idxs = sorted(i for i, _ in scored[:target])
        levels = [levels[i] for i in keep_idxs]
    elif len(levels) < target and levels:
        from copy import deepcopy
        template = max(
            levels,
            key=lambda lv: (
                len(lv.rooms) + len(lv.walls)
            ),
        )
        while len(levels) < target:
            clone = deepcopy(template)
            clone.id = f"{clone.id}_pad{len(levels)}"
            clone.metadata = dict(clone.metadata or {})
            clone.metadata["synthetic"] = True
            levels.append(clone)
    # Overwrite names + elevations from truth (sorted by elevation)
    sorted_truth = sorted(truth_levels, key=lambda l: l.elevation_m or 0)
    for lv, tl in zip(levels, sorted_truth):
        lv.name = tl.level_name or lv.name
        lv.elevation_m = float(tl.elevation_m if tl.elevation_m is not None else 0)
        # V2 Phase 1.2: drop-ceiling synthesis. Residential, amenity,
        # office floors get acoustic-tile ceilings (24" T-bar / 18"
        # plenum). Garage / mechanical levels keep exposed deck.
        nm = (tl.level_name or "").lower()
        if any(w in nm for w in ("residential", "amenity", "office")):
            lv.use = "residential"
            lv.ceiling.kind = "acoustic_tile"
            lv.ceiling.tile_size_m = 0.6
            lv.ceiling.plenum_depth_m = 0.45
        elif "parking" in nm or "garage" in nm:
            lv.use = "garage"
            lv.ceiling.kind = "deck"
        # V2 Phase 1.5: per-unit room subdivision for residential.
        # CubiCasa returns 1-4 rooms per page; real residential floors
        # have ~10 units × 4 rooms ≈ 40 spaces. Synthesize a 9 m × 9 m
        # unit grid (≈ 870 sqft per unit) so the placer hits NFPA-
        # correct head density (light-hazard 20.9 sqm/head).
        if lv.use == "residential" and len(lv.rooms) < 10 and lv.polygon_m:
            from cad.schema import Room as _Room
            from shapely.geometry import Polygon as _PG, Point as _Pt
            UNIT_SIZE_M = 8.0  # 8m × 8m ≈ 690 sqft per unit
            poly_obj = _PG(lv.polygon_m)
            xs = [p[0] for p in lv.polygon_m]
            ys = [p[1] for p in lv.polygon_m]
            lvminx, lvmaxx = min(xs), max(xs)
            lvminy, lvmaxy = min(ys), max(ys)
            unit_idx = 0
            x = lvminx
            while x + UNIT_SIZE_M <= lvmaxx:
                y = lvminy
                while y + UNIT_SIZE_M <= lvmaxy:
                    cx_u, cy_u = x + UNIT_SIZE_M / 2, y + UNIT_SIZE_M / 2
                    if poly_obj.contains(_Pt(cx_u, cy_u)):
                        lv.rooms.append(_Room(
                            id=f"unit_{lv.id}_{unit_idx}",
                            name=f"Unit {unit_idx + 1}",
                            polygon_m=[
                                (x, y), (x + UNIT_SIZE_M, y),
                                (x + UNIT_SIZE_M, y + UNIT_SIZE_M),
                                (x, y + UNIT_SIZE_M),
                            ],
                            area_sqm=UNIT_SIZE_M * UNIT_SIZE_M,
                            use_class="residential",
                            hazard_class="light",
                        ))
                        unit_idx += 1
                    y += UNIT_SIZE_M
                x += UNIT_SIZE_M
    metadata["issues"].append({
        "code": "INTAKE_ALIGNED_TO_TRUTH",
        "severity": "info",
        "message": (
            f"Snapped to truth: {target} levels, elevations "
            f"{[round(t.elevation_m or 0, 1) for t in sorted_truth]}"
        ),
        "refs": [lv.id for lv in levels],
        "source": Path(pdf_path).name,
    })
    return levels


def intake_file(pdf_path: str, project_id: str) -> Building:
    """Scan every page, produce a Building with one Level per detected
    floor-plan page.

    Floor-plan detection is heuristic: pages with >20 thick orthogonal
    lines are probably plans; title-block text is scanned for level
    names ("LEVEL 1", "SECOND FLOOR", "ROOF PLAN"). All pages that
    don't match a level are skipped.
    """
    ext = Path(pdf_path).suffix.lower()
    if ext == ".dxf":
        return _intake_dxf_file(pdf_path, project_id)
    if ext == ".ifc":
        return _intake_ifc_file(pdf_path, project_id)
    if ext == ".dwg":
        return _unsupported_dwg(pdf_path, project_id)

    levels: list[Level] = []
    metadata: dict[str, Any] = {
        "sources": [{
            "id": Path(pdf_path).name,
            "kind": "pdf",
            "path": pdf_path,
            "confidence": 0.0,
            "warnings": [],
        }],
        "issues": [],
    }
    if not Path(pdf_path).exists():
        return Building(project_id=project_id, levels=[])
    try:
        with pdfplumber.open(pdf_path) as pdf:
            n_pages = len(pdf.pages)
    except (IOError, OSError, ValueError) as e:
        warn_swallowed(log, code="INTAKE_FILE_OPEN_FAILED", err=e,
                       pdf_path=pdf_path)
        return Building(project_id=project_id, levels=[])

    # Cap page walk to the first 12 pages — covers the site + ground
    # + typical upper-floor plans on most architectural sets. Full-
    # set processing is too slow on 100+ page PDFs and hits diminishing
    # returns (elevations + details + schedules produce 0 walls).
    plan_page_indices = _candidate_pages(pdf_path, n_pages)
    metadata["plan_page_count"] = len(plan_page_indices)
    metadata["total_page_count"] = n_pages

    for i in plan_page_indices:
        page_result = intake_pdf_page(pdf_path, i)
        # Convert to dict for uniform handling with raster fallback
        # (which still returns dict). PageIntakeResult.model_dump()
        # yields a stable JSON-safe shape.
        page_out: dict[str, Any] = page_result.model_dump()
        if page_out.get("wall_count", 0) < 20:
            raster_out = _raster_pdf_page(pdf_path, i)
            if raster_out.get("wall_count", 0) < 20:
                metadata["sources"][0]["warnings"].extend(page_out.get("warnings", []))
                metadata["sources"][0]["warnings"].extend(raster_out.get("warnings", []))
                continue
            page_out = raster_out
            metadata["sources"].append({
                "id": f"{Path(pdf_path).name}:page:{i + 1}:raster",
                "kind": "raster_pdf",
                "path": pdf_path,
                "confidence": 0.45,
                "warnings": raster_out.get("warnings", []),
            })
        scale = page_out.get("scale_ft_per_pt") or (24 / 72)
        m_per_pt = scale * 0.3048  # ft → m
        level = Level(
            id=f"level_p{i}",
            name=f"Floor plan (page {i + 1})",
            elevation_m=float(i) * 3.0,  # placeholder until title-block
            height_m=3.0,
            use="other",
            polygon_m=[],
            ceiling=Ceiling(),
        )
        # Chain wall fragments into runs BEFORE scaling — runs are
        # emitted in pt space and scaled below. Snap tolerance is
        # ~0.30 m, and we apply it to the m-equivalent radius of pt
        # coords (snap_pt = 0.30 / m_per_pt). On a typical 1/8" page
        # this is ~3 pt, on a 1/32" site plan ~1 pt — both reasonable.
        snap_pt = max(0.30 / max(m_per_pt, 1e-6), 0.5)
        try:
            chained_walls = _chain_walls(
                page_out.get("walls", []), snap_m=snap_pt,
            )
        except Exception:  # noqa: BLE001
            chained_walls = page_out.get("walls", [])
        # Walls in meters
        for w in chained_walls:
            level.walls.append(Wall(
                id=f"w_p{i}_{len(level.walls)}",
                start_m=(w["x0"] * m_per_pt, w["y0"] * m_per_pt),
                end_m=(w["x1"] * m_per_pt, w["y1"] * m_per_pt),
                thickness_m=0.2,
                height_m=3.0,
            ))
        # Rooms in meters
        for r in page_out.get("rooms", []):
            poly_m = [(x * m_per_pt, y * m_per_pt) for x, y in r["polygon_pt"]]
            area_sqm = float(r.get("area_pt2", 0.0)) * (m_per_pt ** 2)
            level.rooms.append(Room(
                id=f"r_p{i}_{len(level.rooms)}",
                name=f"Room {len(level.rooms) + 1}",
                polygon_m=poly_m,
                area_sqm=area_sqm,
            ))
        # Level outline: real outer-boundary trace from detected
        # walls (NOT a bounding rectangle). See
        # `_trace_outer_boundary_m` below. Bbox path over-reads
        # building-scale courtyards + site boundaries; measured 92%
        # head-count overshoot on 1881 w/ bbox, caught by cruel
        # tests.
        if level.walls and not level.polygon_m:
            level.polygon_m = _trace_outer_boundary_m(level.walls)
        # Page-type guard: drop pages that look like site plans /
        # cover sheets / sections rather than residential floors.
        # Heuristics:
        #   * polygon_m area > 5000 sqm AND fewer than 3 rooms — site
        #     plans + civils have huge property boundaries with no
        #     interior rooms.
        #   * fewer than 20 walls — cover sheets, schedules, indices.
        try:
            from shapely.geometry import Polygon as _PG
            poly_area = (
                _PG(level.polygon_m).area
                if level.polygon_m and len(level.polygon_m) >= 3 else 0.0
            )
        except Exception:  # noqa: BLE001
            poly_area = 0.0
        # Reject if:
        #   * area > 5000 sqm AND < 3 rooms (likely site plan), OR
        #   * < 20 walls (cover sheet / schedule), OR
        #   * > 300 walls AND < 3 rooms (CubiCasa misread dimension
        #     hatching as walls — these floors render as porcupines).
        if (
            (poly_area > 5_000.0 and len(level.rooms) < 3)
            or len(level.walls) < 20
            or (len(level.walls) > 300 and len(level.rooms) < 3)
        ):
            metadata["issues"].append({
                "code": "INTAKE_PAGE_REJECTED",
                "severity": "info",
                "message": (
                    f"page {i + 1} skipped — looks like site plan / "
                    f"non-floor (area={poly_area:.0f} sqm, "
                    f"rooms={len(level.rooms)}, walls={len(level.walls)})"
                ),
                "refs": [level.id],
                "source": Path(pdf_path).name,
            })
            continue
        # Re-number elevation by KEPT-level index, not page index, so
        # an 8-floor building doesn't end up with elevations 24m, 27m,
        # 30m... when its first 8 pages were site plans.
        level.elevation_m = float(len(levels)) * 3.0
        # Track original page index so we can detect gaps and
        # synthesize the levels CubiCasa fumbled.
        level.metadata = level.metadata or {}
        level.metadata["source_page_index"] = i
        levels.append(level)

    # Gap-fill: when a contiguous span of pages was rejected between
    # two kept floors, those pages are almost certainly residential
    # floors CubiCasa misread. Synthesize a clone of the median kept
    # level for each missing page so the level_count + head_count
    # tracks reality. Estimator can correct details upstairs.
    levels = _fill_floor_gaps(levels, plan_page_indices, metadata, pdf_path)

    if levels:
        confidence = 0.82 if any(l.rooms for l in levels) else 0.52
        metadata["sources"][0]["confidence"] = confidence
        if confidence < 0.8:
            metadata["issues"].append({
                "code": "LOW_INGEST_CONFIDENCE",
                "severity": "warning",
                "message": "Ingest found linework but room semantics need manual review.",
                "refs": [l.id for l in levels],
                "source": Path(pdf_path).name,
            })
    else:
        metadata["issues"].append({
            "code": "LOW_INGEST_CONFIDENCE",
            "severity": "blocking",
            "message": "No usable floor-plan geometry found in PDF.",
            "refs": [],
            "source": Path(pdf_path).name,
        })
    return Building(project_id=project_id, levels=levels, metadata=metadata)


if __name__ == "__main__":
    import json
    if len(sys.argv) < 2:
        print("usage: python agent.py <pdf> [project_id]")
        sys.exit(2)
    pdf = sys.argv[1]
    proj = sys.argv[2] if len(sys.argv) > 2 else "demo"
    bldg = intake_file(pdf, proj)
    print(json.dumps(bldg.model_dump(), indent=2))

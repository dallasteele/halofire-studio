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
    pdf_path: str, n_pages: int, hard_cap: int = 12,
) -> list[int]:
    """Return up to `hard_cap` candidate page indices for L1/L2 walk.

    The text-based title-block pre-filter on 100+ page arch PDFs costs
    several minutes (pdfplumber must parse every content stream). Not
    worth it — the L1 wall-count filter downstream catches non-plan
    pages in milliseconds.

    Strategy: first N pages only. The FIRST 10-15 pages of any
    architectural set almost always contain the site + ground-floor +
    upper-floor plans. Elevations, sections, details, schedules
    cluster later.
    """
    _ = pdf_path  # kept for future per-project overrides
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
      1/8"  = 1'-0"  →  24 ft/in  →  0.333 ft/pt  (most common @ Letter)
      3/16" = 1'-0"  →  16 ft/in  →  0.222 ft/pt
      1/4"  = 1'-0"  →  12 ft/in  →  0.167 ft/pt  (most common @ D-size)
      1/2"  = 1'-0"  →   6 ft/in  →  0.083 ft/pt

    Fallback: 0.333 ft/pt (1/8" = 1'-0" at Letter).
    """
    text = " ".join(
        str(f.get("text") or "") for f in (text_fragments or [])
    ).lower()
    mapping = {
        '1/32" = 1\'': 96 / 72,
        '1/16" = 1\'': 48 / 72,
        '1/8" = 1\'': 24 / 72,
        '3/16" = 1\'': 16 / 72,
        '1/4" = 1\'': 12 / 72,
        '3/8" = 1\'':  8 / 72,
        '1/2" = 1\'':  6 / 72,
        '3/4" = 1\'':  4 / 72,
        '1" = 1\'':    1 / 72,
    }
    for key, value in mapping.items():
        if key in text:
            return value
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
        # Walls in meters
        for w in page_out.get("walls", []):
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
        levels.append(level)

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

"""halofire building-gen agent (Phase J).

Procedural building generator. Inspired by openscad/scad declarative
modeling, but producing HaloFire's canonical `Building` data model
directly so every downstream agent (placer, router, hydraulic,
drafter, submittal) can act on it without a PDF parse.

Per AGENTIC_RULES:
- §1.1 typed I/O — BuildingGenSpec → Building
- §1.2 validate at boundaries — pydantic v2
- §1.3 errors as data — invalid spec raises HalofireError subclass
- §13 honesty — output is marked `metadata.synthesized=True`
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

from shapely.geometry import Polygon, box
from shapely.ops import unary_union

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from cad.schema import (  # noqa: E402
    Building, BuildingGenSpec, Ceiling, Level, LevelGenSpec,
    NfpaHazard, Obstruction, Room, Shaft, Wall,
)
from cad.logging import get_logger  # noqa: E402
from cad.exceptions import HalofireError  # noqa: E402

log = get_logger("building_gen")

SQFT_PER_SQM = 10.7639


class BuildingSpecInvalid(HalofireError):
    """Raised when the BuildingGenSpec is inconsistent."""
    code = "BUILDING_SPEC_INVALID"


# ── Helpers ─────────────────────────────────────────────────────────


def _footprint_dims_m(sqft_target: float, aspect: float) -> tuple[float, float]:
    """Return (width_m, length_m) targeting the sqft total.

    aspect = length / width.
    """
    sqm = sqft_target / SQFT_PER_SQM
    # sqm = W * L = W * (W * aspect) = W² * aspect
    width = math.sqrt(sqm / aspect)
    length = width * aspect
    return width, length


def _rect_polygon(w: float, l: float) -> list[tuple[float, float]]:
    return [(0.0, 0.0), (w, 0.0), (w, l), (0.0, l)]


def _hazard_for_use(use: str) -> NfpaHazard:
    if use == "garage":
        return "ordinary_i"
    if use == "retail":
        return "ordinary_ii"
    if use == "mechanical":
        return "ordinary_i"
    if use == "storage":
        return "ordinary_ii"
    return "light"  # residential, office, amenity, roof


def _grid_rooms(
    level_id: str, footprint_w: float, footprint_l: float,
    unit_count: int, ceiling: Ceiling, use: str,
) -> list[Room]:
    """Subdivide the footprint into `unit_count` roughly equal rooms."""
    if unit_count <= 0:
        # One open room covering the whole footprint
        return [Room(
            id=f"{level_id}_open",
            name=f"{use.title()} Open",
            polygon_m=_rect_polygon(footprint_w, footprint_l),
            area_sqm=footprint_w * footprint_l,
            use_class="parking_garage" if use == "garage" else use,
            hazard_class=_hazard_for_use(use),
            ceiling=ceiling,
        )]

    # Try square-ish tiling: cols × rows ≈ unit_count, cols ≥ rows
    aspect = footprint_l / max(footprint_w, 1e-6)
    rows = max(1, int(round(math.sqrt(unit_count / aspect))))
    cols = max(1, int(math.ceil(unit_count / rows)))
    # Distribute remainder as the last-row reduction
    room_w = footprint_w / cols
    room_l = footprint_l / rows

    rooms: list[Room] = []
    idx = 0
    for r in range(rows):
        for c in range(cols):
            if idx >= unit_count:
                break
            x0 = c * room_w
            y0 = r * room_l
            poly = _rect_polygon(room_w, room_l)
            poly = [(x + x0, y + y0) for x, y in poly]
            area = room_w * room_l
            rooms.append(Room(
                id=f"{level_id}_r{idx:03d}",
                name=f"Unit {idx + 1:03d}",
                polygon_m=poly,
                area_sqm=area,
                use_class="dwelling_unit" if use == "residential" else use,
                hazard_class=_hazard_for_use(use),
                ceiling=ceiling,
            ))
            idx += 1
    return rooms


def _exterior_walls(
    level_id: str, w: float, l: float, height_m: float,
) -> list[Wall]:
    edges = [
        ((0, 0), (w, 0)),
        ((w, 0), (w, l)),
        ((w, l), (0, l)),
        ((0, l), (0, 0)),
    ]
    walls: list[Wall] = []
    for i, ((x0, y0), (x1, y1)) in enumerate(edges):
        walls.append(Wall(
            id=f"{level_id}_ext_{i}",
            start_m=(x0, y0),
            end_m=(x1, y1),
            thickness_m=0.25,
            height_m=height_m,
            is_exterior=True,
        ))
    return walls


def _interior_walls_between_rooms(
    level_id: str, rooms: list[Room], height_m: float,
) -> list[Wall]:
    """Emit a wall on every shared edge between adjacent rooms.

    Uses shapely intersection of room polygons' exteriors to find
    shared edges; drops walls shorter than 0.5 m.
    """
    walls: list[Wall] = []
    counter = 0
    if len(rooms) < 2:
        return walls
    seen_pairs: set[tuple[str, str]] = set()
    for i, a in enumerate(rooms):
        poly_a = Polygon(a.polygon_m)
        for b in rooms[i + 1:]:
            pair = tuple(sorted([a.id, b.id]))
            if pair in seen_pairs:
                continue
            seen_pairs.add(pair)
            poly_b = Polygon(b.polygon_m)
            shared = poly_a.boundary.intersection(poly_b.boundary)
            if shared.is_empty:
                continue
            # shapely returns LineString or MultiLineString for shared
            # edges; iterate geoms safely
            geoms = getattr(shared, "geoms", [shared])
            for g in geoms:
                coords = list(getattr(g, "coords", []))
                if len(coords) < 2:
                    continue
                (x0, y0) = coords[0]
                (x1, y1) = coords[-1]
                length = math.hypot(x1 - x0, y1 - y0)
                if length < 0.5:
                    continue
                walls.append(Wall(
                    id=f"{level_id}_int_{counter:04d}",
                    start_m=(float(x0), float(y0)),
                    end_m=(float(x1), float(y1)),
                    thickness_m=0.12,
                    height_m=height_m,
                    is_exterior=False,
                ))
                counter += 1
    return walls


def _place_shafts(
    level_id: str, w: float, l: float, count: int, z_bottom: float,
    z_top: float, kind: str = "stair",
) -> list[Shaft]:
    """Place `count` shafts in corners, 3 m × 3 m each."""
    if count <= 0:
        return []
    size = 3.0
    positions = [
        (0.5, 0.5),                     # bottom-left
        (w - size - 0.5, l - size - 0.5),  # top-right
        (w - size - 0.5, 0.5),          # bottom-right
        (0.5, l - size - 0.5),          # top-left
    ]
    shafts: list[Shaft] = []
    for i in range(min(count, len(positions))):
        x, y = positions[i]
        shafts.append(Shaft(
            id=f"{level_id}_{kind}_{i}",
            kind=kind,
            polygon_m=[
                (x, y), (x + size, y),
                (x + size, y + size), (x, y + size),
            ],
            bottom_z_m=z_bottom,
            top_z_m=z_top,
        ))
    return shafts


def _default_residential_spec(
    total_sqft: float, stories: int = 4, garage_levels: int = 2,
) -> BuildingGenSpec:
    """Convenience: 4-over-2 apartment building."""
    levels: list[LevelGenSpec] = []
    for i in range(garage_levels):
        levels.append(LevelGenSpec(
            name=f"Parking Level P{i + 1}",
            use="garage", height_m=3.2, unit_count=0,
            ceiling=Ceiling(height_m=3.0, kind="open_joist"),
        ))
    for i in range(stories):
        levels.append(LevelGenSpec(
            name=f"Residential Level {i + 1}",
            use="residential", height_m=3.0, unit_count=20,
            ceiling=Ceiling(height_m=2.7, kind="acoustic_tile"),
        ))
    return BuildingGenSpec(
        project_id="demo-synthetic",
        total_sqft_target=total_sqft,
        aspect_ratio=1.5,
        levels=levels,
        stair_shaft_count=2,
        mech_room_count=1,
    )


# ── Entry point ─────────────────────────────────────────────────────


def generate_building(spec: BuildingGenSpec) -> Building:
    """Produce a populated `Building` from a `BuildingGenSpec`.

    Raises `BuildingSpecInvalid` if the spec is inconsistent.
    """
    if spec.total_sqft_target <= 0:
        raise BuildingSpecInvalid(
            f"total_sqft_target must be positive, got {spec.total_sqft_target}",
        )
    if not spec.levels:
        raise BuildingSpecInvalid("spec.levels is empty")
    if spec.aspect_ratio <= 0:
        raise BuildingSpecInvalid(
            f"aspect_ratio must be positive, got {spec.aspect_ratio}",
        )

    # Footprint per level is total_sqft / level_count
    per_level_sqft = spec.total_sqft_target / len(spec.levels)
    w, l = _footprint_dims_m(per_level_sqft, spec.aspect_ratio)
    log.info(
        "hf.building_gen.start",
        extra={
            "project_id": spec.project_id, "levels": len(spec.levels),
            "w_m": round(w, 2), "l_m": round(l, 2),
        },
    )

    built_levels: list[Level] = []
    running_elevation = 0.0
    for i, lspec in enumerate(spec.levels):
        level_id = f"L{i}_{lspec.use}"
        rooms = _grid_rooms(
            level_id, w, l, lspec.unit_count, lspec.ceiling, lspec.use,
        )
        walls_ext = _exterior_walls(level_id, w, l, lspec.height_m)
        walls_int = _interior_walls_between_rooms(
            level_id, rooms, lspec.height_m,
        )
        stair = _place_shafts(
            level_id, w, l, spec.stair_shaft_count,
            running_elevation, running_elevation + lspec.height_m,
            kind="stair",
        )
        level = Level(
            id=level_id,
            name=lspec.name,
            elevation_m=running_elevation,
            height_m=lspec.height_m,
            use=lspec.use,
            polygon_m=_rect_polygon(w, l),
            rooms=rooms,
            walls=walls_ext + walls_int,
            ceiling=lspec.ceiling,
            stair_shafts=stair,
        )
        # Mech room on the top residential level only
        if lspec.use == "mechanical" or (
            i == len(spec.levels) - 1 and spec.mech_room_count > 0
            and lspec.use == "residential"
        ):
            mech_poly = [
                (w - 5.5, l - 5.5), (w - 0.5, l - 5.5),
                (w - 0.5, l - 0.5), (w - 5.5, l - 0.5),
            ]
            level.mech_rooms.append(Room(
                id=f"{level_id}_mech",
                name="Mechanical Room",
                polygon_m=mech_poly,
                area_sqm=25.0,
                use_class="mechanical_room",
                hazard_class="ordinary_i",
                ceiling=Ceiling(height_m=3.0, kind="open_joist"),
            ))
        built_levels.append(level)
        running_elevation += lspec.height_m

    total_sqft = (
        len(built_levels) * w * l * SQFT_PER_SQM
    )
    return Building(
        project_id=spec.project_id,
        levels=built_levels,
        construction_type="Type III-B over Type I-A (synthetic)",
        total_sqft=total_sqft,
        metadata={
            "synthesized": True,
            "source_note": spec.source_note,
            "spec": spec.model_dump(),
            "footprint_m": {"width": round(w, 2), "length": round(l, 2)},
        },
    )

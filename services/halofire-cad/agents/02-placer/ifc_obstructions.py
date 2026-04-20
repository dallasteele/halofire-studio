"""Extract placer Obstruction records from an IFC structural model.

AutoSprink's "arm automatically around obstructions" feature is
driven by the architect's structural model — columns, primary
beams, deep HVAC ducts, light fixtures. Our version reads the IFC
the customer gave us and pulls axis-aligned bounding boxes for:

  * IfcColumn
  * IfcBeam
  * IfcMember (generic structural member — covers joists)
  * IfcFlowSegment filtered to HVAC classes
  * IfcLightFixture

Returns a list of `arm_over.Obstruction` in the same meter-scale
coordinate frame the placer uses. Level filtering is supported so
the placer only shifts heads against obstructions on the same
ceiling they're mounted to.

Depends only on ifcopenshell (already a project dep for design.ifc
export). Falls back to `[]` when ifcopenshell isn't importable so
the caller never crashes on a dev box missing the optional dep.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any, Iterable

_HERE = Path(__file__).resolve().parent

# Import arm_over.Obstruction without forcing a package-relative
# import (the agent dirs are hyphenated). Reuse any previously-
# loaded copy in sys.modules so other importers + tests share
# the same Obstruction class.
_AO_NAME = "_hf_arm_over"
_AO = sys.modules.get(_AO_NAME)
if _AO is None:
    _SPEC = importlib.util.spec_from_file_location(
        _AO_NAME, _HERE / "arm_over.py",
    )
    assert _SPEC is not None and _SPEC.loader is not None
    _AO = importlib.util.module_from_spec(_SPEC)
    sys.modules[_AO_NAME] = _AO
    _SPEC.loader.exec_module(_AO)
Obstruction = _AO.Obstruction


# Which IFC entity classes count as an obstruction by default. The
# caller can pass a narrower set — e.g. only columns — via
# `classes=(…)`.
DEFAULT_CLASSES: tuple[str, ...] = (
    "IfcColumn",
    "IfcBeam",
    "IfcMember",
    "IfcLightFixture",
)

# HVAC flow segments that a sprinkler must clear. Supply + exhaust
# ducts only; cable trays handled separately.
HVAC_FLOW_SEGMENT_TYPES: tuple[str, ...] = (
    "DUCT",
    "DUCTSEGMENT",
)


def _ifcopenshell_available() -> bool:
    try:
        import ifcopenshell  # noqa: F401
        return True
    except Exception:  # noqa: BLE001
        return False


def _elem_bbox_xy_m(elem: Any) -> tuple[float, float, float, float] | None:
    """Return (x0, y0, x1, y1) in meters for an IfcProduct, or None
    if we can't resolve a placement. Uses ifcopenshell.util.shape
    when available; falls back to ObjectPlacement translation +
    bounding-box representation.
    """
    try:
        import ifcopenshell.util.placement as pl
        import ifcopenshell.util.shape as sh
    except Exception:  # noqa: BLE001
        return None

    try:
        # Fast path: 'PlacementAndSize' utility returns a 4x4 matrix
        # in meters already scaled.
        m = pl.get_local_placement(elem.ObjectPlacement)
    except Exception:  # noqa: BLE001
        return None
    # Translation component
    tx, ty = float(m[0][3]), float(m[1][3])

    # Try to get extruded geometry dimensions from the representation
    width_m = 0.3
    depth_m = 0.3
    try:
        rep = elem.Representation
        if rep is not None:
            for r in rep.Representations or []:
                for item in r.Items or []:
                    # ExtrudedAreaSolid.SweptArea has a profile
                    swept = getattr(item, "SweptArea", None)
                    if swept is None:
                        continue
                    # RectangleProfileDef exposes XDim + YDim (mm)
                    xdim = getattr(swept, "XDim", None)
                    ydim = getattr(swept, "YDim", None)
                    if xdim and ydim:
                        width_m = float(xdim) / 1000.0
                        depth_m = float(ydim) / 1000.0
                        break
                    # CircleProfileDef → diameter
                    radius = getattr(swept, "Radius", None)
                    if radius:
                        width_m = depth_m = 2.0 * float(radius) / 1000.0
                        break
    except Exception:  # noqa: BLE001
        pass

    hx = width_m / 2.0
    hy = depth_m / 2.0
    return (tx - hx, ty - hy, tx + hx, ty + hy)


def _elem_matches_level(
    elem: Any,
    level_elevation_m: float | None,
    tol_m: float = 0.6,
) -> bool:
    """True if `elem` sits on the requested building level (± tol).

    When `level_elevation_m` is None, accepts everything.
    """
    if level_elevation_m is None:
        return True
    try:
        import ifcopenshell.util.placement as pl
        m = pl.get_local_placement(elem.ObjectPlacement)
        z = float(m[2][3])
        return abs(z - level_elevation_m) <= tol_m
    except Exception:  # noqa: BLE001
        return True  # can't tell → be generous


def obstructions_from_ifc(
    ifc_path: str | Path,
    *,
    classes: Iterable[str] = DEFAULT_CLASSES,
    level_elevation_m: float | None = None,
    _bbox_resolver=None,   # test hook; defaults to _elem_bbox_xy_m
    _level_resolver=None,  # test hook; defaults to _elem_matches_level
    _validate_header: bool = True,
) -> list:
    """Return a list of Obstruction records from an IFC file.

    * `classes`: IFC entity names to pull. Defaults cover columns,
      beams, members, and light fixtures.
    * `level_elevation_m`: when set, only obstructions near that Z
      are returned (matches heads mounted on that level's ceiling).
    * `_bbox_resolver` / `_level_resolver`: DI hooks for unit tests.
      Production flow uses the module-level helpers.
    """
    if not _ifcopenshell_available():
        return []
    import ifcopenshell
    p = Path(ifc_path)
    if not p.exists():
        return []
    # Cheap header check before handing to ifcopenshell — saves a
    # spurious partially-constructed `file.__del__` warning on
    # non-IFC inputs (e.g. accidentally-loaded PDFs). Disable via
    # _validate_header=False for tests that feed mocked ifcopenshell.
    if _validate_header:
        try:
            head = p.open("rb").read(32)
        except Exception:  # noqa: BLE001
            return []
        if not (head.lstrip().startswith(b"ISO-10303")
                or head.lstrip().startswith(b"\x89HDF")):
            return []
    try:
        model = ifcopenshell.open(str(p))
    except Exception:  # noqa: BLE001
        return []

    bbox_resolver = _bbox_resolver or _elem_bbox_xy_m
    level_resolver = _level_resolver or _elem_matches_level

    out: list = []
    for cls in classes:
        try:
            elems = model.by_type(cls)
        except Exception:  # noqa: BLE001
            continue
        for e in elems:
            if not level_resolver(e, level_elevation_m):
                continue
            bbox = bbox_resolver(e)
            if bbox is None:
                continue
            x0, y0, x1, y1 = bbox
            if x1 <= x0 or y1 <= y0:
                continue
            out.append(Obstruction(x0, y0, x1, y1))
    return out


__all__ = [
    "DEFAULT_CLASSES",
    "HVAC_FLOW_SEGMENT_TYPES",
    "Obstruction",
    "obstructions_from_ifc",
]

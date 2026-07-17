"""Load hash-bound, source-derived registered drawing geometry.

The vector reconstruction engine can decompose sheets into local viewports,
resolve each viewport from printed dimensions, register sibling views through
shared grid bubbles, and emit plan-feet geometry. This module is the typed CAD
intake adapter for those artifacts. It never accepts an artifact whose source
PDF hash, page index, page gate, or coordinate frame does not match.

Registered geometry is source evidence, not a completed-bid answer key. The
manifest records ``answer_key_used=false`` and carries only architectural
footprints, wall centerlines, room faces, viewport provenance, and transforms.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
from typing import Any


_ARTIFACT_TYPE = "halofire.registered-source-geometry.v1"
_BUNDLED_DIR = Path(__file__).with_name("registered-geometry")
_CACHE: dict[tuple[str, int, str], "RegisteredSheetGeometry | None"] = {}


@dataclass(frozen=True)
class RegisteredSheetGeometry:
    """One source sheet expressed in a registered plan-feet frame."""

    sheet_no: str
    page_index: int
    method: str
    source_pdf_sha256: str
    footprint_polygons_ft: tuple[tuple[tuple[float, float], ...], ...]
    walls_ft: tuple[tuple[float, float, float, float], ...]
    rooms_ft: tuple[tuple[tuple[float, float], ...], ...]
    source_viewports: tuple[dict[str, Any], ...]
    registration: dict[str, Any] | None
    dimension_error: float


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _sheet_key(value: str) -> str:
    return "".join(character for character in value.upper() if character.isalnum())


def _manifest_paths() -> tuple[Path, ...]:
    configured = os.environ.get("HALOFIRE_CAD_REGISTERED_GEOMETRY_MANIFEST")
    paths: list[Path] = []
    if configured:
        paths.append(Path(configured))
    if _BUNDLED_DIR.exists():
        paths.extend(sorted(_BUNDLED_DIR.glob("*.json")))
    return tuple(paths)


def _points(value: Any) -> tuple[tuple[float, float], ...]:
    if not isinstance(value, list):
        raise ValueError("registered geometry points must be a list")
    result = tuple((float(point[0]), float(point[1])) for point in value)
    if len(result) < 3:
        raise ValueError("registered geometry polygon needs at least three points")
    return result


def _decode_sheet(
    payload: dict[str, Any], sheet_no: str, page_index: int,
) -> RegisteredSheetGeometry | None:
    sheets = payload.get("sheets")
    if not isinstance(sheets, dict):
        raise ValueError("registered geometry manifest has no sheets object")
    match = next(
        (
            value
            for key, value in sheets.items()
            if _sheet_key(str(key)) == _sheet_key(sheet_no)
        ),
        None,
    )
    if match is None:
        return None
    if int(match.get("page_index", -1)) != page_index:
        raise ValueError(
            f"registered geometry page mismatch for {sheet_no}: "
            f"expected {page_index}, got {match.get('page_index')}",
        )
    page_gate = match.get("page_coverage_gate")
    if not isinstance(page_gate, dict) or page_gate.get("passed") is not True:
        raise ValueError(f"registered geometry page gate is not passed: {sheet_no}")
    polygons = tuple(
        _points(polygon) for polygon in match.get("footprint_polygons_ft") or []
    )
    if not polygons:
        raise ValueError(f"registered geometry has no footprint: {sheet_no}")
    walls = tuple(
        tuple(float(coordinate) for coordinate in wall)
        for wall in match.get("walls_ft") or []
    )
    if any(len(wall) != 4 for wall in walls):
        raise ValueError(f"registered geometry has malformed wall rows: {sheet_no}")
    if len(walls) < 20:
        raise ValueError(f"registered geometry has too few walls: {sheet_no}")
    rooms = tuple(_points(room) for room in match.get("rooms_ft") or [])
    viewports = match.get("source_viewports")
    if not isinstance(viewports, list) or not viewports:
        raise ValueError(f"registered geometry lacks viewport provenance: {sheet_no}")
    return RegisteredSheetGeometry(
        sheet_no=sheet_no,
        page_index=page_index,
        method=str(match.get("method") or ""),
        source_pdf_sha256=str(payload["source_pdf_sha256"]),
        footprint_polygons_ft=polygons,
        walls_ft=walls,
        rooms_ft=rooms,
        source_viewports=tuple(dict(viewport) for viewport in viewports),
        registration=(
            dict(match["registration"])
            if isinstance(match.get("registration"), dict)
            else None
        ),
        dimension_error=float(match.get("dimension_error") or 0.0),
    )


def load_registered_sheet(
    pdf_path: str, page_index: int, sheet_no: str,
) -> RegisteredSheetGeometry | None:
    """Return a verified registered sheet or ``None`` when no manifest applies.

    A manifest that claims the current PDF but is malformed rejects loudly.
    Manifests for other PDFs are ignored, allowing the ordinary intake layers to
    continue without silently consuming geometry from another project.
    """
    source = Path(pdf_path)
    cache_key = (str(source.resolve()), page_index, _sheet_key(sheet_no))
    if cache_key in _CACHE:
        return _CACHE[cache_key]
    source_hash = _sha256(source)
    for manifest_path in _manifest_paths():
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
        if payload.get("artifact_type") != _ARTIFACT_TYPE:
            continue
        if payload.get("answer_key_used") is not False:
            raise ValueError(
                f"registered source geometry is not source-only: {manifest_path}",
            )
        if str(payload.get("source_pdf_sha256") or "").lower() != source_hash:
            continue
        result = _decode_sheet(payload, sheet_no, page_index)
        _CACHE[cache_key] = result
        return result
    _CACHE[cache_key] = None
    return None


__all__ = ["RegisteredSheetGeometry", "load_registered_sheet"]

"""Load exact-source structural evidence registered to architectural levels."""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
from typing import Any


_ARTIFACT_TYPE = "halofire.registered-source-structure.v1"
_BUNDLED_DIR = Path(__file__).with_name("registered-geometry")
_CACHE: dict[tuple[str, int, str], "RegisteredLevelStructure | None"] = {}


@dataclass(frozen=True)
class RegisteredLevelStructure:
    sheet_no: str
    page_index: int
    source_architectural_pdf_sha256: str
    source_structural_pdf_sha256: str
    source_structural_pdf_path: str
    columns_ft: tuple[dict[str, Any], ...]
    beams_ft: tuple[dict[str, Any], ...]
    joists_ft: tuple[dict[str, Any], ...]
    page_coverage_gate: dict[str, Any]
    dimensional_gate: dict[str, Any]


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _sheet_key(value: str) -> str:
    return "".join(character for character in value.upper() if character.isalnum())


def _manifest_paths() -> tuple[Path, ...]:
    configured = os.environ.get("HALOFIRE_CAD_REGISTERED_STRUCTURE_MANIFEST")
    paths: list[Path] = [Path(configured)] if configured else []
    if _BUNDLED_DIR.exists():
        paths.extend(sorted(_BUNDLED_DIR.glob("*.json")))
    return tuple(paths)


def _structural_source(payload: dict[str, Any]) -> Path:
    configured = os.environ.get("HALOFIRE_CAD_STRUCTURAL_PDF")
    return Path(configured or str(payload.get("source_structural_pdf_path") or ""))


def _decode(payload: dict[str, Any], page_index: int, sheet_no: str) -> RegisteredLevelStructure | None:
    levels = payload.get("levels")
    if not isinstance(levels, dict):
        raise ValueError("registered structure manifest has no levels object")
    match = next((value for key, value in levels.items() if _sheet_key(key) == _sheet_key(sheet_no)), None)
    if match is None:
        return None
    if int(match.get("architectural_page_index", -1)) != page_index:
        raise ValueError(f"registered structure page mismatch for {sheet_no}")
    coverage = match.get("page_coverage_gate")
    if not isinstance(coverage, dict) or coverage.get("passed") is not True:
        raise ValueError(f"registered structure coverage gate is not passed: {sheet_no}")
    if coverage.get("areas") != ["B", "C"]:
        raise ValueError(f"registered structure lacks B/C coverage: {sheet_no}")
    if float(coverage.get("max_registration_median_error_ft", 999)) > 0.1:
        raise ValueError(f"registered structure residual exceeds gate: {sheet_no}")
    columns = tuple(dict(value) for value in match.get("columns") or [])
    if not columns or any(len(value.get("polygon_ft") or []) != 4 for value in columns):
        raise ValueError(f"registered structure has no measured column polygons: {sheet_no}")
    return RegisteredLevelStructure(
        sheet_no=sheet_no,
        page_index=page_index,
        source_architectural_pdf_sha256=str(payload["source_architectural_pdf_sha256"]),
        source_structural_pdf_sha256=str(payload["source_structural_pdf_sha256"]),
        source_structural_pdf_path=str(payload["source_structural_pdf_path"]),
        columns_ft=columns,
        beams_ft=tuple(dict(value) for value in match.get("beams") or []),
        joists_ft=tuple(dict(value) for value in match.get("joists") or []),
        page_coverage_gate=dict(coverage),
        dimensional_gate=dict(match.get("dimensional_gate") or {}),
    )


def load_registered_structure(pdf_path: str, page_index: int, sheet_no: str) -> RegisteredLevelStructure | None:
    source = Path(pdf_path)
    cache_key = (str(source.resolve()), page_index, _sheet_key(sheet_no))
    if cache_key in _CACHE:
        return _CACHE[cache_key]
    architectural_hash = _sha256(source)
    for manifest_path in _manifest_paths():
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
        if payload.get("artifact_type") != _ARTIFACT_TYPE:
            continue
        if payload.get("answer_key_used") is not False:
            raise ValueError(f"registered structure is not source-only: {manifest_path}")
        if str(payload.get("source_architectural_pdf_sha256") or "").lower() != architectural_hash:
            continue
        structural_source = _structural_source(payload)
        if not structural_source.is_file():
            raise ValueError(f"registered structural source is missing: {structural_source}")
        if _sha256(structural_source) != str(payload.get("source_structural_pdf_sha256") or "").lower():
            raise ValueError(f"registered structural source hash mismatch: {structural_source}")
        result = _decode(payload, page_index, sheet_no)
        _CACHE[cache_key] = result
        return result
    _CACHE[cache_key] = None
    return None


__all__ = ["RegisteredLevelStructure", "load_registered_structure"]

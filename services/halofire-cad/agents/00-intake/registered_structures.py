"""Load exact-source structural evidence registered to architectural levels."""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
from typing import Any


_ARTIFACT_TYPE = "halofire.registered-source-structure.v1"
_BUNDLED_DIR = Path(__file__).with_name("registered-geometry")
_CACHE: dict[tuple[str, int, str], "RegisteredLevelStructure | None"] = {}

_AISC_V16_URL = (
    "https://www.aisc.org/aisc/publications/steel-construction-manual/"
    "aisc-shapes-database-v160/"
)
_AISC_V16_XLSX_SHA256 = "82d0ceb96a0d938ae1a6bd9637cb10a1e269225b5d668dce5b0bdc8d86013496"
_AISC_W_SECTIONS_IN = {
    # AISC Shapes Database v16.0 columns d, bf, tw, tf.
    "W10X30": {"depth": 10.5, "width": 5.81, "web": 0.3, "flange": 0.51},
    "W12X45": {"depth": 12.1, "width": 8.05, "web": 0.335, "flange": 0.575},
    "W18X50": {"depth": 18.0, "width": 7.5, "web": 0.355, "flange": 0.57},
}
_NIST_PS20_URL = (
    "https://www.nist.gov/document/"
    "doc-ps-20-20-american-softwood-lumber-standard-revision-1-oct-2021"
)


def _fractional_in(value: str) -> float:
    numerator, denominator = value.split("/", 1)
    return float(numerator) / float(denominator)


def _mixed_in(value: str) -> float:
    whole, fraction = value.split("-", 1)
    return float(whole) + _fractional_in(fraction)


def _wood_minimum_dressed_in(nominal: float, *, dimension_lumber: bool) -> tuple[float, float]:
    """Return (dry, green) PS 20-20 minimum-dressed dimensions in inches."""
    if dimension_lumber:
        if nominal == 2:
            return 1.5, 1.5625
        width = {
            10: (9.25, 9.5),
            12: (11.25, 11.5),
        }.get(int(nominal))
        if width is not None:
            return width
    else:
        if nominal in (5, 6):
            return nominal - 0.5, nominal - 0.5
        if 7 <= nominal <= 15:
            return nominal - 0.75, nominal - 0.5
        if nominal >= 16:
            return nominal - 1.0, nominal - 0.5
    raise ValueError(f"unsupported PS 20-20 nominal dimension: {nominal}")


def resolve_member_section(
    member: str | None, material_conditions: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Resolve only source-tagged sections supported by authoritative dimensions.

    Wood tags remain standards-bounded because a nominal tag does not state
    moisture/surfacing condition. Bare LVL tags remain unresolved because they
    omit ply count, thickness, and depth.
    """
    tag = "".join(str(member or "").upper().split())
    if not tag or tag == "LVL":
        return None

    hss = re.fullmatch(r"HSS(\d+(?:\.\d+)?)X(\d+(?:\.\d+)?)X(\d+/\d+)", tag)
    if hss:
        return {
            "status": "standards-resolved-section",
            "profile": "rectangular-hss",
            "source_tag": tag,
            "outer_depth_in": float(hss.group(1)),
            "outer_width_in": float(hss.group(2)),
            "nominal_wall_thickness_in": _fractional_in(hss.group(3)),
            "standard": "AISC-EDI-shape-nomenclature",
            "source_url": _AISC_V16_URL,
        }

    angle = re.fullmatch(r"L(\d+(?:\.\d+)?)X(\d+(?:\.\d+)?)X(\d+/\d+)", tag)
    if angle:
        return {
            "status": "standards-resolved-section",
            "profile": "equal-leg-angle",
            "source_tag": tag,
            "leg_1_in": float(angle.group(1)),
            "leg_2_in": float(angle.group(2)),
            "thickness_in": _fractional_in(angle.group(3)),
            "standard": "AISC-EDI-shape-nomenclature",
            "source_url": _AISC_V16_URL,
        }

    lvl = re.fullmatch(r"\((\d+)\)(\d+-\d+/\d+)X(\d+-\d+/\d+)LVL", tag)
    if lvl:
        ply_count = int(lvl.group(1))
        ply_thickness = _mixed_in(lvl.group(2))
        return {
            "status": "source-resolved-section",
            "profile": "built-up-lvl-rectangular",
            "source_tag": tag,
            "ply_count": ply_count,
            "ply_thickness_in": ply_thickness,
            "overall_width_in": ply_count * ply_thickness,
            "depth_in": _mixed_in(lvl.group(3)),
            "source": "dimension-printed-in-hash-bound-structural-plan",
        }

    if tag in _AISC_W_SECTIONS_IN:
        dimensions = _AISC_W_SECTIONS_IN[tag]
        return {
            "status": "standards-resolved-section",
            "profile": "wide-flange",
            "source_tag": tag,
            "depth_in": dimensions["depth"],
            "flange_width_in": dimensions["width"],
            "web_thickness_in": dimensions["web"],
            "flange_thickness_in": dimensions["flange"],
            "standard": "AISC-Shapes-Database-v16.0",
            "source_url": _AISC_V16_URL,
            "source_xlsx_sha256": _AISC_V16_XLSX_SHA256,
        }

    wood = re.fullmatch(r"(2|6)X(10|12|14|16)", tag)
    if wood:
        nominal_width = float(wood.group(1))
        nominal_depth = float(wood.group(2))
        dimension_lumber = nominal_width == 2
        dry_width, green_width = _wood_minimum_dressed_in(
            nominal_width, dimension_lumber=dimension_lumber,
        )
        dry_depth, green_depth = _wood_minimum_dressed_in(
            nominal_depth, dimension_lumber=dimension_lumber,
        )
        dry_source_bound = (
            (material_conditions or {}).get("wood_service_condition") == "dry"
            and float((material_conditions or {}).get("maximum_sawn_lumber_moisture_percent", 999)) <= 19
        )
        section = {
            "status": (
                "source-bounded-dry-minimum-dressed-section"
                if dry_source_bound else "standard-size-bounds-source-condition-required"
            ),
            "profile": "sawn-wood-rectangular",
            "source_tag": tag,
            "nominal_width_in": nominal_width,
            "nominal_depth_in": nominal_depth,
            "minimum_dressed_dry_in": [dry_width, dry_depth],
            "minimum_dressed_green_in": [green_width, green_depth],
            "standard": "DOC-PS-20-20-revision-1-table-3",
            "source_url": _NIST_PS20_URL,
            "reason": (
                "Hash-bound structural notes specify dry service; dimensions remain PS 20-20 minimum dressed, not field measurements."
                if dry_source_bound
                else "Source tag does not state dry/green or surfaced/rough condition."
            ),
        }
        if dry_source_bound:
            section["modeled_minimum_dressed_in"] = [dry_width, dry_depth]
            section["condition_source"] = dict((material_conditions or {}).get("source") or {})
        return section
    return None


def _enrich_members(
    values: list[dict[str, Any]], material_conditions: dict[str, Any],
) -> tuple[dict[str, Any], ...]:
    enriched: list[dict[str, Any]] = []
    for source_value in values:
        value = dict(source_value)
        section = resolve_member_section(value.get("member"), material_conditions)
        if section is not None:
            value["section"] = section
            value["dimensional_status"] = section["status"]
        enriched.append(value)
    return tuple(enriched)


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
    material_conditions: dict[str, Any]
    framing_condition_gate: dict[str, Any]


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
    material_conditions = dict(payload.get("material_conditions") or {})
    condition_source = dict(material_conditions.get("source") or {})
    if material_conditions:
        if condition_source.get("pdf_sha256") != payload.get("source_structural_pdf_sha256"):
            raise ValueError("registered structure material condition source hash mismatch")
        if condition_source.get("page_index") != 2:
            raise ValueError("registered structure material condition source page mismatch")
    columns = _enrich_members(match.get("columns") or [], material_conditions)
    if not columns or any(len(value.get("polygon_ft") or []) != 4 for value in columns):
        raise ValueError(f"registered structure has no measured column polygons: {sheet_no}")
    framing_condition_gate = dict(match.get("framing_condition_gate") or {})
    if framing_condition_gate:
        if framing_condition_gate.get("source_pdf_sha256") != payload.get("source_structural_pdf_sha256"):
            raise ValueError("registered structure framing condition source hash mismatch")
        if framing_condition_gate.get("condition") != "flush-framed-unless-noted":
            raise ValueError("registered structure framing condition is unresolved")
        if framing_condition_gate.get("governing_text") != (
            "BEAMS SHOWN ON THIS SHEET OCCUR WITHIN THE ROOF FRAMING SHOWN "
            "(FLUSH-FRAMED), UNO."
        ):
            raise ValueError("registered structure framing condition text mismatch")
        if framing_condition_gate.get("passed") is not True:
            raise ValueError("registered structure framing condition gate is not passed")
        if framing_condition_gate.get("plan_specific_drop_markers"):
            raise ValueError("registered structure has unassociated plan-specific DROP markers")
        source_pages = framing_condition_gate.get("source_pages") or []
        expected_pages = {
            (value.get("page_index"), value.get("sheet"), value.get("pdf_sha256"))
            for value in (match.get("overhead_sources") or [])
        }
        actual_pages = {
            (value.get("page_index"), value.get("sheet"), value.get("pdf_sha256"))
            for value in source_pages
        }
        if len(source_pages) != 2 or any(
            value.get("pdf_sha256") != payload.get("source_structural_pdf_sha256")
            for value in source_pages
        ) or actual_pages != expected_pages:
            raise ValueError("registered structure framing condition pages are not hash bound")
    return RegisteredLevelStructure(
        sheet_no=sheet_no,
        page_index=page_index,
        source_architectural_pdf_sha256=str(payload["source_architectural_pdf_sha256"]),
        source_structural_pdf_sha256=str(payload["source_structural_pdf_sha256"]),
        source_structural_pdf_path=str(payload["source_structural_pdf_path"]),
        columns_ft=columns,
        beams_ft=_enrich_members(match.get("beams") or [], material_conditions),
        joists_ft=_enrich_members(match.get("joists") or [], material_conditions),
        page_coverage_gate=dict(coverage),
        dimensional_gate=dict(match.get("dimensional_gate") or {}),
        material_conditions=material_conditions,
        framing_condition_gate=framing_condition_gate,
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


__all__ = ["RegisteredLevelStructure", "load_registered_structure", "resolve_member_section"]

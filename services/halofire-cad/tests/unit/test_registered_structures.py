"""Fail-closed tests for hash-bound registered structural evidence."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sys

import pytest


ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "agents" / "00-intake" / "registered_structures.py"
PDF_1881 = Path(
    "E:/ClaudeBot/data/halofire/golden/1881/input/"
    "GC - Bid Plans/1881 - Architecturals.pdf"
)


def _load_module():
    module_name = "hf_registered_structures_test"
    spec = importlib.util.spec_from_file_location(module_name, MODULE_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def test_1881_a101_loads_hash_bound_bc_structure() -> None:
    module = _load_module()
    result = module.load_registered_structure(str(PDF_1881), 7, "A-101")
    assert result is not None
    assert result.page_coverage_gate["areas"] == ["B", "C"]
    assert result.page_coverage_gate["max_registration_median_error_ft"] <= 0.1
    assert len(result.columns_ft) >= 20
    assert all(len(value["polygon_ft"]) == 4 for value in result.columns_ft)
    assert result.dimensional_gate["passed"] is False
    assert result.material_conditions["wood_service_condition"] == "dry"
    tagged = [*result.columns_ft, *result.beams_ft, *result.joists_ft]
    resolved = [
        value for value in tagged
        if (value.get("section") or {}).get("status")
        in {"standards-resolved-section", "source-resolved-section"}
    ]
    assert resolved


def test_1881_a108_separates_legend_drop_from_plan_conditions() -> None:
    module = _load_module()
    result = module.load_registered_structure(str(PDF_1881), 28, "A-108")
    assert result is not None
    gate = result.framing_condition_gate
    assert gate["passed"] is True
    assert gate["condition"] == "flush-framed-unless-noted"
    assert gate["plan_specific_drop_markers"] == []
    assert len(gate["legend_drop_markers"]) == 2


def test_plan_specific_drop_marker_rejects(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    module = _load_module()
    source = ROOT / "agents" / "00-intake" / "registered-geometry" / "1881-structurals.json"
    payload = json.loads(source.read_text(encoding="utf-8"))
    payload["levels"]["A-108"]["framing_condition_gate"]["plan_specific_drop_markers"] = [
        {"id": "adversarial-drop", "inPrimaryPlanBody": True},
    ]
    rejected = tmp_path / "drop.json"
    rejected.write_text(json.dumps(payload), encoding="utf-8")
    monkeypatch.setenv("HALOFIRE_CAD_REGISTERED_STRUCTURE_MANIFEST", str(rejected))
    module._CACHE.clear()
    with pytest.raises(ValueError, match="DROP markers"):
        module.load_registered_structure(str(PDF_1881), 28, "A-108")


def test_framing_condition_page_drift_rejects(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    module = _load_module()
    source = ROOT / "agents" / "00-intake" / "registered-geometry" / "1881-structurals.json"
    payload = json.loads(source.read_text(encoding="utf-8"))
    payload["levels"]["A-108"]["framing_condition_gate"]["source_pages"][0]["page_index"] = 61
    rejected = tmp_path / "wrong-condition-page.json"
    rejected.write_text(json.dumps(payload), encoding="utf-8")
    monkeypatch.setenv("HALOFIRE_CAD_REGISTERED_STRUCTURE_MANIFEST", str(rejected))
    module._CACHE.clear()
    with pytest.raises(ValueError, match="pages are not hash bound"):
        module.load_registered_structure(str(PDF_1881), 28, "A-108")


@pytest.mark.parametrize(
    ("tag", "expected"),
    [
        ("HSS8X4X5/16", {"outer_depth_in": 8.0, "outer_width_in": 4.0, "nominal_wall_thickness_in": 0.3125}),
        ("L4X4X1/4", {"leg_1_in": 4.0, "leg_2_in": 4.0, "thickness_in": 0.25}),
        ("W10X30", {"depth_in": 10.5, "flange_width_in": 5.81, "web_thickness_in": 0.3}),
        ("W12X45", {"depth_in": 12.1, "flange_width_in": 8.05, "flange_thickness_in": 0.575}),
        ("W18X50", {"depth_in": 18.0, "flange_width_in": 7.5, "web_thickness_in": 0.355}),
        ("(3)1-3/4X11-7/8LVL", {"overall_width_in": 5.25, "depth_in": 11.875}),
    ],
)
def test_steel_member_sections_use_authoritative_dimensions(tag: str, expected: dict[str, float]) -> None:
    module = _load_module()
    section = module.resolve_member_section(tag)
    assert section is not None
    assert section["status"] in {"standards-resolved-section", "source-resolved-section"}
    for key, value in expected.items():
        assert section[key] == value


@pytest.mark.parametrize(
    ("tag", "dry", "green"),
    [
        ("2X10", [1.5, 9.25], [1.5625, 9.5]),
        ("2X12", [1.5, 11.25], [1.5625, 11.5]),
        ("6X12", [5.5, 11.25], [5.5, 11.5]),
        ("6X14", [5.5, 13.25], [5.5, 13.5]),
        ("6X16", [5.5, 15.0], [5.5, 15.5]),
    ],
)
def test_wood_member_tags_remain_condition_bounded(
    tag: str, dry: list[float], green: list[float],
) -> None:
    module = _load_module()
    section = module.resolve_member_section(tag)
    assert section is not None
    assert section["status"] == "standard-size-bounds-source-condition-required"
    assert section["minimum_dressed_dry_in"] == dry
    assert section["minimum_dressed_green_in"] == green


def test_hash_bound_dry_service_note_selects_dry_minimum_dressed_dimensions() -> None:
    module = _load_module()
    conditions = {
        "wood_service_condition": "dry",
        "maximum_sawn_lumber_moisture_percent": 19,
        "source": {"pdf_sha256": "source-hash", "page_index": 2},
    }
    section = module.resolve_member_section("6X12", conditions)
    assert section is not None
    assert section["status"] == "source-bounded-dry-minimum-dressed-section"
    assert section["modeled_minimum_dressed_in"] == [5.5, 11.25]


@pytest.mark.parametrize("tag", [None, "", "LVL", "UNKNOWN"])
def test_incomplete_member_tags_remain_unresolved(tag: str | None) -> None:
    module = _load_module()
    assert module.resolve_member_section(tag) is None


def test_other_architectural_hash_cannot_consume_1881_structure(tmp_path: Path) -> None:
    module = _load_module()
    other = tmp_path / "other.pdf"
    other.write_bytes(b"not the registered architectural source")
    assert module.load_registered_structure(str(other), 7, "A-101") is None


def test_structural_pdf_hash_mismatch_rejects(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    module = _load_module()
    tampered = tmp_path / "structural.pdf"
    tampered.write_bytes(b"tampered structural source")
    monkeypatch.setenv("HALOFIRE_CAD_STRUCTURAL_PDF", str(tampered))
    module._CACHE.clear()
    with pytest.raises(ValueError, match="structural source hash mismatch"):
        module.load_registered_structure(str(PDF_1881), 7, "A-101")


def test_incomplete_bc_coverage_rejects(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    module = _load_module()
    source = ROOT / "agents" / "00-intake" / "registered-geometry" / "1881-structurals.json"
    payload = json.loads(source.read_text(encoding="utf-8"))
    payload["levels"]["A-101"]["page_coverage_gate"]["areas"] = ["B"]
    rejected = tmp_path / "incomplete.json"
    rejected.write_text(json.dumps(payload), encoding="utf-8")
    monkeypatch.setenv("HALOFIRE_CAD_REGISTERED_STRUCTURE_MANIFEST", str(rejected))
    module._CACHE.clear()
    with pytest.raises(ValueError, match="lacks B/C coverage"):
        module.load_registered_structure(str(PDF_1881), 7, "A-101")


def test_material_condition_with_wrong_source_hash_rejects(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    module = _load_module()
    source = ROOT / "agents" / "00-intake" / "registered-geometry" / "1881-structurals.json"
    payload = json.loads(source.read_text(encoding="utf-8"))
    payload["material_conditions"]["source"]["pdf_sha256"] = "0" * 64
    rejected = tmp_path / "wrong-condition-source.json"
    rejected.write_text(json.dumps(payload), encoding="utf-8")
    monkeypatch.setenv("HALOFIRE_CAD_REGISTERED_STRUCTURE_MANIFEST", str(rejected))
    module._CACHE.clear()
    with pytest.raises(ValueError, match="material condition source hash mismatch"):
        module.load_registered_structure(str(PDF_1881), 7, "A-101")


def test_material_condition_with_wrong_source_page_rejects(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    module = _load_module()
    source = ROOT / "agents" / "00-intake" / "registered-geometry" / "1881-structurals.json"
    payload = json.loads(source.read_text(encoding="utf-8"))
    payload["material_conditions"]["source"]["page_index"] = 3
    rejected = tmp_path / "wrong-condition-page.json"
    rejected.write_text(json.dumps(payload), encoding="utf-8")
    monkeypatch.setenv("HALOFIRE_CAD_REGISTERED_STRUCTURE_MANIFEST", str(rejected))
    module._CACHE.clear()
    with pytest.raises(ValueError, match="material condition source page mismatch"):
        module.load_registered_structure(str(PDF_1881), 7, "A-101")

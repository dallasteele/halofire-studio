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

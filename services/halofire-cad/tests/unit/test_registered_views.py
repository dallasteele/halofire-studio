"""Fail-closed tests for hash-bound registered source geometry."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sys

import pytest


ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "agents" / "00-intake" / "registered_views.py"
PDF_1881 = Path(
    "E:/ClaudeBot/data/halofire/golden/1881/input/"
    "GC - Bid Plans/1881 - Architecturals.pdf"
)


def _load_module():
    module_name = "hf_registered_views_test"
    spec = importlib.util.spec_from_file_location(
        module_name, MODULE_PATH,
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def test_1881_a101_loads_two_hash_bound_registered_viewports() -> None:
    module = _load_module()
    result = module.load_registered_sheet(str(PDF_1881), 7, "A-101")
    assert result is not None
    assert result.method == "registered-sibling-polygon-union"
    assert len(result.source_viewports) == 2
    assert len(result.walls_ft) >= 400
    assert result.registration is not None
    assert result.registration["shared_axes"] == ["x", "y"]
    assert result.registration["max_residual_ft"] <= 0.001
    polygon = result.footprint_polygons_ft[0]
    width = max(x for x, _y in polygon) - min(x for x, _y in polygon)
    height = max(y for _x, y in polygon) - min(y for _x, y in polygon)
    assert width == pytest.approx(340.1, abs=0.1)
    assert height == pytest.approx(60.0, abs=0.1)


def test_other_pdf_hash_cannot_consume_1881_geometry(tmp_path: Path) -> None:
    module = _load_module()
    other_pdf = tmp_path / "other.pdf"
    other_pdf.write_bytes(b"not the hash-bound architectural source")
    assert module.load_registered_sheet(str(other_pdf), 7, "A-101") is None


def test_answer_key_manifest_is_rejected(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    module = _load_module()
    source_manifest = (
        ROOT / "agents" / "00-intake" / "registered-geometry" /
        "1881-architecturals.json"
    )
    payload = json.loads(source_manifest.read_text(encoding="utf-8"))
    payload["answer_key_used"] = True
    rejected = tmp_path / "answer-key.json"
    rejected.write_text(json.dumps(payload), encoding="utf-8")
    monkeypatch.setenv(
        "HALOFIRE_CAD_REGISTERED_GEOMETRY_MANIFEST", str(rejected),
    )
    module._CACHE.clear()
    with pytest.raises(ValueError, match="not source-only"):
        module.load_registered_sheet(str(PDF_1881), 7, "A-101")


def test_unpassed_page_gate_is_rejected(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    module = _load_module()
    source_manifest = (
        ROOT / "agents" / "00-intake" / "registered-geometry" /
        "1881-architecturals.json"
    )
    payload = json.loads(source_manifest.read_text(encoding="utf-8"))
    payload["sheets"]["A-101"]["page_coverage_gate"]["passed"] = False
    rejected = tmp_path / "unpassed-gate.json"
    rejected.write_text(json.dumps(payload), encoding="utf-8")
    monkeypatch.setenv(
        "HALOFIRE_CAD_REGISTERED_GEOMETRY_MANIFEST", str(rejected),
    )
    module._CACHE.clear()
    with pytest.raises(ValueError, match="page gate is not passed"):
        module.load_registered_sheet(str(PDF_1881), 7, "A-101")

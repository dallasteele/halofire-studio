"""Adversarial checks for the approved FP-2 head-registered centerline extractor."""
from __future__ import annotations

import copy
import importlib.util
import json
from pathlib import Path

import fitz
import pytest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = ROOT / "scripts" / "build-mit-riverside-building-j-head-registered-pipe-centerlines.py"
HEAD_EVIDENCE = ROOT / "src" / "data" / "mit-riverside-building-j-head-coordinate-evidence.json"
CORPUS_ROOT = Path(r"Y:\Shared\HaloOps\02-Active jobs\03-Closed\Adolfson & Peterson\MIT Riverside - Phoenix AZ")


def load_module():
    spec = importlib.util.spec_from_file_location("mit_j_head_registered_pipe_centerlines", SCRIPT_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("unable to load Building J centerline extractor")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FakePage:
    def __init__(self, drawings):
        self.drawings = drawings

    def get_drawings(self):
        return self.drawings


class FakeDocument:
    def __init__(self, drawings):
        self.page = FakePage(drawings)

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def __getitem__(self, index):
        assert index == 1
        return self.page


def line_drawing(color, width):
    return {
        "color": color,
        "width": width,
        "items": [("l", fitz.Point(200.0, 200.0), fitz.Point(300.0, 200.0))],
    }


def test_rejects_color_only_and_wrong_stroke_width_candidates(monkeypatch):
    module = load_module()
    drawings = [
        line_drawing((0.0, 0.6392157077789307, 0.6392157077789307), module.PIPE_STROKE_WIDTH_PT),
        line_drawing(module.PIPE_STROKE_RGB, 0.06),
        line_drawing(module.PIPE_STROKE_RGB, module.PIPE_STROKE_WIDTH_PT),
    ]
    monkeypatch.setattr(module.fitz, "open", lambda _path: FakeDocument(drawings))
    candidates = module.extract_candidates(Path("fake-approved.pdf"), [{"id": "head-1", "pagePointPt": {"x": 250.0, "y": 200.0}}])
    assert len(candidates) == 1
    assert candidates[0]["sourceDrawingIndex"] == 2
    assert candidates[0]["headIdsWithinContactTolerance"] == ["head-1"]


def test_rejects_tampered_head_coordinate_and_source_digest(tmp_path, monkeypatch):
    module = load_module()
    evidence = json.loads(HEAD_EVIDENCE.read_text(encoding="utf-8"))
    tampered = copy.deepcopy(evidence)
    tampered["heads"][0]["pagePointPt"] = {"x": 0.0, "y": 0.0}
    tampered_path = tmp_path / "tampered-head-evidence.json"
    tampered_path.write_text(json.dumps(tampered), encoding="utf-8")
    with pytest.raises(RuntimeError, match="does not cover all heads"):
        module.build_artifacts(CORPUS_ROOT, tampered_path, tmp_path / "artifact.json", tmp_path / "proof")
    monkeypatch.setattr(module, "APPROVED_SHA256", "0" * 64)
    with pytest.raises(RuntimeError, match="source digest drift"):
        module.build_artifacts(CORPUS_ROOT, HEAD_EVIDENCE, tmp_path / "artifact.json", tmp_path / "proof")

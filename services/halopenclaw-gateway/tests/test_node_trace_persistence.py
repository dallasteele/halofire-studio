"""Phase A.1 — Per-node hydraulic fields persisted on design.json.

After POST /calculate:
  - every head has ``node_trace`` with pressure / flow / velocity / size
  - values are consistent with the /calculate response.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
CAD_ROOT = ROOT.parent / "halofire-cad"
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(CAD_ROOT))

import main  # noqa: E402
from cad.schema import (  # noqa: E402
    Building, Ceiling, Design, Head, Level, PipeSegment, Project, RiserSpec,
    Room, System,
)


def _seed_design(data_root: Path, project_id: str = "trace") -> Path:
    """Small design with two heads + two pipes wired to a riser."""
    out = data_root / project_id / "deliverables"
    out.mkdir(parents=True, exist_ok=True)
    heads = [
        Head(id="head_a", sku="TY3231", k_factor=5.6,
             position_m=(5.0, 5.0, 2.8), orientation="pendent"),
        Head(id="head_b", sku="TY3231", k_factor=5.6,
             position_m=(10.0, 10.0, 2.8), orientation="pendent"),
    ]
    pipes = [
        PipeSegment(
            id="pipe_ra", from_node="head_a", to_node="riser_r1",
            size_in=1.0, schedule="sch10",
            start_m=(5.0, 5.0, 2.8), end_m=(0.0, 0.0, 0.0),
            length_m=7.07, elevation_change_m=-2.8,
            downstream_heads=1, role="branch",
        ),
        PipeSegment(
            id="pipe_rb", from_node="head_b", to_node="riser_r1",
            size_in=1.0, schedule="sch10",
            start_m=(10.0, 10.0, 2.8), end_m=(0.0, 0.0, 0.0),
            length_m=14.14, elevation_change_m=-2.8,
            downstream_heads=1, role="branch",
        ),
    ]
    system = System(
        id="sys_s1", type="wet", supplies=["L1"],
        riser=RiserSpec(id="riser_r1", position_m=(0.0, 0.0, 0.0), size_in=4.0),
        heads=heads, pipes=pipes, fittings=[], hangers=[],
    )
    bldg = Building(
        project_id=project_id,
        levels=[Level(
            id="L1", name="Level 1", elevation_m=0.0, height_m=3.0,
            use="office",
            rooms=[Room(
                id="R1", name="Office 101",
                polygon_m=[(0, 0), (12, 0), (12, 12), (0, 12)],
                area_sqm=144.0, use_class="office",
                hazard_class="light", ceiling=Ceiling(),
            )],
        )],
    )
    design = Design(
        project=Project(
            id=project_id, name="Trace", address="",
            ahj="Local AHJ", code="NFPA 13 2022",
        ),
        building=bldg, systems=[system],
    )
    (out / "design.json").write_text(
        json.dumps(design.model_dump(), indent=2, default=str),
        encoding="utf-8",
    )
    (out / "manifest.json").write_text(
        json.dumps({"files": {}, "warnings": []}), encoding="utf-8",
    )
    return out


@pytest.fixture
def client(tmp_path: Path, monkeypatch) -> TestClient:
    monkeypatch.setattr(main, "_DATA_ROOT", tmp_path)
    monkeypatch.setattr(main, "_API_KEY", None)
    _seed_design(tmp_path)
    return TestClient(main.app)


def test_calculate_persists_node_trace_on_every_head(client: TestClient) -> None:
    r = client.post("/projects/trace/calculate", json={})
    assert r.status_code == 200, r.text
    calc = r.json()["calculation"]

    # GET /scene (design.json) should now carry node_trace per head.
    scene = client.get("/projects/trace/design.json").json()
    system = scene["systems"][0]
    heads = system["heads"]
    assert len(heads) == 2
    for h in heads:
        assert "node_trace" in h, f"head {h['id']} missing node_trace"
        nt = h["node_trace"]
        # Required fields
        for key in ("pressure_psi", "flow_gpm", "velocity_fps"):
            assert key in nt, f"head {h['id']} node_trace missing {key}"
            assert isinstance(nt[key], (int, float))

    # Pipes carry node_trace too; their flow_gpm should match the
    # segment_trace entry in calc response.
    per_seg = {
        seg["segment_id"]: seg
        for s in calc["systems"]
        for seg in s["hydraulic"]["node_trace"]
    }
    for p in system["pipes"]:
        nt = p["node_trace"]
        seg = per_seg.get(p["id"])
        assert seg is not None, f"pipe {p['id']} has no corresponding segment_trace"
        assert nt["flow_gpm"] == pytest.approx(seg["flow_gpm"], abs=0.1)
        # Velocity is Hazen-Williams consistent: v = 0.4085 · Q / D²
        expected_v = 0.4085 * seg["flow_gpm"] / (p["size_in"] ** 2)
        assert nt["velocity_fps"] == pytest.approx(expected_v, abs=0.05)


def test_node_trace_survives_second_calculate(client: TestClient) -> None:
    """Running /calculate twice must overwrite (not duplicate) node_trace."""
    client.post("/projects/trace/calculate", json={})
    r2 = client.post("/projects/trace/calculate", json={})
    assert r2.status_code == 200
    scene = client.get("/projects/trace/design.json").json()
    for h in scene["systems"][0]["heads"]:
        # node_trace is a single dict, not a growing list.
        assert isinstance(h["node_trace"], dict)

"""Phase A.1 — POST /projects/:id/auto-peak.

Seeds a scene with two candidate areas of different hydraulic
demand and asserts the endpoint picks the worse one (lowest
residual pressure).
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


def _make_design_with_heads(data_root: Path, project_id: str = "peak") -> Path:
    """Design with heads split into two clusters at very different
    distances from the riser.

    Cluster A (near riser): heads at (1, 1), (1, 2), (2, 1), (2, 2).
    Cluster B (far from riser): heads at (18, 18), (18, 19), (19, 18), (19, 19).

    The riser sits at the origin. Cluster B must produce the lower
    residual pressure (more friction loss upstream).
    """
    out = data_root / project_id / "deliverables"
    out.mkdir(parents=True, exist_ok=True)

    heads: list[Head] = []
    pipes: list[PipeSegment] = []
    # Riser at origin, cross-main runs along the y axis.
    for i, (x, y) in enumerate([
        (1, 1), (1, 2), (2, 1), (2, 2),
        (18, 18), (18, 19), (19, 18), (19, 19),
    ]):
        hid = f"head_{i:02d}"
        heads.append(Head(
            id=hid, sku="TY3231", k_factor=5.6, temp_rating_f=155,
            position_m=(float(x), float(y), 2.8), orientation="pendent",
        ))
        # Each head connects to the riser via a pipe whose length is
        # roughly proportional to its distance — gives the solver
        # something to chew on.
        length = (x * x + y * y) ** 0.5
        pipes.append(PipeSegment(
            id=f"pipe_{i:02d}", from_node=hid, to_node="riser_r1",
            size_in=1.0, schedule="sch10",
            start_m=(float(x), float(y), 2.8),
            end_m=(0.0, 0.0, 0.0),
            length_m=length, elevation_change_m=-2.8,
            downstream_heads=1, role="branch",
        ))

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
                polygon_m=[(0, 0), (20, 0), (20, 20), (0, 20)],
                area_sqm=400.0, use_class="office",
                hazard_class="light", ceiling=Ceiling(),
            )],
        )],
    )
    design = Design(
        project=Project(
            id=project_id, name="Peak", address="",
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
    _make_design_with_heads(tmp_path)
    return TestClient(main.app)


def test_auto_peak_picks_worst_case_window(client: TestClient) -> None:
    """With explicit candidates the endpoint picks the one with the
    lowest residual pressure and persists it on the scene."""
    near = [
        {"x": 0.5, "y": 0.5}, {"x": 2.5, "y": 0.5},
        {"x": 2.5, "y": 2.5}, {"x": 0.5, "y": 2.5},
    ]
    far = [
        {"x": 17.5, "y": 17.5}, {"x": 19.5, "y": 17.5},
        {"x": 19.5, "y": 19.5}, {"x": 17.5, "y": 19.5},
    ]
    r = client.post(
        "/projects/peak/auto-peak",
        json={"candidates": [near, far]},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["op"] == "auto_peak"
    assert len(body["all_candidates"]) == 2

    chosen_poly = body["chosen_area"]["polygon_m"]
    # The "far" polygon must win — its residual pressure is lower.
    assert chosen_poly[0][0] > 10.0
    assert chosen_poly[0][1] > 10.0

    near_margin = next(
        c["margin_psi"] for c in body["all_candidates"]
        if c["polygon_m"][0][0] < 10
    )
    far_margin = next(
        c["margin_psi"] for c in body["all_candidates"]
        if c["polygon_m"][0][0] > 10
    )
    assert far_margin < near_margin, (
        f"far polygon should have tighter safety margin; got "
        f"far={far_margin} near={near_margin}"
    )

    # Selection persists on the scene.
    design_path = Path(main._DATA_ROOT) / "peak" / "deliverables" / "design.json"
    design = json.loads(design_path.read_text(encoding="utf-8"))
    ra = design["systems"][0]["remote_area"]
    assert ra["name"] == "auto_peak"
    assert ra["selection_reason"] == "auto_peak"
    assert ra["polygon_m"] == chosen_poly


def test_auto_peak_with_default_candidates(client: TestClient) -> None:
    """Omitting `candidates` produces the 4 quadrant windows and
    picks the worst of them."""
    r = client.post("/projects/peak/auto-peak", json={})
    assert r.status_code == 200, r.text
    body = r.json()
    # Up to 4 quadrant candidates, all with residual_psi set.
    assert 1 <= len(body["all_candidates"]) <= 4
    for c in body["all_candidates"]:
        assert c["residual_psi"] is not None or c.get("error")
    assert body["chosen_area"]["selection_reason"] == "auto_peak"

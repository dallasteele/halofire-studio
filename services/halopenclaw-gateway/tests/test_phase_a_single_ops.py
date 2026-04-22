"""Phase A — single-op endpoint tests.

Covers each new route end-to-end against a fresh design.json on a
temp data root. Keeps the existing /calculate contract.
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
    Building, Design, Level, Project, Room, Ceiling,
)


def _make_design(data_root: Path, project_id: str = "alpha") -> Path:
    out = data_root / project_id / "deliverables"
    out.mkdir(parents=True, exist_ok=True)
    # Build a minimal but valid design with one level and one room so
    # hazard inference + rule checks exercise a non-empty path.
    bldg = Building(
        project_id=project_id,
        levels=[
            Level(
                id="L1", name="Level 1", elevation_m=0.0, height_m=3.0,
                use="office",
                rooms=[Room(
                    id="R1", name="Office 101",
                    polygon_m=[(0, 0), (10, 0), (10, 6), (0, 6)],
                    area_sqm=60.0, use_class="office",
                    hazard_class="light",
                    ceiling=Ceiling(),
                )],
            ),
        ],
    )
    design = Design(
        project=Project(
            id=project_id, name="Alpha", address="",
            ahj="Local AHJ", code="NFPA 13 2022",
        ),
        building=bldg,
        metadata={"capabilities": {"tree_hydraulic_solver": True}},
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
    _make_design(tmp_path)
    return TestClient(main.app)


# ── HEADS ──────────────────────────────────────────────────────────


def test_insert_head_adds_node_and_emits_seq(client: TestClient) -> None:
    r = client.post(
        "/projects/alpha/heads",
        json={"position_m": {"x": 1.0, "y": 2.0, "z": 2.8}, "sku": "TY3231"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["op"] == "insert_head"
    assert body["seq"] == 1
    assert len(body["delta"]["added_nodes"]) == 1


def test_modify_head_changes_sku(client: TestClient) -> None:
    insert = client.post(
        "/projects/alpha/heads",
        json={"position_m": {"x": 0, "y": 0, "z": 2.8}},
    ).json()
    head_id = insert["delta"]["added_nodes"][0]
    r = client.patch(
        f"/projects/alpha/heads/{head_id}",
        json={"sku": "V3601", "k_factor": 8.0},
    )
    assert r.status_code == 200
    assert head_id in r.json()["delta"]["changed_nodes"]


def test_delete_head_removes_node(client: TestClient) -> None:
    insert = client.post(
        "/projects/alpha/heads",
        json={"position_m": {"x": 0, "y": 0, "z": 2.8}},
    ).json()
    head_id = insert["delta"]["added_nodes"][0]
    r = client.delete(f"/projects/alpha/heads/{head_id}")
    assert r.status_code == 200
    assert head_id in r.json()["delta"]["removed_nodes"]


def test_modify_head_unknown_404(client: TestClient) -> None:
    r = client.patch("/projects/alpha/heads/head_missing", json={"sku": "X"})
    assert r.status_code == 404


# ── PIPES ──────────────────────────────────────────────────────────


def test_insert_pipe_computes_length(client: TestClient) -> None:
    r = client.post(
        "/projects/alpha/pipes",
        json={
            "from_point_m": {"x": 0, "y": 0, "z": 2.8},
            "to_point_m": {"x": 3, "y": 4, "z": 2.8},
            "size_in": 1.0,
        },
    )
    assert r.status_code == 200
    pipe_id = r.json()["delta"]["added_nodes"][0]
    # Reload design.json and confirm length = 5.
    design = json.loads((main._DATA_ROOT / "alpha" / "deliverables" / "design.json").read_text())
    pipe = next(p for s in design["systems"] for p in s["pipes"] if p["id"] == pipe_id)
    assert abs(pipe["length_m"] - 5.0) < 1e-6


def test_modify_pipe_updates_size_and_length(client: TestClient) -> None:
    insert = client.post(
        "/projects/alpha/pipes",
        json={
            "from_point_m": {"x": 0, "y": 0, "z": 0},
            "to_point_m": {"x": 1, "y": 0, "z": 0},
        },
    ).json()
    pipe_id = insert["delta"]["added_nodes"][0]
    r = client.patch(
        f"/projects/alpha/pipes/{pipe_id}",
        json={"size_in": 2.5, "end_m": {"x": 5, "y": 0, "z": 0}},
    )
    assert r.status_code == 200
    design = json.loads((main._DATA_ROOT / "alpha" / "deliverables" / "design.json").read_text())
    pipe = next(p for s in design["systems"] for p in s["pipes"] if p["id"] == pipe_id)
    assert pipe["size_in"] == 2.5
    assert abs(pipe["length_m"] - 5.0) < 1e-6


def test_delete_pipe(client: TestClient) -> None:
    insert = client.post(
        "/projects/alpha/pipes",
        json={
            "from_point_m": {"x": 0, "y": 0, "z": 0},
            "to_point_m": {"x": 1, "y": 0, "z": 0},
        },
    ).json()
    pipe_id = insert["delta"]["added_nodes"][0]
    r = client.delete(f"/projects/alpha/pipes/{pipe_id}")
    assert r.status_code == 200


# ── FITTINGS / HANGERS / BRACES / REMOTE AREA ───────────────────────


def test_insert_fitting_valid(client: TestClient) -> None:
    r = client.post(
        "/projects/alpha/fittings",
        json={"kind": "elbow_90", "position_m": {"x": 0, "y": 0, "z": 2.8}, "size_in": 1.0},
    )
    assert r.status_code == 200
    assert len(r.json()["delta"]["added_nodes"]) == 1


def test_insert_fitting_invalid_kind_400(client: TestClient) -> None:
    r = client.post(
        "/projects/alpha/fittings",
        json={"kind": "flux_capacitor", "position_m": {"x": 0, "y": 0, "z": 0}, "size_in": 1.0},
    )
    assert r.status_code == 400


def test_insert_hanger_requires_pipe(client: TestClient) -> None:
    # No pipe yet — expect 404.
    r = client.post(
        "/projects/alpha/hangers",
        json={"pipe_id": "pipe_nope", "position_m": {"x": 0, "y": 0, "z": 2.8}},
    )
    assert r.status_code == 404


def test_insert_hanger_on_existing_pipe(client: TestClient) -> None:
    insert = client.post(
        "/projects/alpha/pipes",
        json={"from_point_m": {"x": 0, "y": 0, "z": 0}, "to_point_m": {"x": 5, "y": 0, "z": 0}},
    ).json()
    pipe_id = insert["delta"]["added_nodes"][0]
    r = client.post(
        "/projects/alpha/hangers",
        json={"pipe_id": pipe_id, "position_m": {"x": 2.5, "y": 0, "z": 0}},
    )
    assert r.status_code == 200


def test_insert_brace(client: TestClient) -> None:
    pipe = client.post(
        "/projects/alpha/pipes",
        json={"from_point_m": {"x": 0, "y": 0, "z": 0}, "to_point_m": {"x": 5, "y": 0, "z": 0}},
    ).json()["delta"]["added_nodes"][0]
    r = client.post(
        "/projects/alpha/braces",
        json={"pipe_id": pipe, "position_m": {"x": 2.5, "y": 0, "z": 0}, "kind": "lateral"},
    )
    assert r.status_code == 200


def test_set_remote_area(client: TestClient) -> None:
    r = client.post(
        "/projects/alpha/remote-areas",
        json={
            "polygon_m": [
                {"x": 0, "y": 0}, {"x": 5, "y": 0},
                {"x": 5, "y": 5}, {"x": 0, "y": 5},
            ],
            "name": "worst_case",
        },
    )
    assert r.status_code == 200


# ── SKU swap ───────────────────────────────────────────────────────


def test_swap_sku_on_head(client: TestClient) -> None:
    insert = client.post(
        "/projects/alpha/heads",
        json={"position_m": {"x": 0, "y": 0, "z": 2.8}},
    ).json()
    head_id = insert["delta"]["added_nodes"][0]
    r = client.patch(f"/projects/alpha/nodes/{head_id}/sku", json={"sku": "V3601", "k_factor": 8.0})
    assert r.status_code == 200


def test_swap_sku_unknown_404(client: TestClient) -> None:
    r = client.patch("/projects/alpha/nodes/ghost/sku", json={"sku": "X"})
    assert r.status_code == 404


# ── Rule check / BOM recompute ──────────────────────────────────────


def test_rules_run(client: TestClient) -> None:
    r = client.post("/projects/alpha/rules/run")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert isinstance(body["violations"], list)


def test_bom_recompute_empty_scene(client: TestClient) -> None:
    r = client.post("/projects/alpha/bom/recompute")
    assert r.status_code == 200
    body = r.json()
    assert "rows" in body
    assert "total_usd" in body


def test_calculate_still_works(client: TestClient) -> None:
    # The existing /calculate endpoint must keep the same contract.
    r = client.post("/projects/alpha/calculate", json={})
    assert r.status_code == 200
    body = r.json()
    assert "calculation" in body


# ── Undo / redo ─────────────────────────────────────────────────────


def test_undo_after_insert_head_removes_it(client: TestClient) -> None:
    insert = client.post(
        "/projects/alpha/heads",
        json={"position_m": {"x": 0, "y": 0, "z": 2.8}},
    ).json()
    head_id = insert["delta"]["added_nodes"][0]
    r = client.post("/projects/alpha/undo")
    assert r.status_code == 200
    design = json.loads((main._DATA_ROOT / "alpha" / "deliverables" / "design.json").read_text())
    ids = [h["id"] for s in design["systems"] for h in s.get("heads", [])]
    assert head_id not in ids


def test_redo_reapplies_insert(client: TestClient) -> None:
    insert = client.post(
        "/projects/alpha/heads",
        json={"position_m": {"x": 0, "y": 0, "z": 2.8}},
    ).json()
    head_id = insert["delta"]["added_nodes"][0]
    client.post("/projects/alpha/undo")
    r = client.post("/projects/alpha/redo")
    assert r.status_code == 200
    design = json.loads((main._DATA_ROOT / "alpha" / "deliverables" / "design.json").read_text())
    ids = [h["id"] for s in design["systems"] for h in s.get("heads", [])]
    assert head_id in ids


def test_undo_empty_returns_409(client: TestClient) -> None:
    r = client.post("/projects/alpha/undo")
    assert r.status_code == 409


def test_redo_empty_returns_409(client: TestClient) -> None:
    r = client.post("/projects/alpha/redo")
    assert r.status_code == 409


def test_new_mutation_clears_redo_stack(client: TestClient) -> None:
    # Insert, undo, then a fresh insert — redo must 409 now.
    client.post("/projects/alpha/heads", json={"position_m": {"x": 0, "y": 0, "z": 2.8}})
    client.post("/projects/alpha/undo")
    client.post("/projects/alpha/heads", json={"position_m": {"x": 1, "y": 1, "z": 2.8}})
    r = client.post("/projects/alpha/redo")
    assert r.status_code == 409

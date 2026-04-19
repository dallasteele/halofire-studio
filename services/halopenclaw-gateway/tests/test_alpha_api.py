from __future__ import annotations

import json
import sys
from pathlib import Path

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
CAD_ROOT = ROOT.parent / "halofire-cad"
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(CAD_ROOT))

import main  # noqa: E402
from cad.schema import Building, Design, Project  # noqa: E402


def _write_design(root: Path, project_id: str = "alpha") -> None:
    out = root / project_id / "deliverables"
    out.mkdir(parents=True, exist_ok=True)
    design = Design(
        project=Project(
            id=project_id,
            name="Alpha",
            address="",
            ahj="Local AHJ",
            code="NFPA 13 2022",
        ),
        building=Building(project_id=project_id),
        metadata={"capabilities": {"tree_hydraulic_solver": True}},
    )
    (out / "design.json").write_text(
        json.dumps(design.model_dump(), indent=2),
        encoding="utf-8",
    )
    (out / "manifest.json").write_text(
        json.dumps({"files": {"design": str(out / "design.json")}, "warnings": ["alpha"]}),
        encoding="utf-8",
    )


def test_manifest_validate_calculate_and_local_api_key(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(main, "_DATA_ROOT", tmp_path)
    monkeypatch.setattr(main, "_API_KEY", "secret")
    _write_design(tmp_path)

    client = TestClient(main.app)
    assert client.get("/projects/alpha/manifest.json").status_code == 200

    unauth = client.post("/projects/alpha/validate")
    assert unauth.status_code == 401
    assert unauth.json()["error"]["message"] == "missing or invalid HALOFIRE_API_KEY"

    headers = {"x-halofire-api-key": "secret"}
    validated = client.post("/projects/alpha/validate", headers=headers)
    assert validated.status_code == 200
    assert "violations" in validated.json()

    calculated = client.post("/projects/alpha/calculate", headers=headers, json={})
    assert calculated.status_code == 200
    assert calculated.json()["calculation"]["systems"] == []
    assert (tmp_path / "alpha" / "deliverables" / "hydraulic_report.json").exists()


def test_deliverable_path_safety(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(main, "_DATA_ROOT", tmp_path)
    monkeypatch.setattr(main, "_API_KEY", None)
    _write_design(tmp_path)
    client = TestClient(main.app)

    response = client.get("/projects/alpha/deliverable/%2E%2E%2Fdesign.json")
    assert response.status_code == 404
    assert "error" in response.json()

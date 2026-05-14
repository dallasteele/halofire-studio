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


def _write_portal_bundle(root: Path, project_id: str = "alpha") -> None:
    out = root / project_id / "deliverables"
    out.mkdir(parents=True, exist_ok=True)
    project = {
        "id": project_id,
        "name": "Alpha Tower",
        "address": "123 Main St",
        "ahj": "Local AHJ",
        "code": "NFPA 13 2022",
    }
    proposal = {
        "version": 1,
        "generated_at": "2026-05-12T12:00:00Z",
        "project": project,
        "building_summary": {
            "total_sqft": 12000,
            "construction_type": "Type V",
            "level_count": 2,
        },
        "levels": [
            {
                "id": "L1",
                "name": "Level 1",
                "use": "office",
                "elevation_ft": 0,
                "head_count": 8,
                "pipe_count": 2,
                "pipe_total_ft": 240,
                "room_count": 4,
            }
        ],
        "systems": [
            {
                "id": "wet-1",
                "type": "wet",
                "head_count": 8,
                "pipe_count": 2,
                "pipe_total_m": 73.2,
                "hydraulic": {
                    "required_flow_gpm": 120,
                    "required_pressure_psi": 45,
                    "supply_static_psi": 65,
                    "supply_residual_psi": 52,
                    "demand_psi": 47,
                    "safety_margin_psi": 18,
                },
            }
        ],
        "pricing": {
            "materials_usd": 1000,
            "labor_usd": 2000,
            "permit_allowance_usd": 3250,
            "taxes_usd": 240,
            "subtotal_usd": 6250,
            "total_usd": 6490,
        },
        "violations": [
            {
                "code": "PORTAL_WARN",
                "severity": "warning",
                "message": "Designer review still pending.",
            }
        ],
        "deliverables": {
            "sheet_set_pdf": "FP-0 cover",
            "proposal_html": "proposal.html",
        },
    }
    design = {
        "project": project,
        "building": {
            "project_id": project_id,
            "construction_type": "Type V",
            "total_sqft": 12000,
            "levels": [
                {
                    "id": "L1",
                    "name": "Level 1",
                    "elevation_m": 0.0,
                    "height_m": 3.0,
                    "use": "office",
                    "polygon_m": [[0.0, 0.0], [15.0, 0.0], [15.0, 10.0], [0.0, 10.0]],
                    "rooms": [
                        {"id": "R1", "name": "Suite 100", "polygon_m": [[0.0, 0.0], [7.5, 0.0], [7.5, 10.0], [0.0, 10.0]], "area_sqm": 75.0, "use_class": "office"},
                        {"id": "R2", "name": "Suite 101", "polygon_m": [[7.5, 0.0], [15.0, 0.0], [15.0, 10.0], [7.5, 10.0]], "area_sqm": 75.0, "use_class": "office"},
                    ],
                }
            ],
        },
        "systems": [
            {
                "id": "wet-1",
                "type": "wet",
                "supplies": ["L1"],
                "riser": {
                    "id": "R1",
                    "position_m": [1.0, 0.0, 0.0],
                    "size_in": 6.0,
                    "fdc_type": "wall_mount",
                },
                "heads": [
                    {
                        "id": "H1",
                        "sku": "PENDENT",
                        "k_factor": 5.6,
                        "position_m": [2.0, 2.5, 2.7],
                        "orientation": "pendent",
                        "room_id": "R1",
                    }
                ],
                "pipes": [
                    {
                        "id": "P1",
                        "from_node": "R1",
                        "to_node": "H1",
                        "size_in": 2.0,
                        "start_m": [1.0, 0.0, 0.0],
                        "end_m": [2.0, 2.5, 2.7],
                        "length_m": 3.0,
                    }
                ],
            }
        ],
        "issues": [
            {
                "code": "DESIGN_WARN",
                "severity": "warning",
                "message": "Level loop requires human review.",
                "refs": ["L1"],
            }
        ],
        "deliverables": {
            "files": {
                "proposal": str(out / "proposal.json"),
                "design": str(out / "design.json"),
                "proposal_html": str(out / "proposal.html"),
                "proposal_pdf": str(out / "proposal.pdf"),
                "proposal_xlsx": str(out / "proposal.xlsx"),
            },
            "warnings": ["Design draft only."],
        },
    }
    manifest = {
        "files": {
            "proposal": str(out / "proposal.json"),
            "design": str(out / "design.json"),
            "html": str(out / "proposal.html"),
            "pdf": str(out / "proposal.pdf"),
            "xlsx": str(out / "proposal.xlsx"),
        },
        "warnings": ["Manifest warning"],
    }
    (out / "proposal.json").write_text(json.dumps(proposal, indent=2), encoding="utf-8")
    (out / "design.json").write_text(json.dumps(design, indent=2), encoding="utf-8")
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    (out / "proposal.html").write_text(
        (
            "<html><body>"
            '<a href="./proposal.json">proposal.json</a>'
            '<a href="./proposal.pdf">proposal.pdf</a>'
            '<a href="./proposal.xlsx">proposal.xlsx</a>'
            '<a href="./design.json">design.json</a>'
            '<model-viewer src="design.glb"></model-viewer>'
            "</body></html>"
        ),
        encoding="utf-8",
    )
    (out / "proposal.pdf").write_text("pdf", encoding="utf-8")
    (out / "proposal.xlsx").write_text("xlsx", encoding="utf-8")
    (out / "design.glb").write_text("glb", encoding="utf-8")


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


def test_portal_bundle_includes_real_artifacts_and_signed_downloads(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(main, "_DATA_ROOT", tmp_path)
    monkeypatch.setattr(main.hf_auth, "_AUTH_REQUIRED", False)
    monkeypatch.setattr(main.hf_auth, "_SECRET", "test-secret")
    _write_portal_bundle(tmp_path)
    client = TestClient(main.app)

    portal = client.get("/projects/alpha/portal.json")
    assert portal.status_code == 200
    payload = portal.json()
    assert payload["project_id"] == "alpha"
    assert payload["access"]["signed_downloads"] is True
    assert payload["charts"]["cost_breakdown"][0]["label"] == "Materials"
    download_names = {item["name"] for item in payload["downloads"]}
    assert "proposal.html" in download_names
    assert "proposal.pdf" in download_names
    assert "proposal.xlsx" in download_names
    assert all("?sig=" in item["href"] for item in payload["downloads"])
    assert "Manifest warning" in payload["warnings"]
    assert any("Head count truth mismatch" in warning for warning in payload["warnings"])

    charts = client.get("/projects/alpha/charts.json")
    assert charts.status_code == 200
    assert charts.json()["cost_breakdown"][0]["label"] == "Materials"

    downloads = client.get("/projects/alpha/downloads.json")
    assert downloads.status_code == 200
    assert downloads.json()["downloads"][0]["name"] == "proposal.html"

    sig = main.hf_auth.sign_deliverable("alpha", "proposal.pdf", ttl_seconds=60)
    served = client.get("/projects/alpha/deliverable/proposal.pdf", params={"sig": sig})
    assert served.status_code == 200
    assert served.text == "pdf"

    html_sig = main.hf_auth.sign_deliverable("alpha", "proposal.html", ttl_seconds=60)
    proposal_html = client.get("/projects/alpha/deliverable/proposal.html", params={"sig": html_sig})
    assert proposal_html.status_code == 200
    assert 'href="./proposal.json"' not in proposal_html.text
    assert "/projects/alpha/deliverable/proposal.json?sig=" in proposal_html.text
    assert "/projects/alpha/deliverable/design.glb?sig=" in proposal_html.text

    bad = client.get("/projects/alpha/deliverable/proposal.pdf", params={"sig": "1.deadbeef"})
    assert bad.status_code == 401


def test_portal_bundle_honors_auth_when_enabled(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(main, "_DATA_ROOT", tmp_path)
    monkeypatch.setattr(main.hf_auth, "_AUTH_REQUIRED", True)
    monkeypatch.setattr(main.hf_auth, "_SECRET", "test-secret")
    _write_portal_bundle(tmp_path)
    client = TestClient(main.app)

    denied = client.get("/projects/alpha/portal.json")
    assert denied.status_code == 401
    assert client.get("/projects/alpha/proposal.json").status_code == 401
    assert client.get("/projects/alpha/design.json").status_code == 401

    token = main.hf_auth.sign_jwt("wade", {"alpha": "viewer"})
    allowed = client.get(
        "/projects/alpha/portal.json",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert allowed.status_code == 200
    assert client.get(
        "/projects/alpha/proposal.json",
        headers={"Authorization": f"Bearer {token}"},
    ).status_code == 200
    assert client.get(
        "/projects/alpha/design.json",
        headers={"Authorization": f"Bearer {token}"},
    ).status_code == 200

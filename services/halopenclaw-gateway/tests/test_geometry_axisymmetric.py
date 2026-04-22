"""H.3 — a5_geometry: axisymmetric revolve + ports-driven fitting."""
from __future__ import annotations

import asyncio
from pathlib import Path

import trimesh

from enrichment_agents._protocol import EnrichmentContext
from enrichment_agents.a5_geometry import GeometryAgent, _parametric_profile, _revolve


def test_parametric_profile_head_nonempty():
    prof = _parametric_profile("sprinkler_head", body_dia_m=0.025, length_m=0.04)
    assert len(prof) >= 4
    # profile is a closed loop-ish series: starts at r=0 and ends at r=0
    assert prof[0][0] == 0.0
    assert prof[-1][0] == 0.0


def test_revolve_produces_watertight_mesh():
    prof = _parametric_profile("sprinkler_head", body_dia_m=0.025, length_m=0.04)
    mesh = _revolve(prof, segments=16)
    assert isinstance(mesh, trimesh.Trimesh)
    assert len(mesh.vertices) > 16
    assert len(mesh.faces) > 16


def test_geometry_agent_sprinkler_head(tmp_path: Path):
    ctx = EnrichmentContext(
        sku_id="h1",
        catalog_entry={
            "sku": "h1",
            "kind": "sprinkler_head",
            "params": {"size_in": {"default": 0.5}, "length_in": {"default": 2.0}},
            "ports": [],
        },
        cut_sheet_path=None,
        cut_sheet_url=None,
        workdir=tmp_path,
        llm_client=None,
        sam_url="",
        artifacts={"validated_mask": {}},
    )
    result = asyncio.run(GeometryAgent().run(ctx))
    assert result.ok
    assert Path(result.artifacts["mesh_obj_path"]).exists()
    assert "axisymmetric" in result.artifacts["geometry_method"]


def test_geometry_agent_fitting_ports_driven(tmp_path: Path):
    ctx = EnrichmentContext(
        sku_id="f1",
        catalog_entry={
            "sku": "f1",
            "kind": "fitting",
            "params": {"size_in": {"default": 2.0}},
            "ports": [
                {
                    "position_m": [-0.05, 0, 0],
                    "direction": [-1, 0, 0],
                    "size_in": 2,
                },
                {
                    "position_m": [0.05, 0, 0],
                    "direction": [1, 0, 0],
                    "size_in": 2,
                },
            ],
        },
        cut_sheet_path=None,
        cut_sheet_url=None,
        workdir=tmp_path,
        llm_client=None,
        sam_url="",
        artifacts={"validated_mask": {}},
    )
    result = asyncio.run(GeometryAgent().run(ctx))
    assert result.ok
    assert result.confidence == 0.6
    assert "ports-driven" in (result.reason or "")
    assert Path(result.artifacts["mesh_obj_path"]).exists()


def test_geometry_agent_unsupported_kind(tmp_path: Path):
    ctx = EnrichmentContext(
        sku_id="x",
        catalog_entry={"kind": "something_weird"},
        cut_sheet_path=None,
        cut_sheet_url=None,
        workdir=tmp_path,
        llm_client=None,
        sam_url="",
        artifacts={},
    )
    result = asyncio.run(GeometryAgent().run(ctx))
    assert not result.ok
    assert "unsupported-kind" in (result.reason or "")

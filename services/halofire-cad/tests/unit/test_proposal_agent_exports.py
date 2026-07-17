"""Proposal bundle integration checks for typed Design inputs."""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

_SPEC = importlib.util.spec_from_file_location(
    "hf_proposal_agent_under_test",
    ROOT / "agents" / "09-proposal" / "agent.py",
)
assert _SPEC is not None and _SPEC.loader is not None
PROPOSAL = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(PROPOSAL)

from cad.schema import Building, Design, Level, Project  # noqa: E402


def test_typed_design_emits_html_submittal_and_prefab(tmp_path: Path) -> None:
    design = Design(
        project=Project(
            id="typed-design",
            name="Typed Design",
            address="123 Source Plan Way",
            ahj="Test AHJ",
            code="NFPA 13 2022",
        ),
        building=Building(
            project_id="typed-design",
            levels=[Level(
                id="l1",
                name="Level 1",
                elevation_m=0.0,
                height_m=3.0,
                use="other",
            )],
        ),
        systems=[],
    )
    data = PROPOSAL.build_proposal_data(design, [], [], [])

    paths = PROPOSAL.write_proposal_files(
        data,
        tmp_path,
        design_payload=design,
    )

    assert not {key for key in paths if key.endswith("_error")}, paths
    assert (tmp_path / "proposal.html").is_file()
    assert (tmp_path / "submittal.pdf").read_bytes().startswith(b"%PDF")
    assert (tmp_path / "prefab.pdf").read_bytes().startswith(b"%PDF")
    assert (tmp_path / "cut_list.csv").is_file()


def test_failed_html_export_removes_stale_output(
    tmp_path: Path,
    monkeypatch,
) -> None:
    stale = tmp_path / "proposal.html"
    stale.write_text("stale", encoding="utf-8")
    design = Design(
        project=Project(
            id="stale",
            name="Stale",
            address="",
            ahj="AHJ",
            code="NFPA 13 2022",
        ),
        building=Building(project_id="stale", levels=[]),
        systems=[],
    )
    data = PROPOSAL.build_proposal_data(design, [], [], [])

    real_spec = importlib.util.spec_from_file_location

    def fail_html(name, location, *args, **kwargs):
        if name == "_halofire_proposal_html":
            raise RuntimeError("forced HTML failure")
        return real_spec(name, location, *args, **kwargs)

    monkeypatch.setattr(importlib.util, "spec_from_file_location", fail_html)
    paths = PROPOSAL.write_proposal_files(data, tmp_path, design_payload=design)

    assert paths["html_error"] == "forced HTML failure"
    assert not stale.exists()

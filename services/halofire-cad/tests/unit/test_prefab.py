"""Unit tests for the prefab + cut-list generator."""
from __future__ import annotations

import csv
import importlib.util
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]

_SPEC = importlib.util.spec_from_file_location(
    "prefab_mod", ROOT / "agents" / "09-proposal" / "prefab.py",
)
assert _SPEC is not None and _SPEC.loader is not None
PF = importlib.util.module_from_spec(_SPEC)
sys.modules["prefab_mod"] = PF
_SPEC.loader.exec_module(PF)


_SAMPLE = {
    "project": {"name": "Test Bldg", "address": "100 Test St"},
    "systems": [
        {
            "id": "SYS-1",
            "pipes": [
                {"id": "p0", "size_in": 2.0, "length_m": 1.0, "schedule": "sch10"},
                {"id": "p1", "size_in": 3.0, "length_m": 2.5, "schedule": "sch10"},
                {"id": "p2", "size_in": 4.0, "length_m": 5.0, "schedule": "sch40"},
            ],
        },
        {
            "id": "SYS-2",
            "pipes": [
                {"id": "p0", "size_in": 1.5, "length_m": 0.8, "schedule": "sch10"},
            ],
        },
    ],
}


def test_build_prefab_emits_row_per_pipe() -> None:
    prefabs = PF.build_prefab(_SAMPLE["systems"])
    assert len(prefabs) == 2
    assert sum(len(p.rows) for p in prefabs) == 4


def test_cutrow_do_not_fab_flag() -> None:
    prefabs = PF.build_prefab(_SAMPLE["systems"])
    # SYS-1 p0 (2"): DNF=True
    sys1 = next(p for p in prefabs if p.system_id == "SYS-1")
    tags = {r.pipe_id: r.do_not_fab for r in sys1.rows}
    assert tags["p0"] is True     # 2" < 3"
    assert tags["p1"] is False    # 3" == threshold
    assert tags["p2"] is False    # 4"
    # SYS-2 p0 (1.5"): DNF
    sys2 = next(p for p in prefabs if p.system_id == "SYS-2")
    assert sys2.rows[0].do_not_fab is True


def test_fab_tag_uses_system_id() -> None:
    prefabs = PF.build_prefab(_SAMPLE["systems"])
    for pf in prefabs:
        for r in pf.rows:
            assert r.fab_tag.startswith(pf.system_id.upper())


def test_fab_tag_falls_back_for_missing_id() -> None:
    systems = [
        {"id": "SYS-X",
         "pipes": [{"id": "", "size_in": 2.0, "length_m": 1.0}]},
    ]
    prefabs = PF.build_prefab(systems)
    tag = prefabs[0].rows[0].fab_tag
    assert tag == "SYS-X-P0000"


def test_tally_totals_are_correct() -> None:
    prefabs = PF.build_prefab(_SAMPLE["systems"])
    sys1 = next(p for p in prefabs if p.system_id == "SYS-1")
    # Lengths 1.0 + 2.5 + 5.0 = 8.5 m
    assert sys1.total_length_m == pytest.approx(8.5, abs=0.01)
    assert sys1.total_length_ft == pytest.approx(8.5 * 3.281, abs=0.1)
    assert sys1.fab_count == 2
    assert sys1.field_cut_count == 1


def test_cut_list_csv_columns(tmp_path: Path) -> None:
    prefabs = PF.build_prefab(_SAMPLE["systems"])
    out = PF.write_cut_list_csv(prefabs, tmp_path / "cl.csv")
    rows = list(csv.reader(out.open("r", encoding="utf-8", newline="")))
    assert rows[0] == [
        "fab_tag", "system_id", "pipe_id", "size_in", "schedule",
        "length_m", "length_ft", "do_not_fab", "notes",
    ]
    # 4 data rows
    assert len(rows) == 5


def test_write_prefab_pdf_produces_pdf_and_csv(tmp_path: Path) -> None:
    res = PF.write_prefab_pdf(_SAMPLE, tmp_path)
    assert Path(res["pdf"]).exists()
    assert Path(res["csv"]).exists()
    assert res["segment_count"] == 4
    assert res["fab_count"] == 2
    assert res["field_cut_count"] == 2  # SYS-1 p0 (2") + SYS-2 p0 (1.5")
    if PF._REPORTLAB:
        data = Path(res["pdf"]).read_bytes()
        assert data.startswith(b"%PDF-")


def test_empty_systems_generates_valid_outputs(tmp_path: Path) -> None:
    res = PF.write_prefab_pdf({"project": {}, "systems": []}, tmp_path)
    assert Path(res["pdf"]).exists()
    assert Path(res["csv"]).exists()
    assert res["segment_count"] == 0
    assert res["fab_count"] == 0


def test_pipe_size_boundary_3in_is_fabricable() -> None:
    systems = [{
        "id": "S",
        "pipes": [
            {"id": "p0", "size_in": 2.999, "length_m": 1},
            {"id": "p1", "size_in": 3.0, "length_m": 1},
            {"id": "p2", "size_in": 3.001, "length_m": 1},
        ],
    }]
    pfs = PF.build_prefab(systems)
    dnf = {r.pipe_id: r.do_not_fab for r in pfs[0].rows}
    assert dnf["p0"] is True
    assert dnf["p1"] is False
    assert dnf["p2"] is False

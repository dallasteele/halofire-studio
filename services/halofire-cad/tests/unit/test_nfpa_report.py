"""Unit tests for the NFPA 8-section submittal report (Phase 5.1)."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

_HERE = Path(__file__).resolve().parent
_AGENTS = _HERE.parents[1] / "agents" / "10-submittal"
sys.path.insert(0, str(_AGENTS))

from nfpa_report import build_nfpa_report  # noqa: E402


def _fake_design() -> dict:
    """Minimal duck-typed design for the report builder."""
    return {
        "building": {
            "levels": [
                {
                    "id": "lv0",
                    "name": "Ground Floor Parking",
                    "elevation_m": -3.66,
                    "polygon_m": [
                        (0, 0), (50, 0), (50, 30), (0, 30), (0, 0),
                    ],
                },
                {
                    "id": "lv1",
                    "name": "Level 4 — Residential",
                    "elevation_m": 13.41,
                    "polygon_m": [
                        (0, 0), (50, 0), (50, 30), (0, 30), (0, 0),
                    ],
                },
            ],
        },
        "systems": [
            {
                "id": "sys_lv0",
                "type": "dry",
                "supplies": ["lv0"],
                "riser": {"id": "r0", "size_in": 4.0},
                "heads": [
                    {"id": f"h{i}", "orientation": "pendent"}
                    for i in range(50)
                ],
                "pipes": [
                    {"id": f"p{i}", "size_in": 2.0,
                     "length_m": 5.0, "schedule": "sch10"}
                    for i in range(20)
                ],
            },
            {
                "id": "sys_combo",
                "type": "combo_standpipe",
                "supplies": ["lv0", "lv1"],
                "riser": {"id": "r_combo", "size_in": 4.0},
                "heads": [],
                "pipes": [],
            },
        ],
    }


def test_report_has_all_8_sections() -> None:
    rpt = build_nfpa_report(_fake_design(), [])
    for n in range(1, 9):
        keys_with_n = [k for k in rpt if k.startswith(f"section_{n}_")]
        assert len(keys_with_n) == 1, f"missing section {n}"


def test_density_area_uses_light_hazard_defaults() -> None:
    rpt = build_nfpa_report(_fake_design(), [])
    s1 = rpt["section_1_design_density_area"]
    assert s1["design_density_gpm_per_sqft"] == 0.10
    assert s1["design_area_sqft"] == 1500.0
    assert s1["hose_allowance_gpm"] == 100.0


def test_pipe_schedule_groups_by_size() -> None:
    rpt = build_nfpa_report(_fake_design(), [])
    s2 = rpt["section_2_pipe_schedule"]
    assert len(s2) == 1   # one size used
    row = s2[0]
    assert row["size_in"] == 2.0
    # 20 pipes × 5 m = 100 m = 328 ft
    assert abs(row["length_ft"] - 328.1) < 1.0


def test_device_summary_counts_heads() -> None:
    rpt = build_nfpa_report(_fake_design(), [])
    s3 = rpt["section_3_device_summary"]
    assert s3["sprinkler_heads"]["total"] == 50
    assert s3["sprinkler_heads"]["by_orientation"]["pendent"] == 50


def test_hydraulic_calc_emits_pass_or_fail() -> None:
    rpt = build_nfpa_report(_fake_design(), [])
    s5 = rpt["section_5_hydraulic_worksheet"]
    assert s5["method"].startswith("Hazen-Williams")
    assert s5["demand_gpm"] > 0
    assert s5["result"] in ("PASS", "FAIL — re-evaluate pipe sizing")


def test_demand_curve_has_marked_design_point() -> None:
    rpt = build_nfpa_report(_fake_design(), [])
    s6 = rpt["section_6_demand_curve"]
    markers = [p for p in s6 if p.get("marker") == "design point"]
    assert len(markers) == 1


def test_system_summary_includes_combo_standpipe() -> None:
    rpt = build_nfpa_report(_fake_design(), [])
    s7 = rpt["section_7_system_summary"]
    types = {row["type"] for row in s7}
    assert "combo_standpipe" in types
    assert "dry" in types

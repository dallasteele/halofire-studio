"""Smoke test for the proposal.html generator.

Guards the VPS-demo deliverable contract:
  - model-viewer tag present with design.glb src
  - per-level plan SVG rendered (or documented placeholder)
  - pricing, BOM, labor, systems sections all present
  - HTML is valid-ish (roughly balanced tags, no leaked exceptions)

Run: pytest services/halofire-cad/tests/unit/test_proposal_html.py
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

_SPEC = importlib.util.spec_from_file_location(
    "proposal_html",
    ROOT / "agents" / "09-proposal" / "proposal_html.py",
)
assert _SPEC is not None and _SPEC.loader is not None
PH = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(PH)


_SAMPLE_DATA = {
    "version": 1,
    "generated_at": "2026-04-19",
    "project": {
        "name": "The Cooperative 1881 — Phase I",
        "client": "Halo Fire Protection",
        "address": "1881 W North Temple, Salt Lake City, UT",
    },
    "building_summary": {
        "total_sqft": 184000,
        "construction_type": "V-B",
        "level_count": 3,
    },
    "levels": [
        {
            "id": "L0", "name": "Ground", "use": "retail",
            "elevation_m": 0.0, "elevation_ft": 0.0,
            "room_count": 5, "head_count": 42,
            "pipe_count": 18, "pipe_total_m": 120.0, "pipe_total_ft": 394.0,
        },
        {
            "id": "L1", "name": "Level 1", "use": "residential",
            "elevation_m": 3.6, "elevation_ft": 11.8,
            "room_count": 12, "head_count": 88,
            "pipe_count": 30, "pipe_total_m": 220.0, "pipe_total_ft": 721.0,
        },
    ],
    "systems": [
        {
            "id": "SYS-1", "type": "wet",
            "supplies": ["L0"], "head_count": 42, "pipe_count": 18,
            "pipe_total_m": 120.0, "hanger_count": 18,
            "riser_position_m": [0, 0, 0], "riser_size_in": 4,
            "fdc_type": "wall_mount",
            "hydraulic": {
                "design_area_sqft": 1500,
                "density_gpm_per_sqft": 0.10,
                "required_flow_gpm": 250,
                "required_pressure_psi": 50,
                "supply_static_psi": 75,
                "supply_residual_psi": 55,
                "demand_psi": 40,
                "safety_margin_psi": 15,
            },
        },
    ],
    "scope_of_work": ["Install wet sprinkler system"],
    "acknowledgements": ["Pricing valid 10 days"],
    "inclusions": ["All materials + labor"],
    "exclusions": ["Underground by others"],
    "bom": [
        {
            "sku": "SM_Head_Pendant_Standard_K56",
            "description": "Standard Pendant Sprinkler K=5.6",
            "qty": 130, "unit": "ea", "unit_cost_usd": 8.50,
            "extended_usd": 1105.0,
        },
    ],
    "labor": [
        {"role": "Fitter", "hours": 180, "rate_usd_hr": 58.0, "extended_usd": 10440.0},
    ],
    "violations": [],
    "pricing": {
        "materials_usd": 50000.0,
        "labor_usd": 30000.0,
        "permit_allowance_usd": 3250.0,
        "taxes_usd": 6200.0,
        "subtotal_usd": 80000.0,
        "total_usd": 89450.0,
    },
}

_SAMPLE_DESIGN = {
    "building": {
        "levels": [
            {
                "id": "L0", "elevation_m": 0.0,
                "rooms": [{"id": "R1"}, {"id": "R2"}],
            },
        ],
    },
    "systems": [
        {
            "heads": [
                {"room_id": "R1", "position_m": [1, 2, 1]},
                {"room_id": "R2", "position_m": [4, 2, 5]},
            ],
            "pipes": [
                {
                    "start_m": [0, 2, 0],
                    "end_m": [5, 2, 0],
                    "size_in": 2.0,
                },
                {
                    "start_m": [5, 2, 0],
                    "end_m": [5, 2, 6],
                    "size_in": 1.5,
                },
            ],
        },
    ],
}


# ── required sections ───────────────────────────────────────────────

def test_html_has_model_viewer_tag_with_glb() -> None:
    html = PH.build_proposal_html(_SAMPLE_DATA, design=_SAMPLE_DESIGN)
    assert "<model-viewer" in html
    assert 'src="design.glb"' in html
    assert "camera-controls" in html


def test_html_has_every_required_section() -> None:
    html = PH.build_proposal_html(_SAMPLE_DATA, design=_SAMPLE_DESIGN)
    for needed in [
        "Project summary",
        "3D model",
        "Floor plans",
        "Systems + hydraulics",
        "Pricing",
        "Scope of work",
        "Inclusions",
        "Exclusions",
        "Bill of materials",
        "Labor",
    ]:
        assert needed in html, f"missing section: {needed}"


def test_html_renders_total_price_in_header() -> None:
    html = PH.build_proposal_html(_SAMPLE_DATA)
    assert "$89,450.00" in html


def test_html_escapes_user_content() -> None:
    """Client-supplied strings must be HTML-escaped."""
    data = dict(_SAMPLE_DATA)
    data["project"] = dict(data["project"])
    data["project"]["name"] = "<script>alert(1)</script>"
    html = PH.build_proposal_html(data)
    assert "<script>alert(1)</script>" not in html
    assert "&lt;script&gt;" in html


# ── plan SVG ────────────────────────────────────────────────────────

def test_level_plan_contains_circle_per_head_and_line_per_pipe() -> None:
    svg = PH._render_plan_svg(
        "L0",
        {
            "heads": [
                {"x": 1, "z": 1, "sku": "H1"},
                {"x": 4, "z": 5, "sku": "H2"},
            ],
            "pipes": [
                {"x1": 0, "z1": 0, "x2": 5, "z2": 0, "size_in": 2.0},
            ],
        },
    )
    assert "<svg" in svg and "</svg>" in svg
    assert svg.count("<circle") == 2
    assert svg.count("<line") >= 1  # at least the pipe (plus scale bar)


def test_plan_falls_back_cleanly_when_level_has_no_geometry() -> None:
    svg = PH._render_plan_svg("L99", {"heads": [], "pipes": []})
    assert "plan-empty" in svg or "No placed heads" in svg


def test_plan_uses_nfpa_size_color_for_2in() -> None:
    svg = PH._render_plan_svg(
        "L0",
        {
            "heads": [],
            "pipes": [{"x1": 0, "z1": 0, "x2": 5, "z2": 0, "size_in": 2.0}],
        },
    )
    # NFPA 2" → blue (#448aff)
    assert "#448aff" in svg


# ── bom + labor rows ────────────────────────────────────────────────

def test_bom_and_labor_rows_rendered() -> None:
    html = PH.build_proposal_html(_SAMPLE_DATA)
    assert "SM_Head_Pendant_Standard_K56" in html
    assert "Fitter" in html
    assert "$10,440.00" in html


# ── tag balance sanity ──────────────────────────────────────────────

def test_no_unescaped_exceptions_and_tag_balance() -> None:
    html = PH.build_proposal_html(_SAMPLE_DATA, design=_SAMPLE_DESIGN)
    # Section open/close balance
    assert html.count("<section") == html.count("</section>")
    # Table open/close balance
    assert html.count("<table") == html.count("</table>")
    # No raw Python repr leaked
    assert "<class " not in html
    assert "Traceback" not in html

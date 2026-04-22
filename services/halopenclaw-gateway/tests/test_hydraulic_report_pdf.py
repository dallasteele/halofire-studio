"""Phase A.1 — Hydraulic report PDF renderer.

Runs the renderer against a known NFPA 8-section JSON and asserts
the resulting PDF is parseable and carries the expected section
headings + table rows.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import hydraulic_report_pdf as hrp  # noqa: E402


_SAMPLE_REPORT = {
    "format": "NFPA 13 §27 + Annex E (8-section submittal)",
    "version": 1,
    "section_1_design_density_area": {
        "occupancy_class": "Light Hazard (residential per NFPA 13 §5.2)",
        "design_density_gpm_per_sqft": 0.10,
        "design_area_sqft": 1500.0,
        "hose_allowance_gpm": 100.0,
        "total_floor_area_sqft": 12345.0,
    },
    "section_2_pipe_schedule": [
        {"size_in": 1.0, "schedule": "sch10", "hazen_williams_c": 100,
         "internal_dia_in": 1.097, "length_ft": 312.5, "length_m": 95.3},
        {"size_in": 2.5, "schedule": "sch10", "hazen_williams_c": 100,
         "internal_dia_in": 2.635, "length_ft": 48.0, "length_m": 14.6},
    ],
    "section_3_device_summary": {
        "sprinkler_heads": {"total": 37, "by_orientation": {"pendent": 37}},
        "fdc": 1, "pressure_gauges": 2, "flow_switches": 1,
    },
    "section_4_riser_diagram": {
        "riser_count": 1,
        "risers": [{
            "system_id": "sys_abc123", "system_type": "wet",
            "riser_id": "riser_r1", "riser_size_in": 4.0,
            "supplies_levels": ["L1"],
        }],
    },
    "section_5_hydraulic_worksheet": {
        "method": "Hazen-Williams (NFPA 13 Annex E)",
        "demand_gpm": 250.0,
        "head_pressure_at_remote_psi": 7.0,
        "elevation_head_psi": 4.7,
        "required_pressure_psi": 16.7,
        "available_static_psi": 75.0,
        "safety_margin_psi": 58.3,
        "result": "PASS",
    },
    "section_6_demand_curve": [
        {"pressure_psi": 10, "flow_gpm": 17.7},
        {"pressure_psi": 20, "flow_gpm": 25.0},
        {"pressure_psi": 16.7, "flow_gpm": 250.0, "marker": "design point"},
    ],
    "section_7_system_summary": [
        {"id": "sys_abc123", "type": "wet", "head_count": 37,
         "pipe_total_ft": 360.5, "supplies_levels": ["L1"]},
    ],
    "section_8_test_data": {
        "hydrostatic_test_psi": 200,
        "hydrostatic_test_duration_hr": 2,
        "air_test_required": False,
        "antifreeze_required": False,
    },
}


def _extract_pdf_text(pdf_path: Path) -> str:
    try:
        import pypdf
        reader = pypdf.PdfReader(str(pdf_path))
        return "\n".join(page.extract_text() or "" for page in reader.pages)
    except ImportError:
        import pdfplumber  # type: ignore[import-not-found]
        with pdfplumber.open(str(pdf_path)) as pdf:
            return "\n".join(p.extract_text() or "" for p in pdf.pages)


def test_renders_valid_pdf_with_all_eight_sections(tmp_path: Path) -> None:
    json_path = tmp_path / "hydraulic_report.json"
    json_path.write_text(json.dumps(_SAMPLE_REPORT), encoding="utf-8")
    pdf_path = tmp_path / "hydraulic_report.pdf"
    out = hrp.render_hydraulic_report_pdf(json_path, pdf_path, project_id="alpha")
    assert out == pdf_path
    assert pdf_path.exists()
    # PDFs start with the %PDF- magic.
    head = pdf_path.read_bytes()[:5]
    assert head == b"%PDF-"

    text = _extract_pdf_text(pdf_path)
    # All eight sections present
    assert "Hydraulic Calculation Report" in text
    assert "Density / Area Curve" in text
    assert "Pipe Schedule" in text
    assert "Device Summary" in text
    assert "Riser Diagram" in text
    assert "Node-by-node Results" in text
    assert "Hydraulic Calculation Graph" in text
    assert "Summary & Sign-off" in text or "Summary" in text
    # Project-level facts made it through
    assert "alpha" in text
    # Section 3 device total
    assert "37" in text
    # Section 1 density
    assert "1500" in text


def test_renders_from_calculate_shape(tmp_path: Path) -> None:
    """A /calculate-shape JSON (no section_* keys) still produces a PDF."""
    calc_report = {
        "project_id": "calc-shape",
        "calculation": {
            "systems": [{
                "id": "sys1", "hazard": "light",
                "hydraulic": {
                    "required_flow_gpm": 180.0,
                    "required_pressure_psi": 22.0,
                    "supply_static_psi": 75.0,
                    "supply_residual_psi": 55.0,
                    "supply_flow_gpm": 1000.0,
                    "demand_at_base_of_riser_psi": 22.0,
                    "safety_margin_psi": 53.0,
                    "node_trace": [{
                        "segment_id": "pipe_01", "from_node": "head_a",
                        "to_node": "riser_r1", "size_in": 1.0,
                        "flow_gpm": 25.0, "length_ft": 15.0,
                        "friction_loss_psi": 0.8, "downstream_heads": 1,
                    }],
                },
            }],
        },
    }
    json_path = tmp_path / "hydraulic_report.json"
    json_path.write_text(json.dumps(calc_report), encoding="utf-8")
    pdf_path = tmp_path / "hydraulic_report.pdf"
    hrp.render_hydraulic_report_pdf(json_path, pdf_path, project_id="calc-shape")
    assert pdf_path.exists()
    text = _extract_pdf_text(pdf_path)
    # Node-trace table must include the pipe id from the /calculate shape.
    assert "pipe_01" in text
    assert "calc-shape" in text


def test_missing_sections_render_placeholders(tmp_path: Path) -> None:
    """Empty report renders — missing sections produce stubs, not errors."""
    json_path = tmp_path / "hydraulic_report.json"
    json_path.write_text(json.dumps({
        "section_1_design_density_area": {},
        "section_2_pipe_schedule": [],
        "section_3_device_summary": {},
        "section_4_riser_diagram": {"risers": []},
        "section_5_hydraulic_worksheet": {},
        "section_6_demand_curve": [],
        "section_7_system_summary": [],
        "section_8_test_data": {},
    }), encoding="utf-8")
    pdf_path = tmp_path / "hydraulic_report.pdf"
    hrp.render_hydraulic_report_pdf(json_path, pdf_path, project_id="empty")
    assert pdf_path.exists()
    text = _extract_pdf_text(pdf_path)
    # All section headings still present (no raise).
    assert "Pipe Schedule" in text
    assert "Node-by-node Results" in text

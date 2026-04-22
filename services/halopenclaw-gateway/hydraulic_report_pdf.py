"""Phase A.1 — Hydraulic report PDF renderer.

Reads an NFPA 8-section hydraulic report JSON (as emitted by
``agents/10-submittal/nfpa_report.py::build_nfpa_report`` or by the
gateway's ``POST /calculate``) and renders a ``hydraulic_report.pdf``
following the AutoSPRINK / NFPA 13 §27 hydraulic-report layout.

Section map:

    1. Cover sheet                    (project, date, hazard, occupancy)
    2. Density-area curve             (flow/pressure points)
    3. Pipe schedule                  (size, material, total length)
    4. Device summary                 (heads by K-factor + orientation)
    5. Riser diagram                  (text schematic — vector riser
                                       drawing deferred as Phase F TODO)
    6. Node-by-node results table     (from HydraulicResult.node_trace
                                       or NFPA §5 worksheet)
    7. Hydraulic calculation graph    (demand/supply curve table)
    8. Summary findings + sign-off

The renderer is intentionally defensive: if a section's source data is
missing or malformed, it draws a "DATA UNAVAILABLE" stub rather than
raising, so a partial input still produces a readable document.

Section 5 (riser diagram) is currently a text schematic — a vector
riser drawing is a non-trivial layout problem we flag in the PDF
output itself so the AHJ reviewer is not misled.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


# ── Style helpers ───────────────────────────────────────────────────


def _styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    out: dict[str, ParagraphStyle] = {
        "title": ParagraphStyle(
            "HfTitle", parent=base["Title"], fontName="Helvetica-Bold",
            fontSize=22, leading=26, spaceAfter=18,
        ),
        "h1": ParagraphStyle(
            "HfH1", parent=base["Heading1"], fontName="Helvetica-Bold",
            fontSize=14, leading=18, spaceBefore=12, spaceAfter=6,
        ),
        "h2": ParagraphStyle(
            "HfH2", parent=base["Heading2"], fontName="Helvetica-Bold",
            fontSize=11, leading=14, spaceBefore=8, spaceAfter=4,
        ),
        "body": ParagraphStyle(
            "HfBody", parent=base["BodyText"], fontName="Helvetica",
            fontSize=10, leading=13,
        ),
        "mono": ParagraphStyle(
            "HfMono", parent=base["BodyText"], fontName="Courier",
            fontSize=9, leading=11,
        ),
        "todo": ParagraphStyle(
            "HfTodo", parent=base["BodyText"], fontName="Helvetica-Oblique",
            fontSize=9, leading=11, textColor=colors.HexColor("#a14300"),
        ),
    }
    return out


_TABLE_STYLE = TableStyle([
    ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 9),
    ("FONT", (0, 1), (-1, -1), "Helvetica", 9),
    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#222222")),
    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
    ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#666666")),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("LEFTPADDING", (0, 0), (-1, -1), 4),
    ("RIGHTPADDING", (0, 0), (-1, -1), 4),
])


def _table(header: list[str], rows: list[list[Any]],
           col_widths: list[float] | None = None) -> Table:
    data: list[list[Any]] = [header]
    for r in rows:
        data.append([str(c) if c is not None else "—" for c in r])
    if not rows:
        data.append(["(no data)"] + [""] * (len(header) - 1))
    t = Table(data, colWidths=col_widths, repeatRows=1)
    t.setStyle(_TABLE_STYLE)
    return t


# ── Section builders ────────────────────────────────────────────────


def _section_cover(
    story: list, styles: dict, report: dict, project_id: str,
) -> None:
    story.append(Paragraph("Hydraulic Calculation Report", styles["title"]))
    density_area = report.get("section_1_design_density_area", {}) or {}
    occupancy = density_area.get("occupancy_class", "—")
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    rows = [
        ["Project ID", project_id],
        ["Report date (UTC)", today],
        ["Occupancy class", occupancy],
        ["Design density (gpm/sqft)", density_area.get("design_density_gpm_per_sqft", "—")],
        ["Design area (sqft)", density_area.get("design_area_sqft", "—")],
        ["Hose allowance (gpm)", density_area.get("hose_allowance_gpm", "—")],
        ["Format", report.get("format", "NFPA 13 §27")],
        ["Report version", report.get("version", 1)],
    ]
    story.append(_table(["Field", "Value"], rows, col_widths=[2.2 * inch, 3.8 * inch]))
    story.append(Spacer(1, 0.3 * inch))
    story.append(Paragraph(
        "This report is auto-generated by Halofire Studio and reflects the "
        "current <b>design.json</b> state. The density, area, and hose allowance "
        "above feed the Hazen-Williams worksheet in §5.",
        styles["body"],
    ))
    story.append(PageBreak())


def _section_density_curve(
    story: list, styles: dict, report: dict,
) -> None:
    story.append(Paragraph("2. Density / Area Curve", styles["h1"]))
    hydraulic = report.get("section_5_hydraulic_worksheet", {}) or {}
    da = report.get("section_1_design_density_area", {}) or {}
    rows = [
        ["Design density (gpm/sqft)", da.get("design_density_gpm_per_sqft", "—")],
        ["Design area (sqft)", da.get("design_area_sqft", "—")],
        ["Demand flow (gpm)", hydraulic.get("demand_gpm", "—")],
        ["Required pressure (psi)", hydraulic.get("required_pressure_psi", "—")],
        ["Available static (psi)", hydraulic.get("available_static_psi", "—")],
        ["Safety margin (psi)", hydraulic.get("safety_margin_psi", "—")],
        ["Result", hydraulic.get("result", "—")],
    ]
    story.append(_table(["Parameter", "Value"], rows,
                        col_widths=[3.0 * inch, 3.0 * inch]))
    story.append(Spacer(1, 0.2 * inch))


def _section_pipe_schedule(
    story: list, styles: dict, report: dict,
) -> None:
    story.append(Paragraph("3. Pipe Schedule", styles["h1"]))
    sched = report.get("section_2_pipe_schedule", []) or []
    header = [
        "Size (in)", "Schedule", "Material C", "ID (in)",
        "Length (ft)", "Length (m)",
    ]
    rows = [
        [
            r.get("size_in"),
            r.get("schedule"),
            r.get("hazen_williams_c"),
            r.get("internal_dia_in"),
            r.get("length_ft"),
            r.get("length_m"),
        ]
        for r in sched
    ]
    story.append(_table(header, rows))
    story.append(Spacer(1, 0.2 * inch))


def _section_device_summary(
    story: list, styles: dict, report: dict,
) -> None:
    story.append(Paragraph("4. Device Summary", styles["h1"]))
    dev = report.get("section_3_device_summary", {}) or {}
    heads = (dev.get("sprinkler_heads") or {})
    total = heads.get("total", 0)
    by_orient = heads.get("by_orientation", {}) or {}
    rows = [["Sprinkler heads (total)", total]]
    for orient, count in by_orient.items():
        rows.append([f"  by orientation: {orient}", count])
    rows.append(["FDC count", dev.get("fdc", 0)])
    rows.append(["Pressure gauges", dev.get("pressure_gauges", 0)])
    rows.append(["Flow switches", dev.get("flow_switches", 0)])
    story.append(_table(["Device", "Count"], rows,
                        col_widths=[3.5 * inch, 2.5 * inch]))
    story.append(Spacer(1, 0.2 * inch))


def _section_riser_diagram(
    story: list, styles: dict, report: dict,
) -> None:
    story.append(Paragraph("5. Riser Diagram (text schematic)", styles["h1"]))
    risers = (report.get("section_4_riser_diagram") or {}).get("risers", [])
    if not risers:
        story.append(Paragraph("No risers recorded.", styles["body"]))
    else:
        for r in risers:
            story.append(Paragraph(
                f"System <b>{r.get('system_id', '—')}</b> "
                f"({r.get('system_type', '—')})",
                styles["h2"],
            ))
            ascii_art = [
                "       ╔═════════════╗",
                f"       ║  RISER {str(r.get('riser_id', '?'))[:8]:<8}  ║",
                f"       ║  {str(r.get('riser_size_in', '?')):>4} in        ║",
                "       ╚══════╤══════╝",
                "              │",
                "      ────────┴────────  (cross main)",
                "        │     │     │",
                "       [H]   [H]   [H]   (heads on branches)",
            ]
            story.append(Paragraph(
                "<br/>".join(ascii_art), styles["mono"],
            ))
            supplies = r.get("supplies_levels") or []
            story.append(Paragraph(
                f"Supplies levels: {', '.join(supplies) if supplies else '—'}",
                styles["body"],
            ))
            story.append(Spacer(1, 0.1 * inch))
    story.append(Paragraph(
        "TODO (Phase F): replace text schematic with a true vector riser "
        "P&amp;ID drawing (valve symbols, elevation ticks, gauge callouts).",
        styles["todo"],
    ))
    story.append(Spacer(1, 0.2 * inch))


def _section_node_table(
    story: list, styles: dict, report: dict,
) -> None:
    story.append(Paragraph("6. Node-by-node Results", styles["h1"]))
    node_trace = _collect_node_trace(report)
    if not node_trace:
        story.append(Paragraph(
            "Node-by-node trace is unavailable for this report. Run "
            "<b>POST /projects/:id/calculate</b> first to populate the "
            "per-segment Hazen-Williams losses.",
            styles["body"],
        ))
        return
    header = [
        "Segment", "From", "To", "Size (in)", "Flow (gpm)",
        "Length (ft)", "Friction ΔP (psi)",
    ]
    rows: list[list[Any]] = []
    for seg in node_trace[:120]:  # cap for readability
        rows.append([
            str(seg.get("segment_id", "—"))[:18],
            str(seg.get("from_node", "—"))[:12],
            str(seg.get("to_node", "—"))[:12],
            seg.get("size_in"),
            seg.get("flow_gpm"),
            seg.get("length_ft"),
            seg.get("friction_loss_psi"),
        ])
    story.append(_table(header, rows))
    if len(node_trace) > 120:
        story.append(Paragraph(
            f"(table truncated — {len(node_trace) - 120} additional segments "
            f"omitted; full trace lives in the JSON report.)",
            styles["body"],
        ))
    story.append(Spacer(1, 0.2 * inch))


def _section_curve_graph(
    story: list, styles: dict, report: dict,
) -> None:
    story.append(Paragraph("7. Hydraulic Calculation Graph", styles["h1"]))
    curve = report.get("section_6_demand_curve", []) or []
    header = ["Pressure (psi)", "Flow (gpm)", "Note"]
    rows = [[p.get("pressure_psi"), p.get("flow_gpm"), p.get("marker", "")]
            for p in curve]
    story.append(_table(header, rows,
                        col_widths=[1.6 * inch, 1.6 * inch, 2.8 * inch]))
    story.append(Paragraph(
        "Flow/pressure points plotted on the AHJ N<sup>1.85</sup> log-log "
        "curve — AutoSPRINK exports an SVG plot here; this release ships "
        "the tabular form pending the chart renderer (Phase F TODO).",
        styles["todo"],
    ))
    story.append(Spacer(1, 0.2 * inch))


def _section_summary_signoff(
    story: list, styles: dict, report: dict,
) -> None:
    story.append(Paragraph("8. Summary & Sign-off", styles["h1"]))
    hydraulic = report.get("section_5_hydraulic_worksheet", {}) or {}
    test_data = report.get("section_8_test_data", {}) or {}
    summary_rows = [
        ["Result", hydraulic.get("result", "—")],
        ["Demand (gpm)", hydraulic.get("demand_gpm", "—")],
        ["Required pressure (psi)", hydraulic.get("required_pressure_psi", "—")],
        ["Safety margin (psi)", hydraulic.get("safety_margin_psi", "—")],
        ["Hydrostatic test (psi)", test_data.get("hydrostatic_test_psi", "—")],
        [
            "Hydrostatic test duration (hr)",
            test_data.get("hydrostatic_test_duration_hr", "—"),
        ],
        ["Air test required", test_data.get("air_test_required", "—")],
        ["Antifreeze required", test_data.get("antifreeze_required", "—")],
    ]
    story.append(_table(["Field", "Value"], summary_rows,
                        col_widths=[3.0 * inch, 3.0 * inch]))
    story.append(Spacer(1, 0.4 * inch))
    story.append(Paragraph("Designer sign-off", styles["h2"]))
    story.append(_table(
        ["Role", "Name", "Date", "Signature"],
        [
            ["Designer", "", "", ""],
            ["P.E. (if required)", "", "", ""],
            ["AHJ reviewer", "", "", ""],
        ],
        col_widths=[1.5 * inch, 1.8 * inch, 1.2 * inch, 1.5 * inch],
    ))


# ── Node-trace collectors ───────────────────────────────────────────


def _collect_node_trace(report: dict) -> list[dict]:
    """Pick node_trace from whichever shape the report carries.

    The report JSON has had three shapes during dev — we accept all.
    """
    # 1. Direct top-level list (some older builds).
    if isinstance(report.get("node_trace"), list):
        return list(report["node_trace"])
    # 2. calculation/systems/*/hydraulic/node_trace (the /calculate path).
    calc = report.get("calculation") or {}
    systems = calc.get("systems") or []
    out: list[dict] = []
    for sys in systems:
        hy = (sys or {}).get("hydraulic") or {}
        nt = hy.get("node_trace") or []
        out.extend(nt)
    if out:
        return out
    # 3. section_5 synthetic worksheet — no per-node trace there.
    return []


# ── Entrypoint ───────────────────────────────────────────────────────


def render_hydraulic_report_pdf(
    json_path: Path | str, pdf_path: Path | str,
    project_id: str | None = None,
) -> Path:
    """Render ``json_path`` → ``pdf_path``. Returns the PDF path.

    ``json_path`` may be:
      - An NFPA 8-section dict (``section_1_...`` keys), or
      - A gateway /calculate dict (``{"project_id": ..., "calculation":
        {"systems": [...]}})``.

    We try to read whichever fields are present; missing sections
    render a "DATA UNAVAILABLE" stub rather than raising.
    """
    json_path = Path(json_path)
    pdf_path = Path(pdf_path)
    pdf_path.parent.mkdir(parents=True, exist_ok=True)

    raw = json.loads(json_path.read_text(encoding="utf-8"))
    # Fold /calculate-shape into 8-section-shape (only a few fields
    # survive the translation — the cover + node table are the honest
    # deliverable in that case).
    if "section_1_design_density_area" not in raw:
        raw = _promote_calculation_report(raw)

    if project_id is None:
        project_id = raw.get("project_id") or json_path.parent.parent.name

    styles = _styles()
    doc = SimpleDocTemplate(
        str(pdf_path), pagesize=letter,
        leftMargin=0.6 * inch, rightMargin=0.6 * inch,
        topMargin=0.6 * inch, bottomMargin=0.6 * inch,
        title=f"Hydraulic Report — {project_id}",
        author="Halofire Studio",
    )
    story: list = []
    _section_cover(story, styles, raw, project_id)
    _section_density_curve(story, styles, raw)
    _section_pipe_schedule(story, styles, raw)
    _section_device_summary(story, styles, raw)
    _section_riser_diagram(story, styles, raw)
    _section_node_table(story, styles, raw)
    _section_curve_graph(story, styles, raw)
    _section_summary_signoff(story, styles, raw)

    doc.build(story)
    return pdf_path


def _promote_calculation_report(raw: dict) -> dict:
    """Translate a /calculate-shape dict to the 8-section shape.

    We can only fill what's actually present: cover + node-trace table.
    The other sections render their "no data" placeholder.
    """
    promoted = dict(raw)  # shallow copy; keep calculation for _collect_node_trace
    # Minimal cover sheet info from what /calculate stores.
    promoted.setdefault("section_1_design_density_area", {
        "occupancy_class": "—",
        "design_density_gpm_per_sqft": "—",
        "design_area_sqft": "—",
        "hose_allowance_gpm": "—",
    })
    # Pull any hydraulic summaries we can infer from the systems.
    systems = (raw.get("calculation") or {}).get("systems") or []
    if systems:
        first = (systems[0] or {}).get("hydraulic") or {}
        promoted.setdefault("section_5_hydraulic_worksheet", {
            "method": "Hazen-Williams (gateway /calculate)",
            "demand_gpm": first.get("required_flow_gpm", "—"),
            "required_pressure_psi": first.get("required_pressure_psi", "—"),
            "available_static_psi": first.get("supply_static_psi", "—"),
            "safety_margin_psi": first.get("safety_margin_psi", "—"),
            "result": (
                "PASS" if (first.get("safety_margin_psi") or 0) > 0 else "FAIL"
            ),
        })
    promoted.setdefault("format", "gateway /calculate (promoted)")
    promoted.setdefault("version", 0)
    return promoted

"""Submittal sheet set — the permit-review PDF Halo delivers to the AHJ.

Layout follows the AutoSprink convention:
  FP-0   Cover sheet
  FP-H   Hydraulic data placard (one page, NFPA summary)
  FP-N.i Per-level plan (one sheet per building level)
  FP-R   Riser detail
  FP-B   Bill of materials
  FP-D   Details (cut-sheet index / notes)

Emits a single multi-page PDF at <deliverables>/submittal.pdf. Uses
reportlab so the VPS doesn't need a headless Chromium or LibreOffice.
Falls back to a plain-text stub when reportlab isn't installed so
the pipeline never silently loses a deliverable.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

try:
    from reportlab.lib.pagesizes import LETTER, landscape
    from reportlab.lib.units import inch
    from reportlab.pdfgen import canvas as pdfcanvas
    from reportlab.lib import colors
    _REPORTLAB = True
except ImportError:  # pragma: no cover
    _REPORTLAB = False


BRAND_RED = "#c8322a"


def _fmt_usd(x: Any) -> str:
    try:
        return f"${float(x):,.2f}"
    except (TypeError, ValueError):
        return "$0.00"


def _fmt_n(x: Any) -> str:
    try:
        return f"{int(x):,}"
    except (TypeError, ValueError):
        return "—"


def _draw_header(c, sheet_id: str, title: str, project: dict[str, Any]) -> None:
    w, h = landscape(LETTER)
    # Sheet border
    c.setStrokeColor(colors.black)
    c.setLineWidth(1.4)
    c.rect(0.5 * inch, 0.5 * inch, w - 1.0 * inch, h - 1.0 * inch)
    # Title block right
    c.setFont("Helvetica-Bold", 18)
    c.drawRightString(w - 0.8 * inch, h - 0.85 * inch, sheet_id)
    c.setFont("Helvetica", 10)
    c.drawRightString(w - 0.8 * inch, h - 1.05 * inch, title)
    c.drawRightString(w - 0.8 * inch, h - 1.20 * inch,
                      project.get("name", ""))
    c.drawRightString(w - 0.8 * inch, h - 1.35 * inch,
                      project.get("address", ""))
    # Halo brand left
    c.setFont("Helvetica-Bold", 16)
    c.setFillColor(colors.HexColor(BRAND_RED))
    c.drawString(0.8 * inch, h - 0.85 * inch, "HALO FIRE PROTECTION")
    c.setFillColor(colors.black)
    c.setFont("Helvetica", 9)
    c.drawString(0.8 * inch, h - 1.05 * inch,
                 "Fire Sprinkler Design & Installation")


def _draw_fp0_cover(c, data: dict) -> None:
    project = data.get("project") or {}
    pricing = data.get("pricing") or {}
    w, h = landscape(LETTER)
    _draw_header(c, "FP-0", "Cover sheet", project)
    c.setFont("Helvetica-Bold", 24)
    c.drawCentredString(w / 2, h / 2 + 0.8 * inch,
                        project.get("name", "Project"))
    c.setFont("Helvetica", 12)
    c.drawCentredString(w / 2, h / 2 + 0.3 * inch,
                        project.get("address", ""))
    c.setFont("Helvetica-Bold", 14)
    c.setFillColor(colors.HexColor(BRAND_RED))
    c.drawCentredString(w / 2, h / 2 - 0.5 * inch,
                        f"Bid total: {_fmt_usd(pricing.get('total_usd', 0))}")
    c.setFillColor(colors.black)
    c.setFont("Helvetica", 9)
    c.drawCentredString(w / 2, h / 2 - 1.0 * inch,
                        f"Generated: {data.get('generated_at', '')}")
    # Sheet index
    c.setFont("Helvetica-Bold", 11)
    c.drawString(1.0 * inch, 1.5 * inch, "Sheet index")
    c.setFont("Helvetica", 10)
    levels = data.get("levels") or []
    rows = [
        ("FP-0", "Cover sheet"),
        ("FP-H", "Hydraulic data placard"),
    ]
    for i, lvl in enumerate(levels, 1):
        rows.append((f"FP-N.{i}", f"{lvl.get('name', lvl.get('id', ''))} plan"))
    rows += [
        ("FP-R", "Riser detail"),
        ("FP-B", "Bill of materials"),
        ("FP-D", "Details + cut-sheet index"),
    ]
    y = 1.3 * inch
    for sid, title in rows:
        y -= 0.2 * inch
        if y < 0.7 * inch:
            break
        c.drawString(1.2 * inch, y, sid)
        c.drawString(2.0 * inch, y, title)


def _draw_fph_placard(c, data: dict) -> None:
    project = data.get("project") or {}
    systems = data.get("systems") or []
    _draw_header(c, "FP-H", "Hydraulic data placard", project)
    w, h = landscape(LETTER)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(1.0 * inch, h - 1.9 * inch, "Hydraulic summary")
    c.setFont("Helvetica", 9)
    y = h - 2.2 * inch
    c.drawString(1.0 * inch, y, "System")
    c.drawString(2.4 * inch, y, "Type")
    c.drawString(3.3 * inch, y, "Heads")
    c.drawString(4.1 * inch, y, "Flow (gpm)")
    c.drawString(5.2 * inch, y, "Pressure (psi)")
    c.drawString(6.5 * inch, y, "Margin (psi)")
    y -= 0.05 * inch
    c.setLineWidth(0.4)
    c.line(1.0 * inch, y, w - 1.0 * inch, y)
    y -= 0.2 * inch
    for s in systems:
        hy = s.get("hydraulic") or {}
        c.drawString(1.0 * inch, y, str(s.get("id", ""))[:18])
        c.drawString(2.4 * inch, y, str(s.get("type", "")))
        c.drawString(3.3 * inch, y, _fmt_n(s.get("head_count", 0)))
        c.drawString(4.1 * inch, y, str(hy.get("required_flow_gpm", "—")))
        c.drawString(5.2 * inch, y, str(hy.get("required_pressure_psi", "—")))
        margin = hy.get("safety_margin_psi")
        c.drawString(6.5 * inch, y, str(margin) if margin is not None else "—")
        y -= 0.22 * inch
        if y < 1.0 * inch:
            break


def _draw_level_plan(c, data: dict, level: dict, idx: int) -> None:
    project = data.get("project") or {}
    sheet_id = f"FP-N.{idx}"
    title = f"{level.get('name', level.get('id', ''))} — plan"
    _draw_header(c, sheet_id, title, project)
    w, h = landscape(LETTER)
    # Stats block
    c.setFont("Helvetica", 9)
    stats = (
        f"elev {level.get('elevation_ft', 0)} ft · "
        f"{_fmt_n(level.get('head_count', 0))} heads · "
        f"{level.get('pipe_total_ft', 0)} ft pipe · "
        f"{_fmt_n(level.get('room_count', 0))} rooms"
    )
    c.drawString(1.0 * inch, h - 1.9 * inch, stats)
    # Placeholder plan area box (actual SVG/raster embed = later tick)
    c.setLineWidth(0.7)
    c.setStrokeColor(colors.grey)
    c.rect(
        1.0 * inch, 1.0 * inch,
        w - 2.0 * inch, h - 3.2 * inch,
    )
    c.setFont("Helvetica", 8)
    c.setFillColor(colors.grey)
    c.drawCentredString(
        w / 2, h / 2 - 0.3 * inch,
        "(plan area — inline SVG overlay ships in next tick; "
        "proposal.html already embeds the SVG per level)",
    )
    c.setFillColor(colors.black)


def _draw_fpr_riser(c, data: dict) -> None:
    project = data.get("project") or {}
    systems = data.get("systems") or []
    _draw_header(c, "FP-R", "Riser detail", project)
    w, h = landscape(LETTER)
    c.setFont("Helvetica", 9)
    y = h - 1.9 * inch
    for s in systems:
        c.setFont("Helvetica-Bold", 10)
        c.drawString(1.0 * inch, y, f"{s.get('id', '')} · {s.get('type', '')} riser")
        y -= 0.2 * inch
        c.setFont("Helvetica", 9)
        c.drawString(1.2 * inch, y,
                     f"riser size: {s.get('riser_size_in', '—')}\"  ·  "
                     f"FDC: {s.get('fdc_type', '—')}")
        y -= 0.2 * inch
        hy = s.get("hydraulic") or {}
        supply = (
            f"supply static {hy.get('supply_static_psi', '—')} psi · "
            f"residual {hy.get('supply_residual_psi', '—')} psi @ "
            f"{hy.get('required_flow_gpm', '—')} gpm"
        )
        c.drawString(1.2 * inch, y, supply)
        y -= 0.35 * inch
        if y < 1.0 * inch:
            break


def _draw_fpb_bom(c, data: dict) -> None:
    project = data.get("project") or {}
    bom = data.get("bom") or []
    _draw_header(c, "FP-B", "Bill of materials", project)
    w, h = landscape(LETTER)
    c.setFont("Helvetica-Bold", 9)
    y = h - 1.9 * inch
    c.drawString(1.0 * inch, y, "SKU")
    c.drawString(3.0 * inch, y, "Qty")
    c.drawString(3.7 * inch, y, "Unit")
    c.drawString(4.4 * inch, y, "Unit $")
    c.drawString(5.4 * inch, y, "Extended")
    c.drawString(6.7 * inch, y, "Flags")
    y -= 0.05 * inch
    c.setLineWidth(0.4)
    c.line(1.0 * inch, y, w - 1.0 * inch, y)
    y -= 0.18 * inch
    c.setFont("Helvetica", 8)
    for r in bom:
        if y < 0.9 * inch:
            break
        c.drawString(1.0 * inch, y, str(r.get("sku", ""))[:36])
        c.drawString(3.0 * inch, y, str(r.get("qty", 0)))
        c.drawString(3.7 * inch, y, str(r.get("unit", "")))
        c.drawString(4.4 * inch, y, _fmt_usd(r.get("unit_cost_usd", 0)))
        c.drawString(5.4 * inch, y, _fmt_usd(r.get("extended_usd", 0)))
        flags = []
        if r.get("do_not_fab"):
            flags.append("DNF")
        if r.get("price_stale"):
            flags.append("stale")
        if r.get("price_missing"):
            flags.append("missing")
        c.drawString(6.7 * inch, y, " · ".join(flags))
        y -= 0.18 * inch


def _draw_fpd_details(c, data: dict) -> None:
    project = data.get("project") or {}
    _draw_header(c, "FP-D", "Details + cut-sheet index", project)
    w, h = landscape(LETTER)
    c.setFont("Helvetica", 9)
    y = h - 1.9 * inch
    c.drawString(1.0 * inch, y, "Cut sheets are bundled alongside this submittal.")
    y -= 0.3 * inch
    c.drawString(1.0 * inch, y, "One data sheet per manufacturer SKU used in the BOM.")
    y -= 0.3 * inch
    c.drawString(1.0 * inch, y,
                 "See FP-B for the SKU list; each row maps to a cut-sheet PDF "
                 "in cut_sheets/.")


def write_submittal_pdf(
    data: dict[str, Any], out_dir: Path,
    filename: str = "submittal.pdf",
) -> Path:
    """Emit the six-sheet submittal. Returns the path.

    `data` is the proposal.json payload (same schema proposal.html uses).
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / filename
    if not _REPORTLAB:
        out.write_text(
            "submittal.pdf not generated — reportlab missing.\n"
            "Install: pip install reportlab\n",
            encoding="utf-8",
        )
        return out
    c = pdfcanvas.Canvas(str(out), pagesize=landscape(LETTER))
    _draw_fp0_cover(c, data); c.showPage()
    _draw_fph_placard(c, data); c.showPage()
    for i, lvl in enumerate(data.get("levels") or [], 1):
        _draw_level_plan(c, data, lvl, i); c.showPage()
    _draw_fpr_riser(c, data); c.showPage()
    _draw_fpb_bom(c, data); c.showPage()
    _draw_fpd_details(c, data); c.showPage()
    c.save()
    return out


__all__ = ["write_submittal_pdf"]


if __name__ == "__main__":
    import json
    import sys
    if len(sys.argv) < 2:
        print("usage: python submittal.py <deliverables_dir>")
        sys.exit(2)
    d = Path(sys.argv[1]).resolve()
    data = json.loads((d / "proposal.json").read_text(encoding="utf-8"))
    p = write_submittal_pdf(data, d)
    print(f"wrote {p}")

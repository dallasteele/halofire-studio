"""Prefab drawings + cut list generator.

The fab shop needs, for each system: one drawing showing every
pipe run with its cut length and fittings, plus a flat cut list
of every segment labeled with a fab tag so the shop team can grab
the right piece off the pallet on assembly day.

AutoSprink ships these as "prefab reports." Our output:

  <deliverables>/prefab.pdf       — cover + per-system drawing +
                                    cut-list table, one per system
  <deliverables>/cut_list.csv     — machine-readable fab queue

Pipes < 3" are flagged DO_NOT_FAB on the cut list (already carried
on the BomRow from loop 1 phase 5).
"""
from __future__ import annotations

import csv
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

try:
    from reportlab.lib.pagesizes import LETTER, landscape
    from reportlab.lib.units import inch
    from reportlab.lib import colors
    from reportlab.pdfgen import canvas as pdfcanvas
    _REPORTLAB = True
except ImportError:  # pragma: no cover
    _REPORTLAB = False


BRAND_RED = "#c8322a"
FAB_THRESHOLD_IN = 3.0   # shared with bom agent


@dataclass
class CutRow:
    fab_tag: str                # "SYS-1-P0042"
    system_id: str
    pipe_id: str
    size_in: float
    length_m: float
    length_ft: float
    schedule: str = ""
    do_not_fab: bool = False
    notes: str = ""


@dataclass
class SystemPrefab:
    system_id: str
    rows: list[CutRow] = field(default_factory=list)
    total_length_m: float = 0.0
    total_length_ft: float = 0.0
    fab_count: int = 0
    field_cut_count: int = 0

    def tally(self) -> None:
        self.total_length_m = sum(r.length_m for r in self.rows)
        self.total_length_ft = self.total_length_m * 3.281
        self.fab_count = sum(1 for r in self.rows if not r.do_not_fab)
        self.field_cut_count = sum(1 for r in self.rows if r.do_not_fab)


def _fab_tag(system_id: str, pipe_id: str, idx: int) -> str:
    # Preserve the pipe id when it looks stable ("p0042"); else
    # derive from index.
    suffix = pipe_id if pipe_id and len(pipe_id) < 16 else f"P{idx:04d}"
    return f"{system_id}-{suffix}".upper()


def build_prefab(
    systems: Iterable[dict[str, Any]],
) -> list[SystemPrefab]:
    """Transform design.systems[*].pipes into CutRow lists."""
    out: list[SystemPrefab] = []
    for s in systems:
        sid = str(s.get("id") or "SYS")
        pf = SystemPrefab(system_id=sid)
        pipes = s.get("pipes") or []
        for idx, p in enumerate(pipes):
            size = float(p.get("size_in") or 0)
            length_m = float(p.get("length_m") or 0)
            row = CutRow(
                fab_tag=_fab_tag(sid, str(p.get("id") or ""), idx),
                system_id=sid,
                pipe_id=str(p.get("id") or ""),
                size_in=size,
                length_m=round(length_m, 3),
                length_ft=round(length_m * 3.281, 2),
                schedule=str(p.get("schedule") or ""),
                do_not_fab=size < FAB_THRESHOLD_IN,
            )
            pf.rows.append(row)
        pf.tally()
        out.append(pf)
    return out


def write_cut_list_csv(
    prefabs: list[SystemPrefab], out: Path,
) -> Path:
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow([
            "fab_tag", "system_id", "pipe_id", "size_in", "schedule",
            "length_m", "length_ft", "do_not_fab", "notes",
        ])
        for pf in prefabs:
            for r in pf.rows:
                w.writerow([
                    r.fab_tag, r.system_id, r.pipe_id,
                    f"{r.size_in:g}", r.schedule,
                    f"{r.length_m:.3f}", f"{r.length_ft:.2f}",
                    "Y" if r.do_not_fab else "N", r.notes,
                ])
    return out


def _draw_cover(c, project: dict[str, Any], total_m: float,
                fab_count: int, field_cut_count: int) -> None:
    w, h = landscape(LETTER)
    c.rect(0.5 * inch, 0.5 * inch, w - 1.0 * inch, h - 1.0 * inch)
    c.setFillColor(colors.HexColor(BRAND_RED))
    c.setFont("Helvetica-Bold", 16)
    c.drawString(0.8 * inch, h - 0.9 * inch, "HALO FIRE PROTECTION — Prefab report")
    c.setFillColor(colors.black)
    c.setFont("Helvetica", 10)
    c.drawString(0.8 * inch, h - 1.1 * inch,
                 str(project.get("name", "Project")))
    c.drawString(0.8 * inch, h - 1.3 * inch,
                 str(project.get("address", "")))
    c.setFont("Helvetica-Bold", 14)
    c.drawString(0.8 * inch, h - 2.0 * inch,
                 f"Total pipe: {total_m * 3.281:.0f} ft "
                 f"({total_m:.1f} m)")
    c.setFont("Helvetica", 10)
    c.drawString(0.8 * inch, h - 2.3 * inch,
                 f"Fab segments: {fab_count}   ·   "
                 f"Field-cut (<3\"): {field_cut_count}")


def _draw_system_sheet(c, pf: SystemPrefab) -> None:
    w, h = landscape(LETTER)
    c.rect(0.5 * inch, 0.5 * inch, w - 1.0 * inch, h - 1.0 * inch)
    c.setFillColor(colors.HexColor(BRAND_RED))
    c.setFont("Helvetica-Bold", 14)
    c.drawString(0.8 * inch, h - 0.9 * inch,
                 f"Prefab — {pf.system_id}")
    c.setFillColor(colors.black)
    c.setFont("Helvetica", 9)
    c.drawString(0.8 * inch, h - 1.1 * inch,
                 f"{pf.total_length_ft:.0f} ft total · "
                 f"{pf.fab_count} fab · {pf.field_cut_count} field-cut")
    # Table
    c.setFont("Helvetica-Bold", 9)
    y = h - 1.5 * inch
    cols = [
        ("Fab tag", 0.8),
        ("Pipe id", 2.6),
        ("Size", 3.6),
        ("Sched", 4.2),
        ("Length (ft)", 4.9),
        ("Length (m)", 5.9),
        ("Flags", 6.9),
    ]
    for label, x in cols:
        c.drawString(x * inch, y, label)
    y -= 0.05 * inch
    c.setLineWidth(0.4)
    c.line(0.8 * inch, y, w - 0.8 * inch, y)
    y -= 0.18 * inch
    c.setFont("Helvetica", 8)
    for r in pf.rows:
        if y < 0.9 * inch:
            c.showPage()
            c.rect(0.5 * inch, 0.5 * inch, w - 1.0 * inch, h - 1.0 * inch)
            c.setFont("Helvetica-Bold", 14)
            c.setFillColor(colors.HexColor(BRAND_RED))
            c.drawString(0.8 * inch, h - 0.9 * inch,
                         f"Prefab — {pf.system_id} (cont.)")
            c.setFillColor(colors.black)
            c.setFont("Helvetica", 8)
            y = h - 1.3 * inch
        c.drawString(0.8 * inch, y, r.fab_tag[:28])
        c.drawString(2.6 * inch, y, r.pipe_id[:14])
        c.drawString(3.6 * inch, y, f"{r.size_in:g}\"")
        c.drawString(4.2 * inch, y, r.schedule[:8])
        c.drawString(4.9 * inch, y, f"{r.length_ft:.2f}")
        c.drawString(5.9 * inch, y, f"{r.length_m:.3f}")
        c.drawString(6.9 * inch, y, "DNF" if r.do_not_fab else "FAB")
        y -= 0.18 * inch


def write_prefab_pdf(
    data: dict[str, Any], out_dir: Path,
    filename: str = "prefab.pdf",
) -> dict[str, Any]:
    """Emit prefab.pdf + cut_list.csv. Returns paths + counts."""
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    pdf_path = out_dir / filename
    csv_path = out_dir / "cut_list.csv"
    systems = data.get("systems") or data.get("design_systems") or []
    prefabs = build_prefab(systems)
    write_cut_list_csv(prefabs, csv_path)

    total_m = sum(pf.total_length_m for pf in prefabs)
    fab_count = sum(pf.fab_count for pf in prefabs)
    field_count = sum(pf.field_cut_count for pf in prefabs)

    if not _REPORTLAB:
        pdf_path.write_text(
            "prefab.pdf not generated — reportlab missing\n",
            encoding="utf-8",
        )
    else:
        project = data.get("project") or {}
        c = pdfcanvas.Canvas(str(pdf_path), pagesize=landscape(LETTER))
        _draw_cover(c, project, total_m, fab_count, field_count)
        c.showPage()
        for pf in prefabs:
            _draw_system_sheet(c, pf)
            c.showPage()
        c.save()

    return {
        "pdf": str(pdf_path),
        "csv": str(csv_path),
        "system_count": len(prefabs),
        "segment_count": sum(len(pf.rows) for pf in prefabs),
        "fab_count": fab_count,
        "field_cut_count": field_count,
        "total_length_ft": round(total_m * 3.281, 1),
    }


__all__ = [
    "CutRow", "SystemPrefab",
    "build_prefab", "write_cut_list_csv", "write_prefab_pdf",
    "FAB_THRESHOLD_IN",
]


if __name__ == "__main__":
    import json
    import sys
    if len(sys.argv) < 2:
        print("usage: python prefab.py <deliverables_dir>")
        sys.exit(2)
    d = Path(sys.argv[1]).resolve()
    design_path = d / "design.json"
    proposal_path = d / "proposal.json"
    data: dict[str, Any] = {}
    if design_path.exists():
        data.update(json.loads(design_path.read_text(encoding="utf-8")))
    if proposal_path.exists():
        data.update({
            "project": json.loads(proposal_path.read_text(encoding="utf-8"))
                .get("project", {}),
        })
    res = write_prefab_pdf(data, d)
    print(json.dumps(res, indent=2))

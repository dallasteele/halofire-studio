"""Cut-sheet PDF bundle generator.

Every SKU in a bid has a manufacturer data sheet — dimensions,
K-factor, listings, installation notes, trim kits, friction loss
tables. The AHJ reviewer expects them attached to the submittal
package. This module:

  1. Scans `bom` for every SKU.
  2. Resolves each SKU → cut-sheet PDF path using a lookup chain:
     - `<project>/deliverables/cut_sheets/<sku>.pdf` (bid-specific)
     - `<halofire-studio>/cut_sheets_library/<sku>.pdf` (shared)
     - auto-generated stub (reportlab) when no real sheet exists
  3. Concatenates them into a single `cut_sheets.pdf` bundle via
     pypdf (falls back to producing a per-SKU index PDF when pypdf
     is missing so the deliverable is never empty).

The stub sheet is a one-pager with the SKU metadata we DO know
(name, manufacturer, model, dims, k_factor, connection, finish).
Halo can swap it for the real manufacturer PDF by dropping the file
into cut_sheets_library/ before regeneration.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Iterable

try:
    from reportlab.lib.pagesizes import LETTER
    from reportlab.lib.units import inch
    from reportlab.lib import colors
    from reportlab.pdfgen import canvas as pdfcanvas
    _REPORTLAB = True
except ImportError:  # pragma: no cover
    _REPORTLAB = False

try:
    from pypdf import PdfReader, PdfWriter
    _PYPDF = True
except ImportError:  # pragma: no cover
    _PYPDF = False


BRAND_RED = "#c8322a"


def _stub_sheet(
    out: Path, sku: str, row: dict[str, Any] | None,
    parts: dict[str, Any] | None = None,
) -> Path:
    """Render a one-page placeholder cut sheet for `sku`.

    Pulls any metadata we have from the BOM row (`row`) and the
    pricing-DB row (`parts`); when nothing is known, the sheet
    still emits with just the SKU + a 'stub' banner.
    """
    out.parent.mkdir(parents=True, exist_ok=True)
    if not _REPORTLAB:
        out.write_text(
            f"cut sheet stub for {sku} — reportlab not installed\n",
            encoding="utf-8",
        )
        return out
    c = pdfcanvas.Canvas(str(out), pagesize=LETTER)
    w, h = LETTER
    # Title block
    c.setLineWidth(1.2)
    c.rect(0.5 * inch, 0.5 * inch, w - 1.0 * inch, h - 1.0 * inch)
    c.setFillColor(colors.HexColor(BRAND_RED))
    c.setFont("Helvetica-Bold", 18)
    c.drawString(0.8 * inch, h - 1.0 * inch, "HALO FIRE PROTECTION")
    c.setFillColor(colors.black)
    c.setFont("Helvetica", 9)
    c.drawString(0.8 * inch, h - 1.2 * inch, "Cut sheet (stub)")
    # SKU
    c.setFont("Helvetica-Bold", 16)
    c.drawString(0.8 * inch, h - 1.8 * inch, sku)
    c.setFont("Helvetica", 10)

    # Body — metadata key/value table
    data: list[tuple[str, str]] = []
    if row:
        if row.get("description"):
            data.append(("Description", str(row["description"])))
        data.append(("Qty", f"{row.get('qty', 0)} {row.get('unit', '')}"))
        if row.get("unit_cost_usd"):
            data.append(("List price", f"${row['unit_cost_usd']:.2f}"))
    if parts:
        for k in (
            "name", "category", "manufacturer", "model",
            "pipe_size_in", "k_factor", "temp_rating_f",
            "response", "connection", "finish", "notes",
        ):
            if parts.get(k) not in (None, ""):
                data.append((k.replace("_", " ").title(), str(parts[k])))

    y = h - 2.4 * inch
    for label, value in data:
        c.setFont("Helvetica-Bold", 9)
        c.drawString(0.8 * inch, y, label)
        c.setFont("Helvetica", 9)
        c.drawString(2.5 * inch, y, value[:80])
        y -= 0.22 * inch
        if y < 1.5 * inch:
            break

    # Footer banner — make it obvious this is a stub
    c.setFillColor(colors.HexColor("#555555"))
    c.setFont("Helvetica-Oblique", 8)
    c.drawString(
        0.8 * inch, 0.75 * inch,
        "Stub — replace with manufacturer data sheet in cut_sheets_library/",
    )
    c.setFillColor(colors.black)
    c.save()
    return out


def resolve_cut_sheet(
    sku: str, project_dir: Path, shared_library: Path | None = None,
) -> Path | None:
    """Look for a real cut-sheet PDF for `sku`. Returns first match
    or None."""
    # 1) per-project overrides
    candidate = project_dir / "cut_sheets" / f"{sku}.pdf"
    if candidate.exists() and candidate.stat().st_size > 0:
        return candidate
    # 2) shared library
    if shared_library is not None:
        candidate = shared_library / f"{sku}.pdf"
        if candidate.exists() and candidate.stat().st_size > 0:
            return candidate
    return None


def _dedup_skus(bom: Iterable[dict[str, Any]]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for r in bom:
        sku = str(r.get("sku") or "").strip()
        if not sku or sku in seen:
            continue
        seen.add(sku)
        out.append(sku)
    return out


def _index_page(c, skus: list[str], bom_by_sku: dict[str, dict[str, Any]]) -> None:
    w, h = LETTER
    c.setLineWidth(1.2)
    c.rect(0.5 * inch, 0.5 * inch, w - 1.0 * inch, h - 1.0 * inch)
    c.setFillColor(colors.HexColor(BRAND_RED))
    c.setFont("Helvetica-Bold", 16)
    c.drawString(0.8 * inch, h - 1.0 * inch, "HALO FIRE PROTECTION — Cut-sheet index")
    c.setFillColor(colors.black)
    c.setFont("Helvetica", 9)
    y = h - 1.5 * inch
    for sku in skus:
        if y < 1.0 * inch:
            c.showPage(); y = h - 1.0 * inch
        c.drawString(0.8 * inch, y, sku)
        desc = (bom_by_sku.get(sku) or {}).get("description", "")
        c.drawString(3.5 * inch, y, str(desc)[:60])
        y -= 0.22 * inch


def write_cut_sheet_bundle(
    bom: Iterable[dict[str, Any]],
    out_dir: Path,
    *,
    shared_library: Path | None = None,
    parts_by_sku: dict[str, dict[str, Any]] | None = None,
    filename: str = "cut_sheets.pdf",
) -> dict[str, Any]:
    """Produce a single merged `cut_sheets.pdf` covering every SKU
    in `bom`. Returns a dict summary (counts + missing list + path)."""
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / filename
    bom_list = list(bom)
    bom_by_sku = {r["sku"]: r for r in bom_list if r.get("sku")}
    skus = _dedup_skus(bom_list)
    resolved: list[tuple[str, Path]] = []
    stubbed: list[str] = []

    tmp_dir = out_dir / "_cut_sheet_tmp"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    # 1) Index page
    index_pdf = tmp_dir / "_index.pdf"
    if _REPORTLAB:
        c = pdfcanvas.Canvas(str(index_pdf), pagesize=LETTER)
        _index_page(c, skus, bom_by_sku)
        c.showPage()
        c.save()
        resolved.append(("_index", index_pdf))

    # 2) Per-SKU sheets (real or stub)
    for sku in skus:
        real = resolve_cut_sheet(sku, out_dir.parent, shared_library)
        if real:
            resolved.append((sku, real))
            continue
        stub = _stub_sheet(
            tmp_dir / f"{sku}.pdf", sku,
            row=bom_by_sku.get(sku),
            parts=(parts_by_sku or {}).get(sku),
        )
        resolved.append((sku, stub))
        stubbed.append(sku)

    # 3) Merge
    if _PYPDF and _REPORTLAB:
        writer = PdfWriter()
        for _sku, p in resolved:
            try:
                for page in PdfReader(str(p)).pages:
                    writer.add_page(page)
            except Exception:  # noqa: BLE001
                continue
        with out.open("wb") as f:
            writer.write(f)
    else:
        # Fallback: single index-only PDF (still a valid deliverable)
        if _REPORTLAB:
            c = pdfcanvas.Canvas(str(out), pagesize=LETTER)
            _index_page(c, skus, bom_by_sku)
            c.showPage()
            c.save()
        else:
            out.write_text(
                "cut_sheets.pdf not generated — reportlab missing\n",
                encoding="utf-8",
            )

    # Cleanup tmp stubs
    try:
        for p in tmp_dir.glob("*.pdf"):
            p.unlink()
        tmp_dir.rmdir()
    except OSError:
        pass

    return {
        "path": str(out),
        "sku_count": len(skus),
        "real_sheets": len(skus) - len(stubbed),
        "stubbed": stubbed,
        "merger": "pypdf" if (_PYPDF and _REPORTLAB) else "index-only",
    }


__all__ = [
    "resolve_cut_sheet",
    "write_cut_sheet_bundle",
]


if __name__ == "__main__":
    import json as _json
    import sys
    if len(sys.argv) < 2:
        print("usage: python cut_sheets.py <deliverables_dir>")
        sys.exit(2)
    d = Path(sys.argv[1]).resolve()
    data = _json.loads((d / "proposal.json").read_text(encoding="utf-8"))
    res = write_cut_sheet_bundle(
        data.get("bom") or [], d,
        shared_library=d.parent.parent / "cut_sheets_library",
    )
    print(_json.dumps(res, indent=2))

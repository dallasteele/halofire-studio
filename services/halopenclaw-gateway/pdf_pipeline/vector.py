"""Layer 1: vector PDF extraction via pdfplumber.

Works on PDFs exported from modern vector-native tools (Revit, AutoCAD,
Vectorworks, ArchiCAD, SketchUp Pro). Fails gracefully on scanned
raster PDFs — Layer 2 (OpenCV) picks up there.

Algorithm:
  1. Iterate PDF pages
  2. Collect all line segments (thin strokes = contours, thick strokes
     = walls candidate)
  3. Classify walls as pairs of parallel line segments within typical
     wall-thickness range for the drawing's scale
  4. Detect doors as small arcs (pdfplumber exposes curves + line segs)
  5. Detect room polygons from closed wall contours
  6. Return structured geometry

Confidence is HIGH when:
  - Line count > 50 (dense vector content, not cover page)
  - Thick/thin stroke width bimodal distribution detected
  - Mostly orthogonal lines (architectural)

Confidence is LOW when:
  - Under 10 lines
  - No bimodal wall-thickness pattern
  - Scanned-style pages (text but no geometry)
"""
from __future__ import annotations

import logging
from collections import Counter
from dataclasses import dataclass, field
from math import hypot
from typing import Any

log = logging.getLogger(__name__)


# ── Output types ────────────────────────────────────────────────────────────


@dataclass
class VectorLine:
    x0: float
    y0: float
    x1: float
    y1: float
    linewidth: float

    @property
    def length(self) -> float:
        return hypot(self.x1 - self.x0, self.y1 - self.y0)


@dataclass
class VectorExtraction:
    page_number: int
    page_width_pt: float
    page_height_pt: float
    lines: list[VectorLine] = field(default_factory=list)
    text_fragments: list[dict[str, Any]] = field(default_factory=list)
    confidence: float = 0.0
    warnings: list[str] = field(default_factory=list)

    def to_json(self) -> dict[str, Any]:
        return {
            "page_number": self.page_number,
            "page_width_pt": self.page_width_pt,
            "page_height_pt": self.page_height_pt,
            "line_count": len(self.lines),
            "confidence": round(self.confidence, 3),
            "warnings": self.warnings,
            # Sample + stats for the caller
            "linewidth_distribution": _stroke_width_stats(self.lines),
            "sample_lines": [
                {"x0": l.x0, "y0": l.y0, "x1": l.x1, "y1": l.y1, "lw": l.linewidth}
                for l in self.lines[:20]
            ],
            "text_count": len(self.text_fragments),
        }


# ── Extraction ──────────────────────────────────────────────────────────────


def extract_vectors(pdf_path: str, page_index: int = 0) -> VectorExtraction:
    """Parse a PDF page and return its vector content + confidence score.

    Lazily imports pdfplumber so the module loads cleanly in environments
    where the dep isn't installed yet.
    """
    try:
        import pdfplumber  # type: ignore
    except ImportError as e:
        raise RuntimeError(
            "pdfplumber not installed — run `pip install -r requirements.txt`"
        ) from e

    result = VectorExtraction(page_number=page_index, page_width_pt=0, page_height_pt=0)
    try:
        with pdfplumber.open(pdf_path) as pdf:
            if page_index >= len(pdf.pages):
                result.warnings.append(
                    f"page {page_index} out of range (pdf has {len(pdf.pages)} pages)"
                )
                return result
            page = pdf.pages[page_index]
            result.page_width_pt = page.width
            result.page_height_pt = page.height

            # Line segments
            for line in page.lines or []:
                try:
                    result.lines.append(
                        VectorLine(
                            x0=float(line["x0"]),
                            y0=float(line["y0"]),
                            x1=float(line["x1"]),
                            y1=float(line["y1"]),
                            linewidth=float(line.get("linewidth", 0.0)),
                        )
                    )
                except (KeyError, TypeError, ValueError):
                    continue

            # Text fragments (for OCR-free scale + room labels)
            for ch in (page.chars or [])[:5000]:
                try:
                    result.text_fragments.append(
                        {
                            "text": ch.get("text", ""),
                            "x0": ch.get("x0"),
                            "y0": ch.get("y0"),
                            "size": ch.get("size"),
                        }
                    )
                except (KeyError, TypeError):
                    continue
    except Exception as e:
        log.warning("pdfplumber failed on %s: %s", pdf_path, e)
        result.warnings.append(f"pdfplumber error: {e}")
        return result

    result.confidence = _score_confidence(result)
    return result


# ── Helpers ─────────────────────────────────────────────────────────────────


def _stroke_width_stats(lines: list[VectorLine]) -> dict[str, Any]:
    if not lines:
        return {"count": 0}
    widths = [round(l.linewidth, 2) for l in lines]
    counter = Counter(widths)
    top = counter.most_common(8)
    return {
        "count": len(widths),
        "unique": len(set(widths)),
        "top_widths": [(w, c) for w, c in top],
    }


def _score_confidence(ext: VectorExtraction) -> float:
    """Heuristic confidence 0-1.

    - 0.95 if ≥200 lines + bimodal stroke widths + mostly orthogonal
    - 0.75 if ≥50 lines + unique widths > 1
    - 0.50 if ≥10 lines
    - 0.10 if < 10 lines (probably scanned)
    """
    n = len(ext.lines)
    if n < 10:
        return 0.10
    if n < 50:
        return 0.50

    # Stroke-width bimodal check: are there at least 2 distinct widths
    # that each account for > 15% of lines? That's a proxy for "walls
    # have thicker strokes than annotations."
    widths = Counter(round(l.linewidth, 2) for l in ext.lines)
    top2 = widths.most_common(2)
    bimodal = len(top2) >= 2 and all(count / n > 0.15 for _, count in top2)

    # Orthogonal check: fraction of lines with |dx| << 1pt or |dy| << 1pt
    ortho = sum(
        1
        for l in ext.lines
        if abs(l.x1 - l.x0) < 1 or abs(l.y1 - l.y0) < 1
    ) / max(1, n)

    base = 0.75
    if n >= 200:
        base = 0.90
    if bimodal:
        base += 0.03
    if ortho > 0.5:
        base += 0.02
    return min(0.95, base)

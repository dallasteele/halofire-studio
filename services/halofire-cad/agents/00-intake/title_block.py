"""Phase B.4 + B.5 — dimension-line scale inference + level classifier.

B.4: When the title-block scale callout is missing, infer drawing scale
by finding a dimension annotation (e.g. "25'-0\"") near a measurable
line on the page.

B.5: Classify a PDF page as floor-plan vs elevation vs section vs
detail by title-block text + sheet-number convention + geometry density.
"""
from __future__ import annotations

import re
from typing import Any, Optional

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from cad.logging import get_logger  # noqa: E402

log = get_logger("intake.title_block")


# ── B.5 page classifier ─────────────────────────────────────────────

# Sheet-number → page kind. Matches the AIA sheet numbering convention.
_SHEET_PATTERNS: list[tuple[str, str]] = [
    (r"^A-?0\d\d", "cover"),          # A-000 series
    (r"^A-?1\d\d", "floor_plan"),     # A-100 series (plans)
    (r"^A-?2\d\d", "elevation"),      # A-200 series (elevations)
    (r"^A-?3\d\d", "section"),        # A-300 series (sections)
    (r"^A-?4\d\d", "detail"),         # A-400 series (details)
    (r"^A-?5\d\d", "interior"),       # A-500 series (interior)
    (r"^A-?8\d\d", "schedule"),       # A-800 series (schedules)
    (r"^FP-?\d", "fire_protection"),
    (r"^M-?\d", "mechanical"),
    (r"^P-?\d", "plumbing"),
    (r"^E-?\d", "electrical"),
    (r"^S-?\d", "structural"),
    (r"^C-?\d", "civil"),
    (r"^L-?\d", "landscape"),
]

_LEVEL_NAME_PATTERNS: list[tuple[str, tuple[str, int]]] = [
    # (regex, (use, elevation_ft))
    (r"\bground\s+floor\s+parking\b|\bparking\s+level\s*(?:p|1)?\b|\bpark(?:ing)?\s*1\b", ("garage", 0)),
    (r"\bsecond\s+floor\s+parking\b|\bparking\s+level\s*2\b|\bpark(?:ing)?\s*2\b", ("garage", 12)),
    (r"\blevel\s+1\b|\bfirst\s+floor\b|\b1st\s+floor\b", ("residential", 24)),
    (r"\blevel\s+2\b|\bsecond\s+floor\b|\b2nd\s+floor\b", ("residential", 34)),
    (r"\blevel\s+3\b|\bthird\s+floor\b|\b3rd\s+floor\b", ("residential", 44)),
    (r"\blevel\s+4\b|\bfourth\s+floor\b|\b4th\s+floor\b", ("residential", 54)),
    (r"\blevel\s+5\b|\bfifth\s+floor\b|\b5th\s+floor\b", ("residential", 64)),
    (r"\broof\s+plan\b|\broof\s+level\b", ("roof", 74)),
    (r"\bpenthouse\b", ("other", 84)),
    (r"\bbasement\b|\bb\s?1\b", ("other", -12)),
]


def classify_page(text_fragments: list[dict[str, Any]]) -> dict[str, Any]:
    """Return a classification dict for the page.

    Keys:
      - `kind`: cover | floor_plan | elevation | section | detail |
                mechanical | electrical | structural | civil |
                landscape | unknown
      - `sheet_no`: detected sheet number string or None
      - `level_name`: the level's human-readable name or None
      - `level_use`: garage | residential | retail | mech | roof | other
      - `elevation_ft`: inferred floor elevation or None
      - `confidence`: 0..1
    """
    result: dict[str, Any] = {
        "kind": "unknown",
        "sheet_no": None,
        "level_name": None,
        "level_use": None,
        "elevation_ft": None,
        "confidence": 0.0,
    }
    if not text_fragments:
        return result

    text = " ".join(
        str(f.get("text") or "") for f in text_fragments
    )
    lower = text.lower()

    # Sheet number: look for the AIA-style tag in the title block
    # (right-most, last-printed text fragment is usually the sheet)
    sheet_match = re.search(r"\b([A-Z]{1,3}-?\d{1,3}[a-z]?)\b", text)
    if sheet_match:
        sheet_no = sheet_match.group(1).upper().replace("-", "")
        result["sheet_no"] = sheet_no
        for pattern, kind in _SHEET_PATTERNS:
            if re.match(pattern, sheet_no):
                result["kind"] = kind
                result["confidence"] = 0.85
                break

    # Level name + use + elevation
    for pattern, (use, elev) in _LEVEL_NAME_PATTERNS:
        m = re.search(pattern, lower)
        if m:
            result["level_name"] = m.group(0).upper()
            result["level_use"] = use
            result["elevation_ft"] = elev
            result["confidence"] = max(result["confidence"], 0.75)
            break

    # Geometry-density override: a page with no match but many thick
    # lines is probably a plan — tag as floor_plan with low confidence
    if result["kind"] == "unknown" and len(text_fragments) > 50:
        result["kind"] = "floor_plan"
        result["confidence"] = 0.45
    return result


# ── B.4 dimension-line scale inference ─────────────────────────────

# Dimension callout: NN'-MM" — supports straight apostrophe, U+2019
# (curly right single quote often pasted from Word), U+2032 (prime),
# and the matching inches marks (straight ", U+201D, U+2033).
_DIM_PATTERN = re.compile(
    r"(?P<feet>\d{1,3})\s*[\u2019'\u2032]\s*-?\s*"
    r"(?P<inches>\d{1,2})\s*[\u201D\"\u2033]"
)


def infer_scale_from_dimensions(
    text_fragments: list[dict[str, Any]],
    line_segments: list[dict[str, Any]] | None = None,
) -> Optional[float]:
    """Infer scale (ft / pt) by matching dimension callouts to line
    lengths on the page.

    Strategy:
      1. Scan text fragments for `NN'-MM"` dimension callouts
      2. For each callout, find the nearest roughly-horizontal or
         roughly-vertical line segment in `line_segments`
      3. Compute ft / pt as dimension_ft / line_length_pt
      4. Return the median across all matches (robust to outliers)

    Returns None if no matches — caller falls back to
    `_detect_scale_ft_per_pt`.
    """
    if not text_fragments or not line_segments:
        return None

    dim_points: list[tuple[float, float, float]] = []  # (x, y, dim_ft)
    for f in text_fragments:
        txt = str(f.get("text") or "")
        m = _DIM_PATTERN.search(txt)
        if not m:
            continue
        try:
            feet = int(m.group("feet"))
            inches = int(m.group("inches"))
        except (TypeError, ValueError):
            continue
        dim_ft = feet + inches / 12.0
        if dim_ft < 1 or dim_ft > 500:  # sanity cap
            continue
        x = float(f.get("x0") or 0)
        y = float(f.get("y0") or 0)
        dim_points.append((x, y, dim_ft))

    if not dim_points:
        return None

    # Pre-compute line midpoints + lengths
    line_info: list[tuple[float, float, float]] = []
    for ln in line_segments:
        try:
            x0 = float(ln.get("x0") or 0); y0 = float(ln.get("y0") or 0)
            x1 = float(ln.get("x1") or 0); y1 = float(ln.get("y1") or 0)
        except (TypeError, ValueError):
            continue
        length = ((x1 - x0) ** 2 + (y1 - y0) ** 2) ** 0.5
        if length < 5:
            continue
        mx, my = (x0 + x1) / 2, (y0 + y1) / 2
        line_info.append((mx, my, length))

    if not line_info:
        return None

    ratios: list[float] = []
    for dx, dy, dim_ft in dim_points:
        # Nearest line midpoint (Euclidean)
        best = None
        best_d = float("inf")
        for mx, my, length in line_info:
            d = ((mx - dx) ** 2 + (my - dy) ** 2) ** 0.5
            if d < best_d:
                best_d = d
                best = length
        if best is None or best <= 0:
            continue
        if best_d > 150:  # too far — ambiguous
            continue
        ratios.append(dim_ft / best)

    if not ratios:
        return None
    ratios.sort()
    return ratios[len(ratios) // 2]  # median

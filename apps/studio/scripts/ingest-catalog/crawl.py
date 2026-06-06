#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
HaloFire Studio — REAL manufacturer catalog ingestion crawler.

Pulls genuine sprinkler SKU / SIN spec records from PUBLIC manufacturer data
sheets and writes apps/studio/public/catalog/manufacturer-catalog.json.

Sources (per docs/research/parts-catalog-and-system-model.md):
  - Tyco / Johnson Controls: technical data-sheet PDFs hosted at
    docs.johnsoncontrols.com/tycofire/api/khub/documents/<id>/content. Each PDF
    embeds its TFP number and a Sprinkler Identification Number (SIN) block. We
    fetch the PDF and PyMuPDF-extract SIN / K-factor / NPT size / orientation /
    temperature ratings / response type directly from the AUTHORITATIVE PDF
    (never from an HTML snippet). The tyco-fire.com listing HTML itself is behind
    Incapsula bot protection for scripted clients, so we crawl the datasheet PDFs
    that the (browser-fetched) listing pages link to.
  - Reliable: numeric bulletin PDFs at
    reliablesprinkler.com/files/bulletins/<NNN>.pdf — directly fetchable. We
    iterate a bounded, pre-scanned list of bulletin numbers known to be sprinkler
    spec sheets, and PyMuPDF-extract each per-SIN "Technical Specifications" block
    (Style / Threads / Nominal K-Factor / Max Working Pressure) plus the shared
    Temperature Ratings list.

HONESTY (hard, fail-closed):
  - EVERY field is a REAL value extracted from the cited PDF. If a field cannot be
    parsed it is set to null — NEVER guessed or fabricated.
  - EVERY entry carries the real datasheetUrl + sourceUrl it was extracted from.
  - If a source is blocked / unparseable it is recorded in `sources` with its
    error and contributes ZERO entries — we never invent entries to hit a count.
  - These are catalog SPEC records from public data sheets. They are NOT
    manufacturer-exact geometry, NOT AHJ / PE / code-certified selections.

Run from apps/studio:
    C:/Python312/python.exe scripts/ingest-catalog/crawl.py

Requires: requests, pymupdf  (pip install requests pymupdf)
"""

from __future__ import annotations

import datetime as _dt
import json
import re
import sys
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Optional

try:
    import requests
except ImportError:  # pragma: no cover
    print("FATAL: requests not installed. Run: pip install requests", file=sys.stderr)
    raise

try:
    import fitz  # PyMuPDF
except ImportError:  # pragma: no cover
    print("FATAL: pymupdf not installed. Run: pip install pymupdf", file=sys.stderr)
    raise

sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]

HDR = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    )
}

# crawl.py lives at apps/studio/scripts/ingest-catalog/crawl.py
#   parents[0]=ingest-catalog  [1]=scripts  [2]=studio
STUDIO_ROOT = Path(__file__).resolve().parents[2]
OUT_PATH = STUDIO_ROOT / "public" / "catalog" / "manufacturer-catalog.json"

JC_BASE = "https://docs.johnsoncontrols.com/tycofire/api/khub/documents/{id}/content"
RELIABLE_BASE = "https://www.reliablesprinkler.com/files/bulletins/{n}.pdf"

# ---------------------------------------------------------------------------
# Tyco / Johnson Controls datasheet document IDs.
#
# Each id was confirmed (this session) to resolve to a real application/pdf
# technical data sheet whose embedded TFP number + SIN block we extract. The
# `landing` URL is the human-facing tyco-fire.com product page the sheet belongs
# to (used as sourceUrl); the khub URL is the datasheetUrl.
# ---------------------------------------------------------------------------
TYCO_DOCS = [
    {
        "id": "JXGj~rL_f_FBVCY52uMTJw",
        "landing": "https://www.tyco-fire.com/products-and-solutions/sprinklers-nozzles-and-accessories/standard-coverage/ty-frb_fis/series-ty-frb-sprinklers",
    },
    {
        "id": "SC0wntXoMEz0fJHGSDFKYg",
        "landing": "https://www.tyco-fire.com/products-and-solutions/sprinklers-nozzles-and-accessories/standard-coverage/ty-frb_fis/series-ty-frb-sprinklers",
    },
    {
        "id": "GjYamLcgtxwHCclUKVEuNg",
        "landing": "https://www.tyco-fire.com/products-and-solutions/sprinklers-nozzles-and-accessories/standard-coverage/ty-frb_fis/series-ty-frb-sprinklers",
    },
    {
        "id": "Y5s5g2HZNr6Um_t5iOK7dw",
        "landing": "https://www.tyco-fire.com/products-and-solutions/sprinklers-nozzles-and-accessories/standard-coverage/ty-b_fis/series-ty-b-sprinklers",
    },
    {
        "id": "sHaKx63LNR0Plc0DRhpTjA",
        "landing": "https://www.tyco-fire.com/products-and-solutions/sprinklers-nozzles-and-accessories/standard-coverage/ty-b_fis/series-ty-b-sprinklers",
    },
    {
        "id": "xmJhVJHLJCO77YuktCNBQg",
        "landing": "https://www.tyco-fire.com/products-and-solutions/sprinklers-nozzles-and-accessories/standard-coverage/rfii_fis/series-rfii-standard-coverage-sprinkler",
    },
    {
        "id": "Z5ZVzAKjhf_8O8We9to1rA",
        "landing": "https://www.tyco-fire.com/products-and-solutions/sprinklers-nozzles-and-accessories/extended-coverage/rfii_ec_fis/series-rfii-extended-coverage-sprinkler",
    },
    {
        "id": "e9bESi3o9KPZtqpBqxrTKg",
        "landing": "https://www.tyco-fire.com/products-and-solutions/sprinklers-nozzles-and-accessories/extended-coverage/rfii-c_fis/series-rfii-c-sprinkler",
    },
    {
        "id": "XcprNdeSrDHsQ_AiuOJ9yQ",
        "landing": "https://www.tyco-fire.com/products-and-solutions/sprinklers-nozzles-and-accessories",
    },
    {
        "id": "Hw0FcFvFTQeaX2w0E2C7UQ",
        "landing": "https://www.tyco-fire.com/products-and-solutions/sprinklers-nozzles-and-accessories/storage/esfr-25_fis/model-esfr-25-sprinklers",
    },
    {
        "id": "piBCkF8DgCJI3dI0xFBMgw",
        "landing": "https://www.tyco-fire.com/products-and-solutions/sprinklers-nozzles-and-accessories/storage",
    },
    {
        "id": "nceqcVPMarrl8RwvTtXH6A",
        "landing": "https://www.tyco-fire.com/products-and-solutions/sprinklers-nozzles-and-accessories/storage",
    },
]

# Reliable bulletin numbers pre-scanned (this session) as sprinkler spec sheets
# carrying RA-series SINs. Bounded list — see research doc §3.5 (URL pattern
# confirmed for sampled files only; we do not blind-enumerate the full range).
RELIABLE_BULLETINS = [
    "060", "061", "062", "063", "064", "065", "066", "067",
    "071", "072", "073", "074", "075", "076", "077", "078",
    "085", "104", "135", "182", "183", "184",
]


@dataclass
class Port:
    method: Optional[str]
    nominalSizeIn: Optional[float]
    role: Optional[str]


@dataclass
class CatalogEntry:
    id: str
    mfr: str
    model: str
    sin: Optional[str]
    category: str
    kFactor: Optional[float]
    port: Optional[dict]
    tempRatingsF: Optional[list]
    responseType: Optional[str]
    finishes: Optional[list]
    datasheetUrl: str
    sourceUrl: str


@dataclass
class SourceReport:
    mfr: str
    url: str
    partCount: int = 0
    error: Optional[str] = None


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _get(url: str, *, retries: int = 2, sleep: float = 1.0) -> requests.Response:
    last = None
    for attempt in range(retries + 1):
        try:
            r = requests.get(url, headers=HDR, timeout=45)
            if r.status_code == 200:
                return r
            last = RuntimeError(f"HTTP {r.status_code}")
        except Exception as e:  # noqa: BLE001
            last = e
        time.sleep(sleep * (attempt + 1))
    raise last if last else RuntimeError("unknown fetch error")


def _npt_size_to_in(raw: str) -> Optional[float]:
    """Parse a thread spec like '1/2 in. NPT' / '3/4" NPT' / '1 in. NPT' -> float."""
    if not raw:
        return None
    m = re.search(r"(\d+(?:-\d+/\d+)?|\d+/\d+|\d+)\s*(?:in\.?|\"|”)", raw)
    if not m:
        return None
    return _fraction_to_float(m.group(1))


def _fraction_to_float(tok: str) -> Optional[float]:
    tok = tok.strip()
    try:
        if "-" in tok and "/" in tok:  # mixed e.g. 1-1/4
            whole, frac = tok.split("-", 1)
            num, den = frac.split("/")
            return float(whole) + float(num) / float(den)
        if "/" in tok:
            num, den = tok.split("/")
            return float(num) / float(den)
        return float(tok)
    except (ValueError, ZeroDivisionError):
        return None


def _slug(*parts: str) -> str:
    raw = "-".join(p for p in parts if p)
    raw = re.sub(r"[^A-Za-z0-9]+", "-", raw).strip("-").lower()
    return raw


def _temps_in_range(text: str) -> list:
    """All Fahrenheit temperature ratings (sprinkler ratings are 135..360 typ)."""
    vals = sorted({int(x) for x in re.findall(r"(\d{2,3})\s*°F", text)})
    # Standard sprinkler temperature classifications top out at 650°F; ratings
    # below 100°F are not real ratings. Keep the plausible rating band only.
    return [v for v in vals if 100 <= v <= 650]


# ---------------------------------------------------------------------------
# Finish extraction (shared)
#
# Sprinkler finish lists live in tabular sections of the datasheets — Tyco's
# per-K-factor "Sprinkler Finish" sub-columns + the part-number "SPRINKLER
# FINISH" code block, and Reliable's "Table B". The flat text-regex extraction
# used for SIN/K/NPT does NOT recover these grids, so we use PyMuPDF
# find_tables() (column-aware) plus a targeted code-block regex. Every emitted
# finish is a verbatim cell from the cited PDF — unparseable sheets yield null.
# ---------------------------------------------------------------------------

# Any cell mentioning a real finish/coating vocabulary token.
_FINISH_KW = re.compile(
    r"(brass|chrome|polyester|lead|wax|nickel|ptfe|bronze|alumin|black|white|"
    r"paint|galvani|plated|coated|signal|natural|pure|jet|satin|dull|"
    r"electroless|enamel|off white)",
    re.IGNORECASE,
)
# A finish phrase must carry a finish *noun* (rejects bare "Pure White", header
# noise like "Type" / "Temperature").
_FINISH_NOUN = re.compile(
    r"(brass|polyester|plated|coated|chrome|nickel|bronze|paint|alumin|enamel)",
    re.IGNORECASE,
)
# A strictly clean, title-cased finish phrase (lowercase connectors allowed).
# Used to reject garbled fragments parsed out of the dotted code block.
_FINISH_STRICT = re.compile(r"^[A-Z][a-zA-Z]*(?:\s(?:[A-Z][a-zA-Z]*|over|or))*$")


def _norm_finish(raw: str) -> str:
    """Normalize a raw finish cell to a clean finish name (never fabricates).

    Strips RAL color codes, footnote markers (parenthetical numbers, trailing
    superscript/footnote digits, and a single footnote letter glued onto a known
    finish word such as "Polyesterc"), collapses whitespace, title-cases an
    ALL-CAPS cell, and restores the PTFE acronym.
    """
    s = re.sub(r"\(RAL\s*\d+\)", "", raw)
    s = re.sub(r"\(\d+\)", "", s)             # footnote like "(3)"
    s = re.sub(r"[*¹²³⁰-⁹]", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    s = re.sub(r"\s*\d+$", "", s).strip()      # trailing footnote digit
    s = re.sub(
        r"\b(Polyester|Brass|Chrome|Bronze|Nickel|Lead|Wax|Plated|Coated|"
        r"Aluminum|White|Black|PTFE)[a-z]\b",
        r"\1",
        s,
    )
    if s.isupper():
        s = s.title()
    s = re.sub(r"\bPtfe\b", "PTFE", s, flags=re.IGNORECASE)
    return s.strip(" ,.")


def _add_finish(out: list, cell: str) -> None:
    """Append a normalized finish to `out` if non-empty and not already present."""
    c = _norm_finish(cell)
    if c and c.lower() not in {o.lower() for o in out}:
        out.append(c)


def _tyco_finishes(doc, text: str) -> Optional[list]:
    """Parse the REAL sprinkler finish list from a Tyco TFP datasheet.

    Two complementary in-PDF sources:
      1. The finish sub-column headers of the per-K-factor / max-pressure tables
         (find_tables) — e.g. "Natural Brass", "Chrome Plated", "Polyester",
         "Lead Coated" / "Wax Coated". Clean and reliable.
      2. The part-number "SPRINKLER FINISH ... TEMPERATURE RATINGS" coded block,
         which additionally names the polyester color variants ("Pure White
         Polyester", "Signal White Polyester", "Jet Black Polyester"). Only
         strictly clean, title-cased phrases are accepted; garbled fragments are
         dropped, never emitted.
    Returns None when no finish table is parseable (honest null).
    """
    out: list = []
    for pno in range(doc.page_count):
        try:
            tabs = doc[pno].find_tables()
        except Exception:  # noqa: BLE001
            continue
        for t in tabs.tables:
            rows = t.extract()
            for ri, r in enumerate(rows):
                if ri + 1 >= len(rows):
                    continue
                for cell in r:
                    if cell and re.match(r"Sprinkler Finish", cell.strip()):
                        for sub in rows[ri + 1]:
                            if sub and _FINISH_KW.search(sub):
                                _add_finish(out, sub)
    m = re.search(r"SPRINKLER\s+FINISH\b(.*?)TEMPERATURE\s+RATINGS", text, re.DOTALL)
    if m:
        groups: list = []
        cur: list = []
        for ln in m.group(1).split("\n"):
            ln = ln.strip()
            if not ln:
                continue
            if re.fullmatch(r"\d{1,2}", ln):       # finish code -> group separator
                if cur:
                    groups.append(" ".join(cur))
                    cur = []
                continue
            if re.fullmatch(r"[a-z*]{1,2}", ln):   # footnote marker line
                continue
            cur.append(ln)
        if cur:
            groups.append(" ".join(cur))
        for g in groups:
            c = _norm_finish(g)
            if c and len(c) <= 28 and _FINISH_NOUN.search(c) and _FINISH_STRICT.match(c):
                _add_finish(out, c)
    return out or None


def _reliable_finishes(doc) -> Optional[list]:
    """Parse Reliable "Table B" sprinkler finishes from a bulletin PDF.

    Table B is a 4-column grid: (Standard Finishes: Sprinkler | Escutcheons),
    (Special Application Finishes: Sprinkler | Escutcheons). Only the columns
    whose header cell is exactly "Sprinkler" are sprinkler finishes — the
    Escutcheon columns are deliberately excluded. Returns None when no Table B
    is parseable (honest null).
    """
    for pno in range(doc.page_count):
        try:
            tabs = doc[pno].find_tables()
        except Exception:  # noqa: BLE001
            continue
        for t in tabs.tables:
            rows = t.extract()
            flat = " ".join(str(c) for r in rows for c in r if c)
            if "Finishes" not in flat:
                continue
            hdr = None
            for ri, r in enumerate(rows):
                if any(c and c.strip() == "Sprinkler" for c in r):
                    hdr = ri
                    break
            if hdr is None:
                continue
            cols = [
                ci for ci, c in enumerate(rows[hdr]) if c and c.strip() == "Sprinkler"
            ]
            out: list = []
            for r in rows[hdr + 1:]:
                for ci in cols:
                    if ci < len(r) and r[ci] and _FINISH_KW.search(r[ci]):
                        _add_finish(out, r[ci])
            if out:
                return out
    return None


# ---------------------------------------------------------------------------
# Tyco extraction
# ---------------------------------------------------------------------------

# Dotted SIN list line: "TY1131 . . . Upright 2.8K, 1/2 in. NPT". The dot leaders
# rasterize to assorted glyphs (tabs, U+FFFD, periods, spaces), so the separator
# between the SIN and its orientation is matched permissively as "any run of
# non-newline chars that is NOT itself another SIN/orientation keyword". The SIN
# is anchored to a line start to avoid matching prose mentions like "(TY313)".
_TYCO_DOTTED = re.compile(
    r"(?:^|\n)\s*(TY\d{3,4})"
    r"[^\nA-Za-z]*"  # dot-leader run (tabs / U+FFFD / periods / spaces), no letters
    r"(Upright|Pendent|Horizontal Sidewall|Vertical Sidewall|Sidewall|Recessed[^\n,0-9]*)"
    r"[^0-9\n]*?([0-9]+(?:\.[0-9]+)?)\s*K\s*,\s*"
    r"(\d+(?:/\d+)?)\s*(?:in\.?|\"|”)\s*NPT",
    re.IGNORECASE,
)


def _tyco_response_type(text: str) -> Optional[str]:
    has_q = "Quick Response" in text or "Quick-Response" in text or "quick response" in text.lower()
    has_s = bool(re.search(r"Standard Response", text))
    if has_q and not has_s:
        return "quick"
    if has_s and not has_q:
        return "standard"
    if has_q and has_s:
        return "quick/standard"
    return None


def _tyco_orientation_to_category(orient: Optional[str]) -> str:
    o = (orient or "").lower()
    if "sidewall" in o:
        return "head_sidewall"
    if "upright" in o:
        return "head_upright"
    if "pendent" in o or "recessed" in o:
        return "head_pendent"
    return "head"


def crawl_tyco() -> tuple[list, list]:
    entries: list = []
    reports: list = []
    for doc_meta in TYCO_DOCS:
        url = JC_BASE.format(id=doc_meta["id"])
        rep = SourceReport(mfr="Tyco/Johnson Controls", url=url)
        try:
            r = _get(url)
            ct = r.headers.get("content-type", "")
            if "pdf" not in ct:
                raise RuntimeError(f"not a PDF (content-type={ct})")
            doc = fitz.open(stream=r.content, filetype="pdf")
            try:
                text = "\n".join(doc[p].get_text() for p in range(doc.page_count))
                finishes = _tyco_finishes(doc, text)
            finally:
                doc.close()
            tfp_m = re.search(r"\bTFP\d{2,4}\b", text)
            tfp = tfp_m.group(0) if tfp_m else None
            resp = _tyco_response_type(text)
            temps = _temps_in_range(text) or None

            seen: set[str] = set()
            count_before = len(entries)

            # Format 1: dotted SIN list (standard-spray families).
            for m in _TYCO_DOTTED.finditer(text):
                sin = m.group(1).upper()
                if sin in seen:
                    continue
                seen.add(sin)
                orient = (m.group(2) or "").strip() or None
                k = float(m.group(3))
                size_in = _fraction_to_float(m.group(4))
                model = f"{_tyco_series_name(text)} {sin}".strip()
                entries.append(
                    CatalogEntry(
                        id=_slug("tyco", sin),
                        mfr="Tyco",
                        model=model,
                        sin=sin,
                        category=_tyco_orientation_to_category(orient),
                        kFactor=k,
                        port=asdict(
                            Port(
                                method="THREADED_NPT",
                                nominalSizeIn=size_in,
                                role="INLET",
                            )
                        ),
                        tempRatingsF=temps,
                        responseType=resp,
                        finishes=finishes,
                        datasheetUrl=url,
                        sourceUrl=doc_meta["landing"],
                    ).__dict__
                )

            # Format 2: single/low-count SIN datasheets (ESFR, concealed, etc.)
            if len(entries) == count_before:
                for ent in _tyco_single_sin(
                    text, url, doc_meta["landing"], tfp, resp, temps, finishes
                ):
                    if ent["sin"] in seen:
                        continue
                    seen.add(ent["sin"])
                    entries.append(ent)

            rep.partCount = len(entries) - count_before
            if rep.partCount == 0:
                rep.error = f"{tfp or '?'}: no SIN rows parsed"
        except Exception as e:  # noqa: BLE001
            rep.error = str(e)
        reports.append(rep)
        time.sleep(0.8)
    return entries, reports


def _tyco_series_name(text: str) -> str:
    m = re.search(r"Series\s+([A-Z0-9\-]+)", text)
    if m:
        return f"Series {m.group(1)}"
    m = re.search(r"Model\s+(ESFR-\d+)", text)
    if m:
        return f"Model {m.group(1)}"
    return "Tyco"


def _tyco_single_sin(text, url, landing, tfp, resp, temps, finishes) -> list:
    """Extract single-SIN datasheets (one SIN, spec block in body)."""
    out: list = []
    sins = re.findall(r"\bTY\d{3,4}\b", text)
    if not sins:
        return out
    sin = sins[0].upper()
    # K-factor. Try, in order: a number PRECEDING "K-factor" (e.g. "5.6 K-factor"
    # or "25.2. The"), then "K-factor of NN.N", then "K = NN.N". We only accept a
    # value with a decimal point (real nominal K values are e.g. 2.8/5.6/8.0/14.0/
    # 25.2) — this rejects stray integers like the "1" in "1/2 INCH NPT".
    k = None
    for pat in (
        r"(\d+\.\d+)\s*K[\s\-]?factor",
        r"K[\s\-]?factor\s+(?:of\s+)?(\d+\.\d+)",
        r"\bK\s*=\s*(\d+\.\d+)",
        r"Discharge Coefficient\D{0,12}(\d+\.\d+)",
    ):
        km = re.search(pat, text, re.IGNORECASE)
        if km:
            try:
                k = float(km.group(1))
                break
            except ValueError:
                k = None
    # Thread size: "Thread Size 1 in. NPT" / "1/2 in. NPT"
    size_in = None
    tm = re.search(r"Thread Size[^\n]*?(\d+(?:/\d+)?)\s*(?:in\.?|\"|”)\s*NPT", text)
    if not tm:
        tm = re.search(r"(\d+(?:/\d+)?)\s*(?:in\.?|\"|”)\s*NPT", text)
    if tm:
        size_in = _fraction_to_float(tm.group(1))
    # Orientation
    orient = None
    om = re.search(r"Sprinkler Orientation\s+([A-Za-z ]+)", text)
    if om:
        orient = om.group(1).strip().split("\n")[0]
    elif re.search(r"\bPendent\b", text) and not re.search(r"\bUpright\b", text):
        orient = "Pendent"
    elif re.search(r"\bUpright\b", text) and not re.search(r"\bPendent\b", text):
        orient = "Upright"
    series = _tyco_series_name(text)
    out.append(
        CatalogEntry(
            id=_slug("tyco", sin),
            mfr="Tyco",
            model=f"{series} {sin}".strip(),
            sin=sin,
            category=_tyco_orientation_to_category(orient),
            kFactor=k,
            port=asdict(
                Port(
                    method="THREADED_NPT",
                    nominalSizeIn=size_in,
                    role="INLET",
                )
            )
            if size_in is not None
            else None,
            tempRatingsF=temps,
            responseType=resp,
            finishes=finishes,
            datasheetUrl=url,
            sourceUrl=landing,
        ).__dict__
    )
    return out


# ---------------------------------------------------------------------------
# Reliable extraction
# ---------------------------------------------------------------------------

# Per-SIN technical-spec block:
#   "SIN RA6322 ... Style: Upright ... Threads: 3/4" NPT ... Nominal K-Factor: 8.0"
_REL_BLOCK = re.compile(
    r"SIN\s+(RA\d{4})(.{0,500}?)Nominal K-Factor:\s*([0-9]+(?:\.[0-9]+)?)",
    re.IGNORECASE | re.DOTALL,
)

# Summary-table fallback (dry-sprinkler sheets, e.g. bulletins 060/061): a Table A
# row reads "<Model> <Orientation>\n<K> (lpm)\n<approvals>\n<pressure>\n<SIN>".
_REL_SUMMARY = re.compile(
    r"([A-Z0-9][A-Za-z0-9\- ]*?"
    r"(?:Pendent|Upright|Horizontal Sidewall|Vertical Sidewall|Sidewall|Conventional))"
    r"\s*\n([0-9]+(?:\.[0-9]+)?)\s*\([0-9]+\)\s*\n[^\n]*\n[^\n]*\n(RA\d{4})",
)


def _reliable_model_name(text: str, sin: str) -> Optional[str]:
    """Find the model label for a SIN.

    Order of preference:
      1. "Model <NAME> <Orientation> Sprinkler ... SIN <sin>"  (per-SIN block)
      2. A model code appearing immediately before the SIN on a table row, e.g.
         "F1Res 58 HSWX\nRA3533" — captured verbatim (no fabricated "Model").
      3. Nearest preceding "Model <NAME>".
    """
    m = re.search(
        r"Model\s+([A-Z0-9\-]+)[^\n]*\bSprinkler\b\s*\n?\s*(?:Model[^\n]*\n)?SIN\s+"
        + re.escape(sin),
        text,
    )
    if m:
        return f"Model {m.group(1)}"

    # Table-row form: the model code is the line(s) right before the SIN token.
    idx = text.find(sin)
    if idx > 0:
        # Take up to ~40 chars before the SIN on the same/preceding line.
        pre = text[max(0, idx - 60):idx]
        # A model code looks like "F1Res 58 HSWX" / "F1FR80" / "F3-80" — letters,
        # digits, spaces, dashes; must contain a letter and a digit.
        rows = [ln.strip() for ln in pre.split("\n") if ln.strip()]
        if rows:
            cand = rows[-1]
            if (
                re.search(r"[A-Za-z]", cand)
                and re.search(r"\d", cand)
                and len(cand) <= 24
                and "Nominal" not in cand
                and ":" not in cand
            ):
                return cand

    if idx > 0:
        mm = list(re.finditer(r"Model\s+([A-Z0-9\-]+)", text[:idx]))
        if mm:
            return f"Model {mm[-1].group(1)}"
    return None


def _reliable_response(text: str) -> Optional[str]:
    low = text.lower()
    has_q = "quick response" in low or "quick-response" in low
    has_s = "standard response" in low
    if has_q and not has_s:
        return "quick"
    if has_s and not has_q:
        return "standard"
    if has_q and has_s:
        return "quick/standard"
    return None


def _reliable_temps(text: str) -> Optional[list]:
    """Temperature ratings block specifically (avoids guard/ambient stray vals)."""
    m = re.search(r"Temperature Ratings?(.{0,200})", text, re.DOTALL)
    if not m:
        return None
    vals = sorted({int(x) for x in re.findall(r"(\d{2,3})\s*°F", m.group(1))})
    vals = [v for v in vals if 100 <= v <= 650]
    return vals or None


def _reliable_orientation_category(style: Optional[str]) -> str:
    s = (style or "").lower()
    if "sidewall" in s:
        return "head_sidewall"
    if "upright" in s:
        return "head_upright"
    if "pendent" in s or "recessed" in s:
        return "head_pendent"
    if "conventional" in s:
        return "head"
    return "head"


def crawl_reliable() -> tuple[list, list]:
    entries: list = []
    reports: list = []
    for n in RELIABLE_BULLETINS:
        url = RELIABLE_BASE.format(n=n)
        rep = SourceReport(mfr="Reliable", url=url)
        try:
            r = _get(url)
            ct = r.headers.get("content-type", "")
            if "pdf" not in ct:
                raise RuntimeError(f"not a PDF (content-type={ct})")
            doc = fitz.open(stream=r.content, filetype="pdf")
            try:
                text = "\n".join(doc[p].get_text() for p in range(doc.page_count))
                finishes = _reliable_finishes(doc)
            finally:
                doc.close()
            resp = _reliable_response(text)
            temps = _reliable_temps(text)
            count_before = len(entries)
            seen: set[str] = set()
            for m in _REL_BLOCK.finditer(text):
                sin = m.group(1).upper()
                if sin in seen:
                    continue
                seen.add(sin)
                blk = m.group(2)
                k = float(m.group(3))
                style_m = re.search(r"Style:\s*([A-Za-z /]+)", blk)
                style = style_m.group(1).strip() if style_m else None
                thr_m = re.search(r"Threads?:\s*([^\n|]+)", blk)
                thr = thr_m.group(1).strip() if thr_m else None
                size_in = _npt_size_to_in(thr) if thr else None
                model = _reliable_model_name(text, sin)
                entries.append(
                    CatalogEntry(
                        id=_slug("reliable", sin),
                        mfr="Reliable",
                        model=model or f"Reliable {sin}",
                        sin=sin,
                        category=_reliable_orientation_category(style),
                        kFactor=k,
                        port=asdict(
                            Port(
                                method="THREADED_NPT"
                                if (thr and "NPT" in thr)
                                else None,
                                nominalSizeIn=size_in,
                                role="INLET",
                            )
                        )
                        if size_in is not None
                        else None,
                        tempRatingsF=temps,
                        responseType=resp,
                        finishes=finishes,
                        datasheetUrl=url,
                        sourceUrl=url,
                    ).__dict__
                )
            # Fallback: summary-table rows (dry-sprinkler sheets) when no per-SIN
            # "Technical Specifications" block was present.
            if len(entries) == count_before:
                # A single inlet thread size sometimes appears once in the body
                # (e.g. dry sprinklers are 1" NPT). Capture it if unambiguous.
                npts = set(re.findall(r"(\d+(?:/\d+)?)\s*(?:in\.?|\"|”)\s*NPT", text))
                body_size = (
                    _fraction_to_float(next(iter(npts))) if len(npts) == 1 else None
                )
                for m in _REL_SUMMARY.finditer(text):
                    label = m.group(1).strip()
                    k = float(m.group(2))
                    sin = m.group(3).upper()
                    if sin in seen:
                        continue
                    seen.add(sin)
                    # Orientation lives at the tail of the model label.
                    style = None
                    for kw in (
                        "Horizontal Sidewall",
                        "Vertical Sidewall",
                        "Sidewall",
                        "Pendent",
                        "Upright",
                        "Conventional",
                    ):
                        if kw.lower() in label.lower():
                            style = kw
                            break
                    entries.append(
                        CatalogEntry(
                            id=_slug("reliable", sin),
                            mfr="Reliable",
                            model=label,
                            sin=sin,
                            category=_reliable_orientation_category(style),
                            kFactor=k,
                            port=asdict(
                                Port(
                                    method="THREADED_NPT",
                                    nominalSizeIn=body_size,
                                    role="INLET",
                                )
                            )
                            if body_size is not None
                            else None,
                            tempRatingsF=temps,
                            responseType=resp,
                            finishes=finishes,
                            datasheetUrl=url,
                            sourceUrl=url,
                        ).__dict__
                    )

            rep.partCount = len(entries) - count_before
            if rep.partCount == 0:
                rep.error = "no per-SIN spec block or summary row parsed"
        except Exception as e:  # noqa: BLE001
            rep.error = str(e)
        reports.append(rep)
        time.sleep(0.5)
    return entries, reports


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    all_entries: list = []
    all_reports: list = []

    print("== Tyco / Johnson Controls ==")
    t_entries, t_reports = crawl_tyco()
    all_entries += t_entries
    all_reports += t_reports

    print("== Reliable ==")
    r_entries, r_reports = crawl_reliable()
    all_entries += r_entries
    all_reports += r_reports

    # Dedup by id (keep first), guard against duplicate SINs across sheets.
    by_id: dict[str, dict] = {}
    for e in all_entries:
        by_id.setdefault(e["id"], e)
    entries = list(by_id.values())

    # Per-manufacturer counts.
    per_mfr: dict[str, int] = {}
    for e in entries:
        per_mfr[e["mfr"]] = per_mfr.get(e["mfr"], 0) + 1

    # Source summary (deduped to one row per (mfr,url)).
    sources = [asdict(s) for s in all_reports]

    out = {
        "generatedAt": _dt.datetime.now(_dt.timezone.utc)
        .isoformat()
        .replace("+00:00", "Z"),
        "disclaimer": (
            "Catalog SPEC records extracted from PUBLIC manufacturer data sheets. "
            "Every field is a real extracted value; unparseable fields are null. "
            "These are NOT manufacturer-exact geometry and NOT AHJ / PE / "
            "code-certified selections. Verify against the governing NFPA 13 "
            "edition and stamped calcs before any bid / takeoff / permit use."
        ),
        "sources": [
            {
                "mfr": s["mfr"],
                "url": s["url"],
                "partCount": s["partCount"],
                **({"error": s["error"]} if s["error"] else {}),
            }
            for s in sources
        ],
        "entries": sorted(entries, key=lambda e: (e["mfr"], e["sin"] or e["id"])),
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")

    # --- Report ---------------------------------------------------------
    print("\n========== INGESTION REPORT ==========")
    print(f"Output: {OUT_PATH}")
    print(f"Total entries: {len(entries)}")
    print("Per-manufacturer counts:")
    for mfr, c in sorted(per_mfr.items()):
        print(f"   {mfr:24s} {c}")
    failed = [s for s in sources if s["error"]]
    print(f"\nSources OK: {len([s for s in sources if not s['error']])}")
    print(f"Sources FAILED: {len(failed)}")
    for s in failed:
        print(f"   FAIL [{s['mfr']}] {s['url']}  -> {s['error']}")
    print("======================================")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

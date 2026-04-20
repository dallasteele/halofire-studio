"""Catalog-sync agent — pulls manufacturer price sheets through a
local LLM and emits typed PriceUpdate records for db.apply_updates.

Design principles
  * Local-first. The ONLY supported model family is **Gemma** (via
    Ollama on localhost:11434). Default tag `gemma3:4b` = the 4B-
    parameter Gemma 3 build used across HAL / ClaudeBot as the
    Tier 1 diagnosis model. Swap to another Gemma tag via
    `HALOFIRE_SYNC_MODEL` — but no other model families (no Qwen,
    no Llama, no Mistral) are sanctioned for this pipeline.
  * Never writes directly. The agent extracts -> validates ->
    stages a JSON patch; `db.apply_updates` is the only code path
    to the DB.
  * Every run logs to `sync_runs` with source hash + LLM model.
    So every price in the DB can be traced to the PDF/HTML it
    came from.
  * Unattended. Designed to be invoked from Windows Task Scheduler
    / cron / HAL's oracle loop. `python sync_agent.py --supplier
    victaulic --source /path/to/pricelist.pdf`.

Source shapes handled
  * PDF tables  -> pdfplumber -> LLM fills blanks
  * HTML price lists -> BeautifulSoup -> LLM
  * CSV feeds -> pandas -> direct (no LLM)
  * Excel -> openpyxl -> direct
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE.parent))
from pricing.db import (  # noqa: E402
    PriceUpdate, SyncRun, open_db, sha256_of,
)

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
# Gemma-only policy (see module docstring). The env override exists
# so you can bump the Gemma size (e.g. `gemma3:12b`) — any non-Gemma
# tag is rejected below to prevent accidental backslide to Qwen/Llama.
DEFAULT_MODEL = os.environ.get("HALOFIRE_SYNC_MODEL", "gemma3:4b")


def _require_gemma(model: str) -> None:
    """HaloFire pipelines use Gemma exclusively. Anything else is a bug."""
    tag = model.lower().strip()
    if not (tag.startswith("gemma") or tag.startswith("gemma3") or tag.startswith("gemma2")):
        raise ValueError(
            f"HALOFIRE_SYNC_MODEL={model!r} rejected — Gemma-only policy. "
            "Use a 'gemma3:*' or 'gemma2:*' Ollama tag.",
        )


_require_gemma(DEFAULT_MODEL)


# ── LLM bridge ─────────────────────────────────────────────────────

def _ollama_generate(prompt: str, model: str = DEFAULT_MODEL) -> str:
    """Single-shot JSON generation against a local Ollama daemon.

    Returns the raw model text. Caller parses JSON — the prompt
    asks the model for JSON-only output.
    """
    _require_gemma(model)
    body = json.dumps(
        {
            "model": model,
            "prompt": prompt,
            "stream": False,
            "format": "json",
            "options": {"temperature": 0.1},
        },
    ).encode("utf-8")
    req = urllib.request.Request(
        f"{OLLAMA_URL}/api/generate",
        data=body,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        payload = json.loads(resp.read())
    return payload.get("response", "")


_PROMPT_TEMPLATE = """You are a fire-sprinkler catalog parser. Given the
text of a manufacturer price sheet, extract every SKU and its
unit cost in USD.

Return STRICT JSON, no prose, matching this schema:

{{
  "updates": [
    {{
      "sku": "string — the manufacturer part number, EXACTLY as printed",
      "unit_cost_usd": number,
      "unit": "ea" | "ft" | "m" | "lb" | "100ft" | "each_100",
      "confidence": number between 0 and 1
    }},
    ...
  ]
}}

Rules:
  * Do not invent SKUs. If a line is ambiguous, skip it.
  * Confidence < 0.7 = cell was hard to parse (OCR, rotated, cut off).
  * Prices in other currencies -> skip the row.
  * If a price is listed "per 100 ft", set unit="100ft" and keep the
    number as-printed; downstream will normalize to ft.
  * Do NOT output headers, dates, discounts, or rebates.

Supplier: {supplier}
Source hash: {sha256}
Source text:
---
{text}
---
"""


def extract_updates_from_text(
    supplier: str, text: str, source_sha256: str, model: str = DEFAULT_MODEL,
) -> list[PriceUpdate]:
    _require_gemma(model)
    prompt = _PROMPT_TEMPLATE.format(
        supplier=supplier, sha256=source_sha256, text=text[:80_000],
    )
    raw = _ollama_generate(prompt, model=model)
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        # Last-resort: strip a prose preamble then retry
        brace = raw.find("{")
        if brace < 0:
            return []
        parsed = json.loads(raw[brace:])
    out: list[PriceUpdate] = []
    for row in parsed.get("updates", []):
        try:
            u = PriceUpdate(
                sku=str(row["sku"]),
                unit_cost_usd=float(row["unit_cost_usd"]),
                unit=str(row.get("unit", "ea")),
                source=f"sync_agent:{supplier}:{source_sha256[:8]}",
                source_doc_sha256=source_sha256,
                confidence=float(row.get("confidence", 0.6)),
                currency="USD",
            )
            if not u.validate():
                out.append(u)
        except (KeyError, ValueError, TypeError):
            continue
    return out


# ── source readers ────────────────────────────────────────────────

def _read_pdf_text(path: Path) -> str:
    try:
        import pdfplumber
    except ImportError:  # pragma: no cover
        return ""
    out: list[str] = []
    with pdfplumber.open(str(path)) as pdf:
        for page in pdf.pages:
            t = page.extract_text() or ""
            if t:
                out.append(t)
    return "\n\n".join(out)


def _read_html_text(path: Path) -> str:
    try:
        from bs4 import BeautifulSoup
    except ImportError:  # pragma: no cover
        return path.read_text(encoding="utf-8", errors="ignore")
    soup = BeautifulSoup(
        path.read_text(encoding="utf-8", errors="ignore"),
        "html.parser",
    )
    # Strip scripts + styles; keep table semantics
    for t in soup(["script", "style"]):
        t.decompose()
    return soup.get_text(separator="\n")


def _read_csv_updates(path: Path, supplier: str, sha256: str) -> list[PriceUpdate]:
    """Deterministic path — no LLM. Columns: sku, unit_cost_usd, unit."""
    import csv

    out: list[PriceUpdate] = []
    with path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                u = PriceUpdate(
                    sku=row["sku"].strip(),
                    unit_cost_usd=float(row["unit_cost_usd"]),
                    unit=row.get("unit", "ea").strip() or "ea",
                    source=f"sync_agent:{supplier}:{sha256[:8]}",
                    source_doc_sha256=sha256,
                    confidence=1.0,
                    currency="USD",
                )
                if not u.validate():
                    out.append(u)
            except (KeyError, ValueError):
                continue
    return out


# ── the run() entry point ─────────────────────────────────────────

def run_sync(
    supplier_id: str,
    source_path: Path,
    model: str = DEFAULT_MODEL,
    source_url: str | None = None,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Run the sync against one source document.

    Returns {'accepted': n, 'errors': [...], 'run_id': N}.
    """
    _require_gemma(model)
    sha = sha256_of(source_path)
    ext = source_path.suffix.lower()
    with open_db() as db:
        run_id = db.start_sync_run(
            SyncRun(
                supplier_id=supplier_id,
                source_url=source_url or str(source_path),
                source_doc_sha256=sha,
                llm_model=model,
                started_at=datetime.utcnow(),
            ),
        )
        try:
            if ext == ".csv":
                updates = _read_csv_updates(source_path, supplier_id, sha)
            elif ext in (".pdf",):
                text = _read_pdf_text(source_path)
                updates = extract_updates_from_text(
                    supplier_id, text, sha, model=model,
                )
            elif ext in (".html", ".htm"):
                text = _read_html_text(source_path)
                updates = extract_updates_from_text(
                    supplier_id, text, sha, model=model,
                )
            else:
                raise ValueError(f"unsupported source extension: {ext}")

            if dry_run:
                db.finish_sync_run(
                    run_id,
                    parts_touched=len(updates),
                    prices_added=0,
                    status="success",
                    error="(dry_run)",
                )
                return {"accepted": 0, "errors": [], "updates": [u.sku for u in updates], "run_id": run_id}

            accepted, errs = db.apply_updates(updates)
            db.finish_sync_run(
                run_id,
                parts_touched=len(updates),
                prices_added=accepted,
                status="success" if not errs else "partial",
                error=("; ".join(errs[:5]) if errs else None),
            )
            return {
                "accepted": accepted,
                "errors": errs,
                "proposed": len(updates),
                "run_id": run_id,
            }
        except Exception as e:  # noqa: BLE001
            db.finish_sync_run(
                run_id, parts_touched=0, prices_added=0,
                status="failed", error=str(e),
            )
            raise


# ── CLI ───────────────────────────────────────────────────────────

def _cli() -> int:
    ap = argparse.ArgumentParser(
        description="HaloFire catalog-sync agent",
    )
    ap.add_argument("--supplier", required=True, help="supplier id (see `suppliers`)")
    ap.add_argument("--source", required=True, help="path to price sheet (pdf/html/csv)")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--source-url", default=None)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    res = run_sync(
        supplier_id=args.supplier,
        source_path=Path(args.source).resolve(),
        model=args.model,
        source_url=args.source_url,
        dry_run=args.dry_run,
    )
    print(json.dumps(res, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(_cli())

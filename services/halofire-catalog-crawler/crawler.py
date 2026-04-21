"""LandScout-pattern catalog crawler — Phase 4.3 of V2 plan.

Three-tier agent that keeps `packages/halofire-catalog/specs/`
current with manufacturer datasheets. Each new SKU triggers
`render_from_catalog.py` to fab a GLB so the BOM never blocks on
"part not in our database."

CLI:
    python -m services.halofire-catalog-crawler.crawler \\
        --category sprinkler_head_pendant \\
        --once

Daemon:
    python -m services.halofire-catalog-crawler.crawler --schedule
        # Wakes 4× weekly per V2 Phase 4.3.
"""
from __future__ import annotations

import argparse
import json
import logging
import re
import subprocess
import time
import urllib.request
import urllib.error
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Iterable

log = logging.getLogger("halofire.catalog_crawler")

_REPO = Path(__file__).resolve().parents[2]
_SPECS_DIR = _REPO / "packages" / "halofire-catalog" / "specs"
_GLB_DIR = _REPO / "apps" / "editor" / "public" / "halofire-catalog" / "glb"
_RENDER_SCRIPT = (
    _REPO / "packages" / "halofire-catalog" / "authoring" / "scad"
    / "render_from_catalog.py"
)

# ─── Tier 0: target catalog ───────────────────────────────────────

@dataclass
class CrawlTarget:
    """One manufacturer's catalog endpoint for one part category."""
    manufacturer: str
    category: str
    list_url: str           # index page listing SKUs
    detail_pattern: str     # regex matching individual product URLs
    spec_extractor: str     # name of extractor in extractors.py


SPRINKLER_HEAD_TARGETS: tuple[CrawlTarget, ...] = (
    CrawlTarget(
        manufacturer="tyco",
        category="sprinkler_head_pendant",
        list_url="https://www.tyco-fire.com/sprinklers/standard-response-pendent/",
        detail_pattern=r"/datasheet/TFP\d+\.pdf",
        spec_extractor="tyco_pendant_pdf",
    ),
    CrawlTarget(
        manufacturer="viking",
        category="sprinkler_head_pendant",
        list_url="https://www.vikinggroupinc.com/products/sprinklers/pendent",
        detail_pattern=r"/products/sprinklers/pendent/[^\"']+",
        spec_extractor="viking_pendant_html",
    ),
    CrawlTarget(
        manufacturer="reliable",
        category="sprinkler_head_pendant",
        list_url="https://www.reliablesprinkler.com/products/standard-response/",
        detail_pattern=r"/products/[^\"']+\.html",
        spec_extractor="reliable_pendant_html",
    ),
)


# ─── Tier 0: scrape ──────────────────────────────────────────────

def _fetch(url: str, timeout: float = 15.0) -> str | None:
    """Polite HTTP fetch — User-Agent identifies us, 15 s ceiling."""
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": (
                "halofire-catalog-crawler/0.1 "
                "(https://halofire.io/bot — opt-out via robots.txt)"
            ),
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read().decode("utf-8", errors="ignore")
    except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
        log.warning("crawler.fetch_failed", extra={"url": url, "err": str(e)})
        return None


def _list_skus(target: CrawlTarget) -> list[str]:
    """Scrape the manufacturer's index page → SKU detail URLs."""
    html = _fetch(target.list_url)
    if not html:
        return []
    matches = re.findall(target.detail_pattern, html)
    # Dedupe + absolutize relative URLs
    base = "/".join(target.list_url.split("/")[:3])  # scheme://host
    out: set[str] = set()
    for m in matches:
        out.add(m if m.startswith("http") else f"{base}{m}")
    return sorted(out)


# ─── Tier 1: spec extraction (Gemma fallback) ────────────────────

def _extract_specs(detail_html_or_pdf: str, extractor: str) -> dict | None:
    """Try direct regex extractors first; on failure escalate to
    Gemma for unstructured datasheets. (Gemma escalation is a
    placeholder — wired into HAL's local LLM gateway in production.)
    """
    if extractor == "tyco_pendant_pdf":
        return _extract_tyco_pendant(detail_html_or_pdf)
    if extractor == "viking_pendant_html":
        return _extract_viking_pendant(detail_html_or_pdf)
    if extractor == "reliable_pendant_html":
        return _extract_reliable_pendant(detail_html_or_pdf)
    return None


def _extract_tyco_pendant(text: str) -> dict | None:
    """Pull SKU + K-factor + temp rating from a Tyco TFP datasheet."""
    sku = re.search(r"TFP\s*(\d{3,4})", text)
    k_factor = re.search(r"K[-\s]*Factor[^\d]*(\d+\.?\d*)", text, re.I)
    temp = re.search(r"(\d{3})\s*°?\s*F\s*(?:155|175|200|212|286)", text)
    if not (sku and k_factor):
        return None
    return {
        "sku": f"TYCO-TFP{sku.group(1)}",
        "manufacturer": "tyco",
        "category": "sprinkler_head_pendant",
        "k_factor": float(k_factor.group(1)),
        "temp_rating_f": int(temp.group(1)) if temp else 155,
        "size_in": 0.5,
        "list_price_usd": None,  # filled by pricing-sync pass
    }


def _extract_viking_pendant(text: str) -> dict | None:
    sku = re.search(r"VK\s*(\d{3,4})", text)
    k_factor = re.search(r"K\s*=\s*(\d+\.?\d*)", text)
    if not (sku and k_factor):
        return None
    return {
        "sku": f"VIKING-VK{sku.group(1)}",
        "manufacturer": "viking",
        "category": "sprinkler_head_pendant",
        "k_factor": float(k_factor.group(1)),
        "temp_rating_f": 155,
        "size_in": 0.5,
        "list_price_usd": None,
    }


def _extract_reliable_pendant(text: str) -> dict | None:
    sku = re.search(r"Model\s+([A-Z][A-Z0-9]+)\b", text)
    k_factor = re.search(r"K[-\s]?factor[^\d]*(\d+\.?\d*)", text, re.I)
    if not (sku and k_factor):
        return None
    return {
        "sku": f"RELIABLE-{sku.group(1)}",
        "manufacturer": "reliable",
        "category": "sprinkler_head_pendant",
        "k_factor": float(k_factor.group(1)),
        "temp_rating_f": 155,
        "size_in": 0.5,
        "list_price_usd": None,
    }


# ─── Tier 2: catalog write + GLB regen ───────────────────────────

def _write_catalog_entry(spec: dict) -> Path:
    _SPECS_DIR.mkdir(parents=True, exist_ok=True)
    p = _SPECS_DIR / f"{spec['sku']}.json"
    p.write_text(json.dumps(spec, indent=2), encoding="utf-8")
    return p


def _regen_glb(spec: dict) -> bool:
    """Trigger render_from_catalog for the new SKU. Returns False if
    OpenSCAD missing — pipeline still works (mesh placeholder)."""
    try:
        result = subprocess.run(
            [
                "python", str(_RENDER_SCRIPT),
                "--sku", spec["sku"],
                "--out", str(_GLB_DIR),
            ],
            capture_output=True, text=True, timeout=60,
        )
        return result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


# ─── Top-level loop ──────────────────────────────────────────────

def crawl_once(targets: Iterable[CrawlTarget]) -> dict:
    """One pass over every target. Returns {new_skus, failed_urls}."""
    new_skus: list[str] = []
    failed_urls: list[str] = []
    for tgt in targets:
        log.info(
            "crawler.target_start",
            extra={"manufacturer": tgt.manufacturer, "cat": tgt.category},
        )
        sku_urls = _list_skus(tgt)
        for url in sku_urls:
            html = _fetch(url)
            if not html:
                failed_urls.append(url)
                continue
            spec = _extract_specs(html, tgt.spec_extractor)
            if not spec:
                failed_urls.append(url)
                continue
            existing = _SPECS_DIR / f"{spec['sku']}.json"
            if existing.exists():
                continue  # already in catalog
            _write_catalog_entry(spec)
            _regen_glb(spec)
            new_skus.append(spec["sku"])
    return {
        "new_skus": new_skus,
        "failed_urls": failed_urls,
        "ts_utc": time.time(),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--category", default="sprinkler_head_pendant")
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--schedule", action="store_true")
    args = ap.parse_args()
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )
    targets = [t for t in SPRINKLER_HEAD_TARGETS if t.category == args.category]
    if args.once or not args.schedule:
        out = crawl_once(targets)
        print(json.dumps(out, indent=2))
        return
    # daemon: 4×/week per V2 Phase 4.3 = every 42 hours
    while True:
        try:
            out = crawl_once(targets)
            log.info("crawler.cycle_done", extra=out)
        except Exception as e:  # noqa: BLE001
            log.exception("crawler.cycle_failed", extra={"err": str(e)})
        time.sleep(42 * 3600)


if __name__ == "__main__":
    main()

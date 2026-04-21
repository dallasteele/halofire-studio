"""Sync every HaloFire Studio blueprint to the HAL Brain.

Why: the Brain is persistent memory across Claude Code / HAL /
Codex sessions. Pushing the blueprints there lets any future
session `recall` the authoritative spec and avoid drift.

Usage:
    python scripts/brain_sync_blueprints.py             # push all
    python scripts/brain_sync_blueprints.py --dry-run   # print, don't POST
    python scripts/brain_sync_blueprints.py --only 05 08  # specific blueprints
    python scripts/brain_sync_blueprints.py --recall "catalog engine"
    python scripts/brain_sync_blueprints.py --verify

Endpoints (confirmed from /openapi.json):
    POST /remember  { content, type, source, importance, context }
    POST /recall    { query, top_k, min_similarity, type, source }
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import urllib.request
import urllib.error

BRAIN_URL = "http://localhost:8790"
DOMAIN = "halofire-studio"
BLUEPRINT_DIR = Path(__file__).resolve().parent.parent / "docs" / "blueprints"
# Max bytes per /remember call — Brain uses nomic-embed-text (2048
# tokens). Internally the Brain re-chunks for embedding; keeping
# our chunks ≤ 4KB prevents it producing a tiny residual chunk
# that returns an empty vector ("array size 0" failure mode).
MAX_CHUNK_BYTES = 4_000
# Sequencing delay between any two POSTs to /remember so the
# Brain's embeddings_tmp.npy → embeddings.npy atomic rename
# doesn't race ("WinError 5: Access is denied" failure mode).
POST_DELAY_S = 0.6


def _post(
    path: str, payload: dict[str, Any], retries: int = 3,
) -> dict[str, Any]:
    """POST with retry — Brain's embedding index has occasional
    write races (WinError 5 on npy rename) + occasional empty-
    embedding returns from the model. Both recover on retry."""
    import time
    url = f"{BRAIN_URL}{path}"
    data = json.dumps(payload).encode("utf-8")
    last_err: dict[str, Any] = {}
    for attempt in range(retries):
        req = urllib.request.Request(
            url, data=data, method="POST",
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                body = r.read().decode("utf-8")
                return json.loads(body) if body else {}
        except urllib.error.HTTPError as e:
            text = e.read().decode("utf-8", errors="replace")
            last_err = {"error": f"HTTP {e.code}", "body": text[:500]}
            # Retry on 5xx + embedding errors
            if e.code >= 500 or "size 0" in text or "Access is denied" in text:
                time.sleep(1.5 * (attempt + 1))
                continue
            return last_err
        except urllib.error.URLError as e:
            last_err = {"error": f"URL error: {e.reason}"}
            time.sleep(1.5 * (attempt + 1))
    return last_err


def _slug(filename: str) -> str:
    """Convert '03_CATALOG_ENGINE.md' → '03-catalog-engine'."""
    stem = Path(filename).stem.lower()
    return stem.replace("_", "-")


def _chunks(text: str, size: int) -> list[str]:
    """Split on paragraph boundaries when possible; never mid-line."""
    if len(text.encode("utf-8")) <= size:
        return [text]
    chunks: list[str] = []
    current: list[str] = []
    current_size = 0
    for para in text.split("\n\n"):
        para_size = len(para.encode("utf-8")) + 2
        if current_size + para_size > size and current:
            chunks.append("\n\n".join(current))
            current = [para]
            current_size = para_size
        else:
            current.append(para)
            current_size += para_size
    if current:
        chunks.append("\n\n".join(current))
    return chunks


def push_blueprint(
    path: Path, dry_run: bool = False,
) -> list[dict[str, Any]]:
    """Push one blueprint to the Brain. Returns per-chunk results.

    Each chunk is prefixed with a natural-language preamble so the
    embedder sees real sentence content even if the underlying
    content is mostly markdown tables/code. Empirically the embed
    model returns empty vectors on chunks that start with a table
    separator or a long code fence — the preamble sidesteps that.
    """
    import time
    slug = _slug(path.name)
    text = path.read_text(encoding="utf-8")
    chunks = _chunks(text, MAX_CHUNK_BYTES)
    out: list[dict[str, Any]] = []
    for i, chunk in enumerate(chunks):
        preamble = (
            f"HaloFire Studio blueprint {slug}, part {i + 1} of {len(chunks)}. "
            f"This is a technical specification document for the HaloFire "
            f"Studio AutoSPRINK-class fire-protection CAD application. "
            f"Domain: halofire-studio. "
            f"Source file: {path.name}.\n\n"
        )
        payload = {
            "content": preamble + chunk,
            "type": "technical-spec",
            "source": f"blueprint-{slug}" + (f"-part{i+1}" if len(chunks) > 1 else ""),
            "importance": 0.9,
            "context": {
                "domain": DOMAIN,
                "blueprint_id": slug,
                "path": str(path.relative_to(path.parents[2])),
                "chunk": i + 1,
                "total_chunks": len(chunks),
                "tags": ["halofire-studio", "blueprint", "technical-spec", slug],
            },
        }
        if dry_run:
            out.append({"would_post": payload["source"], "bytes": len(chunk)})
            continue
        time.sleep(POST_DELAY_S)
        result = _post("/remember", payload)
        out.append({"source": payload["source"], "result": result})
    return out


def recall(query: str, top_k: int = 6) -> dict[str, Any]:
    return _post("/recall", {
        "query": query,
        "top_k": top_k,
        "source": None,
    })


_VERIFY_QUERIES: dict[str, str] = {
    "00-index": "halofire studio blueprint index navigation non-negotiable invariants doctrine",
    "01-data-model": "hfproj bundle manifest design snapshots corrections audit schema migration",
    "02-foundation": "undo redo autosave crash recovery error taxonomy instanced mesh performance budget",
    "03-catalog-engine": "scad annotations part schema catalog build pipeline lint rules",
    "04-pascal-nodes": "sprinkler head pipe system fitting valve hanger device fdc riser remote-area nodes discriminator",
    "05-tools-and-interactions": "sprinkler place array pipe route modify connect remote area draw dimension snap keyboard",
    "06-calc-engines": "hardy cross hazen williams rule check seismic bracing fire pump tank sizing",
    "07-drawing-sheet-management": "sheet set title block paper space viewport dimension annotation revision cloud",
    "08-ux-shell": "home screen splash new project wizard ribbon tabs panels command palette status bar",
    "09-agent-pipeline": "intake classifier placer router hydraulic rulecheck bom labor proposal submittal streaming",
    "10-tauri-shell": "tauri rust host sidecar python pyinstaller openscad ipc invoke event bundle msi",
    "11-exports-and-handoff": "dxf dwg ifc rvt pdf sheet set hydralist nfpa 8 report ahj submittal bundle pe stamp",
    "12-extensions-and-collab": "firm custom catalog comments revisions roles designer pe reviewer audit trail plugin",
    "13-operations": "logging telemetry crash report updater licensing privacy offline units locale printer",
    "14-test-strategy": "golden fixtures parity cross engine cruel test scoreboard playwright accessibility",
    "15-design-system": "tokens typography color spacing motion iconography component primitives accessibility",
}


def verify() -> dict[str, Any]:
    """Recall each blueprint with a content-distinctive query and
    confirm the expected blueprint ranks in the top-5 hits."""
    blueprints = sorted(BLUEPRINT_DIR.glob("*.md"))
    results = {}
    for bp in blueprints:
        slug = _slug(bp.name)
        query = _VERIFY_QUERIES.get(slug, f"halofire studio blueprint {slug}")
        result = _post("/recall", {
            "query": query,
            "top_k": 5,
        })
        hits = result.get("results", []) if isinstance(result, dict) else []
        # /recall returns {results: [{episode: {source, content, …}, similarity}]}
        def hit_source(h: dict) -> str:
            ep = h.get("episode") or {}
            return str(ep.get("source") or h.get("source") or "")
        # "Found" = the specific blueprint ranks in top-5 for its
        # content-distinctive query. All blueprints have overlapping
        # vocabulary (they describe the same app), so we accept top-5
        # rather than top-1 — real sessions use natural-language
        # queries which retrieve by semantic meaning, not exact slug.
        hit_sources = [hit_source(h) for h in hits]
        expected = f"blueprint-{slug}"
        found = any(s.startswith(expected) for s in hit_sources)
        all_halofire_blueprints = sum(
            1 for s in hit_sources if s.startswith("blueprint-")
        )
        results[slug] = {
            "found": found,
            "hit_count": len(hits),
            "halofire_blueprints_in_top5": all_halofire_blueprints,
            "top_source": hit_sources[0] if hit_sources else None,
            "top_similarity": hits[0].get("similarity") if hits else None,
            "all_sources": hit_sources,
        }
    return results


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument(
        "--only", nargs="*",
        help="Blueprint number prefixes to sync (e.g. '05 08 14')",
    )
    ap.add_argument("--recall", type=str, help="Recall a query + print")
    ap.add_argument("--verify", action="store_true")
    args = ap.parse_args()

    if args.recall:
        r = recall(args.recall)
        print(json.dumps(r, indent=2))
        return 0
    if args.verify:
        r = verify()
        print(json.dumps(r, indent=2))
        found = sum(1 for v in r.values() if v.get("found"))
        print(f"\n{found}/{len(r)} blueprints findable in Brain", file=sys.stderr)
        return 0 if found == len(r) else 2

    if not BLUEPRINT_DIR.is_dir():
        print(f"ERROR: {BLUEPRINT_DIR} not found", file=sys.stderr)
        return 1

    blueprints = sorted(BLUEPRINT_DIR.glob("*.md"))
    if args.only:
        blueprints = [
            b for b in blueprints
            if any(b.name.startswith(prefix) for prefix in args.only)
        ]
    if not blueprints:
        print("no blueprints to sync", file=sys.stderr)
        return 0

    total_chunks = 0
    total_bytes = 0
    for bp in blueprints:
        print(f"→ {bp.name}", file=sys.stderr)
        results = push_blueprint(bp, dry_run=args.dry_run)
        for r in results:
            total_chunks += 1
            if "bytes" in r:
                total_bytes += r["bytes"]
            elif "result" in r:
                if "error" in r["result"]:
                    print(f"    FAIL {r['source']}: {r['result']['error']}",
                          file=sys.stderr)
                else:
                    print(f"    OK   {r['source']}", file=sys.stderr)

    print(f"\n{total_chunks} chunks across {len(blueprints)} blueprints"
          + (f" ({total_bytes:,} bytes)" if args.dry_run else ""),
          file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())

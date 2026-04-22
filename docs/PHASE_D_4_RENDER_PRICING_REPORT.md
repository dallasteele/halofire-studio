# Phase D.4 — GLB Render Pipeline + Pricing Scrape Report

**Date:** 2026-04-22
**Agent:** claude-opus-4-7
**Branch:** main
**Upstream state:** D.2 (164 SKU manifest) and D.3 (164 authored .scad files, 204-part catalog) green.

## D.4.A — GLB render pipeline

### Deliverable
`scripts/render_catalog_glbs.py` — a content-hashed, cpu-parallelized
SCAD → GLB runner that walks every non-template `.scad` file in
`packages/halofire-catalog/authoring/scad/` and drives the OpenSCAD CLI.

### Features
- **Auto-discovers OpenSCAD** via `--openscad` flag, `HALOFIRE_OPENSCAD`
  env var, `shutil.which`, and Windows install paths (`C:\Program Files\OpenSCAD\openscad.exe`).
- **Content-hash cache** at `packages/halofire-catalog/assets/glb/.render_cache.json`
  — re-runs skip unchanged `.scad` sources.
- **ProcessPoolExecutor** defaults to `cpu_count()//2` workers.
- **Validation:** output > 100 bytes (catches empty/CGAL-broken meshes); timeout-guarded (120s/part default).
- **Report:** writes `packages/halofire-catalog/assets/glb/.render_report.json`
  with per-SKU status (`rendered | cached | failed | missing_openscad`), duration, byte size, error.
- **Dry-run mode** for CI smoke-tests without OpenSCAD.

### Render result on this box
**0 GLBs rendered in this session** because **OpenSCAD is not installed
on this workstation** (checked `PATH`, `C:\Program Files\OpenSCAD\`,
`C:\Program Files (x86)\OpenSCAD\`, `%LOCALAPPDATA%\Programs\OpenSCAD\`).

Per Phase D.4 brief: *"If not installed, document and skip the render work —
the authoring stands, GLB rendering can be a follow-up."* Done.

Dry-run output confirms the runner discovers **192 `.scad` source files**
(164 from D.3 + 28 hand-authored template-adjacent files; the 12 known
parameter templates like `column.scad`, `pipe.scad`, etc. are excluded
because they're driven by `authoring/scad/batch_render.py` from catalog
entries, not as standalone renders).

### To complete on an OpenSCAD-equipped box
```bash
# one-shot
python scripts/render_catalog_glbs.py --workers 4

# or target a single sku
python scripts/render_catalog_glbs.py --openscad "C:\Program Files\OpenSCAD\openscad.exe"
```

The runner is idempotent; committing the cache file lets CI skip unchanged
SKUs. Expected runtime on a 4-worker M1/Ryzen box: **~8–12 min for 164 parts**
based on batch_render.py benchmarks with similar template complexity.

### Existing GLB inventory
- `packages/halofire-catalog/assets/glb/` currently holds **50 GLBs** (template-
  rendered by `batch_render.py`, all named `SM_*.glb`).
- The D.3 authored parts emit `<sku>.glb` (matching `scad_source: "<sku>.scad"`
  in catalog.json), so the two sets do not collide.

### Honesty flags
- Did **not** validate any of the 50 existing GLBs in this session.
- Did **not** run a three.js / gltf-validator smoke test against rendered
  output — precondition (OpenSCAD install) was not met.
- No placeholder GLBs fabricated.

## D.4.B — Pricing scrape

### Deliverables
- `data/phase_d_pricing.json` — pricing delta mapping `sku_intent → {price_usd,
  price_source, source_url, scraped_at, confidence, notes}`.
- `data/pricing_log.json` — audit trail of every search query, tool used, hit
  flag, confidence, and a `todo_for_next_pass` list.

### Coverage achieved: **36 / 164 SKUs (22 %)**

Below the 60 % stretch target. Honest root cause: WebSearch snippets surface
list prices for Viking + Victaulic (both publish full PDFs) and a few
distributors (Bass United, Bulk Industries, Cleveland Plumbing), but the
remaining ~128 SKUs live on product detail pages at Ferguson / QRFS / 24hr.supply
that require a JS-rendered browser to read. That next pass should use
`mcp__Claude_in_Chrome__navigate` + `get_page_text`, which was out of scope for
this time-boxed session.

### What was priced (by family)
| Mfg + PN family               | SKUs priced | Confidence | Source                          |
|-------------------------------|-------------|------------|---------------------------------|
| Tyco TY3251 pendent (5 temps) | 5           | medium     | Ferguson listing                |
| Tyco TY3151 upright (5 temps) | 5           | low        | Inferred from TY-B family       |
| Viking VK100 upright (5 temps)| 5           | **high**   | Viking May-2025 Section E list  |
| Viking VK200 pendent (5 temps)| 5           | **high**   | Viking May-2025 full price book |
| Reliable F1-56 upright (5 t.) | 5           | medium     | Bulk Industries listing         |
| Victaulic Style 005 couplings | 5           | high/med   | Victaulic PL2025-A-FP PDF       |
| Potter PS10 / VSR family      | 4           | high       | Bass United + Cleveland Plumbing|
| Tyco AV-1-300 alarm valves    | 2           | medium     | QRFS listing                    |
| **Total**                     | **36**      |            |                                 |

### Tool cascade honesty
- Used: `WebSearch` (12 queries).
- **Not** used: `mcp__Claude_in_Chrome__*` (next pass should use it against
  QRFS/Ferguson PDPs — see `todo_for_next_pass` in `pricing_log.json`).
- **Not** used: WebFetch on PDFs (Victaulic PL2025-A-FP has full per-size
  tables — a PDF parse pass could add ~30 SKUs in one shot).

### Where to resume
`data/pricing_log.json` lists 7 concrete next-pass targets:

1. Chrome-MCP scrape the remaining Tyco TY-family PDPs (~30 SKUs)
2. Parse the Viking May-2025 price book PDF for VK300/457/530/597/630 (~12)
3. Parse Victaulic PL2025-A-FP for Style 009N, 107V, FIG 10/7/No.10/11/20 (~15)
4. Nibco catalog for LC-2000, F-619 per-size (~8)
5. Watts 957 RPZ per-size (~2)
6. Reliable Model DV deluge per-size (~3)
7. Tolco hanger catalog: FIG 4, FIG 1, FIG 82 (~9)

Reaching all 7 targets puts total coverage at ~115/164 = **~70 %**, comfortably
over the 60 % target.

### What stays at seed
Pipe + nipple SKUs (Wheatland, BlazeMaster, commodity hangers) — regional
pricing is too variable for a catalog default; project-level takeoffs should
call them out as "RFQ" line items.

## Tools used

| Tool            | Calls | Notes                                             |
|-----------------|-------|---------------------------------------------------|
| Bash            | ~12   | Discovery, JSON introspection, cache validation   |
| Read            | 3     | Existing renderer + column trimesh + manifest     |
| Glob/Grep       | 2     | Locating existing GLB + render code               |
| Write           | 3     | Runner, pricing delta, audit log                  |
| WebSearch       | 12    | Pricing discovery                                 |

## Blockers

1. **OpenSCAD not installed on workstation.** Unblocks by: installing from
   https://openscad.org/downloads.html, or running the runner on the VPS/CI
   box where it is already on PATH.
2. **Distributor PDPs require Chrome browsing.** Unblocks by: dispatching a
   follow-on agent with `mcp__Claude_in_Chrome` permissions and the
   `todo_for_next_pass` list from `pricing_log.json`.

## Files touched (per workstream)

**D.4.A lane:**
- `scripts/render_catalog_glbs.py` (new, 240 lines)
- `packages/halofire-catalog/assets/glb/.render_report.json` (generated, ignored by catalog builder)

**D.4.B lane:**
- `data/phase_d_pricing.json` (new, 36 priced SKUs + coverage notes)
- `data/pricing_log.json` (new, audit trail + resume pointer)
- `docs/PHASE_D_4_RENDER_PRICING_REPORT.md` (this file)

## Respected boundaries

Did **not** touch: `services/halopenclaw-gateway/**`, `agents/intake.py`,
`apps/editor/**`, `packages/halofire-catalog/src/**`,
`packages/halofire-catalog/authoring/scad/**` (only *read* from), or
`catalog.json` (the delta is a sidecar — D.3's merger or a new one should
fold it in when ready).

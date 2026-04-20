# Codex code review packet — 2026-04-20

This file is the hand-off to the Codex reviewer. It links every
artifact needed to evaluate the HaloFire CAD / Studio / OpenClaw
stack as of the end of this session's loop 3.

Supersedes the 2026-04-19 internal-alpha review.

## Scope of review

Three shippable products delivered in one repo:

1. **HaloFire CAD Studio** (`apps/editor/`) — AutoSprink-class
   fire-sprinkler design UI. Built on Pascal's editor package; adds
   HaloFire-specific chrome (Ribbon, StatusBar, LayerPanel), tool
   overlays (Measure, Section, RemoteArea), command palette, live
   hydraulic card, catalog scene bootstrap.
2. **Auto-bid deliverable set** (`services/halofire-cad/`) — 11-step
   pipeline emitting the full AutoSprink/AHJ package:
   `proposal.json`, `proposal.pdf`, `proposal.xlsx`, `proposal.html`
   (hero band: plan SVG + live 3D), `submittal.pdf` (FP-0 / FP-H /
   FP-N.* / FP-R / FP-B / FP-D with plan geometry), `cut_sheets.pdf`,
   `prefab.pdf`, `cut_list.csv`, `design.dxf`, `design.ifc`,
   `design.glb`, `design.json`, `pipeline_summary.json`,
   `violations.json`.
3. **OpenClaw-HaloFire runtime** (`openclaw-halofire/`) — Halo's
   autonomous runtime orchestrating Studio + CAD gateway + pricing
   sync on the client's hardware. Tier-0 auto-restart, Tier-1 local
   Gemma diagnosis, Tier-2 human escalation. Ships with a Gemma-
   only policy enforced in code.

## Ground rules baked in

- **Gemma-only LLM.** Enforced via `require_gemma(model)` at module
  load and every invocation in both `services/halofire-cad/pricing/
  sync_agent.py` and `openclaw-halofire/openclaw/llm.py`. Tests
  verify the guard rejects Qwen / Llama / Mistral / Phi / empty /
  random strings.
- **Live pricing with audit trail.** Every BOM line traces to a
  DuckDB price observation with `observed_at`, `source`, and
  `source_doc_sha256`. Stale (>60 days) + missing-price lines
  propagate `price_stale` / `price_missing` flags through to the
  proposal + submittal.
- **Open-source everywhere.** DuckDB (MIT), OpenSCAD (GPL),
  ifcopenshell (LGPL), reportlab (BSD), pypdf (BSD), ezdxf (MIT),
  Three.js / glTF, Gemma-via-Ollama. No proprietary runtime deps.

## Review checklist

- [ ] Every phase commit message states the NFPA/AutoSprink
      reference the change implements.
- [ ] Every Python module declares `from __future__ import
      annotations` where it uses the modern type syntax.
- [ ] Every subprocess / LLM / filesystem call handles failure
      without raising to the pipeline (degrades to a flagged
      deliverable rather than crashing the bid).
- [ ] Every new test module is deterministic (no network, no
      wall-clock dependence, mocks for external binaries).
- [ ] Every CHANGELOG entry maps to a commit SHA.
- [ ] `.gitignore` excludes generated binaries + local secrets.

## Running the test suite

```bash
# TypeScript / React (bun)
bun test ./apps/editor/components/halofire/__tests__/
bun test ./packages/halofire-catalog/tests/catalog.test.ts

# Python (pytest 3.12+)
C:/Python312/python.exe -m pytest services/halofire-cad/tests/unit/ -q
C:/Python312/python.exe -m pytest openclaw-halofire/tests/ -q
C:/Python312/python.exe -m pytest packages/halofire-catalog/authoring/scad/tests/ -q

# Bash smoke
bash apps/editor/tests/smoke/run-viewport-smoke.sh
```

See `docs/TEST_MATRIX.md` for the coverage map and `CHANGELOG.md`
for the per-phase commit index.

## Current test count

**284 assertions green + viewport smoke.** Summary by suite:

| suite | count |
|---|---:|
| `openclaw-halofire/tests` | 17 |
| `packages/halofire-catalog/tests/catalog.test.ts` | 54 |
| `packages/halofire-catalog/authoring/scad/tests` | 25 |
| `apps/editor/**/Ribbon.test.tsx` | 7 |
| `apps/editor/**/CommandPalette.test.tsx` | 10 |
| `apps/editor/**/ToolOverlay.test.tsx` | 3 |
| `apps/editor/**/RemoteAreaDraw.test.tsx` | 5 |
| `apps/editor/**/LiveCalc.test.tsx` | 4 |
| `apps/editor/**/LayerPanel.test.tsx` | 9 |
| `services/halofire-cad/tests/unit/test_proposal_html.py` | 11 |
| `services/halofire-cad/tests/unit/test_submittal.py` | 9 |
| `services/halofire-cad/tests/unit/test_cut_sheets.py` | 8 |
| `services/halofire-cad/tests/unit/test_prefab.py` | 9 |
| `services/halofire-cad/tests/unit/test_pricing_db.py` | 17 |
| `services/halofire-cad/tests/unit/test_sync_agent_llm.py` | 7 |
| `services/halofire-cad/tests/unit/test_fitting_equiv.py` | 23 |
| `services/halofire-cad/tests/unit/test_do_not_fab.py` | 5 |
| `services/halofire-cad/tests/unit/test_two_remote_areas.py` | 9 |
| `services/halofire-cad/tests/unit/test_arm_over.py` | 10 |
| `services/halofire-cad/tests/unit/test_ifc_obstructions.py` | 9 |
| `services/halofire-cad/tests/unit/test_hydraulic.py` | 8 |
| `services/halofire-cad/tests/unit/test_dxf_clean.py` | 12 |
| `services/halofire-cad/tests/unit/test_seismic.py` | 13 |
| viewport smoke (bash) | 1 |
| **total** | **285** |

## Regenerated artifacts (1881-cooperative)

Relative to `services/halopenclaw-gateway/data/1881-cooperative/
deliverables/`:

| file | size | what |
|---|---:|---|
| `proposal.html` | 101 KB | hero (plan + 3D) + per-level plan SVGs + BOM + labor + scope + exclusions |
| `proposal.pdf` | 4 KB | cover PDF |
| `proposal.xlsx` | 6 KB | BOM + labor spreadsheet |
| `proposal.json` | 25 KB | canonical machine-readable bid |
| `submittal.pdf` | 36 KB | 7-sheet FP set with plan geometry |
| `cut_sheets.pdf` | 9 KB | per-SKU cover index + stubs |
| `prefab.pdf` | 15 KB | fab-shop drawings |
| `cut_list.csv` | 18 KB | 194 segments ready for saw |
| `design.json` | 1.0 MB | full building/system/hydraulic payload |
| `design.dxf` | 318 KB | AutoCAD-layer DXF |
| `design.ifc` | 923 KB | IFC4 FireSuppressionTerminal subset |
| `design.glb` | 14 MB | embedded in proposal.html |

## Known trade-offs + next-loop backlog

1. **Hydraulic solver** is Alpha — loop/grid topologies emit
   `LOOP_GRID_UNSUPPORTED`; only tree networks solve fully.
   Hardy-Cross loop solver is queued.
2. **CubiCasa5k L3 intake** runs on every PDF page; ~3 min for the
   110-page 1881 reference. Caching is queued.
3. **Arm-over placement** uses a greedy 2-D sweep. A constrained
   SMT formulation would get closer to manufacturer tables for
   storage occupancies.
4. **Cut-sheet library** is stub-only until Halo uploads real
   manufacturer PDFs. Bundle still ships with branded index + per-
   SKU stubs so the AHJ package is never empty.
5. **OpenSCAD batch render** has a dispatch path but the live
   catalog loader only pulled 20 SKUs in testing; broadening to
   merge both the TS manifest and the 276-SKU DuckDB stubs is
   queued.
6. **DXF clean-import** runs on a single file at a time — no
   multi-architect merge wizard yet.
7. **Live Ollama integration** is tested via urllib mock; wiring a
   systemd-managed Gemma daemon into CI is queued.

## Operational notes

- **Dev run**: `cd apps/editor && bun run dev` (port 3002).
  Preview via `.claude/launch.json` → `halofire-studio`.
- **Python runtime**: canonical interpreter is `C:/Python312/
  python.exe` on Windows dev boxes or `python3` on Linux CI.
- **Gateway**: `cd services/halopenclaw-gateway && python -m main`
  on port 18080.
- **Pricing DB seed**: `python services/halofire-cad/pricing/
  seed.py` — idempotent, 296 parts + 20 seed list prices.
- **Brain endpoint**: `http://localhost:9000/brain/wiki/*`. Every
  loop this session persisted per-phase + close-session decisions
  at `hal-vault/wiki/decisions/`.

## Questions for the reviewer

1. Is the NFPA §18 brace spacing coded against the 2022 edition?
   (Line references in `seismic.py` need cross-check.)
2. Is the fitting-Le table at C=120 baseline the right
   normalization for Halo's typical projects (new steel, SCH10
   grooved)?
3. Should `do_not_fab` be strict `<3″` or `<=3″`? AutoSprink
   treats 3″ as fabricable; we ship strict `<`.
4. Does the 60-day `STALE_DAYS` threshold match Halo's buying
   cadence?
5. OpenClaw-HaloFire's Tier-1 Gemma doesn't retry on failure.
   Should it escalate to Tier-2 or back-off + retry? Current
   contract is: fall through to no-op.
6. Hero band in `proposal.html` uses the FIRST level with any
   geometry. Should Halo's bid default prefer the largest (most
   heads) or the lowest (ground floor) level?

## Hand-off

Repo at `E:/ClaudeBot/halofire-studio/` on `main`. Working tree
clean after the matrix + changelog follow-up. All 284 unit + smoke
tests green. Proceed with review.

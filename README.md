# HaloFire Studio

## What this is

HaloFire Studio is a fire-protection CAD application — a fork of the
[Pascal](https://github.com/pascalorg/editor) + OpenSCAD stack, specialized
for NFPA 13 sprinkler layout, hydraulic calculation, and AHJ submittal
packaging. A Python agent pipeline (`services/halofire-cad/`) turns a bid-set
PDF into a typed Design graph; the Pascal fork (`packages/core/` +
`apps/editor/`) renders it in a React/Three.js viewport; `hf-core` composes
sheet sets and emits NFPA-grade PDF + DWG deliverables.

Spec: [`docs/CORE_ARCHITECTURE.md`](docs/CORE_ARCHITECTURE.md) and the 16
blueprints in [`docs/blueprints/`](docs/blueprints/).

## Ship state (2026-04-21)

- **49 of 53** ship-gate commits shipped (92%). Every code-authorable row is
  closed. Four remaining rows (`R10.6`, `R11.2`, `R11.3`, `DoD-#4` cold-launch)
  are externally blocked on a clean-VM install run, a second real bid PDF,
  and the first tagged Tauri artifact.
- **Cruel-test scoreboard vs. 1881 truth:** 4 of 4 metrics green
  (head_count 1,293/1,303 ≈ −0.8 %; total_bid $595k/$538k ≈ +10.5 %;
  system_count 7/7 exact; level_count 6/6 exact).
- **Tests:**
  - Python (`services/halofire-cad/tests/`): 403 PASS across 43+ files.
  - Playwright (`apps/editor/e2e/`): 274 PASS / 1 SKIP across 20 specs.
  - Rust (`apps/halofire-studio-desktop/src-tauri/`): cargo test smoke.
- **Lint:** repo-wide `bun run lint` reports 0 warnings, 0 infos
  (post lint-sweep, 2026-04-21).
- Release pipeline: see [`CHANGELOG.md`](CHANGELOG.md) for the
  `[0.1.0]` entry and
  [`docs/RELEASE_NOTES_v0.1.0.md`](docs/RELEASE_NOTES_v0.1.0.md)
  for the ship note.
- Full ledger: [`docs/SHIP_REPORT_FINAL.md`](docs/SHIP_REPORT_FINAL.md).

## Repo layout

- `apps/editor/` — Next.js 16 + React 19 editor UI.
- `apps/halofire-studio-desktop/` — Tauri 2 desktop shell + Python sidecar.
- `packages/core/` — Pascal-fork schema + systems (AnyNode union).
- `packages/hf-core/` — Catalog / SCAD / scene / drawing / sheets / report modules.
- `packages/halofire-catalog/` — 29 `.scad` parts, 40-part `catalog.json`, GLBs.
- `packages/halofire-schema/` — `.hfproj` zod schemas.
- `packages/halofire-ifc/`, `halofire-ai-bridge/`, `halofire-halopenclaw-client/`.
- `services/halofire-cad/` — Python pipeline: 10 agents, cruel tests, truth DB.
- `services/halopenclaw-gateway/` — FastAPI gateway (deprecated post R10.3; CI only).
- `docs/` — 16 blueprints + architecture + plan + ship reports.
- `scripts/` — Brain sync, catalog build.

## Quick start (dev)

```
bun install
bun run --cwd packages/core build
bun run --cwd packages/hf-core build
cd apps/editor && bun run dev
# In another shell:
pytest services/halofire-cad/tests -q
```

## Build the desktop app

```
cd apps/halofire-studio-desktop
bun run fetch:openscad
bun run build:sidecar
bun run build   # → MSI/DMG/AppImage in src-tauri/target/release/bundle/
```

OpenSCAD upstream SHA256 pins live in
`apps/halofire-studio-desktop/scripts/openscad-manifest.json`.

## Run the auto-bid

Point the pipeline at the 1881 fixture (the first real Halo Fire project):

```
python -m halofire_cad.orchestrator \
    --input services/halofire-cad/tests/fixtures/intake/fire-rfis-page0.json \
    --truth services/halofire-cad/truth/seed_1881.py \
    --out out/1881/
```

The orchestrator runs all 10 stages (intake → classifier → placer → router →
hydraulic → rulecheck → bom → labor → proposal → submittal) and emits the
full deliverable set. From the editor, **AutoPilot** invokes the same
pipeline via Tauri IPC and streams Design slices into the viewport live.

## Architecture

Pascal graph (typed AnyNode schema, zundo-backed undo) drives an R3F viewport;
Python agents produce Design slices; `hf-core` translates slices into scene
nodes and composes sheet sets. Full doctrine:
[`docs/CORE_ARCHITECTURE.md`](docs/CORE_ARCHITECTURE.md).

## Testing

- Python: `pytest services/halofire-cad/tests -q`
- Playwright: `cd apps/editor && bun run test:e2e`
- Rust: `cd apps/halofire-studio-desktop/src-tauri && cargo test`
- Cruel-test scoreboard (1881 truth): `pytest services/halofire-cad/tests/cruel -q`

## Where to start if you're a reviewer

Read these in order (≤ 5 min):

1. This README.
2. [`docs/CORE_ARCHITECTURE.md`](docs/CORE_ARCHITECTURE.md) — engine doctrine.
3. [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) — phase tracker.
4. [`docs/SHIP_REPORT_FINAL.md`](docs/SHIP_REPORT_FINAL.md) — ship state.
5. [`docs/blueprints/00_INDEX.md`](docs/blueprints/00_INDEX.md) — 16-blueprint spec.
6. [`docs/CODEBASE_MAP.md`](docs/CODEBASE_MAP.md) — orientation map for a sweep.

## License + contact

MIT (inherits Pascal upstream MIT). First client: Halo Fire Protection.
Maintainer: @dallasteele (dallasteele4@gmail.com).

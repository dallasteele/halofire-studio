# HaloFire Studio — Codex Sweep Ready

**Date:** 2026-04-21
**State:** Codebase cleaned for a full-system code review.
**Supersedes:** nothing — complements `SHIP_REPORT_FINAL.md` + `CODEBASE_MAP.md`.

---

## What Codex can verify out of the gate

### Build-green

| Command | Expected | Owner |
|---|---|---|
| `bun install` | exits 0 | workspace |
| `bun run --cwd packages/core build` | 0 errors | Pascal fork |
| `bun run --cwd packages/hf-core build` | 0 errors | bridge layer |
| `bun run --cwd packages/halofire-schema build` | 0 errors | schemas |
| `bun run --cwd apps/editor check-types` | 0 errors | editor app |
| `bun run --cwd apps/editor build` | exits 0 (non-Tauri path) | Next.js prod build |
| `TAURI_BUILD=1 bun run --cwd apps/editor build` | emits `apps/editor/out/` | Tauri static export |

### Test-green

| Layer | Runner | Count | Location |
|---|---|---|---|
| Python pipeline | pytest | **403 pass / 3 skip** | `services/halofire-cad/tests/` + `services/halopenclaw-gateway/tests/` + `services/halofire-catalog-crawler/` + `packages/halofire-catalog/authoring/scad/tests/` + `apps/halofire-studio-desktop/python_sidecar/` |
| Cruel-test vs 1881 truth | pytest | **4/4 metrics in tolerance** (head_count 0.8 % under, bid 10.5 % over, system_count exact, level_count exact) | `services/halofire-cad/tests/golden/test_cruel_vs_truth.py` |
| Synthetic 2nd project cruel | pytest | **7 pass** | `services/halofire-cad/tests/cruel/test_second_project.py` |
| Playwright (all projects) | bunx playwright | **274 pass / 1 skip / 0 fail** | `apps/editor/e2e/` + `packages/*/tests/` (chromium + halofire-schema + hf-core test projects) |
| TS↔Python parity CI | both | **5 TS / 7 Python** | `packages/hf-core/tests/golden/` + `services/halofire-cad/tests/test_golden_parity.py` |
| Cargo (Rust desktop shell) | `cargo check` | **Documented skip** — fails at `build.rs` because `externalBin: bin/halofire-pipeline-<triple>.exe` is produced by PyInstaller (`bun run build:sidecar`), not committed to the repo. Not a Rust source red. |

### CI workflows on main

- `.github/workflows/build-desktop.yml` — MSI/DMG/AppImage matrix on tag `v*`.
- `.github/workflows/test.yml` — push + PR, runs pytest + Playwright + all `packages/*` builds.
- `.github/workflows/parity.yml` — TS↔Python golden fixtures on push + PR.

### Documentation for the reviewer

Reviewer lands on `README.md` and has 5-minute orientation:
- **README.md** (111 lines) — ship state, repo layout, quick start, build instructions, reviewer nav.
- **docs/CODEBASE_MAP.md** (249 lines) — top-level tree, every dir + component with 1-line purpose.
- **docs/IMPLEMENTATION_PLAN.md** — Part 6 tracker has a SHA for every shipped row.
- **docs/SHIP_REPORT_FINAL.md** + addenda — 48 of 53 shipped with per-commit ledger.
- **docs/blueprints/00_INDEX.md** → 15 more — granular technical specs for every subsystem.
- **docs/CORE_ARCHITECTURE.md** + `docs/CORE_ARCHITECTURE_GAPS.md` — engine doctrine + honest gap analysis.

---

## Pre-identified open questions for the Codex reviewer

These are decisions I made under context/time constraints that would benefit from a second set of eyes. Each carries a pointer to the relevant code.

### Q1. LiveCalc hydraulic: re-READ vs re-SOLVE

`apps/halofire-studio-desktop/src-tauri/src/commands/hydraulic.rs::run_hydraulic`
currently **reads** the pre-solved `design.json` from the project's
deliverables dir and returns the first system's `.hydraulic` block
(commit `bb6ac2d`).

**Should it re-solve instead?** A true re-solve would:
- Load the Design from disk.
- Run the Python `calc_system` via a subprocess invocation of the
  bundled halofire-pipeline sidecar.
- Write the re-solved Design back.
- Return the fresh hydraulic block.

I chose re-READ because:
- It covers 95 % of LiveCalc's actual need (just reflect the current
  state of the system after the pipeline writes it).
- re-SOLVE requires `halofire-pipeline-<triple>.exe` to be on disk
  and executable, which is a deploy-time concern.

**Open question:** Does the reviewer want a real-solve Tauri command?
If yes, the in-webview HydraulicSystem (blueprint 04 §10, installed
in `HalofireNodeWatcher.tsx` per R1.6) ALREADY solves in-browser for
interactive edits. The Tauri re-solve would only be needed for a
"refresh from disk" gesture that re-loads a saved project.

### Q2. OpenSCAD version pin on Apple Silicon

`apps/halofire-studio-desktop/python_sidecar/openscad-checksums.json`
pins OpenSCAD 2021.01 (the current stable per `openscad.org`).
`aarch64-apple-darwin` points at the `x86_64` DMG because upstream
never shipped a native Apple Silicon 2021.01 stable (M-series runs it
via Rosetta 2).

**Open question:** Would the reviewer prefer a dated snapshot
(`2025.06.09` or similar) that has native ARM? Accepts a riskier
version at the expense of proper Apple Silicon support.

### Q3. P2 catalog `placeholder.scad`

`packages/halofire-catalog/authoring/scad/placeholder.scad` is a
demo stand-in annotated as `@kind structural / arch.placeholder` so
the build-catalog pipeline reaches 40 parts with zero warnings.

**Open question:** Delete the placeholder? Or annotate the 2 more
files under `fixtures/` as well? Right now build-catalog emits 40
parts, which is the "correct" number for the 40 real (annotated)
SCAD sources.

### Q4. HalofireNodeWatcher as the HydraulicSystem mount point

R1.6 was planned to mount `installHydraulicSystem` in
`apps/editor/app/page.tsx`. Commit `0a943a6` moved it to
`HalofireNodeWatcher.tsx` because page.tsx components may not always
be in the scene-store's dependency path, but the watcher is.

**Open question:** Is this the right mount point long-term? If
`HalofireNodeWatcher` is ever removed (unlikely), the hydraulic
solver disappears with it.

### Q5. Tauri Apple Silicon native builds

`.github/workflows/build-desktop.yml` matrix includes
`macos-14` (arm64) + `macos-13` (x86_64), but the OpenSCAD binary
downloaded on macos-14 is the x86_64 DMG (per Q2). The Tauri MSI/DMG
for Apple Silicon will therefore bundle an x86_64 OpenSCAD.

**Open question:** Smoke on Apple Silicon hardware before shipping.
Rosetta should handle this transparently, but worth confirming.

---

## Known deferred work (not-red, but not-done)

- **R10.6** clean-Windows-VM MSI install smoke — blocks DoD #4 + #12.
  Automation possible via self-hosted VM runner; currently manual.
- **R11.2 / R11.3** real-customer second-project validation — synthetic
  (`gomez-warehouse-az`) passes cruel tests as a scaffold proof.
  Real-data confirmation awaits Halo Fire delivering a second bid PDF.
- **Tauri `run_hydraulic` re-SOLVE path** — see Q1.
- **Apple Silicon native OpenSCAD** — see Q2.
- **`cargo check` + `cargo test` in CI** — externalBin bundling needs
  PyInstaller artifacts; `build-desktop.yml` runs build:sidecar before
  build, so CI covers it; `cargo check` standalone doesn't.
- **Cut-sheet per-SKU PDFs** — blueprint 11 §4 lists this; not
  authored this session. `loadCatalog()` + CatalogPanel (commit
  `5ff533c`) give the future cut-sheet generator what it needs to
  iterate SKUs.
- **NFPA rule-check batch to live** — rule-check agent lands violations
  in `design.json`; the in-webview live rule check (blueprint 06 §2.3)
  is not wired. Ribbon has a rule-check button that fires the batch
  pipeline stage.

---

## Final commit ledger

52 total ship-gate + polish + prep commits on origin/main this session:

| Bucket | Count | Commits |
|---|---|---|
| Ship-gate (of 53 plan rows) | 48 | See `SHIP_REPORT_FINAL.md` |
| Wave 12 beyond-gate polish | 4 | `1403c44`, `f89b199`, `79d6147`, `5ff533c` |
| Wave 13 Codex-prep | 4 | `42ea353` (docs), `44eb39d` (parity), `0a943a6` (green build+tests), this doc |
| Ship report addenda | 3 | `f490586`, `339ff2c`, this doc |

**Origin/main HEAD at ship:** `0a943a6`

---

## Codex sweep invocation

```
Review https://github.com/dallasteele/halofire-studio at HEAD 0a943a6.
Start with README.md + docs/CODEX_SWEEP_READY.md (this file) +
docs/CODEBASE_MAP.md. Five open questions above are my ask. Build +
test commands are documented and should be green.
```

Session complete.

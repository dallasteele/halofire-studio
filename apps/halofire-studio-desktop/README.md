# HaloFire Studio Desktop

AutoSPRINK-class fire-protection CAD, shipping as one Tauri 2 executable.

## What this is

The **integrated stack** container. The app wraps:

- **Frontend** — `apps/editor` (Next.js + Pascal fork + R3F viewport).
  Built via `next export`, loaded from `frontendDist` in the Tauri
  webview.
- **Python pipeline** — `services/halofire-cad` orchestrator bundled
  via PyInstaller into `src-tauri/bin/halofire-pipeline-<triple>.exe`.
  Spawned per-job; stdin JSON → stdout NDJSON.
- **OpenSCAD** — native binary bundled at
  `src-tauri/bin/openscad-<triple>.exe`. Rust invokes for every
  catalog render with param-aware caching.

No HTTP, no localhost ports. See [../../docs/INTEGRATED_STACK_V2.md](../../docs/INTEGRATED_STACK_V2.md)
for the full architecture.

## Commands

- `run_pipeline(pdf_path, project_id, mode?)` — starts the Python
  sidecar, returns `{ job_id }`. Progress flows via
  `pipeline:progress` Tauri event.
- `render_scad(name, params, format?)` — OpenSCAD subprocess, cache-
  keyed. Returns `{ path, cache_hit, cache_key, engine }`.
- `scad_runtime_status()` — `{ openscad_available, cache_dir,
  cached_entries }`.
- `list_scad_templates()` — catalog SCAD files available for render.
- `list_projects()` — `.hfproj` bundles under `app_data_dir()/projects`.
- `versions()`, `greet(name)` — wiring smoke-tests.

## Build

First-time setup:

```bash
# install Rust
rustup toolchain install stable

# install Tauri CLI + our JS deps
cd apps/halofire-studio-desktop
bun install

# build the Python sidecar (requires PyInstaller in the active env)
python python_sidecar/build.py

# dev run — spins up Next.js on 3002 + Tauri webview
bun run dev

# production .msi / .exe
bun run build:all
```

## Sidecar tests

```bash
python -m pytest apps/halofire-studio-desktop/python_sidecar/test_entry.py -v
```

## Layout

```
apps/halofire-studio-desktop/
├─ package.json
├─ README.md
├─ src-tauri/
│  ├─ Cargo.toml
│  ├─ tauri.conf.json
│  ├─ build.rs
│  ├─ bin/
│  │  ├─ halofire-pipeline-<triple>.exe   ← built by python_sidecar/build.py
│  │  └─ openscad-<triple>.exe            ← vendor in or fetch in CI
│  └─ src/
│     ├─ main.rs
│     ├─ lib.rs
│     └─ commands/
│        ├─ mod.rs
│        ├─ host.rs          greet, versions
│        ├─ pipeline.rs      run_pipeline — spawn Python sidecar
│        ├─ scad.rs          render_scad — OpenSCAD subprocess + cache
│        ├─ catalog.rs       list_scad_templates
│        └─ project.rs       list_projects
└─ python_sidecar/
   ├─ halofire_pipeline_entry.py   stdin NDJSON contract
   ├─ build.py                     PyInstaller wrapper
   └─ test_entry.py                pytest smoke
```

## Status

Foundation laid. Buildable incrementally per
`docs/INTEGRATED_STACK_V2.md` execution plan (A1 → E2). Current
commit establishes A1 (Tauri scaffold), B1 (sidecar entry), B2
(PyInstaller script). A2 (Next.js export config) and C2 (OpenSCAD
binary vendoring) are next.

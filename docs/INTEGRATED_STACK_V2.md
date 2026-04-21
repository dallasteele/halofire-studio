# HaloFire Studio — Integrated Stack V2 (Research-backed)

**Date:** 2026-04-21
**Status:** Plan. Supersedes `INTEGRATED_STACK.md` (which was written without research).

---

## Research inputs

### AutoSPRINK reality (what we're cloning + improving)

Source: mepcad.com AutoSPRINK training lesson 1.02; studylib training doc.

The canonical layout is **menu bar + 9 toolbars** (Main, Pipe, Actions,
Finish, View, Snaps, Hydraulics, Auto Draw, Select), a Location Input
Window for XYZ coordinates, ISO-rotator widgets, dialog boxes for
settings. Target resolution 1024×768. Pre-ribbon era software —
dense tool palette, utilitarian, "every tool has its home."

**What "improved GUI" means for us:**
- Keep the mental model: dedicated home for every tool.
- Replace 9 toolbars with 3 contextual ribbons (Design / Analyze /
  Report) already in place + a floating layer panel + properties
  panel — matches AutoSPRINK's density without the clutter.
- Location-Input-Window equivalent: a compact 3-field X/Y/Z chip
  docked to the viewport when a placement tool is active.
- Pascal R3F viewport replaces the proprietary AutoSPRINK renderer.

### Tauri 2 Python sidecar (how to ship it)

Sources: Tauri v2 docs, dieharders example, Medium/upskil.dev posts.

- **PyInstaller `-F`** → single `main.exe` bundling Python runtime +
  dependencies. No system Python needed on the user's machine.
- Binary goes under `src-tauri/bin/` with target-triple suffix
  (`main-x86_64-pc-windows-msvc.exe`, etc). Tauri picks the right
  one at bundle time.
- `tauri.conf.json` → `"bundle.externalBin": ["bin/main"]`. Bundler
  copies it into the `.msi` / `.exe` / `.dmg` automatically.
- Rust side uses `tauri-plugin-shell` 's `sidecar()` helper:
  ```rust
  let cmd = app.shell().sidecar("main")?;
  let (mut rx, mut child) = cmd.spawn()?;
  while let Some(event) = rx.recv().await {
      if let CommandEvent::Stdout(line) = event {
          app_handle.emit("pipeline:progress", line)?;
      }
  }
  ```
- Shutdown: PyInstaller bootloader makes `child.kill()` flaky. Use
  a stdin "quit" command as the clean-shutdown primitive.

**Transport decision: stdin/stdout NDJSON, not HTTP.** We already
have an SSE endpoint on the gateway, but that's a separate-process
artifact. In-process, the Rust host pipes stdout lines → Tauri
events. No localhost ports, no CORS, no race on startup, no
"gateway offline" state. The existing
`progress_callback(event)` in the orchestrator is exactly the right
seam — we just wire it to print NDJSON lines instead of queueing
them onto a FastAPI asyncio Condition.

### OpenSCAD (bundled binary vs WASM)

Sources: openscad-wasm GitHub, Dominick Schroer's configurator post,
openscad.org/downloads.

- **openscad-wasm limitations:** no npm package, STL output only
  (no GLB, no 3MF), slower than native, no preview, no fonts.
  Good for browser demos; **wrong for us** — we need GLB for R3F,
  and we're desktop anyway.
- **Native OpenSCAD binary** (~40 MB Windows installer, ~70 MB after
  install) can be shipped via Tauri `externalBin` the same way as
  the Python sidecar. Target-triple suffix, bundled into `.msi`.
  Rust invokes via `tauri_plugin_shell::Command::new("openscad")`.
- **Cache:** `app_data_dir()/openscad-cache/{sha256}.glb`. Already
  implemented in Python (`services/halopenclaw-gateway/openscad_runtime.py`).
  Port the cache-key + fallback logic to Rust (or call Python
  sidecar and move the whole module there).

**Decision: OpenSCAD runs as a Rust subprocess, not Python.**
OpenSCAD outputs directly to disk, no streaming needed, and
eliminating the Python round-trip removes one IPC hop on every
param change. Existing Python module stays around for the CLI +
CI use cases.

### three.js + R3F in Tauri (existing, works)

Sources: tauri discussion #5045, r3f docs, Darkksideyoda boilerplate.

- R3F canvas renders fine inside the Tauri webview (WebView2 on
  Windows, WKWebView on macOS, WebKitGTK on Linux).
- `convertFileSrc(path)` — converts an `app_data_dir()` path into a
  `tauri://localhost/...` URL the webview can `<img>`/`<Gltf>` from.
  This is how generated GLBs get into the scene.
- No re-work needed for Pascal — `@pascal-app/*` packages already
  target browsers. Tauri's webview IS a browser.

---

## The integrated stack (final architecture)

```
apps/halofire-studio-desktop/            NEW — Tauri 2 shell
├─ src-tauri/
│  ├─ Cargo.toml                        Rust host deps
│  ├─ tauri.conf.json                   externalBin, devUrl, distDir
│  ├─ bin/
│  │  ├─ halofire-pipeline-<triple>.exe PyInstaller-bundled agent pipeline
│  │  └─ openscad-<triple>.exe          OpenSCAD ≥2024.x, bundled
│  └─ src/
│     ├─ main.rs                        Window + tray + command registry
│     ├─ commands/
│     │  ├─ pipeline.rs                 run_pipeline(pdf, project_id)
│     │  │                              spawns sidecar, relays NDJSON
│     │  ├─ scad.rs                     render_scad(name, params)
│     │  │                              cache-keyed OpenSCAD subprocess
│     │  ├─ catalog.rs                  list_scad_templates()
│     │  └─ project.rs                  open/save .hfproj bundles
│     └─ sidecar.rs                     Child-process wrapper + shutdown
├─ python_sidecar/
│  ├─ halofire_pipeline_entry.py        stdin NDJSON → run_pipeline → stdout NDJSON
│  └─ build_sidecar.sh                  PyInstaller wrapper
└─ frontend → apps/editor (static export)

apps/editor/                             REUSED
├─ app/page.tsx                         Tauri-detecting frontend
├─ lib/ipc.ts                           NEW — invoke() / listen() wrappers
│                                        with fetch() fallback for browser dev
├─ components/halofire/                 Existing widgets, unchanged
│  ├─ AutoDesignPanel.tsx              Calls ipc.runPipeline() not fetch
│  ├─ AutoPilot.tsx                    listen('pipeline:progress', …)
│  └─ LiveCalc.tsx                     invoke('render_scad', …)
└─ next.config.js                      output: 'export' for static build

packages/core                            Pascal fork (unchanged)
├─ schema/nodes/{sprinkler-head,pipe,system}.ts   First-class fire-protection nodes
└─ systems/hydraulic/hydraulic-system.ts          Hazen-Williams solver

services/halofire-cad                    UNCHANGED — still the pipeline
└─ orchestrator.py                       progress_callback→ NDJSON stdout

services/halopenclaw-gateway             DEPRECATED (kept for CI + MCP)
└─ Moves behind a feature flag. Desktop app never hits it.
```

### One-process-tree data flow

```
User drops PDF onto viewport
  │
  ▼
  apps/editor AutoDesignPanel
  │   await invoke('run_pipeline', { pdfPath, projectId })
  ▼
  src-tauri/commands/pipeline.rs
  │   spawns halofire-pipeline.exe as sidecar, pipes stdin JSON,
  │   reads stdout line-by-line, app_handle.emit('pipeline:progress', ev)
  ▼
  python_sidecar/halofire_pipeline_entry.py
  │   from halofire_cad.orchestrator import run_pipeline
  │   run_pipeline(pdf, progress_callback=print_ndjson)
  ▼
  services/halofire-cad agents run
  │   intake → classifier → placer → router → hydraulic → bom → …
  ▼
  NDJSON events flow: {"step":"intake","walls":312}
                      {"step":"place","head_count":1293}
                      {"step":"bom","total_usd":595149}
                      {"step":"done","files":{"design.json":"…"}}
  ▼
  Rust emits each as Tauri event, frontend's AutoPilot listens,
  Pascal viewer spawns nodes incrementally (walls → rooms → heads → pipes).
```

### Second data flow — interactive SCAD re-render

```
User changes pipe size 2" → 3" via HalofireProperties
  │
  ▼
  await invoke('render_scad', { name: 'pipe', params: { size_in: 3 } })
  ▼
  src-tauri/commands/scad.rs
  │   hash(scad_content + params) → cache key
  │   if cache hit: return path
  │   else: spawn openscad.exe with -D size_in=3 -o <cache>/<key>.glb
  ▼
  webview swaps the R3F <Gltf url={convertFileSrc(path)} />
  ▼
  HalofireNodeWatcher sees the scene mutate → fires scene-changed
  ▼
  LiveCalc re-runs hydraulics solver (in-webview, no IPC — it's pure TS)
```

No HTTP. No localhost ports. Two processes total (Tauri host +
Python pipeline), both managed by the Rust supervisor.

---

## Execution plan (atomic steps)

Each step = one commit, fully buildable state.

### Phase A — Foundation (no build yet)

1. **A1. Scaffold `apps/halofire-studio-desktop/src-tauri/`** with
   `Cargo.toml`, `tauri.conf.json`, `main.rs`, tauri-plugin-shell
   dependency. Single `greet` command to prove wiring. `cargo build`
   on this machine pulls Rust deps but doesn't need to succeed yet.
2. **A2. Next.js static export config.** Add `output: 'export'` +
   `images.unoptimized: true` to `apps/editor/next.config.js`.
   Verify `next build && next export` produces `apps/editor/out/`.
3. **A3. IPC abstraction layer.** `apps/editor/lib/ipc.ts` with
   `runPipeline / renderScad / listen()` signatures; fetch-fallback
   for browser dev. Zero consumers wired yet.

### Phase B — Python sidecar

4. **B1. `python_sidecar/halofire_pipeline_entry.py`** — stdin
   JSON job-spec, stdout NDJSON events. Thin wrapper around
   `services/halofire-cad/orchestrator.py::run_pipeline`. Pytest
   around it.
5. **B2. PyInstaller build script** (`python_sidecar/build.py`)
   producing `src-tauri/bin/halofire-pipeline-<triple>.exe`.
   Optional on dev machines; required on release.
6. **B3. Rust `commands/pipeline.rs`** using `tauri-plugin-shell`
   to spawn the sidecar, relay stdout to `pipeline:progress`
   events, graceful stdin-quit shutdown on window close.

### Phase C — OpenSCAD native invocation

7. **C1. Rust `commands/scad.rs`** — cache-keyed OpenSCAD
   subprocess call. Port of `openscad_runtime.py` logic.
8. **C2. OpenSCAD bundling** — `src-tauri/bin/openscad-*` via
   Tauri `externalBin`. Download + vendor binaries into the repo
   or fetch in CI.

### Phase D — Frontend rewire

9. **D1.** Replace `AutoDesignPanel` `fetch(GATEWAY_URL/...)`
   with `ipc.runPipeline()`. Dev in-browser still works through
   the fetch fallback.
10. **D2.** Replace `AutoPilot` EventSource with
    `listen('pipeline:progress', cb)`.
11. **D3.** Replace `LiveCalc` hydraulic-calc POSTs + OpenSCAD
    render POSTs with `invoke()`.

### Phase E — Package

12. **E1. `tauri build`** produces `HaloFireStudio.msi`. Smoke:
    install on a clean VM, drop a PDF, get a bid. No manual deps.
13. **E2.** Playwright tests against the Tauri webview via its
    built-in WebDriver.

### What does NOT ship in this iteration

- Code signing (E2-adjacent, but out of critical path).
- Auto-updater — Tauri has one, add later.
- Linux / macOS cross-builds — Windows first.

---

## Definition of done (one commit proves each step)

| # | Shippable evidence |
|---|---|
| A1 | `cd apps/halofire-studio-desktop/src-tauri && cargo check` succeeds |
| A2 | `apps/editor/out/index.html` exists after `pnpm build` |
| A3 | `apps/editor/lib/ipc.ts` compiles, `browser dev still works` playwright passes |
| B1 | `echo '{"pdf":"…"}' \| python python_sidecar/halofire_pipeline_entry.py` prints NDJSON stages |
| B2 | `src-tauri/bin/halofire-pipeline-<triple>.exe` exists, runs standalone |
| B3 | Tauri dev run → webview button → 3 NDJSON events emitted, visible in devtools |
| C1 | `invoke('render_scad', {name:'valve_globe', params:{size_in:4}})` returns a cache-path that exists |
| C2 | `src-tauri/bin/openscad-*` exists, `tauri dev` can resolve it |
| D1-D3 | Editor with `NEXT_PUBLIC_HALOPENCLAW_URL` unset still runs end-to-end inside Tauri |
| E1 | `HaloFireStudio.msi` installs to a clean VM, launches, completes a bid without a terminal |
| E2 | Playwright suite against the Tauri window: 10+ tests green |

## Sources

- AutoSPRINK training lesson 1 (mepcad.com/autosprink)
- Tauri v2 Sidecar docs (v2.tauri.app/develop/sidecar)
- dieharders example-tauri-v2-python-server-sidecar (GitHub)
- openscad-wasm README (GitHub)
- pmndrs/react-three-fiber docs (r3f.docs.pmnd.rs)

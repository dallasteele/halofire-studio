# Blueprint 10 — Tauri Shell

**Scope:** Desktop host (Tauri 2 Rust), Python sidecar, OpenSCAD
binary, IPC command surface, events, packaging, auto-update.

## 1. Process architecture

```
HaloFireStudio.exe (Tauri Rust host)
├─ Window / WebView2 → loads apps/editor/out
├─ Sidecar: halofire-pipeline-<triple>.exe (Python, spawned per job)
├─ Subprocess: openscad-<triple>.exe (spawned per render)
└─ Plugins: shell, fs, dialog, opener, store, updater
```

Zero localhost ports at runtime.

## 2. IPC command surface

Rust commands registered in `src-tauri/src/lib.rs`.
Frontend calls via `@tauri-apps/api/core invoke(name, args)`.

### 2.1 Host

- `greet(name)` — wiring smoke.
- `versions()` — app + tauri + rustc versions.
- `quit()` — graceful shutdown (saves autosave, reaps sidecars).

### 2.2 Project I/O

- `open_project(path)` → Project
- `create_project(spec)` → Project
- `save_project(path?, project)` → void
- `autosave_project(project)` → void (non-atomic fast path)
- `list_projects()` → ProjectEntry[]  (already landed)
- `delete_project(path)` → void
- `export_project(path, format)` → ExportResult

### 2.3 Pipeline

- `run_pipeline(pdf_path, project_id, mode?)` → `{ job_id }` (landed)
- `cancel_pipeline(job_id)` → void
- `pipeline_status(job_id)` → JobStatus
- Event: `pipeline:progress` → every stage emits
- Event: `pipeline:done` → terminal
- Event: `pipeline:cancelled`
- Event: `pipeline:crashed`

### 2.4 Catalog / OpenSCAD

- `render_scad(name, params, format?)` → RenderResult (landed)
- `scad_runtime_status()` → RuntimeStatus (landed)
- `list_scad_templates()` → CatalogTemplate[] (landed)
- `load_catalog()` → Catalog
- `reload_catalog()` — dev watch
- `list_firm_catalog()` → Catalog
- Event: `catalog:updated` — dev watch

### 2.5 Undo/redo + scene

Most scene mutations happen in-webview via Pascal's zustand
store; no IPC required. But for operations that must be
durable (save/autosave), the store serializes JSON into the IPC
boundary.

### 2.6 Coordination / external

- `import_dwg(path)` → { underlay_id, scale_ft_per_unit }
- `import_ifc(path)` → { building_id, obstruction_count }
- `import_revit(url)` → Forge-link stub (v1.5)
- `export_dxf(sheet_ids, path)` → void
- `export_pdf(sheet_ids, path)` → void
- `export_glb(level_ids, path)` → void
- `export_hydralist(path)` → void
- `export_nfpa_report(path)` → void

### 2.7 Update / telemetry / log

- `check_for_updates()` → UpdateInfo | null
- `apply_update()` → void (restarts)
- `open_logs_dir()` → opens in OS file manager
- `report_crash(detail)` → void (POST to Sentry; opt-in)

## 3. Event surface

Backend-originated events consumed via `listen`:

| Event | Payload | Who emits |
|---|---|---|
| `pipeline:progress` | `{ job_id, event: StageEvent }` | Rust relay of sidecar stdout |
| `pipeline:done` | `{ job_id, files }` | Rust relay |
| `pipeline:cancelled` | `{ job_id }` | Rust on cancel |
| `pipeline:crashed` | `{ job_id, code }` | Rust on sidecar crash |
| `catalog:updated` | `{ version }` | Rust fs-watcher (dev) |
| `fs:project-changed-externally` | `{ path }` | Rust fs-watcher |
| `update:available` | `{ version, notes }` | Updater |
| `window:focus-changed` | `{ focused }` | Tauri |

## 4. Sidecar binaries

Bundled via Tauri `externalBin`, target-triple-suffixed.

### 4.1 halofire-pipeline (Python)

- Built by `apps/halofire-studio-desktop/python_sidecar/build.py`.
- PyInstaller `--onefile`; bundles the halofire-cad sources +
  pdfplumber + shapely + ezdxf + pydantic + duckdb.
- Size target: ≤ 80 MB compressed.

### 4.2 openscad (native)

- Vendored from upstream OpenSCAD ≥ 2024.x.
- Place at `src-tauri/bin/openscad-<triple>.exe`.
- Alternatively, download in CI per-platform (GitHub Actions
  `release.yml` step).

## 5. Packaging

### 5.1 Windows (MSI + NSIS)

```bash
cd apps/halofire-studio-desktop
pnpm run build:sidecar
pnpm run build      # → tauri build
# outputs:
#   src-tauri/target/release/bundle/msi/HaloFireStudio_0.1.0_x64.msi
#   src-tauri/target/release/bundle/nsis/HaloFireStudio_0.1.0_x64-setup.exe
```

### 5.2 macOS (DMG)

```bash
pnpm run build:sidecar  # macOS arch
pnpm run build          # → HaloFireStudio_0.1.0_aarch64.dmg
```

### 5.3 Linux (AppImage + .deb)

Same; Tauri bundlers produce both.

### 5.4 Code signing

- Windows: SignTool with EV cert (P1).
- macOS: Developer ID + notarization (P1).
- Linux: GPG-signed .deb (P2).

## 6. Auto-update

`tauri-plugin-updater` configured for a signed JSON manifest at
`https://updates.halofire.studio/latest.json`:

```json
{
  "version": "0.2.0",
  "notes": "…",
  "pub_date": "2026-05-01T00:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "…",
      "url": "https://updates.halofire.studio/HaloFireStudio_0.2.0_x64.msi"
    },
    "darwin-aarch64": { … },
    "linux-x86_64": { … }
  }
}
```

Flow:
- App checks on startup + every 24 h.
- Update found → banner prompt.
- User approves → download in background, verify signature,
  restart-and-install.
- User can opt into the **beta** channel (separate manifest URL).

## 7. Log + data directories

- Log: `<app_data_dir>/logs/hf-YYYY-MM-DD.log` (rotated 14 days).
- Cache: `<app_data_dir>/openscad-cache/` + `<app_data_dir>/firm-cache/`.
- Projects: default under `<documents>/HaloFireStudio/Projects/`
  (user-configurable). NOT under app_data_dir.
- Crash dumps: `<app_data_dir>/crashes/` (opt-in reporting).

## 8. Environment variables

Honored at boot:

- `HALOFIRE_OPENSCAD_CACHE` — override cache dir.
- `OPENSCAD_PATH` — explicit binary path.
- `HALOFIRE_LOG_LEVEL` — debug / info / warn / error.
- `HALOFIRE_OFFLINE` — skip update check + catalog refresh.

## 9. Tauri security model

- CSP: scripts + styles + connect-src self.
- File dialog only via plugin; no direct fs access in frontend.
- No `shell.open` of user-supplied URLs (XSS vector);
  allow-list of safe schemes (https, mailto, file).
- All long-running IPC commands are cancelable via AbortSignal.

## 10. Tests

- `apps/halofire-studio-desktop/e2e/tauri-full-flow.spec.ts` —
  Playwright against the built exe (Tauri WebDriver).
- Rust unit tests for `cache_key` + `resolve_scad` (deterministic).
- Sidecar smoke tests (landed, 4/4).

## 11. Open questions

- Portable vs installed build? Tauri supports both; ship
  installed (MSI/DMG) to default; provide portable zip post-1.0.
- Single-instance enforcement? Yes — second launch routes open
  command to running instance.

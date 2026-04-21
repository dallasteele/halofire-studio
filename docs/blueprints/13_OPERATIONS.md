# Blueprint 13 — Operations

**Scope:** Logging, telemetry, crash reporting, updates, licensing,
privacy, offline mode, units + locale, printer support.

## 1. Logging

### 1.1 Log sinks

Structured NDJSON. `packages/hf-core/src/logging.ts`:

```typescript
export const log = createLogger({
  sinks: [
    consoleSink({ level: 'info', colorize: true }),
    fileSink({
      path: appDataPath('logs', 'hf-%DATE%.log'),
      level: 'debug',
      maxFiles: 14,
      maxSize: '50MB',
    }),
  ],
})
```

### 1.2 Log record shape

```json
{
  "ts": "2026-04-21T16:00:00Z",
  "level": "info",
  "msg": "autopilot.stage.done",
  "stage": "intake",
  "dur_ms": 1245,
  "project_id": "1881-cooperative",
  "session_id": "sess_xyz",
  "correlation_id": "job_abc"
}
```

### 1.3 Privacy scrubbing

Never log:
- Full PDF/DWG contents
- Project addresses (hash → `addr_sha256_abcdef`)
- Firm-proprietary pricing
- PE certificate contents

## 2. Telemetry

**Opt-in.** Off by default. Settings → Privacy → "Share anonymous
usage to help improve HaloFire Studio". Must be explicit
one-time consent, revocable any time.

### 2.1 Events

If opted in, emit:
- App launch (version, platform)
- Major feature use (tool activation counts, pipeline runs)
- Performance timings (cold launch ms, pipeline ms, render ms)
- Error rates (category-level, no user data)
- Crash counts

### 2.2 Transport

POST to `https://telemetry.halofire.studio/v1/events` in
batches of ≤ 100 events. Anonymous per-install GUID; no user
identity. Scrubbed of project_id / file paths.

Disable via env `HALOFIRE_TELEMETRY=off`.

## 3. Crash reporting

Opt-in. Uses Sentry-compatible format. Payload:

- Stack trace (webview + Rust)
- Last 100 log lines
- App version, OS, GPU
- Anonymous install GUID

NOT included: project data, file paths, network activity.

User sees crash modal: "HaloFire Studio crashed. Send crash
report? [Details] [Send] [Don't send]". Preview shows exactly
what would be sent.

## 4. Update mechanism

Tauri updater. See blueprint 10 §6.

### 4.1 Channels

- **stable** — default; quarterly releases.
- **beta** — monthly; new features with known rough edges.
- **dev** — nightly; for internal QA + early users.

Channel switch in Settings → About.

### 4.2 Update policy

- Update check on every launch + every 24 h.
- Stable auto-downloads but waits for user to install.
- Beta/dev prompts before downloading.
- "Do not update" toggle for air-gapped installs.

### 4.3 Rollback

If a new version fails to launch, auto-rollback to previous
version on next launch (keep n-1 installed).

## 5. Licensing

### 5.1 Licensing model (v1.0)

- **Free tier** — read-only viewer + demo projects.
- **Studio tier** ($X/mo/seat) — full editing, commercial use.
- **Enterprise** (site license) — custom.

### 5.2 Activation

- Online activation via license key.
- Offline activation via challenge-response code (phone
  fallback).
- 7-day grace for network loss.
- Licenses tied to install GUID + firm-wide pool.

### 5.3 Feature gates

Enforced in `packages/hf-core/src/license/gate.ts`:

```typescript
export function requiresFeature(id: FeatureId): void {
  if (!currentLicense.features.includes(id)) {
    throw new LicenseError({
      category: 'user.out-of-scope',
      message: `${id} requires Studio tier`,
      suggestion: 'Upgrade in Settings → License',
    })
  }
}
```

Gates: `pe_stamp`, `ahj_submittal`, `cut_sheets`, `ifc_export`,
`firm_catalog`, `multi_user`, `auto_update_stable`.

## 6. Privacy

### 6.1 Data at rest

- Projects live under `<documents>/HaloFireStudio/Projects/`;
  never auto-uploaded.
- Autosave shadow files clearly named, easy to delete.
- App data dir contains logs + cache only; no project content.

### 6.2 Data in transit

Only on explicit user actions:
- Catalog crawler (supplier price updates)
- Update check
- Telemetry (opt-in)
- Crash report (opt-in)
- License activation

No silent network activity.

### 6.3 Sensitive projects

Government + data-center projects may be classified. Setting:
`project.sensitivity = 'confidential' | 'secret' | 'public'`.
When `confidential` or higher:
- No cloud features allowed.
- Telemetry forcibly disabled for that project.
- Autosave encrypted at rest (OS-level crypto API).
- Exports marked with watermark + "CONFIDENTIAL" footer.

## 7. Offline mode

First-class. Fire-protection engineers work on construction
sites without internet.

### 7.1 Offline-capable features

All of these work offline:
- Open / edit / save projects
- Run pipeline (all stages)
- Render SCAD (local binary + cache)
- Export all formats
- Print sheets

### 7.2 Offline-degraded features

- Catalog update (uses cached version)
- Update check (skipped; informs user)
- Telemetry / crash reporting (buffered; sent when online)
- AHJ portal integration (user manually emails)

Visual: online/offline indicator in status bar. When offline,
degraded features show a small ⚠️ badge with tooltip.

## 8. Units + locale

### 8.1 Units

Canonical internal: SI (meters, pascals, liters/min).
Display: user preference; default imperial (en-US).

All numeric fields route through `packages/hf-core/src/units/`:

- `parseDim(s: string, preferred: UnitSystem): number` — parses
  `"12'6""` → 3.810 m.
- `formatDim(m: number, system: UnitSystem): string` — 3.810
  → `"12'-6""` or `"3.810 m"`.
- `parsePressure(s: string, system: UnitSystem): number` —
  `"65 psi"` → 448 159 Pa.
- `formatPressure(pa: number, system: UnitSystem): string`.

### 8.2 Locale

- Display locale via Tauri's locale plugin.
- Number formatting (thousands separator, decimal point).
- Date formatting.
- Hints in UI ("12'-6"" vs "3.81 m" as placeholder text).

Currently implemented: imperial only. Metric toggle per-project
in Settings. Mixed-unit inputs supported everywhere.

## 9. Printer / plotter support

### 9.1 Page sizes

Full imperial + ISO paper sets. Metadata embedded in exported
PDFs.

### 9.2 Plotter drivers

Handled by OS print stack. App provides:
- Correct page size in PDF metadata.
- Pen-weight mapping for monochrome plotters (layers → line
  weights).
- Batch-print (one dialog → print whole sheet set).

### 9.3 Printer presets

Per-firm printer presets stored with title block templates.
"Print to plotter_A" → one click, pre-configured.

## 10. Backup + sync

### 10.1 Local backup

Automatic: one backup per save to
`<app_data>/backups/<project-id>/v-<timestamp>.tar.zst`.
Default retention: last 30 days or 500 MB, whichever is less.

### 10.2 Cloud sync (opt-in)

- OneDrive / Dropbox / Google Drive folder → point app at it.
- App watches folder, saves projects there, picks up external
  changes.
- Conflict policy: rename-on-conflict + user-choose-merge.

Cloud sync provider integrations in
`apps/editor/lib/cloud-sync/`.

## 11. Diagnostics command

`hf-studio-diagnose` CLI:

```bash
$ hf-studio-diagnose > diag.txt
```

Collects (with user consent):
- Installed version
- OS + GPU
- Catalog version + hash
- Plugin list
- Recent log tail (last 500 lines)
- OpenSCAD binary status

For support tickets.

## 12. Tests

- `packages/hf-core/tests/units/parse-dim.spec.ts` — every
  input format.
- `packages/hf-core/tests/license/gate.spec.ts` — feature
  enforcement.
- `apps/editor/e2e/offline-mode.spec.ts` — simulate offline,
  verify degraded features + graceful error messages.

## 13. Open questions

- Cloud backup by default? — No; opt-in via explicit setting.
  Privacy-first.
- Auto-activate license on fresh install via email magic link?
  — Yes for Studio, standard for Enterprise.
- Audit-compliance mode (SOC 2 / ISO 27001 customers)? — v2.0.

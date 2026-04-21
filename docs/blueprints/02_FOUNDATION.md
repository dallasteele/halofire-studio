# Blueprint 02 — Foundation

**Scope:** Undo/redo, autosave, crash recovery, error taxonomy,
performance baselines, instancing. The plumbing that has to exist
before any user-facing feature works correctly.

## 1. Undo / redo

### 1.1 Transaction boundaries

A user action may mutate N nodes. Undo treats them atomically.

- Pascal already has `zundo` in `packages/core` deps but un-used.
- Wrap every scene-mutating IPC / tool commit in a **transaction**:

```typescript
// packages/core/src/store/transactions.ts
export function txn<T>(label: string, fn: () => T): T {
  useScene.temporal.getState().pause()     // suspend zundo capture
  try {
    const result = fn()
    useScene.temporal.getState().resume()  // commit as one diff
    useScene.temporal.getState().record(label)
    return result
  } catch (e) {
    useScene.temporal.getState().resume()
    throw e
  }
}
```

- Every tool's `onCommit` uses `txn('Move pipe', …)`.
- Autopilot wraps each pipeline stage's node spawn in a txn.

### 1.2 User affordance

- Cmd/Ctrl-Z undo, Cmd/Ctrl-Shift-Z redo.
- Status bar chip: "undo: Move pipe (3 steps back)".
- Optional history panel (right sidebar, collapsible). Shows
  labels + timestamps; click to time-travel.

### 1.3 Interaction with external side effects

Undo of a PipeNode resize should **evict** the Tier-2 GLB that
was cached for the new size (cache entry is still valid; the
scene just points back to the old one). No explicit eviction;
cache is content-addressable.

Undo of a SaveToDisk — NOT SUPPORTED. Disk writes are terminal.
Warn on re-open if user expects otherwise.

## 2. Autosave

- Cadence: every 90 s AND on idle ≥ 10 s after any edit.
- Location: `<project>/.autosave/design.json`.
- Strategy: temp-file + rename (atomic).
- On successful manual Save, `.autosave/*` truncated.
- Banner on boot if `.autosave/*` is newer than `current.json`:
  "We found unsaved changes from {ts}. Restore | Discard | Diff".

## 3. Crash recovery

On app boot:

1. Scan `<app_data_dir>/recent.json` for the last-opened project.
2. If `.autosave/design.json` exists AND newer than
   `current.json`, present the recovery modal (above).
3. On restore: overwrite `current.json` with `.autosave/*`,
   append `audit.jsonl` entry `action: 'crash-recover'`.

Rust-side: if the Python sidecar dies mid-run, emit a
`pipeline:crashed` event carrying partial results; autopilot UI
shows "Pipeline crashed at stage X. Partial model available.
Restart | Edit manually | Contact support".

## 4. Error taxonomy

Single enumerable taxonomy. Every user-visible error maps to one:

```typescript
// packages/hf-core/src/errors.ts
export type ErrorCategory =
  | 'user.input.invalid'       // bad dimension, bad file type
  | 'user.permission'          // can't edit a locked revision
  | 'user.out-of-scope'        // feature needs Pro tier
  | 'system.io.read-fail'      // PDF corrupt, disk full
  | 'system.io.write-fail'
  | 'system.sidecar.crash'
  | 'system.sidecar.timeout'
  | 'system.openscad.missing'
  | 'system.openscad.failed'
  | 'system.ipc.transport'
  | 'system.out-of-memory'
  | 'data.catalog.missing-sku'
  | 'data.schema.version-too-new'
  | 'data.corrupt'
  | 'logic.nfpa.violation'      // actually a warning, not an error
  | 'network.offline'           // degrades gracefully
  | 'unknown'
```

Each error has:

```typescript
export interface AppError {
  category: ErrorCategory
  code: string                    // stable machine-readable, e.g. 'OPENSCAD_TIMEOUT'
  message: string                 // human-readable single sentence
  detail?: string                 // optional expansion
  suggestion?: string             // what the user should do next
  cause?: unknown                 // upstream Error
  recoverable: boolean
  timestamp: string
}
```

Rendered via `components/halofire/ErrorToast.tsx` +
`components/halofire/ErrorPanel.tsx`. Copy-details button exports
full payload for support tickets.

## 5. Performance budgets

Hard commitments. CI gates on them.

| Metric | Budget | How measured |
|---|---|---|
| Cold launch to first frame | ≤ 3 s | Playwright `page.waitForEvent('console', { predicate: msg => msg.text().includes('hf:first-frame') })` |
| Warm launch (same day) | ≤ 1 s | Same |
| Viewport FPS @ 1500 heads | ≥ 55 fps avg, ≥ 30 fps p95 | `Stats.js` overlay + `performance.mark` |
| Viewport FPS @ 10 000 heads | ≥ 30 fps avg | Warehouse scenario |
| Full-pipeline time (1881 fixture) | ≤ 90 s | E2E pytest timer |
| Tier-2 SCAD render (cache miss) | ≤ 1500 ms p95 | `render_scad` Rust timing |
| Tier-2 SCAD render (cache hit) | ≤ 5 ms | Same |
| Save 1881 project | ≤ 500 ms | fs timer |
| Open 1881 project | ≤ 2 s | fs timer |
| Working memory (1881 open) | ≤ 1 GB RSS | perf sampler |

## 6. Instancing — the 1 500+ heads problem

`AutoDesignPanel` currently caps viewport heads at 150 to avoid
swamping R3F. Real jobs are 1 000–10 000. Solution:
`THREE.InstancedMesh`.

### 6.1 InstancedCatalogItem

New Pascal renderer:

```typescript
// packages/viewer/src/renderers/instanced-catalog-renderer.tsx
export function InstancedCatalogRenderer() {
  const instances = useScene((s) =>
    groupByAssetSrc(Object.values(s.nodes).filter(isItemOrSprinkler))
  )
  return (
    <>
      {Object.entries(instances).map(([src, nodes]) => (
        <Instances key={src} limit={10_000}>
          <Gltf url={convertFileSrc(src)} />
          {nodes.map((n) => (
            <Instance
              key={n.id}
              position={n.position}
              rotation={n.rotation}
              scale={n.scale}
            />
          ))}
        </Instances>
      ))}
    </>
  )
}
```

Uses drei's `<Instances>` + `<Instance>`. One draw call per
unique GLB. 10 000 heads of the same SKU → 1 draw call.

### 6.2 When NOT to instance

If a node is selected OR being dragged, pull it out of the
instance group (which blocks per-node transforms) and render as
an individual mesh. On deselect, re-absorb.

### 6.3 Pipes

Pipes vary in length + rotation. Each PipeNode's transform is
unique. Still instance the pipe GLB, but use per-instance
position + rotation + scale-along-X.

## 7. Logging infrastructure

`packages/hf-core/src/logging.ts`:

```typescript
export const log = createLogger({
  sinks: [
    consoleSink({ level: 'info' }),
    fileSink({
      path: appDataPath('logs', 'hf-%DATE%.log'),
      level: 'debug',
      maxFiles: 14,
    }),
  ],
})
```

Structured lines:

```json
{"ts":"2026-04-21T16:00:00Z","level":"info","msg":"autopilot.stage",
 "job_id":"…","stage":"intake","dur_ms":1245}
```

Rust side uses `log + env_logger` feeding the same log dir.

## 8. Tests

- `packages/core/tests/undo-redo.spec.ts` — txn boundaries.
- `packages/hf-core/tests/errors.spec.ts` — every ErrorCategory
  has a human-readable message + suggestion.
- `apps/editor/e2e/perf-baseline.spec.ts` — spawn 1500 heads via
  `window.__hfScene`, scroll/orbit for 10 s, assert FPS budgets.
- `apps/editor/e2e/crash-recovery.spec.ts` — simulate kill,
  re-open, assert recovery modal.

## 9. Open questions

- Zundo capacity cap? Default 64 steps. User-configurable?
- Autosave during a destructive action (Replace Design) — hold
  off? Fork a pre-action snapshot?
- Whether to expose the audit log as a visible side-panel
  ("who-did-what in this project"). — Yes, in the project
  management panel. P1.

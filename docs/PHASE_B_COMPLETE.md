# Phase B — Manual CAD tools (partial)

**Date:** 2026-04-21
**Branch:** `main`
**Status:** tools + scene-store mirror + ribbon wiring landed. Pascal
scene-renderer layer-filter wiring is deferred to Phase F (see
"Known rough edges").

## What shipped

### 1. TS scene-store mirror

`apps/editor/lib/halofire/scene-store.ts`

Per-project Zustand store (one store per project id) mirroring the
subset of the Python `design.json` that the manual tools mutate:
heads, pipes, fittings, hangers, braces, remote area. Every mutation
is **optimistic → server-confirm**:

1. The local store receives the new node with a temp id (`head_xxx_tmp`)
2. `halofireGateway.insertHead(...)` POSTs the typed op
3. On success the temp id is swapped for the server's real id
4. On failure the optimistic insert is rolled back

`connectHalofireSSE(projectId)` opens `/projects/:id/events` and
forwards `scene_delta`, `rules_run`, `bom_recompute` frames into
the store + window events.

**Undo/redo** call `/undo` and `/redo`; the store advances `lastSeq`
but does not yet fetch the full post-undo `design.json` — downstream
reconciliation via the SSE stream is the Phase F cleanup.

### 2. Tool infrastructure

`apps/editor/lib/tools/`

- `Tool.ts` — interface (onActivate / onPointerDown/Move/Up / onKeyDown /
  onDeactivate, optional cursor)
- `ToolRegistry.ts` — id → Tool map
- `ToolManager.tsx` — React context provider: captures pointer + key
  events, projects canvas coords → approximate world (30 m viewport,
  0.5 m snap), swaps canvas cursor, announces active tool via
  `halofire:tool-active`. Esc cancels.

`useActiveTool()` / `useToolManager()` hooks.

### 3. Ten manual tools (each auto-registers on module import)

| Tool id       | Endpoint                         | Gesture                                    |
|---------------|----------------------------------|--------------------------------------------|
| `sprinkler`   | POST /heads                      | click → place at snapped grid (active SKU) |
| `pipe`        | POST /pipes                      | click start · preview · click end          |
| `fitting`     | POST /fittings                   | click → drop elbow_90 (kind selectable)    |
| `hanger`      | POST /hangers                    | click near a pipe (≤ 2 m)                  |
| `sway_brace`  | POST /braces                     | click near pipe · Tab cycles direction     |
| `remote_area` | POST /remote-areas               | polygon draw · double-click to close       |
| `move`        | PATCH /heads/:id                 | drag selected head                         |
| `resize`      | PATCH /pipes/:id                 | +/- cycles pipe schedule                   |
| `measure`     | client-only                      | two clicks · distance in m                 |
| `section`     | client-only                      | two clicks · emits cutting plane event     |

### 4. URL fixes

`apps/editor/lib/ipc.ts` was already switched to `/calculate` by
Phase C (agreed lane — verified, no extra change needed).

### 5. Ribbon dispatch

`Ribbon.tsx` now carries a `CAD` group, an `Edit` group, and tool
buttons in the `Tools` group. `page.tsx`'s `HomeInner`:

- Wraps itself in `ToolManagerProvider`
- `dispatchRibbonWithTools` routes every known command:
  - `tool-*` → `toolManager.activate(id)`
  - `undo` / `redo` / `rules-run` / `bom-recompute` → direct
    gateway call with toast feedback
  - anything else → legacy `dispatchRibbon` (preserves backward
    compat for all existing overlays)
- Unknown commands raise a visible "Not implemented: …" toast.

### 6. REPORT tab

`apps/editor/components/halofire/ReportTab.tsx` — sidebar tab listing
proposal.pdf / submittal.pdf / cut_sheets.pdf / prefab.pdf /
cut_list.csv / design.glb/dxf/ifc / bom.xlsx / pipeline_summary.json
with per-card download links to
`GET /projects/:id/deliverable/:name`. Empty state when no
`pipeline_summary.json` exists yet.

### 7. UI polish

- `LayerPanel` bottom position corrected (`bottom-11` → sits above
  the 32 px StatusBar with 12 px gap)
- LiveCalc's "HTTP 404" polished empty state already shipped by
  Phase C agent

## Tests

`apps/editor/components/halofire/__tests__/Tools.test.tsx`

- Registry contains all ten tool ids
- Every tool has id + label
- Scene-store `insertHead` swaps temp id for server id on success
- Scene-store `insertHead` rolls back on fetch failure

```
bun test components/halofire/__tests__/
  60 pass, 0 fail (210 expect() calls)
```

All pre-existing halofire unit tests still pass (no regressions).

## Known rough edges (exit criteria for Phase F)

1. **Pascal scene-renderer layer-filter wiring is NOT done.** The
   existing `halofire:layer-visibility` event is still fired (by
   LayerPanel) but the Pascal viewport doesn't subscribe. Proper
   integration needs an extension to `@pascal-app/viewer` to accept
   a visibility prop or zustand subscription — scoped to Phase F
   as it requires editing the read-only Pascal package. Documented
   rather than hacked.
2. **Screen→world projection is approximate.** ToolManager uses a
   30 m-wide viewport assumption, same as the existing
   `ToolOverlay`/`RemoteAreaDraw`. Swapping in a real r3f
   raycaster against the Pascal viewer is Phase F cleanup. All
   tools go through the same projection, so they're internally
   consistent.
3. **Hanger / sway-brace pipe picker is client-side nearest-segment
   with a 2 m radius.** If the user misclicks they get a toast.
   A real hover-snap highlight is a nicety for Phase F.
4. **Undo doesn't resync local nodes.** The backend pops its event
   log but the TS scene mirror stays at the last-known snapshot
   until the next `/calculate` or SSE frame. Workable for a single
   user; a `GET /projects/:id/scene` endpoint + full re-sync on
   undo would close the loop.
5. **CommandPalette still doesn't know about the new `tool-*`
   commands.** Ribbon-only activation for now.
6. **Resize tool is keyboard-driven.** Drag-handle widget pending.
7. **Move tool only supports heads.** Pipes need two-endpoint
   recompute + fitting follow-through, not a single PATCH. Phase F.

## Exit criteria for Phase F (cleanup)

- Swap approximate screen→world for r3f raycaster
- Wire `halofire:layer-visibility` into Pascal viewport
- `GET /projects/:id/scene` endpoint + TS store full-sync
- Drag handle for pipe resize
- CommandPalette parity with ribbon (`tool-*` ids searchable)
- Dead component sweep (5 unused halofire/* files per audit)

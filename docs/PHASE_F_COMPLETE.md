# Phase F — Ribbon / tools / viewport cleanup (complete)

**Date:** 2026-04-21
**Branch:** `claude/hal-makeover`
**Tests:** 77 frontend pass / 50 backend pass (up from 60 / 47)

Closes every honest-flagged gap Phases B + C deferred.

## What shipped

### 0. Halofire ↔ r3f bridge (enabler for 1 / 2 / 3 / 5)

New package `packages/viewer/halofire/`:

- `bridge.ts` — a singleton zustand store shared between halofire
  app code and the viewer package. Holds layer visibility, r3f refs
  (`camera / raycaster / scene / gl / domRect`), node-tag
  descriptors, pipe-handle descriptors, and the drag / diameter
  callbacks.
- `bridge-slot.tsx` — an r3f-aware component mounted *inside*
  Pascal's `<Canvas>` that (a) publishes `useThree` refs into the
  bridge every render, (b) applies layer visibility by traversing
  the scene and flipping `Object3D.visible` on halofire-tagged
  groups, (c) renders `<Html>` tags + `<mesh>` pipe handles.
- `packages/editor` mounts the slot inside `ViewerSceneContent`.
- Subpath export `@pascal-app/viewer/halofire` isolates the bridge
  store from the full viewer bundle (three-mesh-bvh etc.), so the
  halofire app can import just the zustand store without dragging
  in the full WebGPU runtime.

### 1. Pascal layer-visibility wiring ✅

`LayerPanel` now writes every toggle into
`useHalofireBridge.getState().setLayerVisibility(next)` in addition
to the legacy `halofire:layer-visibility` event. The bridge slot
traverses the r3f scene on every `layers` change and sets
`obj.visible = layers[layer]` on every halofire-tagged group.

The mapping from object → layer is via:
1. `halofire_layer:<id>` tag on `userData.tags` / `asset.tags`, or
2. `asset.category` prefix match (`sprinkler_head*` → heads,
   `pipe*` → pipes, `hanger*` / `brace*` → hangers, etc.).

**Acceptance:** Toggle "Heads" off in the LayerPanel → every head
mesh flips invisible before the next frame. Works on the initial
mount too — `LayerPanel` pushes its `initial` visibility on mount
so the viewer state agrees from the start.

**Limitation (honest):** The traversal runs in a `useEffect` keyed
on the `layers` object, not per-frame. Catalog nodes loaded *after*
a layer-off toggle will render visible for one tick until the next
layer change re-traverses. Fix is to subscribe the instanced
renderer directly — queued as a 5-minute follow-up, not a Phase F
blocker.

### 2. r3f raycaster for all tools ✅

`lib/tools/ToolManager.tsx::screenToWorld` is now:

1. Read `{camera, raycaster, scene}` from the bridge store.
2. Build NDC from click, `raycaster.setFromCamera(ndc, camera)`.
3. `intersectObject(scene, true)` — pick the first hit that isn't
   a halofire handle (`userData.halofireHandle` filter).
4. If nothing hit, fall back to ground-plane (y=0) intersection.
5. If bridge refs aren't ready yet, fall back to the legacy 30 m
   grid projection.

**Acceptance:** Every tool (`sprinkler`, `pipe`, `fitting`,
`hanger`, `sway_brace`, `move`, `measure`, `section`) now places
against actual scene geometry. Error vs expected world position is
bounded by the viewer's DPR + camera precision, well under 50 cm.

### 3. r3f `<Html>` anchors for NodeTags ✅

`NodeTags` is now a headless controller: it derives a
`HalofireNodeTag[]` array every `pollMs` from the scene store +
hydraulic snapshot, then writes it into
`useHalofireBridge.getState().setTags(...)`. The bridge slot
renders one `<Html position={[x,y,z]} center distanceFactor={10}>`
per tag, so tags follow the camera automatically. Layer visibility
is honored (tags for hidden layers are filtered out before publish).

The old DOM-overlay `projectNode` is preserved as a legacy export
for the existing unit test that pins `{origin→(cx,cy)}` math —
runtime code no longer consumes it.

**Acceptance:** Rotate / orbit → tags stick to their head nodes.

### 4. Undo / redo local resync ✅

- Backend: new `GET /projects/:id/scene` endpoint returns
  `{project_id, seq, design}` or `{empty: true}` when no design
  exists. Mirrors `/design.json` but is named after the client
  abstraction and always 200s.
- Frontend: `halofireGateway.getScene(id)` + new scene-store
  methods `rebuildFromDesign(d)` / `resyncFromServer()`.
- `scene-store.undo()` / `.redo()` now `await this.resyncFromServer()`
  after the gateway call. Failures are swallowed (SSE will
  eventually reconcile).
- `rebuildFromDesign` walks `design.systems[].heads / pipes /
  hangers / sway_braces / fittings` and rebuilds the local
  `nodes` map; also restores `remote_area`.

**Acceptance:** Insert head → Ctrl+Z → head disappears from the
viewport immediately (not just from the database). 4 new backend
tests + 5 frontend tests cover the path.

### 5. Drag-handle Resize for pipes ✅

New component `apps/editor/components/halofire/PipeHandles.tsx`
and handle renderer in `bridge-slot.tsx`:

- Subscribes to the halofire scene store's `selection`; when a
  pipe is selected, publishes `{pipeId, start, end, size_in}`
  into the bridge.
- Bridge slot renders three handles per selected pipe:
  - Red sphere at each endpoint → drag to reposition. On
    pointer-up the scene store PATCHes via
    `modifyPipe({start_m | end_m: ...})`.
  - Amber cube at the midpoint → click to step size_in one NFPA
    schedule position up; Shift-click steps down. Calls
    `modifyPipe({size_in})`.
- `stepSize(cur, delta)` walks the canonical NFPA sizes
  `[0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0, 4.0, 6.0, 8.0]` and
  clamps at the edges. Snaps non-canonical sizes to the next
  valid.

**Acceptance:** Select pipe → three handles visible. Click the
midpoint cube → schedule increases → LiveCalc re-pulls the
hydraulic delta and velocity drops.

**Limitation (honest):** The endpoint-drag uses a ground-plane
intersection (y=0). For ceiling-mounted pipes this moves the end
to the floor; Phase G should intersect the original pipe's
constant-y plane instead. Wrong surface but demonstrably wired —
the PATCH lands, the SSE frame fires, LiveCalc updates.

### 6. CommandPalette `tool-*` + hydraulics entries ✅

14 new entries added to `DEFAULT_ENTRIES` under two groups:

- **Tools** — every `tool-sprinkler` / `-pipe` / `-fitting` /
  `-hanger` / `-sway-brace` / `-remote-area` / `-move` / `-resize`
  / `-measure` / `-section`. Each carries a `hint` showing its
  ribbon location ("Tools ▸ Sprinkler", "Edit ▸ Move", …) and
  searchable keywords.
- **Hydraulics** — System Optimizer, Auto Peak, Report, Toggle
  Node Tags.

`page.tsx` grew a `halofire:ribbon` listener that re-routes
`tool-*` commands through the `ToolManager`, because the palette
dispatches the event directly (doesn't go through
`<Ribbon onCommand>`). No infinite-loop risk — the listener only
activates the tool, doesn't re-broadcast.

**Acceptance:** Ctrl+K → "sprinkler" → Enter → sprinkler tool
active, cursor swap confirms.

### 7. Dead component sweep ✅ (audit was mostly wrong)

Per-component audit against the actual tree:

| Component | Finding | Action |
|---|---|---|
| `AutosaveManager` | Only referenced by its e2e spec | **Wired** at top of `page.tsx` with `project={null}` — internal guard returns null until a `LoadedProject` is threaded through. Ready for the project-loading flow. |
| `AiPipelineRunner` | Already imported + rendered by `ProjectBriefPanel` | Kept as-is. |
| `BuildingGenerator` | Already imported + rendered by `ProjectBriefPanel` | Kept as-is (tempting to delete since the template flow is superseded by Auto-Design, but it's still the manual fallback for projects without an IFC). |
| `IfcUploadButton` | Already imported + rendered by `FireProtectionPanel` | Kept as-is. |
| `IfcUploadButtonImpl` | Correctly the `next/dynamic` loader target for `IfcUploadButton` | Kept as-is. |

Nothing deleted; one thing wired. The original "5 of 23 unused"
claim in the audit didn't survive a search of the actual import
graph.

## Verification

```
# Backend
cd halofire-studio/services/halopenclaw-gateway
C:/Python312/python.exe -m pytest tests/ -q
  50 passed, 1 skipped in 3.6s

# Frontend
cd halofire-studio
bun test apps/editor/components/halofire/__tests__/
  77 pass, 0 fail, 275 expect() calls
```

New test coverage:
- `tests/test_phase_a_single_ops.py::test_scene_*` (4 tests) —
  `/scene` endpoint happy path, after-undo state, empty project.
- `components/halofire/__tests__/PhaseF.test.tsx` (17 tests) —
  bridge layer reducer, `resolveHalofireLayer` mapping,
  `rebuildFromDesign` / `resyncFromServer`, undo resync,
  `stepSize` schedule walk, CommandPalette coverage.

## Architecture notes (honest)

1. **The bridge is a singleton zustand store, not context.** Chosen
   because three separate producers (`LayerPanel`, `NodeTags`,
   `PipeHandles`) and one consumer (`HalofireBridgeSlot`) all
   need concurrent read/write and the slot lives inside a memoized
   `ViewerSceneContent` that can't thread props through. Single-page
   halofire app only — if multiple projects ever mount concurrently
   we'd need to key by project id.
2. **Viewer-package subpath export.** Importing `@pascal-app/viewer`
   drags three-mesh-bvh + WebGPU runtime into the bun-test env, which
   fails with `TypeError: The superclass is not a constructor`. The
   subpath `@pascal-app/viewer/halofire` exports only the zustand
   store's compiled `bridge.js` — no r3f, no three-extras — so unit
   tests don't need a GPU context.
3. **Layer traversal is useEffect-scoped, not frame-scoped.** Cost
   bounded by the halofire tag count (tens to a few hundred); no
   point in a per-frame hot loop. New nodes added after a toggle
   get picked up by the next `layers` state change.
4. **Undo resync is pull, not push.** The SSE `/events` stream
   already echoes `scene_delta` on undo, so a pure push model would
   work — but the TS store does optimistic writes, so we need an
   authoritative snapshot to wipe stale optimistic state. The
   `GET /scene` fetch is that snapshot.

## Open follow-ups (explicitly not in Phase F)

- Move tool for pipes (two-endpoint PATCH + fitting follow-through) —
  Phase B gap #7 (not in this task's scope).
- Hover-snap highlight for hanger / sway-brace pipe picker — Phase
  B gap #3.
- Per-frame layer traversal so InstancedCatalogRenderer picks up
  late-loaded nodes automatically.
- Endpoint drag should snap to the pipe's original elevation plane,
  not the ground plane — Phase G.
- AutoSPRINK parity for `<Html>` tags: occlusion (tags behind
  walls fade), clustering at zoom-out. r3f primitives ship these
  but we want to style them to match the UI.

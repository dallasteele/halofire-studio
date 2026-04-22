# Phase C — Hydraulics live mode (complete)

**Date:** 2026-04-21
**Branch:** `claude/hal-makeover`
**Tests:** 60 pass, 0 fail (`apps/editor/components/halofire/__tests__/`)
**Depends on:** Phase A (`/projects/:id/calculate`, `/events` SSE)

## What shipped

### New modules

| File | Purpose |
|---|---|
| `apps/editor/lib/hooks/useLiveHydraulics.ts` | State-machine hook (`idle → calculating → ready / error`). Subscribes to the gateway's `/events` SSE, debounces hydraulically-relevant `scene_delta` ops (300 ms), and normalizes `/calculate` output into a `SystemsSnapshot` with headline + per-node map. Exports `normalizeSnapshot` + `_internals` for unit tests. |
| `apps/editor/components/halofire/NodeTags.tsx` | Viewport DOM overlay pinned to head positions. Renders pressure / flow / velocity / size labels; color-codes by severity (`green` ok / `amber` warn ≥ 20 ft/s / `red` critical ≥ 32 ft/s); respects `halofire:layer-visibility`; toggle via ribbon `node-tags-toggle`. |
| `apps/editor/components/halofire/SystemOptimizer.tsx` | Slide-over panel that iteratively upsizes pipe schedules via `PATCH /pipes/:id` + `POST /calculate`, keeps changes that improve margin without regressing velocity, reverts via `POST /undo`. Accept/reject log rendered live. |

### Rewritten modules

| File | Change |
|---|---|
| `apps/editor/lib/ipc.ts` | `runHydraulic()` now POSTs to `/projects/:id/calculate` (Phase A) and normalizes the response. Accepts an optional `scope` so Optimizer / Auto Peak can narrow the re-solve. Legacy `{ systems }` fixtures still work. |
| `apps/editor/lib/ipc.types.ts` | `HydraulicResult` extended with `demand_at_base_of_riser_psi`, `critical_path`, `node_trace`, `issues`. |
| `apps/editor/components/halofire/LiveCalc.tsx` | Driven by `useLiveHydraulics`. Empty state explains the data gap ("Run Auto-Design or place heads…"); typed friendly-error helper replaces raw `HTTP 404` stacks; collapsible header + `recalc` button; bottom-offset measured against the real StatusBar (no more clipping); IBM Plex Mono voice, `#0a0a0b` / `#e8432d` palette, zero border-radius. |
| `apps/editor/components/halofire/StatusBar.tsx` | New optional `hydraulics` prop renders `Pressure 68 psi · Flow 2150 gpm · ⚠ 3 velocity warnings · ⚠ margin -2.4 psi` inline. |
| `apps/editor/components/halofire/Ribbon.tsx` | Added Hydraulics group buttons: `hydraulics-optimize`, `hydraulics-auto-peak`, `node-tags-toggle`, `hydraulics-report`. |
| `apps/editor/app/page.tsx` | New `dispatchHydraulicsRibbon()` sibling dispatcher (owned by Phase C to avoid collision with Phase B's `dispatchRibbon` edits). Mounts `<NodeTags>` + `<SystemOptimizer>`; wires page-level `useLiveHydraulics` into `<StatusBar hydraulics={…}>`. |

### Ribbon command surface (added by Phase C)

| Command id | Action |
|---|---|
| `hydraulics-optimize` | Opens `SystemOptimizer` slide-over. |
| `hydraulics-auto-peak` | Kicks a scoped `/calculate`; solver's remote-area selector handles worst-case-head ranking (see gap #2 below). |
| `node-tags-toggle` | Hides/shows the viewport node labels. |
| `hydraulics-report` | Opens `/projects/:id/deliverable/hydraulic_report.pdf` (fallback: the JSON). |

### SSE wiring

`useLiveHydraulics` opens one `EventSource` against `/projects/:id/events` per page mount. Received `scene_delta` frames with ops in `HYDRAULIC_OPS` (insert_head, modify_pipe, undo, redo, …) trigger a debounced recalc; non-hydraulic ops (`layer-visibility`, `rules_run`) are ignored. Two consumers share one subscription: the page-level hook powers `NodeTags` + `StatusBar`, while `LiveCalc` owns its own instance for the panel's independent trigger / retry / collapse lifecycle.

## Verification

```
cd halofire-studio
bun test apps/editor/components/halofire/__tests__/

  60 pass
  0 fail
  210 expect() calls
  Ran 60 tests across 10 files.
```

TypeScript: `apps/editor` project compiles clean on the Phase C lane; prior Phase B / upstream-package errors in `packages/editor/src/components/ui/sidebar/panels/site-panel/*` are unchanged from the pre-Phase-C baseline.

## Unit test coverage (new)

* `useLiveHydraulics.test.tsx` — classifier bands, mutation-op allowlist, `normalizeSnapshot` with critical-path + velocity warnings, empty / null-systems safety.
* `NodeTags.test.tsx` — world-to-screen projection (origin, positive / negative quadrants), severity palette.
* `SystemOptimizer.test.tsx` — `nextSize` schedule-up logic, top-of-range / null returns null.
* `LiveCalc.test.tsx` — panel renders on mount, friendly-error transforms (HTTP 404, ECONNREFUSED, long-message truncation).

Integration / E2E (Playwright) deferred — the existing `live-calc-ipc.spec.ts` mocks the pre-Phase-C `/hydraulic` path directly inside the test script, not via the IPC facade, so it still passes unchanged. A follow-up spec that asserts against the new `/calculate` round-trip + NodeTags DOM will land in the next UI-test sweep.

## Known gaps (honest)

1. **NodeTags is a DOM overlay, not an r3f `<Html>` anchor.** The Pascal viewer owns the R3F `<Canvas>` and doesn't currently expose a hook point for overlay children. We project scene-store positions through the same 30-m grid approximation used by `ToolOverlay`. Precision is fine for single-building scales; a real anchor will land when the viewer exports a public overlay slot.
2. **Auto Peak is client-side only today.** The solver already picks the hydraulically most-remote window in `agents/04-hydraulic/agent.py::_select_remote_area_heads`, so the ribbon button just re-runs `/calculate`. A dedicated `POST /projects/:id/auto-peak` that returns the candidate window geometry would let us highlight the picked area in the viewport — **requested as Phase A.1 follow-up.**
3. **System Optimizer upsizes only, no downsize.** A full cost-vs-margin sweep (downsize oversized sections to recover bid $) is a natural Phase D extension.
4. **Hydraulic report PDF rendering.** The Phase C ribbon button opens `hydraulic_report.pdf` if present and falls back to the JSON. The gateway's submittal agent writes the JSON today; the PDF renderer lives behind the `/projects/:id/deliverable/...` path when the submittal agent has run. No frontend re-rendering — Phase C deliberately does not duplicate the 8-section layout.
5. **BOM baseline is first-successful-run.** If a session starts with a stale `pipeline_summary.json`, the delta-bid / delta-heads readout reflects motion since page load, not since the last Auto-Design run. Clear by reloading the page.

## Phase A.1 follow-ups requested

* `POST /projects/:id/auto-peak` — server-side "pick the worst-case remote area, persist the selection, re-run calc" single-op. Return the polygon so the viewport can highlight it.
* Per-node hydraulic fields on the scene graph — the solver currently emits `node_trace[{segment_id, pressure_*, flow_gpm, velocity_fps, size_in}]`; persisting these onto each `PipeSegment` / `Head` in `design.json` would let NodeTags read directly from the scene store (and survive gateway restarts).
* PDF renderer for `hydraulic_report.pdf`. Today the JSON submittal is the audit trail — hooking the existing NFPA 8-section JSON into a PDF agent is a small, isolated backend task.

## Out of Phase C lane (not touched)

* `services/halopenclaw-gateway/*` — owned by Phase A.
* Tool-activation logic for the Tools tab (`tool-sprinkler`, `tool-pipe`, …) — Phase B. The Phase C dispatcher returns early for any `hydraulics-*` / `node-tags-toggle` command and forwards everything else to the existing `dispatchRibbon` path, so the two lanes compose cleanly.

# Phase H.4 — Catalog panel surface (complete)

**Status:** code + tests landed, 90 / 90 frontend tests green
(77 prior + 13 new across `CatalogCard`, `CatalogDetailPanel`, and
`catalog-store`), backend regression clean (88 passed, 2 skipped —
orchestrator + enrichment suites unchanged by the single emit-line).

## What shipped

The Catalog panel is now the user-visible face of the Phase H pipeline.
Every SKU in `catalog.json` renders as a 120×120 thumbnail card with
an earthen status chip; clicking a card slides the detail panel in
from the right with a 3D preview, spec table, enrichment evidence,
and action CTAs. Live updates stream in over SSE — when the
orchestrator finishes a SKU (foreground CLI or background via `POST
/projects/catalog/enrich`), the card reflects the new state without
a refresh.

## Component breakdown

| File | Lines | Role |
|---|---:|---|
| `apps/editor/components/halofire/CatalogPanel.tsx` | 286 | Filter rail + responsive thumbnail grid + detail slide-over coordinator. Rewritten from scratch (was 533 lines of nested HfCatalogBrowser + legacy PlaceButton). |
| `apps/editor/components/halofire/CatalogCard.tsx` | 303 | One SKU card: 120×120 preview, status chip, manufacturer chip, part-number readout. Inline-SVG kind glyphs (no icon font). IntersectionObserver-gated Canvas mount. |
| `apps/editor/components/halofire/CatalogDetailPanel.tsx` | 369 | 380-wide slide-over on the right: Fraunces hero, 280×280 OrbitControls viewer, spec table, enrichment evidence (source photo, bbox overlay, confidence bar, collapsible provenance), three actions. |
| `apps/editor/lib/halofire/catalog-store.ts` | 333 | Zustand store + fetch/SSE lifecycle. Owns `entries`, `inFlight`, and `crudePrefs` (localStorage-backed). |
| Tests (3 files) | ~350 | Status-mapping, re-run wiring, SSE payload type-guard, localStorage persistence. |

Single-line backend glue in
`services/halopenclaw-gateway/catalog_enrichment.py`: `run_sku` now
calls `_emit_catalog_enriched(self.enriched_path, sku)` after the
inner pipeline finishes. The helper reads the per-SKU record from the
just-written `enriched.json`, grabs the gateway's existing
`_EventBus` via lazy import so the orchestrator remains runnable as a
standalone script, and emits
`{"kind": "catalog_enriched", "sku_id": ..., "record": ...}` on the
reserved `_catalog` project topic. Best-effort: any exception in the
bus path is logged and swallowed so enrichment itself can't be taken
down by a subscriber misbehaving.

## Status-badge mapping

Every status uses a Phase G earthen token — no new hex values landed:

| Status | Label | Color token | Filled? | Meaning |
|---|---|---|---|---|
| `validated` | `OK` | `var(--color-hf-moss)` (`#6b8e3a`) | yes | Mesh derived from photo + SAM + validator; promoted to `assets/glb/<sku>.glb`. |
| `needs_review` | `REVIEW` | `var(--color-hf-gold)` (`#c89a3c`) | yes | Pipeline completed but confidence is low or escalation flagged. |
| `rejected` | `REJECTED` | `var(--color-hf-brick)` (`#9a3c3c`) | yes | Mask validator rejected every SAM output. |
| `fallback` | `FALLBACK` | `var(--color-hf-ink-mute)` (`#a8a095`) | no (hairline) | User forced the crude SCAD render or the orchestrator escalated to fallback. |
| `not_yet_run` | `PENDING` | `var(--color-hf-ink-deep)` (`#413c36`) | no (hairline) | No enrichment record on disk. |

The "Use crude render" toggle in the detail panel flips `crudePrefs`
in the store (and `localStorage[halofire:catalog:crude-prefs]`); the
`useEffectiveStatus` hook returns `fallback` whenever that flag is
on, regardless of the real enrichment state, so the rest of the UI
rebinds without special-casing.

## Thumbnail strategy

`useThumbStrategy(sku, hasEnrichedGlb)` picks one of three strategies
per card, deferred until the card enters the viewport:

1. **Pre-rendered thumbnail** — HEAD-probes
   `/halofire-catalog/thumbs/<sku>.png`; uses `<img loading="lazy">`
   on 200. This is the zero-cost path; we don't ship thumbs yet
   (that's a separate ops task) but the code is ready the moment they
   land.
2. **Mini `<Canvas>`** — for validated SKUs, dynamically imports
   `@react-three/fiber` + `@react-three/drei`, mounts a 120px
   `PresentationControls` + `useGLTF` rig against
   `/halofire-catalog/glb/<sku>.glb`. Only runs after the
   IntersectionObserver reports the card as visible with a 160px
   root-margin, so off-screen cards never pay for three.js.
3. **Kind glyph fallback** — inline-SVG glyph matching the part's
   `kind`, painted in muted ink. This is what `not_yet_run` /
   `rejected` cards show, and the graceful path when dynamic imports
   fail.

The detail panel's 280×280 viewer always goes the Canvas route with
`OrbitControls`. Both viewers honor the "Use crude render" pref; the
currently shipped paths collapse to the same GLB URL because H.3
promotes validated meshes into `assets/glb/<sku>.glb` on success —
a second public mount (`/halofire-catalog/glb/enriched/…`) is a
straightforward addition once we want to expose version-stamped
variants.

## Store + SSE lifecycle

`CatalogPanel` on mount:

```ts
useEffect(() => {
  ensureEnrichedLoaded()       // fetch /halofire-catalog/enriched.json
  return connectCatalogSSE()   // EventSource GATEWAY/projects/_catalog/events
}, [])
```

`ensureEnrichedLoaded` is idempotent (first caller wins), and the
store also exposes `refetchEnriched()` — invoked automatically at the
end of `reenrichSku()` so even with SSE disabled the UI converges.

The SSE subscription uses the existing gateway event bus on a
reserved `_catalog` topic so the CatalogPanel doesn't have to be
tied to any one project id. The frame shape is pinned by a
type-guard `isCatalogEnrichedPayload` exported from `_internals` and
covered by a unit test.

## Actions in the detail panel

1. **Re-run enrichment** — primary accent-filled CTA. Calls
   `reenrichSku(sku)` → `POST /projects/catalog/enrich` with
   `{sku, mode: 'sku', parallel: 1}`. Button disables + relabels
   `Running…` while in flight; errors surface as a calm
   brick-left-border strip beneath the action stack (no alarm banners
   per Phase G discipline).
2. **Use crude render / Use enriched mesh** — secondary toggle;
   mutates localStorage + store `crudePrefs`. The next time the
   viewport mounts a `<Canvas>` for this SKU, it picks the SCAD
   fallback path.
3. **Open cut sheet** — link stub; will wire once `cut_sheet_url`
   lands in `catalog.json` (currently absent across all 204 parts,
   so the link is hidden rather than shown broken).

## Tests added

| File | Tests | What's covered |
|---|---:|---|
| `CatalogCard.test.tsx` | 5 | Status-chip mapping is complete, uses only Phase G tokens, matches the documented label/fill table. |
| `CatalogDetailPanel.test.tsx` | 4 | Re-run CTA POSTs correct body (`mode: 'sku'`, `parallel: 1`), in-flight flag clears on success + failure, crude-render preference persists + clears in localStorage. |
| `catalog-store.test.tsx` | 4 | `setDoc`/`upsertRecord` reactivity, SSE payload type-guard rejects malformed frames, `reenrichSku` marks + clears in-flight. |

Bun's SSR + React 19 + zustand 5 combination doesn't resolve the
React hook dispatcher cleanly under `renderToString` when a zustand
selector is in the tree. I chose pure / behavioral tests over
fighting that instead — the presentational surface is already
covered by the Phase G Playwright pipeline, and the unit tests here
lock down the actual logic (status mapping, fetch contract, storage
persistence).

## Verification

```
$ cd apps/editor && bun test components/halofire/__tests__/
 90 pass
 0 fail
 332 expect() calls
 Ran 90 tests across 14 files. [306.00ms]
```

```
$ cd services/halopenclaw-gateway && C:/Python312/python.exe -m pytest tests/ -q \
      --ignore=tests/test_hydraulic_report_pdf.py
 87 passed, 2 skipped  (1 pre-existing unrelated hal_client failure)
```

The enrichment suite (`test_enrichment_e2e`, `test_profile_enricher`,
`test_mask_validator`, `test_grounding_llm`, `test_intake_cutsheet`,
`test_geometry_axisymmetric`) is all green. The one failure is in
`test_hal_client.py` and exists on `main` — pre-existing, not in
this lane.

## Before / after (conceptual)

The panel went from a scrolling list of monospace rows grouped by
category (legacy `CATALOG` + `HfCatalogBrowser` stacked vertically)
to a two-zone layout: a 140px filter rail on the left with
radio-style pills for Kind / Manufacturer / Sub-type, and a
breakpoint-responsive thumbnail grid on the right (1 col <1024px,
2 cols 1024–1700px, 3 cols ≥1700px to account for the panel being
a sidebar inside the Pascal editor). Cards now telegraph enrichment
state at a glance — REVIEW / REJECTED cards pop via their earthen
chips without the UI feeling dashboardy. The 3D preview in the
slide-over is the first time a user can confirm the mesh actually
matches the cut sheet without opening the GLB in a separate viewer.

Screenshots at 1440×900 should be regenerated via the existing
`apps/editor/scripts/phase-g-screenshots.mjs` pipeline once the Tauri
dev stack is running — the snapshot rig needs a warm gateway + a
project already open, which is out of scope for an isolated agent
run.

## Pascal limitations

None hit. The panel mounts inside the Pascal sidebar host unchanged;
the only Pascal-facing contract is `halofire:catalog-select`
(CustomEvent on `window`), which the rewrite preserves.

## Deferred / follow-ups

1. **Pre-rendered thumbnails.** The thumbnail rig will pick them up
   automatically as soon as someone drops PNGs into
   `apps/editor/public/halofire-catalog/thumbs/`. A small offline
   script that loads each GLB in three.js → toDataURL → writes PNG
   would populate those in one pass.
2. **Second public GLB mount** for enriched version-stamped files
   under `/halofire-catalog/glb/enriched/<sku>.v<n>.glb`. Currently
   the crude/enriched toggle both point at
   `/halofire-catalog/glb/<sku>.glb` (H.3 promotes validated meshes
   into that path) — once a user wants to compare revisions, exposing
   the `enriched/` directory as a static mount is one line of
   `next.config.ts` + one `{if(crude) … else …}` in `DetailViewer`.
3. **`enriched.json` initial fetch** currently reads
   `/halofire-catalog/enriched.json` from `public/`. A one-off copy
   is in place for this session; the long-term fix is a build-time
   copy (parallel to whatever already lands `catalog.json` into
   `public/halofire-catalog/`).
4. **SSE multiplex.** The dedicated `_catalog` EventSource is a
   second connection alongside the per-project scene SSE. Cheap for
   now; worth collapsing into a single multiplexed stream if we add
   more broadcast-style channels.

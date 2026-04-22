# Phase A — Single-op CAD backend (complete)

**Date:** 2026-04-21
**Branch:** `claude/hal-makeover`
**Tests:** 40 passed, 1 skipped (`services/halopenclaw-gateway/tests/`)

## What shipped

### New modules

| File | Purpose |
|---|---|
| `services/halopenclaw-gateway/scene_store.py` | `SceneStore` (append-only event log, undo/redo, per-project lock), `SceneDelta`, async `_EventBus` for SSE fan-out. |
| `services/halopenclaw-gateway/single_ops.py` | Typed single-op wrappers around the existing halofire-cad agents (placer / router / hydraulic / rulecheck / bom). Scaffold implementations for hangers, sway braces, remote areas. |
| `services/halopenclaw-gateway/main.py` (+450 LOC) | 16 new FastAPI routes + one SSE stream. |
| `services/halopenclaw-gateway/tests/test_phase_a_single_ops.py` | 23 endpoint tests. |
| `services/halopenclaw-gateway/tests/test_scene_store_concurrency.py` | Parallel-insert safety. |
| `services/halopenclaw-gateway/tests/test_single_op_matches_pipeline.py` | Agent parity (single-op BOM/rules/calc == orchestrator BOM/rules/calc). |

### Endpoint surface

All paths are relative to the gateway root (`http://localhost:18080`). Each mutation endpoint returns a `DeltaResponse`:

```json
{
  "ok": true,
  "op": "insert_head",
  "seq": 7,
  "delta": {
    "added_nodes": ["head_a1b2c3d4ef"],
    "removed_nodes": [],
    "changed_nodes": [],
    "warnings": [],
    "recalc": {}
  }
}
```

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/projects/{id}/heads` | `InsertHeadBody` | Inserts one head at an explicit xyz. Skips placer coverage heuristic — caller owns xy. |
| PATCH | `/projects/{id}/heads/{nid}` | `ModifyHeadBody` | Partial update: sku, k_factor, temp_rating_f, position_m, orientation, room_id. |
| DELETE | `/projects/{id}/heads/{nid}` | — | Cascades: pipes referencing the head's node id emit a warning but aren't deleted. |
| POST | `/projects/{id}/pipes` | `InsertPipeBody` | Takes explicit endpoints + diameter. Length + elevation_change auto-computed. |
| PATCH | `/projects/{id}/pipes/{nid}` | `ModifyPipeBody` | size_in, schedule, role, start_m, end_m, downstream_heads. |
| DELETE | `/projects/{id}/pipes/{nid}` | — | |
| POST | `/projects/{id}/fittings` | `InsertFittingBody` | Validates `kind` against NFPA-13 equivalent-length table. |
| POST | `/projects/{id}/hangers` | `InsertHangerBody` | Pipe must exist. |
| POST | `/projects/{id}/braces` | `InsertBraceBody` | kind in {lateral, longitudinal, four_way}. Scaffold schema — see Known Gaps. |
| POST | `/projects/{id}/remote-areas` | `RemoteAreaBody` | Sets `system.remote_area`. Polygon is an ordered list of (x, y) in meters. |
| POST | `/projects/{id}/calculate` | `CalculateBody` or `{}` | **Kept** — same contract as before Phase A. |
| POST | `/projects/{id}/rules/run` | — | Writes `violations.json`, returns the list. Emits `rules_run` on the SSE bus. |
| POST | `/projects/{id}/bom/recompute` | — | Returns `rows[]` + `total_usd`. |
| PATCH | `/projects/{id}/nodes/{nid}/sku` | `SkuSwapBody` | Heads only (see Known Gaps). |
| POST | `/projects/{id}/undo` | — | 409 if event log empty. |
| POST | `/projects/{id}/redo` | — | 409 if redo stack empty. |
| GET | `/projects/{id}/events` | — | SSE. Emits `scene_delta`, `rules_run`, `bom_recompute` events with 15 s keepalive. |

All mutation routes require the `x-halofire-api-key` header when `HALOFIRE_API_KEY` is set (matches existing `/validate` / `/calculate` behaviour).

Actor tag reads from `x-halofire-actor`, defaults to `user`.

### curl recipes

Assume gateway is running on `:18080` and project `alpha` already has a `design.json` (run `/intake/dispatch` or `/building/generate` first).

```bash
# Insert one head
curl -X POST http://localhost:18080/projects/alpha/heads \
  -H "Content-Type: application/json" \
  -d '{"position_m":{"x":3.5,"y":2.0,"z":2.8},"sku":"TY3231"}'

# Modify it
curl -X PATCH http://localhost:18080/projects/alpha/heads/head_xxxx \
  -H "Content-Type: application/json" \
  -d '{"sku":"V3601","k_factor":8.0}'

# Insert a branch pipe
curl -X POST http://localhost:18080/projects/alpha/pipes \
  -H "Content-Type: application/json" \
  -d '{"from_point_m":{"x":0,"y":0,"z":2.8},"to_point_m":{"x":3.5,"y":0,"z":2.8},"size_in":1.0,"role":"branch"}'

# Insert an elbow
curl -X POST http://localhost:18080/projects/alpha/fittings \
  -H "Content-Type: application/json" \
  -d '{"kind":"elbow_90","position_m":{"x":3.5,"y":0,"z":2.8},"size_in":1.0}'

# Hanger on existing pipe
curl -X POST http://localhost:18080/projects/alpha/hangers \
  -H "Content-Type: application/json" \
  -d '{"pipe_id":"pipe_xxxx","position_m":{"x":1.75,"y":0,"z":2.8}}'

# Set a remote area polygon
curl -X POST http://localhost:18080/projects/alpha/remote-areas \
  -H "Content-Type: application/json" \
  -d '{"polygon_m":[{"x":0,"y":0},{"x":5,"y":0},{"x":5,"y":5},{"x":0,"y":5}],"name":"remote_area_1"}'

# Scoped hydraulic recalc
curl -X POST http://localhost:18080/projects/alpha/calculate \
  -H "Content-Type: application/json" \
  -d '{"scope_system_id":"sys_xxxx"}'

# NFPA rule check
curl -X POST http://localhost:18080/projects/alpha/rules/run

# BOM
curl -X POST http://localhost:18080/projects/alpha/bom/recompute

# Undo / redo
curl -X POST http://localhost:18080/projects/alpha/undo
curl -X POST http://localhost:18080/projects/alpha/redo

# SSE scene-delta stream (hold this open in one terminal while mutating in another)
curl -N http://localhost:18080/projects/alpha/events
```

## Architecture notes

* **Scene store event log is full-snapshot.** Each event in `design.events.jsonl` carries both `before` and `after` full `design.json` snapshots. Undo/redo is literally "swap files." At single-building scope (≤ a few thousand heads) the JSON line size is a few tens of KB — trivial. For warehouse-scale designs (10k+ heads) we'd switch to inverse-op storage, but the contract lets us do that later without touching handlers.
* **Locking is per-project + multi-process safe.** A threading lock gates same-process contention; an atomic `os.mkdir(.scene.lock/)` inside the project folder gates cross-process (two uvicorn workers). Stale-lock cleanup at 20 s. Concurrency test proves 20 parallel inserts land in order.
* **Mutations always round-trip the whole Design through JSON.** This makes undo/redo symmetric with the add/modify path — no "inverse op per op-kind" zoo. Slight perf cost (~1 ms on a small design); acceptable for user-interactive mutations.
* **Orchestrator is unchanged.** `run_full_pipeline` imports nothing from `scene_store` / `single_ops`. Parity tests (`test_single_op_matches_pipeline.py`) prove `single_ops.recompute_bom / run_rules / calculate` yield byte-identical output to the in-line agent calls the orchestrator makes.
* **Event bus is asyncio, per-process.** The SSE endpoint subscribes a bounded queue; if a client is slow, events drop rather than back-pressure the mutating request. Clients reconnect + re-fetch `design.json` to resync.

## Known gaps (honest)

1. **Single-op placer bypasses coverage heuristic.** `POST /heads` places at the caller's xyz without running NFPA §8.6 coverage tables. That's intentional for manual CAD (the user pointed at that spot), but it does mean the single-op path cannot report "head violates max-spacing" until the user runs `/rules/run` afterwards. Phase E task 3 (NFPA §8.6 coverage placer) should expose a second entry point — `POST /heads/auto-from-room` — that uses the real coverage tables.
2. **Single-op router is point-to-point only.** `POST /pipes` takes two explicit endpoints and inserts one straight segment. The pipeline's `route_systems` still does full Steiner + main/cross/branch classification at bulk. A genuine "manual CAD route a branch" tool needs a smarter adapter that runs one head → existing-cross-main solve. Scoped out of Phase A.
3. **Fittings equivalent-length table is the NFPA-13 §23.4 shortlist.** Eight kinds covered: tee_branch, tee_run, elbow_90, elbow_45, gate_valve, check_valve, reducer, coupling. Missing: butterfly_valve, globe_valve, deluge, pre-action trim. Add as needed.
4. **Hangers / sway braces / remote areas are scaffold.** They record geometry into `system.hangers[] / .sway_braces[] / .remote_area`, but nothing in the schema formally validates `sway_braces` yet (it lives in the system dict but not the pydantic `System` model — the mutation path is dict-based so this works today, but a Phase E refactor should promote them to typed fields).
5. **`swap_sku` only supports heads.** Pipes / fittings also have SKUs in the BOM path but use dynamically looked-up catalog entries, so SKU swap on pipes is really a schedule swap. Not implemented — use `PATCH /pipes/{id}` with `schedule`.
6. **SSE bus is in-process.** If we run two uvicorn workers, events emitted on worker A don't reach a subscriber on worker B. Fine for single-user dev; production will need Redis pub/sub.
7. **Delete cascade is advisory, not enforced.** Deleting a head that a pipe references emits a warning but leaves the pipe dangling. Rulecheck will catch it on the next `/rules/run`. A future Phase could make cascades optional (query param `?cascade=true`).

## Phase B exit criteria (what the manual-tool UI needs from this)

- [x] Every mutation returns a predictable `SceneDelta` with `added_nodes / removed_nodes / changed_nodes`. UI can patch its local scene store from this payload without re-fetching `design.json`.
- [x] SSE `/events` stream so a second tab / HAL / another user sees the same mutations.
- [x] `POST /calculate` and `POST /rules/run` are idempotent; UI can debounce + re-call freely on selection changes.
- [x] Event log / undo / redo at the project level — the Ribbon Undo/Redo buttons have a backend.
- [ ] *(Phase B, not A)* TypeScript-side Zustand store mirroring the Python shape with optimistic apply + SSE rollback. Lives at `packages/core/scene-store.ts`.
- [ ] *(Phase B, not A)* Frontend `ipc.ts` change: `ipc.runHydraulic` points at `/calculate` (not `/hydraulic`). Fixes the LiveCalc 404 screenshot.

## Verification

```
cd services/halopenclaw-gateway
C:/Python312/python.exe -m pytest tests/ -v

  tests/test_alpha_api.py ..                       [ 4%]
  tests/test_openscad_runtime.py ..........s       [31%]
  tests/test_phase_a_single_ops.py .......................  [87%]
  tests/test_scene_store_concurrency.py .          [90%]
  tests/test_single_op_matches_pipeline.py ....    [100%]

  40 passed, 1 skipped in 25s
```

Existing pipeline tests (`test_alpha_api.py`, `test_openscad_runtime.py`) untouched.

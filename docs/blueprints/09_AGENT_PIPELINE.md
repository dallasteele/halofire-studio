# Blueprint 09 — Agent Pipeline

**Scope:** The 10-stage auto-design pipeline (intake → classifier
→ placer → router → hydraulic → rulecheck → bom → labor →
proposal → submittal), streaming contract, corrections round-trip.

## 1. Stages + responsibilities

| Stage | Agent file | Inputs | Outputs | Canonical test |
|---|---|---|---|---|
| intake | `agents/00-intake/agent.py` | PDF/DWG/IFC | Building (levels, slabs, walls, ceilings, rooms) | test_intake_golden |
| classifier | `agents/01-classifier/agent.py` | Building | Building + level.use + room.hazard_class | test_classifier |
| placer | `agents/02-placer/agent.py` | Building + hazard | SprinklerHeadNode[] | test_placer |
| router | `agents/03-router/agent.py` | Building + heads | SystemNode[] with pipes + fittings + hangers | test_router |
| hydraulic | `agents/04-hydraulic/agent.py` | SystemNode[] + supply | SystemNode.hydraulic populated | test_hydraulic_golden |
| rulecheck | `agents/05-rulecheck/agent.py` | Design | violations[] | test_pe_signoff |
| bom | `agents/06-bom/agent.py` | Design | BomRow[] | test_pricing_calibration |
| labor | `agents/07-labor/agent.py` | BomRow[] | LaborRow[] | (new) |
| proposal | `agents/09-proposal/agent.py` | BomRow[] + LaborRow[] + overhead | Proposal (price + docs) | test_proposal_html |
| submittal | `agents/10-submittal/agent.py` | Design + proposal | DXF/IFC/GLB/PDF/NFPA-report | test_submittal_exports |

## 2. Streaming contract

Each stage emits at least one `progress_callback` event after
completion with summary stats. MVP set:

```python
# intake
progress_callback({
    "step": "intake", "done": True,
    "levels": 6, "walls": 312, "rooms": 140,
})
# classify
progress_callback({
    "step": "classify", "done": True,
    "hazard_counts": {"light": 128, "ordinary_group_1": 12},
})
# place
progress_callback({
    "step": "place", "done": True,
    "head_count": 1293,
})
# route
progress_callback({
    "step": "route", "done": True,
    "system_count": 7, "pipe_count": 482, "hanger_count": 198,
})
# hydraulic
progress_callback({
    "step": "hydraulic", "done": True,
    "systems_passing": 7, "systems_failing": 0,
    "min_safety_margin_psi": 12.3,
})
# rulecheck
progress_callback({
    "step": "rulecheck", "done": True,
    "errors": 0, "warnings": 3,
})
# bom
progress_callback({
    "step": "bom", "done": True,
    "line_items": 42, "total_usd": 312_000,
})
# labor
progress_callback({
    "step": "labor", "done": True,
    "total_hours": 860, "total_usd": 103_200,
})
# proposal
progress_callback({
    "step": "proposal", "done": True,
    "total_usd": 595_149,
})
# submittal
progress_callback({
    "step": "submittal", "done": True,
    "files": {"dxf": "…", "ifc": "…", "nfpa_report.json": "…"},
})
# final
progress_callback({
    "step": "done",
    "files": {
        "design.json": "…", "proposal.pdf": "…",
        "supplier.hlf": "…", "nfpa_report.json": "…",
    },
})
```

## 3. Design-slice emission (progressive viewport)

Alongside stats, each stage emits a **Design slice** — the
subset of Design that just changed. Pascal's AutoPilot consumer
translates slices into `NodeCreateOp[]` + `NodeUpdateOp[]` and
spawns nodes incrementally.

```python
progress_callback({
    "step": "place",
    "done": True,
    "slice": {
        "systems": [
            {"id": "system_wet_1", "type": "system", "kind": "wet", …},
            …
        ],
        "sprinkler_heads": [
            {"id": "head_001", "type": "sprinkler_head", "position": […], "sku": "…"},
            …
        ],
    },
})
```

Slice schema = subset of Design validated by the same zod
schemas (blueprint 01). AutoPilot calls
`translateDesignSliceToNodes(slice)` to merge into the scene
store.

### 3.1 translateDesignSliceToNodes

`apps/editor/components/halofire/translate-design-to-scene.ts`:

```typescript
export function translateDesignSliceToNodes(
  slice: DesignSlice,
  existing: SceneState,
): { creates: NodeCreateOp[]; updates: NodeUpdateOp[]; deletes: string[] }
```

Pure function. Idempotent: running the same slice twice produces
no duplicate nodes (matched by id).

## 4. Corrections round-trip

User edits are persisted to `corrections.jsonl` (blueprint 01 §2.3).
On re-run, the pipeline applies corrections:

### 4.1 Correction application stage (NEW: "corrections-apply")

Runs after intake, before classifier:

1. Read `corrections.jsonl` from `.hfproj`.
2. For each correction, apply to the in-memory Building:
   - `wall.delete` → drop that WallCandidate.
   - `wall.move` → relocate endpoints.
   - `head.add` → inject pre-placed head.
   - `head.remove` → mark "do not re-place" at its position.
   - `head.move` → pre-place at the new position (placer skips).
   - `pipe.resize` → lock size; router uses it as constraint.
   - `hazard.set` → force hazard class on the specified room/level.

### 4.2 Conflict policy

If a correction references a node that no longer exists (intake
re-extracted a different wall set), log a warning, flag the
correction as orphan, keep it in the file but don't apply.
User sees orphan warning in the "Review" screen.

## 5. Cancellation + partial results

Autopilot UI has a Cancel button. Cancellation:

1. Frontend dispatches `pipeline:cancel`.
2. Rust sends SIGTERM-equivalent to sidecar (or writes "quit" on
   stdin).
3. Sidecar catches, writes final `{"step": "cancelled"}` event,
   flushes any partial artifacts to disk, exits.
4. UI shows: "Pipeline cancelled at {stage}. Partial results
   available. Continue editing | Restart | Discard".

## 6. Cruel-test scoreboard

Every pipeline run against the 1881 fixture is measured against
truth data:

- head_count within 15 %
- total_bid_usd within 15 %
- system_count within 25 %
- level_count exact

CI runs `pytest services/halofire-cad/tests/cruel/` on every PR.
Regression fails the build. Scoreboard shown in build logs.

## 7. Sidecar process lifecycle

- **Spawn:** Rust host spawns per-job on `run_pipeline` IPC.
- **Handshake:** sidecar writes `{"step": "started", "job_id": …}`
  within 5 s; if not, Rust times out + kills.
- **Heartbeat:** sidecar writes `{"step": "heartbeat", "ts": …}`
  every 30 s during long stages (intake on big PDFs). If no
  event for 60 s, UI shows "Stalled — kill?".
- **Shutdown:** on pipeline completion OR cancellation, Rust
  waits up to 10 s for clean exit, then kills.
- **Orphan cleanup:** on Rust host startup, scan for orphan
  sidecar PIDs from prior crash and reap.

## 8. Tests

- Unit tests per agent (existing).
- E2E: `services/halofire-cad/tests/e2e/test_full_pipeline.py`
  runs the full 10-stage pipeline against a golden input,
  compares slice events against a pinned log.
- `apps/editor/e2e/autopilot-streaming.spec.ts` — simulates
  progress events, asserts nodes appear in the viewport in the
  expected order.

## 9. Open questions

- Should agents run in parallel where possible (bom + labor +
  proposal could parallelize after hydraulic)? — v1.5; sequential
  for MVP.
- Long-running stages (intake on a 200-page PDF) — add a
  "quick-intake" mode that samples first + last + every N pages?
- Can we re-run only affected stages after a correction? —
  Yes: the orchestrator tracks stage dependencies; if a
  correction only touches heads, skip intake+classifier.
  P1.

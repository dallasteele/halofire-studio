# Phase A.1 — Hydraulics backend follow-ups (complete)

**Date:** 2026-04-21
**Branch:** `claude/hal-makeover`
**Tests:** 47 passed, 1 skipped (`services/halopenclaw-gateway/tests/`)
**Depends on:** Phase A (scene store + single ops) + Phase C (live hydraulics UI)

## What shipped

Three follow-ups flagged by Phase C, landed end-to-end with tests.

### 1. `POST /projects/{id}/auto-peak`

Server-side worst-case remote-area selector. The Phase C ribbon's
"Auto Peak" button previously just re-ran `/calculate` and let the
hydraulic agent's internal farthest-heads heuristic pick the window —
the UI had no way to highlight the chosen polygon.

Now the gateway iterates candidate polygons, runs `hydraulic.calc_system`
against each, and picks the one with the tightest safety margin
(i.e. the polygon closest to failing hydraulic supply). The chosen
polygon is persisted on the scene graph with `selection_reason =
"auto_peak"` so undo/redo captures it.

**Request:**

```json
POST /projects/:id/auto-peak
{
  "candidates": [[{"x":0,"y":0},{"x":5,"y":0},{"x":5,"y":5},{"x":0,"y":5}], ...],
  "system_id":  "sys_abc123",      // optional; first system by default
  "supply":     {...},             // optional; FlowTestData override
  "hazard":     "ordinary_i"       // optional; inferred from building
}
```

Omitting `candidates` generates four quadrant windows around the head
cloud's bounding box, which forces the solver to surface hydraulically
disparate areas on real designs.

**Response:**

```json
{
  "ok": true,
  "op": "auto_peak",
  "seq": 17,
  "chosen_area": {
    "id": "ra_...",
    "name": "auto_peak",
    "polygon_m": [[x,y], ...],
    "selection_reason": "auto_peak",
    "chosen_residual_psi": 74.4,
    "chosen_flow_gpm": 150.3
  },
  "residual_psi": 74.4,
  "flow_gpm":     150.3,
  "demand_psi":   22.8,
  "system_id":    "sys_abc123",
  "all_candidates": [
    {"polygon_m": [...], "head_ids": [...], "margin_psi": 52.1,
     "residual_psi": 74.4, "demand_psi": 22.3, "flow_gpm": 140.0}
  ]
}
```

**SSE:** emits both `scene_delta` (generic consumers) AND a dedicated
`auto_peak` event so the Ribbon can highlight the chosen polygon
without sniffing every delta:

```json
event: message
data: {"kind":"auto_peak","seq":17,"chosen_area":{...},
       "residual_psi":74.4,"flow_gpm":150.3,"all_candidates":[...]}
```

**Files:**
* `services/halopenclaw-gateway/single_ops.py` — `auto_peak()` +
  `_default_peak_candidates()` + `_heads_in_polygon()` +
  `_point_in_poly()`.
* `services/halopenclaw-gateway/main.py` — route `POST /projects/{id}/auto-peak`.
* `services/halopenclaw-gateway/tests/test_auto_peak.py` — two tests.

### 2. Per-node `node_trace` persisted on the scene graph

`POST /calculate` now writes per-head / per-pipe `node_trace` fields
onto `design.json`. `GET /projects/:id/design.json` returns them
inline. Phase C's NodeTags overlay no longer needs to buffer the
`/calculate` response; it can read directly from the scene.

**Per-pipe shape:**

```json
"node_trace": {
  "flow_gpm": 25.0,
  "pipe_size_in": 1.0,
  "velocity_fps": 10.21,
  "length_ft": 15.0,
  "friction_loss_psi": 0.82,
  "downstream_heads": 1,
  "pressure_psi": 21.18,
  "worst_violation": "velocity_warn"   // only when >= 20 fps (crit >= 32)
}
```

**Per-head shape** (inherited from the upstream pipe, min-head-pressure
floor of 7 psi per NFPA 13 §28.6.2):

```json
"node_trace": {
  "flow_gpm": 25.0,
  "pipe_size_in": 1.0,
  "velocity_fps": 10.21,
  "pressure_psi": 21.18
}
```

Velocity uses the standard Hazen-Williams form
`v_fps = 0.4085 · Q_gpm / D_in²`. Severity bands match Phase C's
NodeTags palette (green < 20 fps, amber 20–32, red ≥ 32).

The `/calculate` response JSON is unchanged for back-compat — overlays
can read either the response OR the scene. Running `/calculate`
multiple times overwrites (not appends) node_trace.

**Files:**
* `services/halopenclaw-gateway/single_ops.py` — new
  `_persist_node_trace()` + `_velocity_fps()` + `_classify_velocity()`;
  called at the end of `calculate()`.
* `services/halopenclaw-gateway/main.py::calculate_design` — same
  persistence applied to the pydantic-based `/calculate` path.
* `services/halopenclaw-gateway/tests/test_node_trace_persistence.py`
  — two tests.

### 3. Hydraulic report PDF renderer

`hydraulic_report_pdf.py` renders `hydraulic_report.pdf` following the
AutoSPRINK / NFPA 13 §27 + Annex E 8-section layout:

| # | Section | Source field |
|---|---|---|
| 1 | Cover sheet | `section_1_design_density_area` + project/date |
| 2 | Density / area curve (table) | `section_1` + `section_5_hydraulic_worksheet` |
| 3 | Pipe schedule | `section_2_pipe_schedule` |
| 4 | Device summary | `section_3_device_summary` |
| 5 | Riser diagram (text schematic + Phase F TODO) | `section_4_riser_diagram` |
| 6 | Node-by-node results | `HydraulicResult.node_trace` or `calculation.systems[*].hydraulic.node_trace` |
| 7 | Demand / supply curve (table + Phase F TODO) | `section_6_demand_curve` |
| 8 | Summary + sign-off block | `section_5` + `section_8_test_data` |

**Honest caveats surfaced in the PDF itself:**
* Section 5 is a text/ASCII riser schematic. A vector P&ID drawing
  (valve symbols, elevation ticks, gauge callouts) is flagged as a
  Phase F follow-up with visible italic callout text in the document.
* Section 7 ships the flow/pressure points in tabular form. A proper
  log-log demand/supply chart SVG is also deferred to Phase F.
* The other six sections are fully rendered with live data.

Renderer accepts both input shapes:
* NFPA 8-section dict (from `build_nfpa_report` in the submittal agent).
* `/calculate`-shape dict (`{project_id, calculation: {systems:[...]}}`).
  In that case the renderer promotes what it can (cover, hydraulic
  summary, node-trace table) and renders "DATA UNAVAILABLE" stubs for
  sections that don't exist yet.

**On-demand regeneration:**

```bash
POST /projects/:id/reports/hydraulic
→ { "ok": true, "pdf_path": "/projects/:id/deliverable/hydraulic_report.pdf",
    "source_json": "nfpa_report.json", "bytes": 8421 }
```

404s with a clear message if neither `nfpa_report.json` nor
`hydraulic_report.json` exists yet.

**Pipeline integration:** `agents/10-submittal/agent.py::export_all`
now calls the renderer as part of the standard deliverable bundle. A
soft failure lands a `hydraulic_report_pdf_error` entry in the return
dict rather than breaking the rest of the submittal (DXF / GLB / IFC
still ship).

**Files:**
* `services/halopenclaw-gateway/hydraulic_report_pdf.py` — new module.
* `services/halopenclaw-gateway/main.py` — route
  `POST /projects/{id}/reports/hydraulic`.
* `services/halofire-cad/agents/10-submittal/agent.py::export_all`
  — renderer hook (soft-fail).
* `services/halopenclaw-gateway/tests/test_hydraulic_report_pdf.py`
  — three tests (full 8-section, `/calculate`-shape fallback, empty-data
  stubs).

## Phase C wire-up

No frontend changes required — everything is additive on the backend:

* `useLiveHydraulics.ts` already reads `node_trace` from the
  `/calculate` response; it can now *also* read it off `design.json`
  after any scene mutation (no re-calc hop needed).
* The ribbon `hydraulics-auto-peak` command should POST to
  `/projects/:id/auto-peak` (Phase C currently just re-runs
  `/calculate`). Subscribe to the new `auto_peak` SSE kind to
  highlight the chosen polygon.
* The ribbon `hydraulics-report` command already opens
  `/projects/:id/deliverable/hydraulic_report.pdf` — now that file
  actually lands after the submittal pipeline runs. The
  `/reports/hydraulic` endpoint lets the button fall back to an
  on-demand regenerate if the file is stale or missing.

## Verification

```
cd services/halopenclaw-gateway
C:/Python312/python.exe -m pytest tests/ -v

  tests/test_alpha_api.py ..                                    [ 4%]
  tests/test_auto_peak.py ..                                    [ 8%]
  tests/test_hydraulic_report_pdf.py ...                        [14%]
  tests/test_node_trace_persistence.py ..                       [19%]
  tests/test_openscad_runtime.py ..........s                    [42%]
  tests/test_phase_a_single_ops.py .......................      [91%]
  tests/test_scene_store_concurrency.py .                       [93%]
  tests/test_single_op_matches_pipeline.py ....                 [100%]

  47 passed, 1 skipped in 3.23s
```

Existing Phase A tests are unchanged — the `calculate` pydantic
round-trip still matches the agent's direct `calc_system` output
(the parity test was the regression anchor; it passes).

## Known gaps / deferred

* **Vector riser P&ID (Section 5).** The renderer ships a text
  schematic today. A full AutoSPRINK-parity riser drawing with valve
  symbols + elevation ticks is a real layout problem; the PDF itself
  carries a visible Phase F TODO so AHJs aren't misled.
* **Log-log demand/supply chart (Section 7).** Tabular today, SVG /
  matplotlib chart deferred to Phase F.
* **Per-node pressure is a proxy.** Currently derived as
  `demand_at_base_of_riser_psi - friction_loss_psi` for the head's
  upstream pipe. A full per-node pressure map awaits the v3 solver
  (Phase E).
* **Default auto-peak candidates are quadrant bboxes.** Good enough
  for most single-building designs; warehouse-scale layouts should
  pass explicit candidates driven by the room graph.

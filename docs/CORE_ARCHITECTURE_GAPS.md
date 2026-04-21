# CORE_ARCHITECTURE.md — Gap Analysis & What's Missing

**Date:** 2026-04-21
**Scope:** Self-critical review of `CORE_ARCHITECTURE.md`.

The prior doc is strong on the two-engine split (Pascal +
OpenSCAD + HF Core) and the build order of the CAD kernel. It is
**weak on product features, UX flows, and operational machinery**.
This doc lists the gaps, tiered by criticality, so the execution
plan can absorb them before Phase I starts.

Legend:
- **[P0]** blocks shipping — must be in the plan before coding.
- **[P1]** blocks a real user's first real bid — v1.0 scope.
- **[P2]** blocks power users / commercial viability — v1.5 scope.
- **[P3]** nice-to-have.

---

## A. Missing product features

The parity matrix in §8 covered 24 items. A working fire-protection
CAD needs ~50. Here's what was missed, grouped.

### A.1 Calculation engine depth [P0/P1]

- [P0] **Flow test data entry + supply curve** — engineer plots
  static / residual / flow onto a graph; hydraulic solver compares
  demand curve to supply curve. Without this, "safety margin" is
  hand-wavey.
- [P0] **Design area (remote area) method** — NFPA §19. Already
  have the enum in HazardClass + defaults table. Missing: the
  UI to draw the polygon, the solver that picks the 4 most
  hydraulically demanding heads inside it (density × area / 4 /
  K√P per head), the flow balancing across those 4.
- [P0] **Inspector's Test Valve (ITV) placement** — every system
  needs one at the hydraulically most remote head. Currently zero
  code for it.
- [P1] **Hanger spacing rules** — NFPA 13 Ch. 17. Max spacing per
  pipe size, intermediate hangers, end-of-line hangers, vertical
  supports. Router emits HangerNodes but doesn't enforce spacing.
- [P1] **Seismic bracing** — NFPA 13 Ch. 18. Lateral brace every
  40 ft (or less), longitudinal every 80 ft, 4-way at corners.
  Load path. Zone of Influence calc.
- [P1] **Pipe schedule rules** — NFPA 13 §22 light-hazard pipe
  schedule method (the non-hydraulic alternative). Some small
  jobs still use this.
- [P1] **Fire pump integration** — pump curve (churn / rated /
  peak), series with supply curve, NFPA 20 compliance check.
- [P1] **Tank sizing** — for stored-water systems: gravity tank,
  pressure tank, fire pump tank.
- [P1] **Dry pipe trip-time + water delivery** — NFPA §7.2.3.6.1
  60-second water delivery requirement, air compressor sizing.
- [P2] **Pre-action electrical supervision** — interconnect with
  fire alarm system.
- [P2] **Antifreeze loop sizing** — §8.15.
- [P2] **Standpipe Class I/II/III detailing** — hose valve
  locations, flow rates, Class-specific minima/maxima.

### A.2 Drawing + sheet management [P0/P1]

- [P0] **Sheet sets** — a real fire-protection submittal is a bound
  package of sheets: FP-1 title/legend, FP-2 site plan, FP-3 to
  FP-N floor plans (one per level), FP-N+1 riser diagram, FP-N+2
  hydraulic calc, FP-N+3 details. Currently we render ONE 3D
  model. Missing: sheet authoring, per-sheet viewports, title
  blocks, sheet index.
- [P0] **Scale + paper space** — each sheet has a drawing scale
  (1/8"=1'-0" typical commercial, 1/16"=1' campus). Viewport
  scales. Paper size (Arch D 24×36 typical, Arch E 36×48 big).
- [P0] **Title block** — project name, sheet number, revision,
  drawn/reviewed/approved stamps, PE seal placeholder. Per-firm
  template.
- [P1] **Dimensioning** — linear, continuous, ordinate, radial,
  diameter, leader. NFPA requires dims on every run. No
  annotation engine in the plan.
- [P1] **Text + callout leaders** — "2" CROSS MAIN", "K5.6 HEADS",
  system names, room labels.
- [P1] **Hatch / fill** — shaded zones per hazard class.
- [P1] **Label automation** — pipe size labels where pipe size
  changes, head identifier labels in a ruleset.
- [P1] **Revision clouds + bubbles** — AHJ markup responses.
- [P2] **Drawing scale viewports** — same plan at multiple
  scales on different sheets.

### A.3 Manual intake modes [P0]

- [P0] **DWG/DXF underlay with manual trace** — 90% of real jobs
  come in as DWG, not PDF. User imports the DWG as an underlay
  (alpha-dimmed background), then traces walls on top with
  the existing wall tool. We intake PDFs via CubiCasa; we don't
  yet import DWG at all.
- [P0] **PDF manual trace** — when intake misses walls, user
  traces over the PDF image. Pascal has a wall tool; missing: the
  image-in-background setup + scale calibration (user clicks
  known-length line, types "25'-0"", scale is set).
- [P1] **IFC import** — BIM model from the arch. We have
  `@halofire/ifc` but read-only round-trip isn't in the plan as
  a first-class user flow.
- [P1] **Reference plans overlay** — multiple underlays at once
  (arch PDF, structure DWG, HVAC IFC).

### A.4 Annotations, markup, review [P1]

- [P1] **Comments pinned to nodes** — "this head too close to
  duct" — Revit-style.
- [P1] **AHJ correction response** — formal markup track (cloud +
  number, response note, status open/closed).
- [P1] **Revisions** — V0 initial, V1 first AHJ submittal, R1 first
  AHJ correction, R2 second — with a per-revision diff.
- [P2] **PE seal + digital stamp** — licensed engineer signs, the
  stamp is embedded in the exported PDF with signature metadata.
- [P2] **Audit trail** — who changed what, when, why — required
  for licensed-PE workflows.

### A.5 Coordination + clash [P1]

- [P1] **Clash detection** — sprinkler through beam, pipe through
  duct, head inside light fixture. Runs against coordination
  models (structure, HVAC, electrical).
- [P1] **Obstruction import** — OBS models from Revit / Navisworks
  become ObstructionNodes; placement + routing avoid them.

### A.6 Handoff artifacts [P0/P1]

- [P0] **Stocklist grouping** — by fab vs field cut, by system, by
  level, by crew assignment. Our current BOM is flat.
- [P0] **Cut sheets** — one page per unique SKU, with the
  manufacturer's data sheet attached. AHJ requires them.
- [P1] **Prefab drawings** — per-system, per-level, per-prefab-
  unit. The fab shop builds from these.
- [P1] **Labeling drawings** — where the installer puts the
  waterflow label, the hydraulic calc placard, the FDC sign.
- [P2] **Commissioning docs** — NFPA 25 initial inspection forms.

### A.7 Data + catalog lifecycle [P1/P2]

- [P1] **Supplier price updates** — we have the crawler; missing
  the review-and-apply UX. User sees "3 catalog prices changed
  > 5 %, approve?"
- [P1] **Custom parts library** — per-firm SCAD additions that
  aren't in the shared catalog. Pascal loads firm-specific
  overrides on top of the base catalog.
- [P2] **Manufacturer cut-sheet ingestion** — a PDF cut sheet
  from Tyco → auto-extract dimensions + K-factor + listing →
  new Part.

### A.8 Export formats [P0/P1]

- [P0] **DXF export** — AHJs still want DXF. Intake produces
  design.dxf but the export pathway isn't in the core doc as
  a first-class output.
- [P1] **DWG export** — same story, different format.
- [P1] **IFC export** — BIM round-trip.
- [P1] **RVT export** — Revit interop via Revit's IFC or the
  Autodesk Forge API.
- [P1] **PDF export of sheet set** — the bound drawing package.
- [P2] **Plotter output** — directly to an HP DesignJet etc.

### A.9 External integrations [P1/P2]

- [P1] **QuickBooks / Sage / SAP export** — cost-codes and
  accounting roll-up.
- [P2] **AHJ submission portals** — some cities have online submit
  (NYC DOB, LA Building & Safety); most still PDF email.
- [P2] **Procurement APIs** — generate POs against Ferguson /
  Core & Main catalogs.

---

## B. Missing UI / UX flows

The parity matrix listed WHAT; not HOW the user gets through it.
These are the journeys the doc has to specify before we cut tools.

### B.1 The "first launch" flow [P0]

```
User double-clicks HaloFireStudio.exe
  │
  ▼ Splash screen: logo + loading progress (catalog, hf-core
  │  hydrate, Python sidecar handshake)
  │
  ▼ Home screen — NOT the editor:
  │  ┌─────────────────────────────────┐
  │  │  RECENT PROJECTS                │
  │  │   · 1881 Cooperative — last …  │
  │  │   · Gomez Warehouse — last …   │
  │  │                                 │
  │  │  [ New Project ] [ Open File ] │
  │  │  [ Import from AutoSPRINK ]    │
  │  └─────────────────────────────────┘
  │
  ▼ "New Project" → wizard:
  │   1. Project name + address
  │   2. Firm + designer (auto-filled from last project)
  │   3. Contract type (design-build / design-bid / RFI response)
  │   4. Input material (PDF / DWG / IFC / nothing)
  │   5. Hazard hint (LH, OH1, OH2, EH1, EH2, storage)
  │
  ▼ Editor opens with a blank viewport + the ingested underlay
     (if any) as background.
```

**Missing from plan:** splash screen, home screen, new-project
wizard, import-from-AutoSPRINK flow, recent projects list
component.

### B.2 The "drop a PDF, ship a bid" flow [P0]

The money flow. Every step needs a designed screen:

1. User drags PDF onto viewport empty state.
2. **Scale calibration modal** — "is this set to 1/8"=1'-0"?
   Click two points on a known dimension → type the dimension →
   we lock scale."
3. Autopilot starts — per-stage progress bar **inside** the
   viewport (not a side panel), with each stage flashing the
   new geometry that just landed.
4. User can **pause** autopilot between stages ("wait, that wall
   is wrong — let me fix before head placement"). Fix the wall,
   click **Resume** — pipeline continues from the next stage.
5. At the end, a **review panel** appears: "1,293 heads across 7
   systems. $595 K bid. 12 NFPA warnings — review?"
6. User clicks through warnings, resolves or accepts, then clicks
   **Ship** → generates the submittal bundle.
7. Ship dialog: generate PDF, DXF, Hydralist, NFPA report, put them
   where? (Local folder / email / AHJ portal).

**Missing from plan:** scale-calibration modal, pause-between-
stages contract, review panel, ship dialog, per-stage in-viewport
flashes.

### B.3 The "edit a pipe" flow [P0]

- Click pipe → selected, properties panel appears on right
  with Size / Schedule / Role / System / Length fields + a
  "↓ downstream" button.
- Hover over an endpoint handle → cursor becomes crosshair.
- Drag endpoint → Tier-3 preview follows cursor, grid + snaps
  active, Location Input chip shows XYZ.
- Type "12'6"" while dragging → endpoint jumps to exactly 12'-6"
  from reference.
- Release mouse → Tier-2 re-renders fittings + hydraulic solves
  + updates Δbid.
- Right-click pipe → context menu: **Split**, **Join to selected**,
  **Copy size to run**, **Change schedule**, **Add fitting mid-
  span**, **Delete**.

**Missing from plan:** the drag-preview UX, Location Input chip
behavior, dimensional input during drag, context menu surface.

### B.4 The "run hydraulic calc" flow [P0]

- Editor always shows LIVE calc in the LiveCalc panel (already
  planned) but it's a quick estimate.
- User clicks **Calculate → Full Hazen-Williams** (or F9).
- Dialog: "Calculate which system?" [This system / All systems /
  Selected remote area only].
- Progress bar — the Hardy Cross solver is iterative, can take
  5-30 seconds for big systems.
- Result dialog shows summary + link to **Open full report**.
- Full report = the NFPA 8-section report, displayed in an
  embedded viewer with PDF export button.

**Missing from plan:** the "which system" dialog, progress spinner
contract, summary-then-full-report progressive disclosure.

### B.5 The "review and approve" flow [P1]

- Multi-role: designer, PE reviewer, project manager, GC.
- Each role has a different home screen and different available
  actions.
- Approval requires digital signature (local cert for now; DSA
  eventually).
- Approve-and-lock: after PE approval, edits require un-approve +
  re-approve.

**Missing from plan:** role concept entirely. Currently the app
is single-user.

### B.6 Empty, loading, error states [P0]

Every screen needs these. Currently specced for zero.

- **Empty viewport** — no project loaded. Message + "New /
  Open" CTAs.
- **Loading** — pipeline running, no model yet. Progress
  animation, cancel button.
- **Error** — pipeline failed, invalid catalog, corrupt project.
  Machine-readable error + human-readable suggestion + "copy
  details" button.
- **Offline** — no network. Catalog crawler + AHJ portal features
  greyed with reason.

### B.7 Keyboard + command palette [P0]

Power users live in keyboard. Need a first-class:

- **Keyboard map** — every AutoSPRINK-equivalent shortcut. Ours
  should be configurable.
- **Command palette** (Cmd-K) — search-to-invoke every action.
  We have a `CommandPalette.tsx` component; need to enumerate
  the command surface in the doc.
- **Cursor coordinate echo** — always visible: "X 23.4 m  Y 2.8 m
  Z 15.7 m" in the status bar.
- **Snap priority** — when endpoint and midpoint collide, which
  wins? Configurable, with visible indicator.

**Missing from plan:** full keyboard map, command-palette
command inventory, snap-priority config, coordinate echo.

### B.8 Multi-monitor + view-mode UX [P1]

Bid rooms use 3 screens. We need:

- **Split viewport** — 2D plan + 3D + report on one screen or
  pulled to secondary. Pascal has split view.
- **Pop-out panels** — drag the BOM into its own window.
- **Linked selection** — select in 2D → highlights in 3D.

**Missing from plan:** pop-out windows, linked-selection contract.

### B.9 Accessibility + visual design [P1]

- **Keyboard-only navigation** end-to-end. Tab order, focus rings,
  aria labels.
- **Screen reader support** — fire-protection engineers skew
  older; some use reading aids.
- **Color contrast WCAG AA** — our red `#e8432d` on black is
  ~6:1, borderline. Check rest of palette.
- **Dark vs light theme** — some shops bright daylight offices.

**Missing from plan:** accessibility commitments + theme system.

### B.10 Onboarding + help [P1]

- **First-run walkthrough** — coach marks on core tools.
- **Contextual help** — "?" icon on every panel, links to the
  right docs section.
- **Keyboard shortcut overlay** — press `?` → floating card.
- **Sample project** — every install ships with the 1881 demo so
  a new user can see an end-to-end bid.
- **Video tutorials** — embedded.

---

## C. Missing process / code architecture

### C.1 State + edit stack [P0]

- [P0] **Undo / redo stack** — Pascal has `zundo` (listed in
  `packages/core` deps); it's not mentioned in the doc. How do we
  handle undo across the Pascal store AND the SCAD re-renders
  (do undoing a pipe-size change evict the Tier-2 GLB?)
- [P0] **Dirty tracking** — what changed since last save? Drives
  autosave, "unsaved changes" prompt on close, diff view.
- [P0] **Transaction boundaries** — a single user action may
  mutate 10 nodes (move a branch → updates 20 heads, 19 pipes,
  4 fittings). Undo treats those atomically.

### C.2 Project file format [P0]

- [P0] `.hfproj` bundle spec — directory or zip? What files?
  - `manifest.json` — project metadata
  - `design.json` — scene graph snapshot
  - `corrections.jsonl` — user edits over intake output
  - `catalog-lock.json` — pinned catalog SKU + price versions
  - `revisions/` — V0, V1, R1 snapshots
  - `underlays/` — referenced PDFs / DWGs
  - `exports/` — generated PDF / DXF / GLB artifacts
  - `comments.jsonl` — pinned notes
  - `audit.jsonl` — who-did-what log

- [P0] **Schema migrations** — version number + migration
  functions when the schema evolves.
- [P0] **Forward-compat policy** — old client opens new file →
  read-only or convert-in-place?

### C.3 Save / load / autosave / crash recovery [P0]

- [P0] **Autosave cadence** — every N seconds to a `.autosave/`
  shadow directory.
- [P0] **Crash recovery** — on launch, check for orphan autosave,
  offer to recover.
- [P1] **Local version history** — rolling snapshots.

### C.4 Concurrency [P1]

- [P1] **Single-user concurrency** — two windows of the same
  project. Lock file? Last-write-wins? Warning banner?
- [P2] **Multi-user collaboration** — CRDT-based real-time edit
  (Yjs / Automerge). Way out.

### C.5 Performance budgets [P0/P1]

- [P0] **Viewport frame budget** — 60 fps during drag at
  1,500 heads. Current AutoDesignPanel caps at 150 heads to
  avoid swamping. We need instanced meshes for heads + pipes
  to scale.
- [P0] **Memory budget** — full 1881 project ≤ 1 GB resident.
- [P1] **Cold-launch time** — ≤ 3 s from double-click to first
  frame. Warm launch ≤ 1 s.
- [P1] **Pipeline end-to-end time** — full 1881 auto-bid ≤ 90 s.

### C.6 Sidecar + OpenSCAD lifecycle [P0]

- [P0] **Sidecar death → recovery** — Python crashes mid-pipeline.
  Do we auto-restart? Preserve partial results? Surface a
  recoverable error?
- [P0] **OpenSCAD concurrency** — user spins 5 knobs fast. Queue,
  throttle (debounce), or cancel-old? Cache should serve most;
  spec the policy.
- [P0] **Memory caps on workers** — OpenSCAD can OOM on
  pathological inputs. Hard-kill limit + graceful message.

### C.7 Rust ↔ Webview IPC [P0]

- [P0] **Error taxonomy** — network vs validation vs logic vs
  licensing. Each maps to a UI treatment.
- [P0] **Back-pressure** — a burst of `pipeline:progress` events
  overwhelms React re-render. Coalesce in Rust or use a
  bounded channel.
- [P1] **Transport versioning** — Rust + TS agree on a command
  schema version; mismatch surfaces as a specific error, not a
  silent hang.

### C.8 Python ↔ TypeScript mirror drift [P0]

Cross-engine golden fixtures are called out but the MECHANICS
aren't:

- [P0] **One file, two consumers** — golden fixtures live under
  `packages/hf-core/tests/golden/`. TS test via vitest; Python
  test via pytest. Both load the same JSON.
- [P0] **CI job** — on every PR, runs both, diffs outputs,
  fails if any numeric drifts > ε.
- [P0] **Drift policy** — when a fixture needs to change, both
  sides change in the same commit.

### C.9 Catalog build pipeline [P0]

- [P0] **Watch mode** — dev: .scad saved → regenerates catalog
  entry + re-bakes GLB.
- [P0] **Incremental builds** — Turbo-cached per .scad.
- [P1] **Catalog lint** — every Part must have tests (snapshot
  of bake output), every Port must be reachable from the part
  centroid, every Param must have min/max.

### C.10 Catalog update + delivery [P1]

- [P1] **Catalog channels** — stable / beta / dev. Users pick.
- [P1] **Catalog signing** — cryptographic signatures so
  tampered prices are detected.
- [P1] **Catalog versioning in projects** — a project locks to
  the catalog version that was current when bid was approved.

### C.11 File I/O + clipboard [P1]

- [P1] **OS drag-and-drop** — drop a PDF onto the window →
  start new project or import to current. We have the upload
  button; the drag-drop contract isn't specified.
- [P1] **Clipboard** — copy a head, paste into another level; copy
  a BOM to Excel.

### C.12 Logging, telemetry, crash reporting [P1]

- [P1] **Structured log file** — `app_data_dir/logs/` rotated
  daily. Machine-readable.
- [P1] **Crash report opt-in** — Sentry-style dumps, off by
  default.
- [P2] **Usage telemetry** — which tools get used, how often.

### C.13 Update mechanism [P1]

- [P1] **Tauri updater** — signed deltas, stable/beta channels.
- [P1] **Schema migration** — new app reads old `.hfproj`; old
  app chooses between "open read-only" or "refuse".

### C.14 Licensing / activation [P2]

- [P2] Commercial? Open-source? Per-seat? Per-firm? Per-project?
  Not in the plan at all.

### C.15 Units + locale [P1]

- [P1] Imperial default (US fire-protection); metric toggle
  (Canada, EU). Throughout: inputs accept either, store
  canonical (metric internally, imperial display).

---

## D. Cross-cutting concerns [P1/P2]

- **Privacy** — floor plans are security-sensitive (e.g., federal
  buildings, data centres). No cloud upload by default.
- **Offline operation** — fire-protection sites are often
  construction sites without internet. Core must run offline.
- **Printer + plotter drivers** — Arch D/E paper, HP DesignJet.
  Typically handled by the OS print stack but we need correct
  paper-size metadata in exports.
- **Mobile / tablet companion** — foreman walks site. Separate
  app, but the file format has to accommodate.
- **Unit + dimension handling** — feet+inches input parser
  (`12'-6 1/2"`), decimal feet (`12.54`), metric (`3.826 m`).
  Currently ad-hoc in various panels.

---

## E. Recommended plan changes

Absorb the P0 gaps into `CORE_ARCHITECTURE.md` before Phase I
starts. Specifically:

### E.1 Expand §11 Execution order

Insert a **Phase 0 — foundation that doesn't exist yet**
before the current Phase I:

- **0.1** `.hfproj` bundle spec + zod schemas + test round-trip.
- **0.2** Undo/redo transaction boundaries on scene store (Pascal's
  zundo wired with explicit commit/rollback boundaries around
  compound edits).
- **0.3** Autosave + crash recovery primitives.
- **0.4** First-launch splash / home / new-project-wizard
  skeleton.
- **0.5** Error taxonomy + global error surface.
- **0.6** Performance budget baseline — instanced meshes for
  heads + pipes (prove 1500 heads at 60 fps before committing
  to the Phase III interactive tools).

### E.2 Add §8.b — UI/UX flow specifications

Every tool in the parity matrix gets a companion flow spec: inputs,
intermediate states, keyboard affordances, error paths, exit
conditions. Use the B.1–B.7 flows above as the pattern.

### E.3 Add §11.b — "Ship the shell" side track

Phases VIII (Tauri) and II (Pascal node types) are interleaved
wrong. The shell + file format are P0; the fancy placement tools
are P1. Re-prioritize:

1. **MVP ship** — Phases VIII + 0 + I + simple place/route tools =
   user can drop a PDF, get a model, export a PDF. One commit path.
2. **v1.0 ship** — Phases II + III + IV + V = AutoSPRINK-class
   editing.
3. **v1.5 ship** — Phases VI + VII + IX = polish + coordination.

### E.4 Add §10.d — Python/TS parity CI

Document the golden-fixture CI contract + the "both sides change
together" rule.

### E.5 Add §4.c — Catalog annotation lint

Before writing the parser (I1), specify the lint rules it enforces:
every Part has ≥ 1 Port, every Param has min/max, every @kind is
in the enum, etc.

### E.6 Reopen the "kick in OpenSCAD's own DSL" question

The plan uses `.scad` files but says nothing about LEVERAGING the
SCAD language's power for the estimator. Open questions:
- Can user author custom parts in SCAD directly inside the app
  (code editor pane)?
- Does the parser support `include <other.scad>` so complex
  assemblies compose?
- Do we ship a SCAD-fragment library (e.g., `fp_common.scad` with
  helpers for NPT thread geometry, grooved ends, K-factor
  deflector shapes)?

This is LATENT POWER — AutoSPRINK's parts are closed data; our
parts are open, composable, editable code. Worth a full §4.c
subsection when we go there.

### E.7 Decide + document the units doctrine

A one-pager: "Canonical internal units are metric (SI). Display
preference is per-user; defaults to imperial in en-US locale.
Parser accepts mixed (feet-inches OR decimal-feet OR metric) in
any numeric field."

### E.8 Spec the 3D instancing

`THREE.InstancedMesh` for heads + pipes is not in the plan. At
1,293 heads (current test) performance is borderline; at 10,000
(warehouse scale) we die without it. Add to Phase 0 deliverables.

---

## F. Scorecard

| Area | Coverage in CORE_ARCHITECTURE.md |
|---|---|
| Two-engine doctrine | ✅ strong |
| SCAD three-tier integration | ✅ strong |
| HF Core bridge layer | ✅ strong |
| Part catalog schema | ✅ strong |
| Pascal fire-protection nodes | ✅ strong |
| Parametric hot path | ✅ good (missing instancing) |
| Auto-bid integration | 🟡 partial (streaming spec thin) |
| **Sheet / drawing management** | ❌ missing |
| **Dimensioning + annotation** | ❌ missing |
| **Project file format** | ❌ missing |
| **Undo / redo / dirty tracking** | ❌ missing |
| **UI/UX flows** | ❌ missing |
| **Onboarding + home screen** | ❌ missing |
| **Error / empty / loading states** | ❌ missing |
| **Keyboard + command palette surface** | 🟡 partial |
| **Performance + instancing** | ❌ missing |
| **Catalog lint + annotation rules** | 🟡 mentioned, not specced |
| **Python/TS parity CI** | 🟡 mentioned, not specced |
| AutoSPRINK feature parity | 🟡 24 of ~50 |
| Calculation depth (flow test, pump, seismic, hanger) | 🟡 partial |
| DWG / IFC / RVT import | ❌ missing |
| Sheet set + title block + scale | ❌ missing |
| Clash detection + coordination | ❌ missing |
| Sidecar lifecycle + error recovery | 🟡 partial |
| Multi-role (PE, reviewer, GC) | ❌ missing |
| Licensing + units + locale | ❌ missing |

**Overall:** the CAD engine specification is ~80 % done. The
product specification is ~35 % done. UX flows are ~10 % done.
Operational machinery (save/load/undo/perf) is ~5 % done.

The prior doc is a good engine plan but is **not yet an app plan**.
Next step should be merging §§A-E above into a revised
CORE_ARCHITECTURE.md (v2) that covers the app surface end-to-end
before any of Phase I code gets written.

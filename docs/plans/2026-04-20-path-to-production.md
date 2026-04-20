# Path to Production — Research + Resolution Plan

**Date:** 2026-04-20
**Author:** Claude Opus
**Status:** Active. Replaces hand-waving "needs external input" excuses
with concrete open-source paths, prior art, implementation sizing, and
test criteria for every outstanding gap.

**Rulebook:** `E:/ClaudeBot/AGENTIC_RULES.md` governs every item.

---

## Brutally honest current state (2026-04-20)

What a user sees today when they load HaloFire Studio:

1. **Scene bootstrap spawns a 150 m × 150 m honeycomb building** with
   30 m "rooms." That's not a building — that's a storage-unit
   complex. The procedural generator's math is wrong when
   `total_sqft_target` is large.
2. **Catalog GLBs render as featureless cylinders / blocks.** They
   exist as files, but they're procedurally generated in Blender with
   no manufacturer-accurate geometry.
3. **Auto-Design against real 1881 arch PDF runs end-to-end** but
   produces 2,500+ placed heads against false-positive rooms detected
   by L1 pdfplumber. Output is garbage.
4. **Fire Protection (manual) tab** has working individual stage
   buttons but no cohesive workflow.
5. **Bid viewer at `/bid/1881-cooperative`** works at a basic level
   but the 3D preview is sample 6×6 grids, not the real design.

So: the plumbing works, the data model works, the test harness works.
The actual *output quality* doesn't. This plan fixes output quality.

---

## Gap inventory (every unsolved thing, categorized)

### Tier A — Blocks real bid use (must-have)

| Gap | What's broken | Owner |
|---|---|---|
| A1 | L1 pdfplumber over-reads dimension/hatching linework as walls | intake |
| A2 | Multi-page PDF → one level per page (not one level per story) | intake |
| A3 | Synthetic building generator geometry is unrealistic at scale | building-gen |
| A4 | Catalog meshes are featureless primitives, not manufacturer BIM | catalog |
| A5 | Building viewport looks like storage shelves, no doors/windows | building-gen glb |
| A6 | Placer coverage-cap bug (xfail) under-covers 10m² rooms | placer |
| A7 | No historical Halo bid corpus → quickbid off by 23%+ | quickbid |

### Tier B — Blocks permit/submittal use

| Gap | What's broken | Owner |
|---|---|---|
| B1 | Hydraulic solver is tree-only; §28.7 looped/grid systems unsupported | hydraulic |
| B2 | Remote-area selection by tree-hop is naive vs real friction-length | hydraulic |
| B3 | Pump curve + tank integration not chained into main calc loop | hydraulic |
| B4 | IFC swept-solid geometry not verified in Revit/Navisworks | submittal |
| B5 | DXF title-block + dimension annotations missing | drafter |
| B6 | PE review UI doesn't exist (workflow model does) | pe-signoff |
| B7 | Native DWG read punted (convert-to-DXF only) | intake |

### Tier C — Polish / scale

| Gap | What's broken | Owner |
|---|---|---|
| C1 | UX still Pascal editor + HaloFire tabs, not AutoSprink-class | ui |
| C2 | No ribbon / command-line / layer palette / properties pane | ui |
| C3 | Playwright E2E not wired (zero browser tests) | tests |
| C4 | Production auth stack untested end-to-end | gateway |
| C5 | Multi-tenant / per-organization isolation not designed | gateway |
| C6 | No monitoring / SLO / error budget | ops |
| C7 | No on-call runbook | ops |

---

## Resolution plan per gap

Each gap: open-source options, prior art, effort estimate (hours of
focused work), test criteria, and how we verify "done."

---

### A1 — L1 over-reads wall linework

**Problem.** `pdfplumber.page.lines` returns every drawn vector
including dimension arrows, hatching, annotation callouts, title-block
rules, column/beam schedules. Treating all of them as wall candidates
means `shapely.polygonize` finds thousands of false-positive polygons
bordered by dimension lines instead of walls. On the real 1881 page 1,
L1 returned 141,000 line candidates.

**Open-source options (researched):**

| Option | License | Notes |
|---|---|---|
| **CubiCasa5k** (ECCV 2019 paper + released weights) | MIT | Semantic floor-plan segmentation CNN. Predicts walls / doors / windows / rooms per pixel. Weights ~400 MB on HuggingFace. Trained on 5k floor-plan images from CubiCasa's real estate dataset. |
| **DeepFloorplan** (TIP 2019) | MIT | Alternative to CubiCasa5k, multi-task network for floor-plan recognition. |
| **Raster-vectorization pipelines** (OpenCV + hand-rules) | Apache | LSD + Hough + morphological ops. Works when L1 fails but still can't distinguish walls from dimensions. Improvement over L1, not a fix. |
| **Detectron2** trained on custom dataset | Apache | Higher-quality segmentation but needs training data (we don't have). |
| **SAM 2 / Segment Anything** (Meta) | Apache | Zero-shot segmentation — would need prompting infra + classification layer. |

**Prior art we can borrow from:**
- IfcOpenShell's `ifcopenshell.geom` for when the architect provides
  IFC (no CNN needed)
- `bim-cli` CLI toolkit for DXF→IFC pipelines
- `CadGPT` paper (2024) — GPT-4V prompted with plan images to extract
  structured room graphs

**Implementation plan (sized):**

1. Wrap CubiCasa5k in `agents/00-intake/l3_cubicasa.py` — 6 hrs
   - Download weights once to `services/halofire-cad/models/`
   - `classify_plan_image(png_bytes) -> PlanSegmentation` with per-pixel
     class map + per-class polygon list via `cv2.findContours`
   - Cache predictions in `data/{project}/l3_cache/` keyed on sha256
2. Orchestrator layer-chain upgrade — 3 hrs
   - L1 extracts raw lines
   - L2 OpenCV cleans + fills gaps (already done)
   - **L3 CubiCasa5k** filters to wall-class polygons (NEW)
   - L4 Claude Vision or LLaVA annotates room use (later)
3. Property test: on a known 1881 page, L3 finds ≥ 6 rooms with ≤
   10% false-positive area — 2 hrs
4. End-to-end test: real 1881 page 1 with L3 produces 10–80 heads
   (not 55,107) — 2 hrs

**Effort:** ~13 hrs. **Test criteria:** head count on 1881 arch first
5 floor-plan pages within 20% of Wade's manual takeoff.

---

### A2 — Page-to-level mapping

**Problem.** `intake_file` treats each PDF page as a separate `Level`
with a placeholder elevation (`page_index * 3.0`). A 110-page arch
set becomes 12 levels (capped), not the 6 real floors of the 1881
building. Stair shafts don't span levels correctly. The classifier
then runs per-fake-level.

**Fix path (no external deps needed):**

1. **Enhance `title_block.classify_page`** (already B.5-scoped) to
   extract the level/story from the sheet label. We have the
   `_LEVEL_NAME_PATTERNS` regex list. Widen it to match "A-101 Level
   1 Plan" / "A-101 Ground Floor Plan" / "A-105 Roof Plan".
2. **Group pages by matched level** before emitting `Level`
   objects. Pages that can't be grouped go to an "unassigned" level
   with a manifest warning.
3. **Merge geometry per level group** — union wall sets + polygonize
   once per real level, not once per page.

**Effort:** 4 hrs + 2 hrs tests.
**Test:** against 1881 arch, produce 6-7 levels (parking P1 + P2 +
residential 1–4 + roof), not 12.

---

### A3 — Building generator geometry at scale

**Problem.** `_default_residential_spec` takes total_sqft and
distributes across levels. At 100k sqft / 6 levels = 16,666 sqft per
level. Converted to m² / aspect 1.5 → W=28m, L=42m. That part is
fine. But `_grid_rooms` divides 20 units into `rows=ceil(sqrt(20/1.5))=4`
`cols=ceil(20/4)=5` grid cells → rooms are 28/5 × 42/4 = 5.6 × 10.5m.

**Actual bug:** at `total_sqft_target = 170_000` (matching 1881's
real footprint), per-level = 28,333 sqft = 2,632 m². At aspect 1.5:
W=42m, L=63m. 20 units → room_w = 42/5 = 8.4m, room_l = 63/4 = 15.8m.
OK 8×16m is a plausible corner 2-bedroom.

**So the math is fine.** The *visual* problem in the screenshot is
that the GLB emitter extrudes walls as full-height prisms with no
door/window openings and no roof, making it look like a storage
complex. That's A5, not A3.

**Fix for A3 alone** (small — clamp total_sqft + add room_count
sanity checks): 1 hr.

---

### A4 — Catalog meshes are procedural, not manufacturer-accurate

**Problem.** The 20 catalog GLBs were generated procedurally in
Blender. They look like generic cylinders / blocks. A real
installation needs:
- Victaulic style grooved couplings with rib geometry
- Tyco TY325 concealed pendent with real escutcheon
- Viking VK102 sidewall with deflector geometry

**Options:**

| Option | Status | Notes |
|---|---|---|
| **FreeCAD-generated parametric meshes** | Open | Scripts per SKU type; produces closer-to-reality geometry. Slow to author (~4 hrs per SKU family). |
| **Manufacturer Revit families → Blender → GLB** | Free-ish | Revit families are free from manufacturer websites; converting needs Revit or a bridge. Blocked by Autodesk license on conversion. |
| **NIBS BIM Object library** | Open | National Institute of Building Sciences has some sprinkler families. Coverage spotty. |
| **3D Warehouse (SketchUp)** | Free | Community models, license terms vary. |
| **Thingiverse / Printables** | CC | User-uploaded sprinkler heads for 3D printing. Not manufacturer-accurate. |
| **Manual authoring in Blender** | Open | 4 hrs per SKU family × 4 families = 16 hrs. |

**Honest path:** keep procedural meshes for Alpha (+"approximate"
label), upgrade one SKU family at a time based on which ones Halo
actually uses most. Victaulic + Tyco + Viking cover 80% of jobs.

**Effort per family upgrade:** 4 hrs Blender + 1 hr GLB export tests.

---

### A5 — Building GLB looks like storage shelves

**Problem.** `building_to_glb` extrudes walls as solid prisms with
no openings. Every level's slab + walls stack vertically to form a
honeycomb.

**Fix (no external deps):**

1. **Subtract door + window openings** from wall meshes using
   `trimesh.boolean.difference`. Currently no openings in the
   generator. Requires adding `openings: list[Opening]` to each
   Level, then boolean-subtracting each opening from the wall
   mesh during GLB emission.
2. **Add a roof slab** at `max(elevation) + height`.
3. **Color walls by use-class** (garage = dark concrete, residential
   = light stucco, mech = grey panel) so levels read visually.
4. **Optional:** cutaway view — render only the bottom N floors so
   the user can see the interior, not just the exterior wall.

**Effort:** 6 hrs + 3 hrs tests (trimesh boolean is slow and sometimes
produces non-manifold meshes).
**Test:** GLB has N doors and M windows, building shows level
differentiation at first glance.

---

### A6 — Placer coverage-cap bug (xfail)

**Problem.** Current placer shrinks room polygon by `spacing/2` then
grids inside. In a 10×10m light-hazard room this produces 4 heads for
100 sqm = 25 sqm/head, exceeding the NFPA §11.2.3.1.2 cap of 20.9
sqm/head.

**Fix approach (no external deps):**

1. **Drop the wall-inset pre-step** and grid against the full room
   polygon, then clip grid cells to (polygon.buffer(-0.3)) per
   §11.2.3.1.3 (min 4-inch offset from wall, not s/2).
2. **Bump grid density** so `grid_cells × max_coverage ≥ room_area`.
3. **Optimal packing** — use `rpack` library (MIT, pure Python) for
   rectangle packing if the room is non-rectangular.

**Effort:** 4 hrs + 2 hrs tests (remove xfail marker, add property
test that heads-per-room coverage always ≤ hazard cap).

---

### A7 — Pricing calibration corpus

**Problem.** Quickbid returns $662k for 1881 specs when Halo's real
proposal was $538k (+23%). Without a real corpus we can't calibrate.

**Options:**

| Option | Status |
|---|---|
| Wade's XLSX proposal files | Blocked on Halo providing data |
| **Scrape RS Means data** | $800/yr, industry standard |
| **Use TigerCAD's published cost benchmarks** | Limited, free |
| **Generate synthetic corpus with known noise** | Done infrastructure, not real-world |
| **Small-N Halo bids (2026 Sep proposal)** | Usable as 1-point anchor |

**Immediate action:** ask Wade for 5+ historical proposals. In
parallel, incorporate RS Means fire-protection line items (their
CD/web subscription has structured JSON).

**Effort after data arrives:** 4 hrs (fitter code already written).

---

### B1 — Looped/grid hydraulic solver

**Problem.** Current `calc_system` is tree-only. §28.7 grid systems
are common on large warehouses + extra-hazard. Hardy-Cross is coded
in `hardy_cross.py` but not wired into the main calc path.

**Implementation:**

1. Detect loops in the pipe graph (`networkx.cycle_basis`).
2. If loops detected, use Hardy-Cross to balance flows.
3. Report convergence via existing `HydraulicResult.converged` + new
   `looped_system=True` manifest flag.
4. Fall back to tree solver if Hardy-Cross doesn't converge in 50
   iterations.

**Prior art:**
- `pipesim` Python library (MIT) — full fluid-network simulator,
  overkill but reference implementation
- SWMM (Storm Water Management Model) — mixed free/commercial, has
  Python bindings (`pyswmm`)

**Effort:** 8 hrs + 4 hrs tests (converge on NFPA Appendix A Ex.
worked problem within 5%).

---

### B2 — Remote-area selection by friction, not tree-hops

**Problem.** `_select_remote_area_heads` picks by `single_source_
shortest_path_length` (edge count). NFPA requires selection by the
most friction-loss-heavy subset covering the design area.

**Fix:**

1. Compute friction loss per head path using current sizes.
2. Rank heads by total path loss descending.
3. Select top-N heads covering design_area_sqft.
4. Handle ties + plateau cases.

**Effort:** 3 hrs + 2 hrs test against NFPA Appendix A example.

---

### B3 — Pump + tank integration

**Problem.** `pump_curve.py` + `fittings_tanks.py` exist but aren't
called from `calc_system`.

**Fix:** extend `calc_system` to accept optional `pump: PumpCurve` and
`tank: GravityTank`. Iterate: given demand-flow Q, compute pressure
from pump P(Q) + tank static head, subtract system losses, verify
residual ≥ 5 psi minimum.

**Effort:** 4 hrs.

---

### B4 — IFC verified in Revit/Navisworks

**Problem.** We ship IFC4 with swept-solid pipe geometry but have
never opened the file in Revit or Navisworks. Don't know if it clashes
correctly.

**Options:**

| Tool | Cost | Purpose |
|---|---|---|
| **Revit trial** | Free 30 days | Open IFC → verify pipe placement against an architect's RVT |
| **Navisworks Freedom** | Free | Read-only viewer, supports IFC |
| **BlenderBIM** | Open | Python IFC viewer; same IfcOpenShell we use, so reveals our own bugs |
| **FreeCAD Arch workbench** | Open | Full IFC read + inspection |

**Action:** manual inspection in BlenderBIM (`Ctrl+I` on a test
IFC). If pipes land correctly at expected coordinates + have
PredefinedType SPRINKLER, we're good. If not, fix
`_local_placement` matrix math.

**Effort:** 4 hrs inspection + bug fixes if any.

---

### B5 — DXF title block + dimensions

**Problem.** Current DXF export has layers + linework but no title
block, no dimension lines, no scale bar, no North arrow, no sheet
number.

**Fix via `ezdxf`:**

1. `ezdxf.add_layout("FP-1 Level 1")` instead of modelspace.
2. Insert a `TITLEBLOCK` block definition (standard sheet sizes
   B/C/D/E).
3. For each pipe + head, add ALIGNED dimensions per AutoSprink
   convention.
4. Add scale bar as a polyline group.

**Prior art:**
- AutoCAD's `ACAD_TITLEBLOCK` format, open spec
- `pyautocad` (MIT) has title-block templates

**Effort:** 8 hrs + 2 hrs tests.

---

### B6 — PE review UI

**Problem.** PeSignature workflow + hash binding + watermark gate all
exist server-side. There's no browser UI where a PE logs in, reviews
the design, and clicks Approve/Reject.

**Implementation:**

1. New Next.js route `/pe/review/[project]`
2. Shows: hazard classification table, rulecheck violations, hydraulic
   calc report, 3D viewer with color-coded pipe sizes
3. Sign-in via PE license # + last-name match against NCEES API
4. Approve → `POST /projects/{id}/pe/sign` with decision + notes
5. Watermark removal verified client-side by re-fetching design.json

**Effort:** 12 hrs UI + 4 hrs NCEES integration + 4 hrs tests.

---

### B7 — Native DWG read

**Problem.** DWG is the native AutoCAD format. Pure Python can't
read it (binary format, no open spec). Currently we say "convert to
DXF first."

**Options:**

| Option | Cost | Status |
|---|---|---|
| **Teigha / ODA File Converter** | Free for conversion | Headless CLI, we invoke via subprocess |
| **LibreDWG** (GNU) | Open | Incomplete — many real DWG files fail |
| **ODA SDK via Python binding** | Commercial | Out of scope |
| **Autodesk Design Review** (Free viewer) | Windows-only | Not programmatic |

**Recommended path:** ODA File Converter → DXF, then our DXF pipeline
handles the rest. Zero code for us; one system dependency documented
in the SETUP.md.

**Effort:** 2 hrs wiring.

---

### C1–C2 — Real AutoSprink-class UX

**Problem.** Still using Pascal editor shell + HaloFire tabs. No
ribbon, no command line, no layer palette, no properties panel.

**This is a full redesign.** Not a pass. Estimate **3–4 weeks of
focused UI work** including:

1. Wireframe + Figma mockups — 20 hrs
2. Ribbon component with tabs/groups/tools — 24 hrs
3. Command-line docked at bottom — 12 hrs
4. Layer palette + properties panel — 16 hrs
5. Replace Pascal tabs with proper panel system — 40 hrs
6. Styling pass + icon set — 20 hrs
7. User testing with Wade — 8 hrs
8. Iterate — 20 hrs

**Total:** ~160 hrs = 4 weeks full-time. Milestone-gated against
user test feedback from Wade.

**Prior art:**
- AutoSprink screenshots (manual inspection, not copyright)
- HydraCAD help docs (design conventions)
- Revit MEP interface
- FreeCAD BIM workbench — actually great open reference

---

### C3 — Playwright E2E

**Problem.** Zero browser tests. Frontend regressions caught only by
manual testing.

**Implementation:**

1. `npm i -D @playwright/test`
2. `apps/editor/tests/e2e/smoke.spec.ts`:
   - Studio loads at `http://localhost:3002`
   - Health banner is green
   - 20 catalog items visible in scene
   - Auto-Design button dispatches without error
   - Bid viewer at `/bid/1881-cooperative` renders 3D

**Effort:** 16 hrs (setup + 5 spec files).

---

### C4–C5 — Production auth + multi-tenant

**Problem.** Auth stack exists per Phase E but untested end-to-end.
Multi-tenant: one gateway per customer, no per-org scoping.

**Path:** use Auth0 or WorkOS for user identity + org scoping. JWT
infrastructure in `auth.py` already accepts those tokens (just
`verify_jwt` with their JWKS). Per-project permissions already
scoped on `roles_by_project[project_id]`.

**Effort:** 20 hrs Auth0 integration + 12 hrs per-org data
segregation + 8 hrs tests.

---

### C6–C7 — Monitoring + on-call

**Problem.** No SLO, no error budget, no runbook.

**Path:**
- OpenTelemetry Python SDK (Apache) for tracing
- Prometheus metrics via `prometheus-fastapi-instrumentator`
- Grafana for dashboards
- SLO: pipeline completes in <30 min on real PDFs with ≥ 95%
  success rate
- Runbook markdown in `docs/runbooks/`

**Effort:** 16 hrs instrumentation + 8 hrs dashboards + 8 hrs
runbook drafting.

---

## Sequencing (priority-ordered)

Each row is a single focused push with clear success criteria.

```
Week 1 : A1 CubiCasa5k L3  +  A2 page→level grouping
Week 2 : A6 placer fix  +  A5 GLB openings  +  A3 building math
Week 3 : B1 looped solver  +  B2 remote-area  +  B3 pump/tank
Week 4 : B4 BlenderBIM IFC verify  +  B5 DXF title block
Week 5 : A7 pricing (if Wade data arrives)  +  C3 Playwright
Week 6 : B7 DWG via ODA  +  B6 PE review UI start
Weeks 7–10 : C1–C2 UX redesign (4 weeks focused)
Week 11 : C4–C5 Auth0 + multi-tenant
Week 12 : C6–C7 Telemetry + runbook + GA
```

**Total focused engineering:** ~12 weeks. That's the honest number.

---

## Per-gap test evidence templates

Every gap above ships with:

1. **Unit test** proving the new behavior
2. **Property test** where numeric invariants apply (placer, router,
   hydraulic)
3. **Golden fixture regression** for output-shape stability
4. **E2E test** that exercises the gap's contract via REST
5. **BUILD_LOG entry** + brain writeback + CODEX_REVIEW amendment

No phase is "done" without all five per AGENTIC_RULES §8.

---

## Dependencies between gaps

```
A1 (L3 CubiCasa5k)  ──┐
                      ├──► real design output against 1881
A2 (page→level)       ┘

A5 (GLB openings) → A6 (placer fix) → A3 is cosmetic only

B1 (looped) needs B2 (remote-area) for the complete calc

B6 (PE review UI) needs: (B4 verified IFC + B5 DXF titleblock +
                          C1–C2 real UX shell) — otherwise reviewer
                          doesn't have a credible workspace

C1–C2 UX redesign is parallel-runnable with B* work
```

---

## What I will NOT do without explicit approval

- Spend another session writing feature code before the user reviews
  this plan. The previous sessions shipped infrastructure fast but
  output quality is poor. Time to pause and prioritize.
- Claim CubiCasa5k weights are "easy to integrate" until I've
  actually downloaded + run inference on the 1881 arch first page
  and produced a segmentation map.
- Ship another "it works" commit without screenshots of the viewport
  demonstrating correctness.

---

## Ask for direction

Before the next code session, please rank what matters most:

1. **Accuracy on real PDFs** (Tier A1/A2 path) — so Auto-Design
   produces buildable output
2. **Production credibility** (Tier B path) — IFC + DXF + PE
   workflow
3. **AutoSprink-class UX** (Tier C1–C2) — 4 weeks of focused UI
4. **Pricing calibration** (A7) — requires Wade to share 5+ XLSX
   proposals

I will execute in that order unless told otherwise. Every commit
will ship with screenshot evidence of viewport correctness, not just
`pytest green`.

---

## Related plans

- `2026-04-18-real-ai-gen-design.md` — original 13-agent roster
- `2026-04-18-ux-research.md` — AutoSprink / HydraCAD competitive
  research (referenced for C1–C2)
- `2026-04-19-internal-alpha-remediation.md` — prior Phase A–H
  execution
- `2026-04-19-rulebook-compliance-refactor.md` — R1–R3 structure
- `2026-04-19-open-source-path.md` — open-source swaps per gap

This plan supersedes the "everything in parallel" approach of
prior plans. Priority-ordered, per-gap research + effort + test
criteria. Executable sequentially.

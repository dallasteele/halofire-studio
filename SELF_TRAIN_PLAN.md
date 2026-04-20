# Self-train plan — from scaffolding to a real HaloFire CAD Studio

The companion to `HONEST_STATUS.md`. That file admits what's broken;
this one spells out how I get from here to a tool a PE would sign.

## The meta-principle

**Every phase exits only when a test that would have failed before
now passes, AND that test compares output to a human-drafted
ground truth — not to an absolute threshold pulled from the air.**

No more "≥ 10 rooms" floors. Thresholds must be IoU, ratio, or
pixel-diff against a known-good reference bid.

## Ground truth source

Halo has ~150 historical bids: each one has the architect's PDF/
DWG, Halo's final as-built sheet set, the AHJ-approved hydraulic
calc, the final BOM, and the signed-off proposal dollar figure.
That's the training + validation data. I don't need to build
synthetic test cases — the reality is already on Halo's disks.

## The 8-phase loop

### Phase 1 — Load Halo's history into a reference DB  (week 1)

**Goal:** every test can query `truth_for(project_id, dimension)`
and get what the human designer actually shipped.

**Schema** (`services/halofire-cad/truth/schema.sql`, new):
```sql
CREATE TABLE bids_truth (
  project_id          TEXT PRIMARY KEY,
  architect_pdf_path  TEXT,
  as_built_pdf_path   TEXT,
  permit_reviewed     BOOLEAN,
  total_bid_usd       NUMERIC,
  head_count          INTEGER,
  pipe_count          INTEGER,
  pipe_total_ft       NUMERIC,
  system_count        INTEGER,
  hydraulic_gpm       NUMERIC,
  hydraulic_psi       NUMERIC,
  signed_off_at       DATE
);
CREATE TABLE bids_level_truth (
  project_id          TEXT,
  level_index         INTEGER,
  level_name          TEXT,
  elevation_m         NUMERIC,
  outline_polygon_wkt TEXT,  -- WKT so shapely can consume
  room_count          INTEGER,
  head_count          INTEGER,
  PRIMARY KEY (project_id, level_index)
);
CREATE TABLE bids_corrections (
  correction_id       TEXT PRIMARY KEY,
  project_id          TEXT,
  reviewer            TEXT,    -- 'wade', 'ahj', 'pe_X'
  symptom             TEXT,    -- 'head missing in Room 12.3'
  fix                 TEXT,
  test_id             TEXT     -- links to a regression test
);
```

**Loader** (`services/halofire-cad/truth/ingest.py`, new):
- walks a Halo archive directory
- extracts per-bid numbers from permit-reviewed PDF pages
- parses BOMs from submittal sheets
- computes level outlines from as-built DWG when available
- writes to `truth.duckdb` (same pattern as `supplies.duckdb`)

**Exit criterion:**
- At least 3 bids loaded (including 1881 Cooperative).
- `truth_for('1881-cooperative', 'head_count')` returns a concrete
  integer that matches Halo's submitted bid.
- Unit test: `bids_truth` CRUD works.

### Phase 2 — Cruel ratio tests that fail until output is good  (week 1-2)

Replace the trivial thresholds in `test_intake_real_plan.py` with
bids_truth comparisons:

| current (trivial) | replacement (cruel) |
|---|---|
| `head_count ≥ 50` | `abs(head_count - truth) / truth ≤ 0.15` |
| `rooms ≥ 10` | `abs(rooms - truth) / truth ≤ 0.25` |
| `≥ 1 level poly with 4 verts` | `IoU(level_outline, truth_outline) ≥ 0.6` per level |
| `≥ 20 pipes` | `abs(pipe_total_ft - truth) / truth ≤ 0.20` |
| (nothing) | `abs(hydraulic_gpm - truth) / truth ≤ 0.10` |
| (nothing) | `abs(total_bid_usd - truth) / truth ≤ 0.15` |

**Exit criterion:**
- 6 cruel tests, ALL failing against current pipeline output (red
  bar in CI) — on purpose, so future fixes have a ratchet.
- Each failure prints the actual vs truth delta so the engineer
  sees exactly how far off we are.

### Phase 3 — Visual regression against Halo's real sheets  (week 2)

**Artifact:** `tests/golden/fixtures/1881-cooperative/FP-N-01.png` —
a reference render of Halo's actual as-built FP-N level 1 sheet
(cropped + greyscale).

**Test:**
- our pipeline emits `submittal.pdf` → extract page for level 1 →
  greyscale + crop to plan area
- pixel-diff with the reference at 30% tolerance to start
- fail with a diff image saved to `tests/golden/diffs/`

**Exit criterion:**
- Reference images for 3 sheet types (FP-0 cover, FP-N level 1
  plan, FP-H hydraulic placard) loaded.
- Visual-diff test runs and **fails** (expected) against current
  output.

### Phase 4 — Intake depth  (weeks 2-4)

Root cause of most downstream pain: intake produces shallow
geometry.

Sub-phases:

**4a. Real outer-boundary tracing.** Stop using bbox. Use
`shapely.ops.unary_union` on wall linestrings, then extract the
largest connected polygon's exterior ring via `.buffer(0.1).
simplify(0.5)`. Handles concave building outlines (L-shapes,
U-shapes, courtyards). Test exit: `IoU(outline, truth_outline) ≥
0.6` on 1881.

**4b. Title-block OCR for level names + elevations.** Today's code
reads a title block in pdfplumber text mode but `elevation_m = i *
3.0` is the synthetic fallback. Swap in: OCR the standard AIA
title block template (right edge of sheet), parse "LEVEL 02 —
ELEV. 12'-6"" into `name="Level 02", elevation_m=3.81`. Test exit:
level names + elevations within ± 0.2 m of truth on 1881.

**4c. CubiCasa fine-tune on Halo's historical arch pages.** Take
the as-built pages from Phase 1, use the matching architect page
as input, use Halo's hand-drafted sprinkler sheet as the supervised
target. Transfer-learn the pre-trained CubiCasa5k weights on this
Halo-specific pair set. Save the fine-tuned weights to
`vendor/CubiCasa5k/halofire-finetuned/`. Test exit: room-count
ratio ≤ 0.25 delta on 1881.

### Phase 5 — Placer quality  (weeks 4-6)

**5a. NFPA 13 §8.6 coverage tables** replace grid scatter. For
each room + hazard class: max spacing between heads, max area
per head, distance from walls. Use a real covering algorithm (not
`spacing * grid`).

**5b. Structural grid snap.** Columns matter. Real designers align
heads to avoid joists. Post-process: for every head within 0.5 m
of a detected column, shift it off-axis by 0.15 m.

**5c. Arm-over use.** When a head would land under an obstruction,
insert an arm-over pipe + reducer BEFORE the head. The current
`arm_over.py` only shifts the head; we need it to emit the
required arm-over segment.

Exit criterion: head-count ratio delta ≤ 0.15, head-density per
room matches NFPA coverage within ± 10%.

### Phase 6 — Router quality (real topology)  (weeks 6-8)

The placer produces heads. The router should produce:
- **Riser** (1 per zone, vertical, connects to supply)
- **Main** (large horizontal, connects riser to each cross main)
- **Cross mains** (medium horizontal, feeds branch lines)
- **Branch lines** (small horizontal, feeds heads via arm-overs)

Not a single-tree Steiner. A real router needs topology rules:
- Branch size ≤ cross main size ≤ main size
- Max N heads per branch (from NFPA tables)
- Pressure-balanced tree, not length-minimized

Exit: pipe-size distribution matches Halo's historical ratios,
pipe_total_ft within ± 20%.

### Phase 7 — Studio interactive  (ongoing, start week 2)

Every week, at least one editing primitive lands:

- **Select** — click a head/pipe in the 3D scene, see its details
  in a property inspector.
- **Move** — drag a head, snap to grid / wall / pipe midpoint.
- **Resize** — click a pipe segment, change its size_in via the
  inspector, LiveCalc refreshes.
- **Delete** — Del key removes the selected node.
- **Undo/redo** — Ctrl-Z / Ctrl-Y via scene-store history.
- **Connect** — draw a new branch line between two heads.
- **Isolate** — double-click a system, dim the rest.

Each interaction has its own test: "select a head, inspector shows
its K-factor; drag it 1 m, delta_flow > 0".

### Phase 8 — PE review loop  (continuous)

Every week, send the latest regenerated 1881 bid to Wade (Halo's
PE) for a red-line pass. Every correction becomes a new
`bids_corrections` row AND a new failing regression test. Track:

- correction_count_per_bid (lagging quality metric)
- delta vs truth on head/pipe/hydraulic/cost (leading metric)

**Exit for "Internal Beta":** 3 consecutive 1881 re-runs where
correction_count ≤ 10 and all cruel tests pass.

**Exit for "Production":** one real new bid where Wade signs it
without a single code-level correction. (Stylistic red-lines ok.)

## How this plan steers the day-to-day

1. Pick the most failing cruel test.
2. Build/fix the minimum code needed to push its ratio closer.
3. Land the fix with evidence: "delta was 0.45, now 0.22."
4. Repeat.

No more shipping "infrastructure" commits that don't move a ratio.
Every commit message must reference a cruel test and report its
delta before/after.

## What I commit to stop doing

- Declaring victory on trivial thresholds
- Shipping hand-synthesized demo data as proof
- Using "all tests green" as a success metric when the tests are
  too lax to hurt
- Adding features to the chrome (Ribbon, palette, etc.) before the
  engine behind them works
- Claiming "AutoSprink parity" when we have the menus but not the
  design output

## What I commit to start doing

- Reading Halo's historical bids as primary source of truth
- Failing loudly when our output deviates by > X% from a real bid
- Reporting delta in every PR description
- Pushing Wade/Codex to red-line our output and turning every
  red-line into a new failing regression test
- Calling my work "Alpha" until the cruel tests pass, "Beta" only
  after PE review, "Production" only after one clean new bid

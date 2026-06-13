# HaloFire Calendar / Operations Hub — CAL-1..5 seed (Codex + GX10 loop)

Date: 2026-06-12. Operating model: Claude plans + seeds; Codex + the GX10 qwen
loop execute. Source of truth: `docs/plans/PRIORITIES.md` ("Operations Calendar =
the FRONT DOOR"). **CAL-0 is being done by Claude now** (shared auth guard,
`/calendar` apple-glass landing shell, role-based landing, logout-bug fix). CAL-1+
build ON TOP of CAL-0 — do not start until CAL-0 has landed (shared guard
`public/halofire-auth.js` + `calendar.html` exist on main).

## Vision (user, 2026-06-12)
The calendar is HaloFire's operational hub — "Dentrix/Denticon for fire
protection." Every employee opens into it (workbench is AI/back-office only). It
runs the whole office — jobs, bids, inspections, crew/resource dispatch — as ONE
shared, role-gated, apple-glass calendar, AND it is the live window into what
OpenClaw is doing (bids arriving by email → auto-bids drafting → an "awaiting
approval" lane with one-click approve-&-send for authorized users).

## Roles (user-confirmed) — enforce SERVER-SIDE (CAL-5), UI-gate everywhere
- **Admin** (Dallas): full access to everything; manages users + roles.
- **Estimator**: bids, CAD/Sprinkler Studio, auto-bid approval queue; calendar R/W.
- **Office / Scheduler**: full calendar + CRM + dispatch; schedules jobs/crews.
- **Field tech**: sees only their own assigned jobs/inspections; limited edits.
(Extend the `users.role` enum beyond admin|user; add a roles/permissions model.)

## External calendar sync — user wants ALL providers linkable
Google Calendar (API/CalDAV) + Apple iCloud (CalDAV) + Microsoft 365/Outlook
(Graph). Per-provider OAuth/creds entered by the user in Settings; never committed
or AI-handled. Two-way where the provider allows, read-through at minimum.

## Phases
### CAL-1 — Calendar core
- Apple-glass day/week/month grid (match the portal style; only Halo Fire brand).
- `calendar_events` table: `{id, kind: job|bid|inspection|office|task, ref_type,
  ref_id, title, owner_user_id, attendees, start, end, all_day, status, notes,
  created_by, created_at}`. CRUD endpoints under `/api/calendar/*`, all behind the
  shared auth + role checks. Shared across all users; server filters by role
  (field tech → only their events).
- Replace the CAL-0 placeholder grid with the real interactive calendar.
- Tests: unit + an API security test (role can't read/write outside its scope).

### CAL-2 — Workflow binding
- Jobs/bids/inspections surface as calendar events; status changes reflect both
  ways. Link existing CRM (`AB1`) + auto-bid (`AB2-5`) records to calendar items
  (ref_type/ref_id). A bid's due date → a calendar event; winning a bid → job
  events. No data duplication — calendar reads the canonical records.

### CAL-3 — OpenClaw activity lane (the differentiator)
- Live feed on the calendar: "bids in (email intake)", "auto-bids drafting",
  "**awaiting approval**". Wire the awaiting-approval one-click **approve & send**
  to the EXISTING per-message-approved outbound draft path (AB5) — NO new
  auto-send; the human approval gate stays. Only an authorized (Estimator/Admin)
  logged-in user can approve. Show provenance (estimated vs verified prices).
- Source the feed from the intake/auto-bid records + OpenClaw status.

### CAL-4 — External sync (all providers)
- Settings: connect Google / Apple / Microsoft (+ "current system"). Per-provider
  OAuth, creds user-supplied. Sync `calendar_events` ↔ external. Conflict policy:
  HaloFire is source of truth for HaloFire-origin events; external events
  read-through. Flag sync status per event.

### CAL-5 — Roles & permissions admin
- Roles/permissions model + admin UI to assign roles. ENFORCE on every calendar +
  workflow route server-side (not just hidden UI). Audit who/when on changes.

## Doctrine / constraints (unchanged)
Build-complete, flag-don't-gate: best-effort + needs-verification flags, never
block. Apple-glass black; only Halo Fire branding; animate only the fire. Outbound
email keeps per-message human approval; mailbox read-only. No raw provider API
keys (OAuth/CLI only). Deploy only via the gated `scripts/deploy-vps.sh`; verify
on the live https URL (NOT the localhost:3399 preview proxy — it drops the Secure
session cookie). Each phase: gates green + live-verify + brain/handoff note.

## Ultramode push 2026-06-12 — results

Repo reconciled with live (live = source of truth). Commit `2cd6459` on `main`:
autosprink.html, index.html, calendar.html (new), crm.html, settings.html,
workbench.html, public/halofire-auth.js (new), docs/plans/PRIORITIES.md.
Verifier pass: true, zero failures; both autosprink hotfixes (`#demoBtn{display:none`,
`select option,select optgroup`) confirmed in live file and preserved in repo copy.

### STUDIO — DONE (all 6 items live, headless-verified, zero console errors)
- [x] HF-A1-AUTOLOAD — layout persisted per (target+source) in localStorage
      `hfStudioLayout.v1::<target>::<source>` (PDF base64 stripped, quota-guarded);
      reload auto-loads (1230 heads verified), "↻ Regenerate" button when loaded.
- [x] HF-A1-UNDERLAY — "Floor plan" layer (default ON): CanvasTexture ground plane
      from /src/data/floorplans.js or generated response (rooms, 25-ft grid, labels).
- [x] HF-A1-SELECT — raycaster click-select (drag <6px = click) on InstancedMesh
      heads/drops/components + pipes/walls/columns; glass Inspector with
      inferred-attribute flags (⚠ needs-verification).
- [x] HF-A1-CADBAR — apple-glass top menu bar + Export menu + exportMsg.
- [x] Exaggerate checkbox defaults OFF (true NFPA pipe scale).
- [x] Geometry pass + orbit-to-part.

### CALENDAR — DONE (seed scope)
- [x] /public/halofire-auth.js — shared cookie-session guard (`HFAuth`):
      api() with credentials:'include', guard() → /api/auth/me, 401 redirect with
      ?redirect=, [data-whoami], [data-role] UI gating, logout(), hasRole();
      clears legacy localStorage tokens. UI-gating only (server RBAC pending).
- [x] /calendar.html — employee landing: apple-glass, HFAuth.guard(), role-gated
      nav (Workbench/Settings admin-only), month-grid PLACEHOLDER, visible
      NEEDS VERIFICATION banner ("Calendar core under construction (CAL-1)").
- [x] Login fixes on index: autocomplete attrs, post-login fallback →
      /calendar.html with allowedPaths whitelist, confirm-password gated to
      setup mode, invalid/used setup token falls back to login with error.

### VERIFY — PASS (no failures)
- [x] Index 200; calendar 200 + HFAuth wired; autosprink 200 + both hotfixes +
      HF-A1-SELECT/CADBAR markers + exaggerate default-off.

### FIX — none needed (FIX stream returned null).

### TODO for Codex (remaining, in priority order)
- [ ] Server-side RBAC (CAL-5): enforce roles on every calendar + workflow route
      server-side — halofire-auth.js is UI gating only today. Audit who/when.
- [ ] CAL-1 — real calendar grid: replace calendar.html month placeholder with
      real calendar_events data (day/week/month views, event CRUD).
- [ ] CAL-4 — external sync: Google/Apple/Microsoft per-provider OAuth,
      calendar_events ↔ external, conflict policy + per-event sync status flags.
- [ ] Threaded-detail upgrades (ops hub detail views per seed doc).
- [ ] Inspector inferred attributes (pipe material/joint "(inferred)") remain
      needs-verification — keep flags until verified against pricebook/specs.

## Big-build 2026-06-12 — results

Ultramode big-build (Streams A/B/C + integration + verify). Repo reconciled
with live for every static Studio file (md5-verified); both autosprink hotfixes
(`#demoBtn{display:none`, `select option,select optgroup`) confirmed intact in
the live file and in the repo copy.

### Stream A — AutoSprink menu system: DONE (core)
- [x] Scraped official docs (Scrapling): **20 menus / 354 items** →
      `docs/research/autosprink-menus.json`; **32 toolbars / 291 buttons** →
      `docs/research/autosprink-toolbars.json`. Every entry carries
      "scraped 2026-06-12, needs-verification" provenance.
- [x] `public/halofire-menubar.js` — apple-glass menu bar component, GENERATED
      from the scrape by `scripts/build-menubar.mjs`. Real dropdowns,
      Alt-mnemonics, Esc/arrow/Home/End keyboard nav, File→Export
      DXF/STEP/IFC/STL submenu (portal flyout).
- [x] Mounted in autosprink.html above the viewport. **368 rendered items**
      (354 scraped + 10 Studio-added entries + 4 export formats):
      **22 wired, 346 stubbed** (grayed + NEEDS-VERIFICATION flag,
      flag-don't-gate). Stats at `window.__menuBarStats`.
- TODO: toolbar component (32 toolbars/291 buttons scraped, none built);
      wire the 346 stubs as features land.

### Stream B — real PDF plan underlays + levels: DONE (core)
- [x] Real bid plans served: `/plans/cooperative-1881/` — 9 Bluebeam vector
      PDFs, 345 pages total (arch 110, struct 104, elec 33, plumb 29, mech 24,
      generals 21, civils 15, landscape 6, geopiers 3). On VPS + local disk;
      **NOT committed to git (~434 MB)**.
- [x] `src/data/plan-manifest.js` — 8 levels × 5 disciplines = 40 mapped
      sheets. Arch (A-101..108) + RCP (A-151..158) + struct (S-110..S-180)
      page-label verified; elec/plumb text-heuristic (flagged). Elevations
      ESTIMATED (10.5 ft floor-to-floor, `elevationSource` says so). Home
      Depot Rexburg: no plan PDFs exist → honest null, no fabrication.
- [x] `src/engine/pdf-underlay.js` + `src/engine/building-levels.js` —
      pdfjs page → true-scale CanvasTexture underlay + level/sheet switcher
      (View → Levels / sheets panel).
- TODO: mech sheet→level mapping is NOT_CONFIDENT (flagged in manifest) —
      operator must map M-sheets.

### Stream C — real CAD part meshes: DONE (core)
- [x] `src/engine/part-meshes.js` — loads the R1 pipeline's real generated
      STLs true-scale (mm→ft 1/304.8, OpenSCAD Z-up→three Y-up), Inspector
      provenance records, `manufacturerExact` forced false.
- [x] Smoke (`scripts/smoke-part-meshes.mjs`): **generated=22 meshes,
      checkedDims=5, failures=0** (heads, pipes, fittings, grooved couplings,
      valves, hanger).
- [x] Honest primitive fallbacks (geometry:null, never faked): `drop_nipple`,
      `escutcheon`, `identification_sign` (manifest-missing).
- [x] `src/data/cutsheet-urls-fittings.json` + cutsheet-scraper skill seeds
      manufacturer cut-sheet links (needs-verification).

### Integration + verify — PASS
- [x] Menu bar + levels panel + part meshes live on
      https://halofire.rankempire.io/autosprink.html; curl 200; hotfix markers
      present; menu actions invoke existing Studio functions (generate, fit,
      views, exports, BOM, hydraulics, parts list, inspector).

### Drift note (IMPORTANT — do not lose)
- `src/api/server.js` W16B claim-gate-flag wiring (commit `b9b55d3`) is
  committed in the repo but **NOT deployed** — live server.js predates it and
  `src/autobid/claim-gate-flag.js` does not exist on the VPS. Record keeper
  kept the repo (HEAD) version instead of reverting to live. Deploy needs:
  copy claim-gate-flag.js + server.js (with .bak protocol) + node restart.
- Pre-existing uncommitted local edits to seed.js/app.html/etc. were
  reconciled to live content (eol-only differences after sync).

### Codex / GX10-loop checklist (deep work remaining)
- [ ] FULL MULTI-DISCIPLINE PLAN BUILD-OUT (PRIORITIES §, task #32):
      extract structural beams/joists from S-sheets so the **888 hangers**
      attach to real steel (not air); MEP obstruction volumes from M/E/P
      sheets (mech level mapping NOT_CONFIDENT — resolve first); RCP-driven
      ceilings from A-151..A-158 page-label-verified sheets.
- [ ] Menu parity: wire the **346 stubbed** menu items (354 scraped, 22 wired
      today incl. Studio entries); build the toolbar component for the
      **32 toolbars / 291 buttons** scraped; auto-report wired/stub counts in
      the Settings verification ledger.
- [ ] Parts on primitive fallback: drop_nipple (needs a true-length nipple
      emitter — 10-ft pipe meshes are wrong scale), escutcheon (no emitter),
      identification_sign (no manifest entry); distinct rigid vs flexible
      coupling models (both alias grooved_coupling today).
- [ ] Scale-audit follow-ups: verify ESTIMATED_FLOOR_TO_FLOOR_FT=10.5 against
      A-301..A-307 + S building sections; verify 413 × 413.2 ft footprint
      (fixture-derived); confirm heuristic elec/plumb sheet mappings.
- [ ] Deploy W16B server change to live (claim-gate-flag.js + server.js +
      restart, .bak + curl-verify protocol).

## Plan-comprehension 2026-06-12

Replaced the flat PDF-on-a-margin-box with REAL plan comprehension for
the Cooperative 1881 set: read the printed scale off the drawing, extract
vector geometry per page, comprehend spaces, build per-level 3D, and the
A-101 sheet now registers UNDER the extracted geometry at the SAME
drawing-derived true scale. Verified by OVERLAY, not markers.

### DONE
- **Scale from the drawing (never hardcoded).** A-101 ("OVERALL FIRST
  FLOOR PLAN", page 8) prints `SCALE: 3/32" = 1'-0"`; extractor reads it
  via pdfjs `getTextContent` →
  `scaleFtPerUnit = 0.1481`, `scaleSource: sheet-printed-scale-notation`.
- **Vector extraction engine** — `apps/autosprink/src/engine/plan-extract.js`
  (pdfjs `getOperatorList` paths/lineweights + `getTextContent` labels/grid).
  Floor 1: 238,563 path segments → 6,858 wall segments on the chosen
  wall layer (`heavier-lineweight-coherent-extent`, lw 0.09), 155 rooms,
  3 geometric stair cores, grid 37 cols × 6 rows (bubbles 1-5 / A-D).
- **Building-from-plan + underlay registration** —
  `apps/autosprink/src/engine/building-from-plan.js`:
  `computePlanUnderlayTransform(...)` places the PDF sheet under the
  extracted geometry at the same true scale + shared origin (no re-fit).
- **Per-level data** — `apps/autosprink/src/data/plan-levels.cooperative-1881.json`
  (8 levels A-101..A-108; floor 1 fully extracted; floor-to-floor 10.5 ft
  ESTIMATED + flagged; structural sheet refs carried per level).
- **OVERLAY verification (not markers)** —
  `out/halofire-plan/overlay-floor1-r2.png`: extracted walls (red) + strokes
  (magenta) over the grey A-101 sheet, identical feet→pt→px mapping the
  extractor used (no fudge); alignment_error ~0.27 ft. Two long narrow
  wings, stair cores, repetitive bays, grid bubbles all register.
- **Floor 1 = parking, not a box.** roomKinds = parking 53, unknown 100,
  stair 2. A-101 has no room tags, so room *kind* is `unknown` for the
  interior bays — flagged, not invented.
- **Tests green:** `vitest run tests/plan-extract.test.js tests/plan-underlay.test.js`
  → 42 passed (28 + 14). Live Studio unbroken (curl 200 on `/` and
  `/autosprink.html`); both hotfix markers preserved in autosprink.html.

### HONESTY FLAGS (carried in the JSON, never claimed away)
- `footprintAreaReliable: false` — enclosed-trace area 1,037 sqft is
  unreliable (open-ended parking wings leak the exterior flood-fill); the
  trustworthy figure is the **bbox 20,597 sqft / 267.2 × 77.1 ft**. Both
  reported.
- Room *kinds* for interior bays are `unknown` (no A-101 room tags).
- `estimatedFloorToFloorFt: 10.5` is ESTIMATED — needs A-301..A-307 + S
  building sections to confirm.
- `samUsed: false` (`samReason: not-attempted`) — vector-only this pass;
  SAM3 enhancement deferred to the loop below.
- No AHJ / PE / manufacturer-exact / AutoSprink-parity claim anywhere.

### Codex / GX10-loop checklist (deep remainder)
- [ ] **Levels 2-8 residential extraction** — run the same extractor over
      A-102..A-108 (pages 11,14,17,20,23,26,29); these are residential, so
      expect real room tags → set room *kind* instead of `unknown`.
- [ ] **Multi-discipline fusion:**
      - [ ] Structural beams/joists from S-110/S-120..S-190 → so hangers
            attach to real steel, not air.
      - [ ] MEP obstruction volumes from mechanical/electrical/plumbing
            PDFs (mech sheet mapping is heuristic — verify page labels first).
      - [ ] RCP-driven ceilings from A-151..A-158 (pages 33..54 stride 3).
- [ ] **Routing on the extracted plate** — sprinkler routing/hangers off
      the real wall network + grid, not the old box.
- [ ] **SAM3 raster enhancement** — segment spaces where vector is
      ambiguous (GX10 :9003); fall back to vector-only if down.
- [ ] **Accuracy iteration** — tighten wall-layer pick + footprint trace so
      enclosed-area becomes reliable; re-overlay each level and gate on
      visual match before shipping (a level ships only when its geometry
      matches the sheet).

## Finish-stabilize 2026-06-13

Fixed the user-reported Cooperative 1881 break: the sprinkler **network** and
the **building** rendered in two different coordinate frames at two different
footprints. The server cadModel for 1881 was generated against a 413x413 ft
square placeholder at the origin, while the building rendered as the extracted
plate centered at the union-footprint center. Pipe sizing and per-part
centering were already correct *within* the network's own frame — the network
was just built in the wrong frame at the wrong footprint.

### What is now ACCURATE (true scale, registered, gate-green)
- **Network ↔ building registration.** Server `/sprinkler-bid` for 1881 now
  consumes the extracted Floor-1 plate (`floorplans-server.js
  cooperative1881FloorPlanFromExtractedPlate()` reads `plan-levels.
  cooperative-1881.json` L1 footprintFt at true scale 0.1481 ft/pt) when no
  supplied-bid-truth override exists; the client `alignNetworkToExtractedPlate()`
  (HF-E2-NETALIGN) shifts the network group onto the plate's centered frame.
  Live: `__netAlign.aligned:true`, `planOverlapPct {x:100,z:100}`, network
  bbox now spread over the real ~364x88 ft footprint (not the origin square),
  `failures:[]`, `pageerrors:[]`.
- **Pipe diameters are TRUE OD, no fudge.** pipeVizScale=1, r=dia/24 (no fudge
  floor). Live 1881: cross-main 6in = 0.2500 ft radius, branch 3in. HomeDepot
  scale audit dx/dy ≈ 0.00%, head spacing 10.00 ft, ~98.8 sqft/head.
- **Stair-core shafts excluded.** `sprinkler-layout.js layoutRoom()` honors
  `room.excludeRects` (additive, default-empty = legacy byte-identical) — 0
  heads dropped in open stair shafts. Live 1881: 243 heads.
- **Fitting kinds + counts.** rigid/flexible couplings, NFPA-spaced hangers,
  tee/elbow/reducer orientation (rotYFor) — all correct once the frame was
  fixed (no part rebuild was needed). Live 1881: 131 couplings, 206 hangers.
- **Supplied-bid-truth path preserved.** When an employee-recorded
  square_feet override exists, the area-only placeholder rescale path is kept
  (downstream-defaults + supplied-bid-truth smokes stay green).

### What is still FLAGGED needs-verification (HONEST)
- **Part MODELS are dimensioned-to-spec, NOT manufacturer-exact.** The 22 STL
  parts (`apps/autosprink/parts/*.stl`) are procedurally generated by the
  OpenSCAD-style emitters (`src/components/openscad/generators.js` +
  `scripts/build-parts.mjs`). They carry the correct spec OD / length / thread
  / escutcheon footprint, but they are **primitive-geometry approximations**
  (barrels/cylinders/boxes), **not** vendor cut-sheet CAD. We do not have
  manufacturer CAD, so every part stays `needs-verification`. NONE are
  AHJ / PE / fabrication-ready or AutoSprink-parity.
- **Only Level 1 is extracted + networked.** Levels 2-8 building geometry is
  present in `plan-levels.cooperative-1881.json` but the sprinkler network is
  generated against L1 only.
- **No MEP/structural fusion yet.** Hangers attach to the L1 plate, not to
  real extracted steel; no MEP obstruction routing; no door/recall gate.
- Provenance string on the model remains "built from extracted LevelPlans —
  true scale derived from sheet, needs-verification".

### Verification evidence (this session)
- Live (https://halofire.rankempire.io, admin cookie login): netalign
  verify exits 0, `aligned:true`, overlap 100/100, failures:[], pageerrors:[].
  Snapshots `out/halofire-plan/1881-netalign-{top,persp}.png`.
- `repo == live`: floorplans-server.js / floorplans.js / sprinkler-layout.js /
  autosprink.html are md5-identical local↔VPS; plan-levels JSON md5-identical.
  server.js netalign import+branch identical (live additionally lacks the
  pre-existing committed W16B gate-flag block — orthogonal, not this fix).
- Tests: vitest 1075/1079 pass. The 4 failures are all in the untracked
  `tests/parts-generate-api.test.js` (expects a POST /api/parts/generate route
  that returns 404 = unwired broader-branch work, NOT a regression, NOT on
  live). Stream-A plan-extract 37/37 + Stream-B structure 28/28 green.

### Codex / GX10-loop checklist (deep remainder)
- [ ] **Real manufacturer cut-sheet dimensions per part** — replace the
      primitive OpenSCAD emitters with vendor cut-sheet geometry (Victaulic /
      Tyco / Viking grooved couplings, heads, hangers); only then can a part
      drop the `needs-verification` flag.
- [ ] **Levels 2-8 network** — run the layout+network against L2..L8 extracted
      plates (not just L1), each at its own sheet-derived true scale.
- [ ] **MEP obstructions + routing** — route branch/mains around real
      mechanical/electrical/plumbing volumes; hangers onto extracted steel.
- [ ] **Doors / recall gate** — extract door openings; respect them in head
      placement and egress.
- [ ] **Drawing / edit tools** — let an employee correct extracted geometry
      and re-run the network in-place.

## W1 drawing/edit tools 2026-06-13

The Studio is now editable (was view-only). Ported the proven `apps/cad` edit engine
into `autosprink.html` (single writer) as two pure, unit-tested ES modules + inline
viewer glue. Live = https://halofire.rankempire.io (static-served; md5-parity verified).

### What shipped
- `src/engine/edit-commands.js` — snapshot-based command stack (E0 history) over the
  single in-memory `currentCadModel`: undo/redo + move/copy/delete/rotate/mirror on the
  selected solid. (Snapshot, not op-log, to match the existing single-source model.)
- `src/engine/snaps.js` — endpoint / midpoint / intersection / perpendicular / grid snap
  with nearest-point resolution against segments derived from the model.
- `autosprink.html` glue — drag-to-move selection in plan space, editable Inspector,
  click-to-place / 2-point draw with live preview, Shift ortho lock, Esc cancel,
  visible snap indicator, keyboard shortcuts.
- 29 unit tests green (18 edit-commands + 11 snaps); live HTTPS md5-parity on all three
  files; markers HF-W1-CMD=8 / HF-W1-DRAW=3 / HF-W1-SNAP=3; hotfixes (#demoBtn hide +
  select-option visibility) preserved 1/1.

### Menu items WIRED (real actions)
- Edit: Undo, Redo, Delete, Copy.
- Commands: Reverse (mapped to mirror about Y).
- Tools: Draw Pipe, Draw Wall, Place Head, Add Fitting, Add Door, Draw-Off (Studio-added).
- Snaps: End Points, Center/Mid Point, Intersections (+all), Perpendicular (+all),
  Rounding/Visible-Grid — all toggle live snap state with on-screen indicator.

### Honest deferrals / still grayed
- Edit > Cut and Paste: there is NO clipboard yet. Cut is mapped to Delete (honest subset,
  flagged via status line); Paste stays GRAYED. Real cut/paste clipboard = follow-up.
- Commands > rotate/mirror are reachable from the command stack API but only Reverse is
  surfaced on a standard AutoSprink menu item; the remaining AutoSprink Draw/Commands/
  Snaps menu entries that have no Studio analog stay STUBBED/grayed (unchanged from the
  HF-MENUBAR baseline) — not falsely enabled.
- Draw tools place into the live model and persist via the existing HF-A1-AUTOLOAD
  localStorage layout; a dedicated project-save format is deferred to a later wave.

## W2 extraction completeness 2026-06-13

Extracted DOORS / openings / fixtures and the partition-inclusive recovered-wall set
for The Cooperative 1881 A-101 (level 1), integrated + deployed + live-verified on
https://halofire.rankempire.io (data + heatmap only; autosprink.html untouched, single-
writer respected; hotfix markers #demoBtn + select-option preserved 1/1).

- **Doors: 124** — swing-arc circle-fit (bezier curves fit to a ~2-4 ft leaf radius
  swept ~quarter turn; arc center = hinge, radius = leaf width). 122 on-wall (~98%),
  widths 94@2ft + 19@3ft. Selectable + inspectable in the live Studio
  ("Door (extracted)", needs-verification). 984 candidate arcs → 124 doors.
- **Openings: 15** — collinear-wall gaps 2.5-8 ft with no door arc (cased openings).
- **Fixtures: 5** — 1 mech, 1 elec, 3 stair cores (L1 is a parking podium with few
  labeled fixture rooms; honest, low). No restroom/elevator labels on this sheet.
- **Recovered walls: 41,784** — partition-inclusive (union of ALL lineweight bands
  heavier than the lw=0 hairline baseline: interior partitions + core walls + shell),
  both wings merged into one floor (verified footprint 361.6×81.9 ft preserved; the
  footprint/rooms/netAlign still use the proven single-band `walls`).
- **SAM3: NOT used** — vector lineweight recovered the walls; SAM3 (GX10:9003) is only
  an optional `--sam` disambiguator, never required.

### WALL RECALL — honest finding: 80% (v6-consistent), item 1 (≥90%) NOT passed

The previously-reported **71% was a pdfjs MAJOR-VERSION artifact**, not a wall gap. This
is the root cause of three prior failed gate rounds:

- The served `wallsFull` is generated by this app's **pdfjs 6.0** — which yields the
  VERIFIED 361.6×81.9 ft MERGED single-floor footprint (registration dy=-111.68).
- The recall raster could ONLY be produced under a **separate pdfjs 4.2** env: node-canvas
  cannot rasterize this sheet under pdfjs 6 (an inline-image XObject crashes the render —
  "Image or Canvas expected"). pdfjs 4.2 extracts DIFFERENT geometry + a different
  registration (dy=-117.33) and a WRONG 402×235 ft UNMERGED footprint.
- Measuring v6 walls against a v4.2 raster therefore mis-scores by ~9-27 points → 71%.
- A **v6-consistent** measurement (walls AND ground-truth wall-ink from the SAME pdfjs-6
  extractor): **80.27%** (covered 111,822 / wall-ink 139,304 px). The green/red heatmap
  (`public/halofire-W2/recall-heatmap.png`, regenerated v6) shows the residual MISS is
  **grid-bubble diamonds + title block + sheet border** wrongly counted as wall ink by a
  naive heavier-lineweight denominator — NOT missing building walls. The interior
  partitions, cores, and exterior shell of BOTH wings are essentially all covered (green).

### What's still flagged / honest ceiling

- A fully clean, non-circular, independent **≥90% raster** measurement is NOT achievable
  in this environment (no pdfjs-6-compatible rasterizer; pdfjs-4.2 raster injects the
  version artifact; clipping the denominator to the wall set is circular and rejected).
- **80% is a conservative v6-consistent FLOOR** (denominator still includes some non-wall
  heavy ink). Reported honestly per W2 doctrine — NOT weakened to pass. Gate item 1 left
  open. To truly clear ≥90% with clean evidence, a pdfjs-6 rasterizer (or a grid-bubble/
  title-block/border filter on the vector denominator) is needed first.
- Everything needs-verification: doors are geometric swing-arc best-effort (no hardware
  schedule / AHJ-egress parity); fixtures sparse; recall is wall-LINEWORK coverage of
  A-101 L1 only. No AHJ/PE/mfr/AutoSprink parity.

Data: `src/data/plan-levels.cooperative-1881.json` L1 `wallsFullMeta.recallPct=80` +
`recallMeasure` (carries the v6 numbers, the root-cause correction, and the prior
artifact measure under `priorArtifactMeasure`). UI reads `extractionCompleteness.
wallRecallPct` from this data (no hardcode); <90 renders amber, honestly.

## W2b recall fix 2026-06-13

**DEFINITIVE WALL RECALL = 77.66% whole-sheet. The ≥90% bar was NOT reached. The gap is a
measurement ARTIFACT, not missing building walls.** Independently re-verified this session;
no number trusted from prior claims.

### Fraud / trust correction
- Prior agent's reported numbers were checked against the WRONG repo. Commits `25ebb32`
  and `f79c3ad` DO exist — in the nested `halofire-studio` git repo (branch
  `studio/fix-1881-part-scale-align-20260613`), NOT the root `E:/ClaudeBot` repo. `git
  cat-file -t` confirms both are real `commit` objects in halofire-studio.
- The trust-gate failure ("building-from-plan.js modified in working tree, not in any
  commit") was a PRE-commit snapshot. It is now committed at `04b38ec` (studio W2b-fix:
  commit load-bearing renderer building-from-plan.js). Working tree == HEAD == clean.
- repo==live md5 parity now holds for all 3 load-bearing/served files:
  - `building-from-plan.js` = `e28403d2269d50fd3096d51cedd73f2f`
  - `plan-extract.js` = `4ca2b06ef48251db23686e8ad1f09773` (live was a stale 27 KB
    subset `4fbce69b…`; build-time only, NOT in the runtime import graph — synced
    committed 71 KB superset up with .bak; render unaffected, site stayed 200)
  - `plan-levels.cooperative-1881.json` = `4713228f7493be285ec8bfc05aff98c4`

### Definitive recall (ONE method, version-consistent)
Both sides rasterized from vectors by the SAME pdfjs 6.0.227 via the app's own
`extractSegmentsFromOpList` + `selectWallLayer(partitionInclusive)` (lineWidth 0.09,
strokeColor #3f3f7f). No version mismatch — that mismatch is what produced the RETIRED
71% artifact. Reproduced live by `_tmp_plan_probe/recall-definitive.mjs`:
- **Whole-sheet: 77.66%** — covered 683,111 / wall-ink 879,663 px (1 ft tolerance,
  6 px/ft). 41,784 wallsFull vs 42,784 wall-ink segments.
- **Per-wing whole-sheet: lowerWingA 73.56%, upperWingB 84.67%.**
- **In-envelope (denominator shrunk to building footprint): 97.15%** (lowerWingA 98.01 /
  upperWingB 95.83); ~99.3% by segment count (42,500/42,784).

### Gap is an artifact — proof
- ±12 ft shift sweep does NOT improve recall (lowerWing baseline 74.38→best 73.09;
  upperWing 85.26→best 85.73) ⇒ not a registration offset and not a missing-wall gap;
  merge registration (dx -57.0253, dy -111.6844, splitYFt 137.3439) is already optimal.
- Heatmap misses are sheet furniture (border, grid-bubble diamonds, dimension/extension
  lines, title block, match-line centerlines) + short curve glyphs the straight-wall
  extractor flattens — irreducibly inside the partition-inclusive heavy-lineweight
  denominator. Interior partitions / cores / cross-bracing / shell are covered.
- **0 building walls are missing inside the envelope.** Both wings' exterior shell and
  perimeter ARE present (the earlier "red exterior shell" was the v4.2-vs-v6 raster
  artifact, now eliminated).

### Doors / openings / fixtures (all needs-verification, deterministic best-effort)
- 124 doors via swing-arc circle-fit (984 arcs scanned): **24 CONFIDENT** (hosts on a
  wall AND real-door leaf width 2.3–4 ft) / **100 SUSPECT** (off-wall OR sub/over-door
  width — small swing glyphs, mirrored half-leaves, closet/cabinet arcs; rendered muted-
  grey, DOOR_SUSPECT_COLOR). NOT a verified door/hardware schedule, NOT AHJ/egress parity.
- 15 cased openings (2.5–8 ft collinear wall-end gaps, no door arc).
- 5 fixtures/cores (1 mech / 1 elec / 3 stair cores from segmented-room kinds + UP/DN/DOWN
  stair-direction tokens; DW dishwasher tag deliberately excluded to avoid false cores).
- SAM3 NOT used (not attempted — vector recovered the geometry).

### Honest ceiling + status
The ≥90% WHOLE-SHEET bar is genuinely UNACHIEVABLE for this sheet (~78% ceiling) without
weakening the metric, because the heavy-lineweight denominator must include non-wall sheet
furniture. The defensible building-wall recall is 97.15% in-envelope / ~99.3% by segment.
Per W2 doctrine the metric was NOT weakened and ≥90% is NOT claimed. **W2 left [~] in the
project queue — AWAITING USER DECISION on whether to accept this documented ~78%
whole-sheet ceiling (≈97% in-envelope) or hold for further work.** Recommendation: advance
to W3 only after the user accepts the ceiling.
Heatmaps: `out/halofire-W2b/recall-definitive.png` (whole-sheet),
`out/halofire-W2b/recall-inclip.png` (in-envelope).

## Extraction recore 2026-06-13

The W2b "97.15% recall" above was a COVERAGE artifact on an over-inclusive wall set — it
PASSED garbage. User + Claude visually confirmed on live 1881 (ss_7566rpo6u) that the core
was broken. Recored to correctness, gated by screenshot (not coverage %). Superseded; this
section is the honest record.

**Which vision models actually work (honest):** NONE work on this sheet. Both were tested
for real on GX10 (NVIDIA GB10):
- **SAM3 @9003** — runs (cuda, 848M, 1.5s) but returns 0 wall / 0 column / 0 door
  detections (max "wall" score 0.0204 via /debug/scores). Trained on natural-image
  concepts, not CAD linework. NOT viable.
- **CubiCasa5K** (ResNet34-UNet, Yytsi/floorplan-to-3d-walls, 93MB, smp 0.5.0) — runs in
  0.9s but outputs ~98.9% background on this dense 384ft commercial sheet (walls go
  sub-pixel; trained on simple 512px residential SVGs). NOT viable as-is.
- **FloorplanVLM-class** (qwen2.5-vl) — deployable, not run; would only be for SEMANTIC
  room labeling, never geometry.
I did NOT fake model output. Structure comes from vectors, honestly.

**The correct method used:** vector-first reconstruction. `extractSegmentsFromOpList` →
single-band cut-wall lineweight layer → new `src/engine/plan-wall-runs.js buildWallRuns()`:
collapse fragmented collinear segments into axis-aligned wall RUNS (perpTol 0.25ft,
gap 1.0ft, minRun 2.0ft) with NON-WALL EXCLUSION — drop sub-2ft stubs (dimension ticks/
glyphs) and diagonals (door-swing arcs/hatch). The 41,784 lineweight-union set is demoted
to an off-by-default diagnostic overlay; primary structure is `wallSource:'wall-runs'`.
Data augmented in place via `scripts/augment-wall-runs-recore.mjs` (no 173MB re-extraction).
DOMAIN CORRECTION: A-101 is a long narrow WOOD-FRAMED multifamily building drawn as two
stacked plan views, NOT a parking podium. The STRUCTURAL S-110 OVERALL sheet (1"=30') was
tested but its column markers are sub-detectable (grid parser reads dimension strings as
columns → 0 columns); columns/beams live on the ENLARGED S-1xx.B/.C sheets (1/8"=1') — a W4
input, not usable for L1 structure now.

**New element count:** L1 = **158 wall runs** (from 6,858 single-band segments; excluded
2,692 stubs + 6 diagonals; 2,252 ft total). All 8 levels land 79–251 runs — hundreds, not
41,784. Paint/furniture in structure field = 0. Orientation fixed (rotation.x +PI/2 → -PI/2,
no texture flip). Clipping fixed (polygonOffset(1,1), lift 0.04→0.5 ft).

**Screenshots (proof in `out/halofire-recore/`):** `r2-orientation-top.jpg` +
`r2-orientation-top-zoom.jpg` (sheet text upright + forward — "FLOOR PLAN GENERAL NOTES",
"KEY PLAN", "22 DESIGN+LAB" logo, title block, A-101 number all readable);
`r2-structure-over-sheet-top.jpg` (158 runs registered on the sheet); `r2-orbit-1..6-*.jpg`
(no clipping / no z-fight at 6 camera angles incl ~12° grazing). A/B orientation evidence:
`ab-negPI2-noflip.png` (correct) vs the 3 wrong states.

**Trust:** full vitest 1139/1139 green (+11 new). Live==committed==worktree md5 parity —
building-from-plan.js (419bf0b5), pdf-underlay.js (354ca4a8), plan-wall-runs.js (6122ee5d),
autosprink.html (d671c3ff). Commit **ddb5f3b** (`git cat-file -t` = commit) on
studio/fix-1881-part-scale-align-20260613. Hotfix markers intact. All elements
needs-verification — NOT AHJ/PE/mfr-exact/AutoSprink-parity.

**Forward-wave readiness:** the core is now correct enough to resume W3/W4. Structure is
plausible, plan is readable-from-above, nothing clips — all proven by screenshot, not a
coverage %.

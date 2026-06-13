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

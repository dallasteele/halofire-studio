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

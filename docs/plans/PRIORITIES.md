# PRIORITIES — the single steering file for ALL loops

> Every automation reads this each cycle: Claude's wakeup loop, the GX10
> build-loop wave seeding, and HAL's self-improve cron (via `loopctl report`).
> When the user gives new direction, THIS file is updated first — loops re-aim
> without losing context. Updated: 2026-06-14.

## CURRENT WAVE (user 2026-06-14): WIRE THE STUDIO TOOLS + MENUS
Functional verify+fix wave 1 is DONE (140 controls, 0 broken, 14 fixes; honest
matrix at apps/autosprink/docs/HALOFIRE_STACK_FUNCTIONAL_STATUS.md, shipReady:false).
User picked the next wave: **make the ~332 stub Studio menu items + the draw/edit
tools actually do real engine work** — multi-segment polyline draw, measure, typed
Location-Input dimensions, trim/extend, array/mirror, grip/handle edit, offset,
copy/move w/ basepoint. Wire every menu item to a real engine command or keep an
HONEST stub (never fake). Verify each LIVE (logged-in harness, click → real effect →
no error → screenshot). Background must stay: gentle glow + floating embers (static
default, Settings Moving toggle), glass scrollbars tinted by selected glass color,
Studio full nav + glass menus. Deep gaps still owed after this: NFPA hydraulics,
PDF→building model, manufacturer-exact parts, payments/voice.
Local verify: [[project_halofire_local_verify_harness]] — qa@halofire.local.

## Deploy workflow — VPS canonical, verify before go-live (user 2026-06-11)
NO MORE LOCALHOST as the reference. Live site = http://halofire.rankempire.io
(VPS 187.124.234.28, halofire.service, :3301, tracks origin/main). All work is
pushed + gated locally, then deployed ONLY via `scripts/deploy-vps.sh`
(gates → snapshot → pull/install/restart → health-check → AUTO-ROLLBACK on
failure). The blind hourly git-pull cron must NOT be the thing that updates the
client site. Preview/verify against the live URL, not a local dev server. Full
workflow: DEPLOY.md. OPEN GAP: vhost is HTTP only — enable certbot HTTPS for
halofire.rankempire.io BEFORE client logins flow (flagged, tracked here).

## Client delivery (user 2026-06-11)
Halo Fire's team must see live progress + upload info we can't scrape. Targets:
- **Live on the VPS, always-on** (systemd; openclaw-vps skill: 187.124.234.28).
- **Secure client access by emailed/texted link** → standard flow: link → set
  password by email → in. **Username = the company email.** First client:
  Wade@halofireus.com (Director of Operations).
- Clean professional **Apple-glass UI**, **only Halo Fire's own logos**, animate
  ONLY the fire. (All HaloFire software uses the apple-glass system.)
- BLOCKED ON USER (cannot proceed without): (1) the official Halo Fire logo
  asset — interim uses a flagged placeholder per doctrine; (2) SMTP creds in
  Settings to actually send (user enters them — never committed/handled by AI);
  (3) explicit approval of the exact Wade invite before any send (real external
  client; per-message human approval is a hard gate). SMS needs a provider.
- Wave 17 seeds the buildable core: secure invite/set-password token
  (email=username), apple-glass portal shell + flagged placeholder logo +
  animated fire. VPS deploy + invite-email DRAFT follow.

## ⭐ CONSTITUTION: docs/plans/halofire-operations-surface.md (2026-06-12)
HaloFire = the Dentrix of fire protection — ONE operations surface (Job Book
calendar = Appointment Book, Client File = Family File, Bid Pipeline = Treatment
Planner, NFPA-25 recall engine = Continuing Care, Job Ledger, Reports, Studio =
the chart). Real DB schema + real CRUD + behavioral gates per module — NO empty
shells. Build order OPS-1..8 in that doc. The sections below feed into it.

## Operations Calendar = the FRONT DOOR (NEW HEADLINE, user 2026-06-12)
The calendar is HaloFire's operational hub — "Dentrix/Denticon for fire
protection." It is what every Halo employee opens into (NOT the workbench, which
is the AI/back-office surface). Requirements:
- **Landing:** authenticated employees land on `/calendar`, not `/workbench`.
  workbench stays for AI/admin back-office. Role decides the default route.
- **Style:** the black apple-glass system (same as the portal); only Halo Fire
  branding; animate only the fire.
- **Function like Dentrix/Denticon:** day/week/month scheduling that runs the
  whole office — jobs, bids, inspections, crew/resource dispatch, the entire
  workflow — one SHARED calendar all employees see.
- **External sync:** link to Google, Apple, and whatever Halo Fire uses today
  (two-way where possible; read-through at minimum). OAuth per provider, creds
  user-supplied, never committed.
- **OpenClaw visibility (critical):** the calendar surfaces what the AI is doing
  in real time — bids arriving by email, auto-bids being drafted, and an
  **"Awaiting approval"** lane where an authorized user can **one-click approve &
  send** a drafted bid (only while an authorized user is logged in; per-message
  human approval gate is preserved — this is the UI for it).
- **RBAC like Dentrix:** every employee has access restrictions by role; admin
  (Dallas) sees everything. Server-enforced (not just hidden in UI).

### P0 BUG — logout on navigation (user 2026-06-12)
Opening any page other than workbench logs the user out. ROOT CAUSE (live-repro
verified 2026-06-12): the SERVER auth is fine — login→`Secure` cookie→`/auth/me`
200→`/api/bids` 200 all pass. The logout is client-side: (1) browsing via the
`localhost:3399` preview proxy drops the `Secure` session cookie — real use must
be the https URL; (2) `autosprink.html`/`crm.html`/`settings.html` blanket-
redirect to login on ANY 401 from ANY call while `workbench.html` masks it. FIX:
one shared auth guard (`/public/halofire-auth.js`) used by every page that only
redirects on a real `/auth/me` session failure, never on an incidental feature
401; `app.set('trust proxy', 1)` confirmed so `Secure` is correct behind nginx.

### Calendar epic phases (seed to the loop / Codex)
- **CAL-0 Auth-guard unification + employee landing** (P0; unblocks the app):
  shared guard, role-based post-login route (employee→/calendar, admin→choice),
  kill the false logouts. Ship FIRST.
- **CAL-1 Calendar core:** apple-glass day/week/month grid, events table
  (`calendar_events`: kind=job|bid|inspection|office|task, ref to bid/job, owner,
  attendees, start/end, status), CRUD, shared across users. Server RBAC by role.
- **CAL-2 Workflow binding:** jobs/bids/inspections appear as events; status
  changes reflect both ways; CRM + auto-bid records link to calendar items.
- **CAL-3 OpenClaw lane:** live "bids in / auto-bids drafting / awaiting approval"
  feed on the calendar; one-click approve→send wired to the existing
  per-message-approved outbound draft path (no new auto-send).
- **CAL-4 External sync:** Google (CalDAV/Google Calendar API), Apple (CalDAV),
  + Halo Fire's current system; user-supplied OAuth/creds in Settings.
- **CAL-5 Roles/permissions admin:** define roles + per-feature access; admin UI
  to assign; enforced server-side on every calendar + workflow route.

## Activity & Observability (OBS) — log ALL usage so AI helps live (user 2026-06-12)
Wade's live login proved the need: every user action must be monitored + logged
with user attribution so HAL/OpenClaw/Claude can assist in REAL TIME (today this
only exists as Claude hand-reading nginx logs). Build:
- **Audit log:** server middleware records every authenticated request + each
  significant action (login, logout, setup-password, page open, bid view/approve/
  send, CAD action) → `activity_log {id, user_id, username, role, action, path,
  method, status, ip, meta, at}`. NEVER log passwords or tokens.
- **Admin Activity view (apple-glass):** live sessions + recent actions, filter by
  user; admin-only via RBAC. Shows who is in, what they're doing, where they got
  stuck or errored.
- **Live AI feed:** an SSE/stream HAL/OpenClaw/Claude can watch to help as it
  happens (failed logins, a user stuck mid-flow) → proactive assist + alerts.
- Ties to CAL-3 (OpenClaw activity lane on the calendar) and CAL-5 (RBAC). This is
  the substrate that lets the AI "help as it's happening."
- Honesty/privacy: support-oriented, admin-scoped, no surveillance creep; data
  stays in the app DB; sensitive fields never logged.

## North star (the product)
An AI-run AUTO-BID system for Halo Fire: scrape company email → identify bid
invitations → import (PDF-FIRST; DWG is luck) → estimate via the AutoSprink-
clone CAD engine → branded HTML bid → human-approved outbound email → CRM
tracking. Full program: auto-bid-program.md.

## Priority queue (descending)
00. **UN-GATE THE CLAIM GATES — loop per blocked issue (user 2026-06-11):** the
    Settings page still shows red BLOCKED claim gates (AHJ_APPROVAL_MISSING,
    PROFESSIONAL_REVIEW_MISSING, MANUFACTURER_MODEL_APPROVAL_MISSING,
    AUTOSPRINK_EVIDENCE_MISSING). Per doctrine these become needs-verification
    FLAGS, never walls. Build a self-improving loop PER gate that uses all
    OpenClaw tools (GPU SAM, Scrapling scraper, internet, OpenSCAD) to get each
    as close as possible, iterating, and where it cannot fully verify it STILL
    presents the best-effort result with a clear "needs further review" flag.
    Honesty preserved: never claim AHJ/PE/manufacturer approval exists — that
    residual is the flag. Wave 16 (W16A flag model, W16B API, W16C settings UI,
    W16D manufacturer-evidence loop, W16E AHJ/PE/AutoSprink packet prep; W16F
    scraper feeds them). This IS the self-contained AI self-improvement loop.
0. **PARTS PIPELINE + UN-GATE (NEW TOP PRIORITY, user 2026-06-11):** a
   non-human loop scrapes manufacturer cut sheets for ALL 155 catalog parts →
   generates a CAD model for each (parametric OpenSCAD via the Wave 13
   emitters; SAM/vision on cut-sheet images where needed) → every part lands
   with `verificationStatus: 'needs-verification'` + a note, NEVER proxy/
   blocked. Then RE-WIRE the Settings "Parity" surface from a hard-blocked
   gate into a **verification ledger** (N machine-generated / M human-verified
   / coverage %), and apply the same flag-don't-gate pattern system-wide
   (AHJ/PE/manufacturer become flags). Goal: 155/155 usable flagged models,
   0 blocked. Wave 14.
1. ~~AB1+AB2~~ SHIPPED 2026-06-11: AB1 CRM (646a3d4, 787/787), AB2 intake
   (7aed36a, 840/840 — read-only IMAP, spec-exact W7A classifier, fail-closed)
2. ~~AB3-5~~ SHIPPED 2026-06-11 (0973420, 902/902): estimate wiring (CAD
   payload or manual, labeled price provenance — estimated prices surface on
   the bid/board/approval), W7B HTML renderer, outbound DRAFTS with
   per-message admin approval (no auto-send path; mock seam refuses prod
   boot; /data static hole closed — DB no longer downloadable), follow-ups +
   won/lost. **AUTO-BID PIPELINE v1 IS END-TO-END.** Next: operator pilot —
   Halo Fire configures mailbox+SMTP in Settings and runs real ITBs through.
3. **PDF-first assist** — vector linework extraction w/ stroke widths feeding
   the W5B scorer; scale pre-fill (W8A) + sheet triage (W8B) integration
4. **CAD fidelity debts (user-flagged):** junction orientation close-range
   verification + fixes; hangers (W6A) + ceiling grids (W6B) rendering;
   1881-kernel hydraulic solvability — imported pipe-mats have no riser/demand
   topology so the fluid heat map stays dark on 1881 (needs riser inference);
   DONE 2026-06-11: inspector part viewer (6bd2e4a) + flow gradients (87fc40a,
   preview-verified 154/154 gradient segments on the sample project)
5. **Parts pipeline** — UNBLOCKED 2026-06-11: OpenSCAD 2021.01 installed on
   GX10 (/usr/bin/openscad) + Windows dev box; docs at
   docs/research/openscad-parts-pipeline.md. Wave 13 = parametric .scad
   emitters + headless STL render harness so the nominal-fallback count
   (126/155) drops with honest dimensioned-parametric provenance
6. **W9 building extraction** — assisted walls/doors from PDF sheets (the
   long pole; W5B/W8A/W8B are its bricks). SAM raster lane UNBLOCKED
   2026-06-11: hal-sam3 on GX10 now runs geometric prompts on the GB10 GPU
   (torch cu129→cu130 sm_120 kernels; was silently CPU-fallback) — OpenClaw
   sam3 MCP fronts it for scanned-PDF segmentation proposals.

## DOCTRINE — build-complete, flag-don't-gate (user, 2026-06-11, OVERRIDES prior fail-closed)
The system must be **built out completely and be fully usable end to end.**
Where real/verified data is missing, a NON-HUMAN loop machine-generates the
best-effort version (scrape cut sheets → generate CAD models → fill dims/specs)
and gets it as close to correct as it can. EVERY machine-made or unverified
element carries a `verificationStatus: 'needs-verification'` flag with a note
on what to check — but is **NEVER gated, blocked, hidden, or deferred.** Humans
use the whole thing and see plainly what is machine-generated vs human-verified.
- Honesty = truthful LABELING, not withholding. Fabricated/best-effort content
  is allowed AS LONG AS it is flagged needs-verification. The ONE thing still
  never done: claiming something IS verified / PE-stamped / manufacturer-exact
  when it is not. AHJ/PE/manufacturer status becomes a prominent flag, NOT a
  blocking gate.
- A human can flip any flag to `human-verified` (with who/when). Nothing waits
  on that flip to be usable.

## Standing constraints (never violated)
- PDF-first; DWG never required.
- Outbound email still needs per-message human approval; mailbox stays
  read-only. (These are the only true gates — everything else flags, not gates.)
- TOKEN CONSERVATION (user, 2026-06-11): the GX10 loop does ALL build work —
  pure modules AND UI integration (Wave 10+ proves it). Claude is harvest +
  audit + backlog-seeding ONLY; no cloud implementation workflows unless the
  ladder has failed a task twice AND it blocks the queue head. Ladder:
  qwen → Gemma QAT → Kimi.
- All 3D work passes the scene-invariants gate + numeric verification.
- New user direction → update THIS file + seed/adjust waves in the same turn.

## Domain knowledge — Halo Fire field facts (user 2026-06-12) — MUST honor in models + BOM
- **Pipe stock length: 24 ft in Arizona, 21 ft everywhere else.** Takeoff/BOM
  coupling counts derive from this — a pipe run is assembled from stock lengths,
  so each joint between stock lengths needs a coupling. Region (AZ vs other) sets
  the cut length used for the count.
- **Couplings are REQUIRED in the part models AND the BOM — both RIGID and
  FLEXIBLE types.** Every routed pipe run must place couplings at stock-length
  intervals (24 ft AZ / 21 ft else) and where the design calls for flexible
  couplings (e.g., seismic/movement joints); the takeoff line-items them by
  type (rigid|flexible) and size. This feeds the parts pipeline (rigid + flexible
  coupling .scad emitters) and the W6 takeoff/bid. Flag any inferred coupling
  type/spacing needs-verification per doctrine; never claim manufacturer-exact.

## Studio MUST be real interactive CAD (user 2026-06-12, live-demo findings) — TOP UX PRIORITY
The live "Sprinkler Studio" (apps/autosprink/autosprink.html) is an auto-layout
VIEWER, not CAD. The interactive CAD (selection/inspector/edit/undo) already lives
in apps/cad but is NOT wired to the live Studio. Make the live Studio real CAD:
- **Part selection + inspector:** click ANY part (head, pipe, coupling, fitting) →
  highlight + open an inspector with its specs. The autosprink viewer has NO
  raycaster/selection today; apps/cad does (W-series selection engine). Wire
  apps/cad in as the Studio OR port selection+inspector into the viewer.
- **Camera focus on selection (AutoCAD-style):** selecting a part makes it the
  orbit pivot; rotate/zoom around the selected part.
- **View orbit must always work:** OrbitControls exist but the Demo timeline
  hijacked the camera → "can't rotate." Demo button now hidden live; remove it
  from source and guarantee manual orbit is never blocked.
- **Floor-plan underlay toggle:** show the imported plan drawing as a ground
  underlay beneath the 3D structure (a LAYERS toggle) so the operator can verify
  the structure was built correctly on the real plan. Missing today.
- **Pipe max length enforced (HARD):** segment every run to ≤21 ft (non-AZ) /
  ≤24 ft (AZ) with a COUPLING at each joint; region drives the cut length.
- **Couplings: fix placement + ORIENTATION** (currently wrong — gold couplings
  sit/aim wrong on the pipes). Rigid + flexible per the domain rule; reuse the
  apps/cad fitting-orient logic (oriented along the pipe axis at joints).
- **Remove the Demo button** (done — hidden live; strip from source permanently).
DECISION (user 2026-06-12, FINAL): the Studio IS the autosprink clone
(apps/autosprink/autosprink.html) — build ALL CAD features INTO it; do NOT move
the Studio to a separate app. REUSE apps/cad logic/patterns (selection engine,
fitting-orient, inspector). The missing **top menu bar + useful tool buttons**
must be added here too.
- **AUTO-LOAD (user, high priority):** if the selected Project target already has
  a generated layout, LOAD it automatically (persist generated state per target;
  reload on open/target-change) — never force the user to re-Generate. If nothing
  is generated yet, show the **PDF/plan underlay by default** so they see the plan.
- **PUSH LIVE:** the Studio is unbundled static (autosprink.html imports /src/*.js
  natively) — deploy = sync changed files to the VPS; do it as each piece lands.
  Base work on the CURRENT LIVE file (it carries hotfixes: `#demoBtn{display:none}`
  + dark `select option` CSS) so they're preserved; back up + verify each deploy;
  never leave the live Studio half-edited (Dallas demos on it live).

### Studio layout + project lifecycle (user 2026-06-12)
- **Top menu bar owns EXPORT (+ file/view tools):** MOVE the CAD interchange
  exports (DXF / STEP / IFC / STL) OUT of the left panel INTO the top menu bar.
  Export is a top-menu function, not a side-menu one.
- **Rename "Settings & Parity" → "Settings"** everywhere (nav links + page title);
  parity/ledger is a section INSIDE Settings, not part of its name (user 2026-06-12).
  DONE live on settings.html itself 2026-06-12 (title + header); nav LINK LABELS on
  other pages still say "Settings & Parity" — fix with the unified header.
- **UNIFIED HEADER on every window (user 2026-06-12, exact spec):** one identical
  top bar across ALL pages (Calendar, Workbench, Studio, CRM, Settings):
  · LEFT = nav links to all core windows, same order on every page, so any window
    is one click away. · RIGHT = the consistent "HaloFire" brand text + the name of
    the CURRENT open window (e.g. "HaloFire · Settings") + user (name · role) +
    Sign out. Implement once as a shared include/web component (pairs with
    halofire-auth.js) — never per-page copies that drift.
- **Settings must LIVE-UPDATE as the build progresses (user 2026-06-12):** the
  parity/verification-ledger counts and parts data on Settings are fetched once on
  page load today (zero polling — verified). Add auto-refresh (poll the cheap
  count endpoints ~every 30–60s, or SSE later with the OBS feed) so the operator
  watches the ledger climb while the AI loops fill parts/models — no manual reload.
- **Systemic auth invariant (user 2026-06-12):** NO page inside the Halo Fire stack
  may ever bounce a logged-in user to login. One shared guard (halofire-auth.js) on
  EVERY page; logout only on a real /auth/me session failure; gate-loop tests this
  on all pages every round. (settings.html localStorage gate hotfixed live
  2026-06-12 — .bak-gatefix on VPS; proper shared-guard fix in the ultramode run.)
- **Left panel = AutoSprink-style TOOLS, project at top:** Project selector at the
  very top, then design TOOLS + layers/properties below — mirror AutoSprink's tool
  panel. The left panel is for tools, not export.
- **Source is automatic, not a manual dropdown:** for BIDS the source is ALWAYS the
  PDF the AI pulled from the client email (PDF-first, always). Auto-set Source to
  "email PDF" for bid projects rather than a built-in/SVG/DXF picker.
- **Project lifecycle — bid → won → CAD upgrade (IMPORTANT):** a project STARTS as a
  BID built from the email PDF. When the bid is WON, the client sends DWG / other
  CAD; those files attach to the SAME project to enhance accuracy, and the design
  PICKS UP WHERE THE BID LEFT OFF (preserve the bid layout/network; refine geometry
  with the better CAD). Project model must hold multiple source files over time +
  a status (bid|won|…). Ties directly to CRM/auto-bid (AB1–5): a project IS the bid
  record, upgraded in place when won.

### AutoSprink MENU SYSTEM parity (user 2026-06-12) — the Studio's real shape
The Studio must clone AutoSprink's menu system + toolbars (apple-glass), full
function parity as the target: real DROPDOWN menus (File Edit Select Snaps Tools
Actions Commands Auto Draw Roof Planes Wizards Hydraulics Finish Alerts Listing
Parts Database AutoPREP Settings View Window Help), Alt-mnemonics + Esc, Export
under File (not loose buttons). Spec + scrape plan:
docs/research/autosprink-menu-parity.md. The help docs are JS-rendered — Codex
scrapes them with Scrapling into autosprink-menus.json / autosprink-toolbars.json.
Unmapped items ship as visible grayed stubs (flag-don't-gate; never claim parity
until the ledger proves it).

### Floor-plan underlay must be the REAL plan (user 2026-06-12) — current is a placeholder
The deployed underlay shows a grey rectangle with mirrored text (rendered facing
-Z) instead of the actual plan. FIX: render the project's REAL PDF plan page
(pdfjs raster → texture; the PDFs exist in the repo/projects), correct the plane
orientation/UVs so text reads correctly from above (+Y view), correct scale +
alignment under the structure. Underlay toggle lives under View → Layers in the
menu system. Placeholder grey-box is acceptable ONLY as a flagged fallback when a
project has no plan file.

### UNREAL-ENGINE-STYLE UX (user 2026-06-12) — standing design principle
**UE5 is the UX reference for all Studio improvements** — when designing any
interaction for this AutoSprink clone, derive it from how Unreal Engine operates.
- **TRUE SCALE ONLY:** REMOVE the "Exaggerate pipe radius" option entirely (user
  said this twice). No exaggeration mode exists; everything renders true scale.
- **Selection → Inspector in the right panel** (shipped 2026-06-12; keep it).
- **Movable/dockable PANELS like UE:** every panel (Inspector, left tools, layout
  results, layers) can be dragged/rearranged/docked. **Layout auto-saves to the
  USER PROFILE** (server-side per-account, e.g. user_prefs {user_id, workspace
  JSON}) so each person's window arrangement follows their login — per-user
  workflow setups.
- **Orientation/view CUBE top-right of the viewport** exactly like UE: click
  faces/edges to snap Top/Front/Iso views; drag it to orbit; shows current
  orientation at all times. (three.js ViewHelper / a gizmo equivalent.)
- **VIEWPORT SCALE INDICATOR (user 2026-06-12):** like any CAD env, a live scale
  readout/bar rendered NEXT TO the orientation cube (top-right), updating with
  zoom (e.g. dynamic scale bar showing what 10 ft / 5 m spans on screen at the
  current camera distance). **Unit toggle: standard (imperial ft-in) ⇄ metric
  (m/mm)** — switches the scale bar, Inspector dimensions, BOM lengths, and all
  on-screen measurements together. Persisted per user (user_prefs).
- **SCALE AUDIT (user: "scale is off on everything"):** prove true scale
  numerically, don't assert it: a gate that compares RENDERED world distances to
  DATA truth — e.g. head spacing in the layout data (10 ft) must measure exactly
  10 world units apart in the scene; pipe OD at true scale must match the
  schedule diameter (3" branch = 0.25 ft cylinder radius*2); building bbox must
  equal the plan dims (Home Depot 300×405 ft). Any unit mismatch (ft vs in vs px)
  found = the audit lists every affected subsystem; fix at the source transform,
  not per-mesh fudge factors.
- **SELECTION INTERACTION CONTRACT (user 2026-06-12 — implement as a WHOLE, not
  piecemeal; UE/AutoCAD-derived):** selecting a part makes it the focal point of
  EVERY camera operation until deselect:
  1. Click part → select + highlight + Inspector (right panel). **THE CAMERA
     DOES NOT MOVE ON SELECT** (UE behavior; root cause of the 2026-06-12
     "can't select another part" bug was the camera recentering on select, which
     shifted every other part on screen mid-click — gate-loop evidence).
     **HIGHLIGHT = the PART ITSELF recolored, NO volume/bounding boxes (user
     2026-06-12):** never draw a wireframe/box around the selection. Tint the
     selected part's own material/instance (emissive or color swap) in ONE
     RESERVED highlight color used for nothing else in the scene palette
     (palette today: grey shell, red mains/heads, blue branches, cyan drops,
     gold couplings → highlight must be a distinct reserved hue). InstancedMesh
     parts highlight ONLY the picked instance (setColorAt). Deselect restores
     the original color exactly.
  2. Click a DIFFERENT part → selection MOVES to it (repeatable forever; works
     naturally once #1 holds because nothing shifts on screen).
  3. **F = frame the selected part** — smooth-tween the camera to it AND make it
     the orbit/zoom pivot. Pivot changes ONLY on F/double-click, never plain click.
  3b. **DOUBLE-CLICK = inspect mode (user 2026-06-12):** zooms to a FRONT-FACING
     view of the part (camera tweens to face the part's primary axis at a
     fill-the-view distance) AND enters X-RAY ISOLATION: the selected part stays
     fully highlighted — including any OCCLUDED portions, which render visible
     through obstructions (highlight with depthTest off / ghost pass) — while
     EVERYTHING ELSE in the viewport goes translucent (~10-20% opacity). Goal:
     instantly see the part you want to inspect, never hidden behind pipe/deck/
     structure. Esc or empty-click exits inspect mode and restores all opacities
     exactly. **DOUBLE-CLICK AGAIN = DESELECT ALL (user 2026-06-12):** a second
     double-click (while in inspect mode) toggles OUT — exits x-ray, restores
     opacities + pivot, clears the selection entirely.
  3c. **INSPECTOR PLACEMENT (user 2026-06-12):** the Inspector must NOT pop up
     over the viewport/canvas. It renders in the LAYOUT window area — the right
     results panel (where Layout / Pipe Schedule / Hydraulics live) — as a
     section there (top of that panel while a part is selected). The 3D viewport
     stays unobstructed.
  4. After framing, orbit pivots about the part and **scroll-zoom dollies
     toward/away from it** (zoomToCursor off — dolly targets the pivot).
  5. Pan moves the pivot with the camera (standard OrbitControls pan).
  6. F = frame/focus selected (UE-style); double-click = select + frame.
  7. Esc / empty-click → deselect, restore prior pivot; all camera ops keep working.
  8. Selection marker/inspector must NEVER intercept pointer events meant for the
     canvas (raycast-transparent marker; panel outside the canvas hit area).
  Every item is a BEHAVIORAL gate (real synthetic pointer/wheel events, numeric
  assertions) in the gate loop — a partial implementation fails the loop.

### CAD geometry accuracy (user 2026-06-12, close-up review) — the parts are WRONG
Fix the actual 3D geometry (reuse the OpenSCAD .scad emitters + apps/cad
fitting-orient). Every part flagged needs-verification; never claim mfg-exact.
- **TRUE scale by default, no exaggeration:** make true NFPA pipe scale the
  DEFAULT; the ×6 "exaggerate" is a viewing aid only. Parts at real dimensions.
- **Pipe = correct threaded-pipe CAD** (modeled threaded ends), not plain cylinders.
  **DEFECT (user screenshot 2026-06-12, post-geometry-pass): pipes render with a
  star/gear cross-section along their FULL length** — the thread ridges were
  applied to the whole pipe profile. CORRECT: pipe body = smooth cylinder
  (>=16 radial segments); thread detail ONLY in a short band (~2-3 in scale) at
  each end; bands must not change the body profile. Also visible: head/escutcheon
  clipping through the coupling — parts must not interpenetrate. VERIFY VISUALLY:
  use the page's window.__snapshot hook for close-range screenshots of (a) pipe
  mid-span (smooth), (b) pipe end (thread band), (c) coupling joint (no clip)
  as gate evidence — geometry claims need pictures, not greps.
- **Proper connectivity pipe → drop → head:** the geometry AND topology must connect
  correctly. The "elbow on the end of the sprinkler" is an ERROR — it must read as a
  real reducing fitting / drop nipple into the head, not a confusing elbow.
- **Couplings (the oversized gold/orange barrels):** wrong SIZE + orientation +
  placement. Size to real coupling OD (snug to pipe, not a barrel), orient along the
  pipe axis, place at the 21 ft (24 ft AZ) joints. Rigid + flexible.
- **Fastener hardware (hangers/brackets) MUST be visible:** render W6A/W18C hanger
  hardware at support points + in the BOM (already speced). **Hangers must attach
  TO STRUCTURE (user 2026-06-12)** — a hanger hanging from empty air is wrong; it
  connects to a beam/joist/deck member (see build-out below).

### EXTRACTION COMPLETENESS — recall + doors + openings (user 2026-06-12)
Precision (extracted walls land on real ink, median 0.27 ft) is NOT completeness.
Must measure + maximize RECALL and extract the things we skipped:
- **Wall RECALL gate:** rasterize the sheet's wall-ink (dark linework, excluding
  text/dimensions/hatch by lineweight+length), rasterize extracted walls, measure
  % of sheet wall-ink covered by an extracted segment (within ~1 ft). Target
  **≥90% coverage**; report the number + a HEATMAP image of MISSED ink so gaps are
  visible, not hidden. Low recall = FAIL (don't claim "walls extracted" at 60%).
- **DOORS + OPENINGS:** extract door swings (arc + leaf) and wall openings; place
  door objects in the model; doors must sit on real openings in the walls.
- **Fixtures/cores:** the small-room cluster (restrooms, mech, elevator) — extract
  fixtures/equipment symbols at least as labeled space content.
- All flagged needs-verification; the HF recognition model (below) feeds door/
  symbol detection where vector linework is ambiguous.

### DRAWING / EDIT TOOLS — it must be an editable CAD, not a viewer (user 2026-06-12)
The Studio must let a user DRAW and EDIT, not just view/select. Port the proven
apps/cad edit engine into the live Studio (autosprink.html) and wire the AutoSprink
Draw/Tools/Commands/Snaps menu items to real actions:
- **Edit engine (reuse apps/cad E0-E7):** undo/redo command stack (Ctrl+Z/Y),
  move/copy/delete/rotate/mirror on the current selection.
- **Draw tools:** Draw Wall, Draw Pipe (manual, T1), Place Head, Add Fitting,
  Add Door — click-to-place / click-points-to-draw, live preview.
- **Edit any element:** drag to move, edit dimensions in the Inspector (Inspector
  becomes editable, writes back to the model), delete.
- **Snaps (AutoSprink Snaps menu):** snap to grid / endpoint / midpoint /
  intersection / perpendicular; visible snap indicator.
- **Persistence:** edits update the model + persist (save layout / project).
- Behavioral gates: synthetic draw-a-wall persists; move-an-element changes its
  coords; delete removes it; undo reverts exactly; snap lands on the target.

### PLAN-COMPREHENSION MODEL STACK (user 2026-06-12) — OpenClaw must read plans → build models
This is a CORE feature; the prior "underlay" was a textured image on a box (overclaimed
as done — acknowledged). The real extraction pipeline, GPU-run on GX10, orchestrated by
OpenClaw. NOT an NVIDIA-specific model — NVIDIA = the GPU; models from HF:
1. **Vector-first (deterministic):** the bid PDFs are Bluebeam VECTOR — parse linework,
   text, layers, and READ THE PRINTED SCALE (e.g. A-101 "3/32\"=1'-0\"") → exact geometry,
   no ML. Backbone. (Running workflow wjyunctyg builds this.)
2. **SAM 3 (GX10 :9003, deployed):** raster region/space segmentation where vector ambiguous.
3. **HF floor-plan recognition model (NEXT WAVE — committed):** for scanned/ambiguous sheets
   + wall/room/door/symbol recognition. Candidates: **FloorplanVLM** (2602.06507 — outputs
   structured JSON ≈ our LevelPlan, preferred), **CubiCasa5K** (1904.01920 — proven CNN
   baseline), DeepFloorplan (1908.11025), Raster2Seq (2602.09016), CAGE (2509.15459).
   Codex/GX10 loop: pull the deployable weights, GPU-infer on GX10, feed LevelPlan.
Pipeline owner: OpenClaw on GX10 (vector parse → SAM3 → HF model) → structured per-level
plan → Studio builds. Every output flagged needs-verification.
ALSO FIX: the underlay PLANE CLIPS through geometry at grazing camera angles (z-fight /
render order) — render it as a registered ground layer with polygonOffset, below the model.

### FULL MULTI-DISCIPLINE PLAN BUILD-OUT (user 2026-06-12) — the building must be REAL
The user provided a WHOLE FOLDER of PDF plans with each layer/discipline of the
floor plan (architectural, structural, mechanical, electrical, plumbing sheets).
**ALL of them must be built out** as toggleable model layers, because they:
- give hangers something to attach to (beams/joists/roof deck — the ceiling
  STRUCTURE, currently missing entirely even though hangers render);
- are OBSTRUCTIONS that affect pipe routing (route around beams, ducts, conduit,
  other trades' pipes);
- drive NFPA-13 code compliance for head coverage + location (obstruction rules —
  beams/ducts change spray coverage and head placement).
Build-out lanes (extends W9; per-sheet pipeline: sheet-classify → extract →
layered model, all flagged needs-verification):
1. **Structural:** beams, joists, columns (exists), roof deck profile → hangers
   attach to real members.
2. **Mechanical/Electrical/Plumbing:** ducts, conduit/cable tray, other-trade
   piping as obstruction volumes (best-effort extraction, flagged).
3. **Ceilings:** per-room ceiling TYPE from the architectural reflected-ceiling
   plan — drop grid ONLY where the RCP says so (Rexburg warehouse = exposed =
   NO grid; gate already enforces).
4. **Routing + compliance integration:** the router avoids obstruction volumes;
   coverage checks account for obstructions per NFPA-13 geometric rules (cited,
   needs-verification flags on extracted geometry).
LAYERS panel lists each discipline (Structure, HVAC, Electrical, Plumbing,
Ceilings, Floor plan) individually toggleable, UE-style.
- **Drop ceilings MUST be visible — but ONLY where they exist (user 2026-06-12):**
  render the ceiling grid (W6B) as a layer ONLY for rooms/areas whose plan data
  actually has a drop ceiling (per-room ceiling type from the plan/project; e.g.
  warehouse = exposed structure = NO grid). Never blanket-render ceilings; if
  ceiling type is unknown, default to NONE and flag "ceiling type unknown —
  needs-verification" rather than inventing a grid.
This is the parts pipeline (OpenSCAD emitters: threaded pipe, rigid+flex coupling,
elbow/tee/reducer, drop nipple, hanger) + correct placement/orientation in the
studio scene. HIGHEST CAD-fidelity priority.

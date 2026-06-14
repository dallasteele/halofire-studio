# HaloFire — System Design & UI/UX Specification

**Status:** Canonical reference · **Date:** 2026-06-13 · **Owner:** HaloFire / RankEmpire platform
**What this is:** The authoritative full-spec design review of the entire HaloFire UI/UX and system architecture, written to be (a) durable memory, (b) referenceable as a wiki/HTML by any AI going forward, and (c) a **reusable template** for building the same class of product for *other companies* (RankEmpire's template-engine vision). HTML rendering: `docs/halofire-system-design-spec.html`.

---

## §0. How to read this document (template legend)

HaloFire is the first instance of a reusable platform. Every section is tagged so the next company can be built by swapping the vertical parts and keeping the platform parts:

- **`[PLATFORM]`** — reusable for ANY company/vertical (roles, jobs, reports, vendors, the review queue, the design system, the adaptive brain, the automation ladder). Carry these forward unchanged.
- **`[VERTICAL]`** — specific to fire-sprinkler contracting (the AutoSPRINK CAD engine, NFPA codes, the role catalog, the KPI set, the vendor list). Swap these per company.
- **`[PATTERN]`** — a `[VERTICAL]` thing whose *shape* is reusable (e.g. "embed a real, un-fakeable domain engine" is a pattern even though AutoSPRINK itself is vertical).

**The first principle, stated once:** there are two kinds of work in this product, and they get opposite treatment.
> **The domain engineering (AutoSPRINK CAD, hydraulics, NFPA) must be REAL and is permanent — never faked, never stubbed-and-called-done.** Automation targets the **clerical work and the autobidding** — the data entry, price updates, scheduling, submittals, follow-ups. We automate the paperwork; we *build* the engineering.

---

## §1. Product thesis

`[VERTICAL]` HaloFire serves a fire-sprinkler contractor (Halo Fire Protection, ~38 states) running **two linked businesses on the same buildings**:
- **Projects/construction** (one-time): lead → bid → design → permit → fabricate → install → inspect → invoice.
- **Recurring ITM service** (NFPA-25 annuity, high margin): asset register → recurring inspections → deficiency → repair → invoice.

`[PLATFORM]` The product is **job/entity-centric, role-aware, AI-assisted, and self-improving.** The user provides minimal input; the backend (OpenClaw + local AI) does the heavy lifting; every role sees its own surface; the system learns from real usage and earns automation over time.

`[PATTERN]` Each vertical has a **"hard core"** — the irreducible professional tool the business is built on (here: CAD + hydraulic design). That core is built for real. Everything *around* it (the clerical/operational/commercial layer) is the automatable platform.

---

## §2. Architecture principles (non-negotiable)

1. **Real domain engine, never faked.** `[PATTERN]` The professional core (AutoSPRINK full stack) is genuinely engineered. Estimated/partial output is explicitly badged (the live "Internal Alpha · NOT AHJ/PE/AutoSprink parity" badge is the honest pattern), never passed off as complete.
2. **Automate the clerical, not the craft.** `[PLATFORM]` Automation scope = data entry, price-sync, autobidding, scheduling, submittal assembly, follow-ups, reporting. Out of scope = the CAD/hydraulic engineering judgment.
3. **Minimal UI, deep backend.** `[PLATFORM]` Show the few things that matter; depth hides behind progressive disclosure + a ⌘K command palette. Small, opinionated component kit.
4. **AI throughout.** `[PLATFORM]` One pleasant assistant (local `qwen3:30b-a3b`, Claude escalation only) that knows the software via the company brain: explain / do-it-for-me / what's-next.
5. **Loops, not single passes.** Nothing is "done" until verified in the **live** target with evidence personally inspected (screenshots/numbers) — never headless flag-probes.
6. **Earned automation.** `[PLATFORM]` Every automatable action starts human-in-loop; the brain proposes promotion; the CEO grants it; it's monitored and reversible (the graduated-autonomy ladder, §9).
7. **Honest data.** Never render a metric off data we don't have; show "not connected yet" instead.
8. **AAA + safe ops.** Contrast gate is law; OAuth only (no raw keys); md5 file-sync deploy (never `deploy-vps.sh`); demo on the live https URL (never the :3399 proxy).

---

## §3. System architecture

```
                         ┌────────────────────────── Browser (the surfaces) ──────────────────────────┐
                         │ Login · Workbench(role home) · STUDIO(AutoSPRINK) · Calendar · CRM ·         │
                         │ Reports · Vendors · Settings   — one design system, one assistant, one nav   │
                         └───────────────┬───────────────────────────────────────────────┬─────────────┘
                                         │ cookie-session (JWT halofire_session)          │ OAuth (Gmail/Graph)
                ┌────────────────────────▼───────────────────────┐               ┌────────▼─────────┐
                │  Express monolith  apps/autosprink/src/api/     │               │ Vendor / client  │
                │  server.js (REST) + better-sqlite3 halofire.db  │               │ mailboxes        │
                │  - auth/users/roles   - bids/bid_requests/jobs  │               └──────────────────┘
                │  - pricebook/parts    - compliance/evidence     │
                │  - activity_log (telemetry)  - autobid intake/  │
                │    outbound (imapflow/nodemailer + approve gate)│
                └───────┬───────────────────────┬────────────────┘
                        │ OpenGeometry/OpenSCAD  │ local-AI calls
          ┌─────────────▼──────────┐   ┌─────────▼───────────────────────────┐
          │ STUDIO CAD ENGINE      │   │ GX10 (HAL) 192.168.1.76             │
          │ - OpenGeometry kernel  │   │ - local LLM qwen3:30b-a3b (cron+UI) │
          │ - hydraulics engine    │   │ - company Obsidian BRAIN :8790      │
          │ - PDF→model pipeline   │   │ - OpenClaw orchestration            │
          │ - SCAD part generation │   │ - nightly refactor / learning loops │
          └────────────────────────┘   └─────────────────────────────────────┘
                        │ deploy: md5 file-sync → VPS root@187.124.234.28 :3301 (halofire.service), nginx https
```

**Stack:** Express 4 + better-sqlite3 (WAL), bcrypt/jwt, helmet/cors/rate-limit, multer, imapflow/nodemailer, winston · OpenGeometry/OpenSCAD CAD · Three.js viewport · the `--hf-*` AAA token design system · local Qwen + Obsidian brain on GX10 · OpenClaw orchestration.
**Deployment:** single VPS (Hostinger KVM), `halofire.service` node on :3301, nginx at `https://halofire.rankempire.io` (edge TLS via Cloudflare; origin HTTP). Heavy/agentic AI runs on a GX10-class box.

> **AI-backbone status (honest — see `HALOFIRE_AI_BACKBONE_AND_TENANT_PROVISIONING.md`):** the OpenClaw/perception endpoints are real, **env-driven, and fail-soft**, which makes the app **tenant-ready by design** (point `OPENCLAW_BRIDGE_URL`/`HAL_API_URL` + token at the customer's box — no code change). But today they default to a **localhost shim**, the **brain and local LLM are not yet called at runtime**, SAM "vision" is a **deterministic shim**, and image→3D is **down**. These are *honest, claim-gated stubs* — to be converted to real per the Anti-Stub Register, not shipped as "done." Tenant provisioning (`openclaw-halofire/` module runtime) is a correct-but-unadopted prototype.

---

## §4. The global UI shell `[PLATFORM]`

Every surface shares one shell so the product feels like one product (today it does NOT — five hand-rolled navs; this is the fix).

- **Design language:** dark glass on charcoal — body ambient gradient (gold + blue radials over `#0b0d10`); translucent layered panels (`rgba(22,26,32,.72)` + top white-sheen `::before` + 1px hairline `rgba(255,255,255,.08)` + `backdrop-filter:blur(18px)` + inset/elevation shadows); **gold accent `#d9a441`/`#f0bd5a`** (one gold CTA per panel); AAA text. Canonical tokens: §8 / `halofire-tokens.css`.
- **Shared chrome (one component, on every page):**
  - **Top bar:** brand · context (current job/role chip) · Settings · user+role chip.
  - **Nav** (role-aware): the surfaces the role may see, current-page marker, badges. Replaces the 5 navs.
  - **AI Assistant affordance** (✦): dock + inline + inline-action (§8.4.1).
  - **Command palette (⌘K):** one keystroke to any action/function (how the 354-item Studio depth stays clean).
  - **Review Queue** entry point (the one human-in-loop gate, §8.4.3).
- **Status/feedback:** toasts; honest "not connected yet" empties.

---

## §5. Surface-by-surface review (current state → target)

Legend: ✅ real · 🟡 shallow/partial · 🔴 stub/broken · ➕ to build. Current state is grounded in the live audit + IA map + data-layer inspection.

### 5.1 Login `[PLATFORM]` — `index.html`
- **Now:** ✅ real cookie/JWT auth, raymarched fire brand hero. 🔴 lands on **Calendar** (an empty stub) instead of home.
- **Target:** post-login → **Workbench** (role home). Keep the brand hero. OAuth-ready for email scopes later.

### 5.2 Workbench `[PLATFORM]` — `workbench.html` (the role home)
- **Now:** 🟡 Dentrix-style dock; real `/api/bids` wiring + honest placeholders (`_wbdata.js`); 🔴 4 dead rail items (Job Book/Bids/Inspections/Reports), 🔴 inerted dock-customize/search/grips, 🔴 "Approve" disabled everywhere.
- **Target:** **role-based home** — each role lands on its own queue (their pipeline stage). One shared nav, zero dead items. **Reports** rail item → the role's report dashboard (§5.6). Real Approve via the Review Queue. KPIs from real data only.

### 5.3 Studio `[VERTICAL]` — the AutoSPRINK full stack (see §6 — the centerpiece)
- **Approved design:** `mock-studio.html` (now in-repo). The frame: chrome(40) · **20-menu menubar(32)** · toolbar(38) · **left dock** (This Job · Next Actions · Layers · Tools·Design · Properties) · **viewport** (view-tb · orientation cube · scale bar) · **right dock tabs** (Inspector · Layout · Pipe Sched · Hydraulics · Compliance · Submittal) · **command-line statusbar(28)**.
- **Now (`autosprink.html`):** ✅ real OpenGeometry engine, draw/snap/undo, viewcube, 2718-solid model; 🟡 only ~42 of 374 menu items wired; 🔴 **no measure/array/trim/multi-segment/typed-dimension**; ✅ draw-zoom bug fixed (`6607e7b`). Chrome differs from the approved mock.
- **Target:** the approved mock-studio frame married to the **real, deep AutoSPRINK engine** (§6). This is the un-fakeable core.

### 5.4 Calendar `[PLATFORM]` — `calendar.html`
- **Now:** 🔴 Day/Week/Month toggle renders but the grid **never binds events** ("under construction"); approval lane disabled.
- **Target:** bind real job/crew/inspection events from the Job spine; the ITM recurring scheduler feeds it (§6/§9).

### 5.5 CRM `[PLATFORM]` — `crm.html`
- **Now:** ✅ most-functional surface — real Kanban on `/api/bid-requests` (received→…→won/lost), New Client/Bid, Estimate/Render/Draft actions. 🔴 a *different* backend than Workbench's `/api/bids` (the silo).
- **Target:** unify both behind the **Job record** (F2); CRM becomes the pipeline *view* of jobs.

### 5.6 Reports `[PLATFORM]` — ➕ new (`reports.html`)
- **Now:** 🔴 dead rail item; only `/api/analytics/summary` exists (and its `status='Won'` matches 0 rows — silent 0% win-rate).
- **Target:** **role-routed dashboards** (12 roles, §ref reports doc), server-side scoped by access tier; the **owner/dev god-view** = company dashboard + position/employee drill-down + per-employee audit trail. Powered by the `activity_log` telemetry spine (§9).

### 5.7 Vendors `[PLATFORM]` — ➕ new
- **Now:** 🟡 `pricebook` table has 7,208 real rows (ARGCO/FFF/Victaulic) but loaded via a one-shot manual Excel seed; ✅ email engine + parsers exist, unwired to a live loop.
- **Target:** vendor registry + **price-sync via review queue** (email→extract→diff→approve→commit) + part-CAD acquisition (§7).

### 5.8 Settings `[PLATFORM]` — `settings.html`
- **Now:** present, admin-gated, 4th distinct nav variant; parity-gate banner.
- **Target:** onto the shared shell; houses email-OAuth connection, vendor config, role/access admin, the autonomy-ladder grants (CEO), per-user dock profiles.

---

## §6. The AutoSPRINK full stack `[VERTICAL]` / `[PATTERN]` — the un-fakeable core

**This is the part the user will always require, in full, for real.** The platform's job is to *host* it cleanly; the engineering is genuinely built. Target = the `mock-studio.html` UI married to a real engine matching the AutoSPRINK functional bible (`docs/AUTOSPRINK_CLONE_PLAN_V2.md`, `research/autosprink-feature-matrix.md`, `blueprints/05_TOOLS_AND_INTERACTIONS.md`, `06_CALC_ENGINES.md`).

**6.1 The CAD tool set (real depth — current gap is the priority).** Manual: multi-segment polyline draw with live typed **Location-Input** dimensions, ghost previews, per-node context menus; Select/Move/Rotate/Mirror/Copy/Array/Trim with grip handles; a real snap system (endpoint/midpoint/intersection/perpendicular/grid — surfaced visually); Measure + Section. Auto: Remote Area, Automatic Sprinkler Coverage, Auto Branch Lines, Route Pipe, **Smart Pipe** (auto-classify drop/branch/cross-main/riser), Arm-Around (obstruction-aware routing), Easy Drop, Sway Brace, **System Optimizer** (live what-if upsizing), Auto Peak. *Today: single-segment-and-commit, no measure/array/trim/typed-dim — the "sophomoric" gap to close first.*

**6.2 The hydraulic calc engine (real, never stubbed).** Hazen-Williams + Darcy-Weisbach friction; NFPA-13 density×area remote-area method (interactive polygon, two-RA-together, in-rack); per-fitting equivalent lengths (NFPA tables); **Hardy-Cross loop/grid balance**; pump-curve + tank sizing; NFPA-13 rule-check registry. *Today: genuine Hazen-Williams + K-factor + density×area + iterative tree-walk exist; missing Hardy-Cross, fitting equiv-lengths, interactive remote-area, NFPA-8 submittal — build these for real.*

**6.3 PDF → architectural model.** Parse scale from sheet → registration/orientation contract → extract walls/columns/doors/stairs/rooms (per-element verified, vision-checked) → multi-floor reconstruction with vertical alignment → 3D solids/extrusions. *Today: verified walls on one sheet, single-floor; columns/doors/stairs extracted but unwired; no multi-floor — the honest gap.*

**6.4 Data model & interop.** Project bundle (design/systems/remote_areas + corrections/audit JSONL + catalog-lock + SCAD-annotated catalog with ports/K-factor/price/labor). Reporting: Stock Listing (Hydralist), NFPA-8 submittal suite, sheet set, cut-sheet bundle, DXF/IFC/STEP/STL export.

**6.5 The honesty contract.** Until a capability is real + verified, it is badged (the parity badge / "estimated, not stamped" labels in the mock are the correct pattern). Generated geometry/calcs are flagged needs-verification and never presented as AHJ/PE-stamped.

---

## §7. The automation layer `[PLATFORM]` — clerical + autobidding (the part to automate)

The automation boundary: everything here is paperwork/commercial flow, safe to automate behind the human-in-loop gate.

**7.1 Autobidding / intake.** `imapflow` read-only inbox poll → classify bid invitations → create Job/bid_request + attach plan evidence (exists for bids today). Extend: takeoff assist (extract sqft/heads), pricebook-driven estimate draft, proposal/submittal assembly — all as drafts a human approves.

**7.2 Vendor price-sync.** OAuth inbox (Gmail API / Microsoft Graph; iCloud IMAP exception) → parse emailed price books (reuse `pricebook-importer` per-vendor XLSX readers; Qwen for messy PDFs) → **diff vs current pricebook** → Review Queue → approve → commit + `price_history`. Durable upgrade: EDI-832/punchout per distributor. Avoid: portal login-scraping (ToS/brittle). *Untrusted email content NEVER auto-commits.*

**7.3 Outbound comms.** `nodemailer` SMTP with a **hard admin-approve gate** (`/api/outbound-drafts/:id/approve` is the only send path) — reused for vendor RFQs and bid sends. Every outbound message is per-message human-approved.

**7.4 Part-CAD acquisition.** Per-SKU waterfall: manufacturer Revit/CAD libraries → TraceParts API → parametric SCAD generation from datasheet dims (`parts_models`, flag-don't-gate) → `part_overrides` for licensed authoritative models. Bottleneck = extracting dimensions from cut sheets.

---

## §8. The design system `[PLATFORM]`

**8.1 Tokens (AAA, the source of truth).** `--hf-*` in `halofire-tokens.css` (typed `apps/studio/src/lib/tokens.ts`, contrast-gate test). Surfaces charcoal `#0e1318`→raised; ember accent `#f0a868`/gold `#d9a441` family; interactive blue `#3b82f6`; semantic success/warn/danger; Inter + JetBrains Mono (tabular numerals); 4px space scale; radii 4/6/10/14/pill; elevation sm/md/lg; motion 80–360ms. Glass = the elevation treatment atop tokens. *Gotcha: re-assert glass surfaces in a `<style>` AFTER the tokens link (it re-points legacy vars).*

**8.2 Component kit (small + opinionated).** Button (primary/secondary/ghost/danger — disabled must look disabled), Field, Card/Panel (flat/raised/glass), Table/List (dense, mono numerals), Status pill, Modal/Drawer, **Nav rail (one shared)**, Toast, **AI Assistant**, **Review Queue**, Empty/"not connected yet". Adding a component requires a reason (the 5-nav mess came from one-off chrome).

**8.3 Studio chrome components `[VERTICAL]`.** Menubar (full-width single row, dropdowns escape via overlay z-index), tool buttons (active/toggle states), dockable panel (grip header + collapse), tab-well, recessed well, layers list, orientation cube, scale bar, command-line — all defined in `mock-studio.html`.

**8.4 Patterns.** (1) **AI Assistant** — dock/inline/inline-action, grounded, brief, flags uncertainty. (2) **Minimal-input AI-assisted forms** — one or two real inputs → AI draft → confirm. (3) **Review Queue** — propose→diff→approve/reject→commit, the single gate for every AI side-effect. (4) **Progressive disclosure + ⌘K** — depth without clutter.

---

## §9. The adaptive AI layer `[PLATFORM]`

Built on the **telemetry spine**: `activity_log` (every login, change, navigation, AI interaction) feeds the **company Obsidian brain** (GX10 :8790), which drives three loops:
1. **UI/UX adaptation** — promote used functions, demote/flag unused, fix repeated stalls (per-user + per-role).
2. **Nightly refactor loop** — local-Qwen cron reads telemetry+brain+issues → proposes code fixes + function add/remove → **Review Queue** (never silent prod mutation; verified by the gate suite).
3. **Graduated-autonomy ladder** — every automatable task: rung 0 manual → 1 AI-assisted → 2 human-in-loop (review queue) → 3 auto+notify → 4 full-auto. A **trust ledger** tracks approvals; when a rung-2 task is reliably unchanged (e.g. "ARGCO 47/47 approved unchanged 3mo"), the brain surfaces a **CEO "ready to automate"** recommendation on the CEO dashboard. CEO grants; monitored + auto-demoted if corrections spike. **Vendor email/price-sync sits at rung 2 now.** Automation never graduates without the CEO's explicit grant.

---

## §10. Data model & API (grounded in `server.js` / `halofire.db`)

**Core tables today:** `users`(role) · `auth_tokens` · `bids`(created_by) · `projects` · `pricebook` · `compliance` · `estimates`(created_by) · **`activity_log`** (exists, unwired) · `project_evidence` · `claim_gates` · `parts_models`/`part_overrides` · `clients` · `bid_requests`(status_history) · autobid intake/outbound config + logs · cutsheet tables.

**Foundation additions (the spine):**
- Users: `position`, `department`, `access_tier`, `manager_id`.
- **Job/Building entity** unifying `bids` + `bid_requests` + ownership (`created_by`/`assigned_to`) + a Studio design ref + calendar/inspection/invoice state + asset register.
- Wire `activity_log` (login + mutation events + `updated_by`); add `vendors`, `price_updates`, `price_history`; status-canonicalization layer.

**API style:** REST under `/api/*`, cookie-session auth, `requireRole`→extend to `requireAccess(tier,scope)`; reports under `/api/reports/:scope` server-side-scoped.

---

## §11. The reusable template — instantiating for another company `[PLATFORM]`

To stand up this product for a different company/vertical, **keep all `[PLATFORM]` parts and swap the `[VERTICAL]` parts:**

| Keep (`[PLATFORM]`) | Swap per company (`[VERTICAL]`) |
|---|---|
| Job/entity-centric spine; ownership; status pipeline | The entity's lifecycle stages + the entity name |
| Role/access-tier model + role-based homes | The **org/role catalog** (research the industry's positions) |
| Reports framework + god-view drill-down | The **per-role KPI set** (research the industry's metrics) |
| Vendor registry + price-sync review-queue loop | The **supply chain** (manufacturers/distributors, price channels) |
| Email engine + approval gate + autobidding intake | The intake classifier + the bid/quote format |
| The design system (tokens/kit/patterns) | Brand accent + hero; optional vertical chrome |
| The adaptive brain + autonomy ladder + telemetry | — (fully reusable) |
| The "embed a real un-fakeable domain engine" **`[PATTERN]`** | The **domain engine itself** (here AutoSPRINK; elsewhere the trade's core pro tool) |
| Honesty contract (badge estimated/unverified) | The domain's certification gates (here AHJ/PE/NFPA) |

**The instantiation playbook:** (1) research the vertical's org chart + KPIs + supply chain + the "hard core" pro tool; (2) reuse the platform spine/design-system/brain; (3) build or integrate the real domain engine (never fake it); (4) configure roles/reports/vendors; (5) wire telemetry day one so the brain starts learning; (6) start every automation at human-in-loop and let the ladder earn its way up.

---

## §12. Roadmap

Sequenced build in [HALOFIRE_MASTER_ROADMAP.md](HALOFIRE_MASTER_ROADMAP.md): Wave 0 (draw-fix ✅) → Wave 1 foundation (F1–F6, build once) → Wave 2 first value (reports/vendor/ops) → Wave 3 depth (**Studio CAD depth**/pipeline/reports-access) → Wave 4 hard engineering + annuity (PDF→model/hydraulics/ITM) → Wave 5 adaptive + earned automation. The AutoSPRINK engineering track runs **in parallel** with the operations track once the foundation exists.

---

## §13. Source docs & glossary

**Companion specs (this doc is the index):** OPS_FLOW_OPTIMIZATION · REPORTS_AND_ANALYTICS · VENDOR_PRICESYNC_AND_PART_CAD · AUDIT_AND_ROADMAP · DESIGN_SYSTEM_AND_ADAPTIVE_AI · MASTER_ROADMAP · **AI_BACKBONE_AND_TENANT_PROVISIONING** (the OpenClaw wiring, anti-stub register, and per-customer GX10 provisioning) (all in `halofire-studio/docs/`). AutoSPRINK bible: `docs/AUTOSPRINK_CLONE_PLAN_V2.md`, `research/autosprink-feature-matrix.md`, `blueprints/0x_*.md`.

**Glossary:** **AHJ** Authority Having Jurisdiction · **ITM** Inspection/Testing/Maintenance (NFPA-25) · **NFPA-13** sprinkler design standard · **Remote area** hydraulically most-demanding design area · **Smart Pipe** auto pipe-role classification · **Review Queue** the human-in-loop approval gate · **Autonomy ladder** the earned-automation progression · **Job spine** the unifying entity record · **`[PLATFORM]`/`[VERTICAL]`/`[PATTERN]`** the template tags.

**Change log:** 2026-06-13 — initial canonical spec; pulled `mock-studio.html` into repo; draw-zoom bug fixed (`6607e7b`).

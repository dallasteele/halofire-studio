# HaloFire — Operational Flow Optimization

**Date:** 2026-06-13
**Scope:** How a fire-sprinkler company actually operates vs. how the HaloFire app currently flows — and the changes that relieve bottlenecks, cut clicks-to-feature, and make the software make sense for the humans using it.
**Method:** Web research on fire-sprinkler company operations + the contractor software landscape (ServiceTrade, Inspect Point, BuildOps, BuildingReports, SprinkCAD/AutoSPRINK, STACK, FOUNDATION) cross-referenced against an evidence-based IA/click-path map of the current HaloFire app.
**Companion docs:** `HALOFIRE_AUDIT_AND_ROADMAP.md` (CAD/engineering depth). This doc is the **operational/UX-flow** half — they are complementary, not overlapping.

---

## 0. The one-sentence finding

> **The app was built screen-by-screen, but a fire-sprinkler company runs job-by-job and building-by-building.** Until there is a single **Job / Building record** that the bid, the design, the schedule, the inspection, the deficiency, and the invoice all hang off of, every screen will keep re-keying data and every user will keep getting lost.

Second finding, nearly as large: **the recurring-service (ITM / NFPA 25) business is entirely missing** — and that's the high-margin annuity that the install exists to win.

---

## 1. How a fire-sprinkler company actually flows

A sprinkler contractor runs **two linked businesses on the same buildings**:

**A) Project / construction (one-time):**
`Lead / ITB → Estimate & Bid (takeoff + pricebook) → Award → Submittal → Design (NFPA 13 layout + hydraulic calc, stamped) → AHJ permit → Procurement / Fabrication (spools, BOM) → Install / crew schedule → Rough-in → Hydro test + AHJ inspections → Closeout / as-builts → AIA progress billing + retention`

**B) Recurring service — ITM per NFPA 25 (the annuity, high margin):**
`Asset register per building → mixed-cadence inspections (weekly/monthly/quarterly/annual) auto-scheduled → tech inspects (mobile, offline, scan each device) → deficiency found → quote → approved → repair work order → invoice → next inspection auto-scheduled`

**The money insight from the research:** the install *wins the building*; the NFPA 25 service contract + the **deficiency→repair pull-through** is where margin compounds year after year. The competitive tools say this explicitly — the goal is "record more deficiencies and send more repair quotes," and the canonical money pattern is a **one-click deficiency → proposal → work-order → invoice** loop so findings never fall through the cracks.

**The unmet market need (HaloFire's wedge):** *no incumbent unifies estimating → design → project → ITM service → billing.* Contractors stitch 2–4 tools (e.g. STACK for takeoff + AutoSPRINK for design + ServiceTrade for service + FOUNDATION for billing) and **pay a re-key tax at every seam.** HaloFire is uniquely positioned to join the **CAD/design side (model → BOM → asset register)** to the **service side (assets → inspections → deficiencies → repairs)** — which none of them do well.

*(Roles per stage: estimator, designer/engineer-of-record, permit coordinator, PM, purchasing, dispatcher, field foreman/installer, service technician, billing admin. Each needs its own home queue — see §4.)*

---

## 2. How the HaloFire app flows today (current state)

Evidence-based map of `halofire-studio/apps/autosprink/`:

| Screen | State | Flow problem |
|---|---|---|
| **Login** (`index.html`) | Real auth | Lands on **Calendar** (`index.html:1220`) — an "under construction" empty grid. **Home isn't home.** |
| **Workbench** (`workbench.html`) | Mixed | Primary left rail wires only **5 of 8** items (`:745`) — **Job Book, Bids, Inspections, Reports are dead** (badges, no destination). 3 of 6 dashboard cards are "no source connected." Dock/search/grips inerted "Coming soon." |
| **Studio** (`autosprink.html`) | Real CAD engine | Project picker is a **hard-coded 2-item `<select>`** (`:259`). **No way to open an arbitrary job in the Studio.** No nav back to Home except a small header link — it's an island. |
| **Calendar** (`calendar.html`) | Stub | Grid **never binds events** — banner says "under construction (CAL-1)." Approve buttons disabled. |
| **CRM** (`crm.html`) | Most functional | Real Kanban on `/api/bid-requests` — but that store is a **different backend** than Workbench's `/api/bids`. |
| **Settings** (`settings.html`) | Present | 4th distinct nav variant. |

### The three structural defects

1. **Not job-centric — siloed.** There is **no Job/Project entity.** Two incompatible bid backends (`/api/bids` real-but-read-only vs `/api/bid-requests` the CRM's empty workflow store) — a bid in one is invisible to the other. Studio has no concept of a job. CRM "Render bid" never produces a CAD design. Calendar events aren't tied to jobs. **No invoice screen exists at all.**
2. **Five hand-rolled navs, no shared component.** Gold rail (Workbench) vs fire-red top bar (Calendar) vs Studio header vs CRM bar vs Settings bar — different link sets, themes, and even different cache-bust wiring (`?hf=r2` on some, bare links on others). This *is* the user's "lack of nav on pages" + "links take me to the old version."
3. **The entire ITM / service business is absent.** No asset register, no recurring scheduling, no deficiency loop, no work orders, no service invoices. The highest-margin half of the company has no software.

---

## 3. Bottlenecks & click-waste (ranked) — industry pain ∩ current-app evidence

| # | Bottleneck (industry) | How it shows up in HaloFire today | Fix |
|---|---|---|---|
| 1 | **Re-keying takeoff→estimate→job→procurement→billing** | Two disconnected bid stores; no job spine; data retyped at every screen | One **Job record** as the data spine |
| 2 | **Paper deficiencies that never become quotes** (direct lost margin) | No deficiency/service module exists | **One-click deficiency→quote→WO→invoice** loop |
| 3 | **Manual NFPA 25 recurring scheduling** | No asset register, no recurring scheduler | **Auto-schedule from asset register** by cadence |
| 4 | **Losing AHJ permit/submittal status** (38 states of AHJs) | No permit tracking anywhere | **Permit as a visible pipeline stage** on the job |
| 5 | **Estimators hunting pricebooks / wrong head counts** | Takeoff/pricebook not in app | Centralized pricebook + assisted takeoff |
| 6 | **Design→fab BOM retyped** | Studio model not bound to a job/BOM | **Model is source of truth → BOM/spools auto-generated** |
| 7 | **Disconnected AIA progress billing + retention** | No invoice screen | Billing tied to the job's schedule-of-values + field % |
| 8 | **Home isn't home / dead nav** | Login→empty Calendar; 4 dead rail items; approve disabled everywhere | Land on role home; one wired nav |

### Click-path waste measured today (from Workbench home)

| Task | Today | Target |
|---|---|---|
| Review/**approve** a bid | View=1, **approve=∞ (disabled everywhere)** | 2 clicks, working |
| Open CAD Studio **on a specific job** | **No path** (hard-coded 2-job dropdown) | 1 click from the job record |
| See today's crew schedule | 1 → **dead-end empty calendar** | 1 click, populated |
| Add a CRM contact | 3 (works) | keep |
| File a deficiency → send repair quote | **Impossible (no module)** | 1 click from inspection |

---

## 4. Future state — design the app around the Job/Building, not the screen

### 4.1 The spine: a Job / Building record
One entity that unifies `/api/bids` + `/api/bid-requests` and carries, as tabs/stages on **one record**:
`Overview · Estimate/Bid · Design (opens THIS job in Studio) · Permit/AHJ status · Schedule · Install/Inspections · Deficiencies · Invoices · Documents/as-builts`
Plus the building's **Asset register** (every device) once installed → feeds ITM.

This single change kills bottlenecks #1, #4, #6, #7 and the "open this job in Studio" dead-end at once: the Studio's hard-coded picker (`autosprink.html:259`) becomes "the job you came from."

### 4.2 One shared nav + role-based home
- **One persistent nav component** (centralize in `public/halofire-auth.js`, replacing the 5 hand-rolled variants) with a current-page indicator and consistent `?hf=r2`.
- **Post-login lands on the Workbench** (`index.html:1220`), not the empty calendar.
- **Role homes** — estimator/designer/PM/dispatcher/tech/billing each land on their own queue (their stage of the pipeline), not a generic dashboard. Remove or wire the 4 dead rail items.

### 4.3 The two money loops, built into the product
- **Project pipeline** as a visible status board (Lead→Bid→Award→Design→Permit→Fab→Install→Inspect→Close→Bill) — permit/submittal becomes a *tracked stage*, not a lost email.
- **ITM service loop** (new module): asset register → cadence auto-scheduler ("due now" surfaced) → **offline mobile tech flow** (scan device, photo, e-sign) → **one-click deficiency→quote→work-order→invoice.** This is the annuity the app is currently missing entirely.

### 4.4 Borrowed UX primitives (proven in the market)
Dispatch board · job-centric record · one-click deficiency loop · recurring auto-scheduling · barcode/NFC asset scan · offline-first mobile w/ photo/e-sign/pay · NFPA-template forms (not generic builders) · model-generated fabrication · status pipelines · role homes.

---

## 5. Before / after, and the implementation plan

**Before:** 5 disconnected screens, no job, home is an empty stub, 4 dead nav items, approve disabled everywhere, the entire high-margin ITM business absent.
**After:** every screen is a facet of one Job/Building record; one nav; role homes; both money loops (project pipeline + ITM deficiency loop) live in the product.

### Phased plan (sequenced so each phase ships value)

- **P0 — Stop the bleeding (S):** post-login → Workbench; collapse the 5 navs into one shared component with current-page state + consistent cache-bust; wire or remove the 4 dead rail items; make "Approve" actually work in one place. *Relieves: home-isn't-home, dead nav, broken approve.*
- **P1 — The Job spine (L):** introduce the Job/Building entity; unify `/api/bids` + `/api/bid-requests` behind it; every screen reads/writes the job; **"Open this job in Studio"** replaces the hard-coded picker. *Relieves bottleneck #1, #6, the Studio island.*
- **P2 — Project pipeline + permit tracking (M):** the lifecycle status board; permit/AHJ as a tracked stage; schedule + inspections bound to the job; populate the calendar. *Relieves #4, dead calendar.*
- **P3 — ITM service module (XL, the annuity):** asset register → recurring NFPA 25 scheduler → offline mobile tech flow → one-click deficiency→quote→WO→invoice. *Relieves #2, #3; opens the recurring-revenue business.*
- **P4 — Billing (M):** job schedule-of-values → AIA progress billing + retention, tied to field % complete. *Relieves #7.*

### Impact (directional)
- Clicks-to-approve: ∞ (broken) → 2. Open-job-in-Studio: impossible → 1. Deficiency→quote: impossible → 1.
- Eliminates the re-key tax at 4 seams (bid↔job↔design↔billing).
- Unlocks the missing high-margin ITM annuity + repair pull-through.

---

## 6. Sources (research)
Industry process & standards: NFSA "Understanding NFPA 25," NFPA 13 obstruction/spacing explainers, NorthStar NFPA 13 guidelines, Autodesk ITB & G702/G703 billing. Software landscape & UX patterns: Inspect Point (deficiency→WO→invoice, comparison), ServiceTrade (asset-centric, scheduling, roundup), BuildOps (dispatch, field app), BuildingReports (scan-to-verify), SprinkCAD / AutoSPRINK RVT (model→BOM), STACK/PataBid (takeoff), Projul/FOUNDATION (AIA billing). Current-state evidence: file:line citations throughout `halofire-studio/apps/autosprink/`.
*Vendor blogs are self-promotional; competitor "weaknesses" are directional. NFPA 13/25 standards are authoritative over any blog.*

# HaloFire — Role-Based Reports & Analytics

**Date:** 2026-06-13
**Goal:** The Workbench is each employee's home on login. The **Reports** button must resolve to a *different* report dashboard per **position + access rights**: the CEO sees the company; the estimator sees their bid performance; the designer sees their queue and AHJ rejections; the service tech sees their own numbers. The **dev/owner (you)** sees the CEO company dashboard **plus** the ability to open any position's dashboard and drill to any individual employee. Everything rests on a **full audit trail per employee** (all logins, all changes) that becomes the analytics dataset.
**Grounding:** Role/KPI research (ServiceTrade, Inspect Point, BuildOps, construction-finance WIP/AIA, OSHA safety) + a file:line inspection of the real data layer (`apps/autosprink/src/api/server.js`, `data/halofire.db`).
**Companion docs:** `HALOFIRE_OPS_FLOW_OPTIMIZATION.md` (role-based home + job spine), `HALOFIRE_AUDIT_AND_ROADMAP.md` (CAD/engineering).

---

## 0. The honest starting point (what exists vs what's needed)

| Capability | Today (evidence) | Needed for real reports |
|---|---|---|
| **Audit trail** | `activity_log` table has the right shape (`server.js:221`) but is **dead** — 0 writes, 0 reads, 0 rows. No login events, no `updated_by` on any table. | Wire a `recordActivity()` helper on every login/logout + mutating route; add `updated_by`. |
| **Per-employee attribution** | `bids.created_by`/`estimates.created_by` exist but **all 2,413 bids = created_by 1** (bulk import). `projects`/`clients`/`bid_requests` have **no owner/assignee**. | Capture real `created_by`/`assigned_to`/`owner` on new records going forward; add owner columns. |
| **Roles / positions** | `users.role` = 2 values (`admin`/`user`), **1 user** (`server.js:540`). | A `position` + `department` + access-tier model on users. |
| **Report-able data** | 2,413 real `bids` (value/date/contractor/status). `/api/analytics/summary` exists (`server.js:899`). | **Status canonicalization** — `status='Won'` matches 0 rows; real win status is `'Awarded'`; status is dirty free-text (`Bidding`/`BIdding`/`bidding`). |
| **Service/ITM, WIP, financials, design metrics** | No data source exists (service module absent; `projects`/`estimates`/`compliance` ~empty). | New capture as those modules land (see ops-flow doc). |

> **Design rule:** never render a report off data we don't really have. Each widget below is tagged **[NOW]** (computable today after status-canon), **[ATTR]** (needs per-employee ownership going forward), or **[MODULE]** (needs a new data source). A report page shows live widgets for what's real and an honest "not connected yet" state for the rest — same discipline as `_wbdata.js` today.

---

## 1. The data foundation (build this first — reports are a view on top)

### 1.1 Extend the user model (positions + access tier)
Add to `users`: `position` (enum, see §2), `department` (executive/finance/estimating/design/pm/fab/field/service/safety/hr), `access_tier` (see §3), `manager_id` (for "their team" scoping), `active`.

### 1.2 Per-entity ownership
Add `created_by` (where missing) + `assigned_to`/`owner_id` to `bids`, `bid_requests`, `projects`, and the future service/work-order/inspection tables. **Backfilled history stays attributed to the import**; real attribution begins now. Reports that slice "by employee" only count attributed records and say so.

### 1.3 The audit / event spine (the analytics dataset)
Wire the existing `activity_log` (`server.js:221`) via one helper called on:
- **Auth events:** login (success/fail), logout, password reset, invite accepted — `/api/auth/*` currently record nothing.
- **Mutations:** every POST/PUT/DELETE on bids/bid-requests/projects/clients/estimates/pricebook/compliance — capture `user_id, action (create/update/delete/transition), entity_type, entity_id, details (JSON before/after diff), created_at`. Add `updated_by` to mutated rows.
- **Navigation/usage (optional, high-value):** page views + report opens, so "how is each employee using the system" is itself analyzable.

This one table, properly fed, is the source for: per-employee activity feed, login history, change history per record, and usage analytics — exactly the "lots of data to analyze" the requirement calls for.

### 1.4 Status canonicalization layer
A normalize map (`Awarded→won`, `Not Awarded→lost`, `Bidding/BIdding/bidding→bidding`, `Duplicate→excluded`, `needs_amount_review→pending`) applied in the query layer. Fixes the silent 0% win-rate bug and makes every bid metric trustworthy.

---

## 2. The report pages, per position (the catalog)

Each position lands on its own report dashboard. Widgets are concrete; tags show data readiness. Formulas and benchmarks are in the role-KPI research (cited there).

### 2.1 CEO / Owner — **the company dashboard** (also the Dev god-view, §4)
1. Revenue: **project vs recurring-service split** [MODULE] · 2. Backlog & backlog ratio [MODULE] · 3. Gross margin by division [MODULE] · 4. **Bid win rate** + pipeline value **[NOW]** · 5. Cash / AR aging summary [MODULE] · 6. WIP over/under-billing (portfolio) [MODULE] · 7. Recurring-service contract value (ARR) + renewal rate [MODULE] · 8. Safety incident rate (TRIR/EMR) [MODULE].
*Today this page is real for win-rate/pipeline/bid-volume off 2,413 bids; the financial/service tiles show "module not connected yet" until those modules land.*

### 2.2 CFO / Controller — Finance
WIP report · over/under billing · AR aging (current/30/60/90+) · retention receivable (separate ledger) · AP aging + cash-flow forecast · job-cost variance (est vs actual) · billing-vs-cost %-complete · DSO. **All [MODULE]** (needs job-cost + billing).

### 2.3 Chief Estimator / Estimator
1. **Bid win rate / hit ratio** — overall, by GC, by job type **[NOW]** · 2. Bid volume + $ bid vs won **[NOW]** · 3. Bids pending / due (with due dates) **[NOW]** · 4. Average bid value **[NOW]** · 5. Lead→estimate conversion [ATTR] · 6. Estimate accuracy (bid vs actual cost) [MODULE] · 7. Turnaround time [ATTR]. *Estimator self-view (their own bids) needs [ATTR]; the team view is [NOW] in aggregate.*

### 2.4 Design Manager / Sprinkler Designer
Designs in queue + due dates [MODULE] · design hours per job (actual vs budget) [MODULE] · **AHJ/plan-review rejection rate + reasons** [MODULE] · revisions/resubmittals per job [MODULE] · on-time design delivery [MODULE] · hydraulic-calc first-pass rate [MODULE]. *(Ties to the `compliance` table once design jobs flow through it.)*

### 2.5 Project Manager
Job cost vs budget [MODULE] · schedule variance / SPI [MODULE] · % complete [MODULE] · change orders (count/value/%) [MODULE] · RFI/submittal status [MODULE] · labor productivity (hrs vs estimate) [MODULE] · permit/inspection status (ties to `compliance`) [MODULE] · over/under billing on their jobs [MODULE].

### 2.6 Service / ITM Manager (the annuity)
**NFPA 25 compliance %** (inspections done vs due) [MODULE] · deficiencies found / capture rate [MODULE] · **deficiency→quote conversion** [MODULE] · quote→sold rate [MODULE] · service-agreement renewal rate [MODULE] · technician utilization [MODULE] · **revenue per technician** [MODULE]. *(Entirely new — gated on the service module from the ops-flow doc.)*

### 2.7 Service Coordinator / Dispatcher
Today's board · overdue inspections · unassigned work orders · tech availability/route · time-to-schedule · done-not-invoiced. **[MODULE]** — sees the whole board, **not** financials/margins.

### 2.8 Service Technician / Inspector — **self view**
My inspections today/this week · my deficiency capture rate · my first-time-fix · my utilization · my callbacks · my work-order completion time. **[MODULE + self-scoped]**.

### 2.9 Field Superintendent / Foreman
Crew/job productivity (units per labor hour) · labor hours vs estimate · install progress vs schedule · manpower allocation · safety/incidents · rework rate. **[MODULE]** — super sees their jobs; foreman sees their crew; **hours/productivity, not dollar margin** (§3).

### 2.10 AR / AP / Billing
Invoices outstanding · AR aging buckets · retention receivable · collections/DSO · unbilled WIP · AIA pay-app status. **[MODULE]**.

### 2.11 Safety / QA
TRIR · DART · EMR · near-misses/leading indicators · OSHA 300/300A log · install QA pass rate. **[MODULE]**.

### 2.12 HR
Turnover rate · open reqs/time-to-fill · **license/certification expirations** (NICET, apprentice hours, state licenses — critical at 38 states) · training completion · headcount by division · revenue per employee. **[MODULE + partial from users table]**.

---

## 3. Access / visibility model (RBAC tiers)

| Tier | Positions | Sees |
|---|---|---|
| **Company** | CEO/Owner, VP Ops, CFO/Controller, **Dev** | Everything: financials, margins, all divisions, **all employees' performance**, WIP, AR/AP. |
| **Division** | Division Mgr, Service/ITM Mgr, Chief Estimator, Design Mgr, Fab Mgr | Their division's P&L, jobs, **their team's** performance, pipeline — not other divisions' margins or company financials. |
| **Team / multi-job** | Superintendent, PM | Their jobs' cost/labor/schedule/safety + aggregate crew performance. PM sees job margin; super sees hours/productivity, **not full margin**. |
| **Self** | Foreman, Fitter, Tech/Inspector, Dispatcher, Estimator | Their own jobs/work-orders/hours/personal metrics. Dispatcher sees the whole board but no financials. |
| **Function-scoped** | AR/AP/Billing, HR, Safety | Their function's data only (finance ≠ design detail; HR sees personnel not margins). |

**Sensitive — enforce field-level hiding, not just page hiding:**
- **Margins / job-cost / bid markup / estimate-vs-actual** → management only. Field/IC see *hours vs budget*, never *dollar margin* (column-level hide so a PM/foreman can open a job without seeing markup).
- **Other employees' scorecards** → visible to that person + their manager up the chain; **peers never see each other's numbers**.
- **Company financials / AR / cash / EBITDA / bonding** → exec + finance only.
- **Comp / OSHA injury PII / EMR drivers** → HR/Safety/exec only.

Enforcement extends the existing `requireRole` (`server.js:540`) into a `requireAccess(tier, scope)` middleware; every report query is scoped server-side by the caller's tier + `manager_id` subtree — **the client never receives data it isn't entitled to** (don't filter in the browser).

---

## 4. The Dev / Owner god-view

You (dev) and the CEO share the **Company** tier. The Reports home for that tier adds a **scope switcher** above the dashboard:
- **Company** (default) — the whole-company dashboard (§2.1).
- **By position** — pick any position → see *that role's* report dashboard exactly as that role sees it (e.g. open the Estimator dashboard, the Service-Manager dashboard).
- **By employee** — pick any individual → their personal scorecard + their **activity/audit trail** (logins, changes, usage) from `activity_log`.

This is a single Reports surface with a tier-gated scope selector — IC roles simply don't see the selector (they're locked to self).

---

## 5. Wiring to the Workbench

- The dead **Reports** rail item (one of the 4 unwired items, `workbench.html:745`) routes to `reports.html` (or a Reports view) that **renders the dashboard for `auth/me`.position/access_tier**.
- Reuse the honest-placeholder pattern from `_wbdata.js` for [MODULE]/[ATTR] widgets.
- Reports query a new `/api/reports/:scope` family, server-side-scoped by tier (§3); the god-view scope switcher (§4) passes `?position=` / `?employee=` only for Company-tier callers.

---

## 6. Phased build

- **R0 — Data foundation (must precede real reports):** positions/department/access_tier + manager_id on users; ownership columns; **wire `activity_log`** (login + mutation events + `updated_by`); status-canon layer. *Without this, every report is fake.*
- **R1 — Bid/estimating reports [NOW]:** Estimator + the win-rate/pipeline half of the CEO dashboard off the 2,413 real bids (post-canon). First real, trustworthy reports.
- **R2 — Access model + god-view:** `requireAccess` middleware, role-routed `reports.html`, the Company-tier scope switcher (position/employee drill) + per-employee audit-trail view.
- **R3 — PM/Design/Finance reports:** as the job spine + job-cost + `compliance` flow populates (ops-flow P1–P2).
- **R4 — Service/ITM + Safety/HR reports:** as those modules land (ops-flow P3).

**Impact:** turns the dead Reports button into a per-role decision surface; turns the dead `activity_log` into a full per-employee audit + usage dataset; gives the owner a true company dashboard with position/employee drill-down — all without ever showing a number we can't stand behind.

---

## 7. Sources
Role/KPI research with formulas + benchmarks: ServiceTrade KPI guides, Inspect Point ITM, BuildOps estimating, Projul construction-KPI guide, WIP/AIA (MarginLock, JMCO, Construction Cost Accounting), OSHA TRIR/DART/EMR (PlanHub, Creative Safety Supply, Highwire), NFSA NFPA 25, role descriptions (CS-Recruiters, ESUB, AIAS). RBAC patterns: Microsoft Dynamics Field Service security, Salesforce FSL licensing. Data-layer evidence: `apps/autosprink/src/api/server.js`, `data/halofire.db` (file:line throughout).

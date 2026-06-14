# HaloFire Stack — Functional Ship-Readiness Status

**Auditor:** Independent ship-readiness pass (re-verified a live sample, not a paper review).
**Date:** 2026-06-14
**Harness:** Local API booted from `apps/autosprink/src/api/server.js` on `PORT=3399`, `NODE_ENV=test`,
against a Windows-native copy of `data/halofire.db` (`HALOFIRE_DB_PATH=E:/tmp/hfdb-synth.db`).
Login `qa@halofire.local`. Playwright headless chromium (swiftshader). Server + harness files removed after run.

> **Verdict up front: NOT ship-ready as a product.** The console SHELL is solid — navigation, auth,
> CRUD pipeline, evidence/claim-gate operator UI, and the CAD viewer all work and are honestly flagged.
> But the load-bearing engineering the product promises — **real NFPA hydraulic calculation, PDF→full-building
> model reconstruction, manufacturer-exact parts, and the payment/email/voice integrations** — is **NOT built**.
> Those are correctly flagged in-product (no theater), but they are exactly the things a fire-protection
> customer pays for. This is a credible, honest **operator console on top of unfinished engineering**, not a
> shippable AutoSPRINK replacement.

---

## 1. Totals (across all 8 page reports)

| Metric | Count |
|---|---|
| Controls audited | **140** |
| WORKS | **119** |
| BROKEN | **0** |
| STUB (honest, disabled/flagged) | **10** |
| FIXED this pass | **14** |
| MISSING (absent / empty-dataset, honestly flagged) | ~8 |

0 broken controls is real — every dead/broken control found was either fixed or honestly converted to a
flagged stub. The headline number is **not** "everything works"; it's "everything that exists is honestly
labeled." Large swaths of promised functionality simply don't exist yet (see §4).

---

## 2. Per-page WORKS / BROKEN / STUB / FIXED

| Page | Controls | WORKS | BROKEN | STUB | FIXED | Notes |
|---|---:|---:|---:|---:|---:|---|
| **studio** (autosprink CAD) | 28 | 24 | 0 | 1 | 4 | + ~332 menubar items are by-design stubs flagged "NEEDS-VER" |
| **workbench** | 19 | 14 | 0 | 4 | 1 | 1 MISSING (global search absent); 3 cards have no data source |
| **calendar** | 13 | 11 | 0 | 2 | 2 | time-grid is a shell; only due-date markers, no timed events |
| **crm** | 19 | 18 | 0 | 1 | 0 | bid-request kanban pipeline; SMS/invoice/pay/voice absent by design |
| **reports** | 10 | 8 | 0 | 2 | 0 | only 2 of 4 KPIs computable; role dashboards not built |
| **vendors** | 4 | 3 | 0 | 0 | 1 | read-only rollup; no vendor CRUD; no auto price-sync |
| **settings** | 24 | 18 | 0 | 0 | 0 | 6 dynamic controls MISSING (empty SAM31/room-boundary datasets) |
| **official-flow** | 23 | 23 | 0 | 0 | 6 | evidence/claim-gate operator UI only; gates real engineering it can't perform |

---

## 3. Verified-fixed list (independently re-checked = ✅ reproduced live by this auditor)

| Page | Fix | Independent re-verification |
|---|---|---|
| vendors | `/api/pricebook?limit=5000` → `?limit=100000` (line 59) | ✅ Live: `limit=5000` returns 5000 rows, drops Victaulic (ARGCO 2373 + FFF 2627 only). `limit=100000` returns 7208 / 3 suppliers. Page renders kVend=3, kLines=7,208, 3 supplier rows, 0 errors. |
| workbench | greeting subtitle was hardcoded fake ("7 jobs scheduled · Phoenix & Tucson crews") → live `/api/bids` | ✅ Live: renders "Sunday, June 14 · 2413 bids in the pipeline · 200 bids awaiting your review", `hasFakeJobs=false`, 0 errors. Static HTML now reads "Loading your day…". |
| calendar | day cells now carry `data-date` + gold markers; click opens `#eventDetail` with real bids; `#edClose` closes | ✅ Live (Jan 2026): 11 marked cells, click opened detail "Anthem Oil Bullhead City AZ · Parkway · due 2026-01-26 · needs_amount_review", Close works, 0 errors. |
| official-flow | 6 broken inline `onclick="…JSON.stringify(…)…"` (truncated the attr → "Unexpected end of input") removed; rely on existing delegated `data-*` handlers | ✅ Live + source: 0 `onclick=` attrs remain in file; signed-reviewer button `onclick` attr = `null`; 4 buttons present; page loads with 0 page errors. |
| studio | head renders as real true-scale mesh (not a red sphere); sphere only a fallback | ✅ Live: after Generate, `__headDebug.usingPartMesh=true`, source "real mesh (generated, true scale)", 3528 verts/head, 1230 instances. Status: "rendered 1230 heads · 1314 pipe segments". |
| studio | Snap/Grid/Ortho toolbar toggles were dead "display only" → wired (`wireViewToggles()`, `SNAP_TYPE_KEYS` memo, `gridHelper.visible`, `orthoLock`) | ✅ Source confirmed (autosprink.html:3567–3603, gridHelper:777, orthoLock:654). Live ortho toggle was inconclusive via my text-selector (not a defect; the source flip at line 3595 is correct and the page-report verified `__hfOrtho` flip with the precise button). |
| studio | green placement cursor centered (`pointerToPlan(clientX,clientY,elev)` raycasts the display-elevation plane) | ✅ Source confirmed (autosprink.html:3757). Page report measured offset ~11px → <1px before/after. |

**Sample recheck result: every fix I independently exercised reproduced.** No fixed control failed my recheck.

---

## 4. Deep gaps that are NOT shippable yet (no theater — these are the missing core)

1. **Real NFPA hydraulic calculation — NOT IMPLEMENTED.** The Studio "Hydraulics" tab shows takeoff data and
   a pipe schedule, *not* a verified pressure/flow solve. This must **never** be claimed as real hydraulics.
   This is the single biggest blocker to selling against AutoSPRINK.
2. **PDF / building-DXF / SAM → full-building model reconstruction — partial/heuristic only.** Not a guaranteed
   full-building extraction. Per the 2026-06-13 AI-backbone audit, SAM vision is a deterministic shim and
   image→3D is down. The official-flow console faithfully *gates* on these but cannot conjure them.
3. **Manufacturer-exact parts / AHJ / PE approval — NONE.** Part meshes are generated parametric massing at
   spec-nominal dimensions; every part carries `needsVerification:true`. Connectivity and scale look plausible,
   but no manufacturer-exact validation was (or honestly could be) performed.
4. **Payment / Stripe / invoicing — ABSENT.** No pay, invoice, or billing controls exist anywhere in the stack.
5. **Outbound email send (Approve & send) — FAIL-CLOSED STUB.** Real nodemailer path exists but returns 409
   "SMTP not configured" until SMTP creds are set; the approve-and-send-bid flow is not operationally complete.
6. **Voice / SMS / call integrations — ABSENT.** The CRM is a bid-request kanban, not a contact CRM; no
   text/SMS/voice controls exist (MISSING by design, not broken).
7. **Per-role dashboards (Reports) — NOT BUILT.** Estimator/CFO/Designer/PM/Service/Dispatcher/Tech/Safety/HR
   drill-downs are an honest empty-state awaiting R0 `activity_log` telemetry. Only Bids-out and Win-rate KPIs
   are computable; Recurring (ITM) and Crew utilization are hardcoded "—".
8. **Auto price-sync (Vendors) — NOT BUILT.** Read-only pricebook rollup only. No OAuth-inbox ingestion,
   review-queue, price-history, or per-part CAD acquisition. No vendor registry CRUD.
9. **Dock customization / per-user dockable layout (Workbench) — NOT BUILT.** "Customize dock", add-tile, grips,
   Job Book are inert "Coming soon" chrome.
10. **Calendar is a scheduling shell.** Only due-date markers; no time-of-day events, drag/resize, providers,
    or appointment grid. Not the Dentrix-style full-bleed scheduler the spec calls for. **Sharper finding than
    the page report:** the calendar loads only `/bids?limit=50` (calendar.html:302), so only the first ~50 bids
    by default sort ever get markers — older months with due bids render blank. (Confirmed live: Sept 2021 has
    41 due bids in the API but shows 0 calendar markers.)
11. **~332 of 374 Studio menubar items are stubs** (AutoPREP, Roof Planes, Wizards, Parts DB editor, real
    Hydraulics solver, etc.) — honestly flagged "NEEDS-VER", but no engine command exists behind them.

### Operational caveats found this pass
- The shipped `data/halofire.db` has **2413 bids** but **0 seeded bid-request kanban cards** and only **1**
  project with claim-gates. Several CRM pipeline controls (estimate/render/draft/approve) and most settings
  SAM31/room-boundary controls only exercise once data is seeded — they were verified by the page engineers
  against their own seeded copies, not against the as-shipped DB. The endpoints themselves respond 200 and
  fail-closed correctly (e.g. approve nonexistent draft → 404).
- All page-report deploys to the VPS were md5-matched but re-exercised against dev DB copies, not the live VPS
  backend. Live-VPS data-driven sections were not re-run post-deploy.

---

## 5. Ship-readiness call

**shipReady = false.**

- As a **shell / operator console**: functional, honest, 0 broken controls, fixes verified. Could demo today.
- As the **AutoSPRINK-grade fire-protection engineering product** it is positioned to be: **not ready.** The
  real hydraulics, full-building extraction, manufacturer-exact parts, and payment/email/voice integrations —
  the things a paying fire-protection customer actually needs — are not built. They are correctly flagged in
  the UI (no fakery), which is the right call, but flagging is not shipping.

The discipline here is good: nothing fabricated, every gap is labeled. Ship the console as an internal
operator/evidence tool with the limitations visible; do **not** market it as real hydraulic design or
automated plan reconstruction until §4 items 1–3 are genuinely built and independently verified.

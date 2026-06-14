# HaloFire — Master Roadmap

**Date:** 2026-06-13
**Purpose:** The single sequenced plan that reconciles the five design docs into one program, so the **shared foundation is built once, in the right order**, and every feature phase snaps onto it instead of colliding. This is the authoritative index — the other docs are the detail.

**Source docs:**
- [Ops-flow optimization](HALOFIRE_OPS_FLOW_OPTIMIZATION.md) — the Job/Building spine, one nav, role homes
- [Reports & analytics](HALOFIRE_REPORTS_AND_ANALYTICS.md) — role dashboards + the `activity_log` telemetry spine
- [Vendor price-sync & part-CAD](HALOFIRE_VENDOR_PRICESYNC_AND_PART_CAD.md) — email→review→commit + CAD acquisition
- [Engineering audit & roadmap](HALOFIRE_AUDIT_AND_ROADMAP.md) — AutoSPRINK tool depth, PDF→model, hydraulics
- [Design system & adaptive AI](HALOFIRE_DESIGN_SYSTEM_AND_ADAPTIVE_AI.md) — the kit, the assistant, the learning loop, the autonomy ladder

---

## 1. The goal-line (what "done" means for the whole product)

A fire-sprinkler company runs end-to-end on HaloFire:
- **Studio** = real AutoSPRINK function — draw/route/edit with real tool depth → **read a PDF floor plan → build a correct, scaled 3D architectural model → design a code-compliant sprinkler system** (NFPA-13 layout + real hydraulics).
- **Operations** = the business runs job-by-job: bid → design → permit → fabricate → install → inspect → invoice, plus the recurring **ITM/NFPA-25 service annuity**.
- **Vendors** = price sheets stay current automatically (email→review→commit), every part has a CAD model.
- **Reports** = each role sees its own decision dashboard; the owner/dev sees the company + drills to any position/employee.
- **The system learns** — minimal UI, AI does the hard work, and automation is *earned* (human-in-loop → CEO-granted full-auto) as the company brain proves it.

This is a multi-quarter engineering program, not a sprint. The plan below is honest about that.

---

## 2. The shared foundation (BUILD ONCE — everything depends on it)

These six pieces are referenced by every workstream. Building them first is the whole point of this roadmap.

| # | Foundation piece | Feeds | Source |
|---|---|---|---|
| **F1** | **User/role model** — positions, department, `access_tier`, `manager_id`; `requireAccess(tier,scope)` middleware (extends the 2-value `role`) | Reports access, role homes, the autonomy ladder's CEO grants | Reports §1.1, §3 |
| **F2** | **Job/Building record** — unify `/api/bids` + `/api/bid-requests` into one entity; ownership columns (`created_by`/`assigned_to`); "open this job in Studio" | Ops-flow, reports attribution, Studio job-binding, vendors→jobs | Ops-flow §4.1; Reports §1.2 |
| **F3** | **Shared Nav rail + design-system component kit** — one Button/Field/Nav/Table/Card/Modal/Toast/Empty; post-login→Workbench; kill the 5 hand-rolled navs + 4 dead rail items | Every screen | Design-system §3; Ops-flow §4.2 |
| **F4** | **Telemetry spine** — wire the dead `activity_log`: login + mutation events + `updated_by` | Reports AND the adaptive brain (UI adaptation, nightly refactor, autonomy ladder) | Reports §1.3; Design-system §5 |
| **F5** | **Status canonicalization** — normalize dirty bid status (`Awarded→won`…); fixes the silent 0% win-rate | Every bid metric | Reports §1.4 |
| **F6** | **Review Queue component** — the one human-in-loop gate (propose→diff→approve→commit) | Vendor prices, outbound email, refactor proposals, automation graduations | Design-system §4.3 |

> Until F1–F6 exist, every feature re-keys data, every report shows fake numbers, and every nav is a one-off. They are the spine.

---

## 3. The sequenced program

Each phase lists its dependency, the workstreams it advances, effort (S/M/L/XL), and the "done" bar. Phases within a wave can run in parallel where deps allow.

### ✅ Wave 0 — Shipped
- **Draw-wall-zoom fix** — `renderModel` no longer reframes the camera on edit. Verified live, committed `6607e7b`. *(First win off the engineering audit.)*

### Wave 1 — Foundation (F1–F6)  ·  the spine, built once
- **P-F (XL):** F1 user/role model + F2 Job record + F3 nav/kit + F4 telemetry + F5 status-canon + F6 Review Queue.
- **Done when:** one user can log in with a real position; post-login lands on the Workbench under one shared nav with zero dead items; a bid and its CRM request are the same Job; every login/change is in `activity_log`; bid status is canonical; the Review Queue renders a diff→approve flow.

### Wave 2 — First real value on the spine  (parallel)
- **P1a — Bid/Estimator reports [NOW] (M):** dep F1/F4/F5 → the Estimator dashboard + the win-rate/pipeline half of the CEO dashboard off the 2,413 real bids. *First trustworthy reports.* (Reports R1)
- **P1b — Vendor price-sync V1 (L):** dep F2/F6 → OAuth inbox (Gmail/Graph) → parse emailed price books (reuse `pricebook-importer`) → diff → Review Queue → approve → commit + `price_history`. Start with the 3 known vendors (ARGCO/FFF/Victaulic). *Kills the manual Excel loop.* (Vendor V0+V1)
- **P1c — Ops-flow surfaced (M):** dep F2/F3 → the Job record drives the screens; "Open this job in Studio" replaces the hard-coded 2-item picker; honest placeholders elsewhere. (Ops-flow P0/P1)

### Wave 3 — Depth  (parallel)
- **P2a — Studio CAD tool depth (XL):** dep Wave-0 → real AutoSPRINK-grade tools on the approved **mock-studio** UI: multi-segment draw, live typed dimensions, visible snaps, measure, array/trim, inspector editing, command palette (⌘K) for the 354-item depth. Grounded in the AutoSPRINK bible. (Engineering P0)
- **P2b — Project pipeline + permit/AHJ + calendar (L):** dep F2 → lifecycle status board; permit as a tracked stage; calendar binds real job events. (Ops-flow P2)
- **P2c — Reports access model + god-view (M):** dep F1/F4 → `requireAccess` enforcement; role-routed `reports.html`; the Company-tier scope switcher (position/employee drill + per-employee audit trail). (Reports R2)

### Wave 4 — The hard engineering + the annuity
- **P3a — PDF→full-building model (XL):** wire verified columns/doors/stairs; multi-floor reconstruction + vertical alignment; registration generality with a real vision verifier; room-bounding + 3D solids. (Engineering / audit area C)
- **P3b — Real hydraulics + NFPA (XL):** Hardy-Cross loop/grid, per-fitting equivalent lengths, interactive remote-area polygon, NFPA-13 rule registry, NFPA-8 submittal reports. Build real or flag honestly — never stub. (Engineering / audit area D)
- **P3c — Service/ITM module (XL, the annuity):** asset register → NFPA-25 recurring scheduler → offline mobile tech flow → one-click deficiency→quote→work-order→invoice → Service reports. (Ops-flow P3; Reports R4)

### Wave 5 — Adaptive + earned automation
- **P4a — Vendor part-CAD pipeline (L):** SKU→taxonomy; cut-sheet dimension extraction; expand SCAD generators; TraceParts API + manufacturer libraries into `part_overrides`. (Vendor V3)
- **P4b — The adaptive brain (XL):** dep accumulated F4 telemetry + F6 → UI adaptation (promote/demote functions), nightly local-Qwen refactor loop (proposals only), and the **graduated-autonomy ladder** with CEO "ready to automate" recommendations. (Design-system §5)
- **P4c — Billing (M):** Job schedule-of-values → AIA progress billing + retention, tied to field % complete. (Ops-flow P4)
- **P4d — Durable price channels (L):** EDI 832 / punchout onboarding with Ferguson & Victaulic. (Vendor V4)

---

## 4. Dependency map (why this order)

```
Wave 0 (draw fix ✅) ── independent

Wave 1  F1 ─┐
        F2 ─┤
        F3 ─┼──▶ everything downstream
        F4 ─┤
        F5 ─┤
        F6 ─┘

Wave 2  P1a(reports) ◀ F1,F4,F5      P1b(vendor) ◀ F2,F6      P1c(ops) ◀ F2,F3
Wave 3  P2a(studio) ◀ Wave0          P2b(pipeline) ◀ F2       P2c(reports access) ◀ F1,F4
Wave 4  P3a(pdf→model)  P3b(hydraulics)  P3c(ITM service) ◀ F2
Wave 5  P4a(part-CAD)  P4b(adaptive brain) ◀ F4+F6 mature  P4c(billing)  P4d(EDI)
```

The Studio engineering track (P2a→P3a→P3b) can run **in parallel** with the operations track (Wave 2/3/4 ops/reports/vendor), because the Studio surface and the operations surface share only F2/F3 — once the foundation exists, the two halves advance independently.

---

## 5. Operating rules for every phase (non-negotiable)
- **Loops, not single passes:** nothing is "done" until verified in the **live** target with evidence (screenshots/numbers I personally read) — never headless flag-probes.
- **Honest engineering:** hydraulics/NFPA/extraction are built real or flagged honestly — never faked/stubbed and called done.
- **One Review Queue** gates every AI side-effect; outbound email is per-message human-approved; untrusted content never auto-commits.
- **Local Qwen** for cron/extraction (Claude escalation only); **OAuth only**, no raw keys.
- **Safe deploy:** md5-verified file-sync to the VPS, never `deploy-vps.sh`; demo on the live https URL, never the :3399 proxy.
- **Minimal UI / AAA:** small component kit; the contrast gate is law; depth hides behind progressive disclosure + ⌘K.

---

## 6. Recommended start
**Wave 1, piece F2 (the Job/Building record) + F3 (shared nav/kit) first** — they're the most-depended-on and immediately fix the daily pain (home, nav, "open job in Studio"), and they unblock the most downstream work. F1/F4/F5/F6 follow within the same wave.

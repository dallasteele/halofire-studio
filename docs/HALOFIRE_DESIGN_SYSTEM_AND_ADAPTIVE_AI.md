# HaloFire — Design System & Adaptive-AI Architecture

**Date:** 2026-06-13
**Purpose:** The integrating spec. The four workflow docs (ops-flow, reports, vendor price-sync, engineering) all render through *one* clean design system and *one* AI architecture. The product philosophy: **the hard work lives in the backend (OpenClaw + local AI); the UI stays minimal; AI guides the user throughout; the system adapts itself over time; and automation is *earned* — human-in-loop now, full-auto later once the brain proves it.**
**Grounds on:** the real token system (`apps/autosprink/public/styles/halofire-tokens.css`, typed source `apps/studio/src/lib/tokens.ts`, AAA contrast-gate `tests/design-tokens.test.js`).

---

## 1. Product principles (the non-negotiables)

1. **Minimal surface, deep backend.** The user sees the 3 things that matter now; the other 351 live behind search/command/progressive-disclosure. Depth ≠ clutter.
2. **Minimal input to get running.** The user provides the least possible; AI fills, infers, and proposes the rest. Setup is a conversation, not a 40-field form.
3. **AI present throughout.** One consistent, *pleasant* assistant — a local LLM that knows the software inside-out — is always one affordance away: explain this, do this for me, what should I do next.
4. **Not static — it learns.** A company Obsidian brain watches real usage and continuously improves operations, the UI/UX, and which functions exist. The app you use in 6 months is shaped by how you actually worked.
5. **Earned automation.** Every automatable action starts human-in-loop. The brain tracks the human's decisions; when a task is reliably the same, it tells the **CEO** "this is ready to fully automate." The CEO grants it. Trust is earned, monitored, and reversible.
6. **Honesty + AAA.** AI never fabricates; uncertain output is flagged, not hidden. The AAA contrast gate is law (fix the color, never the test).

---

## 2. Design tokens (already AAA — do not reinvent)

Use the existing `--hf-*` system verbatim. Summary of the source of truth:

| Group | Tokens |
|---|---|
| **Surfaces (charcoal layers)** | `--hf-color-bg #0e1318` · `-surface #161c25` · `-surface-raised #1d2530` · `-surface-hover #232c39` |
| **Borders** | `--hf-color-border #2a323d` · `-border-strong #3a4654` |
| **Text (AAA)** | `-text-primary #f0f4f8` · `-text-secondary #c4cdd8` · `-text-muted #b8c1cb` |
| **Accent (warm ember)** | `--hf-color-accent #f0a868` · `-accent-text #f4b87f` · ink-on-accent `#0e1318` |
| **Interactive (blue)** | `-interactive #3b82f6` · `-interactive-text #7fb4ff` (also focus ring) |
| **Semantic** | success `#4ade80` · warn `#fbbf24` · danger `#fca5a5` |
| **Type** | Inter Variable (UI) + JetBrains Mono (numbers/SKUs, tabular figures); ~1.25 scale, xs→3xl |
| **Space/radius/elevation/motion** | 4px scale · radii 4/6/10/14/pill · elevation sm/md/lg · durations 80–360ms, standard easing |

**Glass treatment** = the *elevation* expression on top of these tokens: translucent layered surface (linear white-sheen + `rgba(22,26,32,.72)`) + 1px hairline `rgba(255,255,255,.08)` + backdrop-blur(14–18px) + inset highlight. **Gotcha (known):** `halofire-tokens.css` loads after inline styles and re-points `--surface/--bg/--gold` to flat token values — re-assert glass surfaces in a `<style>` *after* the tokens link.

---

## 3. The component set (small + opinionated)

Keep the library tight. Every screen in all four workflows is built from these:

| Component | Variants | Key states | Notes |
|---|---|---|---|
| **Button** | primary (filled ember, dark ink) · secondary (glass) · ghost · danger | default/hover/active/disabled/loading | Disabled must look disabled (we had grey-on-grey "Approve" bugs — fix at the component) |
| **Field** | text · number · select · search · textarea | default/focus(blue ring)/error/disabled | Pairs with AI-fill (§4.2) |
| **Card / Panel** | flat · raised · glass | hover · selected | The dashboard + dock unit |
| **Table / List** | dense · comfortable | row hover · selected · empty · loading | SKUs/prices/bids; mono numerals |
| **Status pill** | success/warn/danger/neutral | — | Reuse `.st.*` semantics already in tokens |
| **Modal / Drawer** | center modal · right drawer | open/closing | Drawer for inspectors/detail; modal for confirm |
| **Nav rail** | — | current/badge | **One shared component** (replaces the 5 hand-rolled navs — see ops-flow doc) |
| **Toast / Inline message** | info/success/warn/error | — | Non-blocking feedback |
| **AI Assistant** | dock · inline · inline-action | idle/thinking/streaming/needs-input | §4.1 — the signature component |
| **Review Queue** | — | pending/approved/rejected | §4.3 — the human-in-loop gate |
| **Empty / "not connected yet"** | — | — | Honest placeholder (the `_wbdata.js` pattern) |

---

## 4. The patterns that carry the philosophy

### 4.1 The AI Assistant (one affordance, everywhere)
A single, consistent assistant surface — a *pleasant* local LLM (`qwen3:30b-a3b`, escalating to Claude only when stuck) that knows the software via the company brain + the docs.
- **Three forms, one component:** (a) **dock** — a persistent collapsible panel ("ask HAL"); (b) **inline** — a small ✦ on any panel → "explain this / what should I do here"; (c) **inline-action** — "do it for me" on a task (drafts the email, fills the form, runs the takeoff) → always lands in a Review Queue if it has side effects.
- **Grounded, not chatty:** answers cite the actual screen/data; uncertainty is flagged. It guides ("you have 3 bids due today, want to start the Anthem estimate?"), it doesn't lecture.
- **Tone:** calm, brief, competent. Never a wall of options.

### 4.2 Minimal-input, AI-assisted forms (the "minimal data to run" principle)
Forms ask for the *irreducible* minimum; AI proposes the rest, the user confirms.
- Add a vendor → user types the vendor name + email; AI infers type/format/cadence and proposes the rest (editable).
- New bid → drop the plan PDF; AI extracts project/GC/sqft/due-date; user confirms.
- Pattern: **one or two real inputs → AI draft → user edits → save.** Never a blank 40-field wall.

### 4.3 The Review Queue (the human-in-loop gate — reused everywhere)
The single pattern for *every* AI side-effect: **propose → review the diff → approve/reject → commit.** Used by: vendor price updates (untrusted email → never auto-commit), outbound vendor/bid email (per-message approval), nightly-refactor proposals, and graduated-automation candidates (§5.3). One mental model the user learns once.

### 4.4 Progressive disclosure + Command palette (depth without clutter)
- **Default view = the few things that matter** (role home, today's work). Advanced controls live under "More" / an inspector tab / the command palette.
- **Command palette (⌘K):** one keystroke to any of the 354 Studio functions or any app action — so the full AutoSPRINK depth is *reachable* without being *on screen*. This is how "full function" and "clean and simple" coexist.

---

## 5. The adaptive system (this isn't static)

This is the architecture that makes the product *learn*. It's built on the **telemetry spine already specified in the reports doc**: the `activity_log` (every login, change, navigation, AI interaction).

```
   USER ACTIONS ──▶ activity_log (telemetry spine)
                          │
                          ▼
              COMPANY OBSIDIAN BRAIN (hal-brain on GX10)
        learns: what's used, what's skipped, where users get stuck,
        which AI suggestions get approved unchanged, workflow patterns
                          │
        ┌─────────────────┼──────────────────────────┐
        ▼                 ▼                           ▼
  UI/UX ADAPTATION   NIGHTLY REFACTOR LOOP     GRADUATED-AUTONOMY LADDER
  (promote/demote/   (local Qwen cron:         (earned full-auto, §5.3)
   reorder/hide      fix issues, propose       → CEO "ready to automate"
   functions)         add/remove functions)       updates
        └─────────────────┴──────────────────────────┘
                          ▼
                 ALL CHANGES = PROPOSALS → Review Queue (CEO/admin) → apply (reversible)
```

### 5.1 UI/UX adaptation
The brain reads usage from `activity_log`: frequently-used functions get **promoted** (surfaced, fewer clicks); never-touched ones get **demoted** (tucked into the palette) or **flagged for removal**. Where users repeatedly stall (open→back→open), the brain proposes a flow fix. **Per-user *and* per-role** — the layout the user already wants (dockable panels, saved per-user profile) is the manual version of this; the brain does the automatic version.

### 5.2 Nightly refactor loop
A local-Qwen cron (per the cron-uses-local-Qwen rule; Claude escalation only) runs each night: reads telemetry + the brain + open issues, then (a) proposes **code refactors** to fix real friction/bugs, (b) proposes **function add/remove/reorder** based on real workflow. Output is a **proposal set in the Review Queue**, never an unattended prod mutation. Verified with the existing gate/test discipline before anything ships.

### 5.3 The graduated-autonomy ladder (answers the vendor-email question)
> Your direction: *"keep the people in the loop for now; as the brain learns, the CEO should get updates as to what is ready to fully automate without user interaction. That is the goal."*

Every automatable action lives on a ladder, tracked per task in a **trust ledger**:

| Rung | Behavior | Graduation signal |
|---|---|---|
| **0 — Manual** | User does it | — |
| **1 — AI-assisted** | AI drafts, user edits + approves every time | default for new automations |
| **2 — Human-in-loop (review queue)** | AI does it fully, human approves the diff | where vendor price-sync + outbound email sit **now** |
| **3 — Auto + notify** | AI acts, logs it, human can undo; CEO is notified | brain proposes promotion when the human approved ~unchanged N times running |
| **4 — Full-auto** | AI acts silently, periodic audit | CEO explicitly grants, after a rung-3 track record |

The brain watches the rung-2 approval pattern. When a task is reliably the same — e.g. *"Vendor ARGCO price updates: 47 of 47 approved unchanged over 3 months, 0 corrections"* — it surfaces a **CEO recommendation**: *"Ready to graduate ARGCO price-sync to Auto+notify?"* The CEO approves on the **CEO dashboard** (reports doc §2.1 / §4). Every graduation is **monitored + reversible** — a spike in corrections auto-demotes a rung and re-engages review. **Automation is never removed from the loop without the CEO's explicit grant**, and never silently.

This is the through-line for the whole product: humans-in-loop builds the training signal; the brain converts a proven pattern into a *proposal to automate*; the CEO decides; the system earns trust one rung at a time.

---

## 6. Applied: the Vendor Interaction screens (clean, from the kit)

Built entirely from §3 components + §4 patterns — minimal, no option-overload:
- **Vendors** — a simple list (Table) of vendors with a status pill (price book current? last update? rung on the ladder). "Add vendor" = the minimal AI-assisted form (§4.2).
- **Price Review** — the Review Queue (§4.3): incoming price-update proposals showing the **diff** (new/changed/removed SKUs, old→new) + provenance + confidence; approve commits + writes history. The ✦ assistant explains anomalies ("Victaulic raised couplings 6% — above its usual 2%").
- **Vendor detail** — a Drawer: contact, channel, the price-history sparkline, the ladder rung, and "request latest price list" (drafts an email → approval gate).
- The CEO sees, on their dashboard, the **"ready to automate"** recommendations as they mature (§5.3).

No new visual language — same tokens, same components, same one assistant.

---

## 7. Guardrails
AAA contrast gate is law. Local Qwen for all nightly/cron loops (Claude escalation only). Every AI side-effect goes through the Review Queue. Outbound email is per-message human-approved. No automation graduates without the CEO's explicit grant; all graduations are monitored + reversible. AI output is grounded + flags uncertainty. OAuth only, no raw keys. The component library stays small — adding a component needs a reason (no one-off chrome; that's how the 5-nav mess happened).

---

## 8. How this consolidates the other docs
- **Ops-flow** → the one shared Nav rail + role homes + the Job spine these components render.
- **Reports** → the `activity_log` telemetry spine that *also* feeds the adaptive brain (§5); the CEO dashboard is where graduation recommendations land.
- **Vendor price-sync** → §6, built on the Review Queue + AI-assisted forms + the ladder.
- **Engineering/Studio** → progressive disclosure + command palette are how the 354-item AutoSPRINK depth stays usable.
One design system, one assistant, one human-in-loop gate, one learning brain.

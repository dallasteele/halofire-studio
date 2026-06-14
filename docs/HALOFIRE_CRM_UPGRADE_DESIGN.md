# HaloFire — CRM Upgrade: Client + Vendor Ops, Comms, Payments & the AI Virtual Employee

**Date:** 2026-06-13 · **Status:** Canonical companion to `HALOFIRE_SYSTEM_DESIGN_SPEC.md`
**Goal:** Turn the thin bid-pipeline CRM into a full client+vendor operations system: email/SMS/voice comms, online invoices + payments, vendor tracking + AP, an OpenClaw "virtual employee" that researches vendors and builds profiles (and can call them by voice for price lists/docs), and integrations (QuickBooks, Stripe). **Halo Fire — like most contractors — struggles to manage vendors and clients; this is the fix.**
**Grounded in:** a file:line audit of what exists + web research on the secure integration architecture (Stripe/QuickBooks/Twilio/OpenAI-Realtime) and the compliance boundaries.

---

## 0. The governing principle — minimize what we own (you said this exactly)

> "We will use third party for those things that require security that we can't." — correct, and it's the spine of this design.

**HaloFire is the orchestrator + system of record for consent, audit, approvals, and policy.** Regulated *execution* is delegated. Building these ourselves would turn HaloFire into a payment processor / telecom carrier / regulated data broker — never do it.

| Radioactive thing | Delegate to | Why |
|---|---|---|
| **Card / bank data** | **Stripe** (hosted Checkout/Elements/Payment Links/Invoicing + ACH) | Card number goes browser→Stripe, **never touches our servers** → PCI **SAQ A** (lightest). Custom card forms = SAQ A-EP (heavy) — never build them. |
| **Moving money (ACH rails)** | **Stripe ACH** (Nacha) | We're not a Nacha originator. |
| **Books / AR system of record** | **QuickBooks Online** (Intuit OAuth2) | QBO is the accounting source of truth; we sync to it. |
| **SMS delivery + sender identity** | **Twilio + A2P 10DLC** | US carriers *require* registered brand/campaign. |
| **Phone-network origination** | **Twilio Programmable Voice / SIP** | We're not a telco. |
| **Secrets at rest** | **KMS / secrets manager** (new) | Today secrets sit in plaintext config rows — must encrypt before storing Stripe/QBO/Twilio tokens. |

**What HaloFire builds and owns:** the data model, the **consent ledger**, the **audit trail**, the **human-in-the-loop approval UI** (the Review Queue), webhook handlers, the **vendor profile store**, and the **policy engine** (e.g., "is this recipient's state all-party-consent?"). We own the *decisions and records*; third parties own the *regulated action*.

---

## 1. What exists vs greenfield (honest)

| Capability | State today (evidence) |
|---|---|
| **Email send/receive + human-approval gate** | ✅ **Real, production-grade** — `src/autobid/` (imapflow read-only + nodemailer) with `outbound_drafts` → admin-approve → send (`server.js:22211`). **The exact governance pattern to reuse for SMS/voice.** |
| **CRM data model** | 🟡 thin — only `clients` (`server.js:304`) + `bid_requests` (`:314`). No contact-vs-company, properties, activities/timeline, threads, deals, or **vendor entity**. |
| **CRM target blueprint** | ✅ **Already specified** — `docs/plans/halofire-operations-surface.md` (contacts/properties/invoices/payments/inspections, OPS-1…OPS-8). Build to it. |
| **SMS, telephony/voice calls** | 🔴 **none.** VoiceForge (`E:/ClaudeBot/voice-forge/`, :8766) is a real STT→LLM→TTS engine but **not a phone system** — no Twilio/SIP anywhere. |
| **Payments, invoicing, QuickBooks** | 🔴 **greenfield** (clean — nothing to rip out; honors "never touch card data" by default). |
| **OpenClaw research / vendor profiles** | 🟡 bridge is env-driven + fail-soft but **only CAD/SAM tools exposed** (no web-research tool). `cutsheet-scraper` = the reusable fetch→strip→**flag-needs-verification** pattern. |
| **Secrets** | 🟡 dotenv + write-only config tables, **no encryption/vault** — harden before storing third-party tokens. |

---

## 2. Data model (extends the existing blueprint)

Build the blueprint's `contacts / properties / activities / invoices / payments` and **add the vendor + comms + consent layer:**

- **`companies`** (client firms AND vendors; `type: client|vendor|both`) · **`contacts`** (many per company; name/role/email/phone/mobile) · **`properties`** (buildings under a client) · **`deals`** (= the bid_requests opportunity, kept).
- **`vendors`** (extends `companies` type=vendor) + **`vendor_profiles`** — AI-researched: what they sell, catalogs, price-list cadence, contacts, **every fact source-attributed (URL) + `needs_verification`**. Ties to the existing pricebook + `HALOFIRE_VENDOR_PRICESYNC_AND_PART_CAD.md`.
- **`activities`** — the unified timeline: every email/SMS/call/note/invoice/payment/status-change, per company/contact/deal. The CRM's spine.
- **`threads` / `messages`** — stitched conversations (inbound email from `autobid_intake_log` + outbound from `outbound_drafts` + SMS + call transcripts) into one per-contact view.
- **`invoices`** (id, deal/project, number, amount, status draft|sent|paid|overdue, stripe_invoice_id) · **`payments`** (invoice_id, amount, method, stripe_payment_id, received_at) — **IDs/tokens only, never card data.**
- **`consent`** — per contact+channel: SMS opt-in (when/how), call-recording consent, the recipient's **state** (drives the recording-law gate). The legal evidence store.
- **`integrations`** — encrypted token store (QBO OAuth refresh token w/ rotation, Twilio keys, Stripe keys) — **new, encrypted.**
- **`audit_log`** — every agent action + human approval/rejection + reasoning (reuse/extend `activity_log`).

---

## 3. The comms layer (email · SMS · voice — all human-in-loop)

Every outbound channel uses the **same draft → review → approve → send** gate that email already has (`outbound_drafts`), routed through the **one Review Queue** and the **graduated-autonomy ladder** (rung 2 now → CEO-granted automation later).

- **Email** ✅ reuse `src/autobid/` verbatim (send/receive + approve gate). Stitch into `threads`.
- **SMS** (Twilio Programmable Messaging) — send/receive texts to clients+vendors. **Compliance HaloFire owns:** register **A2P 10DLC** (Brand + Campaign — hard carrier requirement; B2B is *not* exempt), capture **TCPA opt-in** into the consent ledger, honor **STOP** instantly (Twilio Advanced Opt-Out on), verify inbound webhook signatures. Drafts go through the approval gate.
- **Voice** (Twilio Programmable Voice + OpenAI Realtime, optionally voiced by VoiceForge) — see §4.

---

## 4. The AI "virtual employee" (research + profiles + voice calls)

Two capabilities, both agent-drafts-→-human-confirms:

**4.1 Vendor research + profile-building (lower risk).** An OpenClaw/LLM agent (reusing the bridge + the cutsheet-scraper fetch→strip→flag pattern) researches each vendor from the web → builds a `vendor_profile` (products, catalogs, contacts, price-list cadence) → **every fact carries its source URL + `needs_verification`** → surfaced for human confirm. **Sourcing policy (the control):** public data only, never behind a login, respect robots.txt + ToS (LinkedIn binds even buyers — avoid), bias to **official/manufacturer sources + licensed APIs**. Needs: a `vendors` table, a vendor-research skill, and an OpenClaw **web-research tool** exposed on the bridge (only CAD/SAM exposed today).

**4.2 AI voice calls to vendors (high value — and the legally hardest thing here; honest section).** Architecture is well-trodden: Twilio call ↔ Media Stream (WebSocket) ↔ OpenAI Realtime (↔ VoiceForge TTS) — to call a vendor and get a price list / product docs by voice. **But AI voice calling carries real legal weight across your 38 states:**
- **AI voice = "prerecorded/artificial voice" under the TCPA** (FCC Feb-2024 ruling) → prior express consent, identify the caller, offer opt-out.
- **AI disclosure laws** (e.g. TX SB 140) → must disclose "this is an automated AI assistant calling on behalf of HaloFire" in the **first 30 seconds** — build it as a mandatory, configurable opener.
- **Call-recording consent — the 38-state killer:** ~12 states are **all-party consent**; with parties in different states the **strictest law applies**. Recording a vendor to extract a price list needs the vendor's consent in those states. Penalties reach felony + civil liability.

**Recommended posture (don't ship a robocaller):** scope AI voice to **existing vendor relationships who've consented to be contacted**, not cold outreach; a **state-aware recording gate** keyed to the vendor's state (default: ask consent at call start, every call); low-volume, relationship-based; the AI-disclosure opener always on; **a human starts/approves the call** (rung 2 — never fully unattended). High-volume AI cold-calling is a TCPA liability magnet — we will not build that.

---

## 5. Payments, invoicing, accounting

- **Invoice → online payment:** create a **Stripe Invoice** → Stripe emails the **Hosted Invoice Page** → client pays by card or **ACH** → Stripe webhook `invoice.paid` → we mark the job paid + push to QuickBooks. We store only the Stripe invoice **ID + payment-method token**. For big sprinkler invoices, **prefer ACH** (flat-fee cap vs card percentage). Stay on Checkout/Elements/Payment Links → **PCI SAQ A**.
- **Accounting (QuickBooks Online, OAuth2):** sync Customers, Invoices, Payments, **Vendors, Bills, Bill Payments** (client AR *and* vendor AP). QBO is the **system of record** for the books. Auth = Authorization-Code OAuth2 only (no keys); **access token 1h, refresh token 100d and rotates every use → persist the new one atomically or the link dies.** Store the refresh token **encrypted**.
- **Pay vendors (AP):** record/schedule bill payments through QBO; HaloFire orchestrates + approves, QBO/Stripe execute. (Optional Stripe payouts/Bill.com later — same delegate-the-money principle.)

---

## 6. Compliance register (HaloFire's to own)
PCI SAQ A (hosted card entry, never log a PAN) · A2P 10DLC registration + TCPA opt-in consent ledger + STOP · call-recording **state map** (all-party gate) · AI-voice disclosure opener + TCPA prerecorded-voice consent · scraping robots.txt/ToS + source attribution · **secrets encryption** for all third-party tokens · per-message human approval on every outbound; payments + AI voice **never** graduate to unattended.

---

## 7. Build phases
- **C1 — CRM core:** companies/contacts/properties/activities/threads/deals + the unified timeline; migrate `clients`→companies. (Aligns OPS-1…3.)
- **C2 — Vendor CRM:** `vendors` + `vendor_profiles`; the OpenClaw vendor-research skill + web-research tool; ties to price-sync.
- **C3 — Comms:** SMS (Twilio + 10DLC + consent ledger + STOP) on the email approval gate; thread stitching.
- **C4 — Money:** Stripe invoicing + hosted payment + webhooks → mark paid; **encrypted token store**.
- **C5 — Accounting:** QuickBooks OAuth2 sync (customers/invoices/payments/vendors/bills) with refresh-rotation handling.
- **C6 — AI voice (last, gated):** Twilio Voice ↔ OpenAI Realtime ↔ VoiceForge; the state-aware recording gate + AI-disclosure opener + consent; human-initiated, existing-vendors only.

Sequenced so value lands early (CRM + vendor profiles + SMS) and the highest-risk piece (AI voice) ships last with full guardrails.

---

## 8. Sources
Stripe (PCI SAQ A, hosted invoice page, ACH), Intuit QuickBooks Online API + OAuth2, Twilio A2P 10DLC + Programmable Messaging/Voice, OpenAI Realtime + Twilio Media Streams, FCC Feb-2024 AI-voice TCPA ruling, TX SB 140, state call-recording (all-party) law, web-scraping ToS (robots.txt/LinkedIn), HITL graduated-automation best practice. Codebase: `src/autobid/*`, `crm.html`, `server.js` (clients/bid_requests), `docs/plans/halofire-operations-surface.md`, `voice-forge/`, `src/skills/cutsheet-scraper/`. Companion: `HALOFIRE_VENDOR_PRICESYNC_AND_PART_CAD.md`, `HALOFIRE_DESIGN_SYSTEM_AND_ADAPTIVE_AI.md` (the autonomy ladder), `HALOFIRE_AI_BACKBONE_AND_TENANT_PROVISIONING.md` (OpenClaw wiring).

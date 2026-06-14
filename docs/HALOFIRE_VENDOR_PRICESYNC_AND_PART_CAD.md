# HaloFire — Vendor Price-Sync & Part-CAD Automation

**Date:** 2026-06-13
**The pain (real, from the company):** a person manually opens a vendor email, downloads a price list, and retypes it into an Excel sheet. Prices feed bids/estimates → this is direct money. Goal: automate vendor tracking, price-sheet currency, and getting/creating a CAD model for every vendor part.
**Grounding:** file:line inspection of the existing pricebook + email + parts infra, plus web research on the fire-sprinkler supply chain, price-data channels, CAD sources, and OAuth email.

---

## 0. The headline: this is connective tissue, not greenfield

The codebase already has solid, fail-closed primitives — they're wired to a manual seed, not a live loop:

| Primitive | Exists today (evidence) | What's missing |
|---|---|---|
| **Per-vendor price parser** | `src/data/pricebook-importer.js` — bespoke XLSX readers for ARGCO / FFF(Ferguson) / Victaulic; tolerant header finder; drops bad rows | Only runs in a one-shot `seed.js` full-wipe; 3 hardcoded files; no incremental/per-vendor refresh |
| **Email backbone** | `src/autobid/` — `imapflow` read-only INBOX poll + classify (`intake.js`); `nodemailer` SMTP send (`smtp-transport.js`) | Auth is password/IMAP, **not OAuth**; classifier is bid-only; never polled real mail |
| **Human-approval send gate** | `POST /api/outbound-drafts/:id/approve` (`server.js:22213`, admin) is the **only** send path — fail-closed, no auto-send anywhere | Reuse verbatim for vendor RFQs |
| **Cut-sheet scraper** | `src/skills/cutsheet-scraper/index.js` — fetches manufacturer spec pages as text | Text only (no dims/CAD), 34-part registry, needs curated URLs, never run |
| **Part-CAD generator** | `parts_models` + `src/autobid/scad-emitters-port.js` — flag-don't-gate SCAD gen | Only 4 generators (pipe/elbow/tee/coupling); keyed to 34-part registry, **not** the 7,208 vendor SKUs; 0 rows |
| **Licensed-model store** | `part_overrides` — manufacturer/license/evidence per part | 0 rows |
| **Pricebook data** | **7,208 live rows**: FFF 3,713 · ARGCO 2,373 · Victaulic 1,122; full Excel traceback per row | `last_updated` hardcoded `2026-01-15`; no price-history; no change detection |

**Known vendors** (from the real pricebook): top distributors **ARGCO, Ferguson Fire & Fabrication (FFF), Victaulic**; manufacturer brands carried within FFF's 52 sheets include **Tyco, Reliable, Victaulic, Potter, AGF, Wilkins/Ames, FlexHead, General Air, Sammy/ITW**.

---

## 1. The load-bearing truth about price (drives the whole architecture)

**The contractor's real cost is the distributor's NET price** — account-specific, confidential, negotiated as `list × multiplier` or contract rates. It is **not derivable from any public manufacturer list price.** It lives in exactly two places: **behind the contractor's logged-in distributor account**, or **in the price book the distributor emails them.**

Therefore the automation channels rank (automatability × ToS-legitimacy):

| Rank | Channel | Verdict |
|---|---|---|
| ① **EDI 832 / PunchOut (cXML/OCI)** | Sanctioned, carries true contract pricing | **Durable upgrade** — but requires each distributor to onboard HaloFire as a trading partner (aspirational until those relationships exist) |
| ② **Emailed price books (Excel/PDF) via OAuth mailbox** | Universal, **ToS-clean (it's HaloFire's own inbox)** | **SHIP THIS FIRST** — the pragmatic bridge |
| ③ Partner price feeds / APIs | Relationship-gated | Ask each top vendor |
| ④ **Portal login-scraping** | ToS-risky + brittle + bot-defenses | **AVOID** — last resort only, per-vendor, with the vendor's blessing; never the backbone |

---

## 2. Architecture — ingest → extract → **propose → human-approve** → commit

> **Critical safety principle:** a vendor email is *untrusted content* and prices feed bids → real dollars. The system must **never auto-mutate the pricebook** from email text. Every price change flows through a **review queue**: local Qwen extracts → a human approves the diff → commit. This defeats both prompt-injection and bad-data risk in one gate — mirroring the existing outbound-send approval gate.

```
                    ┌─────────────── Vendor Registry (new `vendors` table) ───────────────┐
                    │ ARGCO · FFF/Ferguson · Victaulic · … : channel config per vendor      │
                    │ (email addr, price-book format, portal?, EDI/punchout?, cadence, CAD lib URL) │
                    └──────────────────────────────────────────────────────────────────────┘
   INBOUND price books                 OUTBOUND requests                 PORTAL (avoid)
   ─────────────────                   ─────────────────                 ────────────
   OAuth mailbox poll                  Cron PREPARES an RFQ              (only if a vendor
   (Gmail API / MS Graph;              "send latest price list"  ──▶     has no email path;
   iCloud IMAP exception)              draft  ──▶ admin APPROVE          per-vendor, ToS-checked)
        │                                   (reuse outbound_drafts gate)
        ▼
   Classify "vendor price list"  (extend bid-classifier)
        │
        ▼
   Parse attachment:  XLSX → pricebook-importer pattern
                      PDF  → table extract;  messy → local Qwen (qwen3:30b-a3b, forceJson)
        │
        ▼
   DIFF vs current pricebook  →  PRICE-UPDATE PROPOSAL
   (new SKUs / changed price old→new / removed / unmatched)
        │
        ▼
   ┌──────────────── REVIEW QUEUE (human-approve) ────────────────┐
   │ shows the diff + source provenance + confidence; approve =    │
   │ commit to `pricebook` + append `price_history` row            │
   └───────────────────────────────────────────────────────────────┘
```

### 2.1 New data
- **`vendors`** — id, name, type (distributor/manufacturer), contact_email, price_book_format (xlsx/pdf/edi/portal), request_cadence (e.g. quarterly), portal_url, edi_capable, cad_library_url, active.
- **`price_updates`** (the proposal/review queue) — id, vendor_id, source (email_msg_id / file), status (pending/approved/rejected), parsed_at, approved_by, summary_json (counts), created_at.
- **`price_history`** — sku, supplier, old_price, new_price, change_pct, source_update_id, changed_at. *(Gives the "when did this vendor's price last change" provenance that's missing today.)*

### 2.2 Reuse, don't rebuild
- IMAP poll/classify backbone → **upgrade auth to OAuth** (§4), swap the classifier target from `bid_requests` to `price_updates`.
- The XLSX readers in `pricebook-importer.js` become the parse layer (already vendor-aware).
- The **outbound_drafts → admin-approve → SMTP** gate is reused verbatim for vendor RFQ "send me your latest price list" emails — **a cron may PREPARE the request, but a human approves every send** (standing rule).
- The flag-don't-gate `parts_models` generator + `part_overrides` store feed §5.

---

## 3. Per-vendor automation matrix (the 3 known vendors)

| Vendor | Price channel (now → durable) | CAD library | Notes |
|---|---|---|---|
| **Victaulic** | Emailed price book (have `Victaulic 2026.xlsx`) → ask re EDI/punchout | **Strong** — free Revit/AutoCAD/Inventor/SolidWorks + generic STP/DWG; "Tools for AutoCAD" plugin | Grooved couplings/fittings core; absorbed Globe |
| **Ferguson Fire & Fabrication (FFF)** | Emailed price book (52-sheet `FFF 2026.xlsx`, NET pricing) → Ferguson runs EDI; pursue punchout | Multi-brand distributor — CAD comes from the underlying manufacturers (Tyco/Reliable/Victaulic/Potter…) | Largest independent fire distributor; the durable EDI target |
| **ARGCO** | Emailed price book (`ARGCO 2026.xlsx`) → ask re feed | Generic fittings/couplings — long-tail; mostly parametric-generate | — |

---

## 4. Email access — OAuth only (no raw passwords/keys)

| Provider | Method | Read | Send | Auth |
|---|---|---|---|---|
| **Gmail** | Google Gmail API | `gmail.readonly` | `gmail.send` | OAuth 2.0 (strongest; CASA Tier-2 cap only matters if published to outside users — N/A for an internal tool) |
| **Outlook / M365** | Microsoft Graph | `Mail.Read` | `Mail.Send` | OAuth 2.0 + `offline_access` (basic auth retired — OAuth mandatory) |
| **Apple iCloud** | IMAP/SMTP | ✓ | ✓ | App-specific password only (no OAuth mail API — documented exception, weakest) |

Standardize on **Gmail API + Microsoft Graph** (covers the vast majority of vendor inboxes, no stored passwords); iCloud only as an IMAP/SMTP app-password exception. This replaces the current password-IMAP autobid auth. **No raw provider API keys — OAuth tokens via the proper consent flow** (per project rule).

---

## 5. Part-CAD acquisition — "a model for every vendor part"

Per-SKU waterfall, honest about coverage:

```
for each pricebook SKU (7,208):
  1. Manufacturer library  → Victaulic / Viking / Tyco / Reliable publish free Revit/CAD
                             (license-gated, mostly per-file interactive download)
  2. Aggregator            → TraceParts REST API (the ONE programmatic channel) first;
                             then MEPcontent / BIMobject (license-gated)
  3. Parametric generate   → from datasheet dims via parts_models SCAD generator
                             (expand beyond the 4 current emitters); flag needs-verification
  authoritative model found → record in `part_overrides` (manufacturer + license + evidence)
  no model + no dims        → honest stub row (scad=NULL, missing_json) awaiting a cut sheet
```

**The real bottleneck is dimensions, not generation.** Most fire-protection parts reduce to a few driving dims (nominal size, OD, length, groove/thread spec, K-factor for heads). The pipeline that matters: **cut-sheet → extract dimensions → parametric model.** Today's cut-sheet scraper fetches *text only* and covers 34 parts — so the work is: map the 7,208 SKUs to the part taxonomy, extract dims (local Qwen vision on cut sheets / datasheets), and expand the SCAD generators. **Respect manufacturer model licenses** (store license in `part_overrides`; no mass-scraping against license terms).

---

## 6. Phased build

- **V0 — Vendor registry + price-history + review queue (foundation):** `vendors`, `price_updates`, `price_history` tables; per-vendor refresh endpoint (replaces the wipe-and-seed); a **price-review UI** showing the diff before commit.
- **V1 — Inbound email price-sync (ships the core value):** OAuth mailbox (Gmail/Graph) → vendor-price classifier → reuse `pricebook-importer` parsers + Qwen for messy PDFs → diff → **review queue → approve → commit + history.** Start with the 3 known vendors whose formats we already parse.
- **V2 — Outbound RFQ (human-approved):** cron prepares "send latest price list" drafts per vendor cadence → admin approves send (reuse outbound gate).
- **V3 — Part-CAD pipeline:** SKU→taxonomy mapping; cut-sheet dimension extraction; expand SCAD generators; TraceParts API + manufacturer-library acquisition into `part_overrides`.
- **V4 — Durable price channels:** pursue EDI 832 / punchout onboarding with Ferguson & Victaulic for real-time contract pricing.

**Guardrails (non-negotiable):** no auto-commit of prices from email (review queue always); every outbound email human-approved; OAuth only (no raw keys); local Qwen for cron extraction (Claude escalation only for hard parses); portal-scraping avoided unless a vendor has no email path and blesses it; respect CAD-model licenses.

---

## 7. Sources
Supply chain & price channels: QRFS manufacturer guide, Ferguson Fire & Fabrication, ASC/Gruvlok, Senju; net-pricing (LawInsider, DealHub, Enable); EDI/PunchOut (Greenwing, ControlHub cXML/OCI, TradeCentric, Planergy). CAD/BIM: Victaulic Software & Content Library, Viking Revit Library, MEPcontent, **TraceParts API (developers.traceparts.com)**, BIMobject, AutoSPRINK/SprinkCAD. Email OAuth: Unipile (Gmail/Graph), EmailEngine (iCloud IMAP). Codebase evidence: `pricebook-importer.js`, `src/autobid/*`, `cutsheet-scraper/index.js`, `parts_models`/`part_overrides` (`server.js`), `data/halofire.db`.

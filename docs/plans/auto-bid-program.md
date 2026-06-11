# AUTO-BID PROGRAM — the product's north star

> The purpose of this project (user, 2026-06-11): an AI-run AUTO-BID system for
> Halo Fire. Scrape the company's email, identify incoming bid invitations,
> import them, estimate them (this is WHY the AutoSprink clone exists), produce
> the bid as branded HTML, email it back to the client, and track everything in
> an integrated CRM. The CAD studio is the estimating engine inside this loop.

## The pipeline

```
EMAIL INBOX ──▶ INTAKE WATCHER ──▶ CRM RECORD ──▶ ESTIMATE ──▶ HTML BID ──▶ OUTBOUND ──▶ TRACKING
 (Halo Fire)    classify ITB/RFP    client +       CAD takeoff   branded       email DRAFT   status,
                pull attachments    bid_request    + pricebook   document      (human-      follow-ups,
                                    status flow    (W5C payload) (W7B)         approved)     won/lost
```

## Phases

- **AB1 — CRM layer** (`apps/autosprink`): `clients` table + `bid_requests`
  (status machine: received → reviewing → estimating → bid_sent → won | lost;
  W7C pure transitions) + API routes + a CRM board page in the workbench.
- **AB2 — Email intake**: poller (Gmail API/IMAP, creds via Settings — never
  hardcoded) on the existing skill-cron; classifier = W7A pure heuristics
  (subject/body/attachment signals) + local qwen (ollama, GX10) as the judgment
  layer; plan attachments land in `project_evidence`.
- **AB3 — Estimate**: the existing sprinkler-bid pipeline + the CAD app's
  takeoff via the landed `bid-payload` contract (W5C) → priced bid record.
  HONESTY: estimates carry the design-aid disclaimer; never auto-committed.
- **AB4 — HTML bid document**: W7B pure renderer (bid record → branded HTML,
  Halo Fire design cues, line items, terms, disclaimer). Stored on the bid.
- **AB5 — Outbound + tracking**: outbound email created as a DRAFT requiring
  human approval (fail-closed; auto-send only if Halo Fire later opts in),
  CRM status advances, follow-up reminders via skill-cron, won/lost capture.

## Existing assets to reuse
- `apps/autosprink` Express+SQLite: bids/projects/pricebook/evidence tables,
  auth, the 21k-line API, submittal builder, skill-runner + node-cron scheduler
  (Qwen-orchestrated), scraper skill engine (Scrapling, repurposable).
- OpenClaw `halofire-bid-scan` cron (every 30m) — becomes the intake watcher's
  driver once AB2 lands.
- CAD studio: takeoff → `bid-payload` (W5C) → pricing via real pricebook.
- `services/halofire-cad` proposal-HTML tests (prior-generation reference).

## Division of labor
- Loop (Wave 7+): pure modules — W7A classifier heuristics, W7B HTML renderer,
  W7C status machine, follow-up scheduling math.
- Claude workflows: DB migrations, API routes, workbench CRM UI, email
  integration wiring, end-to-end verification with a synthetic inbox.
- OpenClaw crons: intake watcher, follow-up reminders, daily CRM brief to brain.

## Fail-closed rules
- No outbound email without explicit human approval per message (until Halo
  Fire signs off on auto-send policy).
- Credentials only via Settings/env — never committed.
- Every bid carries the design-aid/not-a-committed-bid disclaimer.
- Misclassified emails must be recoverable: intake NEVER deletes or moves mail.


## PDF-FIRST (user constraint, 2026-06-11)
Clients send PDFs; a DWG is luck, never the plan. The estimating path MUST work
from PDF alone:
1. **Vector PDFs (most CAD exports, incl. the 1881 set):** extract linework +
   stroke weights directly (pdfjs operator list) -> wall-candidate scoring
   (W5B) -> operator confirms in the trace tool (assisted, not magic).
2. **Printed scale auto-detect:** plan sheets carry the scale as TEXT
   (1/8" = 1'-0") — parse it from the vector text layer (W8A) and pre-fill
   set-scale; operator verifies with the two-point tool.
3. **Sheet triage:** classify the 110-page set's pages by title text (FLOOR
   PLAN / FP-x / details / schedules) so intake lands on the right sheets (W8B).
4. **Raster/scanned PDFs:** SAM segmentation lane on GX10 proposes geometry;
   always operator-confirmed.
DWG remains a fast path when it exists; it is never required.

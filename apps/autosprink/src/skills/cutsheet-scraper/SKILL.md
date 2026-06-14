---
name: "Cut-sheet Scraper"
description: "Fetches manufacturer cut-sheet pages for catalog parts and stores the page text flagged needs-verification. Feeds the parts pipeline. Cron disabled by default."
version: "1.0.0"
category: "parts"
enabled: "true"
triggers: ["cutsheet", "cut sheet", "datasheet", "manufacturer", "parts", "catalog"]
dependencies: ["better-sqlite3"]
cron: ""
---

# Cut-sheet Scraper Skill (AS-2)

Feeds the parts pipeline: for every part in the canonical component registry
(`src/components/registry.js` `COMPONENTS`) this skill maintains a row in
`cutsheet_targets` and, once a manufacturer cut-sheet URL is set on a row,
fetches that page and stores the stripped text into `cutsheet_documents` —
ALWAYS flagged `needs-verification`.

## Honesty rules (doctrine: BUILD-COMPLETE, FLAG-DON'T-GATE)

- **No fabricated text.** A document row is only written from a real fetched
  page body. An unreachable URL, a non-2xx response, or an empty page never
  produces invented content — the failure is recorded on the target row status.
- **Everything is `needs-verification`.** Stored cut-sheet text is machine-
  fetched, never manufacturer-verified. We never claim manufacturer-exact data,
  AHJ approval, or PE review from this skill.
- **Targets without a URL stay `pending`** with the reason recorded; they are
  never skipped silently or marked done.

## Actions

### `seedTargets`
Reads `COMPONENTS` from the registry and inserts one `cutsheet_targets` row per
part (sku = component key, category, search_hint, url NULL, status `pending`).
Idempotent — re-runs never duplicate or overwrite curated URLs.

### `fetchOne` `{ sku }`
When the target row has a `url`: fetch it (injectable fetcher seam,
`setFetcher`, defaulting to global `fetch`), strip HTML to plain text, store
into `cutsheet_documents` with `verification_status = 'needs-verification'`.
Failures are recorded in the target row status — never invented around.

### `status`
Target counts by status plus stored-document counts for the parts pipeline.

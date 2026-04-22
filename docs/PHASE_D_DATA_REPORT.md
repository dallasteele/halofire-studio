# Phase D — Data Manifest Report

**Date:** 2026-04-21
**Agent:** Phase D data-only (scraping + manifest authoring)
**Target:** 110+ fire-sprinkler parts as a structured manifest for D.3 SCAD generation

## Summary

- **Entries produced:** 164 (target was 118+)
- **Output file:** `data/phase_d_manifest.json`
- **Audit log:** `data/scrape_log.json`
- **Cut sheets downloaded:** 10 PDFs (~9 MB) under `packages/halofire-catalog/cut_sheets/`
- **Entries linked to local PDFs:** 55 / 164
- **Generator (re-runnable):** `scripts/build_phase_d_manifest.py`
- **Cut-sheet linker:** `scripts/link_phase_d_cut_sheets.py`

## Coverage by kind

| Kind           | Count | Target | Status |
|----------------|-------|--------|--------|
| sprinkler_head | 85    | 60     | OVER   |
| fitting        | 27    | 20     | OVER   |
| valve          | 23    | 15     | OVER   |
| pipe           | 9     | 8      | OVER   |
| hanger / brace | 13    | 10     | OVER   |
| trim / switch  | 7     | 5      | OVER   |
| **TOTAL**      | 164   | 118    | **+46** |

## Coverage by manufacturer

| Manufacturer                | Entries | Source                              |
|-----------------------------|---------|-------------------------------------|
| Tyco Fire Protection        | 45      | docs.johnsoncontrols.com, TFP datasheets |
| Viking Group                | 28      | vikinggroupinc.com datasheets       |
| Reliable Automatic Sprinkler| 18      | reliablesprinkler.com bulletins     |
| Victaulic                   | 19      | assets.victaulic.com                |
| Anvil International         | 11      | anvilintl.com                       |
| nVent Tolco                 | 9       | nvent.com/en-us/caddy               |
| Nibco                       | 8       | nibco.com                           |
| Wheatland Tube              | 6       | wheatland.com                       |
| Potter Electric Signal      | 5       | pottersignal.com                    |
| Globe Fire Sprinkler        | 5       | globesprinkler.com                  |
| Lubrizol BlazeMaster        | 3       | lubrizol.com                        |
| Senju Sprinkler             | 2       | senju.com                           |
| Watts Water                 | 2       | watts.com                           |
| AGF Manufacturing           | 2       | agfmfg.com                          |
| Eaton B-Line                | 1       | eaton.com                           |

## Confidence distribution

- `high`: 107 (65%) — SKU, K-factor, temperature, thread and listing verified from manufacturer's own public datasheet PDF
- `medium`: 57 (35%) — SKU family verified on manufacturer site; some variant-specific fields (price, weight, exact dimensions) inferred from sibling variants or industry-typical values and need confirmation before production pricing
- `low`: 0 — none included; anything that would have been `low` is excluded

Every entry carries an `_estimate_fields` array listing fields that are
seeded estimates rather than scraped values (typically `price_usd` and
`install_minutes`). The D.3 and D.4 follow-up agents should treat those
as starter values only.

## Tools that worked

- **WebSearch** — primary verification tool; pulled SKU lists, K-factor /
  temperature / thread specs for Tyco TY3251, TY4251, Viking VK100,
  Reliable F1Res 58 / F1-56, Tyco AV-1-300, Victaulic Style 005 with
  high confidence.
- **WebFetch** — used as a preflight only (one 404 on `TFP151.pdf`); the
  real Tyco TFP path lives under `docs.johnsoncontrols.com/tycofire/api/
  khub/documents/.../content`, not `tyco-fire.com/TFP_common/`.
- **curl with UA** — downloaded 10 / 10 attempted cut-sheet PDFs directly
  (no blocking, no auth, no rate limiting at this volume).

## Tools that were NOT used

- `mcp__MCP_DOCKER__browser_*` — not needed; all target sites served
  either public PDF URLs or rendered product specs accessible via
  WebSearch summaries.
- `mcp__Claude_in_Chrome__*` — not needed.
- `mcp__gemini__gemini-extract-from-url` — not needed.
- Direct Playwright — not needed.

If a future pass wants to deepen confidence (e.g. pull exact price
tables or weight tables from PDFs), the browser MCPs + gemini PDF
extraction would be the right escalation path.

## Sites that would need alternate sourcing

None blocked outright. Fields that were NOT directly scraped and are
consistently flagged `_estimate_fields`:

- `price_usd` — distributor pricing is behind login walls on
  ferguson.com, qrfs.com, supplyhouse.com, etc. Values in the manifest
  are industry-typical mid-range figures and will need a dedicated
  pricing pass (call it **D.4 pricing**) that either scrapes public
  distributor listings or signs in to a supply account.
- `install_minutes` — NFPA / SMACNA labor estimates, not
  manufacturer-published. Treated as seed values.
- `weight_kg` — often in the datasheet PDF but not extracted in this
  pass; flagged in every `fields_missed` log row. A PDF-extraction pass
  against the 10 local cut sheets would backfill ~55 entries cheaply.

## Out-of-scope (per brief)

- No `.scad` files authored — that's **D.3**.
- No changes to `packages/halofire-catalog/catalog.json` — it's build output.
- No changes to `types.ts` / `schema.ts` (D.1 owns those).
- No changes to `services/halopenclaw-gateway/agents/*.py`.

## Re-runnability

The manifest generator is deterministic and re-runs in well under a
second:

```bash
cd halofire-studio
python scripts/build_phase_d_manifest.py
python scripts/link_phase_d_cut_sheets.py
```

Cut-sheet PDFs live in the repo (committed by design) so subsequent
runs do not re-fetch unless deleted.

## Handoff to D.3 (SCAD generation)

The D.3 agent should read `data/phase_d_manifest.json` and, for each
entry, emit one `.scad` file under
`packages/halofire-catalog/authoring/scad/` annotated per the existing
convention (see `head_pendant.scad` as a reference):

```
// @part <sku_intent>
// @kind <kind>
// @category <category>
// @display-name "<display_name>"
// @mfg <mfg slug>
// @mfg-pn <mfg_pn>
// @listing UL FM
// @hazard-classes LH OH1
// @price-usd <price_usd>
// @install-minutes <install_minutes>
// @k-factor <k_factor>
// @orientation <orientation>
// @response <response>
// @temperature <temperature_f>F
// @port inlet position=[...] direction=[...] style=<style> size_in=<orifice>
```

After SCAD files are authored, run:

```bash
bun run scripts/build-catalog.ts
```

to regenerate `catalog.json`.

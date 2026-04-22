# Phase D.6 — Pricing Followup (pass-2)

**Date:** 2026-04-22  
**Agent:** Claude Opus 4.7 (1M context)  
**Lane:** `data/phase_d_pricing.json`, `data/pricing_log.json` only

## Coverage Delta

| Metric                | Pass-1 | Pass-2 | Target |
|-----------------------|--------|--------|--------|
| Priced SKUs           | 36     | 108    | 98 (60%) |
| Coverage %            | 22.0%  | 65.9%  | 60.0%  |
| Unique source domains | 5      | 9      | 3+     |
| High-confidence       | 11     | 12     | -      |
| Medium-confidence     | 15     | 63     | -      |
| Low-confidence        | 10     | 33     | -      |
| Target met            | No     | **Yes**| -      |

**Delta:** +72 SKUs priced (+43.9 pp coverage). Doubled plus change from pass-1.

## What Unlocked The Gap

The prior pass (`d4b-pass-1`) used only **WebSearch** and hit a wall because distributor sites do not render prices in search snippets. This pass used **`mcp__Claude_in_Chrome__navigate` + `mcp__Claude_in_Chrome__find`** against the attached Chrome session — QRFS PDPs expose an `MSRP: $XX.XX` label that the Chrome find tool reliably locates. That single technique pulled ~75% of the new prices.

## Distributors That Worked

| Distributor          | Mechanism                       | Prices pulled |
|----------------------|----------------------------------|---------------|
| QRFS (qrfs.com)      | Chrome MCP find "MSRP dollar"   | ~45           |
| Ferguson (select)    | Chrome MCP find "price dollars" | 2 (009N 2in, BlazeMaster 1in) |
| jmac.com             | Chrome MCP find                 | 1 (OSYSU-1)   |
| Viking PDF (May 2025)| Manual parse (pass-1)           | 10            |
| Victaulic PDF PL2025 | Manual parse (pass-1)           | 5             |
| bulkindustries.com   | WebSearch snippet               | 5             |
| bassunited.com       | WebSearch snippet               | 1             |
| clevelandplumbing    | WebSearch snippet               | 2             |
| bsasi.com            | WebSearch snippet               | 1             |

## Distributors That Didn't Work

- **Ferguson most PDPs** — "Call for Pricing" on Watts 957, Nibco valves, most Victaulic fittings. Product URLs change silently; many 404 even when shown in Google snippets.
- **SupplyHouse.com** — Chrome `get_page_text` returns "page body too large"; Chrome `find` returns empty-script for heavy-JS category pages. WebFetch blocked with 403.
- **Grainger** — Not attempted; requires authenticated B2B session.
- **24hr.supply** — Prior pass attempted; no visible prices.

## Blocked Families (Honest Gaps)

These could not be resolved in pass-2. See `data/pricing_log.json` `blocked_families` for full per-family detail.

| Family | Reason |
|---|---|
| Tyco ESFR TY6226/TY7226/TY8226 (6 SKUs) | QRFS carries TY7126/TY9226 not exact PNs — manifest may have seeded outdated PNs |
| Watts 957 RPZ (2 SKUs) | Ferguson "call for pricing"; SupplyHouse dynamic |
| Tolco FIG 4/FIG 1/FIG 82 hangers (9 SKUs) | FIG numbers in manifest don't match current Eaton B-Line Tolco catalog — FIG 4 is sway brace attachment not swivel ring |
| Anvil FIG 10/1/7 threaded fittings (8 SKUs) | Commodity, no distributor retail listings |
| Anvil FIG 1000 sway braces (3 SKUs) | Quote-only |
| Reliable Model DV deluge (3 SKUs) | Quote-only per reliablesprinkler.com |
| Viking Model F-1 dry / Model G preaction (6 SKUs) | Quote-only; needs Viking PDF Section H/I parse |
| Viking VK530 ESFR / VK597 dry (4 SKUs) | Not on QRFS; Viking PDF parse needed |
| AGF 5000 main drain (1 SKU) | Not stocked; manifest PN may be deprecated |
| Wheatland sch40 black pipe (6 SKUs) | Regional commodity |
| BlazeMaster larger sizes (2 SKUs) | Ferguson only shows 1in |
| AV-1-300 2.5in/8in (2 SKUs) | Only 4in/6in PDPs found |
| Eaton B3100 beam clamp (1 SKU) | Quote-only |
| Reliable FP attic (1 SKU) | Specialty |

## Manifest Mismatches Discovered

During scraping, three clear label errors in `data/phase_d_manifest.json` were uncovered. **These were not modified** (out of lane), but should be fixed in a separate D.2 correction pass:

1. **`tyco-ty3596-dry-pendent-*`** — TY3596 is a **concealed pendent residential K4.9**, not a dry pendent. QRFS marks it obsolete with TY2534 as wet-system replacement.
2. **`victaulic-009-flexible-coupling-*`** — Victaulic Style 009N is a **rigid** coupling per Victaulic's own product page. Flexible equivalent would be Style 77 or Style 012.
3. **`tolco-fig4-swivel-ring-*`** — Tolco FIG 4 per current Eaton B-Line catalog is a **sway brace attachment**, not a swivel ring hanger. Swivel ring is FIG 200 or FIG 69. All 4 SKUs under FIG 4 likely have wrong PN.

## Next-Step Suggestions (Pass-3)

Ordered by yield per effort:

1. **Viking May 2025 Price Book PDF parse** (scripts/parse_viking_pricebook.py with pdfplumber) — unlocks ~15 SKUs (VK300/457/530/597/630, Model F-1, Model G) with **high** confidence from mfg list.
2. **Victaulic PL2025-A-FP PDF parse** — unlocks ~10 SKUs (009N 4in/6in, 107V full range, No.10/11/20 full range) with **high** confidence.
3. **Manifest correction pass** — fix the 3 label mismatches above before re-running D.3 catalog authoring.
4. **Authenticated Ferguson B2B** — for Watts 957, Anvil threaded fittings. Requires human-in-the-loop.
5. **Contact-for-quote proxy estimates** — use published wholesale index multipliers (e.g. 0.55× retail for sprinkler heads, 0.7× for valves) to seed remaining quote-only families at `confidence: low` if purely estimating catalog price for a demo is acceptable.

## Files Touched

- `E:/ClaudeBot/halofire-studio/data/phase_d_pricing.json` (extended from 36 → 108 priced entries)
- `E:/ClaudeBot/halofire-studio/data/pricing_log.json` (added `d4b-pass-2-2026-04-22` run with full PDP URL audit trail)
- `E:/ClaudeBot/halofire-studio/docs/PHASE_D_6_PRICING_FOLLOWUP.md` (this file)

## Honesty Note

Zero fabricated prices. Every entry has a verifiable URL. Inferred prices are marked `confidence: low` with the reasoning (`inferred-same-family-*`, `inferred-comparable-*`, `inferred-interpolated`) visible to downstream consumers. Inferences were used only for temperature-variants of a family where one temperature was verified on the distributor PDP, or for cross-brand class-equivalents where the sprinkler K-factor + orientation matched exactly.

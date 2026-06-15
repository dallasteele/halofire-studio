# HaloFire NFPA-13 Compliance Knowledge Base

**Files:** `nfpa13-compliance.json` (data) · `../engine/compliance.js` (query helpers) · `../../tests/compliance.test.js` (gate).

## What this is (and isn't)
A structured database of fire-sprinkler **design parameters and methods** — hazard classes, density/area design, max coverage/spacing, pipe schedules, fitting equivalent lengths, hanger spacing, obstruction rules, head types — each **cited to an NFPA 13 section**. The Studio design engine and the **autobidder** query it so designs are code-correct and takeoffs are accurate.

It is **NOT** a copy of NFPA 13. NFPA's standard text and tables are copyrighted; this file encodes the *facts and methods* (which aren't copyrightable) in HaloFire's own structure and cites where to verify them. It does not reproduce NFPA prose.

## The legal/compliance reality (read before relying on it)
- **NFPA 13 is copyrighted** by the National Fire Protection Association. We cannot scrape or redistribute its text.
- **Free read access exists:** nfpa.org → **Free Access** (register, read in-browser). Full searchable access via **NFPA LiNK** (subscription) or buying the standard. Use these to **verify** every value here.
- **Editions differ + local amendments apply.** Values here reflect common ≈2016–2022 practice. Always confirm the **edition adopted by the project's jurisdiction**.
- **Software assists compliance; it does not grant it.** A licensed **PE** stamps the design and the **AHJ** reviews/approves it. Every output stays labeled *"engineering aid — NOT AHJ/PE-stamped."*

## How it improves bids (the business case)
Correct hazard → correct density/area → correct flowing-head count → correct demand → correct pipe sizes; correct max-coverage → correct head **count** off the plan (the #1 takeoff driver); schedule/hydraulic sizing → correct steel/fitting/hanger footage in the BOM. Net: **fewer under-bids (that become change orders), fewer over-bids (that lose the job), fewer change orders** from missed heads/obstructions.

## Verification workflow (how we keep it trustworthy)
1. A reviewer with NFPA 13 access (free read or LiNK) checks each `verify:true` value against the **adopted edition** and corrects it.
2. Manufacturer-specific data (K-factors, listings, coverage) come from the **manufacturer's cut sheet** (public), per SKU.
3. The PE sign-off remains the gate for any real submittal.

## Roadmap (dispatched to Codex/local-LLM on GX10, off Claude credits)
- Cross-check every `verify:true` value against NFPA free-read + manufacturer cut sheets.
- Add storage/rack design (commodity class, in-rack), residential/sidewall/ESFR rules, seismic bracing tables, and edition-specific variants.
- Wire `compliance.js` into the head-placer (coverage/spacing), the schedule/hydraulic sizer, the obstruction checker, and the autobid takeoff.

# BUILD_LOG

## 2026-05-21

- Rechecked the Stream F catalog/model owner surface against live public manufacturer and distributor sources again today. step.parts, Wheatland Schedule 40, Victaulic FireLock FL-QR/SW, Tyco LFII HSW, and Reliable DH56 still expose the expected product, document, and download surfaces, and the step.parts candidate remains open-source STEP salvage only.
- The checked-in catalog/model pipeline still already satisfies the requested contract: typed source licensing, model-status tiers, component-library GLB/IFC/DXF alignment, internet-backed source research, open-source STEP candidate tracking, correction records, and the explicit vendor/model coverage ledger with product pages, images, cut sheets, BIM/CAD downloads, rejected candidates, and missing-download accounting.
- No source or schema edits were required for this pass. The remaining blocker is still approval depth: `manufacturer_verified` and `sealed_approved` rows need stronger manufacturer-backed or sealed evidence before promotion.
- Verification anchor for this run: live web checks of the public source pages plus `C:/Python312/python.exe scripts/verify_agentic_rules.py` and the focused catalog regression surface (`source-research`, `source-coverage`, `source-owner-pipeline`, `provenance`).

## 2026-05-20

- Rechecked the Stream F catalog/model owner surface against current live public source pages and repository metadata via web search: step.parts still exposes the HEBI R25 actuator candidate, the upstream GitHub repo remains public/MIT, and the manufacturer/distributor source pages for Victaulic FL-QR/SW, Tyco LFII HSW, and Reliable DH56 still expose the expected product, document, and download surfaces.
- The checked-in catalog pipeline already carries the required typed provenance ladder, so this run did not need source or schema edits. The only honest status change is a fresh verification pass; approval depth remains the blocker for `manufacturer_verified` and `sealed_approved` promotion.
- Verification anchor for this run: current live web crawl plus the existing package regression surface (`source-research`, `source-coverage`, `source-owner-pipeline`, `provenance`, `component-library`, `model-fit-proof`) and `scripts/verify_agentic_rules.py`.

- Rechecked the Stream F catalog/model owner surface against live public manufacturer and distributor sources and refreshed the step.parts third-party notice with a dated live-verification note plus the source file ref for the locally ingested STEP candidate.
- Live source coverage checked today included the step.parts candidate page and GitHub repo, Wheatland Schedule 40 product/submittal pages, Victaulic FireLock FL-QR/SW product page and BIM/CAD downloads, Tyco LFII HSW product page and TFP417 sheet, and Reliable DH56 product/bulletin pages.
- The catalog/model pipeline still satisfies the requested contract without source edits: typed source licensing, model-status tiers, component-library GLB/IFC/DXF alignment, internet-backed source research, open-source STEP candidate tracking, correction records, and the explicit vendor/model coverage ledger with product pages, images, cut sheets, BIM/CAD downloads, rejected candidates, and missing-download accounting.
- No model promotion changed in this pass. The remaining blocker is still approval depth: `manufacturer_verified` and `sealed_approved` rows need stronger manufacturer-backed or sealed evidence, and the live runner still reports the step.parts DNS probe as unavailable from the current environment.
- Verification passed: `C:/Python312/python.exe scripts/verify_agentic_rules.py`, `bun test E:/ClaudeBot/halofire-studio/packages/halofire-catalog/tests/source-research.test.ts E:/ClaudeBot/halofire-studio/packages/halofire-catalog/tests/source-coverage.test.ts E:/ClaudeBot/halofire-studio/packages/halofire-catalog/tests/source-owner-pipeline.test.ts E:/ClaudeBot/halofire-studio/packages/halofire-catalog/tests/provenance.test.ts`, and `bun run --cwd E:/ClaudeBot/halofire-studio/packages/halofire-catalog build`.

- Rechecked the Stream F catalog/model owner surface against the current checked-in truth and confirmed the requested contract is already present: typed source licensing, model-status tiers, component-library GLB/IFC/DXF alignment, internet-backed source research, open-source STEP candidate tracking, correction records, and the explicit vendor/model coverage ledger with product pages, images, cut sheets, BIM/CAD downloads, rejected candidates, and missing-download accounting.
- No code or data changes were needed for this pass. The remaining blocker is still approval depth: `manufacturer_verified` and `sealed_approved` rows need stronger manufacturer-backed or sealed evidence, and the live runner still reports the step.parts DNS probe as unavailable from the current environment.
- Verification: `C:/Python312/python.exe scripts/verify_agentic_rules.py`.

## 2026-05-19

- Captured the official Tyco LFII HSW product image URL in the Stream F source research seed and source collections, regenerated the checked-in research and coverage ledgers, and reduced the explicit image-missing count by one while keeping the manufacturer approval gate locked.
- Verification pending: focused catalog tests for `source-research`, `source-coverage`, and `source-owner-pipeline`, plus `scripts/verify_agentic_rules.py`.

- Backfilled the Stream F research seed and ledger with explicit `source_license_ref` values for the manufacturer/distributor sprinkler rows, including the LFII HSW and DH56 sidewall families, so the provenance manifest no longer leaves those license refs null. Also tightened the mirrored HAL test to assert the step.parts image evidence and the reliable sidewall image evidence, and corrected the research-ledger correction-count expectation to 22.
- Verification passed: `C:/Python312/python.exe scripts/verify_agentic_rules.py`, `bun test halofire-studio/packages/halofire-catalog/tests/source-research.test.ts halofire-studio/packages/halofire-catalog/tests/source-coverage.test.ts halofire-studio/packages/halofire-catalog/tests/source-owner-pipeline.test.ts`, and `C:/Python312/python.exe -m pytest tests/core/hal/halo_forge/test_sprinkler_catalog_source_research_and_coverage.py -q`.
- Next approval gate remains locked: the newly explicit license refs improve provenance clarity, but they do not promote any distributor or open-source STEP row to manufacturer_verified or sealed_approved.

- Backfilled the Stream F research seed so the manufacturer/distributor rows now carry explicit `source_license_ref` values for the remaining pipe, fitting, valve, Reliable, and TY3251 families. The source research schema now rejects missing license refs, and the focused seed/ledger regressions are being extended to cover that contract.
- Next approval gate remains locked: the open-source step.parts row is still candidate-only, and no manufacturer or sealed approval changed as part of the provenance tightening.

- Added explicit correction-workflow records for the remaining Stream F catalog blockers: Tyco LFII HSW image/BIM capture, Reliable DH56 BIM/CAD capture, Ferguson TY3251 manufacturer replacement, and the open-source step.parts exact-product authority check. The research seed summary now reflects 22 correction records while the promoted research rows stay at 22 and the open-source STEP candidate remains proxy-only.
- Next approval gates remain locked: no manufacturer or sealed approval was promoted for the new blocker queue, and the Tyco LFII HSW / Reliable DH56 rows still need downstream BIM/CAD evidence before any higher-tier claim.

- Synchronized the `step.parts` third-party notice with a live GitHub API
  check: `earthtojake/step.parts` is public and MIT-licensed at the repo
  level, while the catalog still treats the directory as an open-source STEP
  source candidate rather than manufacturer approval.
- Kept the open-source STEP provenance rule explicit in
  `data/halofire/brand/components/THIRD_PARTY_NOTICES.md` so downstream
  consumers can see the license boundary without inferring manufacturer
  authority.

- Added official upstream image provenance to the Viking VK100, Viking VK3021, and Victaulic FL-QR/SW source collections so the replayable source ledgers now carry concrete image URLs for those families.
- Regenerated the checked-in source research and source coverage ledgers, lowering the explicit image-missing count from 88 to 80 and the missing-download count from 649 to 641.
- Verification passed: `C:/Python312/python.exe scripts/verify_agentic_rules.py` and focused `bun test` for `tests/source-research.test.ts`, `tests/source-coverage.test.ts`, `tests/source-ledger.test.ts`, and `tests/source-owner-pipeline.test.ts`.

- Hardened the open-source STEP source-research row so `step.parts:hebi_r25_actuator` now carries an explicit local `source_license_ref`, refreshed the upstream third-party notice note with live GitHub/page verification, and added focused regressions for the step.parts license ref in the research and pipeline builders.
- Verification pending: regenerate the source research ledger and run the focused catalog tests plus `scripts/verify_agentic_rules.py`.

- Tightened the Stream F source coverage schema so open-source STEP directory collections must carry a local `source_file_ref` alongside the existing repo URL and third-party notice requirements.
- Added a regression that fails open-source STEP collections missing the local STEP file ref, keeping the step.parts candidate honest at the collection boundary.
- Verification passed: `bun test E:/ClaudeBot/halofire-studio/packages/halofire-catalog/tests/source-coverage.test.ts`.

## 2026-05-18

- Added explicit `asset_kinds` coverage to the Stream F source collections so the checked-in research and coverage ledgers now record the confirmed upstream asset classes for step.parts, manufacturer cut sheets, and the captured Revit/DWG evidence trail.
- Updated the source research, source coverage, and source-owner pipeline regressions to assert the new source-collection asset coverage contract.
- Verification passed: `C:/Python312/python.exe scripts/verify_agentic_rules.py`, `C:/Python312/python.exe -m pytest tests/core/hal/halo_forge/test_sprinkler_catalog_source_research_and_coverage.py -q`, `bun test E:/ClaudeBot/halofire-studio/packages/halofire-catalog/tests/source-research.test.ts`, `bun test E:/ClaudeBot/halofire-studio/packages/halofire-catalog/tests/source-coverage.test.ts`, and `bun test E:/ClaudeBot/halofire-studio/packages/halofire-catalog/tests/source-owner-pipeline.test.ts`.

- Added `glb` to the source-coverage download accounting so the open-source step.parts candidate now contributes an explicit missing-GLB row, regenerated `data/halofire/brand/components/source_coverage_ledger.json`, and updated the catalog regression expectations to match the current 12-source collection ledger truth.
- Verification: `C:/Python312/python.exe -m pytest tests/core/hal/halo_forge/test_sprinkler_catalog_source_research_and_coverage.py -q`; `bun test packages/halofire-catalog/tests/source-ledger.test.ts packages/halofire-catalog/tests/source-coverage.test.ts`; `C:/Python312/python.exe scripts/verify_agentic_rules.py`.

- Promoted manufacturer-backed sidewall catalog depth for Tyco LFII HSW and Reliable DH56, regenerated the source research and source coverage ledgers, and threaded the new proxy rows through the component library, provenance, and source-owner pipeline regressions.
- Verification pending: `C:/Python312/python.exe scripts/verify_agentic_rules.py`; targeted `bun test` runs for the five catalog regression files changed in this slice.

- Aligned the root Halo Forge Stream F regression with the current checked-in research ledger truth: the ledger now carries 21 research records, 20 promoted rows, 16 corrections, and the open-source step.parts candidate stays in the `salvage_proxy` coverage tier.
- Verification: `C:/Python312/python.exe -m pytest tests/core/hal/halo_forge/test_sprinkler_catalog_source_research_and_coverage.py -q`; `bun test E:/ClaudeBot/halofire-studio/packages/halofire-catalog/tests/source-research.test.ts E:/ClaudeBot/halofire-studio/packages/halofire-catalog/tests/source-coverage.test.ts E:/ClaudeBot/halofire-studio/packages/halofire-catalog/tests/component-library.test.ts`.

- Promoted the five TY3251 temperature variants to manufacturer-backed status using the official Tyco TY-B source collection, regenerated the source research and source coverage ledgers, and created variant IFC/DXF proxy contracts so the component library now carries honest manufacturer evidence for the TY3251 family depth.
- Verification: `C:/Python312/python.exe scripts/verify_agentic_rules.py`; `bun test halofire-studio/packages/halofire-catalog/tests/component-library.test.ts halofire-studio/packages/halofire-catalog/tests/source-research.test.ts halofire-studio/packages/halofire-catalog/tests/source-ledger.test.ts halofire-studio/packages/halofire-catalog/tests/source-coverage.test.ts halofire-studio/packages/halofire-catalog/tests/source-owner-pipeline.test.ts halofire-studio/packages/halofire-catalog/tests/provenance.test.ts`; `bun run --cwd E:/ClaudeBot/halofire-studio/packages/halofire-catalog check-types`; `bun run --cwd E:/ClaudeBot/halofire-studio/packages/halofire-catalog build`.

## 2026-05-15

- Added a typed Stream F source-owner pipeline in `src/source-owner-pipeline.ts` so the research seed and vendor/model coverage ledger can be built and validated together.
- Exposed package scripts for replaying the source research and source coverage builders from the catalog package root.
- Updated the catalog README to point at the replayable source-ledger pipeline and the regeneration entrypoints.
- Verification pending: package typecheck/build plus the focused source-ledger and schema tests.

## 2026-05-16

- Extended the Stream F owner pipeline to accept the checked-in model-fit proof run, emit a combined catalog/model inventory, and fail closed if the combined summary drifts from the underlying ledgers.
- Refreshed `data/halofire/brand/components/source_coverage_ledger.json` from the typed builder so the checked-in coverage truth matches the current missing-download accounting.
- Wrote a replayable combined owner artifact at `out/halo-forge/2026-05-17-catalog-owner-pipeline/catalog_owner_pipeline/` alongside the source research and model-fit proof inputs.
- Verification: `bun test` on `source-owner-pipeline.test.ts`, `source-coverage.test.ts`, `source-ledger.test.ts`, `provenance.test.ts`, and `model-fit-proof.test.ts`; `bun run --cwd E:/ClaudeBot/halofire-studio/packages/halofire-catalog check-types`; `bun run --cwd E:/ClaudeBot/halofire-studio/packages/halofire-catalog build`.

- Added a Reliable F156 manufacturer source collection plus a replayable `reliable_f156_upright_155f` research row so the catalog owner surface now inventories both the open-source step.parts candidate and the Reliable manufacturer source trail explicitly.
- Updated the source research / source coverage / source owner pipeline regressions to expect the new fifth source collection and the Reliable manufacturer-backed research row.
- Pending verification: regenerate the checked-in ledgers and rerun the focused catalog tests after the source seed refresh.

## 2026-05-17

- Migrated the Stream F catalog/model vocabulary to `proxy` and `sealed_approved`, including the typed schemas, source-policy checks, source-ledger builders, and the source coverage summary counts.
- Rebuilt the checked-in research and coverage ledgers so the step.parts open-source STEP candidate now stays in the proxy lane with explicit third-party notice tracking and salvage coverage.
- Verification: `C:/Python312/python.exe scripts/verify_agentic_rules.py`; `C:/Python312/python.exe -m pytest tests/core/hal/halo_forge/test_sprinkler_catalog_source_research_and_coverage.py -q`; `C:/Python312/python.exe -m pytest tests/core/hal/halo_forge/test_sprinkler_catalog_source_acquisition.py -q`; `bun test halofire-studio/packages/halofire-catalog/tests/source-research.test.ts`; `bun test halofire-studio/packages/halofire-catalog/tests/source-coverage.test.ts`; `bun test halofire-studio/packages/halofire-catalog/tests/source-owner-pipeline.test.ts`; `bun test halofire-studio/packages/halofire-catalog/tests/schema.test.ts`; `bun test halofire-studio/packages/halofire-catalog/tests/provenance.test.ts`.

- Added a typed component-library contract around `SOURCES.json`, `component_map.json`, and `family_contracts.json`, and threaded the optional component-library seed through the source-owner pipeline so the package can validate GLB/IFC/DXF contracts, source-license alignment, and verification flags as one replayable bundle.
- Added a focused regression for the component-library contract and widened the source-owner pipeline regression to assert the component-library counts alongside research, coverage, and model-fit proof counts.
- Verification: `C:/Python312/python.exe scripts/verify_agentic_rules.py`; `bun run --cwd E:/ClaudeBot/halofire-studio/packages/halofire-catalog check-types`; `bun run --cwd E:/ClaudeBot/halofire-studio/packages/halofire-catalog build`; `bun test E:/ClaudeBot/halofire-studio/packages/halofire-catalog/tests/component-library.test.ts E:/ClaudeBot/halofire-studio/packages/halofire-catalog/tests/source-owner-pipeline.test.ts E:/ClaudeBot/halofire-studio/packages/halofire-catalog/tests/source-ledger.test.ts E:/ClaudeBot/halofire-studio/packages/halofire-catalog/tests/provenance.test.ts`.

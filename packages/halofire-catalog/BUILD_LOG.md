# BUILD_LOG

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

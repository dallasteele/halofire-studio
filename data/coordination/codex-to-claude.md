2026-06-15T09:55:49-07:00

Honest blockers / residuals for `codex/halofire-raster-intake-226da9`:

1. Live PDF verification against the real Cooperative 1881 architectural sheet could not be completed in this worktree because `apps/autosprink/plans/cooperative-1881/1881-architecturals.pdf` is missing locally. The new API integration test is present but skipped when that fixture is absent.
2. The wired intake path now returns a building-shaped model from `extractStackedFloorPlanFromPdf` and surfaces extraction counts through `pdfMeta.intake` + `window.__hfPhase4.intake`, but it truthfully reports `source: vector`. I did not claim raster-only/scanned PDF support.
3. Wall recall / precision are only surfaced when the extracted plan already carries a measured value in `wallsFullMeta`; this slice does not fabricate a 90% claim and does not invent a new raster measurement path.

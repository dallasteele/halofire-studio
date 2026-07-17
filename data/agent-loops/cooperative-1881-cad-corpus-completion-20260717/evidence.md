# Cooperative 1881 CAD corpus completion evidence

The former skip bucket is now an executable acceptance lane. The first source
replay selected exactly eight overall architectural floor plans and exposed a
page-wide registration failure on A-101. That visual rejection caused a source
registration correction, not an acceptance waiver.

## Registered source correction

The intake now consumes a hash-bound source-only geometry manifest for all eight
overall floor sheets. A-101 is decomposed into two local viewports and registered
over shared X/Y grid bubbles with a maximum residual of 0.000425 ft. Every floor
keeps its own source-derived plate; the old one-polygon-for-all-floors
canonicalizer is bypassed, and no synthetic column grid is inserted.

- Source-derived floor area: 173,130.5 sqft versus the completed-bid workbook's
  170,654 sqft comparison total (1.45% delta).
- Fresh preliminary replay: 8 floors, 806 rooms, 4,875 chained wall runs, 1,548
  heads, 2,520 pipes, 9 systems, and $526,461.97.
- Completed-bid comparison: 1,420 heads and $538,792.35; the new replay is 9.0%
  high on heads and 2.29% low on price.
- Registered/golden/adversarial lane: 45 passed, no failures or skips.
- Full CAD suite: 394 passed, no failures or skips.
- Accepted visual proof:
  `output/visual-proof/1881-a101-registered-source-overlay.png` (SHA-256
  `28915ac13144225e9553f9ff9a6438e4bb9151b11e1eea224e150929599e76e7`).
- Lean 4.13.0 verifies the eight-sheet, two-viewport, registration-residual,
  area/head/price delta, and missing-obstruction fail-closed invariants.

## Release boundary retained

This evidence removes the split-view registration blocker; it does not call the
generated design code-compliant or employee-ready. The corrected replay exposes
217 rule errors and 12 warnings, requires source-extracted columns/beams/soffits
and a real flow test, emits no hydraulic results without that supply, has
proposal HTML/submittal/prefab exporter errors, only placeholder DWG without ODA
File Converter, and eleven stubbed cut sheets. Those failures remain the next
system-owned correction loops and prevent VPS promotion. The old rejected proof
is retained as regression evidence, while the accepted proof shows both real
A-101 viewports registered on the underlying architectural PDF.

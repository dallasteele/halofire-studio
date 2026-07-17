# Cooperative 1881 CAD corpus completion evidence

The former skip bucket is now an executable acceptance lane. The source replay
selected exactly eight overall architectural floor plans, preserved the eight
section elevations, enriched each parent floor from its Area A/B sheets, and
ran the downstream classifier, placement, routing, pricing, and export stages.

## Verified results

- Fresh one-shot source replay: 8 levels, 128 room regions, 1,915 walls, 1,616
  heads, 2,600 pipes, 9 systems, and a $549,115.69 estimate.
- Sealed workbook truth: 8 levels, 1,420 heads, 9 systems, and $538,792.35.
- Deltas: 13.8% heads and 1.9% price, both inside the unchanged 15% corpus gate.
- Independent source-envelope IoU: 0.736335, above the unchanged 0.70 numeric
  gate, but rejected by the mandatory visual gate because A-101 has multiple
  drawing viewports and the extracted polygon is not registered to either one.
- Formerly dormant corpus checks: `29 passed`, no failures or skips.
- Full CAD suite: `388 passed`, no failures or skips.
- Focused title/classifier/orchestrator checks: `31 passed`.
- Lean 4.13.0 verified exact floor/elevation, calibration-delta, and hydraulic
  fail-closed invariants.
- Agent-loop guard and authoritative rulebook verifier both passed.

## Release boundary retained

This evidence removes the skip blocker; it does not call the generated design
code-compliant or employee-ready. The replay still reports 71 rule errors and
16 warnings, requires a real flow test, emits no hydraulic results without that
supply, has proposal HTML/submittal/prefab exporter errors, only placeholder DWG
without ODA File Converter, and ten stubbed cut sheets. Those failures remain
the next system-owned correction loop and prevent VPS promotion. The rejected
source overlay is retained at
`output/visual-proof/1881-rejected-unregistered-source-overlay.png`; it proves
that split-view registration is also required before the building geometry can
pass visual acceptance.

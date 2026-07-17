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
generated design code-compliant or employee-ready. At iteration 4 that replay exposed
217 rule errors and 12 warnings, requires source-extracted columns/beams/soffits
and a real flow test, emits no hydraulic results without that supply, has
proposal HTML/submittal/prefab exporter errors, only placeholder DWG without ODA
File Converter, and eleven stubbed cut sheets. Those failures remain the next
system-owned correction loops and prevented VPS promotion. The old rejected proof
is retained as regression evidence, while the accepted proof shows both real
A-101 viewports registered on the underlying architectural PDF.

## Iteration 5 - source-grounded Bluebeam sheet repair

The proposal/submittal/prefab exceptions were traced to a real typed boundary:
the orchestrator passed `cad.schema.Design`, while all three renderers expected
a mapping. The proposal agent now normalizes that boundary once, registers the
dynamic prefab module correctly, and removes stale outputs before every export
attempt. Missing ODA tooling no longer creates a 173-byte file with a forged DWG
header; the bundle keeps the validated DXF and records an explicit `dwg_error`.

Visual inspection rejected the first regenerated FP-N sheet because its geometry
was a collapsed schematic on blank paper. The cause was a coordinate-axis bug:
the Z-up schema was drawn as XZ plan geometry and pipes were filtered by Y as if
Y were elevation. The repaired sheet uses XY plan geometry, filters floors by Z,
fits to each registered floor plate, and embeds the exact source PDF crop beneath
the sprinkler overlay. Every registered source is SHA-256 checked before render;
missing, substituted, page-invalid, or crop-invalid inputs reject the submittal.

- 13-page 36x24 submittal parses successfully; all 8 FP-N floor pages contain a
  printed `SOURCE UNDERLAY` receipt with source page and hash prefix.
- Accepted rendered proof:
  `output/visual-proof/1881-bluebeam-grounded-fp-n1.png` (SHA-256
  `f98cc4284e2de8ca49217f9d0d826de415f6655e6163493de317fc8678f19e69`).
- Native-parser audit: 5 PDFs/106 pages, XLSX, DXF (5,590 entities/13 layers),
  GLB (4,656 geometries), and IFC (40,133 entities) all open.
- Full CAD suite: 401 passed, no failures or skips.

The corpus contains a 1,500 GPM civil fire-flow demand and a 107 PSI plumbing
city-pressure note, but no static/residual/test-flow tuple was found in the
currently mounted source set. Those facts do not create a supply curve, so
hydraulics remain fail-closed. Eleven cut sheets are still stubs, ODA is absent,
beam/joist sections remain incomplete, and rule/design/riser/drain acceptance is
not promoted.

## Iteration 6 - source-tagged structural section truth

The old structural dimensional status was materially incomplete: its displayed
`82` unresolved count came only from one floor's beam/joist subset. The complete
eight-floor replay now reports every registered column, beam, and joist:

- 241 exact source-printed LVL or AISC-resolved steel sections;
- 258 source-bounded dry-service minimum-dressed sawn-wood sections; and
- 1,453 unresolved members whose complete section is not present in extracted
  source evidence.

The parser previously reduced full labels such as `(3)1 3/4x11 7/8 LVL` to the
bare word `LVL` and also misclassified prose like `LVL JOIST` as a section. It
now retains ply count, ply thickness, and depth, while bare LVL prose rejects.
The structural PDF's page-3 dry-service/19%-maximum-moisture note is bound by
page and PDF SHA-256. AISC Shapes Database v16.0 dimensions resolve W10X30,
W12X45, and W18X50; HSS/angle dimensions remain tied to the complete printed
tag; NIST PS 20-20 dry and green minimum dressed sizes remain distinct and are
not mislabeled as field measurements.

Adversarial tests reject a substituted material-condition hash or page. The
canonical replay remains fail-closed: exact section identity alone does not
invent beam/joist elevation, rotation, bearing, or connection geometry, so the
new section evidence is not promoted to fabrication solids. The current replay
surfaces 671 rule errors, 12 warnings, five unpriced SKUs, eleven cut-sheet
stubs, and the same missing hydraulic supply curve.

- Full CAD suite: 419 passed, 0 failed, 0 skipped (29.229 seconds).
- Focused golden/registered/adversarial lane: 67 passed, 0 failed, 0 skipped.
- Structure parser lane: 33 passed, 0 failed, 0 skipped.
- Brain postflight:
  `decisions/cooperative-1881-structural-section-truth-iteration-6.md`.

This loop reached its six-iteration budget without weakening acceptance. The
goal is not blocked; physical placement/orientation and obstruction propagation
continue in a successor closed loop.

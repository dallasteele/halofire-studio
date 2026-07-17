# Cooperative 1881 physical framing placement evidence

## Iteration 1 baseline

The predecessor corpus loop made all 30 former skip checks executable and
recovered section truth for the complete eight-floor structural corpus. This
successor starts from 241 exact source/AISC sections, 258 source-bounded dry
minimum-dressed wood sections, and 1,453 unresolved members.

No beam or joist is yet promoted to a physical 3D obstruction: section identity
does not establish plan rotation, top/bottom elevation, bearing, connection, or
field dimensions. Existing GLB obstruction meshes are source-measured column
marker envelopes only. The first discovery slice must locate and bind the
structural plan/section/elevation conventions that can support those missing
placement fields, while keeping every unsupported member fail-closed.

## Iteration 2 current roof/elevation registration

The prior Cooperative 1881 roof packet was sealed to an unavailable historical
architectural bundle. It is now regenerated against the current architectural
PDF hash `bb3c85c...4008f`: A-121 physical page 32, A-201 physical page 58,
and A-301 physical page 62. Current issued M109 physical page 13 and P109
physical page 10 replace the vanished combined-MEP packet. A separate source
rebind pass rerenders all five sheets at 2.5x and rejects any PDF, page, frame,
or raster drift before resealing downstream receipts.

The exact current-PDF visual overlays prove alignment of 15 roof regions, 11
roof drains/overflow/hatch features, 139 mechanical equipment footprints, and
83 plumbing vent endpoints. The focused reconstruction, MEP coordination, and
submitted-calibration suite passes 23/23, including receipt tampering, source
substitution, false completeness, overlap conflict, transform residual, and
malicious pitched-roof node adversaries.

- `output/visual-proof/1881-current-a121-roof-registration.png`
  SHA-256 `130aca7d044eb659a3cd3aba868b7db1b9e01e3ce15b8d92413ba133001c52ca`
- `output/visual-proof/1881-current-mep-registration.png`
  SHA-256 `60a4b812a69e32c1db29573cffbd004d17d38eab5471ba07b96b01106a8e4675`

This establishes the architectural roof planes and MEP obstruction XY frame;
it does not promote any structural roof framing. S-190 states typical wood
trusses at 24 inches on center and delegates roof height/slope to architecture.
The next build slice must register actual S-190 framing centerlines into these
current A-121/A-201/A-301 datums. Truss profile, bearing, connection, and any
member without direct plan orientation and Z evidence remain unresolved.

## Iteration 3 explicit placement accounting and DROP adversary

The S-190 parser now distinguishes an exact `DROP` condition inside the primary
framing-plan body from the same token printed in the marks-and-symbols legend.
The primary body is recovered from the widest paired row-grid bubbles, so the
smaller elevator/amenity details and the legend cannot set a member's vertical
condition. Both S-190.B and S-190.C contain the governing hash-bound note
`BEAMS SHOWN ON THIS SHEET OCCUR WITHIN THE ROOF FRAMING SHOWN
(FLUSH-FRAMED), UNO.` Their two exact `DROP` tokens are both outside the main
plan body; zero plan-specific DROP associations remain.

The new continuous projection gate accounts for all 127 A-108 beam/joist
centerlines at 1/96-foot intervals against the sealed A-121 roof planes,
features, and exclusions. It reports 0 hidden skips:

- 7 source-bounded dry minimum-dressed wood members project continuously, but
  remain non-physical evidence representations because PS 20-20 minima are not
  field measurements.
- 82 centerlines have unresolved sections.
- 19 resolved members intersect the roof opening exclusion.
- 19 resolved members leave the verified roof model.
- The sole exact section, `HSS10X4X3/8`, starts inside the roof opening and is
  rejected; therefore no physical beam/joist solid is fabricated.

The A-121 proof overlays the seven bounded representations in amber and the
rejected exact HSS in red on the actual architectural PDF:

- `output/visual-proof/1881-a121-roof-framing-placement-gate.png`
  SHA-256 `ffb132572bf3ea1384684ed6b67bceb898c29795e635cbadee1a720fd3ac7402`
- `apps/autosprink/src/data/roof-framing-placement.cooperative-1881.json`
  records candidates 127, accounted 127, skipped 0, and keeps employee/VPS,
  code-compliance, and fabrication claims false.

Focused JS verification passes 40/40, including adversarial source-hash drift,
plan-specific DROP ambiguity, a member crossing an opening despite valid
endpoints, bounded wood non-promotion, and exact sloped-plane placement. The
broader roof/coordination/structure JS regression passes 63/63 with zero skips.
The full CAD Python inventory passes 422/422 with zero skips when run in
resource-isolated directory shards (357 unit, 41 golden, 9 root parity, 7
cruel, 3 property, 3 stress, and 2 end-to-end). AutoSprink's Vite production
build passes. The monorepo build compiles the web packages, then the unrelated
Tauri packaging lane stops because its pre-existing
`bin/halofire-pipeline-x86_64-pc-windows-msvc.exe` sidecar is absent.

The
next loop must find source-specific exact wood dimensions or approve a
separately labeled conservative obstruction-envelope policy; it may not relabel
minimum dressed bounds as exact physical parts.

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

## Iteration 4 materialized-corpus discovery gate

A new bounded, deterministic source-discovery stage walks only configured,
materialized corpus roots, content-hashes every candidate, ignores symlinks,
and returns an explicit scan-budget failure instead of pretending that a huge
shared drive was completely searched. It classifies filename-level candidates
as an issued structural design, sprinkler shop drawing, or structural
supplier/truss/lumber submittal. This is a discovery classification only: a
document name or an extracted member tag never promotes a CAD solid.

The current local run scanned 577 files from the Cooperative 1881 bid and
golden roots. It found 52 project-token candidate paths representing 32 unique
contents. The issued structural set, its RFI, and the completed sprinkler shop
drawings are classified explicitly; duplicate structural/RFI copies are
deduplicated by SHA-256 before member evidence is evaluated. The configured `Y:/` source root is not
materialized in this session. No structural supplier/truss/lumber submittal was
found. All seven continuously roof-projectable bounded wood members therefore
remain non-physical, with explicit `physicalPromotionAllowed: false`; a
sprinkler shop drawing is not structural fabrication evidence.

- `apps/autosprink/src/data/roof-framing-source-discovery.cooperative-1881.json`
  records 577 scanned files, 52 path candidates, 32 unique documents, 7 checked
  roof members, 0 supplier candidates, and all release claims false.
- `npm run build:1881-source-evidence-discovery` reruns the corpus gate.
- Focused Vitest discovery and roof-framing lanes pass 8/8, including an
  adversarial scan-budget exhaustion case and duplicate-source SHA collapse.

The discovery artifact is consumed by
`roof-framing-clearance-preflight.cooperative-1881.json`. The preflight binds
the structural PDF SHA, requires a one-to-one member witness set, rejects any
false physical-promotion flag, and returns a typed
`ROOF_FRAMING_OBSTRUCTION_GEOMETRY_UNRESOLVED` blocker. Automatic pipe routing,
per-head obstruction clearance, code compliance, and fabrication therefore stay
false for the seven bounded members rather than being silently routed through.
The direct discovery/roof-framing lane passes 11/11, including source-hash and
member-set substitution adversaries. The broader focused JavaScript source,
roof, coordination, and calibration lane passes 70/70 with zero skips;
`test_registered_structures.py` passes 25/25, the AutoSprink production build
passes, and the agent-loop contract validator passes.

The next automated pass accepts `HALOFIRE_CORPUS_ROOTS` as a semicolon-delimited
set of scoped, materialized Egnyte folders. It must locate an actual structural
supplier submittal and then independently extract member-level actual dressed
dimensions, orientation, and vertical datum before the existing continuous roof
projection gate can promote a physical obstruction.

## Iteration 5 live-Egnyte corpus windowing

The authenticated Egnyte Drive client was started and restored the `Y:` Halo
Fire share. The live bid log identifies the awarded record as `The Cooperative
1881 Salt Lake City UT`, contractor `Kier Construction`, and the source discovery
now uses the project-scoped Kier bid root instead of a whole-drive `Y:/` crawl.

The first live 300-directory window scanned 776 files across local source roots
plus `Y:/Shared/HaloOps/01-Bids/Kier`. It did not find a structural supplier,
truss, or lumber submittal. The previous scan only bounded files, which could
hang on an empty virtual cloud tree; discovery now bounds and records directory
traversal, sorts entries deterministically, and emits a resumable directory
offset. The exact next window is offset 300. This remains an explicit source
search state, not a negative claim about folders that have not been scanned.

Focused source evidence tests pass 9/9, including an empty cloud-directory
budget adversary and a deterministic resumed-window adversary. The broader
source/roof lane passes 72/72 with zero skips; structural registration passes
25/25; the production build and loop-contract guard pass.

## Iteration 6 independent local/shared cursor and shared window 300

Discovery no longer applies a shared-drive resume cursor to the canonical local
sources. `mergeMaterializedSourceEvidenceDiscoveries` now records a named local
window and a named shared window, preserving local hash-bound candidates while
the shared Egnyte tree advances. The focused adversary proves that a resumed
shared window retains the local structural candidate instead of silently
dropping it.

The local window completed with 577 materialized files and 110 directories.
The shared `Y:/Shared/HaloOps/01-Bids/Kier` window at offset 300 traversed the
next 300 directories (221 files) and emitted the next cursor at 600. It found
no project-token candidate and no structural supplier/truss/lumber submittal.
This is a partial-search result only; `SOURCE_CORPUS_SCAN_BUDGET_EXHAUSTED`
remains explicit.

The PDF reader had an invalid standard-font path. It now uses a trailing-slash
file URL, and candidate text is limited to four cover/index pages so discovery
stays bounded. Exact member extraction remains a separate full-document gate.
An adversarial plan that merely says a lumber supplier must verify framing is
now rejected as a supplier submittal; the resulting artifact records
`structuralSupplierSubmittalMaterialized: false` and the clearance preflight
continues to block automatic routing and per-head clearance.

Focused source and roof-framing tests pass 15/15 with no skips. The next window
is `HALOFIRE_SHARED_CORPUS_DIRECTORY_OFFSET=600`.

The final regression is 74 JavaScript tests and 25 structural-registration
Python tests, all passing with zero skips; the AutoSprink Vite production build,
loop guard, and agentic rulebook check also pass. The formal prover health probe
at `http://127.0.0.1:8810/api/provers/health` refused the connection, so no
formal proof claim is made for this source-discovery slice.

## Iteration 7 shared window 600

The next live shared-drive window at offset 600 scanned 786 materialized files
within its 300-directory budget and advanced the resumable cursor to 900. It
again found no Cooperative 1881 project-token candidate and no structural
supplier/truss/lumber submittal. This is not an absence claim about the
unscanned tree; `SOURCE_CORPUS_SCAN_BUDGET_EXHAUSTED` remains present. The
replayed clearance preflight remains blocked with
`ROOF_FRAMING_OBSTRUCTION_GEOMETRY_UNRESOLVED`, automatic routing false, and
per-head obstruction clearance false.

## Iteration 8 shared window 900 and successor requirement

The final current-loop window at offset 900 scanned 259 materialized files and
advanced to cursor 1200. No project-token path candidate or structural supplier
source appeared. This is still a bounded partial-search result, not proof that
the project source does not exist.

The pass exposed a real discovery limitation: a supplier package can use a
generic filename and live in a folder whose path omits the project name, which
the current project-path filter excludes before text extraction. The successor
loop must admit only supplier/truss/lumber-named shared-drive leads without a
path match, extract their cover/index text, and require the Cooperative 1881
identity in that text before treating them as project candidates. It must not
promote a generic supplier lead or use it as physical member proof.

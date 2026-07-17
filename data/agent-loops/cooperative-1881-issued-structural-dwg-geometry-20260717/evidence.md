# Cooperative 1881 issued structural DWG geometry evidence

## Iteration 1 discovery and plan

The active project corpus contains the native issued structural CAD directory:

`Y:/Shared/HaloOps/02-Active jobs/Kier/The Cooperative 1881 - Salt Lake City UT/2-Internal Ops/01-Design/05-CAD Files/structural`

It contains the exact roof framing plan S-190, elevations S-201/S-202, and
building sections S-301/S-302/S-303. This successor loop uses those source
drawings for read-only, hash-bound structural geometry observations. It does
not reclassify them as a truss/lumber supplier submittal and does not clear
physical-framing, automatic-routing, per-head obstruction, fabrication, code,
employee, or VPS gates.

The next stage is bounded native-DWG extraction through
`@mlightcad/libredwg-web@0.7.7`, followed by a source-only visual receipt.

## Iteration 1 execution and verification

All six required source files replay through the pinned parser with
`unknownEntityCount: 0`. The receipt records their exact byte lengths,
SHA-256 values, entity counts, structural text controls, and the 2,261 native
S-190 roof-plan structural/grid lines. The plan receipt is rendered directly
from that source linework at:

`output/visual-proof/1881-issued-structural-dwg-geometry.svg`

The receipt reproduced bit-for-bit on a second execution:

`6B651694AFC25F80FF81F749BF740B295455085DEA1AB262CE3E5BEAF0ED280B`

Focused source/roof/geometry tests pass 80/80 with zero skips, and the
AutoSprink production build and agentic-rule validator pass. The browser
inspection accepted the visual as a readable native-DWG source receipt only:
it visibly contains both S-190 roof-plan bodies and contains no sprinkler,
fabricated member, PDF overlay, clearance, or code claim.

The successor must recover explicit cross-sheet member context before physical
framing can be promoted: member tag, actual dressed dimensions/profile, plan
orientation, vertical datum, and an independently source-bound link between
the roof plan and the relevant elevation or section. The original supplier
lead loop remains required for fabrication/connection claims. Automatic pipe
routing, per-head obstruction clearance, code compliance, fabrication,
employee use, and VPS release remain false.

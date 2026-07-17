# Cooperative 1881 issued roof datum consensus

The sealed native elevation and section DWGs contain repeated `9. ROOF EAVE`
and `10. T.O. ROOF RIDGE` labels with adjacent printed elevation values. This
loop will extract and cross-check those native text controls only. It will not
associate them with a particular S-190 member, calculate pitch, or promote any
physical framing, sprinkler, fabrication, code, employee, or VPS claim.

## Iteration 1 execution and verification

The extractor accepts only a label above a nearby value (vertical gap at most
30 native drawing units). This directional rule rejected the adversarial
nearest-text failure where the eave label could otherwise select the ridge
value. It retains each source file SHA-256, label handle, value handle,
coordinates, parsed inches, and pairing distance.

All thirteen eave observations across S-201/S-202/S-301/S-302/S-303 agree at
`84'-1 1/8"` / `1009.125 in`. All thirteen ridge observations agree at
`85'-10"` / `1030 in`. Their source-observed vertical separation is `20.875
in`; this is not a roof pitch because no independently source-bound horizontal
run or particular roof profile/member association is yet present.

The receipt replayed byte-identically with SHA-256
`F5CF2DACEB56C260BFEA9C95F10DBBA4B418194E62951F69D8D5C2F408A4B38E`.
Focused JavaScript tests pass 83/83 and Python registered-structure tests pass
25/25 with zero skips. Production build, loop guard, and agentic rules pass.
The source visual at `output/visual-proof/1881-issued-roof-datum-consensus.svg`
was inspected from a fresh Chrome headless raster: actual native S-201 elevation
linework remains visible, amber eave and cyan ridge source callouts are readable,
and the proof explicitly closes pitch, member, and clearance claims.

Next: an explicit member-to-section context gate must bind a named plan member
to a named section/elevation cut before any member can inherit a roof datum.

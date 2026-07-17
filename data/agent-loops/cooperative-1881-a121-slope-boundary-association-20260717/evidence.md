# Cooperative 1881 A-121 slope target to boundary association

The preceding source receipts establish nineteen explicit native slope callout
targets and thirty-one closed A-121 block boundaries. Discovery found three
sets of exact duplicate boundary geometry and several non-identical overlaps.
This loop collapses only exact geometric aliases; it must reject every target
that lies in more than one non-identical canonical boundary.

The result is only a region-localized slope magnitude annotation. It must not
turn the callout leader into a slope-direction vector or claim a roof plane,
vertical datum, structural member, sprinkler, pipe, clearance, fabrication,
code, employee use, or VPS release.

## Result

The two sealed inputs share the A-121 hash
`FD3DB45D18C2970F0F67BE1C668188ABD1962C0D3CD56A7EDE67545F53F42606`.
Thirty-one raw block boundaries collapse into twenty-eight canonical regions:
three groups are exact geometric aliases and retain all source handles.

All nineteen slope targets are classified. Thirteen lie in exactly one canonical
region and retain their source callout/leader handles and slope magnitude. Six
lie in two non-identical canonical regions and are explicitly blocked by
`A121_SLOPE_TARGET_NONIDENTICAL_BOUNDARY_OVERLAP`; no inner/outer/larger/smaller
heuristic selects a region for them. The deterministic artifact replay hash is
`52A4F2860A1C460DEFC99E60B635964CDFF48090B65480BA1040144976AB8462` across two
runs.

Focused source-bound tests passed 37/37. Vite production build, loop guard, and
`verify_agentic_rules.py` passed. The source proof has green uniquely-associated
targets and red overlap blocks; it was visually inspected and accepted. GX10
formal prover health remained unavailable at `http://127.0.0.1:8810/api/provers/health`;
no formal proof is claimed.

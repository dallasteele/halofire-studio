# Cooperative 1881 A-121 cutting-plane coverage

The issued A-121 roof plan carries ten native `Cutting Plane_*_2` blocks.
Each was accepted only when its insertion/base point, rotation, and scale are
identity, its longest native LINE is present, and its block carries an explicit
detail plus sheet reference. The exact source hash remains
`FD3DB45D18C2970F0F67BE1C668188ABD1962C0D3CD56A7EDE67545F53F42606`.

The sealed result records these exact plan references:
`C1/A-307`, `C3/G-006`, `A3/A-302`, `A3/A-304`, `C1/A-305`, `C1/A-306`,
`A3/A-301`, `A2/A-453`, `A2/A-455`, and `A1/A-407a`.

Each canonical roof region was checked against every native source cut by
segment/polygon interval, not nearest distance. A boundary touch is excluded;
a segment must have a non-zero interval strictly inside the source polygon.
All thirteen uniquely localized slope targets receive real source-cut coverage,
but each receives two to four interior references. Therefore all thirteen are
explicitly blocked as `A121_SLOPE_REGION_SECTION_REFERENCE_NON_UNIQUE`; the six
overlap-blocked slope targets remain unassigned. This result may not choose a
section, infer a slope vector, or promote a roof plane/elevation/model/head/
pipe/fabrication/code/employee/VPS claim.

The generated receipt replayed byte-identically with SHA-256
`A89867D072EAD36BFC33753C13B6A420A6E3BD9F897273D3C46DD5B0801655C1`.
Focused source-bound tests passed 40/40, Vite production build, loop guard,
and `verify_agentic_rules.py` passed. The Chrome-captured SVG was visually
inspected and accepted: it shows the actual ten colored source cuts over the
canonical plan boundaries, a native-reference legend, and the plural-coverage
hold. `GX10_PROVER_UNAVAILABLE`: the required prover health endpoint
`http://127.0.0.1:8810/api/provers/health` could not be reached, so no formal
proof is claimed.

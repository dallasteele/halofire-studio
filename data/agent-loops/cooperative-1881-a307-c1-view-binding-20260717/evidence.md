# Cooperative 1881 A-307 C1 native source-view binding

The preceding A-121 cut coverage receipt carries an explicit `C1/A-307`
reference. The issued A-307 DWG is sealed to SHA-256
`070F4766DB2FCD0D62E828AE70418BD205722FE9DC79EF95DDBDB61174B69162`.

The receipt binds that plan reference to a native NCS drawing-title insert with
the exact attribute values `C1`, `A-307`, and `LONGITUDINAL SECTION B`. It then
uses the native paper-layout relationship (title directly below exactly one
`NonPlottable_0` model viewport within the recorded template bounds) to bind
the model-space viewport; it does not match a source sheet by name or select
the nearest roof geometry.

Forty-two native `New_A _ Roofs.3D*` line segments whose full endpoints fall
inside the bound viewport are retained with block, insert, and entity handles.
The exact view-name story marker contributes one viewport-local `ROOF EAVE`
annotation at `+81'-0"` and one `T.O. ROOF RIDGE` annotation at `+89'-6 3/4"`.
The evidence is view-local only: annotations have not been geometrically tied
to a specific roof-profile edge; this C1 view has not been selected for any
plural-covered plan region; and no slope vector, roof surface, 3D model,
member, sprinkler, pipe, clearance, fabrication, code, employee, or VPS claim
is promoted.

The generated receipt replayed byte-identically with SHA-256
`D711222AFD83227056D590FA154E59F72850F8770DA0374D6F58C2FD42DF1BEF`.
Focused source-bound tests passed 43/43, Vite production build, loop guard,
and `verify_agentic_rules.py` passed. Chrome captured and visually inspected
the source view receipt. `GX10_PROVER_UNAVAILABLE`: the required prover health
endpoint `http://127.0.0.1:8810/api/provers/health` was unreachable, therefore
no formal proof is claimed.

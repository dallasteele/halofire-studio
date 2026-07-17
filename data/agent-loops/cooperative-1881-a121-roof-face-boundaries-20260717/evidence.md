# Cooperative 1881 A-121 roof-face boundaries

This loop begins from the sealed native A-121 drawing. Discovery found thirty
named `Roof_*_2` block instances on `New_A _ Roofs.3D`. Their native block
definitions contain roof edge LWPOLYLINEs and, for some blocks, HATCH boundary
paths. The loop must construct only exact closed plan boundaries from those
handles and reject any open, degenerate, or conflicting geometry.

No callout leader is used as a slope-direction vector. No plan boundary is an
elevation, structural member, obstruction clearance, sprinkler, pipe, fitting,
fabrication, code, employee-use, or VPS-release claim.

## Result

The deterministic native-DWG extractor passed on the sealed A-121 hash
`FD3DB45D18C2970F0F67BE1C668188ABD1962C0D3CD56A7EDE67545F53F42606` with
zero unknown entities. It registered all 30 named `Roof_*_2` blocks through
their matching identity-transformed inserts. The receipt has 31 non-degenerate
closed boundaries: 23 native HATCH boundary paths and 8 closed native
LWPOLYLINE loops, covering all 30 block names. The replay receipt hash is
`17D5B3D0188CAABBE51AEA25138AAC38B65388DEACCCE1A851764AC0575CB297` across
two runs.

Focused source-bound tests passed 33/33. Vite production build and
`verify_agentic_rules.py` passed. The first visual proof was rejected because
the tall source plan was pinned to the viewport edge; the replacement rotates
only its display viewport, centers the unmodified source-coordinate geometry,
and separates the source receipt from blocked downstream claims. The final
Chrome proof was visually inspected and accepted. Browser-plugin discovery had
no available controlled browser. GX10 formal prover health remained unavailable
at `http://127.0.0.1:8810/api/provers/health`; no formal proof is claimed.

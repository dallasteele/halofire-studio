# Agent-loop LESSONS (memory that compounds across runs)

One line per event, appended by loop.py. Recent lessons are fed into future
prompts so run N+1 knows what runs 1..N tried. Do not edit by hand mid-run.

- 2026-06-10 SEED: qwen3:30b-a3b landed H7+T29T34+H17 (3/6); dominant failure classes were TS6133 unused decls (now tier-0 autofixed), invented throw-message assertions (now ruled), and Python-isms (import 'math').
- 2026-06-10 DONE W3A-pipe-sizing on attempt 2 (model qwen3:30b-a3b).
- 2026-06-10 DONE W3B-fitting-le on attempt 2 (model qwen3:30b-a3b).
- 2026-06-10 BLOCKED W3C-bom-group (model qwen3:30b-a3b); last error class: dule '../src/lib/bom-types' or its corresponding type declarations.
test/bom-group.test.ts(4,7): error TS6133: 'round2' is declared but its value is never read.
- 2026-06-10 DONE W3D-coverage-area on attempt 2 (model qwen3:30b-a3b).
- 2026-06-10 DONE W3C-bom-group on attempt 2 (model qwen3:30b-a3b).
- 2026-06-10 DONE W4A-wall-solid on attempt 4 (model qwen3:30b-a3b).
- 2026-06-10 BLOCKED W4B-slab-solid (model qwen3:30b-a3b); last error class: ValueError: your files[] is missing required file(s): apps/cad/test/slab-solid.test.ts — emit ALL required files as {"path", "content"} objects.
- 2026-06-10 BLOCKED W4C-fitting-orient (model qwen3:30b-a3b); last error class: ValueError: your files[] is missing required file(s): apps/cad/test/fitting-orient.test.ts — emit ALL required files as {"path", "content"} objects.
- 2026-06-11 BLOCKED W5A-pipe-snap (model qwen3:30b-a3b); last error class: 39: Property 'nodeId' does not exist on type 'SnapHit'.
  Property 'nodeId' does not exist on type '{ kind: "segment"; segmentId: string; at: Pt; t: number; }'.
- 2026-06-11 BLOCKED W5B-wall-extract-score (model qwen3:30b-a3b); last error class: ValueError: your files[] is missing required file(s): apps/cad/test/wall-extract-score.test.ts — emit ALL required files as {"path", "content"} objects.
- 2026-06-11 BLOCKED W5C-bid-payload (model qwen3:30b-a3b); last error class: e 'any[]' in some locations where its type cannot be determined.
test/bid-payload.test.ts(41,51): error TS7005: Variable 'lines' implicitly has an 'any[]' type.
- 2026-06-11 BLOCKED W5D-head-clearance (model qwen3:30b-a3b); last error class: ValueError: your files[] is missing required file(s): apps/cad/test/head-clearance.test.ts — emit ALL required files as {"path", "content"} objects.
- 2026-06-11 DONE W5A-pipe-snap on attempt 5 (model gemma4:26b-a4b-it-qat).
- 2026-06-11 BLOCKED W5B-wall-extract-score (model qwen3:30b-a3b); last error class:  index asc
AssertionError: expected [ …(3) ] to deeply equal [ { index: +0, score: 1, …(1) }, …(2) ]
- Expected
+ Received
     49|     expect(scores).toEqual([
- 2026-06-11 DONE W5C-bid-payload on attempt 5 (model gemma4:26b-a4b-it-qat).
- 2026-06-11 BLOCKED W5D-head-clearance (model qwen3:30b-a3b); last error class: : expected [ { headId: 'headA', …(4) }, …(1) ] to deeply equal [ { headId: 'headA', …(4) }, …(1) ]
- Expected
+ Received
     70|       expect(issues).toEqual([
- 2026-06-11 BLOCKED W6A-hanger-spacing (model qwen3:30b-a3b); last error class: S6133: 'MAX_END_DISTANCE_FT' is declared but its value is never read.
test/hanger-spacing.test.ts(36,19): error TS2304: Cannot find name 'findMaxHangerSpacing'.
- 2026-06-11 DONE W6B-ceiling-grid on attempt 6 (model kimi-dev:72b).
- 2026-06-11 BLOCKED W7A-bid-classifier (model qwen3:30b-a3b); last error class: _FOUND]: Cannot find package 'vitest' imported from /opt/hal9000/apps/halofire-studio/apps/autosprink/vitest.config.js.timestamp-1781159893829-def1f7555bd01.mjs
- 2026-06-11 BLOCKED W7B-bid-html (model qwen3:30b-a3b); last error class: JSONDecodeError: Unterminated string starting at: line 1 column 71 (char 70)
- 2026-06-11 BLOCKED W8A-scale-notation (model qwen3:30b-a3b); last error class: 5: ';' expected.
src/lib/scale-notation.ts(16,48): error TS1005: ';' expected.
src/lib/scale-notation.ts(21,3): error TS1128: Declaration or statement expected.
- 2026-06-11 BLOCKED W8B-sheet-classify (model qwen3:30b-a3b); last error class: src/lib/sheet-classify.ts(70,1): error TS1005: '}' expected.


- 2026-06-11 BLOCKED W9A-riser-inference (model qwen3:30b-a3b); last error class:  nodes found'
Expected: "no non-head nodes"
Received: "No non-HEAD nodes found"
     90|     expect(() => inferRiser(nodes, segments)).toThrow('no non-head nod…
- 2026-06-11 BLOCKED W9B-pdf-line-cluster (model qwen3:30b-a3b); last error class: e tolerance (1 degree skew)
 FAIL  test/pdf-line-cluster.test.ts > clusterColinear > asserts determinism of sort order (length desc, then a.x asc, then a.y asc)
- 2026-06-11 DONE W10A-scale-prefill on attempt 5 (model gemma4:26b-a4b-it-qat).
- 2026-06-11 BLOCKED W10B-hanger-grid-3d (model qwen3:30b-a3b); last error class:  FAIL  test/hanger-grid-3d.test.ts > hanger-3d logic > computes hanger drops correctly for a 30ft run
- 2026-06-11 BLOCKED W10C-clearance-overlay (model qwen3:30b-a3b); last error class: arkers > yields no markers for a compliant head
 FAIL  test/clearance-overlay.test.ts > getClearanceIssueMarkers > returns empty array when no walls are present
- 2026-06-11 BLOCKED W9A-riser-inference (model qwen3:30b-a3b); last error class: JSONDecodeError: Expecting ',' delimiter: line 1 column 4672 (char 4671)
- 2026-06-11 BLOCKED W9B-pdf-line-cluster (model qwen3:30b-a3b); last error class: pected [ { a: { x: +0, y: +0 }, …(3) } ] to deeply equal [ { a: { x: +0, y: +0 }, …(3) }, …(1) ]
- Expected
+ Received
    113|         expect(result).toEqual([
- 2026-06-11 DONE W10B-hanger-grid-3d on attempt 1 (model qwen3:30b-a3b).
- 2026-06-11 BLOCKED W10C-clearance-overlay (model qwen3:30b-a3b); last error class: pected [ { headId: 'h1', x: +0, …(3) }, …(1) ] to have a length of 1 but got 2
- Expected
+ Received
     12|         expect(markers[0].kind).toBe('too-close');
- 2026-06-11 DONE W11A-kernel-heat-riser on attempt 2 (model qwen3:30b-a3b).
- 2026-06-11 BLOCKED W11B-pdf-trace-assist (model qwen3:30b-a3b); last error class: ValueError: path outside write_roots: test/pdf-trace-assist.test.ts
- 2026-06-11 BLOCKED W11B-pdf-trace-assist (model qwen3:30b-a3b); last error class:  suggestWalls > filters by minScore override
AssertionError: expected [ { a: { x: NaN, y: NaN }, …(2) } ] to have a length of +0 but got 1
- Expected
+ Received
- 2026-06-11 BLOCKED W12A-followup-badges (model qwen3:30b-a3b); last error class: JSONDecodeError: Expecting ',' delimiter: line 1 column 2081 (char 2080)
- 2026-06-11 BLOCKED W12B-takeoff-rollup (model qwen3:30b-a3b); last error class: /takeoff-rollup.test.ts > rollupTakeoff > counts heads correctly
 FAIL  test/takeoff-rollup.test.ts > rollupTakeoff > skips lines with zero or negative quantity
- 2026-06-11 BLOCKED W12A-followup-badges (model qwen3:30b-a3b); last error class: _FOUND]: Cannot find package 'vitest' imported from /opt/hal9000/apps/halofire-studio/apps/autosprink/vitest.config.js.timestamp-1781192437810-2a2b90b19e051.mjs
- 2026-06-11 DONE W12B-takeoff-rollup on attempt 5 (model gemma4:26b-a4b-it-qat).
- 2026-06-11 BLOCKED W12A-followup-badges (model qwen3:30b-a3b); last error class: HTTPError: HTTP Error 500: Internal Server Error
- 2026-06-11 BLOCKED W13A-scad-emitters (model qwen3:30b-a3b); last error class: ence for hollow part
AssertionError: expected '// Dimensioned parametric, not manufa…' to contain 'cylinder(h=76.2, r=25.4, center=true);'
- Expected
+ Received

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

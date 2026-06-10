# Agent-loop LESSONS (memory that compounds across runs)

One line per event, appended by loop.py. Recent lessons are fed into future
prompts so run N+1 knows what runs 1..N tried. Do not edit by hand mid-run.

- 2026-06-10 SEED: qwen3:30b-a3b landed H7+T29T34+H17 (3/6); dominant failure classes were TS6133 unused decls (now tier-0 autofixed), invented throw-message assertions (now ruled), and Python-isms (import 'math').
- 2026-06-10 DONE W3A-pipe-sizing on attempt 2 (model qwen3:30b-a3b).
- 2026-06-10 DONE W3B-fitting-le on attempt 2 (model qwen3:30b-a3b).
- 2026-06-10 BLOCKED W3C-bom-group (model qwen3:30b-a3b); last error class: dule '../src/lib/bom-types' or its corresponding type declarations.
test/bom-group.test.ts(4,7): error TS6133: 'round2' is declared but its value is never read.
- 2026-06-10 DONE W3D-coverage-area on attempt 2 (model qwen3:30b-a3b).

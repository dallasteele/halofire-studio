# Agent-loop RULES (read EVERY run — the loop's skill file)

These rules are loaded into every executor prompt. They exist because each one
was violated by a real failed attempt. Add to them; never delete without cause.

## TypeScript (the gate is STRICT)
- tsconfig has noUnusedLocals/noUnusedParameters: NEVER import or declare
  anything you do not use — including type-only imports in tests.
- Never assign to a `const`; use `let` for mutable values.
- No `any` types. Type test callback parameters explicitly (e.g. `(s: Segment) =>`).
- Import ONLY from modules named in the task spec or context files. There is no
  'math' module in TypeScript — use the global `Math` object.

## Self-consistency (your two files must agree)
- In tests, assert throw cases with `expect(() => ...).toThrow()` and NO message
  argument, unless the spec pins an exact message. Never invent a message string
  in a test that your implementation does not literally throw.
- Every export named in the spec must exist with the EXACT name and signature.

## Honesty
- Keep cited constants/formulas EXACTLY as given in the spec. Do not invent
  values, tables, or tolerances.
- Use Number.isFinite for numeric validation; throw new Error('<clear message>').

## Output contract
- Output ONLY the JSON object {"files":[{"path","content"}...],"notes"} —
  every files[] entry is an OBJECT with COMPLETE file contents (no diffs, no
  placeholders, no '...').

## 3D work verification (MANDATORY — added after the flat-mat/sealed-box failure)
- Any task touching 3D geometry/rendering MUST keep test/scene-invariants.test.ts
  green and extend it with invariants for the new geometry (positions/elevations/
  scale asserted numerically through the same composition paths the viewer uses).
- Never accept a far-away screenshot as proof. Verification = numeric scene
  assertions (window.__cadVerify3D in the live app) + close-range screenshots
  from at least: exterior 3/4, interior at system height, top-down.
- Systems mount at ceiling height, never y=0. Buildings are never synthesized
  from non-architectural linework.

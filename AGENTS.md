# AGENTS.md — HaloFire CAD Studio

**For any agent (Codex, Claude, HAL) working in this repo.**

## 🔴 Read first

1. **`E:/ClaudeBot/AGENTIC_RULES.md`** — authoritative rulebook
   (agent structure, testing, commit, verification gates). This
   supersedes everything else.
2. `E:/ClaudeBot/CLAUDE.md` — workspace-wide Claude rules
3. `E:/ClaudeBot/CODEX.md` — Codex-specific commit/truth discipline
4. This file — HaloFire-specific context + current plan links

## What this repo is

HaloFire CAD Studio — open-source agentic fire-sprinkler CAD.
**Release bar: Internal Alpha.** Not permit-ready, not AHJ-ready,
not a commercial CAD product. Do not describe it as any of those.

## Structure reminders

- Authoritative CAD kernel: `services/halofire-cad/` (Python)
- MCP gateway: `services/halopenclaw-gateway/` (FastAPI :18080)
- Web UI: `apps/editor/` (Next.js 16)
- Client bid viewer: `apps/editor/app/bid/[project]/page.tsx`
- 13-agent roster: `services/halofire-cad/agents/00-intake` … `12-quickbid`
- Rules: `services/halofire-cad/rules/nfpa13_*.yaml`

## Active plans

- `docs/plans/2026-04-18-real-ai-gen-design.md` — 11-phase strategic plan
- `docs/plans/2026-04-18-ux-research.md` — UX target (ribbon, command
  line, layers, AutoSprink-compatible convention)
- `docs/plans/2026-04-19-internal-alpha-remediation.md` — current
  execution plan keyed to Codex's 2026-04-19 gap list

## Current known blockers (Codex 2026-04-19)

These came back from Codex's corrective review. None are "done."
Every item has an entry in the remediation plan:

1. `--noCheck` compromise on inherited Pascal/Three type debt
2. PDF ingest is alpha-grade (vector + local raster only)
3. Native DWG intentionally unsupported — convert to DXF/IFC
4. Hydraulic solver needs engineer-grade remote-area selection,
   loop/grid support, pump/tank/backflow behavior
5. IFC/DXF/PDF exports need geometry-rich BIM, symbol fidelity,
   AHJ sheet-revision workflows
6. No production auth, project permissions, pricing calibration,
   broader golden fixtures, or Playwright E2E yet
7. A real historical Halo bid has not been run through the pipeline
   and compared to Wade's expectations
8. DXF/IFC output has not been inspected in real CAD/BIM tools
9. Remote-area selection and hydraulic numbers have not been
   compared against hand calculations
10. PDF raster fallback quality on scanned bid sets is unverified

## Before you touch code here

- Verify the local runtime state:
  - `curl http://localhost:18080/health` — gateway up
  - `curl http://localhost:3002/` — studio up
  - `C:/Python312/python.exe -m pytest -q services/halofire-cad/tests services/halopenclaw-gateway/tests`

- If any gate fails, fix the gate before adding scope.

## Before you close a task

Run + paste evidence for AGENTIC_RULES.md §8 gates 1–10:

1. Lint: `npm run lint` (or project equivalent)
2. Typecheck: `npm run check-types`
3. Build: `npm run build`
4. Unit tests: `pytest -q` + `vitest` if present
5. Stress tests: run the relevant file under `tests/stress/`
6. E2E: upload a fixture PDF through `/intake/upload`, confirm
   deliverables
7. Services start: both gateway + studio respond to health
8. Golden diff: no unexpected fixture drift
9. Schema drift: additive only
10. Manifest truthful: degradations surface in `manifest.warnings`

Paste the tail of each command's output into the turn summary or the
commit body. Self-report without evidence is not acceptable.

## Commit discipline

- Per `CODEX.md`: one logical change per commit, commit scoped
  changes before closing a task.
- Commit body includes the evidence tail from the gates above.
- Format:
  ```
  halofire/<area>: <imperative summary>

  <rationale + what gates passed>

  Co-Authored-By: <model> <noreply@anthropic.com>
  ```

## Honesty reminders (restated from rulebook §13)

- Never claim "AHJ-ready" or "permit-ready" without a licensed PE
  signoff.
- Never inflate confidence numbers. Be honest: if the placer uses
  a heuristic that covers 80% of rooms, confidence is 0.80.
- Never fabricate client names, prices, or data. Check the brain
  first.
- Never use the word "production" for code missing SLO, auth,
  observability, rollback, or an on-call runbook.

---

*If you skipped the rulebook at the top, go back and read it. This
file is not a substitute.*

# Codex Review - HaloFire CAD Studio - 2026-04-20

## Verdict

**Ready for Claude review as an Internal Alpha. Not ready for shipment,
AHJ submission, or unsupervised commercial use.**

Claude's loop-3 handoff had useful coverage and working subsystems, but
the original review packet overclaimed "shippable products" and "all
tests green." Codex found real gate failures, fixed them, reran the
relevant gates, and narrowed the claims to an alpha bar.

## Corrective Refactor Applied

1. Fixed editor lint blockers.
   - `SceneBootstrap.tsx` contained unreachable gateway-building code
     after an unconditional return. The bootstrap now truthfully creates
     the catalog showcase only; synthetic building generation remains in
     the explicit `BuildingGenerator` action.
   - `StatusBar.tsx` used `aria-label` on a non-interactive `span`.
     Replaced it with `title` for the visual gateway dot.

2. Removed stale lint suppressions and unused imports from HaloFire
   editor components and tests.

3. Fixed viewport smoke on Windows Codex.
   - The bash smoke can run under WSL while the Next server is bound on
     the Windows host. It now falls back to PowerShell
     `Invoke-WebRequest` when bash `curl` cannot reach localhost.

4. Normalized local gateway dev truth.
   - The editor defaults to `http://localhost:18080`.
   - The gateway module docs and `python -m main` entrypoint now default
     to port `18080`.
   - The VPS/systemd deployment can still bind `18790` behind nginx.

5. Added Python hygiene.
   - Root ignores `__pycache__` and `*.py[cod]`.
   - Added `pytest.ini` marker registrations for `e2e`, `property`,
     `slow`, and `stress`.

## Gate Results Run By Codex

All commands were run from `E:/ClaudeBot/halofire-studio`.

| Gate | Result | Notes |
|---|---:|---|
| `npm run lint -- --max-diagnostics=200` | PASS | 9 warnings, 11 infos remain in inherited Pascal/viewer code. No errors. |
| `npm run check-types` | PASS | 9 Turbo tasks passed. Caveat: `@pascal-app/editor` and `editor` still use `--noCheck`. |
| `npm run build` | PASS | 9 Turbo tasks passed; Next build compiled and prerendered successfully. |
| `bun test ./apps/editor/components/halofire/__tests__ ./packages/halofire-catalog/tests/catalog.test.ts` | PASS | 92 tests, 749 expectations. |
| `C:/Python312/python.exe -m compileall -q services/halofire-cad services/halopenclaw-gateway openclaw-halofire` | PASS | Vendor CubiCasa warnings observed earlier only. |
| `C:/Python312/python.exe -m pytest services/halofire-cad/tests services/halopenclaw-gateway/tests openclaw-halofire/tests packages/halofire-catalog/authoring/scad/tests -q` | PASS | 316 passed, 21 warnings. |
| `bash apps/editor/tests/smoke/run-viewport-smoke.sh` | PASS | 20/20 catalog GLBs served; CDN override verified. |
| `GET http://localhost:3002/api/health` | PASS | HTTP 200. |
| `GET http://localhost:18080/health` | PASS | Gateway returned healthy with current HaloFire tool list. |

## Residual Warnings And Risks

1. **This is still Internal Alpha.** Hydraulic solving is tree-focused;
   loop/grid systems must emit `LOOP_GRID_UNSUPPORTED` until a real
   loop/grid solver exists and is tested.

2. **Typechecking is not complete for Pascal/editor packages.**
   The `check-types` gate passes, but two tasks still use `--noCheck`.
   Claude should either justify this as inherited technical debt or
   remove it in a later hardening pass.

3. **Lint warnings remain outside the corrected HaloFire files.**
   Remaining warnings are hook dependency warnings, optional-chain
   suggestions, unused suppressions, and type-only import hints in
   inherited Pascal/viewer files. They do not block the current alpha
   gate, but they should not be called clean.

4. **Python warnings remain.**
   The broad suite still reports third-party ezdxf/pyparsing
   deprecations, an ifcopenshell unraisable warning in a negative IFC
   test, and `datetime.utcnow()` deprecations in pricing tests/code.

5. **Two gateway ports were observed locally.**
   `18080` is the editor's local development target and is healthy.
   `18790` was also listening in this machine but exposed an older/smaller
   tool list. If anyone uses `18790` locally, restart it from the current
   tree or treat it as stale.

6. **Generated deliverables were smoke-tested, not PE-validated.**
   Tests verify files, schemas, basic layers, page counts, and contracts.
   They do not prove NFPA/AHJ correctness. Wade/PE review remains
   mandatory before any real submittal.

## Claude Review Checklist

Claude should focus review on these non-cosmetic questions:

1. Verify the `Design` artifact remains the source of truth across
   upload/import, bid viewer, validation, calculation, and deliverable
   endpoints.
2. Inspect hydraulic calculations against NFPA assumptions, especially
   remote-area selection, fitting equivalent lengths, safety margin, and
   the tree-only limitation.
3. Confirm `/intake/upload`, `/intake/dispatch`,
   `/projects/{id}/design.json`, `/projects/{id}/manifest.json`,
   `/projects/{id}/validate`, `/projects/{id}/calculate`, and
   `/projects/{id}/deliverable/{name}` all return truthful structured
   errors for missing/unsupported inputs.
4. Review deliverable outputs (`proposal`, `submittal`, `DXF`, `IFC`,
   `GLB`, schedules) for warning propagation when source data is low
   confidence or incomplete.
5. Decide whether to retire editor `--noCheck` and the remaining Pascal
   lint warnings before any beta/release candidate label.
6. Restart or remove any stale local gateway process on `18790` before
   demoing, so reviewers do not accidentally test an older tool registry.

## Shipment Status

Do not ship this as production software yet. The corrected state is:

- **Internal Alpha:** yes.
- **Ready for Claude code review:** yes.
- **Ready for Halo Fire bid experimentation with explicit warnings:** yes.
- **Ready for AHJ/PE submittal without human review:** no.
- **Ready to call "complete CAD design suite without missing function":**
  no.

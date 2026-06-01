# HaloFire Current Review - 2026-06-01

Repo: `C:/Users/dalla/OneDrive/Documents/HaloFire`
HEAD reviewed: `58de31f` - `T36: wire production OpenClaw SAM invoker into the server pdf path (fail-soft)`

This is the current Codex pickup review after Claude ran out of credits. The
project is a usable internal-alpha bid/CAD/evidence workbench, not a completed
professional fire-protection product. The app must continue to block claims for
AutoSprink parity, AHJ approval, PE/professional review, permit readiness,
fabrication readiness, manufacturer-exact models, and engineering-grade output
until real evidence is supplied by Halo Fire staff or licensed/proper authorities.

## Verified Now

Focused verification run on 2026-06-01:

```powershell
npx vitest run tests/evidence-api.test.js tests/resolve-gate.test.js tests/settings-documents.test.js tests/pdf-sam-server.test.js tests/pdf-to-bid-api.test.js tests/real-pdf-d4-measure.test.js tests/p7-studio-surface.test.js
```

Result: 7 files, 40 tests passed.

```powershell
npx vitest run tests/dxf-import-api.test.js tests/full-scope-bid-api.test.js tests/bid-scope.test.js tests/parity-matrix.test.js tests/auto-source-status-api.test.js tests/parts-api.test.js tests/part-override-api.test.js
```

Result: 7 files, 61 tests passed.

```powershell
C:/Python312/python.exe E:/ClaudeBot/scripts/verify_agentic_rules.py
```

Result: `AGENTIC_RULES_VERIFY ok`.

## What Works

- Real workbook ingestion exists for bid log, Home Depot, Cooperative 1881, and
  supplier pricebooks, with source metadata preserved.
- Evidence and claim-gate tables/API exist and stay fail-closed. Best-effort AI
  evidence is recordable but cannot clear regulated gates.
- The Workbench, Settings, and AutoSprink-style studio are backend-driven enough
  for internal-alpha use and surface blocked gates.
- SVG and DXF floor/building import are wired into `/api/projects/:name/sprinkler-bid`.
  DXF is no longer merely engine-only; `tests/dxf-import-api.test.js` verifies
  both single-space `dxf` and multi-space `buildingDxf` through the running API.
- Vector PDF import is wired through the server path with explicit operator scale.
  It rejects missing/invalid scales and marks the extracted geometry as best-effort.
- SAM 3.1/OpenClaw plan segmentation is wired fail-soft through
  `OPENCLAW_BRIDGE_URL`: when the bridge is unset or unavailable, the request
  falls back to vector PDF extraction, returns a real bid, and reports
  `pdfMeta.samSkipped` with a reason. It does not fabricate SAM geometry.
- Full-scope bid plumbing exists and is surfaced as an estimate with calibration
  metadata for real packages. It remains informational and does not clear parity
  or accuracy claims.
- Parts, part overrides, auto-source status, and component manifests exist.
  Catalog overrides can mark an individual component as manufacturer-exact only
  when manufacturer and license are supplied, while parity remains blocked.

## What Is Blocked And Why

| Blocker | Current status | Why it remains blocked | Temporary path |
| --- | --- | --- | --- |
| AutoSprink parity | BLOCKED | No official AutoSprink file/export and complete parity evidence. | Use HaloFire best-effort Studio outputs only, labelled internal alpha. |
| AHJ approval | BLOCKED | No AHJ/Fire Marshal approval artifact. | Generate review packets and issue lists, but do not claim approval. |
| PE/professional review | BLOCKED | No named licensed review or stamp. | Show hydraulic/NFPA estimates as pre-review calculations only. |
| Manufacturer-exact models | BLOCKED | Generated/OpenClaw/SAM/OpenSCAD parts are not manufacturer-approved catalog models. | Use generated parts for visual/layout review; attach real catalog models via Settings as employees obtain them. |
| Permit/fabrication readiness | BLOCKED | Depends on the above regulated approvals and exact submittals. | Export best-effort CAD/BIM artifacts as review aids only. |
| Real SAM run | BLOCKED BY RUNTIME | Server wiring exists, but a live reachable OpenClaw/SAM bridge was not proven in this Codex pickup. | Keep fail-soft vector PDF fallback; set `OPENCLAW_BRIDGE_URL` when GX10 bridge is reachable. |
| STEP/IFC/STL runtime proof | PARTIAL | UI/kernel bindings exist, but this pickup did not produce fresh exported files and validate them. | Use DXF as verified export; run a headless/browser export proof next. |
| Real 1881 geometry accuracy | PARTIAL | Current PDF extraction overcaptures the architectural sheet footprint; tests intentionally log the mismatch rather than tune to the bid. | Use real bid package values for totals and mark auto geometry as correction-needed until a floor-plan page/scale/layer decision is approved. |

## Delivery State

The product is not "nothing usable." It is an internal-alpha workbench with real
data ingestion, claim gates, API security, bid generation, 3D/CAD studio, DXF,
PDF-to-bid, full-scope estimates, and fail-soft OpenClaw/SAM plumbing. The
remaining blockers are mostly evidence/runtime/professional gates, not reasons
to stop building.

The next automation should not restart the old Halo Forge loop. It should work
only in this OneDrive repo, use GX10 brain preflight/postflight, pick one small
slice from the current roadmap, run focused verification, commit scoped files,
and leave a truthful next blocker.

## Next Slices

1. Add a headless or browser-backed runtime proof for STEP/IFC/STL export from
   the Studio/OpenGeometry path, with output size/hash recorded.
2. When GX10 OpenClaw/SAM is reachable, run one real `pdfExtract:"sam"` call
   against the 1881 PDF and capture `pdfMeta` plus bid deltas without clearing
   any regulated gate.
3. Improve the 1881 drawing workflow so employees choose floor-plan sheet,
   scale, extraction mode, and layer/room boundary candidates inside the UI.
4. Add an employee-facing evidence wizard for attaching AHJ/PE/AutoSprink/
   manufacturer artifacts and resolving gates only through acceptable evidence.
5. Keep source workbook values as truth for actual bid numbers; use generated
   estimates as best-effort comparison/correction aids.

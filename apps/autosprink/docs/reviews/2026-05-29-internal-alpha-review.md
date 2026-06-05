# HaloFire Internal-Alpha Review — 2026-05-29

Author: Claude (Opus 4.8), taking over from Codex.
Repo: `C:/Users/dalla/OneDrive/Documents/HaloFire`
Plan: `docs/plans/2026-05-28-halofire-delivery-plan.md`

This is a truthful status of a **best-effort internal-alpha** bid/CAD/evidence
workbench for Halo Fire staff. It is **not** AHJ-approved, PE-reviewed,
AutoSprink-parity, or fabrication-ready, and the app says so on every surface.

---

## What works (verified)

- **Source control + scoped commits.** History through `8a6eb3b`.
- **Real data ingestion** (unchanged from Codex's foundation, re-verified):
  - Bid log: 2,413 sourced bids from `01-Bid Log.xlsx`.
  - Pricebooks: 7,208 rows from ARGCO / FFF / Victaulic workbooks with source
    metadata (`source_file`/`source_sheet`/`source_row`).
  - Home Depot Rexburg values source-linked (bid $792,543.84, row 238, ESI,
    858 heads, 76/69 PSI, 1226 GPM, proposal 121,500 sqft vs bid-log 135,000).
- **API hardening:** env-based JWT/admin bootstrap, role-gated destructive
  routes, update-field allowlists, CORS allowlist, rate limits.
- **Evidence + fail-closed claim gates (NEW — Task 4):**
  - `project_evidence` and `claim_gates` tables, seeded with 5 source-linked
    evidence rows and 5 gates.
  - `GET /api/projects/:name/claim-gates`, `GET .../evidence`,
    `POST .../evidence` (admin-only, field allowlist).
  - Best-effort/AI evidence can be recorded but **never** flips a blocking gate.
- **Sprinkler auto-layout + auto-bid engine (NEW — the core missing feature):**
  - `src/engine/sprinkler-layout.js`: deterministic NFPA-13 standard-spray
    spacing (light/ordinary/extra), grid layout constrained by both max spacing
    and max coverage area, point-in-polygon clipping for non-rectangular rooms,
    pipe routing, bill of materials, pricing (pricebook resolver + flagged
    fallbacks).
  - `src/engine/geometry.js`: extrudes the plan into walls/floor and places
    head + pipe geometry as neutral Y-up JSON for Three.js.
  - `POST /api/projects/:name/sprinkler-bid`: runs the engine, resolves prices
    from the real pricebook (deterministic median), returns bid + 3D scene,
    records a `best_effort` evidence row.
  - Home Depot output: **936 heads @ 11.54 × 11.25 ft** (coverage 129.81 ≤ 130),
    11,205 ft pipe; best-effort total ≈ $544k (partial scope; see caveats).
- **Backend-driven UI (NEW — Task 5):**
  - `index.html` login calls the real API, stores the JWT, routes to the
    workbench (the fake client-side `admin/halofire2026` check is gone).
  - `workbench.html`: loads real project/gates/evidence, runs the engine,
    renders the BOM + pricing and a Three.js 3D building + sprinkler layout.
    Three.js is served locally (no external CDN).
  - Verified in a real browser session (login → workbench → generate → 3D render).

## What is still blocked, and why (fail-closed)

Each gate is a row in `claim_gates`, surfaced in the API and UI:

| Gate | Why blocked | Cleared only by |
|---|---|---|
| `AUTOSPRINK_EVIDENCE_MISSING` | No AutoSprink file/export tied to this bid | A real AutoSprink packet |
| `AHJ_APPROVAL_MISSING` | No Rexburg AHJ/Fire Marshal record | AHJ approval artifact |
| `PROFESSIONAL_REVIEW_MISSING` | No named licensed/PE review | PE / licensed signoff |
| `MANUFACTURER_MODEL_APPROVAL_MISSING` | No manufacturer submittal/approval | Manufacturer approval |
| `BID_LOG_SQFT_DIFFERS_FROM_PROPOSAL` | Bid log 135,000 vs proposal 121,500 sqft | Documented sqft basis decision |

The generated layout is explicitly **best-effort**: it does not and cannot
clear AutoSprink-parity, AHJ, PE, manufacturer, or fabrication-ready claims.

## Known caveats / honest limitations

- **Pricing is partial scope.** The auto-bid covers heads, pipe, fittings,
  hangers, escutcheons + per-head labor + markup. It omits risers, valves, FDC,
  fire pump, backflow, design/permit fees, demo, and freight — so it is
  expectedly **far below** the real $792k bid and must not be presented as a
  complete bid.
- **Pricebook keyword matching is coarse.** Some BOM lines (e.g. "fitting")
  resolve to an unrepresentative median price from the pricebook. The value is
  truthfully labelled `pricebook`-sourced, but the keyword→item mapping should
  be refined for realistic per-line costs.
- **Hazard class is an assumption.** The Home Depot fixture is marked
  `ordinary (UNVERIFIED)`; high-piled storage may require Extra Hazard / ESFR.
- **Floor plan is a simplified rectangle**, not a surveyed/CAD plan. Real plans
  must replace `src/data/floorplans.js`.
- **Landing page hero stats** in `index.html` (47 projects, $4.2M, 98%) are
  still hardcoded marketing placeholders and should be wired to real analytics
  or removed.
- The legacy static `app.html` dashboard is not yet backend-driven; the live
  product surface is `workbench.html`.

## Verification (this review)

```
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-internal-alpha.ps1
```
Output: seed gates=5 evidence=5; `npx vitest run` → **9 files, 41 tests passed**;
`AGENTIC_RULES_VERIFY ok`. Browser preview confirmed login → workbench → 936-head
layout + 3D render with all gates BLOCKED.

## How Halo Fire staff update values / evidence

- **Bid/project/pricebook data:** edit the source workbooks and re-run
  `node src/db/seed.js` (re-imports from the real `.xlsx` files).
- **Add evidence** (e.g. attach an AHJ approval): `POST /api/projects/:name/evidence`
  as an admin with `{ evidence_type, status: "present", source_ref, notes }`.
- **Clear a gate:** intentionally NOT a casual API write. Resolving a blocking
  gate (AutoSprink/AHJ/PE/manufacturer) is a deliberate, evidence-backed action
  and should be implemented as a reviewed workflow, not a checkbox.

## Next recommended work

1. Refine the pricebook keyword→item resolver for realistic per-line costs.
2. Add full bid scope (risers/valves/FDC/pump/fees) behind a clearly-labelled
   estimate, still gated.
3. Floor-plan import (DXF/SVG/PDF → room polygons) to replace the rectangle.
4. A reviewed "resolve gate" workflow that records who/what cleared it.
5. Wire or remove the static landing-page hero metrics.

# Blueprint 14 — Test Strategy

**Scope:** Golden fixtures, CI, Playwright, cruel-test, performance
baselines, parity CI, regression gates.

## 1. Test layers

| Layer | Runner | Where | What |
|---|---|---|---|
| Schema round-trip | vitest | `packages/halofire-schema/tests/` | zod → JSON → zod deep-equal |
| Pascal core schema | Playwright (Node) | `apps/editor/e2e/pascal-fork.spec.ts` | discriminator + helpers |
| HF Core algorithms | vitest | `packages/hf-core/tests/` | NFPA tables + H-W + rule-check |
| Python pipeline unit | pytest | `services/halofire-cad/tests/unit/` | per-agent algorithms |
| Python pipeline e2e | pytest | `services/halofire-cad/tests/e2e/` | full-pipeline against fixtures |
| Python cruel-test | pytest | `services/halofire-cad/tests/cruel/` | 1881 truth comparison |
| Cross-engine parity | vitest + pytest | `packages/hf-core/tests/golden/` | identical inputs → identical outputs |
| Catalog parser | vitest | `packages/hf-core/tests/catalog/` | every annotation variant |
| SCAD runtime | pytest | `services/halopenclaw-gateway/tests/` | cache hit + fallback + detect-binary |
| Tauri commands (unit) | `cargo test` | `src-tauri/src/` | pure-function + deterministic |
| UI smoke | Playwright (browser) | `apps/editor/e2e/` | dev-mode tests |
| Integrated desktop e2e | Playwright against Tauri | `apps/halofire-studio-desktop/e2e/` | full-stack |
| Performance | Playwright + Stats.js | `apps/editor/e2e/perf-*.spec.ts` | FPS, memory, cold launch |

## 2. Golden fixtures

Central directory: `packages/hf-core/tests/golden/`. Both TS + Python
consumers read the same files.

Structure:
```
golden/
├─ hydraulic/
│  ├─ simple-branch-0.10-gpm-ft2.json
│  ├─ 1881-floor-4.json
│  ├─ warehouse-esfr.json
│  └─ remote-area-nfpa-annex-f.json
├─ nfpa13/
│  ├─ spacing-light-hazard.json
│  ├─ hanger-sch10-4in.json
│  └─ seismic-lateral-40ft.json
├─ intake/
│  ├─ 1881-pdf-classification.json
│  └─ dwg-underlay-trace.json
├─ bom/
│  └─ 1881-stocklist-fab-vs-field.json
└─ parity/
   ├─ pipe-friction-loss-matrix.json
   └─ k-equivalent-length-table.json
```

Every fixture = input + expected output + tolerance. Schema:

```json
{
  "name": "…",
  "description": "…",
  "input": { … },
  "expected": { … },
  "tolerance": 0.5,
  "tolerance_kind": "absolute" | "relative"
}
```

## 3. Cross-engine parity CI

`.github/workflows/parity.yml`:

```yaml
jobs:
  parity:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - run: bun install
      - run: pip install -e services/halofire-cad
      - run: bun run test:parity       # vitest with golden tests
      - run: pytest services/halofire-cad/tests/test_parity_*.py
      - run: bun run parity:diff       # compares outputs, fails on drift
```

`bun run parity:diff` = `scripts/parity-diff.ts`:
1. Read every golden.
2. Load TS implementation's output.
3. Load Python implementation's output (from pytest artifact).
4. For each expected field: assert `|ts - py| / max(|expected|,1) < tolerance`.
5. Report drift; exit nonzero if any.

## 4. Cruel-test scoreboard

`services/halofire-cad/tests/cruel/`. Runs the full pipeline
against the 1881 Cooperative project + real-world truth data:

- head_count within 15 % of truth
- total_bid_usd within 15 %
- system_count within 25 %
- level_count exact (0 %)
- pipe_total_ft (SKIP until truth available)
- hydraulic_gpm (SKIP until truth available)

Plus visual / structural / geometric sanity:
- Each kept level has realistic polygon area
- No level has > 300 walls
- Pipes classified by role
- Router emits real hierarchy
- Drops are short + vertical
- Pipes within building envelope
- Cross-mains are horizontal

These run on every PR. Regression is P0.

## 5. Performance baselines

`apps/editor/e2e/perf-baseline.spec.ts`:

```typescript
test('60fps with 1500 heads', async ({ page }) => {
  await page.goto('/')
  await spawnHeadsFromFixture(page, 'warehouse-1500.json')
  const fps = await measureFps(page, { duration_ms: 10_000 })
  expect(fps.avg).toBeGreaterThanOrEqual(55)
  expect(fps.p95).toBeGreaterThanOrEqual(30)
})
```

`measureFps` samples `performance.now()` deltas; rejects the
warm-up first 1 s.

Thresholds in `blueprints/02_FOUNDATION.md §5`. CI fails if
p95 regresses by > 10 %.

## 6. Tauri integrated e2e

`apps/halofire-studio-desktop/e2e/full-flow.spec.ts`:

```typescript
test('drop PDF, get bid, export PDF', async ({ page }) => {
  // Playwright connects via Tauri WebDriver
  await page.setInputFiles('[data-testid=upload]', 'fixtures/1881.pdf')
  await expect(page.getByTestId('stage-intake-done')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('stage-bom-done')).toBeVisible({ timeout: 120_000 })

  // Trigger Export → PDF Sheet Set
  await page.getByRole('button', { name: 'Report' }).click()
  await page.getByRole('button', { name: 'Export Sheet Set' }).click()
  await page.getByRole('button', { name: 'Save PDF' }).click()

  // Verify file on disk
  const pdfPath = path.join(projectDir, 'exports', 'submittal.pdf')
  expect(fs.existsSync(pdfPath)).toBe(true)
  expect(fs.statSync(pdfPath).size).toBeGreaterThan(100_000)
})
```

Run in CI on every PR; smoke-only (doesn't assert every pixel).

## 7. Accessibility audit

`apps/editor/e2e/a11y.spec.ts` using `axe-core`:

```typescript
test('home screen passes axe WCAG 2.1 AA', async ({ page }) => {
  await page.goto('/')
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze()
  expect(results.violations).toEqual([])
})
```

Runs on every major view (home, editor, sheets, properties).

## 8. Regression + snapshot tests

### 8.1 PDF snapshot

`packages/hf-core/tests/report/pdf-snapshot.spec.ts`:
render the same fixture design → compare against
checked-in `snapshot.pdf` via pixel diff (pdf-to-image).
Tolerance: 0.5 % pixel diff. Regenerate on intentional change
via `bun run test:pdf-snapshot -- --update`.

### 8.2 SCAD GLB snapshot

Regenerate every catalog GLB on every CI run; compare triangle
count + bounding box against the prior version. Deviation > 5 %
flags the PR for visual review.

## 9. Mutation testing (v1.5)

`stryker-mutator` on `packages/hf-core/src/nfpa13/` — ensure the
test suite catches rule-check regressions.

## 10. Load / stress

Separate workflow `stress.yml` run nightly:

- 10 000-head warehouse project
- 30 000-ft² hospital with 5 systems
- Repeated open/save cycles (memory leak detection)

Budget: no crash, no memory > 2 GB, no FPS < 30 after 10 min.

## 11. Test data

- Fixture PDFs: `services/halofire-cad/tests/fixtures/pdfs/`
- Fixture DWGs: `services/halofire-cad/tests/fixtures/dwgs/`
- Fixture IFCs: `services/halofire-cad/tests/fixtures/ifcs/`
- Truth JSON: `services/halofire-cad/truth/`

All committed (under git-lfs if > 10 MB).

## 12. Pre-commit hooks

`.husky/pre-commit`:

```bash
#!/usr/bin/env bash
# Fail fast: lint + type check + schema round-trip
bun run lint
bun run check-types
bun run test:schema-roundtrip
```

Pre-push:

```bash
bun run test:unit
pytest services/halofire-cad/tests/unit/ -q
```

## 13. Coverage thresholds

Per package:
- `packages/hf-core/` — 85 % line, 80 % branch
- `packages/halofire-schema/` — 95 % (pure schema)
- `apps/editor/` — 60 % (much is UI, tested via Playwright)
- `services/halofire-cad/` — 75 %

CI gates on coverage regression, not absolute.

## 14. Open questions

- Visual regression across OSes (rendering differs macOS vs
  Windows) — tolerate per-OS snapshots or normalize to a
  reference backend? — per-OS v1.0, reference backend v1.5.
- Fuzz inputs into the dimension parser? — yes, property-based
  via `hypothesis` (Python) + `fast-check` (TS).

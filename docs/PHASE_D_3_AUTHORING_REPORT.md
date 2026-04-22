# Phase D.3 — SCAD authoring from manifest

**Date:** 2026-04-22
**Owner:** Phase D.3 authoring agent
**Inputs:**
- `data/phase_d_manifest.json` (164 entries, Phase D.2 output)
- `packages/halofire-catalog/AGENTS.md` (annotation ↔ field contract, Phase D.1)
- `packages/halofire-catalog/src/schema.ts` (Zod schema, Phase D.1)

## Summary

All 164 manifest entries were authored into `.scad` files under
`packages/halofire-catalog/authoring/scad/`. The build script
(`scripts/build-catalog.ts`) produced a 204-part `catalog.json`
(40 pre-existing + 164 new), and **every generated part validates
cleanly** against `CatalogManifestSchema` — zero parser warnings,
zero Zod errors.

| step                                         | result |
|----------------------------------------------|--------|
| `python scripts/author_from_manifest.py`     | 164 .scad written |
| `bun run scripts/build-catalog.ts`           | 204 parts in catalog.json, no warnings |
| `bun test packages/halofire-catalog/tests/`  | 62 pass / 0 fail |
| `bun test …/tests/schema.test.ts`            | 8 pass / 0 fail, 3085 expect() calls |

## Entries authored, by canonical `PartKind`

| manifest kind   | count | canonical PartKind |
|-----------------|------:|--------------------|
| sprinkler_head  |    85 | `sprinkler_head`   |
| fitting         |    27 | `fitting`          |
| valve           |    23 | `valve`            |
| hanger (+brace) |    13 | `hanger`           |
| pipe            |     9 | `pipe_segment`     |
| switch          |     5 | `device`           |
| trim            |     2 | `device`           |
| **total**       | **164** | |

Entries skipped: **0.** Every manifest entry produced a valid
`.scad` file.

## Generator

`scripts/author_from_manifest.py` is a single-file Python generator
that reads the manifest and emits SCAD with the annotation grammar
documented in `packages/halofire-catalog/AGENTS.md`. Key responsibilities:

- **Kind normalisation** — manifest `pipe` → `pipe_segment`,
  `switch`/`trim` → `device`, others passed through.
- **Category normalisation** — lowercased, dotted, `[a-z0-9.]` only.
  Underscores/dashes become dots. Sprinkler heads (manifest category
  is just `"head"`) get expanded to `head.<orientation>.k<k*10>`
  (e.g. `head.pendant.k56`) so the parser's dotted-category regex is
  happy.
- **Display-name mojibake cleanup** — `\u00e2\u20ac\u201d` (em dash
  mojibake), `\u00c2\u00b0` (degree sign mojibake), and related
  sequences normalised to proper UTF-8 glyphs.
- **Port style mapping** — manifest `threaded_m`/`threaded_f`/`plain_end`
  collapse to the schema's `NPT_threaded` / `grooved`. Kind-aware
  fallbacks when the manifest has no style.
- **Port role mapping** — manifest `inlet`/`outlet` → schema
  `run_a`/`run_b`, with a synthesised `branch` port added to every
  tee (manifest tees ship with only two ports).
- **Axis normalisation** — manifest ports are inconsistently placed
  on the z-axis even for fittings/valves that should be inline on X.
  The generator reprojects:
  - straight-through fittings + all valves → inline along **X**
  - elbows → `-X` inlet / `+Z` outlet (canonical L-bend)
  - tees → `-X`/`+X` run, `+Z` branch (canonical tee)
  - pipes → `±Z` ends, unit-length local frame
  - pendant heads → thread along `+Y`, port at `(0, 0.014, 0)` dir `(0, 1, 0)`
- **Size parsing** — `"1/2NPT"`, `"2grooved"`, `"2.5grooved"` all
  reduce to a numeric `size_in` via a regex + fraction handler.
- **Atomic file writes** — each `.scad` is written to a sibling
  tempfile and `os.replace`d, so a crash mid-run never leaves a
  half-written annotation block that would poison the build.

## Geometry templates

Each canonical kind gets a parametric OpenSCAD geometry template
that approximates the physical part. Templates are intentionally
simple (no threads, no decorative detail) — the 3D viewport doesn't
need manufacturer-grade CAD, it needs a recognisable body + ports
that the port-mating graph can consume. Templates per kind:

- **sprinkler_head** — threaded boss + hex flat + frame yoke + deflector
  disc; orientation (pendant / upright / sidewall) applied as a
  top-level rotation.
- **pipe_segment** — parametric SCH10/SCH40 cylinder with OD/ID
  lookup by NPS; length in meters.
- **fitting.coupling / .union** — outer sleeve + inner rib along X.
- **fitting.elbow** — two legs (−X + +Z) with a knuckle sphere.
- **fitting.tee** — X-axis run + +Z branch, common OD.
- **fitting.cap** — capped stub with raised cap.
- **fitting.reducer** — tapered cone, big end → small end along X.
- **valve** — barrel body + stem + end flanges; scales with NPS.
- **hanger** — sprinkler pipe ring + threaded rod + swivel eye.
- **device** (pressure/tamper/flow/test-and-drain) — enclosure box
  with a pipe saddle stub and a conduit nipple.

## Pass-through / seed-data notes (D.4 pending)

Every authored entry carries the manifest's `price_usd` and
`install_minutes` values through to the annotation block. Per the
manifest's `_estimate_fields` flag these are **seeded, not scraped**,
for:

- `price_usd`: flagged on all 164 entries.
- `install_minutes`: flagged on 160 of 164 entries.

These numbers are intentionally left as-is in D.3 so the catalog
builds and validates end-to-end with realistic-looking defaults. The
D.4 pricing pass should replace them with scraped/quoted values and
drop the `_estimate_fields` flags from the manifest.

## Known approximations / assumptions

1. **Tee branch port synthesised** — the manifest ships tees with
   only two ports. The generator adds a third `branch` port along
   `+Z` so the tee meets NFPA 13 §8.6 router requirements. The
   nominal branch size equals the run size (manifest does not
   distinguish reducing tees here; that's a D.4 data-quality item).
2. **Hangers / braces / devices have no ports from the manifest** —
   each kind gets a single synthetic `run_a` / `drop` / `pipe`
   attachment port pointing along the appropriate local axis.
3. **Crew role is heuristic** — valves → `foreman`, heads /
   hangers / devices → `journeyman`, pipes / fittings →
   `journeyman`. Override by editing the manifest and regenerating,
   not by hand-editing `.scad`.
4. **Display names with unit symbols are preserved** as UTF-8 glyphs
   (`°`, `—`, `"`) — the annotation parser's `@display-name` path
   correctly strips surrounding quotes and treats the interior as
   opaque UTF-8.

## Commits

- `halofire: D.3 — authored 164 components from phase_d_manifest`
  (generator + 164 .scad files + regenerated catalog.json +
  authoring report).

Authored in a single commit because the author-script + .scad files
+ catalog.json + report are one logical unit that must stay in sync
(catalog.json is a build artefact of the .scad files; the report
documents the generator contract). Re-splitting by kind would break
`tests/schema.test.ts` between commits.

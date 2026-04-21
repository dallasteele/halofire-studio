/**
 * R10.6 — Cross-engine parity CI: TypeScript side.
 *
 * Walks every fixture under `packages/hf-core/tests/golden/**` and
 * executes the TypeScript implementation of the algorithm identified
 * by the fixture's subdirectory. Exact-match assertion against
 * `expected`. The Python mirror at
 * `services/halofire-cad/tests/test_golden_parity.py` reads the SAME
 * files and must produce identical output — that's the contract this
 * suite guards. Blueprint 14 §3.
 *
 * To add a new algorithm to parity:
 *   1. Drop a JSON fixture under `packages/hf-core/tests/golden/<algo>/`.
 *   2. Add a dispatch branch below + in the Python test.
 *   3. Both sides must pass in CI for the PR to land.
 */
import { expect, test } from '@playwright/test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  LAYER_ACI_COLOR,
  NODE_TYPE_TO_DXF_LAYER,
  formatDimensionText,
  pipeLayerForRole,
} from '@halofire/core'

const GOLDEN_ROOT = dirname(fileURLToPath(import.meta.url))

interface GoldenFixture {
  name: string
  description?: string
  input: Record<string, unknown>
  expected: Record<string, unknown>
  tolerance: number
  tolerance_kind: 'absolute' | 'relative'
}

function* walkGolden(): Generator<{ algo: string; file: string; fx: GoldenFixture }> {
  for (const entry of readdirSync(GOLDEN_ROOT)) {
    const dir = join(GOLDEN_ROOT, entry)
    if (!statSync(dir).isDirectory()) continue
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue
      const file = join(dir, f)
      const fx = JSON.parse(readFileSync(file, 'utf-8')) as GoldenFixture
      yield { algo: entry, file, fx }
    }
  }
}

test.describe('hf-core × halofire-cad parity — TS side', () => {
  for (const { algo, file, fx } of walkGolden()) {
    test(`${algo} :: ${fx.name}`, () => {
      const got = runAlgorithm(algo, fx)
      expect(got, `fixture ${file}`).toEqual(fx.expected)
    })
  }
})

function runAlgorithm(
  algo: string,
  fx: GoldenFixture,
): Record<string, unknown> {
  switch (algo) {
    case 'layer-mapping':
      return runLayerMapping(fx)
    case 'dimension-format':
      return runDimensionFormat(fx)
    default:
      throw new Error(
        `unknown parity algorithm '${algo}' — add a dispatch branch in golden.spec.ts`,
      )
  }
}

function runLayerMapping(fx: GoldenFixture): Record<string, unknown> {
  const input = fx.input as {
    node_types?: string[]
    roles?: Array<string | null>
    layers?: string[]
  }
  if (input.node_types) {
    return {
      layers: input.node_types.map(
        (t) => NODE_TYPE_TO_DXF_LAYER[t] ?? '__UNKNOWN__',
      ),
    }
  }
  if (input.roles) {
    return {
      layers: input.roles.map((r) => pipeLayerForRole(r ?? undefined)),
    }
  }
  if (input.layers) {
    return {
      colors: input.layers.map((l) => LAYER_ACI_COLOR[l] ?? -1),
    }
  }
  throw new Error('layer-mapping fixture missing node_types | roles | layers')
}

function runDimensionFormat(fx: GoldenFixture): Record<string, unknown> {
  const cases = (fx.input as { cases: Array<{
    length_m: number
    unit_display: 'ft_in' | 'decimal_ft' | 'm' | 'mm'
    precision: number
  }> }).cases
  return {
    labels: cases.map((c) =>
      formatDimensionText(c.length_m, c.unit_display, c.precision),
    ),
  }
}

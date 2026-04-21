/**
 * R10.6 — Cross-engine parity drift guard.
 *
 * Consumed by `.github/workflows/parity.yml` after the TS and Python
 * golden suites pass individually. This script re-computes the TS
 * output for every fixture, loads the Python output from the pytest
 * artifact written by `test_golden_parity.py::test_parity_runner_output_dump`,
 * and asserts they are byte-identical (for string fields) or within
 * the fixture's `tolerance` (for numeric fields).
 *
 * Exits nonzero on any drift — that's the CI gate against future
 * TS ↔ Python regressions. Blueprint 14 §3.
 *
 * Run: `bun run scripts/parity-diff.ts`
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  LAYER_ACI_COLOR,
  NODE_TYPE_TO_DXF_LAYER,
  formatDimensionText,
  pipeLayerForRole,
} from '@halofire/core'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const GOLDEN_ROOT = join(REPO, 'packages/hf-core/tests/golden')
const PY_ARTIFACT = join(
  REPO,
  'services/halofire-cad/tests/golden/.parity-py.json',
)

interface GoldenFixture {
  name: string
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

function runTs(algo: string, fx: GoldenFixture): Record<string, unknown> {
  if (algo === 'layer-mapping') {
    const input = fx.input as {
      node_types?: string[]
      roles?: Array<string | null>
      layers?: string[]
    }
    if (input.node_types)
      return {
        layers: input.node_types.map(
          (t) => NODE_TYPE_TO_DXF_LAYER[t] ?? '__UNKNOWN__',
        ),
      }
    if (input.roles)
      return {
        layers: input.roles.map((r) => pipeLayerForRole(r ?? undefined)),
      }
    if (input.layers)
      return { colors: input.layers.map((l) => LAYER_ACI_COLOR[l] ?? -1) }
  }
  if (algo === 'dimension-format') {
    const cases = (
      fx.input as {
        cases: Array<{
          length_m: number
          unit_display: 'ft_in' | 'decimal_ft' | 'm' | 'mm'
          precision: number
        }>
      }
    ).cases
    return {
      labels: cases.map((c) =>
        formatDimensionText(c.length_m, c.unit_display, c.precision),
      ),
    }
  }
  throw new Error(`unknown algorithm '${algo}'`)
}

function compare(
  key: string,
  ts: unknown,
  py: unknown,
  tolerance: number,
  kind: 'absolute' | 'relative',
  drifts: string[],
): void {
  if (typeof ts === 'number' && typeof py === 'number') {
    const diff = Math.abs(ts - py)
    const denom = kind === 'relative' ? Math.max(Math.abs(ts), 1) : 1
    if (diff / denom > tolerance) {
      drifts.push(
        `  ${key}: ts=${ts} py=${py} diff=${diff} > tolerance=${tolerance}`,
      )
    }
    return
  }
  if (Array.isArray(ts) && Array.isArray(py)) {
    if (ts.length !== py.length) {
      drifts.push(
        `  ${key}: length mismatch ts=${ts.length} py=${py.length}`,
      )
      return
    }
    for (let i = 0; i < ts.length; i++) {
      compare(`${key}[${i}]`, ts[i], py[i], tolerance, kind, drifts)
    }
    return
  }
  if (ts !== py) {
    drifts.push(`  ${key}: ts=${JSON.stringify(ts)} py=${JSON.stringify(py)}`)
  }
}

function main(): number {
  if (!existsSync(PY_ARTIFACT)) {
    console.error(
      `✖ Python parity artifact missing: ${PY_ARTIFACT}\n` +
        `  Run \`pytest services/halofire-cad/tests/test_golden_parity.py\` first.`,
    )
    return 2
  }
  const pyOutput = JSON.parse(readFileSync(PY_ARTIFACT, 'utf-8')) as Record<
    string,
    Record<string, unknown>
  >

  let totalFixtures = 0
  let drifted = 0
  const report: string[] = []

  for (const { algo, file, fx } of walkGolden()) {
    totalFixtures++
    const key = `${algo}::${fx.name}`
    const tsOut = runTs(algo, fx)
    const pyOut = pyOutput[key]
    if (pyOut === undefined) {
      drifted++
      report.push(`✖ ${key} — MISSING from Python artifact (${file})`)
      continue
    }
    const drifts: string[] = []
    const allKeys = new Set([...Object.keys(tsOut), ...Object.keys(pyOut)])
    for (const k of allKeys) {
      compare(k, tsOut[k], pyOut[k], fx.tolerance, fx.tolerance_kind, drifts)
    }
    if (drifts.length > 0) {
      drifted++
      report.push(`✖ ${key} (${file})`)
      report.push(...drifts)
    } else {
      report.push(`✓ ${key}`)
    }
  }

  console.log(report.join('\n'))
  console.log(
    `\nparity-diff: ${totalFixtures - drifted}/${totalFixtures} fixtures clean, ${drifted} drifted`,
  )
  return drifted === 0 ? 0 : 1
}

process.exit(main())

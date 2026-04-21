/**
 * @halofire/core — SCAD annotation parser tests.
 *
 * Runs under Playwright test runner in a Node context. Exercises
 * parseScadText (in-memory) and parseScad (reads a real annotated
 * .scad fixture from packages/halofire-catalog/authoring/scad/).
 *
 * Coverage (blueprint 03 §1, §2):
 *   1. Minimal annotated SCAD → all required PartMeta fields.
 *   2. Missing @part → warnings include that annotation.
 *   3. @param enum type + default coerces correctly.
 *   4. @port round-trips name, vec3s, style, size_in, role.
 *   5. Real fixture pipe.scad → ≥1 port, ≥1 param, slug==='pipe'.
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
import {
  parseScad,
  parseScadText,
} from '@halofire/core/scad/parse-params'

test.describe('@halofire/core — parseScad annotation grammar', () => {
  test('parses a minimal annotated SCAD with all required fields', () => {
    const src = [
      '// @part widget',
      '// @kind fitting',
      '// @category fitting.union',
      '// @display-name "Test Widget"',
      '// @param size_in number default=2 label="Size" unit="in"',
      '// @port in position=[0,0,0] direction=[1,0,0] style=grooved size_in=2 role=run_a',
      '',
      'size_in = 2;',
    ].join('\n')
    const r = parseScadText(src, 'widget.scad')
    expect(r.part.slug).toBe('widget')
    expect(r.part.kind).toBe('fitting')
    expect(r.part.category).toBe('fitting.union')
    expect(r.part.displayName).toBe('Test Widget')
    expect(Object.keys(r.params)).toContain('size_in')
    expect(r.ports).toHaveLength(1)
    expect(r.warnings).toEqual([])
  })

  test('collects warning when @part is missing', () => {
    const src = [
      '// @kind fitting',
      '// @category fitting.cap',
      '// @display-name "No Part Tag"',
      '// @port in position=[0,0,0] direction=[0,0,-1] style=grooved size_in=2 role=run_a',
    ].join('\n')
    const r = parseScadText(src, 'orphan.scad')
    expect(r.warnings.some((w) => /missing required @part/i.test(w))).toBe(true)
    // slug falls back to filename stem
    expect(r.part.slug).toBe('orphan')
  })

  test('parses @param enum with defaults and label/unit', () => {
    const src = [
      '// @part sizer',
      '// @kind fitting',
      '// @category fitting.reducer.concentric',
      '// @display-name "Sizer"',
      '// @param size_in enum[1,1.5,2,4] default=2 label="Size" unit="in"',
      '// @port in position=[0,0,0] direction=[1,0,0] style=grooved size_in=2 role=run_a',
    ].join('\n')
    const r = parseScadText(src, 'sizer.scad')
    const p = r.params.size_in
    expect(p).toBeDefined()
    expect(p?.type.kind).toBe('enum')
    if (p?.type.kind === 'enum') {
      expect(p.type.values).toEqual([1, 1.5, 2, 4])
    }
    expect(p?.default).toBe(2)
    expect(p?.label).toBe('Size')
    expect(p?.unit).toBe('in')
  })

  test('@port round-trips name, position, direction, style, size_in, role', () => {
    const src = [
      '// @part tee1',
      '// @kind fitting',
      '// @category fitting.tee.grooved',
      '// @display-name "Tee"',
      '// @port branch position=[0,0,0.06] direction=[0,0,1] style=grooved size_in=2 role=branch',
    ].join('\n')
    const r = parseScadText(src, 'tee1.scad')
    expect(r.ports).toHaveLength(1)
    const port = r.ports[0]
    expect(port?.name).toBe('branch')
    expect(port?.position_m).toEqual([0, 0, 0.06])
    expect(port?.direction).toEqual([0, 0, 1])
    expect(port?.style).toBe('grooved')
    expect(port?.size_in).toBe(2)
    expect(port?.role).toBe('branch')
  })

  test('catalog.json has 40 parts with expected kind distribution', () => {
    const fp = resolve(
      __dirname,
      '../../../halofire-catalog/catalog.json',
    )
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const catalog = JSON.parse(
      // read via fs to avoid ESM/CJS import shenanigans
      // biome-ignore lint: node:fs sync read is fine in a test
      require('node:fs').readFileSync(fp, 'utf-8'),
    ) as { parts: Array<{ kind: string }> }

    expect(catalog.parts.length).toBe(40)

    const dist: Record<string, number> = {}
    for (const p of catalog.parts) dist[p.kind] = (dist[p.kind] ?? 0) + 1

    expect(dist.sprinkler_head ?? 0).toBeGreaterThanOrEqual(5)
    expect(dist.pipe_segment ?? 0).toBeGreaterThanOrEqual(1)
    expect(dist.fitting ?? 0).toBeGreaterThanOrEqual(10)
    expect(dist.valve ?? 0).toBeGreaterThanOrEqual(6)
    expect(dist.hanger ?? 0).toBeGreaterThanOrEqual(5)
    expect(dist.device ?? 0).toBeGreaterThanOrEqual(4)
    expect(dist.fdc ?? 0).toBeGreaterThanOrEqual(1)
    expect(dist.structural ?? 0).toBeGreaterThanOrEqual(3)
  })

  test('real fixture pipe.scad parses with ports and params', () => {
    const fp = resolve(
      __dirname,
      '../../../halofire-catalog/authoring/scad/pipe.scad',
    )
    const r = parseScad(fp)
    expect(r.part.slug).toBe('pipe')
    expect(r.part.kind).toBe('pipe_segment')
    expect(r.part.category).toBe('pipe.sch10.grooved')
    expect(r.ports.length).toBeGreaterThanOrEqual(1)
    expect(Object.keys(r.params).length).toBeGreaterThanOrEqual(1)
    // no "missing required" warnings for a fully-annotated file
    const missing = r.warnings.filter((w) => /missing required/i.test(w))
    expect(missing).toEqual([])
  })
})

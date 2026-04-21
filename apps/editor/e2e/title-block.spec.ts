/**
 * R6.2 / R6.3 — TitleBlockRenderer + halofire-standard template.
 *
 * Pure unit tests running under the Playwright test runner in a
 * Node context (no browser, no next server). Imports the template
 * SVG string and the pure `renderTitleBlockSvg` substitutor.
 */
import { expect, test } from '@playwright/test'
import {
  HALOFIRE_STANDARD_PAPER_MM,
  HALOFIRE_STANDARD_SVG,
  HALOFIRE_STANDARD_TEMPLATE_ID,
} from '../../../packages/halofire-catalog/title-blocks/halofire-standard-svg'
import { renderTitleBlockSvg } from '../../../packages/editor/src/components/sheet/title-block-renderer'

test.describe('title-block renderer', () => {
  test('substitutes project_name into the SVG', () => {
    const out = renderTitleBlockSvg(
      HALOFIRE_STANDARD_SVG,
      { project_name: 'Halo Fire HQ' },
      [914, 610],
    )
    expect(out).toContain('Halo Fire HQ')
    expect(out).not.toContain('{{project_name}}')
  })

  test('missing field substitutes to em-dash', () => {
    const out = renderTitleBlockSvg(
      HALOFIRE_STANDARD_SVG,
      {},
      [914, 610],
    )
    // Every token in the template should be substituted.
    expect(out).not.toMatch(/\{\{[a-zA-Z_]+\}\}/)
    // Em-dash placeholder is present for absent fields.
    expect(out).toContain('\u2014')
  })

  test('paper size 914x610 is embedded in viewBox', () => {
    const out = renderTitleBlockSvg(
      HALOFIRE_STANDARD_SVG,
      { project_name: 'X' },
      [914, 610],
    )
    expect(out).toContain('viewBox="0 0 914 610"')
    expect(HALOFIRE_STANDARD_PAPER_MM).toEqual([914, 610])
    expect(HALOFIRE_STANDARD_TEMPLATE_ID).toBe('halofire.standard')
  })

  test('PE seal slot exists as an empty group', () => {
    const out = renderTitleBlockSvg(
      HALOFIRE_STANDARD_SVG,
      { project_name: 'Y' },
      [914, 610],
    )
    expect(out).toContain('data-slot="pe-seal"')
    // Slot dimensions are 60 x 60 mm per blueprint 07 section 3.
    expect(out).toMatch(/data-slot="pe-seal"[\s\S]*?width="60"[\s\S]*?height="60"/)
  })

  test('XML-escapes values so field text cannot inject markup', () => {
    const out = renderTitleBlockSvg(
      HALOFIRE_STANDARD_SVG,
      { project_name: '<script>alert(1)</script>' },
      [914, 610],
    )
    expect(out).not.toContain('<script>alert(1)</script>')
    expect(out).toContain('&lt;script&gt;')
  })
})

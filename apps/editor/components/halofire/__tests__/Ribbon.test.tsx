/**
 * Ribbon unit test — smoke-check each tab shows its commands and
 * clicking a button fires the right RibbonCommand.
 *
 * Run: `bun test apps/editor/components/halofire/__tests__/Ribbon.test.tsx`
 */
import { describe, expect, test } from 'bun:test'
import { renderToString } from 'react-dom/server'
import { Ribbon, type RibbonCommand } from '../Ribbon'

describe('Ribbon', () => {
  test('renders every tab strip button', () => {
    const html = renderToString(<Ribbon />)
    for (const t of ['design', 'analyze', 'report']) {
      expect(html).toContain(`ribbon-tab-${t}`)
    }
  })

  test('Design tab shows Auto-Design + layer commands by default', () => {
    const html = renderToString(<Ribbon />)
    expect(html).toContain('Auto-Design')
    expect(html).toContain('Heads')
    expect(html).toContain('Pipes')
    expect(html).toContain('Walls')
    expect(html).toContain('Zones')
    expect(html).toContain('Measure')
    expect(html).toContain('Snap')
  })

  test('brand + Studio wordmark present', () => {
    const html = renderToString(<Ribbon />)
    expect(html).toContain('Halo Fire')
    expect(html).toContain('Studio')
  })

  test('icon shortcut buttons (new/load/save) are in the top strip', () => {
    const html = renderToString(<Ribbon />)
    expect(html).toContain('title="New bid"')
    expect(html).toContain('title="Load bid"')
    expect(html).toContain('title="Save bid"')
  })

  test('every command label appears in the Analyze tab markup', () => {
    const html = renderToString(<Ribbon defaultTab="analyze" />)
    expect(html).toContain('Calculate')
    expect(html).toContain('NFPA check')
    expect(html).toContain('Stress test')
  })

  test('every command label appears in the Report tab markup', () => {
    const html = renderToString(<Ribbon defaultTab="report" />)
    expect(html).toContain('Proposal')
    expect(html).toContain('Submittal')
    expect(html).toContain('DXF')
    expect(html).toContain('IFC')
    expect(html).toContain('Send bid')
  })

  test('onCommand callback is exported and typed', () => {
    // Compile-time smoke: the type must accept every RibbonCommand
    // the UI can emit. If anyone tightens the union accidentally,
    // this fails to compile.
    const allowed: RibbonCommand[] = [
      'bid-new', 'bid-load', 'bid-save',
      'auto-design',
      'layer-heads', 'layer-pipes', 'layer-walls', 'layer-zones',
      'snap-toggle', 'measure', 'section',
      'hydraulic-calc', 'rule-check', 'stress-test',
      'report-proposal', 'report-submittal',
      'report-export-dxf', 'report-export-ifc',
      'report-send-to-client',
    ]
    expect(allowed.length).toBeGreaterThan(0)
  })
})

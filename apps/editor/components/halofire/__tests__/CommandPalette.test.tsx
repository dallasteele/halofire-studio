import { describe, expect, test } from 'bun:test'
import { renderToString } from 'react-dom/server'
import {
  CommandPalette,
  DEFAULT_ENTRIES,
  rankEntries,
  type Entry,
} from '../CommandPalette'

describe('CommandPalette', () => {
  test('default entries cover every ribbon category + goto-tab', () => {
    const groups = new Set(DEFAULT_ENTRIES.map((e) => e.group))
    for (const g of ['Design', 'Analyze', 'Report', 'File', 'Go to']) {
      expect(groups.has(g)).toBe(true)
    }
  })

  test('closed by default (not in SSR html)', () => {
    const html = renderToString(<CommandPalette />)
    // Palette has data-testid only when open. SSR pass with no
    // keypress = not open = empty render.
    expect(html).not.toContain('halofire-command-palette')
  })

  test('rankEntries exact prefix beats mid-string match', () => {
    const ranked = rankEntries(DEFAULT_ENTRIES, 'run')
    // 'Run Auto-Design' should rank first over anything else
    expect(ranked[0]?.label).toContain('Run')
  })

  test('rankEntries requires every token to match', () => {
    const ranked = rankEntries(DEFAULT_ENTRIES, 'auto design')
    expect(ranked[0]?.label).toContain('Auto-Design')
    // A garbage token kills the result set
    expect(rankEntries(DEFAULT_ENTRIES, 'asdfqwerty')).toEqual([])
  })

  test('rankEntries empty query returns all entries', () => {
    const ranked = rankEntries(DEFAULT_ENTRIES, '')
    expect(ranked.length).toBe(DEFAULT_ENTRIES.length)
  })

  test('rankEntries uses keywords', () => {
    const ranked = rankEntries(DEFAULT_ENTRIES, 'portal')
    // 'Send bid to client' has 'portal' as a keyword
    expect(ranked[0]?.label).toContain('Send bid')
  })

  test('rankEntries is case-insensitive', () => {
    const lower = rankEntries(DEFAULT_ENTRIES, 'nfpa')
    const upper = rankEntries(DEFAULT_ENTRIES, 'NFPA')
    expect(lower[0]?.id).toEqual(upper[0]?.id)
  })

  test('entry ids are unique', () => {
    const ids = DEFAULT_ENTRIES.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('every non-goto entry has a RibbonCommand', () => {
    for (const e of DEFAULT_ENTRIES) {
      if (!e.goTab) {
        expect(e.cmd).toBeDefined()
      }
    }
  })

  test('rankEntries accepts custom entry list', () => {
    const custom: Entry[] = [
      { id: 'a', label: 'Alpha', group: 'g' },
      { id: 'b', label: 'Beta', group: 'g' },
    ]
    const ranked = rankEntries(custom, 'beta')
    expect(ranked.map((e) => e.id)).toEqual(['b'])
  })
})

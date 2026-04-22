import { describe, expect, test } from 'bun:test'
import { renderToString } from 'react-dom/server'
import { LiveCalc, _internals } from '../LiveCalc'

describe('LiveCalc', () => {
  test('renders the live-hydraulic panel frame on mount', () => {
    // Phase C: the panel is visible by default and shows the empty
    // state until the first `/calculate` call returns.
    const html = renderToString(<LiveCalc />)
    expect(html).toContain('halofire-live-calc')
    expect(html).toContain('Live hydraulic')
  })

  test('props signature accepts gatewayUrl for back-compat', () => {
    // gatewayUrl is still accepted even though the IPC facade owns
    // routing; making sure the call doesn't throw.
    const html = renderToString(<LiveCalc gatewayUrl="http://x" />)
    expect(html).toContain('halofire-live-calc')
  })

  test('friendly() turns gateway 404s into actionable copy', () => {
    const m = _internals.friendly('gateway POST /calculate → HTTP 404: ...')
    expect(m).toContain('endpoint missing')
  })

  test('friendly() handles ECONNREFUSED / Failed to fetch', () => {
    expect(_internals.friendly('Failed to fetch')).toContain('gateway offline')
  })

  test('friendly() caps overly long error messages', () => {
    const long = 'E'.repeat(500)
    const out = _internals.friendly(long)
    expect(out.length).toBeLessThan(200)
    expect(out.endsWith('…')).toBe(true)
  })

  test('emitSceneChange fires a window event', () => {
    if (typeof window === 'undefined') return
    let fired = 0
    const handler = () => { fired++ }
    window.addEventListener('halofire:scene-changed', handler)
    _internals.emitSceneChange()
    expect(fired).toBe(1)
    window.removeEventListener('halofire:scene-changed', handler)
  })

  test('emitSceneChange is a no-op when window is undefined', () => {
    const origWin = (globalThis as any).window
    ;(globalThis as any).window = undefined
    try {
      // Must not throw
      _internals.emitSceneChange()
    } finally {
      ;(globalThis as any).window = origWin
    }
  })
})

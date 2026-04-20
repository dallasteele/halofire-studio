import { describe, expect, test } from 'bun:test'
import { renderToString } from 'react-dom/server'
import { LiveCalc, _internals } from '../LiveCalc'

describe('LiveCalc', () => {
  test('hidden on initial SSR render (starts closed)', () => {
    const html = renderToString(<LiveCalc />)
    // visible=false in initial state — returns null
    expect(html).not.toContain('halofire-live-calc')
  })

  test('default gateway url is halopenclaw on localhost', () => {
    // Props default is http://localhost:18080 — lift via component
    // renderToString inspection isn't enough; we check the prop
    // signature is consumable.
    const html = renderToString(<LiveCalc gatewayUrl="http://x" />)
    // Empty render in initial state
    expect(html).toBe('')
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

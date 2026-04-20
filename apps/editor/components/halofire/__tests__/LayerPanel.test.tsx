import { describe, expect, test } from 'bun:test'
import React from 'react'
import { renderToString } from 'react-dom/server'
import {
  DEFAULT_VISIBILITY,
  LAYER_DEFS,
  LayerPanel,
  setAllLayers,
  toggleLayer,
  type LayerVisibility,
} from '../LayerPanel'

describe('LayerPanel reducers', () => {
  test('toggleLayer flips the specified id only', () => {
    const next = toggleLayer(DEFAULT_VISIBILITY, 'heads')
    expect(next.heads).toBe(!DEFAULT_VISIBILITY.heads)
    expect(next.pipes).toBe(DEFAULT_VISIBILITY.pipes)
    expect(next.walls).toBe(DEFAULT_VISIBILITY.walls)
  })

  test('toggleLayer is pure (does not mutate input)', () => {
    const before: LayerVisibility = { ...DEFAULT_VISIBILITY }
    toggleLayer(before, 'heads')
    expect(before).toEqual(DEFAULT_VISIBILITY)
  })

  test('setAllLayers(true) turns everything on', () => {
    const all = setAllLayers(DEFAULT_VISIBILITY, true)
    for (const d of LAYER_DEFS) expect(all[d.id]).toBe(true)
  })

  test('setAllLayers(false) turns everything off', () => {
    const none = setAllLayers(DEFAULT_VISIBILITY, false)
    for (const d of LAYER_DEFS) expect(none[d.id]).toBe(false)
  })

  test('LAYER_DEFS covers every key in DEFAULT_VISIBILITY', () => {
    const keys = Object.keys(DEFAULT_VISIBILITY)
    const defIds = LAYER_DEFS.map((d) => d.id)
    for (const k of keys) expect(defIds).toContain(k)
  })

  test('hotkeys are single uppercase letters', () => {
    for (const d of LAYER_DEFS) {
      if (d.hotkey) expect(d.hotkey).toMatch(/^[A-Z]$/)
    }
  })
})

describe('LayerPanel render', () => {
  test('SSR renders the panel shell with every layer row', () => {
    const html = renderToString(<LayerPanel />)
    expect(html).toContain('halofire-layer-panel')
    for (const d of LAYER_DEFS) {
      expect(html).toContain(`layer-toggle-${d.id}`)
      expect(html).toContain(d.label)
    }
  })

  test('each hotkey letter appears in the rendered markup', () => {
    const html = renderToString(<LayerPanel />)
    for (const d of LAYER_DEFS) {
      if (d.hotkey) expect(html).toContain(d.hotkey)
    }
  })

  test('initial prop controls starting visibility in markup', () => {
    const init: LayerVisibility = {
      ...DEFAULT_VISIBILITY,
      heads: false,
    }
    const html = renderToString(<LayerPanel initial={init} />)
    // 'text-neutral-500' is the dimmed class for hidden layers;
    // the heads row will contain it.
    expect(html).toContain('text-neutral-500')
  })
})

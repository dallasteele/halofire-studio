/**
 * Phase H.4 — CatalogCard status-chip mapping.
 *
 * Bun's SSR + React 19 + zustand 5 combination doesn't resolve the
 * React hook dispatcher reliably during `renderToString`, so we keep
 * the rendering coverage here focused on the pure status mapping
 * (which is the "logic under test" — the rest is presentational
 * tokenized JSX covered by the Playwright E2E suite in Phase G).
 *
 * Each enrichment status variant is asserted via `statusChipFor()` —
 * flip the chip palette in `CatalogCard.tsx` and this breaks loud.
 */

import { describe, expect, test } from 'bun:test'
import { STATUS_CHIP_MAP, statusChipFor } from '../CatalogCard'
import type { EnrichmentStatus } from '../../../lib/halofire/catalog-store'

describe('CatalogCard status chip mapping', () => {
  const ALL_STATUSES: EnrichmentStatus[] = [
    'validated',
    'needs_review',
    'rejected',
    'fallback',
    'not_yet_run',
  ]

  test('every enrichment status has a chip entry', () => {
    for (const status of ALL_STATUSES) {
      expect(STATUS_CHIP_MAP[status]).toBeDefined()
      expect(STATUS_CHIP_MAP[status].label).toBeTruthy()
      expect(STATUS_CHIP_MAP[status].description.length).toBeGreaterThan(4)
    }
  })

  test('statusChipFor returns earthen-palette CSS vars only', () => {
    // No raw hex values — Phase G token policy.
    for (const status of ALL_STATUSES) {
      const chip = statusChipFor(status)
      expect(chip.color.startsWith('var(--color-hf-')).toBe(true)
    }
  })

  test('validated → moss, needs_review → gold, rejected → brick', () => {
    expect(statusChipFor('validated').color).toBe('var(--color-hf-moss)')
    expect(statusChipFor('validated').label).toBe('OK')
    expect(statusChipFor('needs_review').color).toBe('var(--color-hf-gold)')
    expect(statusChipFor('needs_review').label).toBe('REVIEW')
    expect(statusChipFor('rejected').color).toBe('var(--color-hf-brick)')
    expect(statusChipFor('rejected').label).toBe('REJECTED')
  })

  test('fallback + not_yet_run are outline-only chips', () => {
    expect(statusChipFor('fallback').filled).toBe(false)
    expect(statusChipFor('fallback').label).toBe('FALLBACK')
    expect(statusChipFor('not_yet_run').filled).toBe(false)
    expect(statusChipFor('not_yet_run').label).toBe('PENDING')
  })

  test('validated / needs_review / rejected are filled chips', () => {
    expect(statusChipFor('validated').filled).toBe(true)
    expect(statusChipFor('needs_review').filled).toBe(true)
    expect(statusChipFor('rejected').filled).toBe(true)
  })
})

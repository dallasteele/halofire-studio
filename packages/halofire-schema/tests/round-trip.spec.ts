/**
 * @halofire/schema — round-trip + validation tests.
 *
 * Runs under Playwright test runner in a Node context. Exercises
 * the zod schemas directly (no browser, no next server).
 *
 * Covers the eight contract checks called out in docs/blueprints/
 * 01_DATA_MODEL.md §6 and the R5 prompt:
 *   1. ProjectManifest parses a valid record.
 *   2. ProjectManifest rejects missing project_id.
 *   3. Correction parses a wall.delete variant.
 *   4. Correction parses a wall.move variant.
 *   5. Correction rejects an unknown discriminant.
 *   6. Comment with replies round-trips JSON.
 *   7. AuditEntry with structured delta round-trips JSON.
 *   8. CatalogLock with parts round-trips; schema_version literal 1 is enforced.
 */
import { expect, test } from '@playwright/test'
import { ProjectManifest } from '@halofire/schema/project'
import { Correction } from '@halofire/schema/correction'
import { Comment } from '@halofire/schema/comment'
import { AuditEntry } from '@halofire/schema/audit'
import { CatalogLock } from '@halofire/schema/catalog-lock'

test.describe('@halofire/schema — .hfproj contracts', () => {
  test('ProjectManifest parses a valid record', () => {
    const parsed = ProjectManifest.parse({
      schema_version: 1,
      project_id: 'p_001',
      name: 'Warehouse B',
      address: '123 Fake St',
      firm: 'Halo Fire',
      designer: 'Dan F',
      units: 'imperial',
      code_edition: 'NFPA 13 2022',
      created_at: '2026-04-21T00:00:00Z',
      modified_at: '2026-04-21T00:00:00Z',
      app_version: '0.1.0',
      capabilities: ['hydraulic-calcs', 'submittal-export'],
    })
    expect(parsed.project_id).toBe('p_001')
    expect(parsed.units).toBe('imperial')
  })

  test('ProjectManifest rejects missing project_id', () => {
    const result = ProjectManifest.safeParse({
      schema_version: 1,
      name: 'No id',
      address: '-',
      firm: '-',
      designer: '-',
      created_at: '2026-04-21T00:00:00Z',
      modified_at: '2026-04-21T00:00:00Z',
      app_version: '0.1.0',
      capabilities: [],
    })
    expect(result.success).toBe(false)
  })

  test('Correction.wall_delete parses', () => {
    const parsed = Correction.parse({
      type: 'wall.delete',
      wall_id: 'w_42',
      at: '2026-04-21T00:05:00Z',
      by: 'designer@halofire.com',
    })
    expect(parsed.type).toBe('wall.delete')
  })

  test('Correction.wall_move parses', () => {
    const parsed = Correction.parse({
      type: 'wall.move',
      wall_id: 'w_9',
      from_start: [0, 0],
      to_start: [0.5, 0],
      from_end: [10, 0],
      to_end: [10.5, 0],
      at: '2026-04-21T00:06:00Z',
    })
    expect(parsed.type).toBe('wall.move')
    if (parsed.type === 'wall.move') {
      expect(parsed.to_start).toEqual([0.5, 0])
    }
  })

  test('Correction rejects unknown discriminant', () => {
    const result = Correction.safeParse({
      type: 'wall.teleport',
      wall_id: 'w_1',
      at: '2026-04-21T00:00:00Z',
    })
    expect(result.success).toBe(false)
  })

  test('Comment with replies round-trips JSON', () => {
    const original = {
      id: 'c_1',
      node_id: 'n_7',
      author: 'wade@halofire.com',
      created_at: '2026-04-21T00:00:00Z',
      text: 'Verify head K-factor here.',
      resolved: false,
      replies: [
        { author: 'dan@halofire.com', at: '2026-04-21T00:10:00Z', text: 'On it.' },
      ],
    }
    const parsed = Comment.parse(original)
    const reparsed = Comment.parse(JSON.parse(JSON.stringify(parsed)))
    expect(reparsed).toEqual(parsed)
    expect(reparsed.replies).toHaveLength(1)
  })

  test('AuditEntry with delta round-trips JSON', () => {
    const original = {
      ts: '2026-04-21T00:00:00Z',
      actor: 'pe@halofire.com',
      action: 'stamp',
      target: 'design/current.json',
      delta: { stamped: true, license: 'PE-12345' },
      reason: 'Final AHJ submittal',
    }
    const parsed = AuditEntry.parse(original)
    const reparsed = AuditEntry.parse(JSON.parse(JSON.stringify(parsed)))
    expect(reparsed).toEqual(parsed)
  })

  test('CatalogLock round-trips; schema_version literal 1 enforced', () => {
    const original = {
      schema_version: 1 as const,
      catalog_version: '2026.04.1',
      catalog_hash: 'sha256:abc123',
      frozen_at: '2026-04-21T00:00:00Z',
      parts: [
        {
          sku: 'TY3251',
          part_hash: 'sha256:def456',
          unit_cost_usd: 12.5,
          price_source: 'Viking 2026Q2',
        },
      ],
    }
    const parsed = CatalogLock.parse(original)
    const reparsed = CatalogLock.parse(JSON.parse(JSON.stringify(parsed)))
    expect(reparsed).toEqual(parsed)

    const bad = CatalogLock.safeParse({ ...original, schema_version: 2 })
    expect(bad.success).toBe(false)
  })
})

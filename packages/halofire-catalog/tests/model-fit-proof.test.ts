/**
 * Stream F model-fit proof regression.
 *
 * The approval inventory adapter must keep the current proof rows honest:
 * source hashes and local artifact hashes are present, but the inventory
 * still blocks catalog-engineering claims until reviewer decisions are
 * recorded.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  buildCatalogEngineeringApprovalInventory,
  CatalogModelFitProofRunSchema,
  summarizeCatalogModelFitProofRun,
} from '../src/index.js'

const PROOF_RUN_PATH = resolve(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  'out',
  'halo-forge',
  '2026-05-17-catalog-model-fit-proof',
  'catalog_model_fit_proof',
  'output.json',
)

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T
}

describe('model-fit proof inventory', () => {
  test('validates the checked-in proof run and keeps catalog engineering blocked', () => {
    const run = CatalogModelFitProofRunSchema.parse(loadJson(PROOF_RUN_PATH))

    expect(run.proofs).toHaveLength(3)
    expect(run.summary).toEqual(summarizeCatalogModelFitProofRun(run))

    const inventory = buildCatalogEngineeringApprovalInventory(run)

    expect(inventory.proof_count).toBe(3)
    expect(inventory.review_ready_proof_count).toBe(3)
    expect(inventory.blocked_proof_count).toBe(0)
    expect(inventory.cleared_proof_count).toBe(0)
    expect(inventory.catalog_engineering_ready).toBe(false)
    expect(inventory.engineering_grade_ready).toBe(false)
    expect(inventory.blocked_claims).toEqual([
      'engineering_grade_ready',
      'fabrication_ready',
      'submittal_ready',
      'catalog_engineering_ready',
    ].sort())
    expect(inventory.rows).toHaveLength(3)
    expect(inventory.rows[0]?.source_url).toContain('.pdf')
    expect(inventory.rows[0]?.missing_reviewer_decisions).toEqual([
      'dimension_match',
      'model_geometry_match',
      'source_license_acceptance',
      'approved_for_catalog_engineering',
    ])
    expect(inventory.rows[0]?.next_action).toContain('Await reviewer decisions')
    expect(inventory.rows.every((row) => row.fit_checks.claim_gate_preserved === 'pass')).toBe(true)
  })

  test('proof rows require reviewer decisions before they can clear claims', () => {
    const inventory = buildCatalogEngineeringApprovalInventory({
      schema_version: 'halo_forge.sprinkler_catalog_model_fit_proof.v1',
      bid_id: '1881',
      catalog_source_acquisition_output_ref:
        'out/halo-forge/2026-05-17-catalog-source-acquisition/catalog_source_acquisition/output.json',
      catalog_engineering_ready: false,
      engineering_grade_ready: false,
      proofs: [
        {
          proof_ref: 'sprinkler_catalog_model_fit_proof:1881:demo',
          acquisition_record_ref: 'sprinkler_catalog_source_acquisition:1881:demo',
          family_ref: 'family:demo',
          part_ref: 'demo',
          proof_status: 'review_ready',
          source_kind: 'manufacturer',
          manufacturer: 'Demo',
          model: 'Demo Model',
          public_url: 'https://example.com/demo',
          source_url: 'https://example.com/demo.pdf',
          source_file_ref: 'E:/ClaudeBot/demo.pdf',
          source_file_sha256: 'abc123',
          local_artifact_hashes: {
            glb: 'aaa',
            ifc: 'bbb',
            dxf: 'ccc',
          },
          fit_checks: {
            public_url_present: 'pass',
            source_url_present: 'pass',
            source_file_hash_present: 'pass',
            manufacturer_source_present: 'pass',
            local_glb_hash_present: 'pass',
            local_ifc_hash_present: 'pass',
            local_dxf_hash_present: 'pass',
            claim_gate_preserved: 'pass',
          },
          required_reviewer_decisions: [
            'dimension_match',
            'model_geometry_match',
            'source_license_acceptance',
            'approved_for_catalog_engineering',
          ],
          model_fit_claim: 'Demo claim',
          clears_catalog_engineering_claim: false,
          blocked_claims: ['catalog_engineering_ready'],
          claim_gate_policy: 'Claims remain blocked until decisions exist.',
          source_refs: ['https://example.com/demo'],
        },
      ],
      summary: {
        proof_count: 1,
        review_ready_proof_count: 1,
        blocked_proof_count: 0,
        source_hash_ready_count: 1,
        local_artifact_hash_ready_count: 1,
        claims_cleared_count: 0,
        catalog_engineering_ready: false,
        engineering_grade_ready: false,
      },
      issues: [],
      manifest: {
        artifacts: [],
        capabilities: ['halo_forge_sprinkler_catalog_model_fit_proof'],
        warnings: [],
        issues: [],
      },
    })

    expect(inventory.rows[0]?.clears_catalog_engineering_claim).toBe(false)
    expect(inventory.rows[0]?.missing_reviewer_decisions).toHaveLength(4)
    expect(inventory.next_action).toContain('Await reviewer decisions')
  })
})

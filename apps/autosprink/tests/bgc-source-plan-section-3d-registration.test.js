import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  validateBgcSourcePlanSection3dRegistration,
  verifyBgcSourcePlanSection3dAdversarialLoop,
} from '../src/engine/bgc-source-plan-section-3d-registration.js'

const packet = JSON.parse(
  fs.readFileSync(
    new URL('../src/data/bgc-source-plan-section-3d-registration.json', import.meta.url),
    'utf8',
  ),
)
const proof = (name) =>
  new URL(`../src/data/proofs/bgc-source-plan-section-3d-registration/${name}`, import.meta.url)

describe('BGC actual-PDF plan, section, native FAB, and 3D registration', () => {
  it('closes the 64-head, eight-feed, cross-main graph across plan, listing, FAB, approved, and A301 sources', async () => {
    const result = await validateBgcSourcePlanSection3dRegistration(packet)
    expect(result).toMatchObject({
      status: 'passed',
      sourcePlanCoordinatesVerified: true,
      sourceBranchHalfAdjacencyVerified: true,
      sourceBranchFeedTopologyVerified: true,
      sourceCrossMainPlanAxisVerified: true,
      pipeSizeVerified: true,
      exactInstalledPipeElevationVerified: false,
      pipeDirectionVerified: false,
      pipeGradeVerified: false,
      complianceReady: false,
      fabricationReady: false,
      fieldReleaseReady: false,
      vpsReleaseReady: false,
    })
    expect(packet.geometryGraph).toMatchObject({ nodeCount: 90, edgeCount: 89 })
    expect(packet.registration.plan.branchHalfOffset.meanOffsetPt).toBeCloseTo(4.162476, 6)
    expect(packet.detectors).toMatchObject({
      asBuilt: { guardedUprightCount: 64 },
      ahjApproved: { guardedUprightCount: 64 },
      approvedToAsBuiltParity: { coordinateParityClaimed: false },
      branchFeedAxis: { segmentCount: 16, branchFeedCount: 8 },
    })
    expect(packet.networkRegistration).toMatchObject({
      branchFeedCount: 8,
      crossMainJunctionCount: 8,
      crossMainGraphEdgeCount: 9,
      exactFittingIdentityVerified: false,
      pipeDirectionVerified: false,
      pipeGradeVerified: false,
    })
    expect(packet.fabricationEvidence).toMatchObject({
      recordCounts: { pipes: 121, lines: 20, outlets: 87, fittings: 50, hangers: 22 },
      nativeAttachmentGraphVerified: true,
      interPieceAdjacencyVerified: false,
      exactFittingTakeoutVerified: false,
      manufacturerPartSolidVerified: false,
      exactBracketGeometryVerified: false,
      exactThreadGeometryVerified: false,
      threadEngagementAndToleranceVerified: false,
      matingFitVerified: false,
    })
    expect(packet.fabricationEvidence.lineGroups['#10']).toMatchObject({ quantity: 7 })
    expect(packet.fabricationEvidence.lineGroups['#06']).toMatchObject({ quantity: 8 })
  })

  it('binds all three views to one graph and actual source images', () => {
    const digest = packet.geometryGraph.digestSha256
    expect(
      Object.values(packet.viewBindings).every((view) => view.geometryGraphSha256 === digest),
    ).toBe(true)
    for (const name of [
      'bgc-plan-source.png',
      'bgc-plan-overlay.png',
      'bgc-section-source.png',
      'bgc-section-overlay.png',
      'bgc-source-registered-3d.png',
      'bgc-source-registered-3d.blend',
      'bgc-source-registered-3d.glb',
      'index.html',
    ]) {
      expect(fs.statSync(proof(name)).size).toBeGreaterThan(1000)
    }
    const html = fs.readFileSync(proof('index.html'), 'utf8')
    expect(html).toContain('This replaces the old synthetic 8 &times; 8 dot diagram')
    expect(html).toContain('direction + grade + installed Z held closed')
    expect(html).toContain('manufacturer part or bracket geometry')
    expect(html).toContain('helical threads')
    expect(html).toContain('thread engagement or tolerances')
  })

  it('rejects every source, FAB, geometry, part-truth, view, and false-promotion mutation internally', async () => {
    const result = await verifyBgcSourcePlanSection3dAdversarialLoop(packet)
    expect(result.status).toBe('passed')
    expect(result.rejectedCases).toHaveLength(result.attemptedCases)
    expect(result).toMatchObject({
      attemptedCases: 27,
      sourcePlanCoordinatesVerified: true,
      sourceBranchFeedTopologyVerified: true,
      sourceCrossMainPlanAxisVerified: true,
      pipeSizeVerified: true,
      exactInstalledPipeElevationVerified: false,
      pipeDirectionVerified: false,
      pipeGradeVerified: false,
      complianceReady: false,
      vpsReleaseReady: false,
    })
  })
})

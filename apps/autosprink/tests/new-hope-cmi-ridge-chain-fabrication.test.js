import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { canonicalizeApprovedFp20Topology } from '../src/engine/approved-fp20-canonical-topology.js'
import { evaluateApprovedFp20GovernedSkeleton } from '../src/engine/approved-fp20-governed-skeleton.js'
import { evaluateNewHopeCmiRidgeChainFabrication } from '../src/engine/new-hope-cmi-ridge-chain-fabrication.js'

const read = (name) =>
  JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'))
const pipeVectors = read('new-hope-approved-fp20-pipe-vectors.json')
const planGraph = read('new-hope-approved-fp20-plan-graph.json')
const operationalAnnotations = read('new-hope-approved-fp20-operational-annotations.json')
const canonicalTopology = canonicalizeApprovedFp20Topology(planGraph)
const governedSkeleton = evaluateApprovedFp20GovernedSkeleton(
  pipeVectors,
  planGraph,
  operationalAnnotations,
)
const inputs = { pipeVectors, canonicalTopology, governedSkeleton, operationalAnnotations }
const binding = (copy, pieceId) =>
  copy.operationalAnnotations.fabricationLineEvidence.ridgeChainPieceBindings.find(
    (entry) => entry.pieceId === pieceId,
  )
const mutate = (fn) => {
  const copy = structuredClone(inputs)
  fn(copy)
  return evaluateNewHopeCmiRidgeChainFabrication(copy)
}
const expectBlocked = (result, code) => {
  expect(result.status).toBe('blocked')
  expect(result.blockerCodes).toContain(code)
  expect(result.properPipeLayoutReady).toBe(false)
  expect(result.fabricationReady).toBe(false)
  expect(result.fieldReleaseReady).toBe(false)
}

describe('New Hope CMI ridge-chain fabrication', () => {
  it('binds eight directed pieces, 21 exact outlets, two no-outlet transitions, and the one-sided inspector-test outlet', () => {
    const result = evaluateNewHopeCmiRidgeChainFabrication(inputs)
    expect(result.status).toBe('passed')
    expect(result.metrics).toEqual({
      boundedPieceCount: 8,
      boundedCanonicalEdgeCount: 28,
      boundedOutletCount: 21,
      sprinklerOutletCount: 20,
      operationalOutletCount: 1,
      noOutletPieceCount: 2,
      chainCount: 2,
    })
    expect(Object.keys(result.pieces)).toEqual([
      'CMI.10', 'CMI.11', 'CMI.12', 'CMI.13',
      'CMI.19', 'CMI.20', 'CMI.21', 'CMI.22',
    ])
    expect(result.pieces['CMI.10']).toMatchObject({
      sourceSegmentId: 'pipe-038',
      pieceStartCanonicalNodeId: 'canonical-node-057',
      pieceFarEndCanonicalNodeId: 'canonical-node-071',
      planLengthIn: 250.003044,
      pieceLengthResidualIn: 1.996956,
    })
    expect(result.pieces['CMI.11'].outlets).toEqual([])
    expect(result.pieces['CMI.20'].outlets).toEqual([])
    expect(result.remoteInspectorTestOutlet).toEqual({
      pieceId: 'CMI.13',
      listedStationIn: 238,
      planStationIn: 237.813009,
      stationResidualIn: 0.186991,
      crossTrackPdfPt: 1.125,
      fitting: '2-1/2 x 1 threaded outlet',
      orientation: 'up-0-degrees',
      referenceVectorDrawingIndex: 6610,
    })
    expect(result.pieces['CMI.13'].outlets).toHaveLength(5)
    expect(result.pieces['CMI.22'].outlets).toHaveLength(4)
    expect(result.ridgeChainAsymmetryReady).toBe(true)
    expect(result.completeFittingScheduleReady).toBe(false)
    expect(result.properPipeLayoutReady).toBe(false)
  })

  it.each([
    ['source hash', 'NH_CMI_RIDGE_FABRICATION_SOURCE_INVALID', (copy) => { copy.operationalAnnotations.fabricationLineEvidence.fieldSet.sha256 = 'drift' }],
    ['piece identity', 'NH_CMI_RIDGE_PIECE_IDENTITY_INVALID', (copy) => { binding(copy, 'CMI.10').nominalDiameterIn = 2 }],
    ['governed role', 'NH_CMI_RIDGE_GOVERNED_ROLE_INVALID', (copy) => { copy.governedSkeleton.primaryAssignments.find((entry) => entry.sourceSegmentId === 'pipe-038').systemRole = 'cross-main' }],
    ['edge topology', 'NH_CMI_RIDGE_PLAN_TOPOLOGY_INVALID', (copy) => { copy.canonicalTopology.edges.find((edge) => edge.id === 'source-edge-069').toNodeId = 'canonical-node-999' }],
    ['piece residual', 'NH_CMI_RIDGE_PIECE_RESIDUAL_EXCEEDED', (copy) => { binding(copy, 'CMI.10').maximumPlanResidualIn = 1 }],
    ['outlet count', 'NH_CMI_RIDGE_OUTLET_COUNT_INVALID', (copy) => { binding(copy, 'CMI.10').outlets.pop() }],
    ['outlet direction', 'NH_CMI_RIDGE_OUTLET_SEQUENCE_INVALID', (copy) => { binding(copy, 'CMI.10').outlets[0].orientation = 'toward-90-degrees' }],
    ['sprinkler identity', 'NH_CMI_RIDGE_SPRINKLER_IDENTITY_INVALID', (copy) => { binding(copy, 'CMI.10').outlets[0].sprinklerId = 'head-999' }],
    ['outlet residual', 'NH_CMI_RIDGE_OUTLET_RESIDUAL_EXCEEDED', (copy) => { binding(copy, 'CMI.10').maximumPlanResidualIn = 0.5 }],
    ['remote vector role', 'NH_CMI13_REMOTE_INSPECTOR_OUTLET_INVALID', (copy) => { copy.operationalAnnotations.operationalReferenceVectors.find((entry) => entry.drawingIndex === 6610).systemRole = 'branch-line' }],
    ['missing remote piece geometry', 'NH_CMI13_REMOTE_INSPECTOR_OUTLET_INVALID', (copy) => { copy.pipeVectors.pipeSegments = copy.pipeVectors.pipeSegments.filter((entry) => entry.id !== 'pipe-052') }],
    ['remote outlet station', 'NH_CMI13_REMOTE_INSPECTOR_OUTLET_INVALID', (copy) => { binding(copy, 'CMI.13').outlets.find((entry) => entry.operationalReferenceId).fromPieceStartIn = 230 }],
    ['mirrored-outlet fabrication mistake', 'NH_CMI_RIDGE_ASYMMETRY_INVALID', (copy) => { binding(copy, 'CMI.22').outlets.push(structuredClone(binding(copy, 'CMI.13').outlets.find((entry) => entry.operationalReferenceId))) }],
  ])('fails closed on %s drift', (_name, code, mutation) => {
    expectBlocked(mutate(mutation), code)
  })
})

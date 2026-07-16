import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { canonicalizeApprovedFp20Topology } from '../src/engine/approved-fp20-canonical-topology.js'
import { evaluateApprovedFp20GovernedSkeleton } from '../src/engine/approved-fp20-governed-skeleton.js'
import { evaluateNewHopeCmi05Cmi08Fabrication } from '../src/engine/new-hope-cmi05-cmi08-fabrication.js'

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
const inputs = {
  pipeVectors,
  canonicalTopology,
  governedSkeleton,
  operationalAnnotations,
}

const mutate = (fn) => {
  const copy = structuredClone(inputs)
  fn(copy)
  return evaluateNewHopeCmi05Cmi08Fabrication(copy)
}
const binding = (copy, pieceId) =>
  copy.operationalAnnotations.fabricationLineEvidence.crossMainPieceBindings.find(
    (entry) => entry.pieceId === pieceId,
  )

describe('New Hope CMI.05 through CMI.08 fabrication group', () => {
  it('binds the three source pieces, five outlets, separated crossing, and exact arm-over terminals', () => {
    const result = evaluateNewHopeCmi05Cmi08Fabrication(inputs)
    expect(result.status).toBe('passed')
    expect(result.metrics).toEqual({
      boundedPieceCount: 3,
      boundedOutletCount: 5,
      noOutletPieceCount: 1,
      separatedCrossingCount: 1,
      exactArmOverTerminalCount: 2,
    })
    expect(result.pieces['CMI.05']).toMatchObject({
      cutLengthIn: 252,
      sourceSegmentId: 'pipe-062',
      planLengthIn: 250.063044,
      pieceLengthResidualIn: 1.936956,
    })
    expect(result.pieces['CMI.05'].stationResidualsIn.map((entry) => entry.residualIn)).toEqual([
      0.92472,
      0.923844,
      0.922968,
    ])
    expect(result.pieces['CMI.07']).toMatchObject({
      cutLengthIn: 120.5,
      sourceSegmentId: 'pipe-063',
      planLengthIn: 116.414748,
      pieceLengthResidualIn: 4.085252,
    })
    expect(result.pieces['CMI.07'].stationResidualsIn.map((entry) => entry.residualIn)).toEqual([
      1.358476,
      2.617744,
    ])
    expect(result.pieces['CMI.08']).toMatchObject({
      cutLengthIn: 97.5,
      sourceSegmentId: 'pipe-030',
      planLengthIn: 95.7945,
      pieceLengthResidualIn: 1.7055,
      outlets: [],
    })
    expect(result.fabricationPieceDirectionSemantics).toBe('listed-piece-start-to-far-end')
    expect(result.drainageDirectionSemantics).toBe('independently-governed-by-drainage-schedules')
    expect(result.cmi05Cmi08BoundedFittingScheduleReady).toBe(true)
    expect(result.completeFittingScheduleReady).toBe(false)
    expect(result.properPipeLayoutReady).toBe(false)
  })

  it.each([
    ['field source', (copy) => { copy.operationalAnnotations.fabricationLineEvidence.fieldSet.sha256 = 'tampered' }, 'NH_CMI0508_FABRICATION_SOURCE_INVALID'],
    ['CMI.05 diameter', (copy) => { binding(copy, 'CMI.05').nominalDiameterIn = 2.5 }, 'NH_CMI0508_PIECE_IDENTITY_INVALID'],
    ['CMI.05 topology', (copy) => { copy.canonicalTopology.edges.find((edge) => edge.id === 'source-edge-126').toNodeId = 'canonical-node-136' }, 'NH_CMI0508_PLAN_TOPOLOGY_INVALID'],
    ['CMI.05 upward outlet', (copy) => { binding(copy, 'CMI.05').outlets[1].orientation = 'toward-90-degrees' }, 'NH_CMI05_OUTLET_SEQUENCE_INVALID'],
    ['CMI.05 station', (copy) => { binding(copy, 'CMI.05').outlets[2].fromPieceStartIn = 194 }, 'NH_CMI05_OUTLET_SEQUENCE_INVALID'],
    ['CMI.05 crossing', (copy) => { copy.operationalAnnotations.fabricationLineEvidence.separatedCrossings[0].branchPieceOutletCount = 1 }, 'NH_CMI05_SEPARATED_CROSSING_INVALID'],
    ['CMI.07 direction', (copy) => { binding(copy, 'CMI.07').outlets[0].orientation = 'away-270-degrees' }, 'NH_CMI07_OUTLET_SEQUENCE_INVALID'],
    ['CMI.07 arm-over', (copy) => { binding(copy, 'CMI.07').outlets[1].downstreamSourceSegmentId = 'pipe-054' }, 'NH_CMI07_OUTLET_SEQUENCE_INVALID'],
    ['CMI.07 station residual', (copy) => { copy.canonicalTopology.edges.find((edge) => edge.id === 'source-edge-128').planLengthFt = 8 }, 'NH_CMI07_PLAN_REGISTRATION_RESIDUAL_EXCEEDED'],
    ['CMI.08 outlet invention', (copy) => { binding(copy, 'CMI.08').outlets.push({ canonicalNodeId: 'canonical-node-054' }) }, 'NH_CMI08_NO_OUTLET_PIECE_INVALID'],
    ['CMI.08 junction', (copy) => { copy.canonicalTopology.nodes.find((node) => node.id === 'canonical-node-053').sourceSegmentIds = ['pipe-030'] }, 'NH_CMI08_JUNCTION_SEQUENCE_INVALID'],
    ['governed diameter', (copy) => { copy.governedSkeleton.primaryAssignments.find((entry) => entry.sourceSegmentId === 'pipe-030').nominalDiameterIn = 2.5 }, 'NH_CMI0508_GOVERNED_ROLE_INVALID'],
  ])('rejects adversarial %s drift', (_name, mutation, blockerCode) => {
    const result = mutate(mutation)
    expect(result.status).toBe('blocked')
    expect(result.blockerCodes).toContain(blockerCode)
    expect(result.cmi05Cmi08BoundedFittingScheduleReady).toBe(false)
    expect(result.properPipeLayoutReady).toBe(false)
  })
})

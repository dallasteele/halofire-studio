import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { canonicalizeApprovedFp20Topology } from '../src/engine/approved-fp20-canonical-topology.js'
import { evaluateApprovedFp20GovernedSkeleton } from '../src/engine/approved-fp20-governed-skeleton.js'
import { evaluateNewHopeCmi06VerticalOutlet } from '../src/engine/new-hope-cmi06-vertical-outlet.js'

const read = (name) =>
  JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'))
const pipeVectors = read('new-hope-approved-fp20-pipe-vectors.json')
const planGraph = read('new-hope-approved-fp20-plan-graph.json')
const operationalAnnotations = read('new-hope-approved-fp20-operational-annotations.json')
const hydraulicRoutes = ['2-1', '2-2', '2-3'].map((id) =>
  read(`new-hope-approved-fp20-hydraulic-route-${id}.json`),
)
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
  hydraulicRoutes,
}

const mutate = (fn) => {
  const copy = structuredClone(inputs)
  fn(copy)
  return evaluateNewHopeCmi06VerticalOutlet(copy)
}

describe('New Hope CMI.06 vertical outlet', () => {
  it('binds all four listed outlets and the exact head-057 vertical leg', () => {
    const result = evaluateNewHopeCmi06VerticalOutlet(inputs)
    expect(result.status).toBe('passed')
    expect(result.piece).toMatchObject({
      pieceId: 'CMI.06',
      nominalDiameterIn: 3,
      cutLengthIn: 252,
      sourceSegmentId: 'pipe-067',
      pieceLengthResidualIn: 1.998288,
    })
    expect(result.piece.stationResidualsIn.map((entry) => entry.residualIn)).toEqual([
      0.985164,
      0.984288,
      0.983412,
      0.982536,
    ])
    expect(result.outlets).toHaveLength(4)
    expect(result.branchOutlet).toMatchObject({
      canonicalNodeId: 'canonical-node-138',
      fromPieceStartIn: 246,
      fitting: '3 x 2-1/2 grooved outlet',
      orientation: 'toward-90-degrees',
      downstreamSourceSegmentId: 'pipe-065',
      farEndContinuationSourceSegmentId: 'pipe-063',
      toPieceFarEndIn: 6,
      planStationIn: 250.001712,
      stationResidualIn: 4.001712,
    })
    expect(result.exactVerticalLeg).toEqual({
      canonicalNodeId: 'canonical-node-142',
      sprinklerId: 'head-057',
      fitting: '3 x 1 threaded outlet',
      orientation: 'up-0-degrees',
      carrierCalculationNodeId: '50',
      sprinklerCalculationNodeId: '718',
      carrierLocalElevationFt: 20.5,
      sprinklerLocalElevationFt: 21.5,
      deltaZFt: 1,
      lengthFt: 1,
      nominalDiameterIn: 1,
      actualDiameterIn: 1.049,
      fittingEquivalentLengthFt: 3.583333,
    })
    expect(result.cmi06PieceFabricationReady).toBe(true)
    expect(result.cmi06OutletScheduleReady).toBe(true)
    expect(result.cmi06BranchOutletReady).toBe(true)
    expect(result.head057VerticalLegReady).toBe(true)
    expect(result.boundedVerticalOffsetScheduleReady).toBe(true)
    expect(result.completeFittingScheduleReady).toBe(false)
    expect(result.properPipeLayoutReady).toBe(false)
  })

  it.each([
    ['field source', (copy) => { copy.operationalAnnotations.fabricationLineEvidence.fieldSet.sha256 = 'tampered' }, 'NH_CMI06_FABRICATION_SOURCE_INVALID'],
    ['piece identity', (copy) => { copy.operationalAnnotations.fabricationLineEvidence.verticalOutletBindings[0].pieceId = 'CMI.07' }, 'NH_CMI06_PIECE_IDENTITY_INVALID'],
    ['plan topology', (copy) => { copy.canonicalTopology.edges.find((edge) => edge.id === 'source-edge-143').toNodeId = 'canonical-node-137' }, 'NH_CMI06_PLAN_TOPOLOGY_INVALID'],
    ['outlet station', (copy) => { copy.operationalAnnotations.fabricationLineEvidence.verticalOutletBindings[0].outlets[3].fromPieceStartIn = 230 }, 'NH_CMI06_OUTLET_SEQUENCE_INVALID'],
    ['outlet orientation', (copy) => { copy.operationalAnnotations.fabricationLineEvidence.verticalOutletBindings[0].outlets[3].orientation = 'down-180-degrees' }, 'NH_CMI06_OUTLET_SEQUENCE_INVALID'],
    ['branch outlet', (copy) => { copy.operationalAnnotations.fabricationLineEvidence.verticalOutletBindings[0].branchOutlet.downstreamSourceSegmentId = 'pipe-063' }, 'NH_CMI06_BRANCH_OUTLET_INVALID'],
    ['plan station residual', (copy) => { copy.canonicalTopology.edges.find((edge) => edge.id === 'source-edge-142').planLengthFt = 8 }, 'NH_CMI06_PLAN_STATION_RESIDUAL_EXCEEDED'],
    ['vertical plan path', (copy) => { copy.hydraulicRoutes[1].planLegBindings.find((leg) => leg.calculationFromNodeId === '718').pathKind = 'source-plan-edge-sequence' }, 'NH_CMI06_VERTICAL_PLAN_BINDING_INVALID'],
    ['vertical length', (copy) => { copy.hydraulicRoutes[1].pipeTableLegs.find((leg) => leg.node1 === '718').lengthFt = 2 }, 'NH_CMI06_VERTICAL_CALCULATION_INVALID'],
    ['carrier elevation', (copy) => { copy.hydraulicRoutes[1].pipeTableLegs.find((leg) => leg.node1 === '718').elevation2Ft = 19.5 }, 'NH_CMI06_VERTICAL_CALCULATION_INVALID'],
    ['sprinkler elevation', (copy) => { copy.hydraulicRoutes[1].pipeTableLegs.find((leg) => leg.node1 === '718').elevation1Ft = 22.5 }, 'NH_CMI06_VERTICAL_CALCULATION_INVALID'],
    ['calculation binding', (copy) => { copy.hydraulicRoutes[1].planNodeBindings.find((binding) => binding.calculationNodeId === '718').canonicalNodeId = 'canonical-node-141' }, 'NH_CMI06_VERTICAL_PLAN_BINDING_INVALID'],
    ['head source identity', (copy) => { copy.pipeVectors.sprinklers.find((head) => head.id === 'head-057').symbolType = 'SD1' }, 'NH_CMI06_SPRINKLER_SOURCE_IDENTITY_INVALID'],
  ])('rejects adversarial %s drift', (_name, mutation, blockerCode) => {
    const result = mutate(mutation)
    expect(result.status).toBe('blocked')
    expect(result.blockerCodes).toContain(blockerCode)
    expect(result.head057VerticalLegReady).toBe(false)
    expect(result.properPipeLayoutReady).toBe(false)
  })
})

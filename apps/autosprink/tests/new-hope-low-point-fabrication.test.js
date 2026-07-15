import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { canonicalizeApprovedFp20Topology } from '../src/engine/approved-fp20-canonical-topology.js'
import { evaluateApprovedFp20GovernedSkeleton } from '../src/engine/approved-fp20-governed-skeleton.js'
import { evaluateNewHopeLowPointFabrication } from '../src/engine/new-hope-low-point-fabrication.js'

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
const inputs = { canonicalTopology, governedSkeleton, operationalAnnotations, hydraulicRoutes }

const mutate = (callback) => {
  const copy = structuredClone(inputs)
  callback(copy)
  return copy
}

describe('New Hope CMI.09 low-point fabrication registration', () => {
  it('binds the actual field piece and emits only the source-proved relative connector grade', () => {
    const result = evaluateNewHopeLowPointFabrication(inputs)
    expect(result.status).toBe('passed')
    expect(result.piece).toEqual({
      lineName: 'CMI',
      pieceId: 'CMI.09',
      nominalDiameterIn: 2.5,
      cutLengthIn: 64.5,
      sourceEdgeIds: ['source-edge-052', 'source-edge-053', 'source-edge-054'],
      stationResidualsIn: { firstOutlet: 1.259932, secondOutlet: 0.824932, farEnd: 1.967244 },
    })
    expect(result.directedEdge).toEqual({
      edgeId: 'source-edge-054',
      sourceSegmentId: 'pipe-032',
      highNodeId: 'canonical-node-059',
      lowNodeId: 'canonical-node-054',
      planLengthFt: 0.478339,
      requiredDropIn: 0.023917,
    })
    expect(result.hydraulicEndpointReport).toEqual({
      highCalculationNodeId: '182',
      lowCalculationNodeId: '67',
      highReportedElevationFt: 18.375,
      lowReportedElevationFt: 18.375,
      exactDifferentialZReady: false,
    })
    expect(result.lowPointRelativeGradeDirectionReady).toBe(true)
    expect(result.exactDifferentialZReady).toBe(false)
    expect(result.exactEndpointZReady).toBe(false)
    expect(result.fabricationReady).toBe(false)
  })

  it.each([
    ['piece identity', (copy) => { copy.operationalAnnotations.fabricationLineEvidence.lowPointPieceBindings[0].pieceId = 'CMI.10' }, 'NH_LOW_POINT_CMI09_PIECE_INVALID'],
    ['listing page', (copy) => { copy.operationalAnnotations.fabricationLineEvidence.lowPointPieceBindings[0].fabricationListingPage = 16 }, 'NH_LOW_POINT_CMI09_PIECE_INVALID'],
    ['first outlet station', (copy) => { copy.operationalAnnotations.fabricationLineEvidence.lowPointPieceBindings[0].firstOutletFromPieceStartIn = 17 }, 'NH_LOW_POINT_FIRST_OUTLET_INVALID'],
    ['first outlet orientation', (copy) => { copy.operationalAnnotations.fabricationLineEvidence.lowPointPieceBindings[0].firstOutletOrientation = 'up-0-degrees' }, 'NH_LOW_POINT_FIRST_OUTLET_INVALID'],
    ['second outlet sprinkler', (copy) => { copy.operationalAnnotations.fabricationLineEvidence.lowPointPieceBindings[0].secondOutletSprinklerId = 'head-999' }, 'NH_LOW_POINT_SECOND_OUTLET_INVALID'],
    ['low-point end', (copy) => { copy.operationalAnnotations.fabricationLineEvidence.lowPointPieceBindings[0].lowCanonicalNodeId = 'canonical-node-059' }, 'NH_LOW_POINT_DIRECTION_BINDING_INVALID'],
    ['plan topology', (copy) => { copy.canonicalTopology.edges.find((edge) => edge.id === 'source-edge-054').toNodeId = 'canonical-node-055' }, 'NH_LOW_POINT_PLAN_TOPOLOGY_INVALID'],
    ['grade magnitude', (copy) => { copy.operationalAnnotations.gradeRequirements.find((entry) => entry.id === 'grade-branch-lines').riseInPer10Ft = 0.25 }, 'NH_LOW_POINT_GRADE_MAGNITUDE_INVALID'],
    ['hydraulic node binding', (copy) => { copy.hydraulicRoutes[1].planNodeBindings.find((entry) => entry.calculationNodeId === '182').canonicalNodeId = 'canonical-node-058' }, 'NH_LOW_POINT_HYDRAULIC_PLAN_BINDING_INVALID'],
    ['hydraulic endpoint', (copy) => { const leg = copy.hydraulicRoutes[1].pipeTableLegs.find((entry) => [entry.node1, entry.node2].includes('182') && [entry.node1, entry.node2].includes('67')); leg.elevation1Ft = 99 }, 'NH_LOW_POINT_HYDRAULIC_ENDPOINT_INVALID'],
    ['false exact Z', (copy) => { copy.operationalAnnotations.fabricationLineEvidence.lowPointPieceBindings[0].exactDifferentialZStatus = 'resolved' }, 'NH_LOW_POINT_FALSE_EXACT_Z_PROMOTION'],
  ])('fails closed on adversarial %s drift', (_name, callback, expectedCode) => {
    const result = evaluateNewHopeLowPointFabrication(mutate(callback))
    expect(result.status).toBe('blocked')
    expect(result.blockerCodes).toContain(expectedCode)
    expect(result.lowPointRelativeGradeDirectionReady).toBe(false)
    expect(result.exactDifferentialZReady).toBe(false)
    expect(result.fabricationReady).toBe(false)
  })

  it('does not erase the source-proved grade when both calculation endpoints round equal', () => {
    const result = evaluateNewHopeLowPointFabrication(inputs)
    expect(result.hydraulicEndpointReport.highReportedElevationFt).toBe(
      result.hydraulicEndpointReport.lowReportedElevationFt,
    )
    expect(result.lowPointRelativeGradeDirectionReady).toBe(true)
    expect(result.directedEdge.requiredDropIn).toBeGreaterThan(0)
    expect(result.exactDifferentialZReady).toBe(false)
  })
})

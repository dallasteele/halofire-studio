import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { canonicalizeApprovedFp20Topology } from '../src/engine/approved-fp20-canonical-topology.js'
import { evaluateApprovedFp20GovernedSkeleton } from '../src/engine/approved-fp20-governed-skeleton.js'
import { evaluateNewHopeSourceFeedFabrication } from '../src/engine/new-hope-source-feed-fabrication.js'

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
  canonicalTopology,
  governedSkeleton,
  operationalAnnotations,
  hydraulicRoutes,
}

describe('New Hope CML.01 source-feed fabrication registration', () => {
  it('binds the exact fabricated plan piece, 4 x 3 outlet, and node-118 Z port', () => {
    const result = evaluateNewHopeSourceFeedFabrication(inputs)
    expect(result.status).toBe('passed')
    expect(result.piece).toEqual({
      lineName: 'CML',
      pieceId: 'CML.01',
      nominalDiameterIn: 4,
      cutLengthIn: 35.5,
      sourceEdgeIds: ['source-edge-001', 'source-edge-002'],
    })
    expect(result.outlet).toEqual({
      canonicalNodeId: 'canonical-node-002',
      calculationNodeId: '118',
      localElevationFt: 11.5,
      fitting: '4 x 3 grooved outlet',
      orientation: 'up-0-degrees',
      downstreamNominalDiameterIn: 3,
    })
    expect(result.sourceFeedPlanFabricationReady).toBe(true)
    expect(result.sourceFeedOutletTransitionReady).toBe(true)
    expect(result.sourceFeedOutletElevationReady).toBe(true)
    expect(result.directedEdges).toEqual([
      {
        edgeId: 'source-edge-001',
        highNodeId: 'canonical-node-002',
        lowNodeId: 'canonical-node-001',
        requiredDropIn: 0.061458,
        basis: 'approved-cross-main-grade-to-riser-room-low-end',
      },
      {
        edgeId: 'source-edge-002',
        highNodeId: 'canonical-node-003',
        lowNodeId: 'canonical-node-002',
        requiredDropIn: 0.0125,
        basis: 'approved-cross-main-grade-to-riser-room-low-end',
      },
    ])
    expect(result.designedNodeElevations).toEqual([
      { canonicalNodeId: 'canonical-node-001', role: 'riser-room-low-end', localElevationFt: 11.494878 },
      { canonicalNodeId: 'canonical-node-002', role: 'node-118-outlet', localElevationFt: 11.5 },
      { canonicalNodeId: 'canonical-node-003', role: 'cml01-far-high-end', localElevationFt: 11.501042 },
    ])
    expect(result.designedEndpointElevationsReady).toBe(true)
    expect(result.designedGradeDirectionReady).toBe(true)
    expect(result.designedGradeMagnitudeReady).toBe(true)
    expect(result.cml01Plan3dPathReady).toBe(true)
    expect(result.installedGradeReady).toBe(false)
    expect(result.concealedRiserContinuationReady).toBe(false)
    expect(result.sourceFeed3dPathReady).toBe(false)
  })

  it.each([
    ['piece length', (copy) => { copy.operationalAnnotations.fabricationLineEvidence.primaryLineBindings.find((entry) => entry.lineName === 'CML').cutLengthIn = 36 }, 'NH_SOURCE_FEED_GOVERNED_BINDING_BLOCKED'],
    ['outlet node', (copy) => { copy.operationalAnnotations.fabricationLineEvidence.primaryLineBindings.find((entry) => entry.lineName === 'CML').outletCanonicalNodeId = 'canonical-node-003' }, 'NH_SOURCE_FEED_GOVERNED_BINDING_BLOCKED'],
    ['plan split', (copy) => { copy.canonicalTopology.edges.find((entry) => entry.id === 'source-edge-002').fromNodeId = 'canonical-node-003' }, 'NH_SOURCE_FEED_PLAN_SPLIT_INVALID'],
    ['node-118 elevation', (copy) => {
      const leg = copy.hydraulicRoutes[0].pipeTableLegs.find((entry) => entry.node1 === '118' || entry.node2 === '118')
      leg[leg.node1 === '118' ? 'elevation1Ft' : 'elevation2Ft'] = 99
    }, 'NH_SOURCE_FEED_OUTLET_Z_PORT_INVALID'],
    ['grade magnitude', (copy) => { copy.operationalAnnotations.gradeRequirements.find((entry) => entry.id === 'grade-cross-mains').riseInPer10Ft = 0.5 }, 'NH_SOURCE_FEED_DESIGN_GRADE_SOURCE_INVALID'],
    ['riser low end', (copy) => { copy.operationalAnnotations.supplyAnchor.boundPrimaryNodeId = 'pipe-001-node-02' }, 'NH_SOURCE_FEED_DESIGN_GRADE_SOURCE_INVALID'],
    ['false installed grade', (copy) => { copy.operationalAnnotations.fabricationLineEvidence.primaryLineBindings.find((entry) => entry.lineName === 'CML').installedGradeStatus = 'resolved' }, 'NH_SOURCE_FEED_GOVERNED_BINDING_BLOCKED'],
  ])('fails closed on %s drift', (_name, mutate, expectedCode) => {
    const copy = structuredClone(inputs)
    mutate(copy)
    copy.governedSkeleton = evaluateApprovedFp20GovernedSkeleton(
      pipeVectors,
      planGraph,
      copy.operationalAnnotations,
    )
    const result = evaluateNewHopeSourceFeedFabrication(copy)
    expect(result.status).toBe('blocked')
    expect(result.blockerCodes).toContain(expectedCode)
    expect(result.sourceFeed3dPathReady).toBe(false)
  })
})

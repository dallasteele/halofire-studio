import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { evaluateApprovedFp20ArchitecturalVerticalControls } from '../src/engine/approved-fp20-architectural-vertical-controls.js'
import { canonicalizeApprovedFp20Topology } from '../src/engine/approved-fp20-canonical-topology.js'
import { evaluateApprovedFp20GovernedSkeleton } from '../src/engine/approved-fp20-governed-skeleton.js'
import { bindApprovedFp20HydraulicRouteSet } from '../src/engine/approved-fp20-hydraulic-route-binding.js'
import { evaluateNewHopeArmOverDrainage } from '../src/engine/new-hope-arm-over-drainage.js'
import { evaluateNewHopeCentralBranchDrainage } from '../src/engine/new-hope-central-branch-drainage.js'
import { evaluateNewHopeCrossMainDrainage } from '../src/engine/new-hope-cross-main-drainage.js'
import { evaluateNewHopeElevationDatum } from '../src/engine/new-hope-elevation-datum.js'
import { evaluateNewHopeLongBranchDrainage } from '../src/engine/new-hope-long-branch-drainage.js'
import { evaluateNewHopeProperPipeLayout } from '../src/engine/new-hope-proper-pipe-layout.js'
import { evaluateNewHopeSideBranchDrainage } from '../src/engine/new-hope-side-branch-drainage.js'
import { evaluateNewHopeSourceFeedFabrication } from '../src/engine/new-hope-source-feed-fabrication.js'

const read = (name) =>
  JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'))
const pipeVectors = read('new-hope-approved-fp20-pipe-vectors.json')
const planGraph = read('new-hope-approved-fp20-plan-graph.json')
const operationalAnnotations = read('new-hope-approved-fp20-operational-annotations.json')
const hydraulicRoutes = ['2-1', '2-2', '2-3'].map((id) =>
  read(`new-hope-approved-fp20-hydraulic-route-${id}.json`),
)
const architecturalSource = read('new-hope-pitched-holdout-source.json')
const elevationDatumSource = read('new-hope-approved-elevation-datum.json')
const canonicalTopology = canonicalizeApprovedFp20Topology(planGraph)
const governedSkeleton = evaluateApprovedFp20GovernedSkeleton(
  pipeVectors,
  planGraph,
  operationalAnnotations,
)
const hydraulicRouteSet = bindApprovedFp20HydraulicRouteSet(canonicalTopology, hydraulicRoutes)
const architecturalVerticalControls =
  evaluateApprovedFp20ArchitecturalVerticalControls(architecturalSource)
const elevationDatum = evaluateNewHopeElevationDatum(elevationDatumSource, hydraulicRoutes)
const sourceFeedFabrication = evaluateNewHopeSourceFeedFabrication({
  canonicalTopology,
  governedSkeleton,
  operationalAnnotations,
  hydraulicRoutes,
})
const longBranchDrainage = evaluateNewHopeLongBranchDrainage({
  pipeVectors,
  canonicalTopology,
  governedSkeleton,
  operationalAnnotations,
})
const sideBranchDrainage = evaluateNewHopeSideBranchDrainage({
  pipeVectors,
  canonicalTopology,
  governedSkeleton,
  operationalAnnotations,
})
const crossMainDrainage = evaluateNewHopeCrossMainDrainage({
  pipeVectors,
  canonicalTopology,
  governedSkeleton,
  operationalAnnotations,
  hydraulicRoutes,
  sideBranchDrainage,
})
const centralBranchDrainage = evaluateNewHopeCentralBranchDrainage({
  pipeVectors,
  canonicalTopology,
  governedSkeleton,
  operationalAnnotations,
})
const armOverDrainage = evaluateNewHopeArmOverDrainage({
  pipeVectors,
  canonicalTopology,
  governedSkeleton,
  operationalAnnotations,
  longBranchDrainage,
  sideBranchDrainage,
  crossMainDrainage,
  centralBranchDrainage,
})
const inputs = {
  pipeVectors,
  canonicalTopology,
  governedSkeleton,
  hydraulicRoutes,
  hydraulicRouteSet,
  architecturalVerticalControls,
  elevationDatum,
  sourceFeedFabrication,
  operationalAnnotations,
  longBranchDrainage,
  sideBranchDrainage,
  crossMainDrainage,
  centralBranchDrainage,
  armOverDrainage,
}

describe('New Hope proper pitched-roof pipe-layout acceptance', () => {
  it('assembles the whole direction schedule without pretending partial Z is fabrication-ready', () => {
    const result = evaluateNewHopeProperPipeLayout(inputs)
    expect(result.status).toBe('passed')
    expect(result.metrics).toEqual({
      canonicalNodeCount: 142,
      canonicalEdgeCount: 143,
      directedEdgeCount: 140,
      undirectedEdgeCount: 3,
      directionCoverageRatio: 0.979021,
      scheduleCounts: {
        'long-branch': 43,
        'side-branch': 28,
        'cross-main': 34,
        'central-branch': 23,
        'arm-over': 12,
      },
      exactElevationPortCount: 32,
      exactElevationCanonicalNodeCount: 31,
      exactElevationNodeCoverageRatio: 0.21831,
      sameXyVerticalLegCount: 1,
      fieldDrainIntentCount: 2,
    })
    expect(result.undirectedEdges.map((edge) => [edge.edgeId, edge.classification])).toEqual([
      ['source-edge-001', 'source-feed-fabricated-plan-edge-endpoint-z-and-grade-unresolved'],
      ['source-edge-002', 'source-feed-fabricated-plan-edge-endpoint-z-and-grade-unresolved'],
      ['source-edge-054', 'low-point-zone-grade-unresolved'],
    ])
    expect(result.wholeFp20RelativeGradeDirectionReady).toBe(true)
    expect(result.partialExactPipeElevationAnchorReady).toBe(true)
    expect(result.exactPipeCenterlineZReady).toBe(false)
    expect(result.calculationToArchitecturalDatumRegistrationReady).toBe(true)
    expect(result.sourceFeedPlanFabricationReady).toBe(true)
    expect(result.sourceFeedOutletTransitionReady).toBe(true)
    expect(result.sourceFeedOutletElevationReady).toBe(true)
    expect(result.sourceFeedEndpointElevationsReady).toBe(false)
    expect(result.sourceFeedInstalledGradeReady).toBe(false)
    expect(result.sourceFeedConcealedRiserContinuationReady).toBe(false)
    expect(result.properPipeLayoutReady).toBe(false)
    expect(result.fabricationReady).toBe(false)
  })

  it('preserves the source-proved one-foot same-XY vertical leg as two Z ports', () => {
    const result = evaluateNewHopeProperPipeLayout(inputs)
    expect(result.multiElevationNodes).toEqual([
      {
        canonicalNodeId: 'canonical-node-142',
        ports: [
          { calculationNodeId: '50', elevationFt: 20.5 },
          { calculationNodeId: '718', elevationFt: 21.5 },
        ],
      },
    ])
    expect(result.sameXyVerticalLegReady).toBe(true)
    expect(result.architecturalRegistration).toMatchObject({
      calculationAnchorRangeFt: { min: 11.5, max: 21.5 },
      architecturalProjectAnchorRangeFt: { min: 111.5, max: 121.5 },
      globalRoofComparisonAllowed: false,
      calculationToArchitecturalDatumRegistrationReady: true,
    })
  })

  it('names the engineering blockers instead of accepting a visually plausible overlay', () => {
    const result = evaluateNewHopeProperPipeLayout(inputs)
    expect(result.acceptanceBlockerCodes).toEqual([
      'NH_PROPER_PIPE_LOW_POINT_ZONE_GRADE_UNRESOLVED',
      'NH_PROPER_PIPE_SUPPLY_3D_PATH_UNRESOLVED',
      'NH_PROPER_PIPE_EXACT_Z_INCOMPLETE',
      'NH_PROPER_PIPE_FIELD_DRAIN_ROUTES_UNRESOLVED',
      'NH_PROPER_PIPE_FITTING_SCHEDULE_INCOMPLETE',
    ])
    expect(result.fieldDrainRoutes).toEqual([
      {
        id: 'field-route-drum-drip-lower',
        routeStatus: 'field-resolution-required',
        nominalDiameterIn: 1,
      },
      {
        id: 'field-route-drum-drip-upper',
        routeStatus: 'field-resolution-required',
        nominalDiameterIn: 1,
      },
    ])
    expect(result.fieldDrainRoutesReady).toBe(false)
    expect(result.drumDripDetailReady).toBe(true)
  })

  it('fails evidence validation on a repeated calculation-node elevation conflict', () => {
    const copy = structuredClone(inputs)
    const repeated = copy.hydraulicRoutes[1].pipeTableLegs.filter(
      (leg) => leg.node1 === '67' || leg.node2 === '67',
    )
    repeated[0][repeated[0].node1 === '67' ? 'elevation1Ft' : 'elevation2Ft'] = 99
    const result = evaluateNewHopeProperPipeLayout(copy)
    expect(result.status).toBe('blocked')
    expect(result.blockerCodes).toContain('NH_PROPER_PIPE_CALCULATION_ELEVATION_CONFLICT')
    expect(result.properPipeLayoutReady).toBe(false)
  })

  it('fails closed when an upstream schedule is absent or a directed edge conflicts', () => {
    const absent = evaluateNewHopeProperPipeLayout({ ...inputs, armOverDrainage: null })
    expect(absent.status).toBe('blocked')
    expect(absent.blockerCodes).toContain('NH_PROPER_PIPE_UPSTREAM_EVIDENCE_BLOCKED')
    expect(absent.blockerCodes).toContain('NH_PROPER_PIPE_DIRECTION_COVERAGE_DRIFT')

    const conflicting = structuredClone(inputs)
    conflicting.armOverDrainage.directedEdges[0].edgeId =
      conflicting.crossMainDrainage.directedEdges[0].edgeId
    const result = evaluateNewHopeProperPipeLayout(conflicting)
    expect(result.status).toBe('blocked')
    expect(result.blockerCodes).toContain('NH_PROPER_PIPE_DIRECTION_CONFLICT')
  })
})

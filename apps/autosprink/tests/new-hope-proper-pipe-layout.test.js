import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { evaluateApprovedFp20ArchitecturalVerticalControls } from '../src/engine/approved-fp20-architectural-vertical-controls.js'
import { canonicalizeApprovedFp20Topology } from '../src/engine/approved-fp20-canonical-topology.js'
import { evaluateApprovedFp20GovernedSkeleton } from '../src/engine/approved-fp20-governed-skeleton.js'
import { bindApprovedFp20HydraulicRouteSet } from '../src/engine/approved-fp20-hydraulic-route-binding.js'
import { evaluateNewHopeArmOverDrainage } from '../src/engine/new-hope-arm-over-drainage.js'
import { evaluateNewHopeCentralBranchDrainage } from '../src/engine/new-hope-central-branch-drainage.js'
import { evaluateNewHopeCmi05Cmi08Fabrication } from '../src/engine/new-hope-cmi05-cmi08-fabrication.js'
import { evaluateNewHopeCmi06VerticalOutlet } from '../src/engine/new-hope-cmi06-vertical-outlet.js'
import { evaluateNewHopeCmiRidgeChainFabrication } from '../src/engine/new-hope-cmi-ridge-chain-fabrication.js'
import { evaluateNewHopeCrossMainDrainage } from '../src/engine/new-hope-cross-main-drainage.js'
import { evaluateNewHopeElevationDatum } from '../src/engine/new-hope-elevation-datum.js'
import { evaluateNewHopeFabricationEndSchedule } from '../src/engine/new-hope-fabrication-end-schedule.js'
import { evaluateNewHopeLongBranchDrainage } from '../src/engine/new-hope-long-branch-drainage.js'
import { evaluateNewHopeLowPointFabrication } from '../src/engine/new-hope-low-point-fabrication.js'
import { evaluateNewHopeProperPipeLayout } from '../src/engine/new-hope-proper-pipe-layout.js'
import { evaluateNewHopeRemainingCmiFabrication } from '../src/engine/new-hope-remaining-cmi-fabrication.js'
import { evaluateNewHopeSideBranchDrainage } from '../src/engine/new-hope-side-branch-drainage.js'
import { evaluateNewHopeSourceFeedCalculationChain } from '../src/engine/new-hope-source-feed-calculation-chain.js'
import { evaluateNewHopeSourceFeedAsbuiltRiser } from '../src/engine/new-hope-source-feed-asbuilt-riser.js'
import { evaluateNewHopeSourceFeedFabrication } from '../src/engine/new-hope-source-feed-fabrication.js'

const read = (name) =>
  JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'))
const pipeVectors = read('new-hope-approved-fp20-pipe-vectors.json')
const planGraph = read('new-hope-approved-fp20-plan-graph.json')
const operationalAnnotations = read('new-hope-approved-fp20-operational-annotations.json')
const sourceFeedAsbuiltRiserRegistration = read('new-hope-asbuilt-source-feed-riser-registration.json')
const fabricationEndScheduleSource = read('new-hope-fabrication-end-schedule.json')
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
const sourceFeedCalculationChain = evaluateNewHopeSourceFeedCalculationChain({
  hydraulicRoutes,
  sourceFeedFabrication,
})
const sourceFeedAsbuiltRiser = evaluateNewHopeSourceFeedAsbuiltRiser({
  registration: sourceFeedAsbuiltRiserRegistration,
  pipeVectors,
  planGraph,
  canonicalTopology,
  sourceFeedFabrication,
  sourceFeedCalculationChain,
})
const fabricationEndSchedule = evaluateNewHopeFabricationEndSchedule(fabricationEndScheduleSource)
const lowPointFabrication = evaluateNewHopeLowPointFabrication({
  canonicalTopology,
  governedSkeleton,
  operationalAnnotations,
  hydraulicRoutes,
})
const cmi05Cmi08Fabrication = evaluateNewHopeCmi05Cmi08Fabrication({
  pipeVectors,
  canonicalTopology,
  governedSkeleton,
  operationalAnnotations,
})
const cmi06VerticalOutlet = evaluateNewHopeCmi06VerticalOutlet({
  pipeVectors,
  canonicalTopology,
  governedSkeleton,
  operationalAnnotations,
  hydraulicRoutes,
})
const cmiRidgeChainFabrication = evaluateNewHopeCmiRidgeChainFabrication({
  pipeVectors,
  canonicalTopology,
  governedSkeleton,
  operationalAnnotations,
})
const remainingCmiFabrication = evaluateNewHopeRemainingCmiFabrication({
  pipeVectors,
  canonicalTopology,
  governedSkeleton,
  operationalAnnotations,
  sourceFeedFabrication,
  sourceFeedCalculationChain,
  sourceFeedAsbuiltRiser,
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
  sourceFeedCalculationChain,
  sourceFeedAsbuiltRiser,
  fabricationEndSchedule,
  lowPointFabrication,
  cmi05Cmi08Fabrication,
  cmi06VerticalOutlet,
  cmiRidgeChainFabrication,
  remainingCmiFabrication,
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
      directedEdgeCount: 143,
      undirectedEdgeCount: 0,
      directionCoverageRatio: 1,
      scheduleCounts: {
        'source-feed': 2,
        'long-branch': 43,
        'side-branch': 28,
        'cross-main': 34,
        'central-branch': 23,
        'arm-over': 12,
        'low-point-connector': 1,
      },
      exactElevationPortCount: 32,
      exactElevationCanonicalNodeCount: 31,
      exactElevationNodeCoverageRatio: 0.21831,
      sameXyVerticalLegCount: 1,
      sourceBoundFabricationOutletCount: 45,
      exactVerticalLegCount: 1,
      sourceFeedCalculationPortCount: 4,
      sourceFeedExternalCalculationPortCount: 3,
      sourceFeedOrthogonalCalculationResidualIn: 0.086322,
      listedPipePieceDefinitionCount: 257,
      listedFabricatedPipeUnitCount: 264,
      fieldDrainIntentCount: 2,
    })
    expect(result.undirectedEdges).toEqual([])
    expect(result.wholeFp20RelativeGradeDirectionReady).toBe(true)
    expect(result.partialExactPipeElevationAnchorReady).toBe(true)
    expect(result.exactPipeCenterlineZReady).toBe(false)
    expect(result.calculationToArchitecturalDatumRegistrationReady).toBe(true)
    expect(result.sourceFeedPlanFabricationReady).toBe(true)
    expect(result.sourceFeedOutletTransitionReady).toBe(true)
    expect(result.sourceFeedOutletElevationReady).toBe(true)
    expect(result.sourceFeedCalculationChainReady).toBe(true)
    expect(result.sourceFeedBaseOfRiserEndpointZReady).toBe(true)
    expect(result.sourceFeedDryPipeValveIdentityReady).toBe(true)
    expect(result.sourceFeedDownstreamValveBackflowElevationChainReady).toBe(true)
    expect(result.sourceFeedAsBuiltRiserIdentityReady).toBe(true)
    expect(result.sourceFeedSharedTransferAxisReady).toBe(true)
    expect(result.sourceFeedOrthogonalCalculationDecompositionReady).toBe(true)
    expect(result.sourceFeedConcealedRiserContinuationIdentityReady).toBe(true)
    expect(result.sourceFeedCalculationLegEndpointElevationsReady).toBe(true)
    expect(result.allListedPieceIdentitiesReady).toBe(true)
    expect(result.allListedPieceEndPreparationsReady).toBe(true)
    expect(result.allListedEndFittingFamiliesReady).toBe(true)
    expect(result.exactThreadedFittingSizesReady).toBe(true)
    expect(result.interPieceFittingTopologyReady).toBe(false)
    expect(result.completeVerticalOffsetScheduleReady).toBe(false)
    expect(result.sourceFeedEndpointElevationsReady).toBe(true)
    expect(result.sourceFeedDesignedGradeDirectionReady).toBe(true)
    expect(result.sourceFeedDesignedGradeMagnitudeReady).toBe(true)
    expect(result.sourceFeedCml01Plan3dPathReady).toBe(true)
    expect(result.sourceFeedConcealedPlanXyReady).toBe(false)
    expect(result.sourceFeedFabricationPieceToCalculationLegDecompositionReady).toBe(false)
    expect(result.sourceFeedInstalledGradeReady).toBe(false)
    expect(result.sourceFeedConcealedRiserContinuationReady).toBe(false)
    expect(result.lowPointZoneGradeReady).toBe(true)
    expect(result.lowPointExactDifferentialZReady).toBe(false)
    expect(result.cmi05PieceFabricationReady).toBe(true)
    expect(result.cmi05OutletScheduleReady).toBe(true)
    expect(result.cmi05SeparatedCrossingReady).toBe(true)
    expect(result.cmi07PieceFabricationReady).toBe(true)
    expect(result.cmi07OutletScheduleReady).toBe(true)
    expect(result.cmi07ArmOverTerminalBindingReady).toBe(true)
    expect(result.cmi08PieceFabricationReady).toBe(true)
    expect(result.cmi08NoOutletScheduleReady).toBe(true)
    expect(result.cmi07Cmi08JunctionReady).toBe(true)
    expect(result.cmi05Cmi08BoundedFittingScheduleReady).toBe(true)
    expect(result.cmi06PieceFabricationReady).toBe(true)
    expect(result.cmi06OutletScheduleReady).toBe(true)
    expect(result.cmi06BranchOutletReady).toBe(true)
    expect(result.head057OutletFittingReady).toBe(true)
    expect(result.head057VerticalLegReady).toBe(true)
    expect(result.head057ExactCarrierZReady).toBe(true)
    expect(result.head057ExactSprinklerZReady).toBe(true)
    expect(result.boundedVerticalOffsetScheduleReady).toBe(true)
    expect(result.cmiRidgeEightPieceFabricationReady).toBe(true)
    expect(result.cmiRidgeTwentyOneOutletScheduleReady).toBe(true)
    expect(result.cmiRidgeTwentySprinklerOutletIdentityReady).toBe(true)
    expect(result.cmi13RemoteInspectorTestOutletReady).toBe(true)
    expect(result.cmi13Cmi22AsymmetryReady).toBe(true)
    expect(result.cmiRidgeChainJunctionsReady).toBe(true)
    expect(result.cmiRidgeBoundedFittingScheduleReady).toBe(true)
    expect(result.remainingCmiNinePieceFabricationReady).toBe(true)
    expect(result.remainingCmiElevenOutletScheduleReady).toBe(true)
    expect(result.remainingCmiSixDirectSprinklerOutletIdentityReady).toBe(true)
    expect(result.remainingCmiFiveBranchOrArmOverOutletScheduleReady).toBe(true)
    expect(result.remainingCmiFourNoOutletPieceScheduleReady).toBe(true)
    expect(result.cmi01SourceOutletZReady).toBe(true)
    expect(result.remainingCmiBoundedFittingScheduleReady).toBe(true)
    expect(result.remainingCmiFabrication.sourceOutletRegistration).toMatchObject({
      upstreamPieceId: 'CML.01',
      downstreamPieceId: 'CMI.01',
      canonicalNodeId: 'canonical-node-002',
      calculationNodeId: '118',
      localElevationFt: 11.5,
      farEndZReady: false,
      installedGradeReady: false,
    })
    expect(result.cmiRidgeChainFabrication.remoteInspectorTestOutlet).toMatchObject({
      pieceId: 'CMI.13',
      listedStationIn: 238,
      planStationIn: 237.813009,
    })
    expect(result.cmi06VerticalOutlet.exactVerticalLeg).toMatchObject({
      canonicalNodeId: 'canonical-node-142',
      sprinklerId: 'head-057',
      fitting: '3 x 1 threaded outlet',
      carrierLocalElevationFt: 20.5,
      sprinklerLocalElevationFt: 21.5,
      deltaZFt: 1,
    })
    expect(result.lowPointFabrication.directedEdge).toMatchObject({
      edgeId: 'source-edge-054',
      highNodeId: 'canonical-node-059',
      lowNodeId: 'canonical-node-054',
      requiredDropIn: 0.023917,
    })
    expect(result.properPipeLayoutReady).toBe(false)
    expect(result.fabricationReady).toBe(false)
    expect(result.sourceFeedCalculationChain.sourceOutletToBaseOfRiserDeltaZFt).toBe(6.041667)
    expect(result.sourceFeedAsbuiltRiser.decomposition.calculationLengthResidualIn).toBe(0.086322)
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
    expect(result.head057VerticalLegReady).toBe(true)
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
    const absentCmi0508 = evaluateNewHopeProperPipeLayout({
      ...inputs,
      cmi05Cmi08Fabrication: null,
    })
    expect(absentCmi0508.status).toBe('blocked')
    expect(absentCmi0508.blockerCodes).toContain('NH_PROPER_PIPE_UPSTREAM_EVIDENCE_BLOCKED')
    expect(absentCmi0508.cmi05Cmi08BoundedFittingScheduleReady).toBe(false)

    const absentVerticalOutlet = evaluateNewHopeProperPipeLayout({
      ...inputs,
      cmi06VerticalOutlet: null,
    })
    expect(absentVerticalOutlet.status).toBe('blocked')
    expect(absentVerticalOutlet.blockerCodes).toContain(
      'NH_PROPER_PIPE_UPSTREAM_EVIDENCE_BLOCKED',
    )
    expect(absentVerticalOutlet.head057VerticalLegReady).toBe(false)

    const absentRidgeChain = evaluateNewHopeProperPipeLayout({
      ...inputs,
      cmiRidgeChainFabrication: null,
    })
    expect(absentRidgeChain.status).toBe('blocked')
    expect(absentRidgeChain.blockerCodes).toContain(
      'NH_PROPER_PIPE_UPSTREAM_EVIDENCE_BLOCKED',
    )
    expect(absentRidgeChain.cmiRidgeBoundedFittingScheduleReady).toBe(false)

    const absentRemainingCmi = evaluateNewHopeProperPipeLayout({
      ...inputs,
      remainingCmiFabrication: null,
    })
    expect(absentRemainingCmi.status).toBe('blocked')
    expect(absentRemainingCmi.blockerCodes).toContain(
      'NH_PROPER_PIPE_UPSTREAM_EVIDENCE_BLOCKED',
    )
    expect(absentRemainingCmi.remainingCmiBoundedFittingScheduleReady).toBe(false)

    const absentLowPoint = evaluateNewHopeProperPipeLayout({ ...inputs, lowPointFabrication: null })
    expect(absentLowPoint.status).toBe('blocked')
    expect(absentLowPoint.blockerCodes).toContain('NH_PROPER_PIPE_UPSTREAM_EVIDENCE_BLOCKED')
    expect(absentLowPoint.blockerCodes).toContain('NH_PROPER_PIPE_DIRECTION_COVERAGE_DRIFT')

    const absentSourceChain = evaluateNewHopeProperPipeLayout({
      ...inputs,
      sourceFeedCalculationChain: null,
    })
    expect(absentSourceChain.status).toBe('blocked')
    expect(absentSourceChain.blockerCodes).toContain('NH_PROPER_PIPE_UPSTREAM_EVIDENCE_BLOCKED')
    expect(absentSourceChain.sourceFeedBaseOfRiserEndpointZReady).toBe(false)

    const absentAsbuiltRiser = evaluateNewHopeProperPipeLayout({
      ...inputs,
      sourceFeedAsbuiltRiser: null,
    })
    expect(absentAsbuiltRiser.status).toBe('blocked')
    expect(absentAsbuiltRiser.blockerCodes).toContain('NH_PROPER_PIPE_UPSTREAM_EVIDENCE_BLOCKED')
    expect(absentAsbuiltRiser.sourceFeedOrthogonalCalculationDecompositionReady).toBe(false)

    const absentFabricationEndSchedule = evaluateNewHopeProperPipeLayout({
      ...inputs,
      fabricationEndSchedule: null,
    })
    expect(absentFabricationEndSchedule.status).toBe('blocked')
    expect(absentFabricationEndSchedule.blockerCodes).toContain('NH_PROPER_PIPE_UPSTREAM_EVIDENCE_BLOCKED')
    expect(absentFabricationEndSchedule.allListedPieceEndPreparationsReady).toBe(false)

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

import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { canonicalizeApprovedFp20Topology } from '../src/engine/approved-fp20-canonical-topology.js'
import { evaluateApprovedFp20GovernedSkeleton } from '../src/engine/approved-fp20-governed-skeleton.js'
import { evaluateNewHopeArmOverDrainage } from '../src/engine/new-hope-arm-over-drainage.js'
import { evaluateNewHopeCentralBranchDrainage } from '../src/engine/new-hope-central-branch-drainage.js'
import { evaluateNewHopeCmi05Cmi08Fabrication } from '../src/engine/new-hope-cmi05-cmi08-fabrication.js'
import { evaluateNewHopeCmi06VerticalOutlet } from '../src/engine/new-hope-cmi06-vertical-outlet.js'
import { evaluateNewHopeCrossMainDrainage } from '../src/engine/new-hope-cross-main-drainage.js'
import { evaluateNewHopeLongBranchDrainage } from '../src/engine/new-hope-long-branch-drainage.js'
import { evaluateNewHopeRemainingCmiFabrication } from '../src/engine/new-hope-remaining-cmi-fabrication.js'
import { evaluateNewHopeSideBranchDrainage } from '../src/engine/new-hope-side-branch-drainage.js'
import { evaluateNewHopeSourceFeedAsbuiltRiser } from '../src/engine/new-hope-source-feed-asbuilt-riser.js'
import { evaluateNewHopeSourceFeedCalculationChain } from '../src/engine/new-hope-source-feed-calculation-chain.js'
import { evaluateNewHopeSourceFeedFabrication } from '../src/engine/new-hope-source-feed-fabrication.js'
import { evaluateNewHopeThreadedTerminalGeometry } from '../src/engine/new-hope-threaded-terminal-geometry.js'

const read = (name) =>
  JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'))

const pipeVectors = read('new-hope-approved-fp20-pipe-vectors.json')
const planGraph = read('new-hope-approved-fp20-plan-graph.json')
const operationalAnnotations = read('new-hope-approved-fp20-operational-annotations.json')
const fabricationSchedule = read('new-hope-fabrication-end-schedule.json')
const nativeFabGraph = read('new-hope-native-fab-attachment-graph.json')
const nativeFabTopology = read('new-hope-native-fab-topology.json')
const sourceFeedAsbuiltRiserRegistration = read('new-hope-asbuilt-source-feed-riser-registration.json')
const hydraulicRoutes = ['2-1', '2-2', '2-3'].map((id) =>
  read(`new-hope-approved-fp20-hydraulic-route-${id}.json`),
)
const canonicalTopology = canonicalizeApprovedFp20Topology(planGraph)
const governedSkeleton = evaluateApprovedFp20GovernedSkeleton(
  pipeVectors,
  planGraph,
  operationalAnnotations,
)
const sourceFeedFabrication = evaluateNewHopeSourceFeedFabrication({
  canonicalTopology,
  governedSkeleton,
  operationalAnnotations,
  hydraulicRoutes,
  nativeFabTopology,
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
  canonicalTopology,
  operationalAnnotations,
  fabricationSchedule,
  nativeFabGraph,
  armOverDrainage,
  cmi05Cmi08Fabrication,
  cmi06VerticalOutlet,
  remainingCmiFabrication,
}

describe('New Hope CMI.23-CMI.42 threaded terminal geometry', () => {
  it('closes the twenty-piece inventory and exact endpoint sets without inventing per-piece 3D adjacency', () => {
    const result = evaluateNewHopeThreadedTerminalGeometry(inputs)

    expect(result.issues).toEqual([])
    expect(result.status).toBe('passed')
    expect(result.metrics).toEqual({
      threadedPieceCount: 20,
      horizontalArmOverPieceCount: 4,
      followerNipplePieceCount: 4,
      directNipplePieceCount: 12,
      approvedHorizontalRouteCount: 4,
      directCarrierHeadEndpointCount: 12,
      equivalenceClassCount: 7,
    })
    expect(result.equivalenceClasses).toMatchObject({
      'short-horizontal': ['CMI.23', 'CMI.27'],
      'short-follower': ['CMI.24', 'CMI.28'],
      'long-horizontal': ['CMI.25', 'CMI.29'],
      'long-follower': ['CMI.26', 'CMI.30'],
      'direct-10': ['CMI.31', 'CMI.32', 'CMI.33', 'CMI.34', 'CMI.35'],
      'direct-9.5': ['CMI.36', 'CMI.37', 'CMI.39', 'CMI.40'],
      'direct-9': ['CMI.38', 'CMI.41', 'CMI.42'],
    })
    expect(result.ambiguity).toMatchObject({
      horizontalRouteAssignmentCount: 4,
      followerRouteAssignmentCount: 4,
      directPieceToEndpointAssignmentCount: 479001600,
      exactWholeTerminalAssignmentCount: 7664025600,
    })
    expect(result.threadedTerminalInventoryReady).toBe(true)
    expect(result.threadedTerminalHorizontalRouteClassesReady).toBe(true)
    expect(result.threadedTerminalFollowerClassesReady).toBe(true)
    expect(result.threadedTerminalDirectEndpointSetReady).toBe(true)
    expect(result.threadedTerminalAmbiguityQuantified).toBe(true)
    expect(result.exactThreadedTerminalPieceAdjacencyReady).toBe(false)
    expect(result.exactThreadedTerminalTakeoutReady).toBe(false)
    expect(result.properPipeLayoutReady).toBe(false)
    expect(result.fabricationReady).toBe(false)
    expect(result.fieldReleaseReady).toBe(false)
  })

  it('rejects source, listing-length, native-fitting, route, endpoint, and upstream false-green mutations', () => {
    const badSource = structuredClone(inputs)
    badSource.operationalAnnotations.sources.find(
      (entry) => entry.role === 'approved-plan',
    ).sha256 = 'BAD'
    expect(evaluateNewHopeThreadedTerminalGeometry(badSource).blockerCodes).toContain(
      'NH_THREADED_TERMINAL_SOURCE_INVALID',
    )

    const badLength = structuredClone(inputs)
    badLength.fabricationSchedule.threadedPieces.find(
      (entry) => entry.pieceId === 'CMI.31',
    ).cutLengthIn = 10.5
    expect(evaluateNewHopeThreadedTerminalGeometry(badLength).blockerCodes).toContain(
      'NH_THREADED_TERMINAL_PIECE_RECONCILIATION_INVALID',
    )

    const badFitting = structuredClone(inputs)
    const cmi31 = badFitting.nativeFabGraph.records.pipes.find(
      (entry) => entry.pieceName === '.31' && entry.parentId === 188,
    )
    badFitting.nativeFabGraph.records.fittings.find(
      (entry) => entry.parentId === cmi31.uniqueId,
    ).itemCode = 1096
    expect(evaluateNewHopeThreadedTerminalGeometry(badFitting).blockerCodes).toContain(
      'NH_THREADED_TERMINAL_PIECE_RECONCILIATION_INVALID',
    )

    const badRoute = structuredClone(inputs)
    badRoute.armOverDrainage.directedEdges.find(
      (entry) => entry.edgeId === 'source-edge-108',
    ).sprinklerId = 'head-035'
    expect(evaluateNewHopeThreadedTerminalGeometry(badRoute).blockerCodes).toContain(
      'NH_THREADED_TERMINAL_ROUTE_CLASS_INVALID',
    )

    const badEndpoint = structuredClone(inputs)
    badEndpoint.cmi05Cmi08Fabrication.pieces['CMI.05'].outlets[0].sprinklerId = 'head-060'
    expect(evaluateNewHopeThreadedTerminalGeometry(badEndpoint).blockerCodes).toContain(
      'NH_THREADED_TERMINAL_DIRECT_ENDPOINT_SET_INVALID',
    )

    const badUpstream = structuredClone(inputs)
    badUpstream.cmi06VerticalOutlet.status = 'blocked'
    const blocked = evaluateNewHopeThreadedTerminalGeometry(badUpstream)
    expect(blocked.blockerCodes).toContain('NH_THREADED_TERMINAL_UPSTREAM_BLOCKED')
    expect(blocked.threadedTerminalInventoryReady).toBe(false)
    expect(blocked.exactThreadedTerminalPieceAdjacencyReady).toBe(false)
  })
})

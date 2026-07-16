import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { canonicalizeApprovedFp20Topology } from '../src/engine/approved-fp20-canonical-topology.js'
import { evaluateApprovedFp20GovernedSkeleton } from '../src/engine/approved-fp20-governed-skeleton.js'
import { bindApprovedFp20HydraulicRouteSet } from '../src/engine/approved-fp20-hydraulic-route-binding.js'
import { evaluateNewHopeCmi05Cmi08Fabrication } from '../src/engine/new-hope-cmi05-cmi08-fabrication.js'
import { evaluateNewHopeCmi06VerticalOutlet } from '../src/engine/new-hope-cmi06-vertical-outlet.js'
import { evaluateNewHopeCmiRidgeChainFabrication } from '../src/engine/new-hope-cmi-ridge-chain-fabrication.js'
import { evaluateNewHopeCmlCmiWeldedConnectionGraph } from '../src/engine/new-hope-cml-cmi-welded-connection-graph.js'
import { evaluateNewHopeLowPointFabrication } from '../src/engine/new-hope-low-point-fabrication.js'
import { evaluateNewHopeRemainingCmiFabrication } from '../src/engine/new-hope-remaining-cmi-fabrication.js'
import { evaluateNewHopeSourceFeedFabrication } from '../src/engine/new-hope-source-feed-fabrication.js'

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'))
const pipeVectors = read('new-hope-approved-fp20-pipe-vectors.json')
const planGraph = read('new-hope-approved-fp20-plan-graph.json')
const operationalAnnotations = read('new-hope-approved-fp20-operational-annotations.json')
const nativeFabGraph = read('new-hope-native-fab-attachment-graph.json')
const fabricationSchedule = read('new-hope-fabrication-end-schedule.json')
const nativeFabTopology = read('new-hope-native-fab-topology.json')
const hydraulicRoutes = ['2-1', '2-2', '2-3'].map((id) => read(`new-hope-approved-fp20-hydraulic-route-${id}.json`))
const canonicalTopology = canonicalizeApprovedFp20Topology(planGraph)
const governedSkeleton = evaluateApprovedFp20GovernedSkeleton(pipeVectors, planGraph, operationalAnnotations)
const hydraulicRouteSet = bindApprovedFp20HydraulicRouteSet(canonicalTopology, hydraulicRoutes)
const sourceFeedFabrication = evaluateNewHopeSourceFeedFabrication({
  canonicalTopology,
  governedSkeleton,
  operationalAnnotations,
  hydraulicRoutes,
  nativeFabTopology,
})
const lowPointFabrication = evaluateNewHopeLowPointFabrication({ canonicalTopology, governedSkeleton, operationalAnnotations, hydraulicRoutes })
const cmi05Cmi08Fabrication = evaluateNewHopeCmi05Cmi08Fabrication({ pipeVectors, canonicalTopology, governedSkeleton, operationalAnnotations })
const cmi06VerticalOutlet = evaluateNewHopeCmi06VerticalOutlet({ pipeVectors, canonicalTopology, governedSkeleton, operationalAnnotations, hydraulicRoutes })
const cmiRidgeChainFabrication = evaluateNewHopeCmiRidgeChainFabrication({ pipeVectors, canonicalTopology, governedSkeleton, operationalAnnotations })
const remainingCmiFabrication = evaluateNewHopeRemainingCmiFabrication({ pipeVectors, canonicalTopology, governedSkeleton, operationalAnnotations, sourceFeedFabrication })

const inputs = {
  canonicalTopology,
  operationalAnnotations,
  fabricationSchedule,
  nativeFabGraph,
  sourceFeedFabrication,
  lowPointFabrication,
  cmi05Cmi08Fabrication,
  cmi06VerticalOutlet,
  cmiRidgeChainFabrication,
  remainingCmiFabrication,
  hydraulicRouteSet,
}

describe('New Hope CML/CMI welded same-project connection graph', () => {
  it('closes all 23 welded identities and 22 FP2.0 inter-piece adjacencies without promoting takeout', () => {
    const result = evaluateNewHopeCmlCmiWeldedConnectionGraph(inputs)
    expect(result.status).toBe('passed')
    expect(result.metrics).toEqual({
      weldedPieceCount: 23,
      cmiPieceCount: 22,
      interPieceAdjacencyCount: 22,
      nativeOutletAttachmentCount: 45,
      nativeFittingAttachmentCount: 0,
      bifurcationCount: 1,
      connectedComponentCount: 1,
      cycleRank: 0,
    })
    expect(result.pieces).toHaveLength(23)
    expect(result.adjacencies).toHaveLength(22)
    expect(result.adjacencies).toContainEqual({ fromPieceId: 'CML.01', toPieceId: 'CMI.01', junctionNodeId: 'canonical-node-002' })
    expect(result.adjacencies).toContainEqual({ fromPieceId: 'CMI.03', toPieceId: 'CMI.04', junctionNodeId: 'canonical-node-125' })
    expect(result.adjacencies).toContainEqual({ fromPieceId: 'CMI.03', toPieceId: 'CMI.14', junctionNodeId: 'canonical-node-125' })
    expect(result.adjacencies).toContainEqual({ fromPieceId: 'CMI.12', toPieceId: 'CMI.13', junctionNodeId: 'canonical-node-099' })
    expect(result.adjacencies).toContainEqual({ fromPieceId: 'CMI.21', toPieceId: 'CMI.22', junctionNodeId: 'canonical-node-103' })
    expect(result.sameProjectCmlCmiWeldedIdentityReady).toBe(true)
    expect(result.sameProjectCmlCmiWeldedInterPieceAdjacencyReady).toBe(true)
    expect(result.sameProjectCmlCmiNativeOutletAttachmentReady).toBe(true)
    expect(result.exactConnectionTakeoutReady).toBe(false)
    expect(result.threadedTerminalPieceAdjacencyReady).toBe(false)
    expect(result.wholeProjectInterPieceAdjacencyReady).toBe(false)
    expect(result.properPipeLayoutReady).toBe(false)
  })

  it('fails closed if one FP2.0 piece endpoint is moved to a plausible but wrong junction', () => {
    const attacked = structuredClone(inputs)
    const piece = attacked.operationalAnnotations.fabricationLineEvidence.ridgeChainPieceBindings.find((entry) => entry.pieceId === 'CMI.22')
    piece.pieceStartCanonicalNodeId = 'canonical-node-098'
    const result = evaluateNewHopeCmlCmiWeldedConnectionGraph(attacked)
    expect(result.status).toBe('blocked')
    expect(result.blockerCodes).toContain('NH_CML_CMI_WELDED_PIECE_BINDING_INVALID')
    expect(result.sameProjectCmlCmiWeldedInterPieceAdjacencyReady).toBe(false)
  })

  it('rejects native outlet reparenting and an upstream false-green', () => {
    const reparented = structuredClone(inputs)
    const cmiPipe = reparented.nativeFabGraph.records.pipes.find((pipe) => pipe.uniqueId === 284)
    const outlet = reparented.nativeFabGraph.records.outlets.find((entry) => entry.parentId !== cmiPipe.uniqueId)
    outlet.parentId = cmiPipe.uniqueId
    const nativeResult = evaluateNewHopeCmlCmiWeldedConnectionGraph(reparented)
    expect(nativeResult.status).toBe('blocked')
    expect(nativeResult.blockerCodes).toContain('NH_CML_CMI_WELDED_NATIVE_INVENTORY_INVALID')

    const falseGreen = structuredClone(inputs)
    falseGreen.cmiRidgeChainFabrication.eightPieceFabricationReady = false
    const upstreamResult = evaluateNewHopeCmlCmiWeldedConnectionGraph(falseGreen)
    expect(upstreamResult.status).toBe('blocked')
    expect(upstreamResult.blockerCodes).toContain('NH_CML_CMI_WELDED_UPSTREAM_EVIDENCE_BLOCKED')
  })
})

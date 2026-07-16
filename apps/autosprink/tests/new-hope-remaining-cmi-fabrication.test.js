import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { canonicalizeApprovedFp20Topology } from '../src/engine/approved-fp20-canonical-topology.js'
import { evaluateApprovedFp20GovernedSkeleton } from '../src/engine/approved-fp20-governed-skeleton.js'
import { evaluateNewHopeRemainingCmiFabrication } from '../src/engine/new-hope-remaining-cmi-fabrication.js'
import { evaluateNewHopeSourceFeedFabrication } from '../src/engine/new-hope-source-feed-fabrication.js'

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'))
const pipeVectors = read('new-hope-approved-fp20-pipe-vectors.json')
const planGraph = read('new-hope-approved-fp20-plan-graph.json')
const operationalAnnotations = read('new-hope-approved-fp20-operational-annotations.json')
const hydraulicRoutes = ['2-1', '2-2', '2-3'].map((id) => read(`new-hope-approved-fp20-hydraulic-route-${id}.json`))
const canonicalTopology = canonicalizeApprovedFp20Topology(planGraph)
const governedSkeleton = evaluateApprovedFp20GovernedSkeleton(pipeVectors, planGraph, operationalAnnotations)
const sourceFeedFabrication = evaluateNewHopeSourceFeedFabrication({ canonicalTopology, governedSkeleton, operationalAnnotations, hydraulicRoutes })
const inputs = { pipeVectors, canonicalTopology, governedSkeleton, operationalAnnotations, sourceFeedFabrication }
const binding = (copy, pieceId) => copy.operationalAnnotations.fabricationLineEvidence.remainingCmiPieceBindings.find((entry) => entry.pieceId === pieceId)
const mutate = (fn) => {
  const copy = structuredClone(inputs)
  fn(copy)
  return evaluateNewHopeRemainingCmiFabrication(copy)
}
const expectBlocked = (result, code) => {
  expect(result.status).toBe('blocked')
  expect(result.blockerCodes).toContain(code)
  expect(result.properPipeLayoutReady).toBe(false)
  expect(result.fabricationReady).toBe(false)
  expect(result.fieldReleaseReady).toBe(false)
}

describe('New Hope remaining CMI fabrication', () => {
  it('binds nine pieces, 19 edges, 11 outlets, four no-outlet pieces, and the exact source outlet Z', () => {
    const result = evaluateNewHopeRemainingCmiFabrication(inputs)
    expect(result.status).toBe('passed')
    expect(result.metrics).toEqual({
      boundedPieceCount: 9,
      boundedCanonicalEdgeCount: 19,
      boundedOutletCount: 11,
      directSprinklerOutletCount: 6,
      branchOrArmOverOutletCount: 5,
      noOutletPieceCount: 4,
      chainCount: 2,
    })
    expect(result.sourceOutletRegistration).toEqual({
      upstreamPieceId: 'CML.01',
      downstreamPieceId: 'CMI.01',
      canonicalNodeId: 'canonical-node-002',
      calculationNodeId: '118',
      localElevationFt: 11.5,
      exactPieceStartZReady: true,
      farEndZReady: false,
      installedGradeReady: false,
    })
    expect(result.pieces['CMI.03']).toMatchObject({ planLengthIn: 237.173544, pieceLengthResidualIn: 14.826456 })
    expect(result.outletRegistrations.find((entry) => entry.pieceId === 'CMI.15' && entry.canonicalNodeId === 'canonical-node-131')).toMatchObject({ listedStationIn: 246, planStationIn: 250.00038, residualIn: 4.00038, downstreamSourceSegmentId: 'pipe-066' })
    expect(result.ninePieceFabricationReady).toBe(true)
    expect(result.elevenOutletScheduleReady).toBe(true)
    expect(result.sixDirectSprinklerOutletIdentityReady).toBe(true)
    expect(result.fiveBranchOrArmOverOutletScheduleReady).toBe(true)
    expect(result.fourNoOutletPieceScheduleReady).toBe(true)
    expect(result.cmi01SourceOutletZReady).toBe(true)
    expect(result.completeFittingScheduleReady).toBe(false)
    expect(result.exactWholeSystemZReady).toBe(false)
    expect(result.properPipeLayoutReady).toBe(false)
  })

  it('rejects changed protected source identity and missing binding inventory', () => {
    expectBlocked(mutate((copy) => { copy.operationalAnnotations.fabricationLineEvidence.fieldSet.sha256 = 'changed' }), 'NH_REMAINING_CMI_FABRICATION_SOURCE_INVALID')
    expectBlocked(mutate((copy) => { copy.operationalAnnotations.fabricationLineEvidence.remainingCmiPieceBindings.pop() }), 'NH_REMAINING_CMI_BINDING_INVENTORY_INVALID')
  })

  it('rejects piece identity, governed role, and ordered traversal drift', () => {
    expectBlocked(mutate((copy) => { binding(copy, 'CMI.18').nominalDiameterIn = 3 }), 'NH_REMAINING_CMI_PIECE_IDENTITY_INVALID')
    expectBlocked(mutate((copy) => { copy.governedSkeleton.primaryAssignments.find((entry) => entry.sourceSegmentId === 'pipe-033').systemRole = 'cross-main' }), 'NH_REMAINING_CMI_GOVERNED_ROLE_INVALID')
    expectBlocked(mutate((copy) => { binding(copy, 'CMI.03').sourceEdgeIds.reverse() }), 'NH_REMAINING_CMI_PIECE_IDENTITY_INVALID')
    expectBlocked(mutate((copy) => { copy.canonicalTopology.edges.find((entry) => entry.id === 'source-edge-113').fromNodeId = 'canonical-node-999' }), 'NH_REMAINING_CMI_PLAN_TOPOLOGY_INVALID')
  })

  it('rejects undeclared or exceeded piece-length residuals', () => {
    expectBlocked(mutate((copy) => { delete binding(copy, 'CMI.01').maximumPieceLengthResidualIn }), 'NH_REMAINING_CMI_PIECE_RESIDUAL_EXCEEDED')
    expectBlocked(mutate((copy) => { binding(copy, 'CMI.03').maximumPieceLengthResidualIn = 14 }), 'NH_REMAINING_CMI_PIECE_RESIDUAL_EXCEEDED')
  })

  it('rejects outlet count, station, fitting, orientation, and residual drift', () => {
    expectBlocked(mutate((copy) => { binding(copy, 'CMI.15').outlets.pop() }), 'NH_REMAINING_CMI_OUTLET_COUNT_INVALID')
    expectBlocked(mutate((copy) => { binding(copy, 'CMI.18').outlets[0].fromPieceStartIn = 8 }), 'NH_REMAINING_CMI_OUTLET_SEQUENCE_INVALID')
    expectBlocked(mutate((copy) => { binding(copy, 'CMI.04').outlets[0].fitting = 'coupling' }), 'NH_REMAINING_CMI_OUTLET_SEQUENCE_INVALID')
    expectBlocked(mutate((copy) => { binding(copy, 'CMI.16').outlets[0].orientation = 'toward-90-degrees' }), 'NH_REMAINING_CMI_OUTLET_SEQUENCE_INVALID')
    expectBlocked(mutate((copy) => { binding(copy, 'CMI.03').maximumOutletStationResidualIn = 2 }), 'NH_REMAINING_CMI_OUTLET_RESIDUAL_EXCEEDED')
  })

  it('rejects direct sprinkler and arm-over terminal identity drift', () => {
    expectBlocked(mutate((copy) => { binding(copy, 'CMI.15').outlets[0].sprinklerId = 'head-999' }), 'NH_REMAINING_CMI_SPRINKLER_IDENTITY_INVALID')
    expectBlocked(mutate((copy) => { binding(copy, 'CMI.16').outlets[0].sprinklerId = 'head-999' }), 'NH_REMAINING_CMI_ARMOVER_TERMINAL_INVALID')
  })

  it('rejects downstream branch role, diameter, and segment drift', () => {
    expectBlocked(mutate((copy) => { binding(copy, 'CMI.18').outlets[0].downstreamSystemRole = 'arm-over' }), 'NH_REMAINING_CMI_DOWNSTREAM_CONNECTION_INVALID')
    expectBlocked(mutate((copy) => { binding(copy, 'CMI.03').outlets[0].downstreamNominalDiameterIn = 3 }), 'NH_REMAINING_CMI_DOWNSTREAM_CONNECTION_INVALID')
    expectBlocked(mutate((copy) => { binding(copy, 'CMI.15').outlets[4].downstreamSourceSegmentId = 'pipe-064' }), 'NH_REMAINING_CMI_DOWNSTREAM_CONNECTION_INVALID')
  })

  it('rejects conflating the CMI.15 branch outlet with the CMI.16 continuation', () => {
    const result = mutate((copy) => {
      binding(copy, 'CMI.15').farEndContinuationSourceSegmentId = 'pipe-066'
    })
    expectBlocked(result, 'NH_CMI15_BRANCH_CONTINUATION_CONFLATED')
  })

  it('rejects broken CMI.04-to-CMI.05 and CMI.18-to-CMI.19 junction evidence', () => {
    expectBlocked(mutate((copy) => { binding(copy, 'CMI.04').farEndContinuationSourceSegmentId = 'pipe-999' }), 'NH_REMAINING_CMI_ADJACENT_CHAIN_JUNCTION_INVALID')
    expectBlocked(mutate((copy) => { binding(copy, 'CMI.18').farEndContinuationSourceSegmentId = 'pipe-999' }), 'NH_REMAINING_CMI_ADJACENT_CHAIN_JUNCTION_INVALID')
  })

  it('rejects loss or false promotion of the CML.01-to-CMI.01 exact start-Z registration', () => {
    expectBlocked(mutate((copy) => { copy.sourceFeedFabrication.outlet.localElevationFt = 12 }), 'NH_CMI01_SOURCE_OUTLET_Z_INVALID')
    const result = evaluateNewHopeRemainingCmiFabrication({ ...inputs, sourceFeedFabrication: null })
    expectBlocked(result, 'NH_CMI01_SOURCE_OUTLET_Z_INVALID')
  })
})

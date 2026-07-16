import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { canonicalizeApprovedFp20Topology } from '../src/engine/approved-fp20-canonical-topology.js'
import { evaluateApprovedFp20GovernedSkeleton } from '../src/engine/approved-fp20-governed-skeleton.js'
import { evaluateNewHopeSourceFeedAsbuiltRiser } from '../src/engine/new-hope-source-feed-asbuilt-riser.js'
import { evaluateNewHopeSourceFeedCalculationChain } from '../src/engine/new-hope-source-feed-calculation-chain.js'
import { evaluateNewHopeSourceFeedFabrication } from '../src/engine/new-hope-source-feed-fabrication.js'

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'))
const registration = read('new-hope-asbuilt-source-feed-riser-registration.json')
const pipeVectors = read('new-hope-approved-fp20-pipe-vectors.json')
const planGraph = read('new-hope-approved-fp20-plan-graph.json')
const operationalAnnotations = read('new-hope-approved-fp20-operational-annotations.json')
const nativeFabTopology = read('new-hope-native-fab-topology.json')
const hydraulicRoutes = ['2-1', '2-2', '2-3'].map((id) => read(`new-hope-approved-fp20-hydraulic-route-${id}.json`))
const canonicalTopology = canonicalizeApprovedFp20Topology(planGraph)
const governedSkeleton = evaluateApprovedFp20GovernedSkeleton(pipeVectors, planGraph, operationalAnnotations)
const sourceFeedFabrication = evaluateNewHopeSourceFeedFabrication({ canonicalTopology, governedSkeleton, operationalAnnotations, hydraulicRoutes, nativeFabTopology })
const sourceFeedCalculationChain = evaluateNewHopeSourceFeedCalculationChain({ hydraulicRoutes, sourceFeedFabrication })
const inputs = { registration, pipeVectors, planGraph, canonicalTopology, sourceFeedFabrication, sourceFeedCalculationChain }

describe('New Hope as-built source-feed riser registration', () => {
  it('binds the identical cross-sheet riser station and maps CML.01 to hydraulic leg 118-414 without promoting field geometry', () => {
    const result = evaluateNewHopeSourceFeedAsbuiltRiser(inputs)
    expect(result.status).toBe('passed')
    expect(result.asBuiltRiserIdentityReady).toBe(true)
    expect(result.sharedTransferAxisReady).toBe(true)
    expect(result.orthogonalCalculationDecompositionReady).toBe(true)
    expect(result.concealedRiserContinuationIdentityReady).toBe(true)
    expect(result.decomposition).toMatchObject({
      sourceAnchorPdfPt: { x: 660.675, y: 1118.512 },
      node118PdfPt: { x: 681.985, y: 1118.512 },
      node118LocalElevationFt: 11.5,
      node414LocalElevationFt: 5.458333,
      planHorizontalLengthFt: 2.367806,
      verticalElevationDeltaFt: 6.041667,
      orthogonalSumFt: 8.409473,
      calculationPhysicalLengthFt: 8.416667,
      calculationLengthResidualIn: 0.086322,
      transferAxisResidualPt: 0.000451,
      exactRiserPlanStationPdfPt: { x: 660.674561, y: 1118.512451 },
      exactRiserPlanStationPlanFt: { xFt: -59.776502, yFt: 65.937876 },
      stationToAnchorResidualPt: 0.000629,
      fabricationPieceToCalculationLegMapping: {
        pieceId: 'CML.01',
        sourceEdgeId: 'source-edge-001',
        calculationNode1: '118',
        calculationNode2: '414',
        horizontalPlanCenterlineLengthIn: 28.413678,
        listedStartToOutletCutLengthIn: 29.5,
        listedCutToPlanCenterlineAdjustmentIn: 1.086322,
        verticalCalculationComponentIn: 72.500004,
        calculationPhysicalLengthIn: 101.000004,
        orthogonalComponentSumIn: 100.913682,
        calculationRoundingResidualIn: 0.086322,
      },
    })
    expect(result.exactInstalledRiserPlanStationReady).toBe(true)
    expect(result.fabricationPieceToCalculationLegDecompositionReady).toBe(true)
    expect(result.installedGradeReady).toBe(false)
    expect(result.sourceFeed3dPathReady).toBe(false)
  })

  it.each([
    ['as-built hash', (copy) => { copy.registration.source.sha256 = 'BAD' }, 'NH_ASBUILT_RISER_SOURCE_INVALID'],
    ['source sheets', (copy) => { copy.registration.source.sheets[0].physicalPage = 2 }, 'NH_ASBUILT_RISER_SOURCE_INVALID'],
    ['device identity', (copy) => { copy.registration.fp10RiserEvidence.deviceTexts[0] = '3 INCH DRY VALVE' }, 'NH_ASBUILT_RISER_DETAIL_IDENTITY_INVALID'],
    ['external node', (copy) => { copy.registration.fp10RiserEvidence.calculationNodeTextBboxesPdfPt[0].calculationNodeId = '415' }, 'NH_ASBUILT_RISER_PLAN_REGISTRATION_INVALID'],
    ['riser leader', (copy) => { copy.registration.fp10RiserEvidence.riserLeader.targetPdfPt.y = 1119 }, 'NH_ASBUILT_RISER_PLAN_REGISTRATION_INVALID'],
    ['cross-sheet primitive hash', (copy) => { copy.registration.fp10RiserEvidence.crossSheetRiserPrimitive.normalizedSha256 = 'BAD' }, 'NH_ASBUILT_RISER_CROSS_SHEET_PRIMITIVE_INVALID'],
    ['exact station', (copy) => { copy.registration.fp10RiserEvidence.crossSheetRiserPrimitive.planStationPdfPt.x = 660 }, 'NH_ASBUILT_RISER_CROSS_SHEET_PRIMITIVE_INVALID'],
    ['FP2 source anchor', (copy) => { copy.registration.fp20TransferEvidence.sourceAnchor.pdfPt.x = 661 }, 'NH_ASBUILT_RISER_FP20_TRANSFER_INVALID'],
    ['plan scale', (copy) => { copy.registration.fp20TransferEvidence.pdfPtPerFt = 9.5 }, 'NH_ASBUILT_RISER_ORTHOGONAL_DECOMPOSITION_INVALID'],
    ['BOR elevation', (copy) => { copy.sourceFeedCalculationChain.calculationLegs[0].elevation2Ft = 6 }, 'NH_ASBUILT_RISER_ORTHOGONAL_DECOMPOSITION_INVALID'],
    ['fabrication calculation mapping', (copy) => { copy.registration.calculationDecomposition.fabricationPieceToCalculationLegMapping.sourceEdgeId = 'source-edge-002' }, 'NH_ASBUILT_RISER_FABRICATION_CALC_MAPPING_INVALID'],
    ['false exact station demotion', (copy) => { copy.registration.claims.exactInstalledRiserPlanStationReady = false }, 'NH_ASBUILT_RISER_FALSE_READINESS_PROMOTION'],
    ['false grade', (copy) => { copy.registration.claims.installedGradeReady = true }, 'NH_ASBUILT_RISER_FALSE_READINESS_PROMOTION'],
  ])('fails closed on %s drift', (_name, mutate, code) => {
    const copy = structuredClone(inputs)
    mutate(copy)
    const result = evaluateNewHopeSourceFeedAsbuiltRiser(copy)
    expect(result.status).toBe('blocked')
    expect(result.blockerCodes).toContain(code)
    expect(result.orthogonalCalculationDecompositionReady).toBe(false)
    expect(result.sourceFeed3dPathReady).toBe(false)
  })
})

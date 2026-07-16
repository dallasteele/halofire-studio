/**
 * Validates the New Hope as-built FP1.0 riser registration against FP2.0 and
 * the approved hydraulic calculation chain.
 *
 * This closes source identity and an orthogonal calculation decomposition.
 * It deliberately does not promote an exact installed riser station, a
 * fabrication cut-to-calculation decomposition, installed grade, or full 3D.
 */

const EXPECTED_PROJECT_ID = 'new-hope-crisis-center-brigham-city-ut'
const EXPECTED_ASBUILT_SHA = 'ED00E9530C02217BC50EAD2FC3391938E731253949B728B31ED1336F8000F34B'
const EXPECTED_PLAN_SHA = '5A770222363228C2766605A695FEE9B6CB1F7B49C296204E09B691100253D9D5'
const EXPECTED_DEVICE_TEXTS = Object.freeze([
  '4 INCH DRY VALVE',
  '4 INCH GROOVED BUTTERFLY VALVE',
  '4 INCH BACKFLOW PREVENTER',
  '2 INCH DRAIN TO EXTERIOR',
])
const EXPECTED_EXTERNAL_NODES = Object.freeze(['414', '560', '554'])

const issue = (code, message, entityId = null) => ({ severity: 'blocking', code, message, entityId })
const round = (value, digits = 6) => Number(value.toFixed(digits))
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)

export function evaluateNewHopeSourceFeedAsbuiltRiser(inputs = {}) {
  const issues = []
  const {
    registration,
    pipeVectors,
    planGraph,
    canonicalTopology,
    sourceFeedFabrication,
    sourceFeedCalculationChain,
  } = inputs

  if (
    registration?.projectId !== EXPECTED_PROJECT_ID ||
    pipeVectors?.projectId !== EXPECTED_PROJECT_ID ||
    planGraph?.projectId !== EXPECTED_PROJECT_ID ||
    canonicalTopology?.projectId !== EXPECTED_PROJECT_ID ||
    sourceFeedFabrication?.projectId !== EXPECTED_PROJECT_ID ||
    sourceFeedCalculationChain?.projectId !== EXPECTED_PROJECT_ID
  ) {
    issues.push(issue('NH_ASBUILT_RISER_PROJECT_IDENTITY_INVALID', 'Every source-feed riser input must identify New Hope.'))
  }
  if (
    registration?.source?.sha256 !== EXPECTED_ASBUILT_SHA ||
    !same(registration?.source?.pageBoxPdfPt, { width: 3024, height: 2160 }) ||
    !same(registration?.source?.sheets, [
      { physicalPage: 3, sheet: 'FP1.0', title: 'FIRE SPRINKLER LAYOUT - LEVEL 1' },
      { physicalPage: 4, sheet: 'FP2.0', title: 'FIRE SPRINKLER LAYOUT - ATTIC' },
    ])
  ) {
    issues.push(issue('NH_ASBUILT_RISER_SOURCE_INVALID', 'The registration must remain bound to the exact two as-built source sheets.'))
  }
  const fp10 = registration?.fp10RiserEvidence
  if (
    fp10?.physicalPage !== 3 ||
    fp10?.sheet !== 'FP1.0' ||
    fp10?.riserLocationText !== 'RISER LOCATION' ||
    fp10?.dryAtticSystemText !== '4 INCH TO DRY ATTIC SYSTEM' ||
    fp10?.sectionTitle !== 'FIRE SPRINKLER RISER SECTION DETAIL' ||
    fp10?.sectionScale !== '1/2 INCH = 1 FOOT' ||
    !same(fp10?.deviceTexts, EXPECTED_DEVICE_TEXTS)
  ) {
    issues.push(issue('NH_ASBUILT_RISER_DETAIL_IDENTITY_INVALID', 'FP1.0 must retain the exact scaled dry-attic riser and device-detail identities.', 'FP1.0'))
  }
  if (
    !same(fp10?.calculationNodeTextBboxesPdfPt?.map((entry) => entry.calculationNodeId), EXPECTED_EXTERNAL_NODES) ||
    fp10?.riserLeader?.drawingIndex !== 16997 ||
    fp10?.riserLeader?.targetPdfPt?.x !== 656.875854 ||
    fp10?.riserLeader?.targetPdfPt?.y !== 1118.512451
  ) {
    issues.push(issue('NH_ASBUILT_RISER_PLAN_REGISTRATION_INVALID', 'FP1.0 must retain the extracted riser leader and node 414/560/554 callouts.', 'FP1.0:riser'))
  }

  const transfer = registration?.fp20TransferEvidence
  const anchorNode = planGraph?.nodes?.find((node) => node.id === 'pipe-001-node-01')
  const outletNode = canonicalTopology?.nodes?.find((node) => node.id === 'canonical-node-002')
  const outletMemberNode = planGraph?.nodes?.find((node) => node.id === 'pipe-001-node-02')
  if (
    pipeVectors?.source?.sha256 !== EXPECTED_PLAN_SHA ||
    transfer?.approvedPlanSha256 !== EXPECTED_PLAN_SHA ||
    transfer?.sourceAnchor?.planNodeId !== 'pipe-001-node-01' ||
    transfer?.sourceAnchor?.sourceSegmentId !== 'pipe-001' ||
    transfer?.sourceAnchor?.sourceDrawingIndex !== 3520 ||
    !same(transfer?.sourceAnchor?.pdfPt, anchorNode?.pdfPt) ||
    transfer?.outlet?.canonicalNodeId !== 'canonical-node-002' ||
    transfer?.outlet?.planMemberNodeId !== 'pipe-001-node-02' ||
    transfer?.outlet?.calculationNodeId !== '118' ||
    !outletNode?.memberNodeIds?.includes('pipe-001-node-02') ||
    !same(transfer?.outlet?.pdfPt, outletMemberNode?.pdfPt) ||
    transfer?.outlet?.localElevationFt !== sourceFeedFabrication?.outlet?.localElevationFt
  ) {
    issues.push(issue('NH_ASBUILT_RISER_FP20_TRANSFER_INVALID', 'The FP2.0 source anchor and node-118 outlet must remain exact canonical plan points.', 'pipe-001'))
  }
  const transferAxisResidualPt = Math.abs(
    (fp10?.riserLeader?.targetPdfPt?.y ?? Number.NaN) -
      (transfer?.sourceAnchor?.pdfPt?.y ?? Number.NaN),
  )
  if (!Number.isFinite(transferAxisResidualPt) || transferAxisResidualPt > 0.001) {
    issues.push(issue('NH_ASBUILT_RISER_SHARED_AXIS_INVALID', 'FP1.0 riser evidence and the FP2.0 source anchor must retain one registered transfer axis.'))
  }

  const calcLeg = sourceFeedCalculationChain?.calculationLegs?.find(
    (leg) => leg.node1 === '118' && leg.node2 === '414',
  )
  const pdfPtPerFt = transfer?.pdfPtPerFt
  const planHorizontalLengthFt =
    Number.isFinite(pdfPtPerFt) && pdfPtPerFt > 0
      ? Math.hypot(
          transfer.outlet.pdfPt.x - transfer.sourceAnchor.pdfPt.x,
          transfer.outlet.pdfPt.y - transfer.sourceAnchor.pdfPt.y,
        ) / pdfPtPerFt
      : Number.NaN
  const verticalElevationDeltaFt = calcLeg
    ? calcLeg.elevation1Ft - calcLeg.elevation2Ft
    : Number.NaN
  const orthogonalSumFt = planHorizontalLengthFt + verticalElevationDeltaFt
  const calculationLengthResidualIn = calcLeg
    ? Math.abs(calcLeg.lengthFt - orthogonalSumFt) * 12
    : Number.NaN
  const decomposition = registration?.calculationDecomposition
  if (
    sourceFeedCalculationChain?.status !== 'passed' ||
    calcLeg?.nominalDiameterIn !== 4 ||
    decomposition?.baseOfRiserCalculationNodeId !== '414' ||
    decomposition?.baseOfRiserLocalElevationFt !== calcLeg?.elevation2Ft ||
    decomposition?.calculationPhysicalLengthFt !== calcLeg?.lengthFt ||
    decomposition?.planHorizontalLengthFt !== round(planHorizontalLengthFt) ||
    decomposition?.verticalElevationDeltaFt !== round(verticalElevationDeltaFt) ||
    decomposition?.orthogonalSumFt !== round(orthogonalSumFt) ||
    decomposition?.calculationLengthResidualIn !== round(calculationLengthResidualIn) ||
    decomposition?.maximumCalculationLengthResidualIn !== 0.125 ||
    calculationLengthResidualIn > decomposition.maximumCalculationLengthResidualIn
  ) {
    issues.push(issue('NH_ASBUILT_RISER_ORTHOGONAL_DECOMPOSITION_INVALID', 'The source-bound plan run plus vertical Z change must reconcile to the approved 118-to-414 physical length within one-eighth inch.', '118-414'))
  }
  if (
    registration?.claims?.exactInstalledRiserPlanStationReady !== false ||
    registration?.claims?.fabricationPieceToCalculationLegDecompositionReady !== false ||
    registration?.claims?.installedGradeReady !== false ||
    registration?.claims?.sourceFeed3dPathReady !== false ||
    registration?.claims?.fabricationReady !== false ||
    registration?.claims?.fieldReleaseReady !== false
  ) {
    issues.push(issue('NH_ASBUILT_RISER_FALSE_READINESS_PROMOTION', 'As-built riser identity and calculation decomposition cannot promote exact installed XY, fabrication decomposition, grade, 3D, fabrication, or field release.'))
  }

  const ready = issues.length === 0
  return {
    artifactType: 'halofire.new-hope-source-feed-asbuilt-riser-result.v1',
    projectId: registration?.projectId,
    status: ready ? 'passed' : 'blocked',
    issues,
    blockerCodes: [...new Set(issues.map((entry) => entry.code))],
    source: ready ? registration.source : null,
    riserEvidence: ready ? fp10 : null,
    decomposition: ready
      ? {
          sourceAnchorPdfPt: transfer.sourceAnchor.pdfPt,
          node118PdfPt: transfer.outlet.pdfPt,
          node118LocalElevationFt: transfer.outlet.localElevationFt,
          node414LocalElevationFt: calcLeg.elevation2Ft,
          planHorizontalLengthFt: round(planHorizontalLengthFt),
          verticalElevationDeltaFt: round(verticalElevationDeltaFt),
          orthogonalSumFt: round(orthogonalSumFt),
          calculationPhysicalLengthFt: calcLeg.lengthFt,
          calculationLengthResidualIn: round(calculationLengthResidualIn),
          transferAxisResidualPt: round(transferAxisResidualPt),
        }
      : null,
    asBuiltRiserIdentityReady: ready,
    sharedTransferAxisReady: ready,
    orthogonalCalculationDecompositionReady: ready,
    concealedRiserContinuationIdentityReady: ready,
    exactInstalledRiserPlanStationReady: false,
    fabricationPieceToCalculationLegDecompositionReady: false,
    installedGradeReady: false,
    sourceFeed3dPathReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
  }
}

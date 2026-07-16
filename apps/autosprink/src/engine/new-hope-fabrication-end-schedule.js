/**
 * Validates complete listed pipe-end coverage for the approved New Hope
 * AutoSPRINK fabrication report. Exact threaded fitting sizes are recovered
 * from the PDF's lossless Unicode fractions. Installed inter-piece topology,
 * vertical offsets, and field geometry remain outside this bounded claim.
 */

const EXPECTED_PROJECT_ID = 'new-hope-crisis-center-brigham-city-ut'
const EXPECTED_SOURCE_SHA = '2E01CB3C2C39289846DF0A17A758E6D1DE4F5A682ED139556BD864BF6F8BD734'
const EXPECTED_WELDED_COUNTS = Object.freeze({
  BL01: 2, BL02: 2, BL03: 2, BL04: 2, BL05: 2, BL06: 3, BL07: 2, BL08: 1,
  BL09: 2, BL10: 2, BL11: 2, BL12: 1, BL13: 2, BL14: 2, BL15: 2, BL16: 1,
  BL17: 2, BL18: 2, BL19: 2, BL20: 2, BL21: 1, BL22: 1, BL23: 1, BL24: 1,
  BL25: 1, BL26: 1, BL27: 1, BL28: 1, BL29: 2, BL30: 1, BL31: 2, BL32: 1,
  BL33: 1, BL34: 1, BL35: 1, BL36: 1, BL37: 1, BL38: 1, BL39: 1, BL40: 1,
  BL41: 1, BL42: 1, BL43: 1, BL44: 2, BL45: 2, BL46: 1, BL47: 1, BL48: 7,
  BL49: 6, BL50: 2, CMA: 7, CMB: 9, CMC: 12, CMF: 1, CMG: 1, CMH: 7,
  CMI: 22, CMJ: 7, CMK: 3, CML: 1, FRA: 1, FRB: 1, FRC: 1, TYPICAL: 1,
})
const EXPECTED_THREADED_NUMBERS = Object.freeze({
  BL02: [3, 4], BL03: [3, 4, 5, 6, 7, 8], BL04: [3, 4, 5, 6, 7, 8, 9, 10],
  BL05: [3, 4, 5, 6], BL06: [4, 5, 6], BL07: [3, 4, 5, 6, 7, 8], BL08: [2],
  BL09: [3, 4, 5], BL11: [3], BL12: [2], BL13: [3, 4, 5, 6, 7], BL14: [3],
  BL17: [3], BL18: [3, 4], BL19: [3], BL22: [2], BL23: [2], BL29: [3],
  BL31: [3], BL32: [2], BL40: [2], BL41: [2], BL48: [8, 9], BL49: [7, 8],
  CMA: [8, 9, 10, 11, 12, 13], CMB: [10, 11, 12, 13, 14], CMC: [16, 17, 18, 19],
  CMD: [1], CME: [1], CMH: [8, 9, 10],
  CMI: [23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42],
  CMJ: [8, 9, 10],
})
const EXPECTED_FAMILY_COUNTS = Object.freeze({
  'no-fitting': 2,
  'threaded-90-elbow': 57,
  'threaded-90-reducing-elbow': 6,
  'threaded-reducer': 30,
  'threaded-straight-tee': 4,
})
const EXPECTED_SIZE_COUNTS = Object.freeze({
  '1': 61,
  '1 x \u00bd': 16,
  '1 x \u00be': 20,
  none: 2,
})

const issue = (code, message, entityId = null) => ({ severity: 'blocking', code, message, entityId })
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const sorted = (values) => [...values].sort((a, b) => a.localeCompare(b))

function expectedWeldedIds() {
  return Object.entries(EXPECTED_WELDED_COUNTS).flatMap(([line, count]) =>
    line === 'TYPICAL'
      ? ['T-1']
      : (line === 'CMC' ? [1, 2, 3, 5, 6, 8, 9, 11, 12, 13, 14, 15] : Array.from({ length: count }, (_, index) => index + 1))
          .map((number) => `${line}.${String(number).padStart(2, '0')}`),
  )
}

function expectedThreadedIds() {
  return Object.entries(EXPECTED_THREADED_NUMBERS).flatMap(([line, numbers]) =>
    numbers.map((number) => `${line}.${String(number).padStart(2, '0')}`),
  )
}

function countBy(items, select) {
  return Object.fromEntries(
    [...items.reduce((counts, item) => {
      const key = select(item)
      counts.set(key, (counts.get(key) || 0) + 1)
      return counts
    }, new Map())].sort(([left], [right]) => left.localeCompare(right)),
  )
}

export function evaluateNewHopeFabricationEndSchedule(schedule = {}) {
  const issues = []
  const welded = schedule.weldedPieces || []
  const threaded = schedule.threadedPieces || []

  if (schedule.projectId !== EXPECTED_PROJECT_ID) {
    issues.push(issue('NH_FAB_END_PROJECT_IDENTITY_INVALID', 'The end schedule must identify New Hope.'))
  }
  if (schedule.artifactType !== 'halofire.new-hope-fabrication-end-schedule.v2') {
    issues.push(issue('NH_FAB_END_ARTIFACT_VERSION_INVALID', 'The exact-size schedule must use the v2 evidence contract.'))
  }
  if (
    schedule.source?.sha256 !== EXPECTED_SOURCE_SHA ||
    schedule.source?.fileName !== '24-052_NHCC_LIST.PDF' ||
    schedule.source?.pageCount !== 42 ||
    schedule.source?.software !== 'AutoSPRINK 2023 v18.1.44.0' ||
    schedule.source?.listingDate !== '2025-02-20'
  ) {
    issues.push(issue('NH_FAB_END_SOURCE_INVALID', 'The schedule must remain bound to the exact approved 42-page AutoSPRINK listing.'))
  }
  if (
    !same(schedule.coverage?.weldedPhysicalPages, [7, 39]) ||
    !same(schedule.coverage?.threadedPhysicalPages, [40, 42]) ||
    schedule.coverage?.weldedPieceDefinitionCount !== 158 ||
    schedule.coverage?.weldedFabricatedUnitCount !== 164 ||
    schedule.coverage?.threadedPieceDefinitionCount !== 99 ||
    schedule.coverage?.threadedFabricatedUnitCount !== 100 ||
    schedule.coverage?.totalListedPipePieceDefinitionCount !== 257 ||
    schedule.coverage?.totalFabricatedPipeUnitCount !== 264
  ) {
    issues.push(issue('NH_FAB_END_COVERAGE_INVALID', 'The listing must retain 257 piece definitions and 264 fabricated pipe units across pages 7-42.'))
  }
  const weldedIdentityValid = same(sorted(welded.map((piece) => piece.pieceId)), sorted(expectedWeldedIds()))
  const weldedCountsValid = same(countBy(welded, (piece) => piece.lineName), EXPECTED_WELDED_COUNTS)
  const weldedPropertiesValid = !welded.some((piece) =>
      !same(piece.endPreparation, ['G', 'G']) ||
      !same(piece.endFittingFamilies, ['no-fitting', 'no-fitting']) ||
      piece.quantity !== (['BL34.01', 'BL35.01', 'BL50.01', 'BL50.02'].includes(piece.pieceId) ? 2 : piece.pieceId === 'T-1' ? 3 : 1)
    )
  if (!weldedIdentityValid || !weldedCountsValid || !weldedPropertiesValid) {
    issues.push(issue('NH_FAB_END_WELDED_SCHEDULE_INVALID', 'All 158 welded definitions must retain exact identity, quantity, G-G preparation, and two listed No Fitting ends.', `identity=${weldedIdentityValid},counts=${weldedCountsValid},properties=${weldedPropertiesValid}`))
  }
  if (
    !same(sorted(threaded.map((piece) => piece.pieceId)), sorted(expectedThreadedIds())) ||
    !same(countBy(threaded, (piece) => piece.endPreparation.join('-')), { 'T-G': 1, 'T-T': 98 }) ||
    !same(countBy(threaded, (piece) => piece.endFittingFamily), EXPECTED_FAMILY_COUNTS) ||
    threaded.some((piece) => piece.quantity !== (piece.pieceId === 'CMD.01' ? 2 : 1))
  ) {
    issues.push(issue('NH_FAB_END_THREADED_SCHEDULE_INVALID', 'All 99 threaded definitions must retain exact identity, quantity, T-T/T-G preparation, and fitting family.'))
  }
  const threadedSizesValid =
    same(schedule.coverage?.threadedFittingSizeCounts, EXPECTED_SIZE_COUNTS) &&
    threaded.every((piece) => {
      if (piece.exactFittingSizeReady !== true) return false
      if (piece.endFittingFamily === 'no-fitting') {
        return piece.endFittingText === 'No Fitting' && piece.fittingSizeText === null && same(piece.nominalPortSizesIn, [])
      }
      if (piece.endFittingFamily === 'threaded-90-elbow') {
        return piece.fittingSizeText === '1' && same(piece.nominalPortSizesIn, [1, 1])
      }
      if (piece.endFittingFamily === 'threaded-straight-tee') {
        return piece.fittingSizeText === '1' && same(piece.nominalPortSizesIn, [1, 1, 1])
      }
      if (piece.endFittingFamily === 'threaded-reducer' || piece.endFittingFamily === 'threaded-90-reducing-elbow') {
        return (
          (piece.fittingSizeText === '1 x \u00bd' && same(piece.nominalPortSizesIn, [1, 0.5])) ||
          (piece.fittingSizeText === '1 x \u00be' && same(piece.nominalPortSizesIn, [1, 0.75]))
        )
      }
      return false
    }) &&
    schedule.extractionBoundary?.embeddedFractionGlyphsLossless === true &&
    same(schedule.extractionBoundary?.fractionCodePoints, { '\u00bc': 'U+00BC', '\u00bd': 'U+00BD', '\u00be': 'U+00BE' })
  if (!threadedSizesValid) {
    issues.push(issue('NH_FAB_END_THREADED_SIZES_INVALID', 'All 99 threaded definitions must retain their exact Unicode fraction, size text, and family-specific nominal port cardinality.'))
  }
  if (
    schedule.claims?.allListedPieceIdentitiesReady !== true ||
    schedule.claims?.allListedPieceEndPreparationsReady !== true ||
    schedule.claims?.allWeldedEndFittingFamiliesReady !== true ||
    schedule.claims?.allThreadedEndFittingFamiliesReady !== true ||
    schedule.claims?.exactThreadedFittingSizesReady !== true ||
    schedule.claims?.interPieceFittingTopologyReady !== false ||
    schedule.claims?.verticalOffsetScheduleReady !== false ||
    schedule.claims?.completeFittingScheduleReady !== false ||
    schedule.claims?.fabricationReady !== false ||
    schedule.claims?.fieldReleaseReady !== false
  ) {
    issues.push(issue('NH_FAB_END_FALSE_READINESS_PROMOTION', 'Exact listed fitting sizes cannot promote inter-piece topology, vertical offsets, fabrication, or field release.'))
  }

  const ready = issues.length === 0
  return {
    artifactType: 'halofire.new-hope-fabrication-end-schedule-result.v2',
    projectId: schedule.projectId,
    status: ready ? 'passed' : 'blocked',
    issues,
    blockerCodes: [...new Set(issues.map((entry) => entry.code))],
    source: ready ? schedule.source : null,
    coverage: ready ? schedule.coverage : null,
    allListedPieceIdentitiesReady: ready,
    allListedPieceEndPreparationsReady: ready,
    allWeldedEndFittingFamiliesReady: ready,
    allThreadedEndFittingFamiliesReady: ready,
    exactThreadedFittingSizesReady: ready && threadedSizesValid,
    interPieceFittingTopologyReady: false,
    verticalOffsetScheduleReady: false,
    completeFittingScheduleReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
  }
}

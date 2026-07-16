/**
 * Crosswalk New Hope's native AutoSPRINK hanger schedule to the exact
 * purchase-bound ASC Fig. 69 size variants. This proves per-line quantities
 * and catalog dimensions without inventing placement, threads, or solids.
 */

const EXPECTED_PROJECT_ID = 'new-hope-crisis-center-brigham-city-ut'
const EXPECTED_ARCHIVE_SHA = 'A449B6C8670CEE52955C3D3D57F8169E3091CFA34C943C6723785724F06DDED9'
const EXPECTED_MEMBER_SHA = '0B64077B62673459C11D2CBC303258C1DD3F0C75735A07BFFA903BAEE79D6135'

const SIZE_CODE_CROSSWALK = Object.freeze({
  13: { nominalPipeSizeIn: 1, productNumber: '0500301692', quantity: 25 },
  17: { nominalPipeSizeIn: 1.5, productNumber: '0500301742', quantity: 97 },
  21: { nominalPipeSizeIn: 2, productNumber: '0500301759', quantity: 14 },
  23: { nominalPipeSizeIn: 2.5, productNumber: '0500301767', quantity: 48 },
  25: { nominalPipeSizeIn: 3, productNumber: '0500301775', quantity: 28 },
})

const issue = (code, message, entityId = null) => ({
  severity: 'blocking',
  code,
  message,
  entityId,
})
const close = (left, right, tolerance = 1e-9) => Math.abs(Number(left) - Number(right)) <= tolerance

/**
 * @param {object} inputs
 * @param {object} inputs.schedule Native Project.seidb hanger rows.
 * @param {object} inputs.purchasedSupportComponents Quote and catalog evidence.
 */
export function evaluateNewHopeNativeHangerSchedule(inputs = {}) {
  const issues = []
  const { schedule, purchasedSupportComponents } = inputs
  if (
    schedule?.artifactType !== 'halofire.autosprink-native-fab-hanger-schedule.v1' ||
    schedule?.source?.archiveSha256 !== EXPECTED_ARCHIVE_SHA ||
    schedule?.source?.member !== 'Project.seidb' ||
    schedule?.source?.memberSha256 !== EXPECTED_MEMBER_SHA
  ) {
    issues.push(
      issue(
        'NH_NATIVE_HANGER_SOURCE_INVALID',
        'The hanger schedule must retain the protected New Hope FAB and Project.seidb identities.',
      ),
    )
  }
  if (purchasedSupportComponents?.projectId !== EXPECTED_PROJECT_ID) {
    issues.push(
      issue('NH_NATIVE_HANGER_PROJECT_INVALID', 'The purchase evidence must identify New Hope.'),
    )
  }

  const records = Array.isArray(schedule?.records) ? schedule.records : []
  const uniqueIds = new Set(records.map((record) => record.uniqueId))
  const rawScheduleReady =
    records.length === 76 &&
    uniqueIds.size === 76 &&
    records.every(
      (record) =>
        Number.isInteger(record.uniqueId) &&
        Number.isInteger(record.quantity) &&
        record.quantity > 0 &&
        record.itemCode === 2027 &&
        record.parentId === -1 &&
        record.descriptionCode === 0 &&
        close(record.lengthFt, 1) &&
        record.constructionId === 1 &&
        record.hangerTypeId === 1 &&
        record.hangerCode === '15W' &&
        close(record.extraRodLengthFt, 0) &&
        close(record.spanFt, 13 / 12) &&
        Object.hasOwn(SIZE_CODE_CROSSWALK, record.sizeCode),
    )
  if (!rawScheduleReady) {
    issues.push(
      issue(
        'NH_NATIVE_HANGER_RECORD_INVALID',
        'Project.seidb must retain all 76 native 15W schedule rows and their exact fabrication attributes.',
      ),
    )
  }

  const nativeQuantityBySizeCode = Object.fromEntries(
    Object.keys(SIZE_CODE_CROSSWALK).map((sizeCode) => [
      sizeCode,
      records
        .filter((record) => String(record.sizeCode) === sizeCode)
        .reduce((sum, record) => sum + Number(record.quantity || 0), 0),
    ]),
  )
  const sizeQuantityParityReady = Object.entries(SIZE_CODE_CROSSWALK).every(
    ([sizeCode, expected]) => nativeQuantityBySizeCode[sizeCode] === expected.quantity,
  )
  if (!sizeQuantityParityReady || Number(schedule?.metrics?.hangerQuantity) !== 212) {
    issues.push(
      issue(
        'NH_NATIVE_HANGER_SIZE_QUANTITY_INVALID',
        'Native size-code quantities must reconcile 25/97/14/48/28 and 212 total hangers.',
      ),
    )
  }

  const quoteHangers = (purchasedSupportComponents?.components || []).filter(
    (component) => component.family === 'ring-hanger',
  )
  const purchasedByProduct = new Map(
    quoteHangers.map((component) => [component.productNumber, component]),
  )
  const catalogCrosswalkReady = Object.values(SIZE_CODE_CROSSWALK).every((expected) => {
    const component = purchasedByProduct.get(expected.productNumber)
    const variant = component?.publishedVariants?.find((entry) =>
      close(entry.pipeSizeIn, expected.nominalPipeSizeIn),
    )
    return component?.quantity === expected.quantity && variant && close(variant.rodSizeAIn, 0.375)
  })
  if (!catalogCrosswalkReady || quoteHangers.length !== 5) {
    issues.push(
      issue(
        'NH_NATIVE_HANGER_CATALOG_CROSSWALK_INVALID',
        'Every native size code must map one-to-one to the quote-bound ASC Fig. 69 product and published nominal-size dimensions.',
      ),
    )
  }

  const falsePromotions = [
    schedule?.claims?.exactInstalledPlacementReady,
    schedule?.claims?.manufacturerPartSolidReady,
    schedule?.claims?.exactThreadGeometryReady,
    schedule?.claims?.matingAssemblyReady,
  ].some(Boolean)
  if (
    falsePromotions ||
    schedule?.claims?.nativeHangerScheduleReady !== true ||
    schedule?.claims?.nominalPipeSizeCrosswalkReady !== false
  ) {
    issues.push(
      issue(
        'NH_NATIVE_HANGER_FALSE_READINESS_PROMOTION',
        'The native table proves a schedule, not installed XYZ, manufacturer solids, thread geometry, or mating fit.',
      ),
    )
  }

  const assignments =
    rawScheduleReady && sizeQuantityParityReady && catalogCrosswalkReady
      ? records.map((record) => {
          const expected = SIZE_CODE_CROSSWALK[record.sizeCode]
          const component = purchasedByProduct.get(expected.productNumber)
          const publishedDimensions = component.publishedVariants.find((entry) =>
            close(entry.pipeSizeIn, expected.nominalPipeSizeIn),
          )
          return {
            nativeUniqueId: record.uniqueId,
            lineName: record.lineName,
            quantity: record.quantity,
            nativeSizeCode: record.sizeCode,
            nominalPipeSizeIn: expected.nominalPipeSizeIn,
            nativeHangerCode: record.hangerCode,
            nativeLengthFt: record.lengthFt,
            nativeSpanFt: record.spanFt,
            manufacturer: component.manufacturer,
            model: component.model,
            productNumber: component.productNumber,
            publishedDimensions,
          }
        })
      : []

  const scheduleCrosswalkReady = issues.length === 0 && assignments.length === 76
  return {
    artifactType: 'halofire.new-hope-native-hanger-schedule-result.v1',
    status: scheduleCrosswalkReady
      ? 'schedule-crosswalk-passed-installed-geometry-blocked'
      : 'blocked',
    issues,
    blockerCodes: issues.map((entry) => entry.code),
    metrics: {
      scheduleRowCount: records.length,
      nativeHangerQuantity: records.reduce((sum, record) => sum + Number(record.quantity || 0), 0),
      lineCount: new Set(records.map((record) => record.lineName)).size,
      nominalSizeCount: Object.keys(SIZE_CODE_CROSSWALK).length,
      purchaseBoundProductCount: quoteHangers.length,
      assignmentRowCount: assignments.length,
    },
    nativeHangerScheduleReady: scheduleCrosswalkReady,
    perLineNominalPipeSizeAssignmentReady: scheduleCrosswalkReady,
    purchaseBoundCatalogDimensionAssignmentReady: scheduleCrosswalkReady,
    assignments,
    exactInstalledPlacementReady: false,
    manufacturerPartSolidReady: false,
    exactThreadGeometryReady: false,
    matingAssemblyReady: false,
    supportModelReleaseReady: false,
  }
}

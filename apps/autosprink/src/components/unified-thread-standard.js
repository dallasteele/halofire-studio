const EXPECTED = Object.freeze({
  artifactType: 'halofire.unified-thread-limit-packet.v1',
  sourceSha256: '116D4FBD0C009B3B18C20487B3FAC87B69E17BEA808C7AC9CD140C8C4450720D',
  page: 61,
  printedPage: '2.27',
  table: '2.21',
  designation: '.375-16 UNC',
  nominalMajorDiameterIn: 0.375,
  tpi: 16,
  pitchIn: 0.0625,
  profileAngleDeg: 60,
  external2A: Object.freeze({
    allowanceIn: 0.0013,
    majorDiameterMaxIn: 0.3737,
    majorDiameterMinIn: 0.3643,
    majorDiameterMinRootReliefIn: 0.3595,
    pitchDiameterMaxIn: 0.3331,
    pitchDiameterMinIn: 0.3287,
    pitchDiameterToleranceIn: 0.0044,
    minorDiameterIn: 0.297,
  }),
  internal2B: Object.freeze({
    minorDiameterMinIn: 0.307,
    minorDiameterMaxIn: 0.321,
    pitchDiameterMinIn: 0.3344,
    pitchDiameterMaxIn: 0.3401,
    pitchDiameterToleranceIn: 0.0057,
    majorDiameterMinIn: 0.375,
  }),
})

const close = (left, right, tolerance = 1e-9) => (
  Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance
)

const SHA256_RE = /^[A-F0-9]{64}$/

const numericObjectMatches = (actual, expected) => (
  actual && Object.entries(expected).every(([key, value]) => close(actual[key], value))
)

/**
 * Verify the immutable source and tabulated limits used by the reusable
 * 3/8-16 UNC 2A/2B thread specimen. This is deliberately not a manufacturer
 * part verifier; it must fail if a caller attempts to promote the specimen to
 * a purchased part or project assembly.
 */
export function evaluateUnifiedThreadLimitPacket(packet = {}) {
  const issues = []
  const add = (code) => issues.push(code)
  const source = packet.source || {}
  const thread = packet.thread || {}
  const derived = packet.derived || {}
  const policy = packet.releasePolicy || {}

  if (
    packet.artifactType !== EXPECTED.artifactType ||
    packet.scope !== 'standards-specimen-only'
  ) add('UNIFIED_THREAD_PACKET_IDENTITY_INVALID')

  if (
    source.publisher !== 'United States Department of Commerce, National Bureau of Standards' ||
    source.edition !== '1969' ||
    source.pdfSha256 !== EXPECTED.sourceSha256 ||
    source.physicalPdfPage !== EXPECTED.page ||
    source.printedPage !== EXPECTED.printedPage ||
    source.table !== EXPECTED.table ||
    !/^https:\/\/nvlpubs\.nist\.gov\//.test(source.officialUrl || '')
  ) add('UNIFIED_THREAD_SOURCE_UNTRUSTED')

  if (
    thread.nominalDesignation !== EXPECTED.designation ||
    thread.hand !== 'right' ||
    !close(thread.nominalMajorDiameterIn, EXPECTED.nominalMajorDiameterIn) ||
    !close(thread.tpi, EXPECTED.tpi) ||
    !close(thread.pitchIn, EXPECTED.pitchIn) ||
    !close(thread.profileAngleDeg, EXPECTED.profileAngleDeg) ||
    !numericObjectMatches(thread.external2A, EXPECTED.external2A) ||
    !numericObjectMatches(thread.internal2B, EXPECTED.internal2B)
  ) add('UNIFIED_THREAD_TABLE_LIMITS_INVALID')

  const calculatedPitch = 1 / thread.tpi
  const pitchDiameterClearance = (
    thread.internal2B?.pitchDiameterMinIn - thread.external2A?.pitchDiameterMaxIn
  )
  if (
    !close(calculatedPitch, thread.pitchIn) ||
    !close(derived.leadIn, calculatedPitch) ||
    !close(pitchDiameterClearance, thread.external2A?.allowanceIn) ||
    !close(derived.minimumPitchDiameterClearanceIn, pitchDiameterClearance) ||
    !close(derived.minimumPitchRadiusClearanceIn, pitchDiameterClearance / 2) ||
    !close(derived.maximumMaterialExternalMajorDiameterIn, thread.external2A?.majorDiameterMaxIn) ||
    !close(derived.maximumMaterialInternalMinorDiameterIn, thread.internal2B?.minorDiameterMinIn)
  ) add('UNIFIED_THREAD_DERIVATION_INVALID')

  if (
    policy.manufacturerPartNumber !== null ||
    policy.manufacturerPartEligible !== false ||
    policy.projectAssemblyEligible !== false ||
    policy.newHopePartEligible !== false ||
    typeof policy.reason !== 'string' ||
    policy.reason.length < 80
  ) add('UNIFIED_THREAD_FALSE_PRODUCT_PROMOTION')

  return {
    status: issues.length === 0 ? 'passed' : 'blocked',
    issues,
    metrics: {
      pitchIn: Number.isFinite(calculatedPitch) ? calculatedPitch : null,
      minimumPitchDiameterClearanceIn: Number.isFinite(pitchDiameterClearance)
        ? pitchDiameterClearance
        : null,
      minimumPitchRadiusClearanceIn: Number.isFinite(pitchDiameterClearance)
        ? pitchDiameterClearance / 2
        : null,
    },
    standardsSpecimenReady: issues.length === 0,
    manufacturerPartEligible: false,
    projectAssemblyEligible: false,
  }
}

/** Verify a receipt emitted by the OpenCascade specimen builder. */
export function evaluateUnifiedThreadKernelReceipt(receipt = {}) {
  const issues = []
  const add = (code) => issues.push(code)
  const source = receipt.source || {}
  const kernel = receipt.kernel || {}
  const thread = receipt.thread || {}
  const topology = receipt.topology || {}
  const placement = receipt.placement || {}
  const policy = receipt.releasePolicy || {}
  const outputs = Array.isArray(receipt.outputs) ? receipt.outputs : []

  if (
    receipt.artifactType !== 'halofire.opencascade-unified-thread-specimen-receipt.v1' ||
    receipt.scope !== 'standards-specimen-only' ||
    source.pdfSha256 !== EXPECTED.sourceSha256 ||
    source.physicalPdfPage !== EXPECTED.page ||
    source.printedPage !== EXPECTED.printedPage ||
    source.table !== EXPECTED.table
  ) add('UNIFIED_THREAD_KERNEL_SOURCE_INVALID')

  if (
    kernel.name !== 'OpenCascade via FreeCAD' ||
    !Array.isArray(kernel.freecadVersion) ||
    kernel.freecadVersion.length < 3 ||
    kernel.modelUnits !== 'millimeter' ||
    kernel.inputUnits !== 'inch'
  ) add('UNIFIED_THREAD_KERNEL_IDENTITY_INVALID')

  const expectedLimits = {
    external2A: {
      majorDiameterMaxIn: EXPECTED.external2A.majorDiameterMaxIn,
      pitchDiameterMaxIn: EXPECTED.external2A.pitchDiameterMaxIn,
      minorDiameterIn: EXPECTED.external2A.minorDiameterIn,
    },
    internal2B: {
      minorDiameterMinIn: EXPECTED.internal2B.minorDiameterMinIn,
      pitchDiameterMinIn: EXPECTED.internal2B.pitchDiameterMinIn,
      majorDiameterMinIn: EXPECTED.internal2B.majorDiameterMinIn,
    },
  }
  if (
    thread.designation !== '.375-16 UNC 2A/2B' ||
    thread.hand !== 'right' ||
    thread.modeledHelicalSolid !== true ||
    !close(thread.tpi, EXPECTED.tpi) ||
    !close(thread.pitchIn, EXPECTED.pitchIn) ||
    !close(thread.leadIn, EXPECTED.pitchIn) ||
    !numericObjectMatches(thread.limits?.external2A, expectedLimits.external2A) ||
    !numericObjectMatches(thread.limits?.internal2B, expectedLimits.internal2B) ||
    !close(thread.minimumPitchDiameterClearanceIn, 0.0013) ||
    !close(thread.minimumPitchRadiusClearanceIn, 0.00065)
  ) add('UNIFIED_THREAD_KERNEL_THREAD_INVALID')

  if (
    topology.maleSolidCount !== 1 ||
    topology.femaleSolidCount !== 1 ||
    topology.maleShellCount !== 1 ||
    topology.femaleShellCount !== 1 ||
    !(topology.maleVolumeMm3 > 0) ||
    !(topology.femaleVolumeMm3 > 0) ||
    !(topology.assembledInterferenceToleranceMm3 > 0) ||
    topology.assembledInterferenceToleranceMm3 > 1e-5 ||
    !(topology.assembledCommonVolumeMm3 >= 0) ||
    topology.assembledCommonVolumeMm3 > topology.assembledInterferenceToleranceMm3 ||
    topology.assembledInterferenceFree !== true
  ) add('UNIFIED_THREAD_KERNEL_TOPOLOGY_INVALID')

  if (
    !close(placement.femaleOffsetIn, 0.125) ||
    !close(placement.femaleOffsetPitchCount, 2) ||
    placement.helicalPhasePreserved !== true
  ) add('UNIFIED_THREAD_KERNEL_PLACEMENT_INVALID')

  const requiredSuffixes = ['.FCStd', '-male.step', '-female.step', '-assembly.step', '-male.stl', '-female.stl']
  if (
    outputs.length !== requiredSuffixes.length ||
    !requiredSuffixes.every((suffix) => outputs.some((output) => output.file?.endsWith(suffix))) ||
    !outputs.every((output) => (
      typeof output.file === 'string' &&
      Number.isInteger(output.byteLength) &&
      output.byteLength > 0 &&
      SHA256_RE.test(output.sha256 || '')
    ))
  ) add('UNIFIED_THREAD_KERNEL_OUTPUT_MANIFEST_INVALID')

  if (
    policy.manufacturerPartEligible !== false ||
    policy.projectAssemblyEligible !== false ||
    policy.newHopePartEligible !== false
  ) add('UNIFIED_THREAD_KERNEL_FALSE_PRODUCT_PROMOTION')

  return {
    status: issues.length === 0 ? 'passed' : 'blocked',
    issues,
    helicalBrepReady: issues.length === 0,
    interferenceFreeAtAuditedPlacement: issues.length === 0,
    manufacturerPartEligible: false,
    projectAssemblyEligible: false,
  }
}

export { EXPECTED as UNIFIED_THREAD_375_16_EXPECTED }

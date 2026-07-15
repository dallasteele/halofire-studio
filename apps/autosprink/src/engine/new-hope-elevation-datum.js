/**
 * Registers approved AutoSPRINK calculation elevations to New Hope's project datum.
 *
 * Inputs are the source-audited FP0.1/FP2.0/A102 datum packet and the three
 * approved hydraulic route packets. The output converts every plan-bound
 * calculation-node elevation from finished-floor-local feet to architectural
 * project elevation while preserving coincident XY ports as separate Z values.
 *
 * Limitations: this gate does not infer elevation for unbound plan nodes, does
 * not turn roof heights or piece lengths into pipe-centerline Z, and does not
 * assign a pipe to a roof region without direct source geometry. It establishes
 * a coordinate system, not a fabrication-complete 3D model.
 */

const PROJECT_ID = 'new-hope-crisis-center-brigham-city-ut'
const PLAN_SHA = '5A770222363228C2766605A695FEE9B6CB1F7B49C296204E09B691100253D9D5'
const CALC_SHA = 'D70FA475A0DD32B22B134D2D6161435D9E769D659B320C6F25A3D908AE70D719'
const CEILING_SHA = 'A32CF45D59635ABA9E40EDFE7754F1721763659D48766B35A8917EC167FF7794'
const ARCH_SHA = '9F9F8B97CFB35931474566156F35D97520AE993052DAC046EFACB408F32EA0A7'
const EXPECTED_ROOF_ELEVATIONS = Object.freeze([
  16,
  17.416667,
  18.208333,
  20.083333,
  21.208333,
  23.041667,
])

const blockingIssue = (code, message, entityId = null) => ({
  severity: 'blocking',
  code,
  message,
  entityId,
})

const sortedNumbers = (values) => [...values].sort((a, b) => a - b)
const round = (value) => Number(value.toFixed(6))

function collectRegisteredPorts(hydraulicRoutes, datumFt, issues) {
  const ports = new Map()
  for (const route of hydraulicRoutes || []) {
    if (
      route?.projectId !== PROJECT_ID ||
      route?.sourceBindings?.approvedPlan?.sha256 !== PLAN_SHA ||
      route?.sourceBindings?.hydraulicCalculation?.sha256 !== CALC_SHA
    ) {
      issues.push(
        blockingIssue(
          'NH_DATUM_HYDRAULIC_SOURCE_INVALID',
          'Every route must remain bound to the exact approved plan and calculation.',
          route?.remoteAreaId || null,
        ),
      )
      continue
    }
    const canonicalByCalculationNode = new Map(
      (route.planNodeBindings || []).map((binding) => [
        binding.calculationNodeId,
        binding.canonicalNodeId,
      ]),
    )
    for (const leg of route.pipeTableLegs || []) {
      for (const [calculationNodeId, localElevationFt] of [
        [leg.node1, leg.elevation1Ft],
        [leg.node2, leg.elevation2Ft],
      ]) {
        const canonicalNodeId = canonicalByCalculationNode.get(calculationNodeId)
        if (!canonicalNodeId || !Number.isFinite(localElevationFt)) continue
        const key = `${canonicalNodeId}|${calculationNodeId}`
        const next = {
          canonicalNodeId,
          calculationNodeId,
          autosprinkLocalElevationFt: localElevationFt,
          architecturalProjectElevationFt: round(datumFt + localElevationFt),
          remoteAreaIds: [route.remoteAreaId],
        }
        const existing = ports.get(key)
        if (existing && existing.autosprinkLocalElevationFt !== localElevationFt) {
          issues.push(
            blockingIssue(
              'NH_DATUM_CALCULATION_ELEVATION_CONFLICT',
              'A repeated approved calculation port changed elevation.',
              key,
            ),
          )
        } else if (existing) {
          existing.remoteAreaIds = [...new Set([...existing.remoteAreaIds, route.remoteAreaId])].sort()
        } else {
          ports.set(key, next)
        }
      }
    }
  }
  return [...ports.values()].sort(
    (a, b) =>
      a.canonicalNodeId.localeCompare(b.canonicalNodeId) ||
      a.calculationNodeId.localeCompare(b.calculationNodeId),
  )
}

/**
 * Evaluate New Hope's calculation-to-architecture elevation registration.
 *
 * @param {object} datumPacket - Source-audited project datum and roof-region packet.
 * @param {object[]} hydraulicRoutes - Approved RA2-1, RA2-2, and RA2-3 bindings.
 * @returns {object} Datum integrity, registered exact ports, and fail-closed modeling rules.
 */
export function evaluateNewHopeElevationDatum(datumPacket = {}, hydraulicRoutes = []) {
  const issues = []
  const bindings = datumPacket?.sourceBindings || {}
  if (datumPacket?.artifactType !== 'halofire.new-hope-approved-elevation-datum.v1' || datumPacket?.projectId !== PROJECT_ID) {
    issues.push(blockingIssue('NH_DATUM_IDENTITY_INVALID', 'The elevation datum packet identity changed.'))
  }
  if (
    bindings?.approvedPlan?.sha256 !== PLAN_SHA ||
    bindings?.ceilingDatumPlan?.sha256 !== CEILING_SHA ||
    bindings?.architecturalBidSet?.sha256 !== ARCH_SHA ||
    bindings?.approvedHydraulicCalculation?.sha256 !== CALC_SHA
  ) {
    issues.push(blockingIssue('NH_DATUM_SOURCE_IDENTITY_INVALID', 'One or more protected elevation sources changed.'))
  }
  if (
    bindings?.approvedPlan?.elevationLegend?.aboveFinishedFloorText !== 'PIPE ELEV. ABOVE FINISHED FLOOR' ||
    bindings?.approvedPlan?.elevationLegend?.belowRoofDeckText !== 'PIPE ELEV. BELOW ROOF DECK' ||
    bindings?.ceilingDatumPlan?.generalNoteNumber !== 8 ||
    !bindings?.ceilingDatumPlan?.generalNote?.includes("100'-0")
  ) {
    issues.push(blockingIssue('NH_DATUM_SOURCE_SEMANTICS_INVALID', 'The finished-floor and below-deck source semantics changed.'))
  }
  const verticalDatum = datumPacket?.verticalDatum || {}
  if (
    verticalDatum.architecturalProjectElevationFt !== 100 ||
    verticalDatum.autosprinkLocalElevationFt !== 0 ||
    verticalDatum.conversion !== 'architecturalProjectElevationFt = 100 + autosprinkLocalElevationFt'
  ) {
    issues.push(blockingIssue('NH_DATUM_TRANSFORM_INVALID', 'The approved 100-foot finished-floor transform changed.'))
  }
  const roofElevations = sortedNumbers(
    new Set((datumPacket?.roofRegions || []).map((region) => region.localElevationFt)),
  )
  if (JSON.stringify(roofElevations) !== JSON.stringify(EXPECTED_ROOF_ELEVATIONS)) {
    issues.push(blockingIssue('NH_DATUM_ROOF_REGION_INVENTORY_INVALID', 'FP2.0 must retain all six distinct roof ridge elevations.'))
  }
  const rules = datumPacket?.modelingRules || {}
  if (
    rules.globalRoofPlaneAllowed !== false ||
    rules.roofRegionAssignmentRequiredBeforeRoofClearance !== true ||
    rules.pieceLengthMayBeUsedAsElevation !== false ||
    rules.belowDeckTagMayBeUsedAsFinishedFloorElevation !== false ||
    rules.hydraulicNodeElevationMayBePropagatedWithoutSourceBoundPath !== false
  ) {
    issues.push(blockingIssue('NH_DATUM_FAIL_CLOSED_RULE_INVALID', 'A source-separation or multi-roof fail-closed rule was weakened.'))
  }
  const registeredPorts = collectRegisteredPorts(
    hydraulicRoutes,
    verticalDatum.architecturalProjectElevationFt,
    issues,
  )
  if (registeredPorts.length !== 32 || new Set(registeredPorts.map((port) => port.canonicalNodeId)).size !== 31) {
    issues.push(blockingIssue('NH_DATUM_REGISTERED_PORT_COVERAGE_DRIFT', 'The approved datum must retain 32 ports on 31 canonical nodes.'))
  }
  const routeIds = [...new Set((hydraulicRoutes || []).map((route) => route.remoteAreaId))].sort()
  if (JSON.stringify(routeIds) !== JSON.stringify(['2-1', '2-2', '2-3'])) {
    issues.push(blockingIssue('NH_DATUM_REMOTE_AREA_SET_INVALID', 'The datum registration requires all three approved remote areas.'))
  }
  const ready = issues.length === 0
  return {
    artifactType: 'halofire.new-hope-elevation-datum-result.v1',
    projectId: datumPacket?.projectId,
    status: ready ? 'passed' : 'blocked',
    issues,
    blockerCodes: [...new Set(issues.map((entry) => entry.code))],
    verticalDatum,
    roofRegions: datumPacket?.roofRegions || [],
    registeredPorts,
    metrics: {
      roofRegionCount: (datumPacket?.roofRegions || []).length,
      distinctRoofRidgeElevationCount: roofElevations.length,
      registeredPortCount: registeredPorts.length,
      registeredCanonicalNodeCount: new Set(registeredPorts.map((port) => port.canonicalNodeId)).size,
      minimumArchitecturalProjectElevationFt: registeredPorts.length
        ? Math.min(...registeredPorts.map((port) => port.architecturalProjectElevationFt))
        : null,
      maximumArchitecturalProjectElevationFt: registeredPorts.length
        ? Math.max(...registeredPorts.map((port) => port.architecturalProjectElevationFt))
        : null,
    },
    finishedFloorDatumReady: ready,
    calculationToArchitecturalDatumRegistrationReady: ready,
    multiRoofRegionControlReady: ready,
    unboundNodeElevationPropagationAllowed: false,
    exactPipeCenterlineZReady: false,
    fabricationReady: false,
  }
}

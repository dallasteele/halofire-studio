/**
 * Validates the approved New Hope source-feed calculation/device chain.
 *
 * The hydraulic report proves exact calculation-node elevations and the
 * device sequence from node 118 to the base of riser and downstream valves.
 * It does not prove the concealed plan XY route, the decomposition of the
 * hydraulic length into fabrication pieces, or a continuously graded run.
 */

const EXPECTED_PROJECT_ID = 'new-hope-crisis-center-brigham-city-ut'
const EXPECTED_CALC_SHA = 'D70FA475A0DD32B22B134D2D6161435D9E769D659B320C6F25A3D908AE70D719'
const EXPECTED_REMOTE_AREA_IDS = Object.freeze(['2-1', '2-2', '2-3'])
const EXPECTED_SOURCE_PAGES = Object.freeze({
  '2-1': Object.freeze([15, 16]),
  '2-2': Object.freeze([23, 24, 25]),
  '2-3': Object.freeze([31, 32]),
})
const REQUIRED_EXTERNAL_NODE_IDS = Object.freeze(['414', '560', '554', '25', '1'])
const EXPECTED_LEGS = Object.freeze([
  Object.freeze({
    node1: '118', node2: '414', elevation1Ft: 11.5, elevation2Ft: 5.458333,
    nominalDiameterIn: 4, actualDiameterIn: 4.26, lengthFt: 8.416667,
    cFactor: 100, fittingEquivalentLengthFt: 6.375, noteTokens: ['fE', 'DPV', 'BOR'],
  }),
  Object.freeze({
    node1: '414', node2: '560', elevation1Ft: 5.458333, elevation2Ft: 4.625,
    nominalDiameterIn: 4, actualDiameterIn: 4.26, lengthFt: 0,
    cFactor: 100, fittingEquivalentLengthFt: 11.25, noteTokens: ['BV'],
  }),
  Object.freeze({
    node1: '560', node2: '554', elevation1Ft: 4.625, elevation2Ft: 1.166667,
    nominalDiameterIn: 4, actualDiameterIn: 4.26, lengthFt: 0,
    cFactor: 120, fittingEquivalentLengthFt: 6.791667, noteTokens: ['Tr', 'BFP'],
  }),
])

const issue = (code, message, entityId = null) => ({ severity: 'blocking', code, message, entityId })
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right)

export function evaluateNewHopeSourceFeedCalculationChain(inputs = {}) {
  const issues = []
  const { hydraulicRoutes = [], sourceFeedFabrication } = inputs

  if (sourceFeedFabrication?.projectId !== EXPECTED_PROJECT_ID || sourceFeedFabrication?.status !== 'passed') {
    issues.push(issue('NH_SOURCE_CHAIN_FABRICATION_BINDING_BLOCKED', 'The source-bound CML.01 outlet registration must pass first.'))
  }
  if (
    sourceFeedFabrication?.outlet?.canonicalNodeId !== 'canonical-node-002' ||
    sourceFeedFabrication?.outlet?.calculationNodeId !== '118' ||
    sourceFeedFabrication?.outlet?.localElevationFt !== 11.5
  ) {
    issues.push(issue('NH_SOURCE_CHAIN_NODE_118_BINDING_INVALID', 'The chain must start at plan-bound calculation node 118 at local Z 11.5 feet.', '118'))
  }

  const orderedRoutes = [...hydraulicRoutes].sort((a, b) => a.remoteAreaId.localeCompare(b.remoteAreaId))
  if (!equal(orderedRoutes.map((route) => route.remoteAreaId), EXPECTED_REMOTE_AREA_IDS)) {
    issues.push(issue('NH_SOURCE_CHAIN_REMOTE_AREA_SET_INVALID', 'RA2-1, RA2-2, and RA2-3 must all repeat the source-feed calculation chain.'))
  }

  for (const route of orderedRoutes) {
    const source = route.sourceBindings?.hydraulicCalculation
    if (
      route.projectId !== EXPECTED_PROJECT_ID ||
      source?.sha256 !== EXPECTED_CALC_SHA ||
      !equal(source?.physicalPages, EXPECTED_SOURCE_PAGES[route.remoteAreaId]) ||
      source?.software !== 'AutoSPRINK 2023 v18.1.44.0' ||
      source?.calculationDate !== '2025-01-29'
    ) {
      issues.push(issue('NH_SOURCE_CHAIN_CALCULATION_SOURCE_INVALID', 'Every repeated chain must remain bound to the exact approved New Hope hydraulic report.', route.remoteAreaId))
    }
    if (
      route.calculationDirection !== 'remote-terminal-to-water-source' ||
      route.physicalFlowDirection !== 'water-source-to-remote-terminal' ||
      !REQUIRED_EXTERNAL_NODE_IDS.every((nodeId) => route.externalNodeIds?.includes(nodeId))
    ) {
      issues.push(issue('NH_SOURCE_CHAIN_DIRECTION_OR_NODE_SET_INVALID', 'Calculation direction, physical flow direction, and external device-node identities must remain distinct and exact.', route.remoteAreaId))
    }
    const legs = EXPECTED_LEGS.map((expected) =>
      route.pipeTableLegs?.find((leg) => leg.node1 === expected.node1 && leg.node2 === expected.node2),
    )
    EXPECTED_LEGS.forEach((expected, index) => {
      const leg = legs[index]
      const { noteTokens, ...expectedValues } = expected
      const actual = leg
        ? Object.fromEntries(Object.keys(expectedValues).map((key) => [key, leg[key]]))
        : null
      if (!equal(actual, expectedValues) || noteTokens.some((token) => !leg?.notes?.includes(token))) {
        issues.push(issue('NH_SOURCE_CHAIN_LEG_INVALID', 'The approved source-feed calculation leg or device semantics drifted.', `${route.remoteAreaId}:${expected.node1}-${expected.node2}`))
      }
    })
  }

  const ready = issues.length === 0
  return {
    artifactType: 'halofire.new-hope-source-feed-calculation-chain-result.v1',
    projectId: sourceFeedFabrication?.projectId,
    status: ready ? 'passed' : 'blocked',
    issues,
    blockerCodes: [...new Set(issues.map((entry) => entry.code))],
    source: ready ? {
      sha256: EXPECTED_CALC_SHA,
      physicalPagesByRemoteArea: EXPECTED_SOURCE_PAGES,
      software: 'AutoSPRINK 2023 v18.1.44.0',
      calculationDate: '2025-01-29',
      repeatedRemoteAreaIds: EXPECTED_REMOTE_AREA_IDS,
    } : null,
    calculationPorts: ready ? [
      { calculationNodeId: '118', canonicalNodeId: 'canonical-node-002', localElevationFt: 11.5, planBound: true },
      { calculationNodeId: '414', localElevationFt: 5.458333, planBound: false, deviceRole: 'base-of-riser' },
      { calculationNodeId: '560', localElevationFt: 4.625, planBound: false, deviceRole: 'butterfly-valve' },
      { calculationNodeId: '554', localElevationFt: 1.166667, planBound: false, deviceRole: 'backflow-preventer' },
    ] : [],
    calculationLegs: ready ? EXPECTED_LEGS.map(({ noteTokens, ...leg }) => ({ ...leg, noteTokens })) : [],
    sourceOutletToBaseOfRiserDeltaZFt: ready ? 6.041667 : null,
    sourceOutletToBaseOfRiserPhysicalLengthFt: ready ? 8.416667 : null,
    calculationChainReady: ready,
    sourceOutletToBaseOfRiserLegReady: ready,
    baseOfRiserEndpointZReady: ready,
    dryPipeValveIdentityReady: ready,
    downstreamValveBackflowElevationChainReady: ready,
    exactCalculationElevationPortCount: ready ? 4 : 0,
    exactPlanBoundCalculationPortCount: ready ? 1 : 0,
    exactExternalCalculationPortCount: ready ? 3 : 0,
    concealedPlanXyReady: false,
    fabricationPieceToCalculationLegDecompositionReady: false,
    installedGradeReady: false,
    sourceFeed3dPathReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
  }
}

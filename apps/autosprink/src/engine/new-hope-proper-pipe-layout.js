/**
 * Governing acceptance contract for the New Hope pitched-roof pipe layout.
 *
 * Inputs are the source-canonical FP2.0 graph, the independently evaluated
 * branch/cross-main/arm-over drainage schedules, the approved hydraulic-table
 * bindings, and the A201/A301 architectural vertical-control result. The
 * output separates evidence integrity from release readiness, inventories
 * every directed edge and exact calculation-elevation port, and names every
 * remaining blocker that prevents a proper plan/elevation/3D pipe layout.
 *
 * Known limitations: approved calculations anchor only a subset of the plan
 * graph; the registered calculation datum still does not establish Z for the
 * remaining plan nodes, the source-feed transition, the field-routed drum-drip
 * drains, or a complete fitting schedule. This module therefore never invents
 * pipe Z from roof Z and never treats hydraulic flow as drainage grade.
 */

const EXPECTED_PROJECT_ID = 'new-hope-crisis-center-brigham-city-ut'
const EXPECTED_PLAN_SHA = '5A770222363228C2766605A695FEE9B6CB1F7B49C296204E09B691100253D9D5'
const EXPECTED_UNDIRECTED_EDGE_IDS = Object.freeze([
  'source-edge-001',
  'source-edge-002',
])
const EXPECTED_SUPPLY_EDGE_IDS = Object.freeze(['source-edge-001', 'source-edge-002'])
const EXPECTED_LOW_POINT_ZONE_EDGE_IDS = Object.freeze(['source-edge-054'])

const issue = (code, message, entityId = null) => ({
  severity: 'blocking',
  code,
  message,
  entityId,
})
const round = (value, digits = 6) => (Number.isFinite(value) ? Number(value.toFixed(digits)) : null)
const sorted = (values) => [...values].sort()

function directionalGroups(inputs) {
  return [
    [
      'long-branch',
      inputs.longBranchDrainage?.branchSystems?.flatMap((system) => system.directedEdges) || [],
    ],
    [
      'side-branch',
      inputs.sideBranchDrainage?.branchSystems?.flatMap(
        (system) => system.directedBranchLineEdges,
      ) || [],
    ],
    ['cross-main', inputs.crossMainDrainage?.directedEdges || []],
    ['central-branch', inputs.centralBranchDrainage?.directedEdges || []],
    ['arm-over', inputs.armOverDrainage?.directedEdges || []],
    ['low-point-connector', inputs.lowPointFabrication?.directedEdge ? [inputs.lowPointFabrication.directedEdge] : []],
  ]
}

function collectDirections(inputs, issues) {
  const directionByEdgeId = new Map()
  const scheduleCounts = {}
  for (const [schedule, edges] of directionalGroups(inputs)) {
    scheduleCounts[schedule] = edges.length
    for (const edge of edges) {
      const existing = directionByEdgeId.get(edge.edgeId)
      const next = {
        edgeId: edge.edgeId,
        schedule,
        highNodeId: edge.highNodeId,
        lowNodeId: edge.lowNodeId,
        requiredDropIn: edge.requiredDropIn,
      }
      if (
        existing &&
        (existing.highNodeId !== next.highNodeId || existing.lowNodeId !== next.lowNodeId)
      ) {
        issues.push(
          issue(
            'NH_PROPER_PIPE_DIRECTION_CONFLICT',
            'One canonical pipe edge received conflicting drainage directions.',
            edge.edgeId,
          ),
        )
      } else if (existing) {
        issues.push(
          issue(
            'NH_PROPER_PIPE_DIRECTION_DUPLICATE',
            'One canonical pipe edge was assigned by more than one drainage schedule.',
            edge.edgeId,
          ),
        )
      } else {
        directionByEdgeId.set(edge.edgeId, next)
      }
    }
  }
  return { directionByEdgeId, scheduleCounts }
}

function collectElevationPorts(hydraulicRoutes, issues) {
  const portByCanonicalAndCalculationNode = new Map()
  for (const route of hydraulicRoutes || []) {
    const bindingByCalculationNode = new Map(
      (route.planNodeBindings || []).map((binding) => [
        binding.calculationNodeId,
        binding.canonicalNodeId,
      ]),
    )
    for (const leg of route.pipeTableLegs || []) {
      for (const [calculationNodeId, elevationFt] of [
        [leg.node1, leg.elevation1Ft],
        [leg.node2, leg.elevation2Ft],
      ]) {
        const canonicalNodeId = bindingByCalculationNode.get(calculationNodeId)
        if (!canonicalNodeId || !Number.isFinite(elevationFt)) continue
        const key = `${canonicalNodeId}|${calculationNodeId}`
        const existing = portByCanonicalAndCalculationNode.get(key)
        if (existing && existing.elevationFt !== elevationFt) {
          issues.push(
            issue(
              'NH_PROPER_PIPE_CALCULATION_ELEVATION_CONFLICT',
              'Repeated approved calculation nodes must retain one exact elevation.',
              key,
            ),
          )
          continue
        }
        if (existing) {
          existing.remoteAreaIds = sorted(new Set([...existing.remoteAreaIds, route.remoteAreaId]))
          continue
        }
        portByCanonicalAndCalculationNode.set(key, {
          canonicalNodeId,
          calculationNodeId,
          elevationFt,
          remoteAreaIds: [route.remoteAreaId],
          evidenceKind: 'approved-hydraulic-calculation-endpoint',
        })
      }
    }
  }
  const ports = [...portByCanonicalAndCalculationNode.values()].sort(
    (a, b) =>
      a.canonicalNodeId.localeCompare(b.canonicalNodeId) ||
      a.calculationNodeId.localeCompare(b.calculationNodeId),
  )
  const portsByCanonicalNode = new Map()
  for (const port of ports) {
    if (!portsByCanonicalNode.has(port.canonicalNodeId))
      portsByCanonicalNode.set(port.canonicalNodeId, [])
    portsByCanonicalNode.get(port.canonicalNodeId).push(port)
  }
  return { ports, portsByCanonicalNode }
}

/**
 * Evaluates the complete New Hope FP2.0 plan/elevation/3D pipe-layout contract.
 * Validation `status` reports whether the supplied evidence agrees with itself;
 * `properPipeLayoutReady` remains a separate, stricter release decision.
 *
 * @param {object} inputs - Source graph and independently evaluated layout evidence.
 * @param {object} inputs.pipeVectors - Approved FP2.0 vector extraction.
 * @param {object} inputs.canonicalTopology - Canonical FP2.0 node/edge graph.
 * @param {object} inputs.governedSkeleton - Source role and fabrication bindings.
 * @param {object[]} inputs.hydraulicRoutes - Three approved calculation evidence packets.
 * @param {object} inputs.hydraulicRouteSet - Evaluated calculation route set.
 * @param {object} inputs.architecturalVerticalControls - Evaluated A201/A301 controls.
 * @param {object} inputs.elevationDatum - Evaluated FP0.1/A102/calculation datum registration.
 * @param {object} inputs.sourceFeedFabrication - Evaluated CML.01 plan/listing/outlet registration.
 * @param {object} inputs.lowPointFabrication - Evaluated CMI.09 low-point/listing/grade registration.
 * @param {object} inputs.operationalAnnotations - Source notes, grades, drains, and details.
 * @param {object} inputs.longBranchDrainage - Long-branch drainage schedule.
 * @param {object} inputs.sideBranchDrainage - Side-branch drainage schedule.
 * @param {object} inputs.crossMainDrainage - Cross-main drainage schedule.
 * @param {object} inputs.centralBranchDrainage - Central-loop drainage schedule.
 * @param {object} inputs.armOverDrainage - Arm-over drainage schedule.
 * @returns {object} Evidence validation, coverage metrics, exact Z ports, and release blockers.
 */
export function evaluateNewHopeProperPipeLayout(inputs = {}) {
  const issues = []
  const {
    pipeVectors,
    canonicalTopology,
    governedSkeleton,
    hydraulicRoutes = [],
    hydraulicRouteSet,
    architecturalVerticalControls,
    elevationDatum,
    sourceFeedFabrication,
    lowPointFabrication,
    operationalAnnotations,
    longBranchDrainage,
    sideBranchDrainage,
    crossMainDrainage,
    centralBranchDrainage,
    armOverDrainage,
  } = inputs

  const projectIds = [
    pipeVectors,
    canonicalTopology,
    governedSkeleton,
    hydraulicRouteSet,
    architecturalVerticalControls,
    elevationDatum,
    sourceFeedFabrication,
    lowPointFabrication,
    operationalAnnotations,
  ].map((entry) => entry?.projectId)
  if (projectIds.some((projectId) => projectId !== EXPECTED_PROJECT_ID)) {
    issues.push(
      issue(
        'NH_PROPER_PIPE_PROJECT_IDENTITY_INVALID',
        'Every layout input must identify the New Hope project.',
      ),
    )
  }
  if (
    pipeVectors?.source?.sha256 !== EXPECTED_PLAN_SHA ||
    pipeVectors?.source?.sheet !== 'FP2.0' ||
    pipeVectors?.source?.physicalPage !== 5
  ) {
    issues.push(
      issue(
        'NH_PROPER_PIPE_PLAN_SOURCE_INVALID',
        'The pipe layout must remain bound to the exact approved FP2.0 source page.',
      ),
    )
  }
  const requiredEvaluations = [
    ['governed-skeleton', governedSkeleton?.status],
    ['hydraulic-route-set', hydraulicRouteSet?.status],
    ['architectural-vertical-controls', architecturalVerticalControls?.status],
    ['calculation-elevation-datum', elevationDatum?.status],
    ['source-feed-fabrication', sourceFeedFabrication?.status],
    ['low-point-fabrication', lowPointFabrication?.status],
    ['long-branch-drainage', longBranchDrainage?.status],
    ['side-branch-drainage', sideBranchDrainage?.status],
    ['cross-main-drainage', crossMainDrainage?.status],
    ['central-branch-drainage', centralBranchDrainage?.status],
    ['arm-over-drainage', armOverDrainage?.status],
  ]
  for (const [id, status] of requiredEvaluations) {
    if (status !== 'passed')
      issues.push(
        issue(
          'NH_PROPER_PIPE_UPSTREAM_EVIDENCE_BLOCKED',
          'Every independent pipe-layout evaluator must pass before assembly.',
          id,
        ),
      )
  }

  const { directionByEdgeId, scheduleCounts } = collectDirections(inputs, issues)
  const canonicalEdges = canonicalTopology?.edges || []
  const undirectedEdgeIds = sorted(
    canonicalEdges.filter((edge) => !directionByEdgeId.has(edge.id)).map((edge) => edge.id),
  )
  if (JSON.stringify(undirectedEdgeIds) !== JSON.stringify(EXPECTED_UNDIRECTED_EDGE_IDS)) {
    issues.push(
      issue(
        'NH_PROPER_PIPE_DIRECTION_COVERAGE_DRIFT',
        'The assembled layout must retain exactly the two unresolved source-feed edges.',
      ),
    )
  }
  const lowPointZoneEdgeIds = sorted(
    new Set(
      (longBranchDrainage?.branchSystems || []).flatMap(
        (system) => system.lowPointZoneEdgeIds || [],
      ),
    ),
  )
  if (JSON.stringify(lowPointZoneEdgeIds) !== JSON.stringify(EXPECTED_LOW_POINT_ZONE_EDGE_IDS)) {
    issues.push(
      issue(
        'NH_PROPER_PIPE_LOW_POINT_ZONE_IDENTITY_INVALID',
        'The long-branch root zone must remain the source-proved low-point-01 tie-in edge.',
      ),
    )
  }
  const roleBySegmentId = new Map(
    (governedSkeleton?.primaryAssignments || []).map((entry) => [
      entry.sourceSegmentId,
      entry.systemRole,
    ]),
  )
  const supplyEdgeIds = sorted(
    canonicalEdges
      .filter((edge) => roleBySegmentId.get(edge.sourceSegmentId) === 'source-feed')
      .map((edge) => edge.id),
  )
  if (
    JSON.stringify(supplyEdgeIds) !== JSON.stringify(EXPECTED_SUPPLY_EDGE_IDS) ||
    operationalAnnotations?.supplyAnchor?.boundPrimaryNodeId !== 'pipe-001-node-01'
  ) {
    issues.push(
      issue(
        'NH_PROPER_PIPE_SUPPLY_IDENTITY_INVALID',
        'The two unresolved source-feed edges must remain attached to the approved SUPPLY FROM RISER ROOM anchor.',
      ),
    )
  }

  const { ports, portsByCanonicalNode } = collectElevationPorts(hydraulicRoutes, issues)
  const multiElevationNodes = [...portsByCanonicalNode]
    .filter(([, nodePorts]) => new Set(nodePorts.map((port) => port.elevationFt)).size > 1)
    .map(([canonicalNodeId, nodePorts]) => ({
      canonicalNodeId,
      ports: nodePorts.map((port) => ({
        calculationNodeId: port.calculationNodeId,
        elevationFt: port.elevationFt,
      })),
    }))
  if (ports.length !== 32 || portsByCanonicalNode.size !== 31) {
    issues.push(
      issue(
        'NH_PROPER_PIPE_ELEVATION_ANCHOR_COVERAGE_DRIFT',
        'The three approved calculations must retain 32 exact Z ports on 31 canonical plan nodes.',
      ),
    )
  }
  if (
    multiElevationNodes.length !== 1 ||
    multiElevationNodes[0].canonicalNodeId !== 'canonical-node-142' ||
    JSON.stringify(multiElevationNodes[0].ports) !==
      JSON.stringify([
        { calculationNodeId: '50', elevationFt: 20.5 },
        { calculationNodeId: '718', elevationFt: 21.5 },
      ])
  ) {
    issues.push(
      issue(
        'NH_PROPER_PIPE_VERTICAL_PORT_IDENTITY_INVALID',
        'Canonical node 142 must preserve the approved one-foot same-XY vertical calculation leg.',
      ),
    )
  }

  const anchorElevations = ports.map((port) => port.elevationFt)
  const fieldRouteDrainIntents = operationalAnnotations?.fieldRouteDrainIntents || []
  const fieldDrainRoutesReady =
    fieldRouteDrainIntents.length > 0 &&
    fieldRouteDrainIntents.every((intent) => intent.routeStatus === 'source-resolved')
  const drumDripDetailReady = operationalAnnotations?.drumDripDetail?.components?.length === 7
  const datumPortKeys = new Set(
    (elevationDatum?.registeredPorts || []).map(
      (port) => `${port.canonicalNodeId}|${port.calculationNodeId}|${port.autosprinkLocalElevationFt}`,
    ),
  )
  const calculationToArchitecturalDatumRegistrationReady =
    elevationDatum?.calculationToArchitecturalDatumRegistrationReady === true &&
    ports.every((port) =>
      datumPortKeys.has(`${port.canonicalNodeId}|${port.calculationNodeId}|${port.elevationFt}`),
    )
  if (!calculationToArchitecturalDatumRegistrationReady) {
    issues.push(
      issue(
        'NH_PROPER_PIPE_CALC_ARCH_DATUM_INVALID',
        'Every approved calculation port must remain registered to the project finished-floor datum.',
      ),
    )
  }
  const exactPipeCenterlineZReady = false
  const fittingScheduleReady = false
  const properPipeLayoutReady = false
  const acceptanceBlockers = [
    issue(
      'NH_PROPER_PIPE_SUPPLY_3D_PATH_UNRESOLVED',
      'CML.01, its 4 x 3 upward outlet, and node-118 elevation are source-bound; endpoint Z, installed grade, and the concealed riser-room continuation remain unresolved.',
      'source-edge-001,source-edge-002',
    ),
    issue(
      'NH_PROPER_PIPE_EXACT_Z_INCOMPLETE',
      'Exact calculation Z exists on 31 of 142 canonical plan nodes; unanchored pipe-centerline Z cannot be fabricated.',
    ),
    issue(
      'NH_PROPER_PIPE_FIELD_DRAIN_ROUTES_UNRESOLVED',
      'The approved plan explicitly requires both drum-drip drains to be field routed and located.',
    ),
    issue(
      'NH_PROPER_PIPE_FITTING_SCHEDULE_INCOMPLETE',
      'A complete source-bound fitting and vertical-offset schedule is not yet assembled for every canonical edge.',
    ),
  ]
  const ready = issues.length === 0

  return {
    artifactType: 'halofire.new-hope-proper-pipe-layout-result.v1',
    projectId: pipeVectors?.projectId,
    status: ready ? 'passed' : 'blocked',
    issues,
    blockerCodes: [...new Set(issues.map((entry) => entry.code))],
    acceptanceBlockers,
    acceptanceBlockerCodes: acceptanceBlockers.map((entry) => entry.code),
    directedEdges: [...directionByEdgeId.values()].sort((a, b) => a.edgeId.localeCompare(b.edgeId)),
    undirectedEdges: canonicalEdges
      .filter((edge) => undirectedEdgeIds.includes(edge.id))
      .map((edge) => ({
        edgeId: edge.id,
        sourceSegmentId: edge.sourceSegmentId,
        fromNodeId: edge.fromNodeId,
        toNodeId: edge.toNodeId,
        classification: EXPECTED_SUPPLY_EDGE_IDS.includes(edge.id)
          ? 'source-feed-fabricated-plan-edge-endpoint-z-and-grade-unresolved'
          : 'unclassified-undirected-edge',
      })),
    exactElevationPorts: ports,
    multiElevationNodes,
    architecturalRegistration: {
      registeredSheets: architecturalVerticalControls?.registeredSheets || [],
      verticalDatum: elevationDatum?.verticalDatum || null,
      roofRegions: elevationDatum?.roofRegions || [],
      calculationAnchorRangeFt: anchorElevations.length
        ? { min: Math.min(...anchorElevations), max: Math.max(...anchorElevations) }
        : null,
      architecturalProjectAnchorRangeFt: elevationDatum?.registeredPorts?.length
        ? {
            min: Math.min(
              ...elevationDatum.registeredPorts.map(
                (port) => port.architecturalProjectElevationFt,
              ),
            ),
            max: Math.max(
              ...elevationDatum.registeredPorts.map(
                (port) => port.architecturalProjectElevationFt,
              ),
            ),
          }
        : null,
      globalRoofComparisonAllowed: false,
      calculationToArchitecturalDatumRegistrationReady,
    },
    fieldDrainRoutes: fieldRouteDrainIntents.map((intent) => ({
      id: intent.id,
      routeStatus: intent.routeStatus,
      nominalDiameterIn: intent.nominalDiameterIn,
    })),
    metrics: {
      canonicalNodeCount: canonicalTopology?.nodes?.length || 0,
      canonicalEdgeCount: canonicalEdges.length,
      directedEdgeCount: directionByEdgeId.size,
      undirectedEdgeCount: undirectedEdgeIds.length,
      directionCoverageRatio: canonicalEdges.length
        ? round(directionByEdgeId.size / canonicalEdges.length)
        : 0,
      scheduleCounts,
      exactElevationPortCount: ports.length,
      exactElevationCanonicalNodeCount: portsByCanonicalNode.size,
      exactElevationNodeCoverageRatio: canonicalTopology?.nodes?.length
        ? round(portsByCanonicalNode.size / canonicalTopology.nodes.length)
        : 0,
      sameXyVerticalLegCount: multiElevationNodes.length,
      fieldDrainIntentCount: fieldRouteDrainIntents.length,
    },
    planTopologyReady: ready && canonicalEdges.length === 143,
    wholeFp20RelativeGradeDirectionReady: ready && directionByEdgeId.size === 141,
    partialExactPipeElevationAnchorReady: ready && ports.length === 32,
    sameXyVerticalLegReady: ready && multiElevationNodes.length === 1,
    architecturalVerticalControlReady:
      ready && architecturalVerticalControls?.architecturalVerticalControlReady === true,
    calculationToArchitecturalDatumRegistrationReady,
    sourceFeedFabrication: sourceFeedFabrication
      ? {
          piece: sourceFeedFabrication.piece,
          outlet: sourceFeedFabrication.outlet,
        }
      : null,
    lowPointFabrication: lowPointFabrication
      ? {
          piece: lowPointFabrication.piece,
          directedEdge: lowPointFabrication.directedEdge,
          hydraulicEndpointReport: lowPointFabrication.hydraulicEndpointReport,
        }
      : null,
    lowPointZoneGradeReady:
      ready && lowPointFabrication?.lowPointRelativeGradeDirectionReady === true,
    lowPointExactDifferentialZReady: false,
    sourceFeedPlanFabricationReady:
      ready && sourceFeedFabrication?.sourceFeedPlanFabricationReady === true,
    sourceFeedOutletTransitionReady:
      ready && sourceFeedFabrication?.sourceFeedOutletTransitionReady === true,
    sourceFeedOutletElevationReady:
      ready && sourceFeedFabrication?.sourceFeedOutletElevationReady === true,
    sourceFeedEndpointElevationsReady: false,
    sourceFeedInstalledGradeReady: false,
    sourceFeedConcealedRiserContinuationReady: false,
    sourceFeed3dPathReady: false,
    fieldDrainRoutesReady,
    drumDripDetailReady,
    fittingScheduleReady,
    exactPipeCenterlineZReady,
    pipe3dProjectionReady: false,
    properPipeLayoutReady,
    fabricationReady: false,
    fieldReleaseReady: false,
  }
}

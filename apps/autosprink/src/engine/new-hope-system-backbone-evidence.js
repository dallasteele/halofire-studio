const PROJECT_ID = 'new-hope-crisis-center-brigham-city-ut';
const APPROVED_PLAN_SHA = '5A770222363228C2766605A695FEE9B6CB1F7B49C296204E09B691100253D9D5';
const ASBUILT_SHA = 'ED00E9530C02217BC50EAD2FC3391938E731253949B728B31ED1336F8000F34B';
const CALC_SHA = 'D70FA475A0DD32B22B134D2D6161435D9E769D659B320C6F25A3D908AE70D719';
const REMOTE_AREAS = Object.freeze(['2-1', '2-2', '2-3']);
const CHAIN = Object.freeze([
  Object.freeze({ id: 'nh-node-118', calculationNodeId: '118', role: 'dry-system-source-outlet', localElevationFt: 11.5, planNodeId: 'pipe-001-node-02' }),
  Object.freeze({ id: 'nh-node-414', calculationNodeId: '414', role: 'base-of-riser', localElevationFt: 5.458333, planNodeId: 'pipe-001-node-01' }),
  Object.freeze({ id: 'nh-node-560', calculationNodeId: '560', role: 'grooved-butterfly-valve', localElevationFt: 4.625, planNodeId: null }),
  Object.freeze({ id: 'nh-node-554', calculationNodeId: '554', role: 'backflow-preventer', localElevationFt: 1.166667, planNodeId: null }),
]);
const REQUIRED_DEVICE_TEXTS = Object.freeze([
  '4 INCH DRY VALVE',
  '4 INCH GROOVED BUTTERFLY VALVE',
  '4 INCH BACKFLOW PREVENTER',
  '2 INCH DRAIN TO EXTERIOR',
]);

const issue = (code, path, message) => ({ severity: 'blocking', code, path, message });
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const clone = (value) => JSON.parse(JSON.stringify(value));

function nodeById(planGraph, id) {
  return planGraph?.nodes?.find((node) => node.id === id) ?? null;
}

function exactLeg(route, node1, node2) {
  return route?.pipeTableLegs?.find((leg) => leg.node1 === node1 && leg.node2 === node2) ?? null;
}

function validateSourceChain(hydraulicRoutes, issues) {
  const routes = [...(hydraulicRoutes ?? [])].sort((a, b) => a.remoteAreaId.localeCompare(b.remoteAreaId));
  if (!same(routes.map((route) => route.remoteAreaId), REMOTE_AREAS)) {
    issues.push(issue('NH_BACKBONE_REMOTE_AREA_SET_INVALID', 'hydraulicRoutes', 'RA2-1, RA2-2, and RA2-3 must all retain the same source chain.'));
    return [];
  }
  const expectedLegs = [
    ['118', '414', 11.5, 5.458333],
    ['414', '560', 5.458333, 4.625],
    ['560', '554', 4.625, 1.166667],
  ];
  for (const route of routes) {
    if (
      route.projectId !== PROJECT_ID
      || route.sourceBindings?.approvedPlan?.sha256 !== APPROVED_PLAN_SHA
      || route.sourceBindings?.hydraulicCalculation?.sha256 !== CALC_SHA
      || route.calculationDirection !== 'remote-terminal-to-water-source'
      || route.physicalFlowDirection !== 'water-source-to-remote-terminal'
    ) {
      issues.push(issue('NH_BACKBONE_HYDRAULIC_SOURCE_INVALID', `hydraulicRoutes.${route.remoteAreaId}`, 'The hydraulic chain source, project, or direction drifted.'));
      continue;
    }
    for (const [node1, node2, elevation1Ft, elevation2Ft] of expectedLegs) {
      const leg = exactLeg(route, node1, node2);
      if (!leg || leg.elevation1Ft !== elevation1Ft || leg.elevation2Ft !== elevation2Ft || leg.nominalDiameterIn !== 4) {
        issues.push(issue('NH_BACKBONE_HYDRAULIC_LEG_INVALID', `hydraulicRoutes.${route.remoteAreaId}.${node1}-${node2}`, 'The approved four-inch riser/device calculation leg drifted.'));
      }
    }
  }
  return routes;
}

/**
 * Builds the source-backed portion of New Hope's riser and drainage backbone.
 *
 * This adapter intentionally separates three evidence projections:
 * - plan2d: exact PDF plan locations and unresolved field-route intents;
 * - elevation2d: exact hydraulic elevation ports plus the as-built riser detail;
 * - model3d: only source intersections that have both plan XY and calculation Z.
 *
 * It never fabricates a current flow test, pump decision, wet-system backbone,
 * field-routed drum-drip path, or concealed source-feed installation route.
 */
export function buildNewHopeSystemBackboneEvidence(inputs = {}) {
  const issues = [];
  const { registration, operationalAnnotations, planGraph, hydraulicRoutes } = inputs;

  if (
    registration?.projectId !== PROJECT_ID
    || operationalAnnotations?.projectId !== PROJECT_ID
    || planGraph?.projectId !== PROJECT_ID
  ) {
    issues.push(issue('NH_BACKBONE_PROJECT_IDENTITY_INVALID', '$', 'Every New Hope backbone input must identify the same project.'));
  }
  if (
    registration?.source?.sha256 !== ASBUILT_SHA
    || registration?.fp20TransferEvidence?.approvedPlanSha256 !== APPROVED_PLAN_SHA
    || planGraph?.source?.sha256 !== APPROVED_PLAN_SHA
    || !same(registration?.source?.pageBoxPdfPt, { width: 3024, height: 2160 })
  ) {
    issues.push(issue('NH_BACKBONE_SOURCE_BINDING_INVALID', 'sourceBindings', 'The as-built or approved-plan source binding drifted.'));
  }
  if (!REQUIRED_DEVICE_TEXTS.every((text) => registration?.fp10RiserEvidence?.deviceTexts?.includes(text))) {
    issues.push(issue('NH_BACKBONE_RISER_DEVICE_SET_INVALID', 'registration.fp10RiserEvidence.deviceTexts', 'The dry valve, butterfly valve, backflow, and exterior drain identities are required.'));
  }

  const routes = validateSourceChain(hydraulicRoutes, issues);
  const riserPlanNode = nodeById(planGraph, 'pipe-001-node-01');
  const outletPlanNode = nodeById(planGraph, 'pipe-001-node-02');
  if (
    !riserPlanNode
    || !outletPlanNode
    || !same(riserPlanNode.pdfPt, registration?.fp20TransferEvidence?.sourceAnchor?.pdfPt)
    || !same(outletPlanNode.pdfPt, registration?.fp20TransferEvidence?.outlet?.pdfPt)
  ) {
    issues.push(issue('NH_BACKBONE_PLAN_PORT_REGISTRATION_INVALID', 'planGraph', 'The exact riser station and node-118 source outlet must remain registered to FP2.0.'));
  }

  const lowPoints = operationalAnnotations?.lowPointAnchors ?? [];
  const fieldRoutes = operationalAnnotations?.fieldRouteDrainIntents ?? [];
  if (lowPoints.length !== 4 || lowPoints.some((anchor) => !anchor.id || !anchor.leaderTargetPdfPt || !anchor.boundPrimaryNodeIds?.length)) {
    issues.push(issue('NH_BACKBONE_LOW_POINT_SET_INVALID', 'operationalAnnotations.lowPointAnchors', 'All four source-bound low-point tie-in anchors are required.'));
  }
  if (
    fieldRoutes.length !== 2
    || fieldRoutes.some((intent) => intent.routeStatus !== 'field-resolution-required' || intent.nominalDiameterIn !== 1)
  ) {
    issues.push(issue('NH_BACKBONE_FIELD_DRAIN_INTENT_INVALID', 'operationalAnnotations.fieldRouteDrainIntents', 'Both one-inch drum-drip routes must remain explicitly field-resolved, never auto-routed.'));
  }
  if (
    operationalAnnotations?.remoteInspectorsTest?.id !== 'remote-inspectors-test'
    || operationalAnnotations?.remoteInspectorsTest?.nominalDiameterIn !== 1
    || operationalAnnotations?.drumDripDetail?.components?.length !== 7
  ) {
    issues.push(issue('NH_BACKBONE_TEST_OR_DRUM_DRIP_DETAIL_INVALID', 'operationalAnnotations', 'The remote inspector test and seven-component drum-drip detail are required.'));
  }

  const planComponents = [];
  if (riserPlanNode) {
    planComponents.push({
      id: 'nh-riser-plan-station',
      kind: 'riser-plan-station',
      pdfPt: clone(riserPlanNode.pdfPt),
      planFt: clone(riserPlanNode.plan),
      sourceRef: riserPlanNode.sourceRef,
      geometryStatus: 'exact-plan-xy',
    });
  }
  if (outletPlanNode) {
    planComponents.push({
      id: 'nh-node-118',
      kind: 'dry-system-source-outlet',
      pdfPt: clone(outletPlanNode.pdfPt),
      planFt: clone(outletPlanNode.plan),
      sourceRef: outletPlanNode.sourceRef,
      geometryStatus: 'exact-plan-xy-and-calculation-z',
    });
  }
  for (const anchor of lowPoints) {
    planComponents.push({
      id: anchor.id,
      kind: 'low-point-tie-in',
      pdfPt: clone(anchor.leaderTargetPdfPt),
      boundPrimaryNodeIds: [...anchor.boundPrimaryNodeIds],
      geometryStatus: 'exact-plan-intent-z-unresolved',
    });
  }
  for (const intent of fieldRoutes) {
    planComponents.push({
      id: intent.id,
      kind: 'field-route-drum-drip-intent',
      pdfPt: clone(intent.leaderTargetPdfPt),
      nominalDiameterIn: intent.nominalDiameterIn,
      routeStatus: intent.routeStatus,
      geometryStatus: 'source-intent-route-unresolved',
    });
  }
  if (operationalAnnotations?.remoteInspectorsTest) {
    planComponents.push({
      id: 'remote-inspectors-test',
      kind: 'inspectors-test',
      pdfPt: clone(operationalAnnotations.remoteInspectorsTest.leaderTargetPdfPt),
      nominalDiameterIn: 1,
      geometryStatus: 'exact-plan-intent-z-unresolved',
    });
  }

  const elevationComponents = CHAIN.map((port) => ({ ...port }));
  const modelPoints = [];
  if (riserPlanNode) {
    modelPoints.push({
      id: 'nh-node-414',
      kind: 'base-of-riser-source-intersection',
      planFt: clone(riserPlanNode.plan),
      pdfPt: clone(riserPlanNode.pdfPt),
      localElevationFt: 5.458333,
      geometryStatus: 'exact-plan-station-plus-calculation-z',
    });
  }
  if (outletPlanNode) {
    modelPoints.push({
      id: 'nh-node-118',
      kind: 'dry-system-source-outlet',
      planFt: clone(outletPlanNode.plan),
      pdfPt: clone(outletPlanNode.pdfPt),
      localElevationFt: 11.5,
      geometryStatus: 'exact-plan-xy-and-calculation-z',
    });
  }

  const evidenceReady = issues.length === 0;
  const blockers = [
    'BACKBONE_CURRENT_FLOW_TEST_REQUIRED',
    'BACKBONE_PUMP_DECISION_REQUIRED',
    'NH_WET_SYSTEM_BACKBONE_REQUIRED',
    'NH_FIELD_ROUTE_DRUM_DRIP_GEOMETRY_REQUIRED',
    'NH_SOURCE_FEED_INSTALLATION_3D_PATH_REQUIRED',
    'NH_COMPLETE_RISER_ROOM_INSTALLATION_GEOMETRY_REQUIRED',
  ];
  return {
    artifactType: 'halofire.new-hope-system-backbone-evidence-result.v1',
    projectId: PROJECT_ID,
    status: evidenceReady ? 'passed' : 'blocked',
    issues,
    sourceBindings: evidenceReady ? {
      approvedPlan: { sheet: 'FP2.0', physicalPage: 5, sha256: APPROVED_PLAN_SHA, pageBoxPdfPt: { width: 3024, height: 2160 } },
      asBuilt: { sheet: 'FP1.0', physicalPage: 3, sha256: ASBUILT_SHA },
      hydraulicCalculation: { sha256: CALC_SHA, remoteAreaIds: routes.map((route) => route.remoteAreaId) },
    } : null,
    systems: evidenceReady ? [{
      id: 'new-hope-dry-attic',
      type: 'dry',
      riserNominalDiameterIn: 4,
      protectedAreaSqft: 13700,
      sourceIdentities: [...REQUIRED_DEVICE_TEXTS],
      lowPointTieInCount: lowPoints.length,
      fieldRouteDrumDripCount: fieldRoutes.length,
    }] : [],
    plan2d: {
      sourceSheet: 'FP2.0',
      components: evidenceReady ? planComponents : [],
      releasedRoutes: [],
      sourceReferenceVectors: evidenceReady ? clone(operationalAnnotations.operationalReferenceVectors ?? []) : [],
    },
    elevation2d: {
      sourceSheet: 'FP1.0',
      components: evidenceReady ? elevationComponents : [],
      sectionIdentities: evidenceReady ? [
        '4-inch dry attic riser',
        '4-inch dry valve',
        '4-inch butterfly valve',
        '4-inch backflow preventer',
        '4-inch two-way FDC',
        '2-inch drain to exterior',
      ] : [],
    },
    model3d: {
      sourceIntersectionPoints: evidenceReady ? modelPoints : [],
      releasedRoutes: [],
      unresolvedPlanIntents: evidenceReady ? planComponents.filter((component) => component.geometryStatus.includes('unresolved')) : [],
    },
    systemDesignGate: { status: 'blocked', blockers },
    plan2dEvidenceReady: evidenceReady,
    elevation2dEvidenceReady: evidenceReady,
    model3dSourceIntersectionEvidenceReady: evidenceReady && modelPoints.length === 2,
    model3dInstallationReady: false,
    currentFlowTestReady: false,
    pumpDecisionReady: false,
    wetSystemBackboneReady: false,
    fieldDrainRoutesResolved: false,
    sourceFeed3dPathReady: false,
    quoteReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
  };
}

export default { buildNewHopeSystemBackboneEvidence };

import { validateNewHopeWetLevel1NetworkEvidence } from './new-hope-wet-level1-network-evidence.js';

const PROJECT_ID = 'new-hope-crisis-center-brigham-city-ut';
const APPROVED_PLAN_SHA = '5A770222363228C2766605A695FEE9B6CB1F7B49C296204E09B691100253D9D5';
const ASBUILT_SHA = 'ED00E9530C02217BC50EAD2FC3391938E731253949B728B31ED1336F8000F34B';
const CALC_SHA = 'D70FA475A0DD32B22B134D2D6161435D9E769D659B320C6F25A3D908AE70D719';
const FLOW_TEST_SHA = 'CFC0C70E035A20308A6FAA703E55A0C4A71CB0E6091182312C7227C597B4BC5B';
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
const REQUIRED_WET_DEVICE_TEXTS = Object.freeze([
  '3 INCH TO WET SYSTEM',
  'FIELD LOCATE AIR VENT',
  'AUDIBLE ALARM',
  'GAUGE KIT',
  '3 INCH RISER MANIFOLD',
  '3 INCH FLOW SWITCH',
  '3 INCH GRVD CHECK VALVE',
  "3 INCH GRVD B'FLY VALVE",
  '1-1/4 INCH TEST-N-DRAIN W/PRV',
]);
const EXPECTED_CALCULATION_AREAS = Object.freeze([
  Object.freeze({ id: '1-1', totalFlowGpm: 375, totalPressurePsi: 72.3, safetyMarginPsi: 6.7 }),
  Object.freeze({ id: '2-1', totalFlowGpm: 371.5, totalPressurePsi: 73.6, safetyMarginPsi: 5.4 }),
  Object.freeze({ id: '2-2', totalFlowGpm: 438.4, totalPressurePsi: 69.6, safetyMarginPsi: 9.4 }),
  Object.freeze({ id: '2-3', totalFlowGpm: 379.5, totalPressurePsi: 67.9, safetyMarginPsi: 11.1 }),
]);

const issue = (code, path, message) => ({ severity: 'blocking', code, path, message });
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const clone = (value) => JSON.parse(JSON.stringify(value));
const near = (left, right) => Math.abs(Number(left) - Number(right)) < 0.001;

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

function validateWaterSupplyAndWetRiser(evidence, registration, issues) {
  const issueCount = issues.length;
  const bindings = evidence?.sourceBindings;
  if (
    evidence?.projectId !== PROJECT_ID
    || bindings?.hydrantFlowTest?.sha256 !== FLOW_TEST_SHA
    || bindings?.approvedPlans?.sha256 !== APPROVED_PLAN_SHA
    || bindings?.hydraulicCalculation?.sha256 !== CALC_SHA
    || bindings?.asBuilt?.sha256 !== ASBUILT_SHA
  ) {
    issues.push(issue('NH_BACKBONE_SUPPLY_SOURCE_INVALID', 'waterSupplyAndWetRiser.sourceBindings', 'The flow test, approved plans, calculations, and as-built hashes must remain bound to New Hope.'));
  }

  if (
    bindings?.hydrantFlowTest?.testDate !== '2024-12-10'
    || !same(bindings?.hydrantFlowTest?.rawValues, { staticPsi: 89, residualPsi: 89, testFlowGpm: 1400 })
    || !same(bindings?.approvedPlans?.waterSupplyTable, {
      staticPsi: 89,
      residualPsi: 89,
      flowRateGpm: 1350,
      note: 'FLOW TEST DATA USED IN CALCULATIONS REDUCED BY 10 PSI',
    })
    || !same(bindings?.hydraulicCalculation?.approvedDesignSupply, { staticPsi: 79, residualPsi: 79, flowingGpm: 1350 })
  ) {
    issues.push(issue('NH_BACKBONE_SUPPLY_VALUES_INVALID', 'waterSupplyAndWetRiser.sourceBindings', 'Raw flow-test values and the conservative approved calculation supply must not be conflated or mutated.'));
  }

  const areas = [...(bindings?.hydraulicCalculation?.calculationAreas ?? [])].sort((a, b) => a.id.localeCompare(b.id));
  if (!same(areas, EXPECTED_CALCULATION_AREAS)) {
    issues.push(issue('NH_BACKBONE_CALCULATION_AREA_SET_INVALID', 'waterSupplyAndWetRiser.sourceBindings.hydraulicCalculation.calculationAreas', 'All four approved calculation-area pressure and margin results are required.'));
  } else if (areas.some((area) => !near(79 - area.totalPressurePsi, area.safetyMarginPsi) || area.safetyMarginPsi <= 0)) {
    issues.push(issue('NH_BACKBONE_PUMP_MARGIN_INVALID', 'waterSupplyAndWetRiser.pumpDecision', 'Each approved calculation area must retain a positive margin against the 79 psi approved design supply.'));
  }

  if (
    evidence?.pumpDecision?.decision !== 'not-required'
    || evidence?.pumpDecision?.scope !== 'completed-approved-new-hope-configuration'
    || !near(evidence?.pumpDecision?.minimumSafetyMarginPsi, 5.4)
    || evidence?.pumpDecision?.basis !== 'approved-design-supply-exceeds-each-total-demand-pressure'
  ) {
    issues.push(issue('NH_BACKBONE_PUMP_DECISION_INVALID', 'waterSupplyAndWetRiser.pumpDecision', 'The no-pump result must remain scoped to the completed approved configuration and its minimum 5.4 psi margin.'));
  }

  const wet = evidence?.wetSystem;
  if (
    wet?.id !== 'new-hope-wet-level-1'
    || wet?.type !== 'wet'
    || wet?.riserNominalDiameterIn !== 3
    || wet?.protectedAreaSqft !== 13700
    || wet?.testAndDrain?.nominalDiameterIn !== 1.25
    || wet?.testAndDrain?.pressureReducingValve !== true
    || wet?.testAndDrain?.routeGeometryStatus !== 'source-section-identity-only'
    || !same(wet?.riserPlanStationPdfPt, registration?.fp20TransferEvidence?.sourceAnchor?.pdfPt)
    || !REQUIRED_WET_DEVICE_TEXTS.every((text) => wet?.sectionIdentities?.includes(text))
  ) {
    issues.push(issue('NH_BACKBONE_WET_RISER_EVIDENCE_INVALID', 'waterSupplyAndWetRiser.wetSystem', 'The three-inch wet riser, 1-1/4-inch test-and-drain with PRV, and exact section identities are required.'));
  }
  return issues.length === issueCount;
}

/**
 * Builds the source-backed portion of New Hope's riser and drainage backbone.
 *
 * This adapter intentionally separates three evidence projections:
 * - plan2d: exact PDF plan locations and unresolved field-route intents;
 * - elevation2d: exact hydraulic elevation ports plus the as-built riser detail;
 * - model3d: only source intersections that have both plan XY and calculation Z.
 *
 * Historical approved supply is calibration evidence, not a current quote input.
 * The adapter never fabricates wet-network geometry, field-routed drum-drip paths,
 * or the concealed source-feed installation route.
 */
export function buildNewHopeSystemBackboneEvidence(inputs = {}) {
  const issues = [];
  const {
    registration,
    operationalAnnotations,
    planGraph,
    hydraulicRoutes,
    waterSupplyAndWetRiser,
    wetLevel1NetworkEvidence,
  } = inputs;
  const wetNetwork = validateNewHopeWetLevel1NetworkEvidence(wetLevel1NetworkEvidence);
  if (wetNetwork.status !== 'passed') {
    issues.push(...wetNetwork.issues);
  }

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
  const supplyAndWetRiserReady = validateWaterSupplyAndWetRiser(waterSupplyAndWetRiser, registration, issues);
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
    if (supplyAndWetRiserReady) {
      planComponents.push({
        id: 'nh-wet-riser-plan-station',
        kind: 'wet-riser-plan-station',
        pdfPt: clone(riserPlanNode.pdfPt),
        planFt: clone(riserPlanNode.plan),
        sourceRef: 'as-built-fp1.0:fire-sprinkler-riser-section-detail',
        geometryStatus: 'exact-plan-riser-station-section-z-unresolved',
      });
    }
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
  const wetNetworkReady = evidenceReady && wetNetwork.wetSystemNetwork2dReady;
  const blockers = [
    'BACKBONE_NEW_QUOTE_FLOW_TEST_REQUIRED',
    ...(wetNetworkReady ? [] : ['NH_WET_SYSTEM_NETWORK_2D_EXTRACTION_REQUIRED']),
    'NH_WET_SYSTEM_PIECE_TO_PLAN_MAPPING_REQUIRED',
    'NH_WET_SYSTEM_HEAD_TYPE_ASSIGNMENT_REQUIRED',
    'NH_WET_SYSTEM_DIRECTION_AND_GRADE_REQUIRED',
    'NH_WET_SYSTEM_INSTALLATION_3D_PATH_REQUIRED',
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
      hydrantFlowTest: { physicalPage: 1, sha256: FLOW_TEST_SHA, testDate: '2024-12-10' },
      approvedDesignSupply: clone(waterSupplyAndWetRiser.sourceBindings.hydraulicCalculation.approvedDesignSupply),
      wetLevel1Network: clone(wetNetwork.sourceBindings),
    } : null,
    systems: evidenceReady ? [
      {
        id: 'new-hope-dry-attic',
        type: 'dry',
        riserNominalDiameterIn: 4,
        protectedAreaSqft: 13700,
        sourceIdentities: [...REQUIRED_DEVICE_TEXTS],
        lowPointTieInCount: lowPoints.length,
        fieldRouteDrumDripCount: fieldRoutes.length,
      },
      {
        id: waterSupplyAndWetRiser.wetSystem.id,
        type: 'wet',
        riserNominalDiameterIn: waterSupplyAndWetRiser.wetSystem.riserNominalDiameterIn,
        protectedAreaSqft: waterSupplyAndWetRiser.wetSystem.protectedAreaSqft,
        sourceIdentities: [...waterSupplyAndWetRiser.wetSystem.sectionIdentities],
        testAndDrain: clone(waterSupplyAndWetRiser.wetSystem.testAndDrain),
      },
    ] : [],
    pumpDecision: evidenceReady ? clone(waterSupplyAndWetRiser.pumpDecision) : null,
    approvedWaterSupply: evidenceReady ? {
      rawFlowTest: clone(waterSupplyAndWetRiser.sourceBindings.hydrantFlowTest),
      calculationSupply: clone(waterSupplyAndWetRiser.sourceBindings.hydraulicCalculation.approvedDesignSupply),
      calculationAreas: clone(waterSupplyAndWetRiser.sourceBindings.hydraulicCalculation.calculationAreas),
    } : null,
    plan2d: {
      sourceSheet: 'FP2.0',
      components: evidenceReady ? planComponents : [],
      releasedRoutes: [],
      sourceReferenceVectors: evidenceReady ? clone(operationalAnnotations.operationalReferenceVectors ?? []) : [],
      wetLevel1: wetNetworkReady ? {
        sourceSheet: 'FP1.0',
        pipeVectors: clone(wetNetwork.wetPipeVectors),
        sprinklerHeads: clone(wetNetwork.sprinklerHeads),
        sprinklerSchedule: clone(wetNetwork.sprinklerSchedule),
        geometryStatus: 'exact-field-install-and-as-built-plan-xy',
      } : null,
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
        '3-inch wet riser manifold',
        '3-inch wet flow switch',
        '3-inch wet check valve',
        '3-inch wet butterfly valve',
        '1-1/4-inch wet test-and-drain with PRV',
      ] : [],
      wetSystem: evidenceReady ? {
        sourceSheet: 'FP1.0',
        riserNominalDiameterIn: 3,
        testAndDrainNominalDiameterIn: 1.25,
        installationGeometryStatus: 'plan-riser-station-only',
      } : null,
    },
    model3d: {
      sourceIntersectionPoints: evidenceReady ? modelPoints : [],
      releasedRoutes: [],
      unresolvedPlanIntents: evidenceReady ? planComponents.filter((component) => component.geometryStatus.includes('unresolved')) : [],
      unresolvedWetLevel1: wetNetworkReady ? {
        pipeVectors: wetNetwork.wetPipeVectors.map((vector) => ({
          id: vector.id,
          fromPlanFt: clone(vector.fromPlanFt),
          toPlanFt: clone(vector.toPlanFt),
          installedElevationFt: null,
          geometryStatus: 'exact-plan-xy-installed-z-unresolved',
        })),
        sprinklerHeads: wetNetwork.sprinklerHeads.map((head) => ({
          id: head.id,
          planFt: clone(head.planFt),
          installedElevationFt: null,
          headType: null,
          geometryStatus: 'exact-plan-xy-installed-z-and-type-unresolved',
        })),
      } : null,
    },
    systemDesignGate: { status: 'blocked', blockers },
    takeoff: evidenceReady ? {
      status: wetNetworkReady ? 'native-fabrication-quantities-piece-to-plan-mapping-unresolved' : 'source-identities-only-no-route-quantities',
      wetLevel1NativeFabrication: wetNetworkReady ? {
        metrics: clone(wetNetwork.metrics),
        lineFamilies: clone(wetNetwork.nativeFabricationLines),
        sprinklerSchedule: clone(wetNetwork.sprinklerSchedule),
      } : null,
      systemComponents: [
        { key: 'wet_riser_manifold', description: '3-inch wet riser manifold', unit: 'EA', quantity: 1, systemIds: ['new-hope-wet-level-1'] },
        { key: 'wet_flow_switch', description: '3-inch wet-system flow switch', unit: 'EA', quantity: 1, systemIds: ['new-hope-wet-level-1'] },
        { key: 'wet_check_valve', description: '3-inch grooved wet-system check valve', unit: 'EA', quantity: 1, systemIds: ['new-hope-wet-level-1'] },
        { key: 'wet_butterfly_valve', description: '3-inch grooved wet-system butterfly valve', unit: 'EA', quantity: 1, systemIds: ['new-hope-wet-level-1'] },
        { key: 'wet_test_and_drain_prv', description: '1-1/4-inch test-and-drain with PRV', unit: 'EA', quantity: 1, systemIds: ['new-hope-wet-level-1'] },
        { key: 'fire_pump', description: 'Fire pump and controller', unit: 'EA', quantity: 0, systemIds: ['new-hope-dry-attic', 'new-hope-wet-level-1'] },
      ],
    } : null,
    plan2dEvidenceReady: evidenceReady,
    elevation2dEvidenceReady: evidenceReady,
    model3dSourceIntersectionEvidenceReady: evidenceReady && modelPoints.length === 2,
    model3dInstallationReady: false,
    rawFlowTestEvidenceReady: evidenceReady,
    approvedDesignWaterSupplyReady: evidenceReady,
    currentFlowTestReady: false,
    currentFlowTestContext: evidenceReady ? 'historical-approved-design-basis-not-current-for-new-quote' : null,
    pumpDecisionReady: evidenceReady,
    pumpDecisionScope: evidenceReady ? 'completed-approved-new-hope-configuration' : null,
    wetRiserAndDrainEvidenceReady: evidenceReady,
    wetSystemNetwork2dReady: wetNetworkReady,
    sprinklerHeadPositions2dReady: wetNetworkReady,
    nativeFabricationTakeoffReady: wetNetworkReady,
    wetSystemPieceToPlanMappingReady: false,
    wetSystemHeadTypeAssignmentReady: false,
    wetSystemDirectionReady: false,
    wetSystemGradeReady: false,
    wetSystemBackboneReady: false,
    fieldDrainRoutesResolved: false,
    sourceFeed3dPathReady: false,
    quoteReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
  };
}

export default { buildNewHopeSystemBackboneEvidence };

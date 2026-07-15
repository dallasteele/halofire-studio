import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

import pipeCalibration from '../src/data/polaris-pitched-pipe-xyz-calibration.json';
import atticReport from '../src/data/polaris-hydraulic-calcs-attic.json';
import belowCeilingReport from '../src/data/polaris-hydraulic-calcs-below-ceiling.json';
import expected from '../src/data/polaris-pitched-hydraulic-network.json';
import sourceContinuityEvidence from '../src/data/polaris-pipe-layout-source-continuity.json';
import {
  bindCalculationSprinklerLeaves,
  buildPhysicalPipeGraph,
  buildPolarisPitchedHydraulicNetwork,
} from '../src/engine/polaris-pitched-hydraulic-network.js';

const build = (overrides = {}) => buildPolarisPitchedHydraulicNetwork({
  pipeCalibration: overrides.pipeCalibration ?? pipeCalibration,
  atticReport: overrides.atticReport ?? atticReport,
  belowCeilingReport: overrides.belowCeilingReport ?? belowCeilingReport,
  fireLineEvidence: overrides.fireLineEvidence ?? expected.sourceBoundary.fireLineCad,
  fireLineRegistration: overrides.fireLineRegistration ?? expected.sourceBoundary.fireLineRegistration,
  sourceContinuityEvidence: overrides.sourceContinuityEvidence ?? sourceContinuityEvidence,
});

describe('Polaris completed pitched hydraulic and drainage network', () => {
  it('replays the committed packet deterministically', () => {
    expect(JSON.parse(JSON.stringify(build()))).toEqual(expected);
  });

  it('preserves all source pipe objects and the exact 177-pipe building component', () => {
    const graph = buildPhysicalPipeGraph(pipeCalibration.pipes);
    expect(new Set(graph.components.flatMap((component) => component.pipeIds)).size).toBe(186);
    expect(graph.components.map((component) => component.pipeIds.length)).toEqual([177, 2, 1, 1, 1, 1, 1, 1, 1]);
    expect(expected.physicalNetwork).toMatchObject({
      toleranceFt: 0.04,
      rootComponentPipeCount: 177,
      rootComponentCycleRank: 3,
      sourceRootDirectionStatus: 'root-distance-orientation-only-cycles-require-calculation-node-binding',
    });
    expect(expected.claims).toMatchObject({
      exactPhysicalPipeGraphReady: true,
      sourceRootedTopologicalDirectionReady: false,
      wholeNetworkHydraulicFlowDirectionReady: true,
    });
  });

  it('binds both report graphs and only holds the two source nodes absent from plan labels', () => {
    expect(expected.hydraulicReports.map((report) => report.segmentCount)).toEqual([33, 49]);
    expect(expected.nodeRegistration).toMatchObject({
      reportNodeCount: 61,
      cadLabelCount: 59,
      exactCadLabelCoverageCount: 59,
      exactCadNodeConnectionPointCount: 59,
      maximumCadNodeElevationResidualInches: 0.243616,
      sourceGlyphTopologyReady: true,
      missingCadLabels: ['1', '2'],
    });
    expect(expected.claims).toMatchObject({
      exactHydraulicReportGraphReady: true,
      reportSourceClosureReady: true,
      reportHydraulicFlowDirectionReady: true,
      calculatedSprinklerLeafToDwgPipeBindingReady: true,
      exactHydraulicNodeConnectionPointsReady: true,
      calculationNodeToDwgConnectionPointBindingReady: true,
      calculationNodeToDwgGeometryBindingReady: false,
    });
  });

  it('registers the sprinkler plan into the fire-line coordinate frame without fabricating a hydraulic connection', () => {
    expect(expected.sourceBoundary.fireLineRegistration).toMatchObject({
      schema: 'halofire.polaris-fireline-registration.v1',
      siteRegistration: {
        matchedVertexCount: 73,
        maximumResidualInches: 0.281881785,
        rootMeanSquareResidualInches: 0.158968546,
        secondBestRootMeanSquareResidualInches: 145.479451259,
        rigidRegistrationUniquenessMarginInches: 145.320482713,
      },
      siteOutlineEmbeddedMatches: [{
        siteHandle: '625',
        embeddedHandle: '4BC6',
        translationInches: [-2342.96544, -792.62277],
      }],
      nearestFireLinePipeEndpointToHydraulicNode116: {
        pipeHandle: '6F83',
        endpointIndex: 1,
        residualInches: 718.821404366,
      },
      claims: {
        rejectedAnnotationTranslationFound: true,
        exactSharedGeometryTranslationReady: true,
        sitePlanToFireLineCoordinateRegistrationReady: true,
        sprinklerCadToFireLineCoordinateRegistrationReady: true,
        hydraulicNodeToFireLinePipeBindingReady: false,
        sprinklerRiserToFireLineRiserReady: false,
      },
    });
    expect(expected.claims).toMatchObject({
      sprinklerCadToFireLineCoordinateRegistrationReady: true,
      hydraulicNodeToFireLinePipeBindingReady: false,
      hydraulicSourceSemanticContinuityReady: true,
      wholeNetworkHydraulicFlowDirectionReady: true,
      properPipeLayoutReady: false,
    });

    const attacked = structuredClone(expected.sourceBoundary.fireLineRegistration);
    attacked.claims.sprinklerCadToFireLineCoordinateRegistrationReady = false;
    expect(build({ fireLineRegistration: attacked }).claims.sprinklerCadToFireLineCoordinateRegistrationReady).toBe(false);
  });

  it('uses the completed FL3 to FP1 to hydraulic-report chain without claiming an exact CAD endpoint', () => {
    expect(expected.sourceBoundary.sourceContinuity).toMatchObject({
      status: 'passed',
      sourceBindingCount: 5,
      chainNodeCount: 5,
      chainEdgeCount: 4,
      reachableNodeCount: 5,
      sameProjectSemanticSourceContinuityReady: true,
      exactCrossDrawingEndpointGeometryReady: false,
      riserDeviceSemanticsReady: true,
    });
    expect(expected.claims).toMatchObject({
      hydraulicSourceSemanticContinuityReady: true,
      hydraulicNodeToFireLinePipeBindingReady: false,
      wholeNetworkHydraulicFlowDirectionReady: true,
      drainageGradeSemanticsReady: false,
      properPipeLayoutReady: false,
    });

    const attacked = structuredClone(sourceContinuityEvidence);
    attacked.edges = attacked.edges.filter((edge) => edge.id !== 'riser-to-building-feed');
    const result = build({ sourceContinuityEvidence: attacked });
    expect(result.sourceBoundary.sourceContinuity.blockerCodes).toContain('SOURCE_CONTINUITY_CHAIN_OPEN');
    expect(result.claims.hydraulicSourceSemanticContinuityReady).toBe(false);
    expect(result.claims.wholeNetworkHydraulicFlowDirectionReady).toBe(false);
  });

  it('binds every calculated sprinkler to a unique source head and exact terminal pipe connection', () => {
    expect(expected.nodeRegistration).toMatchObject({
      exactCalculatedSprinklerLeafCount: 29,
      calculatedSprinklerLeafBindingStatus: 'exact-source-sprinkler-and-terminal-pipe-binding-ready',
    });
    expect(expected.nodeRegistration.calculatedSprinklerLeafBindings.map((binding) => ({
      description: binding.reportDescription,
      count: binding.calculatedSprinklerNodeCount,
      margin: binding.minimumForcedAlternativeAssignmentMarginFt,
      ready: binding.exactLeafBindingReady,
    }))).toEqual([
      { description: 'Light Hazard (ATTIC)', count: 14, margin: 11.086046744, ready: true },
      { description: 'Light Hazard (BELOW CEILING)', count: 15, margin: 9.503405117, ready: true },
    ]);
    const bindings = expected.nodeRegistration.calculatedSprinklerLeafBindings.flatMap((binding) => binding.bindings);
    expect(new Set(bindings.map((binding) => binding.sprinklerId)).size).toBe(29);
    expect(bindings.filter((binding) => binding.sprinklerCategory === 'Upright')).toHaveLength(14);
    expect(bindings.filter((binding) => binding.sprinklerCategory === 'Pendent')).toHaveLength(15);
    expect(bindings.every((binding) => binding.terminalConnection.topologyReady)).toBe(true);
  });

  it('fails the leaf gate when a duplicate source head destroys assignment uniqueness', () => {
    const attacked = structuredClone(pipeCalibration);
    attacked.sprinklers.push({
      ...structuredClone(attacked.sprinklers.find((sprinkler) => sprinkler.id === 'sprinkler-890')),
      id: 'sprinkler-adversarial-duplicate',
    });
    const binding = bindCalculationSprinklerLeaves({ report: belowCeilingReport, pipeCalibration: attacked });
    expect(binding.minimumForcedAlternativeAssignmentMarginFt).toBe(0);
    expect(binding.exactLeafBindingReady).toBe(false);
    expect(build({ pipeCalibration: attacked }).claims.calculatedSprinklerLeafToDwgPipeBindingReady).toBe(false);
  });

  it('rejects missing labels and flex-drop terminal topology instead of forcing a match', () => {
    const noLabel = structuredClone(pipeCalibration);
    noLabel.hydraulicNodeLabels = noLabel.hydraulicNodeLabels.filter((label) => label.nodeId !== '252');
    expect(() => bindCalculationSprinklerLeaves({ report: atticReport, pipeCalibration: noLabel }))
      .toThrow('POLARIS_CALCULATED_SPRINKLER_LABEL_MISSING:252');

    const noFlex = structuredClone(pipeCalibration);
    noFlex.fittings = noFlex.fittings.filter((fitting) => fitting.sourceAttributes['Sub Category'] !== 'Flex Drop');
    expect(() => bindCalculationSprinklerLeaves({ report: belowCeilingReport, pipeCalibration: noFlex }))
      .toThrow('POLARIS_FLEX_DROP_ASSIGNMENT_INFEASIBLE');
  });

  it('uses exact fitting ports and the completed MAIN DRAIN leader', () => {
    expect(expected.fittingSemantics).toMatchObject({
      attributedFittingCount: 98,
      supplyTeeConnectedPipeIds: ['pipe-22275', 'pipe-3279', 'pipe-17499'],
      inspectorTestDrainConnectedPipeIds: ['pipe-22402', 'pipe-22468'],
      mainDrainCallout: { text: 'MAIN DRAIN', leaderSegmentCount: 2 },
    });
    expect(expected.fittingSemantics.subCategoryCounts).toMatchObject({
      Tee: 2,
      Elbow: 6,
      'Rigid Coupling': 12,
      'Inspectors Test & Drain': 1,
      Check: 1,
      'Switch/Sensor': 1,
      'Two-Way Inlet': 1,
    });
    expect(expected.claims).toMatchObject({
      fullFittingIdentityReady: true,
      supplyTeePipeBridgeReady: true,
      inspectorTestDrainPipeBridgeReady: true,
      mainDrainCalloutReady: true,
      drainDestinationReady: true,
    });
  });

  it('keeps geometric grade, drainability, and design intent as separate facts', () => {
    expect(expected.gradeAndDrainage).toMatchObject({
      slopedPlanRunCount: 14,
      geometricallyDrainableSlopedRunCount: 4,
      slopedRunLowPointAwayFromMainDrainCount: 10,
      explicitDrainDeviceCount: 1,
      explicitMainDrainCalloutCount: 1,
      drainageIntentStatus: 'held',
    });
    expect(expected.claims).toMatchObject({
      roofRelativePipeGradeGeometryReady: true,
      drainageGradeSemanticsReady: false,
      continuousDrainPathReady: false,
      properPipeLayoutReady: false,
      fabricationReady: false,
      fieldReleaseReady: false,
    });
  });

  it('routes every rigid building segment over exact material-and-size-matched source spans', () => {
    expect(expected.physicalSpanRegistration).toMatchObject({
      uniqueReportSegmentCount: 68,
      onPlanSegmentCount: 66,
      exactPhysicalSpanRouteCount: 65,
      maximumReadyRouteLengthResidualFt: 0.079908961,
      roleCounts: {
        'branch-line': { total: 45, exactPhysicalSpanRouteReady: 45 },
        'cross-main': { total: 4, exactPhysicalSpanRouteReady: 4 },
        'feed-main': { total: 1, exactPhysicalSpanRouteReady: 1 },
        'arm-over': { total: 15, exactPhysicalSpanRouteReady: 15 },
        'feed-riser': { total: 2, exactPhysicalSpanRouteReady: 0 },
        underground: { total: 1, exactPhysicalSpanRouteReady: 0 },
      },
      loopInteriorPipeSpanDirectionReady: true,
      buildingRigidPipeSpanHydraulicDirectionReady: true,
      exactArmOverFlexTerminalBindingCount: 15,
    });
    expect(expected.physicalSpanRegistration.routes
      .filter((route) => ['branch-line', 'cross-main', 'feed-main', 'arm-over'].includes(route.pipeRole))
      .every((route) => route.exactPhysicalSpanRouteReady && route.physicalPathPolylineFt.length >= 2)).toBe(true);
    expect(expected.physicalSpanRegistration.routes.filter((route) => route.pipeRole === 'arm-over')
      .every((route) => route.flexibleTerminalComponent?.endpointBindingReady
        && route.flexibleTerminalComponent.centerlineStatus === 'not-exported-by-source-use-semantic-flex-component-with-exact-endpoints')).toBe(true);
    expect(expected.claims).toMatchObject({
      loopInteriorPipeSpanDirectionReady: true,
      exactArmOverRigidToFlexTerminalDirectionReady: true,
      semanticFlexTerminalEndpointBindingReady: true,
      flexibleHoseCenterlineReady: false,
      riserFittingBridgeComponentPathReady: true,
      riserReportToSourceLengthAgreementReady: false,
      riserHydraulicSemanticBindingReady: true,
      buildingRigidPipeSpanHydraulicDirectionReady: true,
      wholeNetworkHydraulicFlowDirectionReady: true,
      properPipeLayoutReady: false,
    });
  });

  it('reconciles riser hydraulic length semantics without overwriting physical centerline length', () => {
    expect(expected.physicalSpanRegistration.riserHydraulicSemantics).toMatchObject({
      reportOccurrenceCount: 2,
      reportOccurrencesAgree: true,
      sourceComponentPathLengthFt: 13.582466883,
      reportRawLengthFt: 10.75,
      reportElevationRiseFt: 10.563333333,
      reportRawLengthToElevationRiseResidualFt: 0.186666667,
      sourceCenterlineToReportRawLengthResidualFt: 2.832466883,
      reportEquivalentLengthFt: 20,
      transitionEquivalentLengthFt: 5,
      backflowPressureChangePsi: -5,
      fireElbowCount: 2,
      fireElbowEquivalentEachFt: 7.5,
      computedEquivalentLengthFt: 20,
      sourceThreeInchElbowCount: 2,
      sourceBackflowNoteCount: 1,
      sourceComponentPathReady: true,
      reportRawLengthUsesElevationRiseReady: true,
      reportFittingSemanticsReady: true,
      sourceCenterlineEqualsReportRawLength: false,
      hydraulicSemanticBindingReady: true,
    });
    expect(expected.claims).toMatchObject({
      riserFittingBridgeComponentPathReady: true,
      riserReportToSourceLengthAgreementReady: false,
      riserHydraulicSemanticBindingReady: true,
    });
  });

  it('holds riser semantics when fitting losses or backflow evidence are changed', () => {
    const attacked = structuredClone(atticReport);
    attacked.segments.find((segment) => segment.upstreamNode === '116' && segment.downstreamNode === '13')
      .upstreamFittings = "Tr(5'-0), BFP(-5.000), 3fE(7'-6)";
    expect(build({ atticReport: attacked }).claims.riserHydraulicSemanticBindingReady).toBe(false);

    const noBackflow = structuredClone(expected.sourceBoundary.fireLineCad);
    noBackflow.evidence.backflowNotes = [];
    expect(build({ fireLineEvidence: noBackflow }).claims.riserHydraulicSemanticBindingReady).toBe(false);
  });

  it('holds loop direction when report length no longer agrees with the source span route', () => {
    const attacked = structuredClone(atticReport);
    attacked.segments.find((segment) => segment.upstreamNode === '225' && segment.downstreamNode === '252').lengthFt += 1;
    const result = build({ atticReport: attacked });
    expect(result.physicalSpanRegistration.roleCounts['branch-line']).toMatchObject({
      total: 45,
      exactPhysicalSpanRouteReady: 44,
    });
    expect(result.claims.loopInteriorPipeSpanDirectionReady).toBe(false);
    expect(result.claims.wholeNetworkHydraulicFlowDirectionReady).toBe(false);
  });

  it('holds an arm-over when report length no longer agrees with its rigid-to-flex source route', () => {
    const attacked = structuredClone(belowCeilingReport);
    attacked.segments.find((segment) => segment.upstreamNode === '297' && segment.downstreamNode === '538').lengthFt += 1;
    const result = build({ belowCeilingReport: attacked });
    expect(result.physicalSpanRegistration.roleCounts['arm-over']).toMatchObject({
      total: 15,
      exactPhysicalSpanRouteReady: 14,
    });
    expect(result.claims.exactArmOverRigidToFlexTerminalDirectionReady).toBe(false);
    expect(result.claims.buildingRigidPipeSpanHydraulicDirectionReady).toBe(false);
    expect(result.claims.wholeNetworkHydraulicFlowDirectionReady).toBe(false);
  });

  it('rejects report direction and missing-drain attacks', () => {
    const reversed = structuredClone(atticReport);
    reversed.directionSemantics.hydraulicFlowDirection = 'downstream-to-upstream';
    expect(build({ atticReport: reversed }).claims.reportHydraulicFlowDirectionReady).toBe(false);

    const noDrain = structuredClone(pipeCalibration);
    noDrain.fittings = noDrain.fittings.filter((fitting) => fitting.sourceAttributes['Sub Category'] !== 'Inspectors Test & Drain');
    expect(() => build({ pipeCalibration: noDrain })).toThrow('POLARIS_INSPECTORS_TEST_DRAIN_MISSING');
  });

  it('renders the governed layers over the actual approved FP2 proof', () => {
    const html = fs.readFileSync(new URL('../src/data/proofs/polaris-pitched-hydraulic-network/index.html', import.meta.url), 'utf8');
    const proof = JSON.parse(fs.readFileSync(new URL('../src/data/proofs/polaris-pitched-hydraulic-network/proof.json', import.meta.url), 'utf8'));
    expect(html).toContain('../polaris-pitched-pipe-xyz/approved-fp2-pipe-overlay.png');
    expect(html).toContain('82 calculated flow segments');
    expect(html).toContain('4 / 10');
    expect(html).toContain('29 exact sprinkler terminals');
    expect(html).toContain('exact 3D source leader tips');
    expect(html).toContain("data-proof-layer':'grade'");
    expect(html).toContain("data-proof-layer':'device'");
    expect(html).toContain("data-proof-layer':'terminal'");
    expect(html).toContain("data-proof-layer':'span'");
    expect(html).toContain('65 exact physical span routes');
    expect(html).toContain('3 loop interiors resolved');
    expect(html).toContain('semantic source continuity resolved');
    expect(html).toContain('exact fire-line endpoint held');
    expect(html).toContain('718.821 inches from node 116');
    expect(html).toContain('whole-network flow directed');
    expect(html).toContain('drainage intent held');
    expect(html).toContain('polaris-final-fl3-source-chain.png');
    expect(html).toContain('polaris-asbuilt-fp1-riser-source-chain.png');
    expect(html).toContain('Attic calculation graph (diagnostic)');
    expect(html).not.toContain('data-layer="attic" checked');
    expect(proof).toMatchObject({
      networkReceiptSha256: expected.receiptSha256,
      counts: {
        hydraulicReportSegments: 82,
        exactHydraulicNodeConnectionPoints: 59,
        exactPhysicalSpanRoutes: 65,
        exactArmOverRigidToFlexTerminalRoutes: 15,
        exactBranchLineSpanRoutes: 45,
        exactCrossMainSpanRoutes: 4,
        exactFeedMainSpanRoutes: 1,
        exactCalculatedSprinklerTerminalBindings: 29,
        buildingComponentPipes: 177,
        slopedPlanRuns: 14,
      },
      defaultLayers: {
        atticCalculationGraphDiagnostic: false,
        exactPhysicalSpanDirections: true,
        calculatedSprinklerTerminals: true,
        geometricDownhillEndpoints: true,
      },
      browserVerification: {
        exactPhysicalSpanLayerVisible: true,
        exactPhysicalSpanToggleVerified: true,
        exactTerminalLayerVisible: true,
        exactTerminalToggleVerified: true,
        diagnosticToggleVerified: true,
        sourceContinuityImagesVisible: true,
        browserErrorCount: 0,
      },
      claims: {
        calculatedSprinklerLeafToDwgPipeBindingReady: true,
        exactHydraulicNodeConnectionPointsReady: true,
        calculationNodeToDwgConnectionPointBindingReady: true,
        sprinklerCadToFireLineCoordinateRegistrationReady: true,
        hydraulicNodeToFireLinePipeBindingReady: false,
        hydraulicSourceSemanticContinuityReady: true,
        loopInteriorPipeSpanDirectionReady: true,
        buildingRigidPipeSpanHydraulicDirectionReady: true,
        riserHydraulicSemanticBindingReady: true,
        wholeNetworkHydraulicFlowDirectionReady: true,
        properPipeLayoutReady: false,
      },
    });
  });
});

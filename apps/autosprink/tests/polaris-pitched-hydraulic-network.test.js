import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

import pipeCalibration from '../src/data/polaris-pitched-pipe-xyz-calibration.json';
import atticReport from '../src/data/polaris-hydraulic-calcs-attic.json';
import belowCeilingReport from '../src/data/polaris-hydraulic-calcs-below-ceiling.json';
import expected from '../src/data/polaris-pitched-hydraulic-network.json';
import {
  buildPhysicalPipeGraph,
  buildPolarisPitchedHydraulicNetwork,
} from '../src/engine/polaris-pitched-hydraulic-network.js';

const build = (overrides = {}) => buildPolarisPitchedHydraulicNetwork({
  pipeCalibration: overrides.pipeCalibration ?? pipeCalibration,
  atticReport: overrides.atticReport ?? atticReport,
  belowCeilingReport: overrides.belowCeilingReport ?? belowCeilingReport,
  fireLineEvidence: overrides.fireLineEvidence ?? expected.sourceBoundary.fireLineCad,
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
      wholeNetworkHydraulicFlowDirectionReady: false,
    });
  });

  it('binds both report graphs and only holds the two source nodes absent from plan labels', () => {
    expect(expected.hydraulicReports.map((report) => report.segmentCount)).toEqual([33, 49]);
    expect(expected.nodeRegistration).toMatchObject({
      reportNodeCount: 61,
      cadLabelCount: 59,
      exactCadLabelCoverageCount: 59,
      missingCadLabels: ['1', '2'],
    });
    expect(expected.claims).toMatchObject({
      exactHydraulicReportGraphReady: true,
      reportSourceClosureReady: true,
      reportHydraulicFlowDirectionReady: true,
      calculationNodeToDwgGeometryBindingReady: false,
    });
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
    expect(html).toContain('annotation-to-annotation arrows');
    expect(html).toContain("data-proof-layer':'grade'");
    expect(html).toContain("data-proof-layer':'device'");
    expect(html).toContain('whole-network flow held');
    expect(html).toContain('Attic calculation graph (diagnostic)');
    expect(html).not.toContain('data-layer="attic" checked');
    expect(proof).toMatchObject({
      networkReceiptSha256: expected.receiptSha256,
      counts: { hydraulicReportSegments: 82, buildingComponentPipes: 177, slopedPlanRuns: 14 },
      defaultLayers: { atticCalculationGraphDiagnostic: false, geometricDownhillEndpoints: true },
      browserVerification: { diagnosticToggleVerified: true, browserErrorCount: 0 },
      claims: { wholeNetworkHydraulicFlowDirectionReady: false, properPipeLayoutReady: false },
    });
  });
});

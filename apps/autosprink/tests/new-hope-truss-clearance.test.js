import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildNewHopeTrussClearanceCalibration,
  sealNewHopeTrussClearanceSource,
  validateNewHopeTrussClearanceCalibration,
  validateNewHopeTrussClearanceSource,
  verifyNewHopeTrussClearanceAdversarialLoop,
} from '../src/engine/new-hope-truss-clearance.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const source = read('new-hope-truss-clearance-source.json');
const calibration = read('new-hope-truss-clearance-calibration.json');

describe('New Hope PDF-bound truss clearance and pipe topology', () => {
  it('binds the actual S102, approved FP2.0, and TFP610 source identities', async () => {
    expect(await sealNewHopeTrussClearanceSource(source)).toEqual(source);
    expect(await validateNewHopeTrussClearanceSource(source)).toMatchObject({ status: 'passed', sourceReady: true, fieldReleaseReady: false });
  });

  it('replays the 22-member S102 lattice and seven approved vector head centers', async () => {
    expect(await buildNewHopeTrussClearanceCalibration(source)).toEqual(calibration);
    expect(calibration.coordinateRegistration).toMatchObject({ structuralScalePdfPtPerFt: 8.883684848, approvedScalePdfPtPerFt: 8.999890909, xRegistrationReady: true, structuralRidgeYRegistrationReady: false });
    expect(calibration.trussLattice).toMatchObject({ detectedCount: 22, nominalSpacingIn: 24, fittedSpacingIn: 23.818462, exactTrussFacePolygonsReady: false });
    expect(calibration.branch.nodes.map((head) => head.localFt.x)).toEqual([4.249274, 10.249346, 16.249419, 22.249492, 28.249565, 34.249526, 40.250043]);
  });

  it('computes a conditional six-inch face-clearance envelope without inventing member width', () => {
    expect(calibration.branch.nodes.map((head) => head.maximumTrussFaceWidthForSixInClearanceIn)).toEqual([10.838384, 11.351219, 12.15425, 8.63475, 8.357149, 7.001581, 6.713313]);
    expect(calibration.conditionalClearance).toMatchObject({ allSevenPassIfMemberFaceWidthAtMostIn: 6.713313, conditionalTrussClearanceReady: true, exactTrussFaceClearanceReady: false });
    expect(calibration.trussLattice.projectSpecificMemberFaceWidthIn).toBeNull();
    expect(calibration.obstructionClearanceReady).toBe(false);
  });

  it('models pipe direction and grade as separate requirements and keeps the unresolved layout closed', () => {
    expect(calibration.branch).toMatchObject({
      pipeSizeIn: 2.5,
      pipeRole: 'ridge-branch-line',
      planDirection: 'D.1-to-E/east-west',
      visibleHydraulicFlowDirection: 'D.1-to-E/west-to-east-from-visible-network-connection',
      visibleTopologyReady: true,
      wholeNetworkTopologyReady: false,
      grade: { branchLinesRiseInPer10Ft: 0.5, branchGradePercent: 0.416667, crossMainsRiseInPer10Ft: 0.25, crossMainGradePercent: 0.208333, boundedBranchGradeDirectionReady: false, startElevationFt: null, endElevationFt: null },
      drainage: { boundedBranchDrainDestinationReady: false, lowPointNodeId: null, drumDripNodeId: null },
      fittingsReady: false,
      properPipeLayoutReady: false,
    });
    expect(calibration.branch.edges).toHaveLength(6);
    expect(calibration.branch.edges.every((edge) => edge.lengthFt === 6 && edge.pipeSizeIn === 2.5)).toBe(true);
    expect(calibration.properPipeLayoutReady).toBe(false);
  });

  it('emits manufacturer demand without assigning an unproved remote-area calculation', () => {
    expect(calibration.hydraulics).toMatchObject({ manufacturerDemandHeadCount: 7, minimumPerHeadFlowGpm: 38, minimumPerHeadPressurePsi: 22.6, minimumManufacturerDemandGpm: 266, completedPlanRemoteAreaIdentityAssigned: false, actualNetworkCalculationReady: false });
    expect(calibration.hydraulicCalculationReady).toBe(false);
  });

  it('rejects a resealed source that changes the actual dry-pipe grade note', async () => {
    const attacked = structuredClone(source);
    attacked.hydraulicEvidence.dryPipeSlopeNote.branchLinesRiseInPer10Ft = 0.25;
    const resealed = await sealNewHopeTrussClearanceSource(attacked);
    expect(await validateNewHopeTrussClearanceSource(resealed)).toMatchObject({ status: 'blocked', issues: expect.arrayContaining([expect.objectContaining({ code: 'NH_TRUSS_HYDRAULIC_EVIDENCE_INVALID' })]) });
  });

  it('uses primary, cross-source, and adversarial system loops with no independent reviewer gate', async () => {
    expect(calibration.internalVerification).not.toHaveProperty('independent');
    expect(await validateNewHopeTrussClearanceCalibration(calibration, source)).toMatchObject({ status: 'passed', calibrationReady: true, fieldReleaseReady: false });
    const adversarial = await verifyNewHopeTrussClearanceAdversarialLoop(calibration, source);
    expect(adversarial).toMatchObject({ status: 'passed', attemptedCases: 26, fieldReleaseReady: false });
    expect(adversarial.rejectedCases).toHaveLength(26);
  });
});

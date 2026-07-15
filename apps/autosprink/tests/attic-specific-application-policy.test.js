import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildAtticSpecificApplicationCalibration,
  sealAtticSpecificApplicationCalibrationSource,
  selectSpecificApplicationAtticModel,
  validateAtticSpecificApplicationCalibration,
  validateAtticSpecificApplicationCalibrationSource,
  verifyAtticSpecificApplicationCalibrationAdversarialLoop,
} from '../src/engine/attic-specific-application-policy.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const source = read('new-hope-attic-specific-application-source.json');
const calibration = read('new-hope-attic-specific-application-calibration.json');

describe('manufacturer- and structure-bound attic specific-application policy', () => {
  it('binds the recovered S102/S301 package and approved TFP610 without promoting freshness', async () => {
    expect(await sealAtticSpecificApplicationCalibrationSource(source)).toEqual(source);
    expect(await validateAtticSpecificApplicationCalibrationSource(source)).toMatchObject({ status: 'passed', calibrationReady: true, freshProjectPlacementVerified: false, complianceReady: false });
  });

  it('selects TY4180 only inside its bound pitch, span, and system envelope', () => {
    expect(selectSpecificApplicationAtticModel({ manufacturerCriteria: source.manufacturerCriteria, roofPitch: { rise: 4, run: 12 }, horizontalRoofSpanFt: 60, systemType: 'dry-steel' })).toMatchObject({ status: 'passed', model: { sin: 'TY4180', minimumFlowGpm: 38, minimumPressurePsi: 22.6, drySystemDemandHeadCount: 7 } });
    expect(selectSpecificApplicationAtticModel({ manufacturerCriteria: source.manufacturerCriteria, roofPitch: { rise: 8, run: 12 }, horizontalRoofSpanFt: 60, systemType: 'dry-steel' })).toMatchObject({ status: 'blocked', issues: [{ code: 'ATTIC_MODEL_PITCH_OUT_OF_RANGE' }] });
    expect(selectSpecificApplicationAtticModel({ manufacturerCriteria: source.manufacturerCriteria, roofPitch: { rise: 4, run: 12 }, horizontalRoofSpanFt: 61, systemType: 'dry-steel' })).toMatchObject({ status: 'blocked', issues: [{ code: 'ATTIC_MODEL_SPAN_OUT_OF_RANGE' }] });
  });

  it('replays seven TY4180 ridge heads and keeps exact Z, obstruction, network hydraulics, and compliance closed', async () => {
    expect(await buildAtticSpecificApplicationCalibration(source)).toEqual(calibration);
    expect(await validateAtticSpecificApplicationCalibration(calibration, source)).toMatchObject({ status: 'passed', calibrationReady: true, freshProjectPlacementVerified: false, complianceReady: false });
    expect(calibration.heads.map((head) => head.localFt)).toEqual([4, 10, 16, 22, 28, 34, 40].map((x) => ({ x, y: 30.375 })));
    expect(calibration.hydraulics).toMatchObject({ systemType: 'dry-steel', manufacturerDemandHeadCount: 7, minimumPerHeadFlowGpm: 38, minimumPerHeadPressurePsi: 22.6, minimumRemoteSprinklerFlowGpm: 266, actualNetworkCalculationReady: false });
    expect(calibration.heads.every((head) => head.headInstallationZFt === null && head.trussFaceClearanceVerified === false && head.obstructionClearanceVerified === false && head.hydraulicNodeAssigned === false)).toBe(true);
  });

  it('uses system-owned loops and rejects every mutation without an independent gate', async () => {
    expect(calibration.internalVerification).not.toHaveProperty('independent');
    const result = await verifyAtticSpecificApplicationCalibrationAdversarialLoop(calibration, source);
    expect(result).toMatchObject({ status: 'passed', attemptedCases: 15, complianceReady: false });
    expect(result.rejectedCases).toHaveLength(15);
  });
});

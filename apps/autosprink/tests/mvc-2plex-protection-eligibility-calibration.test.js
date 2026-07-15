import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildMvcProtectionEligibilityCalibration,
  validateMvcProtectionEligibilityCalibration,
  verifyMvcProtectionEligibilityAdversarialLoop,
} from '../src/engine/mvc-2plex-protection-eligibility-calibration.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const source = read('mvc-2plex-barrel-holdout-source.json');
const candidate = read('mvc-2plex-barrel-holdout-candidate.json');
const answer = read('mvc-2plex-barrel-holdout-answer-evidence.json');
const score = read('mvc-2plex-barrel-holdout-score.json');
const calibration = read('mvc-2plex-protection-eligibility-calibration.json');

describe('MVC 2-Plex answer-exposed protection eligibility calibration', () => {
  it('fails closed before target generation when no occupied/protected footprint supports the roof projection', async () => {
    expect(await buildMvcProtectionEligibilityCalibration(source, candidate, answer, score)).toEqual(calibration);
    expect(await validateMvcProtectionEligibilityCalibration(calibration, source, candidate, answer, score)).toMatchObject({ status: 'passed', targetGenerationEligible: false, freshProjectPlacementVerified: false, complianceReady: false });
    expect(calibration.protectionEligibilityAudit).toMatchObject({ status: 'blocked', issues: [{ code: 'SOURCE_PROTECTION_ELIGIBILITY_DECLARATION_MISSING', sourceVolumeId: 'third-level-c-d-10-12-barrel-bay' }] });
    expect(calibration.replay).toEqual({ frozenCandidateTargetCount: 2, excludedTargetCount: 2, calibratedTargetCount: 0, targets: [] });
  });

  it('labels MVC as answer-exposed calibration and keeps every downstream claim closed', () => {
    expect(calibration.calibrationStatus).toBe('answer-exposed-not-fresh-holdout');
    expect(calibration.internalVerification).toMatchObject({ primary: { status: 'passed' }, crossSource: { status: 'passed' }, adversarial: { status: 'passed' } });
    expect(calibration.internalVerification).not.toHaveProperty('independent');
    expect(calibration).toMatchObject({ freshProjectPlacementVerified: false, exactHeadElevationReady: false, obstructionClearanceReady: false, hydraulicCalculationReady: false, complianceReady: false, fabricationReady: false, fieldReleaseReady: false });
  });

  it('rejects every eligibility, target, receipt, and false-promotion mutation', async () => {
    const result = await verifyMvcProtectionEligibilityAdversarialLoop(calibration, source, candidate, answer, score);
    expect(result).toMatchObject({ status: 'passed', attemptedCases: 17, freshProjectPlacementVerified: false, complianceReady: false });
    expect(result.rejectedCases).toHaveLength(17);
  });
});

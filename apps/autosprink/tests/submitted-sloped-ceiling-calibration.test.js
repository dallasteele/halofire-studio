import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { sealSubmittedSlopedCeilingCalibration, validateSubmittedSlopedCeilingCalibration, renderSubmittedSlopedCeilingCalibration } from '../src/engine/submitted-sloped-ceiling-calibration.js';

const packet = JSON.parse(fs.readFileSync(new URL('../src/data/submitted-sloped-ceiling-calibration.dillon.json', import.meta.url), 'utf8'));
const reseal = async (change) => { const draft = structuredClone(packet); delete draft.evidenceReceiptSha256; change(draft); return sealSubmittedSlopedCeilingCalibration(draft); };

describe('Dillon submitted sloped-ceiling calibration', () => {
  it('registers completed FP-1 head candidates against source 3:12 RCP annotations', async () => {
    const result = await validateSubmittedSlopedCeilingCalibration(packet);
    expect(result.status).toBe('passed');
    expect(result.counts.submittedScheduleHeads).toBe(52);
    expect(result.counts.vectorCandidates).toBe(50);
    expect(result.counts.positiveAnnotationProximityMatches).toBeGreaterThanOrEqual(3);
    expect(result.slopeEvidenceReady).toBe(true);
    expect(result.fullSlopeSurfaceRegistrationReady).toBe(false);
    expect(result.generatedLayoutParityReady).toBe(false);
    expect(result.complianceReady).toBe(false);
  });

  it('renders only after the immutable evidence loop passes', async () => {
    const view = renderSubmittedSlopedCeilingCalibration(await validateSubmittedSlopedCeilingCalibration(packet));
    expect(view.status).toBe('passed');
    expect((view.topSvg.match(/data-head-id=/g) || [])).toHaveLength(50);
    expect((view.topSvg.match(/data-slope-id=/g) || [])).toHaveLength(8);
  });

  it('adversarially rejects receipt, registration, slope-point, and elevation drift', async () => {
    const tampered = structuredClone(packet); tampered.submittedHeads[0].pointPt[0] += 10;
    expect((await validateSubmittedSlopedCeilingCalibration(tampered)).issues.map((issue) => issue.code)).toContain('SLOPED_CALIBRATION_RECEIPT_MISMATCH');
    const badControl = await reseal((draft) => { draft.registration.controls[0].xOffsetPt += 5; });
    expect((await validateSubmittedSlopedCeilingCalibration(badControl)).issues.map((issue) => issue.code)).toContain('SLOPED_CALIBRATION_CONTROL_DISAGREEMENT');
    const badSlope = await reseal((draft) => { draft.ceilingSlopeAnnotations[0].registeredSubmittedPointPt[0] += 20; });
    expect((await validateSubmittedSlopedCeilingCalibration(badSlope)).issues.map((issue) => issue.code)).toContain('SLOPED_CALIBRATION_SLOPE_POINT_DRIFT');
    const badElevation = await reseal((draft) => { draft.hydraulicEvidence = draft.hydraulicEvidence.filter((entry) => entry.elevationFt !== 22); });
    expect((await validateSubmittedSlopedCeilingCalibration(badElevation)).issues.map((issue) => issue.code)).toContain('SLOPED_CALIBRATION_ELEVATION_COVERAGE');
  });
});

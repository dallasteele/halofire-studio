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
    expect(result.counts).toMatchObject({ vectorCandidates: 51, fp1VectorCandidates: 51, fp2ContinuationCandidates: 0, unresolvedHeadSymbols: 1 });
    expect(result.counts.positiveAnnotationProximityMatches).toBeGreaterThanOrEqual(3);
    expect(result.slopeEvidenceReady).toBe(true);
    expect(result.fullSlopeSurfaceRegistrationReady).toBe(true);
    expect(result.generatedLayoutParityReady).toBe(false);
    expect(result.complianceReady).toBe(false);
    expect(packet.coverage.complete).toBe(false);
    expect(packet.coverage.detectedVectorCandidates).toBe(51);
    expect(packet.coverage.unresolved[0]).toContain('FP-2 is a separate 25-head upper-level schedule');
    expect(packet.continuationHeads).toEqual([]);
  });

  it('renders only after the immutable evidence loop passes', async () => {
    const view = renderSubmittedSlopedCeilingCalibration(await validateSubmittedSlopedCeilingCalibration(packet));
    expect(view.status).toBe('passed');
    expect((view.topSvg.match(/data-head-id=/g) || [])).toHaveLength(51);
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
    const badRegion = await reseal((draft) => { draft.slopeRegions[0].polygonSubmittedPt[0][0] += 20; });
    expect((await validateSubmittedSlopedCeilingCalibration(badRegion)).issues.map((issue) => issue.code)).toContain('SLOPED_CALIBRATION_REGION_TRANSFORM_DRIFT');
    const badObstruction = await reseal((draft) => { draft.slopeRegions[1].obstructions[0].centerSubmittedPt[0] += 20; });
    expect((await validateSubmittedSlopedCeilingCalibration(badObstruction)).issues.map((issue) => issue.code)).toContain('SLOPED_CALIBRATION_OBSTRUCTION_TRANSFORM_DRIFT');
    const badDatum = await reseal((draft) => { draft.slopeRegions[1].elevationDatum.datumPointSubmittedPt[1] += 20; });
    expect((await validateSubmittedSlopedCeilingCalibration(badDatum)).issues.map((issue) => issue.code)).toContain('SLOPED_CALIBRATION_DATUM_TRANSFORM_DRIFT');
    const badHydraulicDatum = await reseal((draft) => { draft.hydraulicDatumJoin.activeNodes[0].projectElevationFt += 1; });
    expect((await validateSubmittedSlopedCeilingCalibration(badHydraulicDatum)).issues.map((issue) => issue.code)).toContain('SLOPED_CALIBRATION_HYDRAULIC_DATUM_JOIN_INVALID');
    const badCount = await reseal((draft) => { draft.submittedHeads.pop(); });
    expect((await validateSubmittedSlopedCeilingCalibration(badCount)).issues.map((issue) => issue.code)).toContain('SLOPED_CALIBRATION_HEAD_COUNT_DRIFT');
  });
});

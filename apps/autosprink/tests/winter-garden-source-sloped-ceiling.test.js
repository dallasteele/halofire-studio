import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  sealWinterGardenSourceSlopedCeiling,
  sourceSlopedCeilingElevationFt,
  validateWinterGardenSourceSlopedCeiling,
} from '../src/engine/winter-garden-source-sloped-ceiling.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const packet = read('winter-garden-source-sloped-ceiling.json');
const registry = read('winter-garden-source-space-registry.json');
const building = read('winter-garden-source-building-model.json');
const dependencies = { registry, building };
const codes = (result) => result.issues.map((entry) => entry.code);

describe('Winter Garden source-only sloped ceiling', () => {
  it('seals the A301 3:12 interior profile without substituting the 4.5:12 roof', async () => {
    const result = await validateWinterGardenSourceSlopedCeiling(packet, dependencies);
    expect(result.status).toBe('passed');
    expect(packet.profile).toMatchObject({ pitchRunIn: 12, plateauWidthFt: 10.406667, slopeRunFt: 15.23, slopeRiseFt: 3.806667 });
    expect(packet.profile.pitchRiseIn).toBeCloseTo(3, 2);
    expect(packet.sectionEvidence).toMatchObject({ roofPitchRiseIn: 4.5, ceilingPitchDerivedFromRoof: false });
    expect(packet.generation.answerKeyUsed).toBe(false);
    expect(packet.generation.completedBidUsedForGeneration).toBe(false);
  });

  it('reconciles independent C3 and C4 finish elevations to the A303 truss datum', () => {
    const finishes = new Map(packet.finishes.map((finish) => [finish.finishType, finish]));
    expect(finishes.get('C4')).toMatchObject({ highElevationFt: 119.447917, trussClearanceIn: 0.625 });
    expect(finishes.get('C3')).toMatchObject({ highElevationFt: 119.385417, trussClearanceIn: 1.375 });
    expect(sourceSlopedCeilingElevationFt(packet.profile, finishes.get('C4'), packet.profile.plateauSouthYFt)).toBe(119.447917);
    expect(sourceSlopedCeilingElevationFt(packet.profile, finishes.get('C4'), packet.profile.southLowYFt)).toBeCloseTo(115.64125, 5);
  });

  it('clips source surface envelopes across all three sloped rooms while preserving boundary uncertainty', () => {
    expect(packet.surfaces).toHaveLength(6);
    expect([...new Set(packet.surfaces.map((surface) => surface.roomNumber))]).toEqual(['148', '149', '150']);
    expect(packet.surfaces.every((surface) => surface.boundaryCompleteness === 'unverified')).toBe(true);
    expect(packet.roomBoundaryComplete).toBe(false);
    expect(packet.pitchedSprinklerLayoutReady).toBe(false);
    expect(packet.complianceReady).toBe(false);
  });

  it('rejects receipt, source, profile, answer-key, and readiness tampering', async () => {
    const cases = [
      ['WG_SOURCE_SLOPED_CEILING_RECEIPT_MISMATCH', (value) => { value.profile.pitchRiseIn = 4.5; }, false],
      ['WG_SOURCE_SLOPED_CEILING_SOURCE_DRIFT', (value) => { value.sources.A301.sha256 = '0'.repeat(64); }, true],
      ['WG_SOURCE_SLOPED_CEILING_ROOF_OR_ANSWER_KEY_LEAKAGE', (value) => { value.generation.answerKeyUsed = true; }, true],
      ['WG_SOURCE_SLOPED_CEILING_FAIL_CLOSED_STATUS_DRIFT', (value) => { value.complianceReady = true; }, true],
    ];
    for (const [expected, mutate, reseal] of cases) {
      const value = structuredClone(packet); mutate(value);
      const candidate = reseal ? await sealWinterGardenSourceSlopedCeiling(value) : value;
      expect(codes(await validateWinterGardenSourceSlopedCeiling(candidate, dependencies))).toContain(expected);
    }
  });

  it('records primary, independent, and adversarial loops without an external reviewer gate', () => {
    expect(packet.internalVerification).toMatchObject({ primary: { status: 'passed' }, independent: { status: 'passed' }, adversarial: { status: 'passed' } });
    expect(packet.internalVerification.adversarial.rejectedCases).toContain('4.5:12-roof-pitch-substituted-for-3:12-interior-ceiling');
    expect(packet.internalVerification.adversarial.rejectedCases).toContain('flat-ridge-strip-discarded-as-simple-gable');
  });
});

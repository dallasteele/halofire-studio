import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { evaluateNewHopeWetWeldedMainRegistrationEvidence } from '../src/engine/new-hope-wet-welded-main-registration.js';

const source = () => JSON.parse(readFileSync(fileURLToPath(new URL('../src/data/new-hope-wet-welded-main-registration-evidence.json', import.meta.url)), 'utf8'));

describe('New Hope welded wet-main plan registration', () => {
  it('maps all 28 labeled main pieces while retaining three T-1 and 67 threaded holdouts', () => {
    const result = evaluateNewHopeWetWeldedMainRegistrationEvidence(source());
    expect(result.status).toBe('passed');
    expect(result.mappings).toHaveLength(28);
    expect(result.holdouts.map((row) => row.instanceId)).toEqual(['T-1-415', 'T-1-416', 'T-1-421']);
    expect(result.metrics).toEqual(expect.objectContaining({ mappedHeavyCenterlineCount: 25, mappedAlternateCenterlineCount: 3, combinedMappedUnitCount: 99, globalPieceVectorUnmappedUnitCount: 70, threadedHoldoutCount: 67 }));
    expect(result.weldedMainLabeledPieceToPlanMappingReady).toBe(true);
    expect(result.completeWeldedMainPieceToPlanMappingReady).toBe(false);
    expect(result.pieceToPlanVectorMappingReady).toBe(false);
    expect(result.fabricationReady).toBe(false);
  });

  it('rejects a moved field label', () => {
    const input = source();
    input.mappings[0].pieceLabelBoxPdfPt[0] += 1;
    expect(evaluateNewHopeWetWeldedMainRegistrationEvidence(input).issues.map((entry) => entry.code)).toContain('NH_WET_MAIN_REGISTRATION_FINGERPRINT_INVALID');
  });

  it('rejects duplicate use of one source centerline', () => {
    const input = source();
    input.mappings[1].sourceCenterline = structuredClone(input.mappings[0].sourceCenterline);
    expect(evaluateNewHopeWetWeldedMainRegistrationEvidence(input).issues.map((entry) => entry.code)).toEqual(expect.arrayContaining(['NH_WET_MAIN_REGISTRATION_FINGERPRINT_INVALID', 'NH_WET_MAIN_MAPPING_COVERAGE_INVALID']));
  });

  it('rejects a diameter-scaled heavy width mismatch', () => {
    const input = source();
    input.mappings[0].sourceCenterline.widthPt = 2.48119;
    expect(evaluateNewHopeWetWeldedMainRegistrationEvidence(input).issues.map((entry) => entry.code)).toContain('NH_WET_MAIN_MAPPING_NOT_CLOSED');
  });

  it('rejects loss of alternate red-white twin parity', () => {
    const input = source();
    const alternate = input.mappings.find((row) => row.instanceId === 'CMC.06');
    delete alternate.sourceCenterline.fieldWhiteDrawingIndex;
    expect(evaluateNewHopeWetWeldedMainRegistrationEvidence(input).issues.map((entry) => entry.code)).toContain('NH_WET_MAIN_MAPPING_NOT_CLOSED');
  });

  it('rejects removal of the printed dimension exception for CMC.06 or CMC.08', () => {
    for (const pieceId of ['CMC.06', 'CMC.08']) {
      const input = source();
      delete input.mappings.find((row) => row.instanceId === pieceId).printedDimensionEvidence;
      expect(evaluateNewHopeWetWeldedMainRegistrationEvidence(input).issues.map((entry) => entry.code)).toContain('NH_WET_MAIN_MAPPING_NOT_CLOSED');
    }
  });

  it('rejects a missing or promoted T-1 holdout', () => {
    const input = source();
    input.holdouts.pop();
    expect(evaluateNewHopeWetWeldedMainRegistrationEvidence(input).issues.map((entry) => entry.code)).toContain('NH_WET_MAIN_TYPICAL_HOLDOUT_INVALID');
  });

  it('rejects an ambiguous label-to-centerline association', () => {
    const input = source();
    input.mappings.find((row) => row.instanceId === 'CMA.03').pieceLabelCenterlineUniquenessGapPt = 1;
    expect(evaluateNewHopeWetWeldedMainRegistrationEvidence(input).issues.map((entry) => entry.code)).toContain('NH_WET_MAIN_MAPPING_NOT_CLOSED');
  });

  it('rejects any global, direction, grade, takeout, elevation, fabrication, or field promotion', () => {
    for (const claim of ['completeWeldedMainPieceToPlanMappingReady', 'pieceToPlanVectorMappingReady', 'nativeStationDirectionReady', 'hydraulicFlowDirectionReady', 'gradeReady', 'fittingTakeoutReady', 'installedElevationReady', 'fabricationReady', 'fieldReleaseReady']) {
      const input = source();
      input.claims[claim] = true;
      expect(evaluateNewHopeWetWeldedMainRegistrationEvidence(input).status).toBe('blocked');
    }
  });
});

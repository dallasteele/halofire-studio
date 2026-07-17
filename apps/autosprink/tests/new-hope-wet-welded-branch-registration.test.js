import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { evaluateNewHopeWetWeldedBranchRegistrationEvidence } from '../src/engine/new-hope-wet-welded-branch-registration.js';

const source = () => JSON.parse(readFileSync(fileURLToPath(new URL('../src/data/new-hope-wet-welded-branch-registration-evidence.json', import.meta.url)), 'utf8'));

describe('New Hope welded branch piece registration', () => {
  it('maps all 71 welded branch units from 67 heavy and four alternate source centerlines while retaining 15 source-registered station directions without global promotion', () => {
    const result = evaluateNewHopeWetWeldedBranchRegistrationEvidence(source());
    expect(result.status).toBe('passed');
    expect(result.pieceVectorMappings).toHaveLength(71);
    expect(result.pieceVectorHoldouts).toHaveLength(0);
    expect(result.registrations).toHaveLength(15);
    expect(result.unresolved).toHaveLength(56);
    expect(result.metrics).toEqual(expect.objectContaining({ pieceVectorMappedUnitCount: 71, pieceVectorMappedHeavyCenterlineCount: 67, pieceVectorMappedAlternateCenterlineCount: 4, mappedNativeOutletCount: 36, maxOutletResidualIn: 0.194824, globalListedUnitCount: 169, globalPieceVectorUnmappedUnitCount: 98 }));
    expect(result.weldedBranchPieceVectorBijectionReady).toBe(true);
    expect(result.scopedPieceToPlanVectorMappingReady).toBe(true);
    expect(result.scopedFabricationStationDirectionReady).toBe(true);
    expect(result.completeWeldedBranchPieceMappingReady).toBe(true);
    expect(result.hydraulicFlowDirectionReady).toBe(false);
    expect(result.gradeReady).toBe(false);
    expect(result.fabricationReady).toBe(false);
  });

  it('rejects a moved piece label', () => {
    const input = source();
    input.labelInstances[0].pieceLabelBoxPdfPt[0] += 1;
    expect(evaluateNewHopeWetWeldedBranchRegistrationEvidence(input).issues.map((entry) => entry.code)).toContain('NH_WET_BRANCH_REGISTRATION_FINGERPRINT_INVALID');
  });

  it('rejects an outlet residual beyond the quarter-inch gate', () => {
    const input = source();
    input.registrations[0].mappedOutlets[0].residualIn = 0.3;
    const result = evaluateNewHopeWetWeldedBranchRegistrationEvidence(input);
    expect(result.status).toBe('blocked');
    expect(result.issues.map((entry) => entry.code)).toEqual(expect.arrayContaining(['NH_WET_BRANCH_REGISTRATION_FINGERPRINT_INVALID', 'NH_WET_BRANCH_REGISTRATION_NOT_CLOSED']));
  });

  it('rejects cut-vector length drift', () => {
    const input = source();
    input.registrations[4].fabricationCutVector.toPdfPt[0] += 1;
    expect(evaluateNewHopeWetWeldedBranchRegistrationEvidence(input).issues.map((entry) => entry.code)).toContain('NH_WET_BRANCH_REGISTRATION_NOT_CLOSED');
  });

  it('rejects duplicate use of one source centerline in the 71-unit bijection', () => {
    const input = source();
    input.pieceVectorMappings[1].sourceCenterline = structuredClone(input.pieceVectorMappings[0].sourceCenterline);
    const result = evaluateNewHopeWetWeldedBranchRegistrationEvidence(input);
    expect(result.issues.map((entry) => entry.code)).toEqual(expect.arrayContaining(['NH_WET_BRANCH_REGISTRATION_FINGERPRINT_INVALID', 'NH_WET_BRANCH_PIECE_VECTOR_COVERAGE_INVALID']));
  });

  it('rejects a piece-vector cut-span closure beyond three inches', () => {
    const input = source();
    input.pieceVectorMappings[0].sourceCenterline.toPdfPt[0] += 1;
    const result = evaluateNewHopeWetWeldedBranchRegistrationEvidence(input);
    expect(result.issues.map((entry) => entry.code)).toEqual(expect.arrayContaining(['NH_WET_BRANCH_REGISTRATION_FINGERPRINT_INVALID', 'NH_WET_BRANCH_PIECE_VECTOR_NOT_CLOSED']));
  });

  it('rejects dropping one of the four alternate BL03 or BL04 mappings', () => {
    const input = source();
    input.pieceVectorMappings = input.pieceVectorMappings.filter((row) => row.instanceId !== 'BL03.01');
    const result = evaluateNewHopeWetWeldedBranchRegistrationEvidence(input);
    expect(result.issues.map((entry) => entry.code)).toContain('NH_WET_BRANCH_PIECE_VECTOR_COVERAGE_INVALID');
  });

  it('rejects loss of exact black-white twin source parity', () => {
    const input = source();
    const alternate = input.pieceVectorMappings.find((row) => row.instanceId === 'BL03.01');
    delete alternate.sourceCenterline.fieldWhiteDrawingIndex;
    const result = evaluateNewHopeWetWeldedBranchRegistrationEvidence(input);
    expect(result.issues.map((entry) => entry.code)).toEqual(expect.arrayContaining(['NH_WET_BRANCH_REGISTRATION_FINGERPRINT_INVALID', 'NH_WET_BRANCH_PIECE_VECTOR_NOT_CLOSED']));
  });

  it('rejects BL03 or BL04 text-order association in place of exact source-spatial grouping', () => {
    const input = source();
    const alternate = input.pieceVectorMappings.find((row) => row.instanceId === 'BL04.02');
    alternate.labelAssociationBasis = 'pdf-text-order-with-line-label-fallback';
    const result = evaluateNewHopeWetWeldedBranchRegistrationEvidence(input);
    expect(result.issues.map((entry) => entry.code)).toEqual(expect.arrayContaining(['NH_WET_BRANCH_REGISTRATION_FINGERPRINT_INVALID', 'NH_WET_BRANCH_PIECE_VECTOR_NOT_CLOSED']));
  });

  it('rejects dropping a direction-registered unit into the direction holdout set', () => {
    const input = source();
    input.unresolved.push(input.registrations.pop());
    expect(evaluateNewHopeWetWeldedBranchRegistrationEvidence(input).issues.map((entry) => entry.code)).toContain('NH_WET_BRANCH_REGISTRATION_COVERAGE_INVALID');
  });

  it('rejects any complete, hydraulic, grade, elevation, fabrication, or field promotion', () => {
    for (const claim of ['pieceToPlanVectorMappingReady', 'hydraulicFlowDirectionReady', 'gradeReady', 'installedElevationReady', 'fabricationReady', 'fieldReleaseReady']) {
      const input = source();
      input.claims[claim] = true;
      expect(evaluateNewHopeWetWeldedBranchRegistrationEvidence(input).status).toBe('blocked');
    }
  });
});

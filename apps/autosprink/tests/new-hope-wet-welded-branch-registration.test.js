import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { evaluateNewHopeWetWeldedBranchRegistrationEvidence } from '../src/engine/new-hope-wet-welded-branch-registration.js';

const source = () => JSON.parse(readFileSync(fileURLToPath(new URL('../src/data/new-hope-wet-welded-branch-registration-evidence.json', import.meta.url)), 'utf8'));

describe('New Hope welded branch piece registration', () => {
  it('maps 67 of 71 welded branch units bijectively and retains 15 source-registered station directions without global promotion', () => {
    const result = evaluateNewHopeWetWeldedBranchRegistrationEvidence(source());
    expect(result.status).toBe('passed');
    expect(result.pieceVectorMappings).toHaveLength(67);
    expect(result.pieceVectorHoldouts.map((row) => row.instanceId)).toEqual(['BL03.01', 'BL03.02', 'BL04.01', 'BL04.02']);
    expect(result.registrations).toHaveLength(15);
    expect(result.unresolved).toHaveLength(56);
    expect(result.metrics).toEqual(expect.objectContaining({ pieceVectorMappedUnitCount: 67, pieceVectorMappedHeavyCenterlineCount: 67, mappedNativeOutletCount: 36, maxOutletResidualIn: 0.194824, globalListedUnitCount: 169, globalPieceVectorUnmappedUnitCount: 102 }));
    expect(result.weldedBranchPieceVectorBijectionReady).toBe(true);
    expect(result.scopedPieceToPlanVectorMappingReady).toBe(true);
    expect(result.scopedFabricationStationDirectionReady).toBe(true);
    expect(result.completeWeldedBranchPieceMappingReady).toBe(false);
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

  it('rejects duplicate use of one source centerline in the 67-unit bijection', () => {
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

  it('rejects promotion of a BL03 or BL04 holdout into the mapped set', () => {
    const input = source();
    input.pieceVectorMappings.push(input.pieceVectorHoldouts.pop());
    const result = evaluateNewHopeWetWeldedBranchRegistrationEvidence(input);
    expect(result.issues.map((entry) => entry.code)).toContain('NH_WET_BRANCH_PIECE_VECTOR_COVERAGE_INVALID');
  });

  it('rejects dropping a direction-registered unit into the direction holdout set', () => {
    const input = source();
    input.unresolved.push(input.registrations.pop());
    expect(evaluateNewHopeWetWeldedBranchRegistrationEvidence(input).issues.map((entry) => entry.code)).toContain('NH_WET_BRANCH_REGISTRATION_COVERAGE_INVALID');
  });

  it('rejects any complete, hydraulic, grade, elevation, fabrication, or field promotion', () => {
    for (const claim of ['completeWeldedBranchPieceMappingReady', 'pieceToPlanVectorMappingReady', 'hydraulicFlowDirectionReady', 'gradeReady', 'installedElevationReady', 'fabricationReady', 'fieldReleaseReady']) {
      const input = source();
      input.claims[claim] = true;
      expect(evaluateNewHopeWetWeldedBranchRegistrationEvidence(input).status).toBe('blocked');
    }
  });
});

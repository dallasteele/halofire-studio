import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateNewHopeWetLevel1NetworkEvidence } from '../src/engine/new-hope-wet-level1-network-evidence.js';

const source = () => JSON.parse(readFileSync(fileURLToPath(new URL('../src/data/new-hope-wet-level1-network-evidence.json', import.meta.url)), 'utf8'));

describe('New Hope Level 1 wet-network evidence', () => {
  it('replays source-typed threaded plan evidence while keeping the complete network blocked', () => {
    const result = validateNewHopeWetLevel1NetworkEvidence(source());
    expect(result.status).toBe('passed');
    expect(result.wetSystemNetwork2dReady).toBe(false);
    expect(result.sourceTypedThreadedPlanSegmentsReady).toBe(true);
    expect(result.legacyAnnotationVectorsRejected).toBe(true);
    expect(result.sprinklerHeadPositions2dReady).toBe(true);
    expect(result.headTypeAssignmentReady).toBe(true);
    expect(result.nativeFabricationTakeoffReady).toBe(true);
    expect(result.wetPipeVectors).toHaveLength(53);
    expect(result.sprinklerHeads).toHaveLength(174);
    expect(result.nativeFabricationLines).toHaveLength(50);
    expect(result.metrics).toEqual(expect.objectContaining({
      acceptedThreadedPlanSegmentCount: 53,
      exactThreadedPiecePlanMappingCount: 24,
      ambiguousThreadedPiecePlanSegmentCount: 29,
      rejectedBlueSourceLineworkCount: 5,
      legacyAnnotationLikeVectorCount: 300,
      crossSourcePipeVectorMatchCount: 53,
      crossSourcePipeMaxResidualPt: 0,
      crossSourceHeadMatchCount: 174,
      crossSourceHeadMaxResidualPt: 0.0094,
      headTypeCounts: { TY3231: 164, V3506: 6, TY3131: 4 },
      pieceCount: 167,
      outletCount: 217,
      totalCutLengthFt: 1477.333333,
    }));
  });

  it('rejects one changed pipe coordinate', () => {
    const evidence = source();
    evidence.wetPipeVectors[24].fromPdfPt.y += 0.5;
    const result = validateNewHopeWetLevel1NetworkEvidence(evidence);
    expect(result.status).toBe('blocked');
    expect(result.issues.map((entry) => entry.code)).toContain('NH_WET_LEVEL1_PIPE_GEOMETRY_INVALID');
    expect(result.wetSystemNetwork2dReady).toBe(false);
  });

  it('rejects promotion of the former 300 annotation vectors', () => {
    const evidence = source();
    evidence.legacyAnnotationLikeVectorClass.classification = 'pipe-network';
    const result = validateNewHopeWetLevel1NetworkEvidence(evidence);
    expect(result.status).toBe('blocked');
    expect(result.issues.map((entry) => entry.code)).toContain('NH_WET_LEVEL1_LEGACY_ANNOTATION_REJECTION_INVALID');
  });

  it('rejects acceptance of a non-reconciling blue source stroke', () => {
    const evidence = source();
    evidence.rejectedBlueSourceLinework[0].rejectionReason = 'accepted';
    const result = validateNewHopeWetLevel1NetworkEvidence(evidence);
    expect(result.status).toBe('blocked');
    expect(result.issues.map((entry) => entry.code)).toContain('NH_WET_LEVEL1_REJECTED_LINEWORK_INVALID');
  });

  it('rejects a missing or moved sprinkler head', () => {
    const evidence = source();
    evidence.sprinklerHeads[12].pdfPt.x += 0.1;
    const result = validateNewHopeWetLevel1NetworkEvidence(evidence);
    expect(result.status).toBe('blocked');
    expect(result.issues.map((entry) => entry.code)).toContain('NH_WET_LEVEL1_HEAD_EVIDENCE_INVALID');
    expect(result.sprinklerHeadPositions2dReady).toBe(false);
  });

  it('rejects a per-head native symbol type mutation', () => {
    const evidence = source();
    evidence.sprinklerHeads[0].headType.sin = 'V3506';
    const result = validateNewHopeWetLevel1NetworkEvidence(evidence);
    expect(result.status).toBe('blocked');
    expect(result.issues.map((entry) => entry.code)).toContain('NH_WET_LEVEL1_HEAD_EVIDENCE_INVALID');
    expect(result.headTypeAssignmentReady).toBe(false);
  });

  it('rejects demotion of the proven per-head type assignment', () => {
    const evidence = source();
    evidence.claims.headTypeAssignmentReady = false;
    const result = validateNewHopeWetLevel1NetworkEvidence(evidence);
    expect(result.status).toBe('blocked');
    expect(result.issues.map((entry) => entry.code)).toContain('NH_WET_LEVEL1_FALSE_PROMOTION');
  });

  it('rejects native fabrication length drift', () => {
    const evidence = source();
    evidence.nativeFabricationLines[0].pieces[0].cutLengthFt += 1;
    const result = validateNewHopeWetLevel1NetworkEvidence(evidence);
    expect(result.status).toBe('blocked');
    expect(result.issues.map((entry) => entry.code)).toContain('NH_WET_LEVEL1_NATIVE_TAKEOFF_INVALID');
    expect(result.nativeFabricationTakeoffReady).toBe(false);
  });

  it.each([
    'wetSystemNetwork2dReady',
    'completeThreadedPiecePlanMappingReady',
    'pieceToPlanVectorMappingReady',
    'pipeDirectionReady',
    'pipeGradeReady',
    'installedElevationReady',
    'wetSystemInstallation3dReady',
    'fabricationReleaseReady',
    'fieldReleaseReady',
  ])('rejects false promotion of %s', (claim) => {
    const evidence = source();
    evidence.claims[claim] = true;
    const result = validateNewHopeWetLevel1NetworkEvidence(evidence);
    expect(result.status).toBe('blocked');
    expect(result.issues.map((entry) => entry.code)).toContain('NH_WET_LEVEL1_FALSE_PROMOTION');
  });
});

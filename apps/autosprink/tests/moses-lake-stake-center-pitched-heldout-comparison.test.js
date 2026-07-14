import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildMosesLakeHeldoutComparison,
  renderMosesLakeHeldoutOverlaySvg,
  validateMosesLakeHeldoutComparison,
  verifyMosesLakeHeldoutAdversarialLoop,
} from '../src/engine/moses-lake-stake-center-pitched-heldout-comparison.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const sourceCandidate = read('moses-lake-stake-center-source-only-pitched-candidate.json');
const comparison = read('moses-lake-stake-center-pitched-heldout-comparison.json');

describe('Moses Lake Stake Center pitched heldout comparison', () => {
  it('opens approved and as-built answers only after the immutable source-only commit', async () => {
    expect(await buildMosesLakeHeldoutComparison(sourceCandidate)).toEqual(comparison);
    expect(comparison.sequence).toMatchObject({
      sourceCandidateCommit: '919a6bf9877ba606ae286f43fcf0a2d2785dbdd4',
      sourceCandidateReceiptSha256: '2df8931bdfa0b9b8f05e0b558421b89c8be644a8bc2f4403e5b70c7604908baa',
      approvedAndAsBuiltOpenedAfterSourceCommit: true,
      answersUsedToGenerateSourceCandidate: false,
    });
  });

  it('independently confirms six approved drops and exact as-built parity in a two-by-three Cultural Center pattern', () => {
    expect(comparison.approvedEvidence.primary).toMatchObject({ status: 'passed', detectedCount: 6 });
    expect(comparison.approvedEvidence.independent).toMatchObject({ status: 'passed', detectedCount: 6, rawCandidateCount: 197, maximumVectorResidualPt: 1.302598 });
    expect(comparison.approvedEvidence.asBuiltParity).toMatchObject({ status: 'passed', detectedCount: 6, centersEqualApproved: true });
    expect(comparison.approvedEvidence.primary.heads).toHaveLength(6);
  });

  it('records the twelve-versus-six failure while preserving the correct occupied-sloped-ceiling classification', async () => {
    expect(await validateMosesLakeHeldoutComparison(comparison, sourceCandidate)).toMatchObject({ status: 'passed', heldoutComparisonReady: true, unseenProjectPlacementVerified: false, complianceReady: false });
    expect(comparison.prediction).toMatchObject({ headCount: 12, uniqueAlongRidgeStations: 4, uniqueAcrossSlopeStations: 3 });
    expect(comparison.approved).toEqual({ headCount: 6, uniqueAlongRidgeStations: 2, uniqueAcrossSlopeStations: 3 });
    expect(comparison.result).toMatchObject({ status: 'failed', occupiedSlopedCeilingClassificationVerified: true, approvedDropsServeOccupiedSlopedCulturalCenter: true, approvedAndAsBuiltParityVerified: true, exactPlacementPatternVerified: false, countDelta: 6 });
    expect(comparison.unseenProjectPlacementVerified).toBe(false);
    expect(comparison.complianceReady).toBe(false);
  });

  it('keeps approximate location coverage separate from exact topology and count acceptance', () => {
    expect(comparison.comparisons.map(({ toleranceFt, matchedCount, precision, recall, falsePositiveCandidateCount, parityPassed }) => ({ toleranceFt, matchedCount, precision, recall, falsePositiveCandidateCount, parityPassed }))).toEqual([
      { toleranceFt: 0.5, matchedCount: 0, precision: 0, recall: 0, falsePositiveCandidateCount: 12, parityPassed: false },
      { toleranceFt: 1, matchedCount: 2, precision: 0.166667, recall: 0.333333, falsePositiveCandidateCount: 10, parityPassed: false },
      { toleranceFt: 1.5, matchedCount: 6, precision: 0.5, recall: 1, falsePositiveCandidateCount: 6, parityPassed: false },
    ]);
  });

  it('renders an explicit failure overlay and rejects seventeen adversarial mutations', async () => {
    const svg = renderMosesLakeHeldoutOverlaySvg(comparison);
    expect((svg.match(/data-approved-id=/g) || [])).toHaveLength(6);
    expect((svg.match(/data-predicted-id=/g) || [])).toHaveLength(12);
    expect(svg).toContain('HELDOUT FAILED');
    const result = await verifyMosesLakeHeldoutAdversarialLoop(comparison, sourceCandidate);
    expect(result.status).toBe('passed');
    expect(result.rejectedCases).toHaveLength(17);
  });
});

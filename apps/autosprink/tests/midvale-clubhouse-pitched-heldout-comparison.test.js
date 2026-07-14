import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildMidvaleHeldoutComparison,
  renderMidvaleHeldoutOverlaySvg,
  validateMidvaleHeldoutComparison,
  verifyMidvaleHeldoutAdversarialLoop,
} from '../src/engine/midvale-clubhouse-pitched-heldout-comparison.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const sourceCandidate = read('midvale-clubhouse-source-only-pitched-candidate.json');
const comparison = read('midvale-clubhouse-pitched-heldout-comparison.json');

describe('Midvale Clubhouse pitched heldout comparison', () => {
  it('opens the stamped answer only after the immutable source-only commit', async () => {
    expect(await buildMidvaleHeldoutComparison(sourceCandidate)).toEqual(comparison);
    expect(comparison.sequence).toMatchObject({
      sourceCandidateCommit: '77920d69314e4861256f467a35cbeae6283326da',
      sourceCandidateReceiptSha256: '2c58ee909b3b27fa6a497539d4f0ec287c93624b5bbc1d7103db4cb83f7fc91d',
      stampedAnswerOpenedAfterSourceCommit: true,
      answerUsedToGenerateSourceCandidate: false,
    });
  });

  it('independently confirms twelve approved pendent heads in a three-column by four-row Clubroom pattern', () => {
    expect(comparison.approvedEvidence.primary).toMatchObject({ status: 'passed', detectedCount: 12 });
    expect(comparison.approvedEvidence.independent).toMatchObject({ status: 'passed', detectedDropAssemblyCount: 12, uniqueColumnCount: 3, uniqueRowCount: 4 });
    expect(comparison.approvedEvidence.primary.heads).toHaveLength(12);
  });

  it('reports the eight-versus-twelve heldout failure without weakening the correct ceiling classification', async () => {
    expect(await validateMidvaleHeldoutComparison(comparison, sourceCandidate)).toMatchObject({ status: 'passed', heldoutComparisonReady: true, unseenProjectPlacementVerified: false, complianceReady: false });
    expect(comparison.prediction).toMatchObject({ headCount: 8, uniqueColumnCount: 4, uniqueRowCount: 2 });
    expect(comparison.approved).toMatchObject({ headCount: 12, uniqueColumnCount: 3, uniqueRowCount: 4 });
    expect(comparison.result).toMatchObject({ status: 'failed', occupiedSlopedCeilingClassificationVerified: true, approvedElevationPipingFollowsPitchedOccupiedCeiling: true, exactPlacementPatternVerified: false, countDelta: -4 });
    expect(comparison.unseenProjectPlacementVerified).toBe(false);
    expect(comparison.complianceReady).toBe(false);
  });

  it('keeps thresholded one-to-one matching separate from exact pattern acceptance', () => {
    expect(comparison.comparisons.map(({ toleranceFt, matchedCount, precision, recall, parityPassed }) => ({ toleranceFt, matchedCount, precision, recall, parityPassed }))).toEqual([
      { toleranceFt: 3, matchedCount: 4, precision: 0.5, recall: 0.333333, parityPassed: false },
      { toleranceFt: 5, matchedCount: 6, precision: 0.75, recall: 0.5, parityPassed: false },
      { toleranceFt: 6, matchedCount: 8, precision: 1, recall: 0.666667, parityPassed: false },
    ]);
  });

  it('renders an explicit failure overlay and rejects fourteen adversarial mutations', async () => {
    const svg = renderMidvaleHeldoutOverlaySvg(comparison);
    expect((svg.match(/data-approved-id=/g) || [])).toHaveLength(12);
    expect((svg.match(/data-predicted-id=/g) || [])).toHaveLength(8);
    expect(svg).toContain('HELDOUT FAILED');
    const result = await verifyMidvaleHeldoutAdversarialLoop(comparison, sourceCandidate);
    expect(result.status).toBe('passed');
    expect(result.rejectedCases).toHaveLength(14);
  });
});

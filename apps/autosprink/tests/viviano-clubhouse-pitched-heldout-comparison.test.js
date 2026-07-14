import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildVivianoHeldoutComparison,
  renderVivianoHeldoutOverlaySvg,
  validateVivianoHeldoutComparison,
  verifyVivianoHeldoutAdversarialLoop,
} from '../src/engine/viviano-clubhouse-pitched-heldout-comparison.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const sourceCandidate = read('viviano-clubhouse-source-only-pitched-candidate.json');
const comparison = read('viviano-clubhouse-pitched-heldout-comparison.json');

describe('Viviano Clubhouse answer-exposed pitched holdout comparison', () => {
  it('preserves the pushed blind sequence before approved and as-built answer exposure', () => {
    expect(comparison.sequence).toMatchObject({
      sourceCandidateCommit: '957fe15ac4f395504e06af71cec9b5a9e84fceda',
      sourceCandidateReceiptSha256: sourceCandidate.receiptSha256,
      approvedAndAsBuiltOpenedAfterSourceCommit: true,
      answersUsedToGenerateSourceCandidate: false,
    });
  });

  it('replays twelve approved heads as three along by four across with two drops per plane', async () => {
    expect(await buildVivianoHeldoutComparison(sourceCandidate)).toEqual(comparison);
    expect(await validateVivianoHeldoutComparison(comparison, sourceCandidate)).toMatchObject({
      status: 'passed', heldoutComparisonReady: true, unseenProjectPlacementVerified: false, complianceReady: false,
    });
    expect(comparison.approvedEvidence.primary.detectedCount).toBe(12);
    expect(comparison.approvedEvidence.independent.planTopology).toEqual({ alongRidgeStations: 3, acrossSlopeStations: 4, headCount: 12 });
    expect(comparison.approvedEvidence.independent.sectionTopology).toMatchObject({ pendentDropsPerWestPlane: 2, pendentDropsPerEastPlane: 2, ridgeHeadPresent: false });
    expect(comparison.approvedEvidence.answerParity.centersEqualApproved).toBe(true);
  });

  it('fails the equal-count blind candidate because topology is transposed and no head matches within 1.5 feet', () => {
    expect(comparison.prediction).toMatchObject({ headCount: 12, uniqueAlongRidgeStations: 4, uniqueAcrossSlopeStations: 3, ridgeHeadStationPresent: true });
    expect(comparison.approved).toMatchObject({ headCount: 12, uniqueAlongRidgeStations: 3, uniqueAcrossSlopeStations: 4, ridgeHeadStationPresent: false });
    expect(comparison.comparisons.find((entry) => entry.toleranceFt === 1.5)).toMatchObject({ matchedCount: 0, parityPassed: false });
    expect(comparison.result).toMatchObject({ status: 'failed', exactPlacementPatternVerified: false, countDelta: 0 });
    expect(comparison.unseenProjectPlacementVerified).toBe(false);
    expect(comparison.complianceReady).toBe(false);
  });

  it('renders top-view proof and rejects twenty-two answer, topology, section, sequence, and false-promotion mutations', async () => {
    const svg = renderVivianoHeldoutOverlaySvg(comparison);
    expect(svg).toContain('HELDOUT FAILED: equal count, wrong topology');
    expect(svg.match(/data-approved-id=/g)).toHaveLength(12);
    expect(svg.match(/data-predicted-id=/g)).toHaveLength(12);
    const adversarial = await verifyVivianoHeldoutAdversarialLoop(comparison, sourceCandidate);
    expect(adversarial).toMatchObject({ status: 'passed', attemptedCases: 22, complianceReady: false });
    expect(adversarial.rejectedCases).toHaveLength(22);
  });
});

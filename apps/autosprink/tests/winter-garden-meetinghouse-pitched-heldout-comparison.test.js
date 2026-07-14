import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildWinterGardenHeldoutComparison,
  renderWinterGardenHeldoutOverlaySvg,
  validateWinterGardenHeldoutComparison,
  verifyWinterGardenHeldoutComparisonAdversarialLoop,
} from '../src/engine/winter-garden-meetinghouse-pitched-heldout-comparison.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const candidate = read('winter-garden-source-only-pitched-candidate.json');
const comparison = read('winter-garden-meetinghouse-pitched-heldout-comparison.json');

describe('Winter Garden answer-exposed heldout comparison', () => {
  it('replays the post-commit comparison and preserves failure', async () => {
    expect(await buildWinterGardenHeldoutComparison(candidate)).toEqual(comparison);
    expect(await validateWinterGardenHeldoutComparison(comparison, candidate)).toMatchObject({ status: 'passed', comparisonReady: true, unseenProjectPlacementVerified: false, complianceReady: false });
    expect(comparison.sequence).toMatchObject({ sourceCandidateCommit: 'b9cfccf6', approvedAndAsBuiltOpenedAfterSourceCommit: true, answersUsedToGenerateSourceCandidate: false });
    expect(comparison.result).toMatchObject({ status: 'failed', countDelta: -3, exactPlacementPatternVerified: false, sourceProtectionZoneGeometryVerified: false });
  });

  it('proves nine approved/as-built heads in a 3x3 topology with raster parity', () => {
    expect(comparison.approvedEvidence.primary).toMatchObject({ status: 'passed', detectedCount: 9, threshold: 2.5, weakestTrueScore: 2.5508, strongestRejectedScore: 1.7166 });
    expect(comparison.approvedEvidence.independent.planTopology).toEqual({ alongRidgeStations: 3, acrossSlopeStations: 3, headCount: 9 });
    expect(comparison.approvedEvidence.answerParity).toMatchObject({ status: 'passed', centersEqualApproved: true });
    expect(comparison.approvedEvidence.answerParity.approvedRasterSha256).toBe(comparison.approvedEvidence.answerParity.asBuiltRasterSha256);
  });

  it('records the competing source span instead of retrofitting the blind geometry', () => {
    expect(comparison.sourceGeometryFinding).toMatchObject({ status: 'failed-ambiguous-protection-zone-boundary', sealedCandidateLengthFt: 28.9375, sealedDimensionLabel: `28'-11 1/4"`, competingClearSpanLabelOnA103: `25'-10 3/4"` });
    expect(comparison.prediction).toMatchObject({ headCount: 6, topology: { alongRidgeStations: 2, acrossSlopeStations: 3 } });
    expect(comparison.approved).toMatchObject({ headCount: 9, topology: { alongRidgeStations: 3, acrossSlopeStations: 3 } });
    expect(comparison.comparisons.at(-1)).toMatchObject({ toleranceFt: 5, parityPassed: false });
  });

  it('rejects twenty-two evidence, leakage, geometry, topology, and false-promotion mutations', async () => {
    const result = await verifyWinterGardenHeldoutComparisonAdversarialLoop(comparison, candidate);
    expect(result).toMatchObject({ status: 'passed', attemptedCases: 22, complianceReady: false });
    expect(result.rejectedCases).toHaveLength(22);
  });

  it('renders a truthful failed top-view overlay', () => {
    const svg = renderWinterGardenHeldoutOverlaySvg(comparison);
    expect(svg).toContain('approved/as-built 9');
    expect(svg).toContain('sealed v3 prediction 6');
    expect(svg).toContain('FAILED: count, topology, and source span');
  });
});

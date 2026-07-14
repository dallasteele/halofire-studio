import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildPolarisHeldoutComparison, renderPolarisHeldoutComparisonViews, validatePolarisAnswerEvidence, validatePolarisHeldoutComparison, verifyPolarisHeldoutComparisonAdversarialLoop } from '../src/engine/polaris-academy-pitched-attic-heldout-comparison.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const blindCandidate = read('polaris-academy-source-only-pitched-attic-candidate.json');
const answerEvidence = read('polaris-answer-extracted-evidence.json');
const sourceSeal = read('polaris-academy-unseen-pitched-attic-holdout.json');
const sourceDependencies = { sourceSeal, v5Corpus: read('pitched-placement-calibration-corpus-v5.json'), v4Corpus: read('pitched-placement-calibration-corpus-v4.json') };
const dependencies = { blindCandidate, answerEvidence, sourceDependencies };

describe('Polaris Academy pitched-attic heldout comparison', () => {
  it('registers approved/as-built answer evidence exactly onto the sealed architecture', async () => {
    expect(await validatePolarisAnswerEvidence(answerEvidence)).toMatchObject({ status: 'passed', answerEvidenceReady: true, complianceReady: false });
    expect(answerEvidence.coordinateRegistration).toMatchObject({ matchedVertexCount: 73, maxResidualInches: 1.8e-11, libredwgUnknownEntityCount: 0 });
    expect(answerEvidence.summary).toMatchObject({ totalHeadCount: 158, headCounts: { pendent: 81, upright: 77 }, insideSourceFootprintCount: 158, outsideSourceFootprintCount: 0, pipeCount: 186, fittingCount: 98 });
  });

  it('preserves both the correct domain rejection and the failed placement coverage', async () => {
    const packet = await buildPolarisHeldoutComparison(blindCandidate, answerEvidence, sourceDependencies);
    expect(await validatePolarisHeldoutComparison(packet, dependencies)).toMatchObject({ status: 'passed', comparisonReady: true, wrongDomainGuardWorked: true, unseenProjectPlacementVerified: false, complianceReady: false });
    expect(packet.sourceOnlyCommit).toBe('caa5723d89d6bacad255acb35ddffa71592c3391');
    expect(packet.sourceOnlyResult.generatedHeadCount).toBe(0);
    expect(packet.approvedAndAsBuilt).toMatchObject({ rasterParity: true, totalHeadCount: 158, pipeCount: 186, fittingCount: 98 });
    expect(packet.approvedAndAsBuilt.systems).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'pendent', count: 81 }), expect.objectContaining({ kind: 'upright', count: 77 })]));
    expect(packet.result).toMatchObject({ status: 'passed-domain-guard-failed-placement-coverage', blindGeneratedVersusAtticHeadDelta: -77, unseenProjectPlacementVerified: false });
  });

  it('renders answer-exposed top, elevation, and 3D comparison proof', async () => {
    const packet = await buildPolarisHeldoutComparison(blindCandidate, answerEvidence, sourceDependencies);
    const views = renderPolarisHeldoutComparisonViews(packet);
    expect(views.status).toBe('passed');
    expect(views.topSvg).toContain('81 pendents (cyan) + 77 attic uprights (orange) = 158');
    expect(views.elevationSvg).toContain('attic uprights 10.75-17.458 ft');
    expect(views.model3dSvg).toContain('158 heads inside exact architectural footprint');
    expect(views.unseenProjectPlacementVerified).toBe(false);
  });

  it('rejects answer-order, evidence, tally, failure-erasure, transfer, and promotion attacks', async () => {
    const packet = await buildPolarisHeldoutComparison(blindCandidate, answerEvidence, sourceDependencies);
    const result = await verifyPolarisHeldoutComparisonAdversarialLoop(packet, dependencies);
    expect(result).toMatchObject({ status: 'passed', attemptedCases: 16, unseenProjectPlacementVerified: false, complianceReady: false });
    expect(result.rejectedCases).toHaveLength(16);
  });

  it('surfaces the fail-closed comparison in the authenticated Studio evidence viewer', () => {
    const html = fs.readFileSync(new URL('../autosprink.html', import.meta.url), 'utf8');
    expect(html).toContain("fetch('/api/evidence/polaris-academy-pitched-attic-heldout-comparison'");
    expect(html).toContain('id="hfPolarisHeldoutComparisonEvidence"');
    expect(html).toContain('DOMAIN GUARD PASSED<br>PLACEMENT FAILED');
    expect(html).toContain('No independent human review gate is introduced.');
  });
});

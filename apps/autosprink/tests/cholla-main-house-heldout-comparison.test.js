import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildChollaHeldoutComparison, validateChollaHeldoutComparison, verifyChollaHeldoutAdversarialLoop } from '../src/engine/cholla-main-house-heldout-comparison.js';

const read = (path) => JSON.parse(fs.readFileSync(new URL(path, import.meta.url), 'utf8'));
const sourceSeal = read('../src/data/cholla-main-house-unseen-pitched-holdout.json');
const sourceDecision = read('../src/data/cholla-main-house-source-only-volume-decision.json');
const comparison = read('../src/data/cholla-main-house-heldout-comparison.json');
const dependencies = { sourceSeal, sourceDecision };

describe('Cholla Main House completed-answer held-out comparison', () => {
  it('replays the approved/as-built classification comparison after the immutable pre-answer commit', async () => {
    expect(await buildChollaHeldoutComparison(sourceDecision, sourceSeal)).toEqual(comparison);
    expect(await validateChollaHeldoutComparison(comparison, dependencies)).toMatchObject({ status: 'passed', heldOutClassificationVerified: true, heldOutPlacementVerified: false, complianceReady: false });
    expect(comparison.sequence).toMatchObject({ preAnswerCommit: '05b64285baa0fe908b056e33d69f0af19f02eadc', answerOpenedAfterPreAnswerCommit: true, completedAnswerUsedForPreAnswerDecision: false });
  });

  it('accepts roof-versus-ceiling classification while keeping head placement and downstream gates closed', () => {
    expect(comparison.heldOutClassificationAcceptance).toMatchObject({ status: 'passed', passedChecks: 3, failedChecks: 0, freshBeforeAnswerOpen: true });
    expect(comparison.completedObservations.sprinklerSchedule).toMatchObject({ totalHeads: 45, family: 'residential pendent' });
    expect(comparison.checks.map((check) => check.status)).toEqual(['passed', 'passed', 'qualified-pass']);
    expect(comparison.heldOutPlacementAcceptance.status).toBe('not-assessed');
    expect(comparison.unseenProjectPlacementVerified).toBe(false);
    expect(comparison.complianceReady).toBe(false);
  });

  it('rejects eight sequence, evidence, hidden-failure, and false-promotion mutations', async () => {
    expect(await verifyChollaHeldoutAdversarialLoop(comparison, dependencies)).toEqual({
      status: 'passed',
      rejectedCases: ['preanswer-commit', 'answer-identity', 'classification-failure-hidden', 'attic-protection-hidden', 'placement-promotion', 'model-promotion', 'compliance-promotion', 'receipt'],
      totalCases: 8,
      complianceReady: false,
    });
  });
});

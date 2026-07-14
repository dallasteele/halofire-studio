import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildChollaSourceOnlyDecision,
  validateChollaSourceOnlyDecision,
  validateChollaSourceSeal,
  verifyChollaSourceDecisionAdversarialLoop,
} from '../src/engine/cholla-main-house-unseen-pitched-holdout.js';

const read = (path) => JSON.parse(fs.readFileSync(new URL(path, import.meta.url), 'utf8'));
const sourceSeal = read('../src/data/cholla-main-house-unseen-pitched-holdout.json');
const decision = read('../src/data/cholla-main-house-source-only-volume-decision.json');

describe('Cholla Main House fresh source-only roof and protection-volume holdout', () => {
  it('seals three independent source files while all three completed sprinkler answers remain unopened', async () => {
    expect(await validateChollaSourceSeal(sourceSeal)).toMatchObject({ status: 'passed', sourceSealReady: true, complianceReady: false });
    expect(sourceSeal.sources).toHaveLength(3);
    expect(sourceSeal.answerKeyDenylist).toHaveLength(3);
    expect(sourceSeal.answerKeyDenylist.every((answer) => answer.openedBeforeSourceSeal === false)).toBe(true);
  });

  it('replays the committed pre-answer classification and refuses to substitute the hip roof for flat occupied ceilings', async () => {
    expect(await buildChollaSourceOnlyDecision(sourceSeal)).toEqual(decision);
    expect(await validateChollaSourceOnlyDecision(decision, sourceSeal)).toMatchObject({ status: 'passed', sourceDecisionReady: true, complianceReady: false });
    expect(decision).toMatchObject({
      classification: 'pitched-roof-over-flat-occupied-ceiling',
      placementEngineRoute: 'flat-ceiling-layout',
      atticCavityDetected: true,
      atticProtectionEstablished: false,
      pitchedSurfacePlacementEligible: false,
      productionPlacementEligible: false,
      answerKeyOpened: false,
      unseenProjectClassificationVerified: false,
    });
    expect(decision.candidateHeads).toEqual([]);
    expect(decision.candidatePipes).toEqual([]);
  });

  it('rejects nine source-binding, roof-substitution, answer-leakage, and false-promotion mutations', async () => {
    expect(await verifyChollaSourceDecisionAdversarialLoop(decision, sourceSeal)).toEqual({
      status: 'passed',
      rejectedCases: ['source-receipt', 'classification', 'attic-protection', 'pitched-placement', 'head-injection', 'answer-open', 'model-promotion', 'compliance-promotion', 'receipt'],
      totalCases: 9,
      complianceReady: false,
    });
  });
});

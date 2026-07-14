import { describe, expect, it } from 'vitest';
import { classifyPitchedProtectionVolume, sealPitchedProtectionVolumeEvidence, verifyPitchedProtectionVolumeAdversarialLoop } from '../src/engine/pitched-protection-volume.js';

const sha = (digit) => digit.repeat(64);
const observation = (id, kind, sourceSha256 = sha('a'), sourceRole = 'architectural-section') => ({ id, scopeId: 'great-room', kind, sourceRole, sourceSha256, sheetId: 'A3.2/A5.1', assertion: `${kind} is explicitly shown for the scoped room` });
const packet = async (evidence, overrides = {}) => sealPitchedProtectionVolumeEvidence({
  artifactType: 'halofire.pitched-protection-volume-evidence.v1',
  projectId: 'generic-test-project',
  scopeId: 'great-room',
  mode: 'sealed-source-only',
  sequence: { answerKeyOpened: false, completedBidUsedForDecision: false },
  evidence,
  ...overrides,
});

describe('generic pitched protection-volume classification', () => {
  it('routes an occupied sloped ceiling only when the ceiling is proven to terminate at the roof deck', async () => {
    const sealed = await packet([observation('room', 'occupied-room-label'), observation('slope', 'sloped-ceiling-label'), observation('deck', 'ceiling-is-roof-deck')]);
    const result = await classifyPitchedProtectionVolume(sealed);
    expect(result).toMatchObject({ status: 'passed', classification: 'occupied-sloped-ceiling', classificationRoutingReady: true, productionPlacementEligible: true, headTypeSelectionReady: false, complianceReady: false });
    expect(result.resolvedEvidenceIds).toEqual(['room', 'slope', 'deck']);
  });

  it('routes a pitched attic only from explicit source protection and never from cavity evidence alone', async () => {
    const explicit = await classifyPitchedProtectionVolume(await packet([observation('attic-note', 'attic-protection-note', sha('b'), 'architectural-fire-protection-note')]));
    expect(explicit).toMatchObject({ status: 'passed', classification: 'pitched-attic', atticProtectionEstablished: true, productionPlacementEligible: true });
    const cavity = await classifyPitchedProtectionVolume(await packet([observation('separation', 'roof-ceiling-separation'), observation('access', 'attic-access')]));
    expect(cavity).toMatchObject({ status: 'blocked', classification: 'unresolved', atticCavityDetected: true, atticProtectionEstablished: false, productionPlacementEligible: false });
    expect(cavity.blockers).toContain('attic-cavity-does-not-prove-attic-protection');
  });

  it('routes a pitched roof over explicit flat occupied ceilings away from pitched placement', async () => {
    const result = await classifyPitchedProtectionVolume(await packet([
      observation('room', 'occupied-room-label'), observation('flat', 'flat-ceiling-label'),
      observation('separation', 'roof-ceiling-separation'), observation('attic', 'attic-label'),
    ]));
    expect(result).toMatchObject({
      status: 'passed', classification: 'pitched-roof-over-flat-occupied-ceiling',
      placementEngineRoute: 'flat-ceiling-layout', atticCavityDetected: true,
      atticProtectionEstablished: false, pitchedSurfacePlacementEligible: false,
      productionPlacementEligible: false, complianceReady: false,
    });
    expect(result.blockers).toContain('pitched-roof-not-occupied-protection-surface');
  });

  it('fails closed when a sloped room does not establish whether an attic exists', async () => {
    const result = await classifyPitchedProtectionVolume(await packet([observation('room', 'occupied-room-label'), observation('slope', 'sloped-ceiling-label')]));
    expect(result).toMatchObject({ status: 'blocked', classification: 'unresolved', classificationRoutingReady: false, productionPlacementEligible: false, complianceReady: false });
    expect(result.blockers).toContain('protection-volume-unresolved');
  });

  it('can classify answer-exposed calibration but never promotes it to production placement', async () => {
    const sealed = await packet([observation('answer-attic', 'attic-protection-note', sha('c'), 'completed-sprinkler-answer')], {
      mode: 'answer-exposed-calibration', sequence: { answerKeyOpened: true, completedBidUsedForDecision: true },
    });
    const result = await classifyPitchedProtectionVolume(sealed);
    expect(result).toMatchObject({ status: 'passed', classification: 'pitched-attic', answerExposed: true, productionPlacementEligible: false, complianceReady: false });
    expect(result.blockers).toContain('answer-exposed-calibration-not-fresh-production-evidence');
  });

  it('rejects contradictory deck/cavity evidence and eight adversarial degradations', async () => {
    const source = await packet([observation('room', 'occupied-room-label'), observation('slope', 'sloped-ceiling-label'), observation('deck', 'ceiling-is-roof-deck')]);
    const contradiction = structuredClone(source);
    contradiction.evidence.push(observation('separation', 'roof-ceiling-separation'));
    const result = await classifyPitchedProtectionVolume(await sealPitchedProtectionVolumeEvidence(contradiction));
    expect(result).toMatchObject({ status: 'blocked', classification: 'unresolved', productionPlacementEligible: false });
    expect((await verifyPitchedProtectionVolumeAdversarialLoop(source))).toEqual({ status: 'passed', rejectedCases: ['drop-room', 'drop-ceiling', 'drop-deck', 'contradictory-cavity', 'answer-leak', 'completed-answer-role', 'scope-drift', 'source-hash-drift', 'cavity-only-no-protection'], totalCases: 9 });
  });
});

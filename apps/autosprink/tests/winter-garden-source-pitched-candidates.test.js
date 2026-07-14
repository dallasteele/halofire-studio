import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sealWinterGardenSourcePitchedCandidates, validateWinterGardenSourcePitchedCandidates } from '../src/engine/winter-garden-source-pitched-candidates.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const packet = read('winter-garden-source-pitched-candidates.json');
const dependencies = { topology: read('winter-garden-source-space-topology.json'), registry: read('winter-garden-source-space-registry.json'), hazard: read('winter-garden-source-spec-hazard.json'), ceiling: read('winter-garden-source-sloped-ceiling.json'), building: read('winter-garden-source-building-model.json') };
const codes = (result) => result.issues.map((entry) => entry.code);

describe('Winter Garden source-only pitched candidates', () => {
  it('emits only the single-identity OVERFLOW 149 candidate on the sealed 3:12 C3 surface', async () => {
    const result = await validateWinterGardenSourcePitchedCandidates(packet, dependencies);
    expect(result.status).toBe('passed');
    expect(packet.counts).toEqual({ slopedCeilingRooms: 3, pitchedCandidateRooms: 1, pitchedCandidateHeads: 1, blockedSlopedRooms: 2 });
    expect(packet.candidates[0]).toMatchObject({ roomNumber: '149', roomName: 'OVERFLOW', hazardClass: 'Light Hazard', status: 'source-only-preliminary-pitched-candidate', ceiling: { finishType: 'C3', profileBand: 'ridge-flat', elevationFt: 119.385417 } });
    expect(packet.candidates[0].ceiling.pitchRiseInPer12).toBeCloseTo(3, 2);
  });

  it('keeps multi-identity CHAPEL and CULTURAL CENTER blocked', () => {
    const blocked = packet.roomsAudit.filter((entry) => entry.status === 'blocked');
    expect(blocked.map((entry) => entry.roomNumber)).toEqual(['148', '150']);
    expect(blocked.every((entry) => entry.blockingReasons.includes('multi-identity-protection-envelope-not-partitioned'))).toBe(true);
  });

  it('keeps coverage, wall distance, obstructions, hydraulics, and compliance fail closed', () => {
    const candidate = packet.candidates[0];
    expect(candidate).toMatchObject({ sourceBoundaryComplete: false, coverageVerified: false, wallDistanceVerified: false, obstructionClearanceVerified: false, hydraulicNodeAssigned: false, complianceReady: false });
    expect(candidate.remoteAreaAdjustmentCandidate).toMatchObject({ sourceCeilingExceedsThreshold: true, verified: false });
    expect(packet.pitchedRoofHeadLayoutReady).toBe(false);
    expect(packet.complianceReady).toBe(false);
  });

  it('rejects receipt, upstream, roof leakage, candidate promotion, and readiness tampering', async () => {
    const cases = [
      ['WG_SOURCE_PITCHED_CANDIDATE_RECEIPT_MISMATCH', (value) => { value.candidates[0].planPointFt[0] += 1; }, false],
      ['WG_SOURCE_PITCHED_CANDIDATE_UPSTREAM_DRIFT', (value) => { value.sourceReceipts.ceiling = '0'.repeat(64); }, true],
      ['WG_SOURCE_PITCHED_CANDIDATE_ANSWER_KEY_OR_ROOF_LEAKAGE', (value) => { value.generation.roofPlaneUsedAsCeiling = true; }, true],
      ['WG_SOURCE_PITCHED_CANDIDATE_PREMATURE_PROMOTION', (value) => { value.candidates[0].coverageVerified = true; }, true],
      ['WG_SOURCE_PITCHED_CANDIDATE_FAIL_CLOSED_STATUS_DRIFT', (value) => { value.pitchedRoofHeadLayoutReady = true; }, true],
    ];
    for (const [expected, mutate, reseal] of cases) {
      const value = structuredClone(packet); mutate(value);
      const candidate = reseal ? await sealWinterGardenSourcePitchedCandidates(value) : value;
      expect(codes(await validateWinterGardenSourcePitchedCandidates(candidate, dependencies))).toContain(expected);
    }
  });

  it('uses internal primary, independent, and adversarial loops without an external review gate', () => {
    expect(packet.internalVerification).toMatchObject({ primary: { status: 'passed' }, independent: { status: 'passed' }, adversarial: { status: 'passed' } });
    expect(packet.internalVerification.adversarial.rejectedCases).toContain('4.5:12-roof-plane-used-as-ceiling');
    expect(packet.internalVerification.adversarial.rejectedCases).toContain('one-preliminary-pitched-candidate-promoted-as-whole-building-layout');
  });
});

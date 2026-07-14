import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildWinterGardenSourceSprinklerCandidates,
  sealWinterGardenSourceSprinklerCandidates,
  validateWinterGardenSourceSprinklerCandidates,
} from '../src/engine/winter-garden-source-sprinkler-candidates.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const packet = read('winter-garden-source-sprinkler-candidates.json');
const topology = read('winter-garden-source-space-topology.json');
const registry = read('winter-garden-source-space-registry.json');
const hazard = read('winter-garden-source-spec-hazard.json');
const building = read('winter-garden-source-building-model.json');
const dependencies = { topology, registry, hazard, building };
const codes = (result) => result.issues.map((entry) => entry.code);

describe('Winter Garden source-only sprinkler candidates', () => {
  it('seals only the two rooms that pass the four-source join', async () => {
    const result = await validateWinterGardenSourceSprinklerCandidates(packet, dependencies);
    expect(result.status).toBe('passed');
    expect(result.counts).toEqual({
      sourceRoomIdentities: 54, candidateRooms: 2, candidateHeads: 2, blockedRooms: 52,
      slopedCeilingRooms: 3, slopedCeilingCandidateRooms: 0,
    });
    expect(packet.candidates.map((entry) => [entry.roomNumber, entry.roomName, entry.hazardClass])).toEqual([
      ['120', 'FONT', 'Light Hazard'], ['143', 'BISHOP', 'Light Hazard'],
    ]);
    expect(packet.candidates.every((entry) => entry.sourceSheets.join(',') === 'A101,A103,A151,WG Specs')).toBe(true);
    expect(result.complianceReady).toBe(false);
  });

  it('keeps all pitched/sloped rooms blocked until a source ceiling plane is sealed', () => {
    const sloped = packet.roomsAudit.filter((entry) => entry.slopedCeiling === true);
    expect(sloped.map((entry) => entry.roomNumber)).toEqual(['148', '149', '150']);
    expect(sloped.every((entry) => entry.status === 'blocked')).toBe(true);
    expect(sloped.every((entry) => entry.blockingReasons.includes('sloped-ceiling-plane-not-source-sealed'))).toBe(true);
    expect(packet.pitchedRoofHeadLayoutReady).toBe(false);
  });

  it('does not confuse the A101 registry component index with the source-building room index', () => {
    const generated = buildWinterGardenSourceSprinklerCandidates(dependencies);
    const room120 = registry.spaces.find((entry) => entry.roomNumber === '120');
    const audit120 = generated.roomsAudit.find((entry) => entry.roomNumber === '120');
    expect(room120.geometry.componentIndex).toBe(78);
    expect(audit120.sourceHazardRoomId).toBe('source-room-041');
    expect(generated.candidates.find((entry) => entry.roomNumber === '120').hazardClass).toBe('Light Hazard');
  });

  it('rejects source-name disagreement, dependency drift, receipt drift, and readiness promotion', async () => {
    const cases = [
      ['WG_SOURCE_CANDIDATE_RECEIPT_MISMATCH', (value) => { value.candidates[0].planPointFt[0] += 1; }, false, dependencies],
      ['WG_SOURCE_CANDIDATE_UPSTREAM_DRIFT', (value) => { value.sourceReceipts.topology = '0'.repeat(64); }, true, dependencies],
      ['WG_SOURCE_CANDIDATE_PREMATURE_PROMOTION', (value) => { value.candidates[0].coverageVerified = true; }, true, dependencies],
      ['WG_SOURCE_CANDIDATE_FAIL_CLOSED_STATUS_DRIFT', (value) => { value.pitchedRoofHeadLayoutReady = true; }, true, dependencies],
      ['WG_SOURCE_CANDIDATE_REPLAY_FAILED', () => {}, true, {
        ...dependencies,
        registry: { ...registry, spaces: registry.spaces.map((entry) => entry.roomNumber === '120' ? { ...entry, roomName: 'NOT FONT' } : entry) },
      }],
    ];
    for (const [expected, mutate, reseal, inputs] of cases) {
      const value = structuredClone(packet);
      mutate(value);
      const candidate = reseal ? await sealWinterGardenSourceSprinklerCandidates(value) : value;
      expect(codes(await validateWinterGardenSourceSprinklerCandidates(candidate, inputs))).toContain(expected);
    }
  });

  it('records primary, independent, and adversarial internal loops without an external reviewer gate', () => {
    expect(packet.internalVerification).toMatchObject({
      primary: { status: 'passed' }, independent: { status: 'passed' }, adversarial: { status: 'passed' },
    });
    expect(packet.internalVerification.adversarial.rejectedCases).toContain('roof-plane-substituted-for-ceiling-plane');
    expect(packet.internalVerification.adversarial.rejectedCases).toContain('completed-sprinkler-answer-key-used-for-generation');
  });
});

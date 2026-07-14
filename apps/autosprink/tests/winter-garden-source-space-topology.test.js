import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildSourceWallSupportIndex,
  measureSourceBoundarySupport,
  sealWinterGardenSourceSpaceTopology,
  validateWinterGardenSourceSpaceTopology,
} from '../src/engine/winter-garden-source-space-topology.js';

const packet = JSON.parse(fs.readFileSync(new URL('../src/data/winter-garden-source-space-topology.json', import.meta.url), 'utf8'));
const codes = (result) => result.issues.map((entry) => entry.code);

describe('Winter Garden source protection-envelope topology', () => {
  it('measures independent wall support from deterministic boundary samples', () => {
    const segments = [
      { x1: 0, y1: 0, x2: 10, y2: 0 }, { x1: 10, y1: 0, x2: 10, y2: 10 },
      { x1: 10, y1: 10, x2: 0, y2: 10 }, { x1: 0, y1: 10, x2: 0, y2: 0 },
    ];
    const index = buildSourceWallSupportIndex(segments, { cellSizeFt: 2, toleranceFt: 0.2 });
    expect(measureSourceBoundarySupport([[0, 0], [10, 0], [10, 10], [0, 10]], index)).toEqual({
      sampleCount: 40, supportedSamples: 40, supportRatio: 1,
    });
  });

  it('accepts 45 source envelopes assigning all 54 identities while retaining one honest residual', async () => {
    const result = await validateWinterGardenSourceSpaceTopology(packet);
    expect(result.status).toBe('passed');
    expect(result.counts).toEqual({
      sourceRoomIdentities: 54, sourceProtectionZones: 45, assignedRoomIdentities: 54,
      topologyReadyRoomIdentities: 53, topologyBlockedRoomIdentities: 1,
      multiIdentityOpenZones: 6, sectionLimitedZones: 1, sprinklerCandidateReadyRooms: 0,
    });
    expect(packet.unresolvedRoomNumbers).toEqual(['146']);
    expect(packet.zones.filter((zone) => zone.topologyReady)).toHaveLength(44);
    expect(packet.zones.find((zone) => zone.roomNumbers.includes('146'))).toMatchObject({
      consensusTier: 'section-confirmed-plan-boundary-limited', topologyReady: false,
      sprinklerCandidateReady: false, sectionEvidence: { sourceSheet: 'A303', planBoundaryAuthority: false },
    });
    expect(result.wholeBuildingTopologyComplete).toBe(false);
    expect(result.wholeBuildingHeadLayoutReady).toBe(false);
    expect(result.complianceReady).toBe(false);
  });

  it('retains source-only generation and internal adversarial verification', () => {
    expect(packet.generation).toMatchObject({ answerKeyUsed: false, oldRoomLabelsUsed: false, registrationMethod: 'labeled-piecewise-grid' });
    expect(packet.internalVerification).toMatchObject({ primary: { status: 'passed' }, independent: { status: 'passed' }, adversarial: { status: 'passed' } });
    expect(packet.internalVerification.adversarial.rejectedCases).toContain('completed-sprinkler-answer-key-as-generation-input');
  });

  it('rejects receipt drift and promotion of room 146 or whole-building readiness', async () => {
    const cases = [
      ['WG_SOURCE_TOPOLOGY_RECEIPT_MISMATCH', (value) => { value.zones[0].geometry.areaSqft += 1; }, false],
      ['WG_SOURCE_TOPOLOGY_SECTION_LIMIT_DRIFT', (value) => { value.zones.find((zone) => zone.roomNumbers.includes('146')).topologyReady = true; }, true],
      ['WG_SOURCE_TOPOLOGY_FAIL_CLOSED_STATUS_DRIFT', (value) => { value.wholeBuildingHeadLayoutReady = true; }, true],
      ['WG_SOURCE_TOPOLOGY_ANSWER_KEY_LEAKAGE', (value) => { value.generation.answerKeyUsed = true; }, true],
    ];
    for (const [expected, mutate, reseal] of cases) {
      const value = structuredClone(packet);
      mutate(value);
      const candidate = reseal ? await sealWinterGardenSourceSpaceTopology(value) : value;
      expect(codes(await validateWinterGardenSourceSpaceTopology(candidate))).toContain(expected);
    }
  });
});

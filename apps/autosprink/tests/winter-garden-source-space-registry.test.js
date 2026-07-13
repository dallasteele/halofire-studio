import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildWinterGardenSourceSpaceEntries,
  parseArchitecturalHeightFt,
  sealWinterGardenSourceSpaceRegistry,
  validateWinterGardenSourceSpaceRegistry,
} from '../src/engine/winter-garden-source-space-registry.js';

const packet = JSON.parse(fs.readFileSync(new URL('../src/data/winter-garden-source-space-registry.json', import.meta.url), 'utf8'));
const codes = (result) => result.issues.map((entry) => entry.code);

describe('Winter Garden source-space registry', () => {
  it('accepts the source-only room identity, geometry, ceiling, and current operations-brain packet', async () => {
    const result = await validateWinterGardenSourceSpaceRegistry(packet);
    expect(result.status).toBe('passed');
    expect(result.counts).toEqual({
      sourceRoomIdentities: 54,
      uniqueAnchorComponentRooms: 50,
      anchorComponentBlockedRooms: 4,
      ceilingRegisteredComponentRooms: 14,
      sprinklerCandidateReadyRooms: 0,
    });
    expect(result.operationalKnowledgeGrounded).toBe(true);
    expect(result.sprinklerCandidateReady).toBe(false);
    expect(result.wholeBuildingHeadLayoutReady).toBe(false);
    expect(result.complianceReady).toBe(false);
  });

  it('uses authoritative A101 identities instead of the swapped legacy chapel and rostrum labels', () => {
    expect(packet.spaces.find((space) => space.roomNumber === '147').roomName).toBe('ROSTRUM');
    expect(packet.spaces.find((space) => space.roomNumber === '148').roomName).toBe('CHAPEL');
    expect(packet.spaces.find((space) => space.roomNumber === '153').roomName).toBe('MATERIALS CENTER');
    expect(packet.generation.oldRoomLabelsUsed).toBe(false);
  });

  it('keeps rooms without a unique closed component blocked', () => {
    const blocked = packet.spaces.filter((space) => space.geometry.status === 'blocked');
    expect(blocked.map((space) => space.roomNumber)).toEqual(['111', '147', '154', '159']);
    expect(blocked.every((space) => !space.sprinklerCandidateReady && space.geometry.polygon == null)).toBe(true);
  });

  it('parses architectural ceiling heights including fractions and rejects malformed values', () => {
    expect(parseArchitecturalHeightFt(`19' - 5 3/8"`)).toBeCloseTo(19.447917, 6);
    expect(parseArchitecturalHeightFt(`8' - 0"`)).toBe(8);
    expect(parseArchitecturalHeightFt(`8' - 12"`)).toBeNull();
    expect(parseArchitecturalHeightFt('SLOPED')).toBeNull();
  });

  it('rejects a component containing multiple source room anchors', () => {
    const polygon = [[0, 0], [20, 0], [20, 20], [0, 20]];
    const entries = buildWinterGardenSourceSpaceEntries({
      identities: [
        { roomNumber: '101', roomName: 'ONE', registeredPointFt: [5, 5] },
        { roomNumber: '102', roomName: 'TWO', registeredPointFt: [15, 15] },
      ],
      components: [{ poly: polygon, areaSqft: 400 }],
      ceilingControls: [{ registeredPointFt: [5, 5], heightFt: 8 }],
    });
    expect(entries.every((entry) => entry.geometry.status === 'blocked')).toBe(true);
    expect(entries.every((entry) => entry.blockingReasons.includes('component-contains-multiple-room-anchors'))).toBe(true);
  });

  it('rejects receipt drift, stale company-flow knowledge, old-label reuse, and premature whole-building claims', async () => {
    const cases = [
      ['WG_SOURCE_SPACE_RECEIPT_MISMATCH', (value) => { value.spaces[0].roomName = 'TAMPERED'; }, false],
      ['WG_SOURCE_SPACE_OPERATIONAL_KNOWLEDGE_MISSING', (value) => { value.operationalKnowledge.companyFlowRecall.episodeIds = []; }, true],
      ['WG_SOURCE_SPACE_ANSWER_KEY_LEAKAGE', (value) => { value.generation.oldRoomLabelsUsed = true; }, true],
      ['WG_SOURCE_SPACE_FAIL_CLOSED_STATUS_DRIFT', (value) => { value.wholeBuildingHeadLayoutReady = true; }, true],
    ];
    for (const [expectedCode, mutate, reseal] of cases) {
      const value = structuredClone(packet);
      mutate(value);
      const candidate = reseal ? await sealWinterGardenSourceSpaceRegistry(value) : value;
      expect(codes(await validateWinterGardenSourceSpaceRegistry(candidate))).toContain(expectedCode);
    }
  });
});

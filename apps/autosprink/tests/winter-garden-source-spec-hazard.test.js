import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildWinterGardenSourceSpecHazardPacket,
  validateWinterGardenSourceSpecHazardPacket,
} from '../src/engine/winter-garden-source-spec-hazard.js';

const sourceBuildingPacket = JSON.parse(fs.readFileSync(new URL('../src/data/winter-garden-source-building-model.json', import.meta.url), 'utf8'));
const codes = (result) => result.issues.map((entry) => entry.code);
const build = () => buildWinterGardenSourceSpecHazardPacket({ sourceBuildingPacket, operationalKnowledge: sourceBuildingPacket.operationalKnowledge });

describe('Winter Garden source-spec hazard zoning', () => {
  it('binds WG Specs Section 21 1313 and classifies only source-identified rooms', async () => {
    const packet = await build();
    const result = await validateWinterGardenSourceSpecHazardPacket(packet, { sourceBuildingPacket });
    expect(result.status).toBe('passed');
    expect(result.counts).toEqual({
      totalRooms: 56,
      sourceClassifiedRooms: 31,
      unresolvedRooms: 25,
      byHazard: { 'Light Hazard': 30, 'Ordinary Hazard Group 2': 1 },
    });
    expect(packet.criteria.sourceBinding.sha256).toBe('2ceb110a0ab68f69a266e01d2c1274ac1a49c45f16958179cab78055a5192008');
    expect(packet.criteria.sourceBinding.criteriaPage).toBe(647);
    expect(result.sourceSpecGrounded).toBe(true);
    expect(result.wholeBuildingHazardZoningComplete).toBe(false);
    expect(result.complianceReady).toBe(false);
  });

  it('applies Storage as OH2 and never defaults an unidentified room to Light', async () => {
    const packet = await build();
    const storage = packet.zoning.zones.find((zone) => zone.sourceLabel === 'STORAGE');
    expect(storage).toMatchObject({ hazardClass: 'Ordinary Hazard Group 2', densityGpmSqft: 0.2, remoteAreaSqft: 1500, maxCoverageSqftPerHead: 130 });
    expect(packet.zoning.zones.filter((zone) => !zone.identityGrounded)).toHaveLength(25);
    expect(packet.zoning.zones.filter((zone) => !zone.identityGrounded).every((zone) => zone.hazardClass === null)).toBe(true);
  });

  it('holds the 30-percent pitched-ceiling increase as a candidate until each ceiling profile is registered', async () => {
    const packet = await build();
    const classified = packet.zoning.zones.filter((zone) => zone.status === 'source-classified');
    expect(packet.zoning.buildingRoofPitchRiseInPer12).toBe(4.5);
    expect(classified.every((zone) => zone.ceilingSlopeApplication.adjustedRemoteAreaCandidateSqft === 1950)).toBe(true);
    expect(classified.every((zone) => zone.ceilingSlopeApplication.appliesToRoom === null)).toBe(true);
    expect(packet.headLayoutReady).toBe(false);
  });

  it('rejects spec hash drift, whole-building defaults, and invented hazards on unresolved rooms', async () => {
    const packet = await build();
    packet.criteria.sourceBinding.sha256 = '0'.repeat(64);
    packet.generation.wholeBuildingDefaultHazardUsed = true;
    packet.zoning.zones.find((zone) => zone.status === 'blocked').hazardClass = 'Light Hazard';
    const result = await validateWinterGardenSourceSpecHazardPacket(packet, { sourceBuildingPacket });
    expect(codes(result)).toEqual(expect.arrayContaining([
      'WG_SPEC_HAZARD_RECEIPT_MISMATCH',
      'WG_SPEC_HAZARD_SOURCE_DRIFT',
      'WG_SPEC_HAZARD_ZONING_REPLAY_FAILED',
      'WG_SPEC_HAZARD_UNRESOLVED_ROOM_DEFAULTED',
      'WG_SPEC_HAZARD_GENERATION_POLICY_VIOLATION',
    ]));
  });

  it('rejects a validly resealed packet whose internal adversarial loop was removed', async () => {
    const packet = await build();
    packet.internalVerification.adversarial.status = 'blocked';
    const { receiptSha256: _receipt, ...draft } = packet;
    const resealed = await buildWinterGardenSourceSpecHazardPacket({ sourceBuildingPacket, operationalKnowledge: sourceBuildingPacket.operationalKnowledge });
    resealed.internalVerification = draft.internalVerification;
    const { sha256Hex } = await import('../src/engine/elevation-datums.js');
    const { receiptSha256: _old, ...resealDraft } = resealed;
    resealed.receiptSha256 = await sha256Hex(resealDraft);
    expect(codes(await validateWinterGardenSourceSpecHazardPacket(resealed, { sourceBuildingPacket }))).toContain('WG_SPEC_HAZARD_INTERNAL_LOOPS_INCOMPLETE');
  });
});

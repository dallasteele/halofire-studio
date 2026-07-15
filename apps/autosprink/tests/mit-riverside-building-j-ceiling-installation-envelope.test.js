import fs from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildMitRiversideBuildingJCeilingInstallationEnvelope, validateMitRiversideBuildingJCeilingInstallationEnvelope, verifyMitRiversideBuildingJCeilingInstallationEnvelopeAdversarialLoop } from '../src/engine/mit-riverside-building-j-ceiling-installation-envelope.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const roofPacket = read('mit-riverside-building-j-roof-plane-elevation.json');
const evidence = read('mit-riverside-building-j-ceiling-installation-envelope-evidence.json');
const dependencies = { roofPacket, evidence };
let packet;
beforeAll(async () => { packet = await buildMitRiversideBuildingJCeilingInstallationEnvelope(roofPacket, evidence); });

describe('MIT Riverside Building J RCP ceiling and approved product installation envelope', () => {
  it('binds all 15 pendents to exact RCP ceiling planes and approved TY3231 product geometry', async () => {
    expect(await validateMitRiversideBuildingJCeilingInstallationEnvelope(packet, dependencies)).toMatchObject({ status: 'passed', allSourceProtectionTargetsReady: true, conditionalStandardPendentGeometryReady: true, exactInstalledHeadZReady: false, complianceReady: false });
    expect(packet.counts).toEqual({ totalHeads: 68, pendentCeilingPlanes: 15, pendentAt9Ft: 13, pendentAt10Ft: 2, aboveFinishedCeilingUprights: 7, uprightNoFinishedCeilingZoneOverlap: 46, allSourceProtectionTargets: 68, conditionalManufacturerDeflectorValues: 15, exactInstalledHeadZ: 0 });
    const pendents = packet.headAssignments.filter((head) => head.kind === 'pendent');
    expect(pendents.filter((head) => head.ceilingHeightFt === 9)).toHaveLength(13);
    expect(pendents.filter((head) => head.ceilingHeightFt === 10)).toHaveLength(2);
    expect(pendents.every((head) => head.approvedSin === 'TY3231' && head.headInstallationZFt === null)).toBe(true);
    expect(pendents.find((head) => head.ceilingHeightFt === 9).conditionalManufacturerDeflectorZFt).toBe(8.875);
    expect(pendents.find((head) => head.ceilingHeightFt === 10).conditionalManufacturerDeflectorZFt).toBe(9.875);
  });

  it('corrects seven generic open-structure uprights to RCP-proved above-ceiling regimes', () => {
    const above = packet.headAssignments.filter((head) => head.kind === 'upright' && head.finishedCeilingOverlap);
    expect(above.map((head) => head.id)).toEqual(['MIT-J-U-045', 'MIT-J-U-047', 'MIT-J-U-048', 'MIT-J-U-049', 'MIT-J-U-051', 'MIT-J-U-052', 'MIT-J-U-053']);
    expect(above.every((head) => head.sourceProtectionRegime === 'above-finished-ceiling-upright-to-sloped-bottom-of-deck' && head.approvedSin === 'TY3131')).toBe(true);
    expect(packet.regimeCorrection).toMatchObject({ priorGenericOpenStructureUprightCount: 53, provedAboveFinishedCeilingUprightCount: 7, remainingUprightsWithoutFinishedCeilingZoneOverlap: 46, openStructureLabelNoLongerUsedAsIndividualHeadFact: true });
  });

  it('keeps every installed Z and every compliance/fabrication/release claim fail-closed', () => {
    expect(packet.headAssignments.every((head) => head.headInstallationZFt === null)).toBe(true);
    expect(packet).toMatchObject({ allPendentCeilingPlanesReady: true, allSourceProtectionTargetsReady: true, approvedProductScheduleReady: true, conditionalStandardPendentGeometryReady: true, exactInstalledHeadZReady: false, headElevationsReady: false, sourceGeneratedPitchedPlacementVerified: false, complianceReady: false, fabricationReady: false, fieldReleaseReady: false });
  });

  it('rejects every dependency, zone, height, product, overlap, Z, generation, and release attack', async () => {
    expect(await verifyMitRiversideBuildingJCeilingInstallationEnvelopeAdversarialLoop(packet, dependencies)).toMatchObject({ status: 'passed', attemptedCases: 20, allSourceProtectionTargetsReady: true, exactInstalledHeadZReady: false, complianceReady: false });
  });
});

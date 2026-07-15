import fs from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildMitRiversideBuildingJRoofPlaneElevation, renderMitRiversideBuildingJRoofPlaneElevation, validateMitRiversideBuildingJRoofPlaneElevation, verifyMitRiversideBuildingJRoofPlaneElevationAdversarialLoop } from '../src/engine/mit-riverside-building-j-roof-plane-elevation.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const spatial = read('mit-riverside-building-j-source-spatial-boundaries.json');
const evidence = read('mit-riverside-building-j-roof-plane-elevation-evidence.json');
const dependencies = { spatial, evidence };
let packet;
beforeAll(async () => { packet = await buildMitRiversideBuildingJRoofPlaneElevation(spatial, evidence); });

describe('MIT Riverside Building J protected-source roof planes and elevation targets', () => {
  it('replays the corrected source pitches and four exact cricket wedges', async () => {
    expect(await validateMitRiversideBuildingJRoofPlaneElevation(packet, dependencies)).toMatchObject({ status: 'passed', sourceCricketVectorsReady: true, sourceSideViewProfilesReady: true, openStructureTargetElevationCount: 53, headInstallationZReady: false });
    expect(packet.roofSurfaces.map(({ id, riseInPer12 }) => ({ id, riseInPer12 }))).toEqual([
      { id: 'main-standing-seam', riseInPer12: 1.25 }, { id: 'west-lower-standing-seam', riseInPer12: 1.5 }, { id: 'membrane-base', riseInPer12: 0.375 },
    ]);
    expect(packet.sourceCricketFaces).toHaveLength(4);
    expect(packet.sourceCricketFaces.every((face) => face.riseInPer12 === 0.5)).toBe(true);
    expect(packet.correctedSourceFacts).toEqual({ legacyLowerRoofPitchRiseInPer12: 0.5, westStandingSeamPitchRiseInPer12: 1.5, legacyCandidateSuperseded: true, legacySourceCandidateReceiptUsed: false });
  });

  it('binds 53 upright heads to source protection-plane targets while keeping installation Z null', () => {
    expect(packet.counts).toEqual({ totalHeads: 68, mainOpenStructure: 36, membraneOpenStructure: 17, finishedCeilingPending: 15, headInstallationZAssigned: 0 });
    const main = packet.headAssignments.filter((head) => head.sourceProtectionPlaneId === 'main-open-structure-bod');
    const membrane = packet.headAssignments.filter((head) => head.sourceProtectionPlaneId === 'membrane-open-structure-bod');
    expect(main[0].sourceProtectionPlaneZFt).toBeCloseTo(17.660368, 5);
    expect(main.at(-1).sourceProtectionPlaneZFt).toBeCloseTo(23.299009, 5);
    expect(membrane[0].sourceProtectionPlaneZFt).toBeCloseTo(12.94889, 5);
    expect(membrane.at(-1).sourceProtectionPlaneZFt).toBeCloseTo(12.169584, 5);
    expect(packet.headAssignments.every((head) => head.headInstallationZFt === null)).toBe(true);
  });

  it('keeps the former blank-background renderer diagnostic-only and rejects it as visual proof', () => {
    const views = renderMitRiversideBuildingJRoofPlaneElevation(packet);
    expect(views).toMatchObject({ status: 'diagnostic-only', counts: { main: 36, membrane: 17, pending: 15 }, sourceUnderlayVisible: false, visualProofAccepted: false, requiredVisualProof: 'protected-pdf-roof-plan-and-e-f-section-underlays', headInstallationZReady: false, complianceReady: false });
    expect((views.topSvg.match(/class="cricket"/g) || [])).toHaveLength(4);
    expect(views.elevationSvg).toContain('supersedes legacy 0.5');
    expect((views.model3dSvg.match(/class="target"/g) || [])).toHaveLength(53);
    expect(packet).toMatchObject({ allHeadProtectionPlanesReady: false, headInstallationZReady: false, headElevationsReady: false, wholeRoofFaceTopologyReady: false, sourceGeneratedPitchedPlacementVerified: false, complianceReady: false, fabricationReady: false, fieldReleaseReady: false });
  });

  it('rejects every dependency, geometry, target, legacy, topology, and release attack', async () => {
    expect(await verifyMitRiversideBuildingJRoofPlaneElevationAdversarialLoop(packet, dependencies)).toMatchObject({ status: 'passed', attemptedCases: 22, sourceCricketVectorsReady: true, openStructureTargetElevationCount: 53, headInstallationZReady: false, complianceReady: false });
  });
});

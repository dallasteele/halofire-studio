import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  validateMitRiversideBuildingJSourceTopology,
  verifyMitRiversideBuildingJSourceTopologyAdversarialLoop,
} from '../src/engine/mit-riverside-building-j-source-topology.js';

const root = new URL('../../../', import.meta.url);
const readJson = async (path) => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

describe('MIT Riverside Building J sanitized source topology', () => {
  it('binds the protected architectural, floor, mechanical, and structural sources', async () => {
    const topology = await readJson('apps/autosprink/src/data/mit-riverside-building-j-source-topology-inputs.json');
    await expect(validateMitRiversideBuildingJSourceTopology(topology)).resolves.toMatchObject({
      status: 'passed', sourceTopologyReady: true, obstructionClearancesVerified: false, complianceReady: false,
    });
    expect(topology.sequence).toMatchObject({
      answerArtifactRead: false,
      completedLayoutRead: false,
      approvedFireSprinklerPlanRead: false,
      asBuiltFireSprinklerPlanRead: false,
      freshProjectHoldoutRequired: true,
    });
  });

  it('extracts source-contained rooms, openings, O.T.S. labels, framing, and MEP labels', async () => {
    const topology = await readJson('apps/autosprink/src/data/mit-riverside-building-j-source-topology-inputs.json');
    expect({
      rooms: topology.rooms.length,
      ots: topology.openToStructureLabels.length,
      walls: topology.wallMaterialPolygons.length,
      doors: topology.doorOpenings.length,
      beams: topology.structuralBeamLines.length,
      axes: topology.sourcePlacementAxes.length,
      equipment: topology.mechanicalEquipmentLabels.length,
      ducts: topology.mechanicalDuctSizeLabels.length,
    }).toEqual({ rooms: 13, ots: 11, walls: 105, doors: 23, beams: 70, axes: 17, equipment: 12, ducts: 9 });
    expect(topology.openToStructureLabels.every((entry) => entry.roomId && entry.roomAssignmentMethod === 'source-zone-polygon-containment')).toBe(true);
    expect(topology.mechanicalPlanRegistration).toMatchObject({
      inlierRoomIds: expect.arrayContaining(['J101', 'J102', 'J103', 'J104', 'J107', 'J108', 'J109', 'J110', 'J111', 'J112']),
      outlierRoomIds: ['J100', 'J105', 'J106'],
      maximumInlierRoomLabelResidualPt: expect.any(Number),
    });
    expect(topology.mechanicalPlanRegistration.maximumInlierRoomLabelResidualPt).toBeLessThanOrEqual(0.1);
  });

  it('rejects all topology and false-precision attacks', async () => {
    const topology = await readJson('apps/autosprink/src/data/mit-riverside-building-j-source-topology-inputs.json');
    await expect(verifyMitRiversideBuildingJSourceTopologyAdversarialLoop(topology)).resolves.toMatchObject({
      status: 'passed', attemptedCases: 20, obstructionClearancesVerified: false, complianceReady: false,
    });
  });

  it('keeps the source extractor and renderer isolated from completed-plan artifacts', async () => {
    const extractor = await readFile(new URL('apps/autosprink/scripts/extract-mit-riverside-building-j-source-topology-inputs.py', root), 'utf8');
    const renderer = await readFile(new URL('apps/autosprink/scripts/render-mit-riverside-building-j-source-topology-proof.py', root), 'utf8');
    for (const forbidden of ['mit-riverside-answer', 'registered-head', 'exact-head-xy', 'source-generated-placement-score.json', 'headAssignments']) {
      expect(extractor).not.toContain(forbidden);
      expect(renderer).not.toContain(forbidden);
    }
  });

  it('binds a browser-inspected protected-PDF proof image', async () => {
    const proof = await readJson('apps/autosprink/src/data/proofs/mit-riverside-building-j-source-topology/proof.json');
    const image = await readFile(new URL(`apps/autosprink/src/data/proofs/mit-riverside-building-j-source-topology/${proof.image.file}`, root));
    expect(sha256(image)).toBe(proof.image.sha256);
    expect(proof.sourcePages).toEqual({ rcp: 105, mechanical: 119, structuralRoofFraming: 84 });
    expect(proof.visualReview).toMatchObject({
      browserInspected: true,
      decodedImageCount: 1,
      consoleErrors: 0,
      normalZoomLayoutReadable: true,
      protectedUnderlaysVisiblyPresent: true,
      failureBoundaryVisiblyDisclosed: true,
    });
  });
});

import { describe, expect, it } from 'vitest';
import {
  auditExposedSlopeSourceRegistration,
  auditSourceProtectionEligibility,
  auditSourceTopologyCompleteness,
  buildSourceTopologyPlacementCandidate,
} from '../src/engine/source-topology-placement-policy.js';

const rectangle = (id, minX, minY, maxX, maxY, extra = {}) => ({
  id,
  verticesFt: [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }],
  ...extra,
});

function connectorPacket() {
  const north = 'north-gable';
  const connector = 'connector-attic';
  const south = 'south-gable';
  return {
    candidateIdPrefix: 'TRANSFER',
    placementPolicy: { maxAreaSqFt: 130, maxSpacingFt: 15, minSpacingFt: 6 },
    concealedSpacePlacementPolicy: { maxAreaSqFt: 120, maxSpacingFt: 15 },
    topologyCompletenessPolicy: { enforceFinishedCeilingToConcealedVolumeMapping: true },
    finishedCeilingRooms: [
      rectangle('support', 0, 0, 9.5, 12.5, { sourcePage: 1, ceilingPlaneId: 'ceiling', ceilingDatumZFt: 8, concealedSpaceExpected: true, concealedVolumeId: north }),
      rectangle('office-north', 9.5, 0, 19.2, 12.5, { sourcePage: 1, ceilingPlaneId: 'ceiling', ceilingDatumZFt: 8, concealedSpaceExpected: true, concealedVolumeId: north }),
      rectangle('entry', 0, 19.2, 19.2, 23.7, { sourcePage: 1, ceilingPlaneId: 'ceiling', ceilingDatumZFt: 8, concealedSpaceExpected: true, concealedVolumeId: connector }),
      rectangle('office-south-a', 0, 30.4, 9.5, 42.9, { sourcePage: 1, ceilingPlaneId: 'ceiling', ceilingDatumZFt: 8, concealedSpaceExpected: true, concealedVolumeId: south }),
      rectangle('office-south-b', 9.5, 30.4, 19.2, 42.9, { sourcePage: 1, ceilingPlaneId: 'ceiling', ceilingDatumZFt: 8, concealedSpaceExpected: true, concealedVolumeId: south }),
    ],
    pitchedConcealedVolumes: [
      rectangle(north, 0, 0, 19.2, 12.5, { sourcePages: [2, 3], coveredFinishedRoomIds: ['support', 'office-north'], ridgeAxis: 'x', ridgeCoordinateFt: 6.25, slopeRise: 5, slopeRun: 12, eaveDatumZFt: 8 }),
      rectangle(connector, 0, 19.2, 19.2, 23.7, { sourcePages: [2, 3], coveredFinishedRoomIds: ['entry'], ridgeAxis: 'x', ridgeCoordinateFt: 21.45, slopeRise: 1, slopeRun: 12, eaveDatumZFt: 8 }),
      rectangle(south, 0, 30.4, 19.2, 42.9, { sourcePages: [2, 3], coveredFinishedRoomIds: ['office-south-a', 'office-south-b'], ridgeAxis: 'x', ridgeCoordinateFt: 36.65, slopeRise: 5, slopeRun: 12, eaveDatumZFt: 8 }),
    ],
  };
}

describe('transferable source-topology placement policy v2', () => {
  it('requires a concealed-volume mapping for every protected finished-ceiling component', () => {
    const packet = connectorPacket();
    expect(auditSourceTopologyCompleteness(packet)).toMatchObject({ status: 'passed', mappedRoomIds: ['support', 'office-north', 'entry', 'office-south-a', 'office-south-b'], concealedVolumeIds: ['north-gable', 'connector-attic', 'south-gable'] });
    packet.pitchedConcealedVolumes = packet.pitchedConcealedVolumes.filter((volume) => volume.id !== 'connector-attic');
    expect(auditSourceTopologyCompleteness(packet)).toMatchObject({ status: 'blocked', issues: [{ code: 'SOURCE_TOPOLOGY_CONCEALED_VOLUME_MISSING', sourceRoomId: 'entry', concealedVolumeId: 'connector-attic' }] });
  });

  it('uses the independent 120 square foot attic policy and generates the connector pair', async () => {
    const result = await buildSourceTopologyPlacementCandidate(connectorPacket());
    expect(result.topologyCompletenessAudit.status).toBe('passed');
    expect(result.counts).toEqual({ total: 12, pendent: 6, upright: 6 });
    expect(result.roofAudit.map((entry) => [entry.sourceVolumeId, entry.maxAreaSqFt, entry.candidateIds.length])).toEqual([
      ['north-gable', 120, 2],
      ['connector-attic', 120, 2],
      ['south-gable', 120, 2],
    ]);
  });

  it('fails generation instead of silently dropping an unmapped connector', async () => {
    const packet = connectorPacket();
    packet.pitchedConcealedVolumes = packet.pitchedConcealedVolumes.filter((volume) => volume.id !== 'connector-attic');
    await expect(buildSourceTopologyPlacementCandidate(packet)).rejects.toThrow('SOURCE_TOPOLOGY_COMPLETENESS_BLOCKED');
  });

  it('places source-only targets on an exposed single-slope plane without inventing sprinkler orientation', async () => {
    const packet = {
      candidateIdPrefix: 'EXPOSED',
      placementPolicy: { maxAreaSqFt: 130, maxSpacingFt: 15, minSpacingFt: 6 },
      exposedSlopedPlacementPolicy: { maxAreaSqFt: 130, maxSpacingFt: 15 },
      finishedCeilingRooms: [],
      pitchedConcealedVolumes: [],
      exposedSlopedCeilingVolumes: [
        rectangle('mono-slope', 0, 0, 30, 20, {
          sourcePages: ['A5.1', 'A6.1', 'A8.1'],
          slopeAxis: 'y',
          slopeDirection: 1,
          lowEdgeCoordinateFt: 0,
          lowEdgeDatumZFt: 10,
          slopeRise: 1.5,
          slopeRun: 12,
          sourceRegistration: {
            featureId: 'mono-slope',
            plan: { page: 'A5.1', sourceFeatureId: 'mono-slope', widthFt: 30, heightFt: 20, pdfBoundsPt: { x: 100, y: 200, width: 300, height: 200 }, pdfToLocalFtTransform: [0.1, 0, 0, 0.1, -10, -20] },
            roof: { page: 'A5.1', sourceFeatureId: 'mono-slope', slopeRise: 1.5, slopeRun: 12 },
            rcp: { page: 'A6.1', sourceFeatureId: 'mono-slope', ceilingRegime: 'open to structure' },
            section: { page: 'A8.1', sourceFeatureId: 'mono-slope', slopeRise: 1.5, slopeRun: 12, lowEdgeDatumZFt: 10 },
          },
        }),
      ],
    };
    const result = await buildSourceTopologyPlacementCandidate(packet);
    expect(auditExposedSlopeSourceRegistration(packet)).toMatchObject({ status: 'passed', registeredVolumeIds: ['mono-slope'] });
    expect(result.exposedSlopeRegistrationAudit).toMatchObject({ status: 'passed', registeredVolumeIds: ['mono-slope'] });
    expect(result.counts).toEqual({ total: 6, pendent: 0, upright: 0, unresolved: 6 });
    expect(result.exposedSlopedAudit).toEqual([
      expect.objectContaining({ sourceVolumeId: 'mono-slope', columns: 3, rows: 2, targetKind: 'orientation-unresolved', candidateIds: expect.arrayContaining(['EXPOSED-S-001', 'EXPOSED-S-006']) }),
    ]);
    expect(result.heads.map((head) => head.sourceProtectionPlaneZFt)).toEqual([10.625, 10.625, 10.625, 11.875, 11.875, 11.875]);
    expect(result.heads.every((head) => head.headInstallationZFt === null && head.sprinklerModel === null && head.obstructionClearanceVerified === false)).toBe(true);
  });

  it('blocks an exposed-slope packet without one PDF-registered feature identity', async () => {
    const packet = {
      candidateIdPrefix: 'BAD',
      placementPolicy: { maxAreaSqFt: 130, maxSpacingFt: 15, minSpacingFt: 6 },
      finishedCeilingRooms: [],
      pitchedConcealedVolumes: [],
      exposedSlopedCeilingVolumes: [rectangle('cross-registered-plane', 0, 0, 29.416667, 14, {
        sourcePages: ['A3.2', 'A5.1', 'A6.1', 'A8.1'], slopeAxis: 'x', slopeDirection: 1, lowEdgeCoordinateFt: 0, lowEdgeDatumZFt: 13.677083, slopeRise: 0.25, slopeRun: 12,
      })],
    };
    expect(auditExposedSlopeSourceRegistration(packet)).toMatchObject({ status: 'blocked', issues: [{ code: 'SOURCE_EXPOSED_SLOPE_REGISTRATION_MISSING', sourceVolumeId: 'cross-registered-plane' }] });
    await expect(buildSourceTopologyPlacementCandidate(packet)).rejects.toThrow('SOURCE_EXPOSED_SLOPE_REGISTRATION_BLOCKED');
  });

  it('requires a source-declared protected floor intersection before roof-derived placement', async () => {
    const volume = rectangle('eligible-slope', 10, 10, 30, 20, {
      sourcePages: ['A1.1', 'A5.1', 'A6.1', 'A8.1'],
      slopeAxis: 'x', slopeDirection: 1, lowEdgeCoordinateFt: 10, lowEdgeDatumZFt: 12, slopeRise: 1, slopeRun: 12,
      protectionEligibility: { status: 'source-declared-protected', sourceFootprintIds: ['occupied-level-2'], sourcePages: ['A1.1'] },
      sourceRegistration: {
        featureId: 'eligible-slope',
        plan: { page: 'A5.1', sourceFeatureId: 'eligible-slope', widthFt: 20, heightFt: 10, pdfBoundsPt: { x: 100, y: 100, width: 200, height: 100 }, pdfToLocalFtTransform: [0.1, 0, 0, 0.1, 0, 0] },
        roof: { page: 'A5.1', sourceFeatureId: 'eligible-slope', slopeRise: 1, slopeRun: 12 },
        rcp: { page: 'A6.1', sourceFeatureId: 'eligible-slope', ceilingRegime: 'open to structure' },
        section: { page: 'A8.1', sourceFeatureId: 'eligible-slope', slopeRise: 1, slopeRun: 12, lowEdgeDatumZFt: 12 },
      },
    });
    const packet = {
      candidateIdPrefix: 'ELIGIBLE',
      placementPolicy: { maxAreaSqFt: 130, maxSpacingFt: 15, minSpacingFt: 6 },
      protectionEligibilityPolicy: { enforceSourceDeclaredFootprintIntersection: true },
      sourceOccupiedOrProtectedFloorFootprints: [rectangle('occupied-level-2', 0, 0, 25, 25, { sourcePage: 'A1.1', sourceDeclaration: 'occupied floor area' })],
      finishedCeilingRooms: [], pitchedConcealedVolumes: [], exposedSlopedCeilingVolumes: [volume],
    };
    expect(auditSourceProtectionEligibility(packet)).toEqual({ status: 'passed', issues: [], eligibleVolumeIds: ['eligible-slope'], matchedFootprintIds: ['occupied-level-2'] });
    await expect(buildSourceTopologyPlacementCandidate(packet)).resolves.toMatchObject({
      counts: { total: 2, unresolved: 2 },
      protectionEligibilityAudit: { status: 'passed', eligibleVolumeIds: ['eligible-slope'] },
    });

    const missingDeclaration = structuredClone(packet);
    missingDeclaration.exposedSlopedCeilingVolumes[0].protectionEligibility.status = 'not-source-declared';
    expect(auditSourceProtectionEligibility(missingDeclaration)).toMatchObject({ status: 'blocked', issues: [{ code: 'SOURCE_PROTECTION_ELIGIBILITY_DECLARATION_MISSING', sourceVolumeId: 'eligible-slope' }] });
    await expect(buildSourceTopologyPlacementCandidate(missingDeclaration)).rejects.toThrow('SOURCE_PROTECTION_ELIGIBILITY_BLOCKED');

    const nonIntersecting = structuredClone(packet);
    nonIntersecting.sourceOccupiedOrProtectedFloorFootprints[0].verticesFt = rectangle('far', 100, 100, 110, 110).verticesFt;
    expect(auditSourceProtectionEligibility(nonIntersecting)).toMatchObject({ status: 'blocked', issues: [{ code: 'SOURCE_PROTECTION_FOOTPRINT_INTERSECTION_MISSING', sourceVolumeId: 'eligible-slope' }] });
    await expect(buildSourceTopologyPlacementCandidate(nonIntersecting)).rejects.toThrow('SOURCE_PROTECTION_ELIGIBILITY_BLOCKED');
  });
});

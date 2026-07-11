import { describe, expect, it } from 'vitest';
import { acceptedModel3dToLevels } from '../src/engine/accepted-model3d.js';

function acceptedPlan(level, pageIndex = level + 40) {
  return {
    level,
    elevationFt: (level - 1) * 12,
    plan: {
      geometryGrounded: true,
      scaleFtPerUnit: 0.1481,
      footprintFt: [[0, 0], [100, 0], [100, 40], [0, 40], [0, 0]],
      wallRuns: [{ a: [0, 0], b: [100, 0] }],
      roomBoundaries: [{ poly: [[1, 1], [99, 1], [99, 39], [1, 39], [1, 1]] }],
      heads: [{ x: 10, y: 10, roomId: 'room-1', symbol: 'sprinkler-head' }],
      sprinklerEvidence: {
        source: 'accepted-geometry-layout', systemVerified: true,
        headCount: 1, outsideHeadCount: 0, pipeAvailable: true,
        pipeSystemVerified: true, routeSetDigest: 'f'.repeat(64),
        pipeSegmentCount: 1, wallPenetrationCount: 1,
      },
      pipeSegments: [{
        id: 'seg-1', from_node: 'riser', to_node: 'head-1',
        x1: 5, y1: 5, x2: 10, y2: 10, size_in: 1.25, length_ft: 7.071,
      }],
      pipeNodes: [
        { id: 'riser', kind: 'riser', x: 5, y: 5 },
        { id: 'head-1', kind: 'head', x: 10, y: 10 },
      ],
      wallPenetrations: [{
        penetration_id: 'pen-1', segment_id: 'seg-1',
        point: { x: 7.5, y: 7.5 }, wall_ids: ['wall-1'], crossing_angle_deg: 90,
      }],
      vectorOverlayArtifact: `spatial-artifact:level-${level}`,
      acceptanceEvidence: {
        artifactId: `artifact-${level}`,
        pageIndex,
        physicalPageNumber: pageIndex + 1,
      },
    },
  };
}

function payload(levels = [acceptedPlan(1), acceptedPlan(2)]) {
  return {
    meta: { document_id: 279 },
    model3d: {
      geometry_grounded: true,
      grounding: {
        passed: true,
        source: 'accepted-vector-overlay',
        levels: levels.map((entry) => entry.level),
      },
      studio: { levelPlans: levels },
    },
  };
}

describe('accepted AutoBid model3d handoff', () => {
  it('releases complete accepted per-floor geometry with exact page evidence', () => {
    const result = acceptedModel3dToLevels(payload());
    expect(result.source).toBe('accepted-vector-overlay');
    expect(result.sourceDocumentId).toBe(279);
    expect(result.levels).toHaveLength(2);
    expect(result.levels.map((entry) => entry.level)).toEqual([1, 2]);
    expect(result.levels[1].plan.roomBoundaries[0].poly).toHaveLength(5);
    expect(result.levels[1].plan.heads).toHaveLength(1);
    expect(result.levels[1].plan.acceptanceEvidence.physicalPageNumber).toBe(43);
  });

  it('rejects pending geometry and does not expose a partial level set', () => {
    const pending = payload();
    pending.model3d.geometry_grounded = false;
    expect(acceptedModel3dToLevels(pending)).toEqual({
      levels: null,
      reason: 'accepted_model3d_not_grounded',
    });

    const partial = payload([acceptedPlan(1)]);
    partial.model3d.grounding.levels = [1, 2];
    expect(acceptedModel3dToLevels(partial).levels).toBeNull();
  });

  it('rejects malformed room/wall/page evidence before rendering', () => {
    const malformed = payload();
    malformed.model3d.studio.levelPlans[1].plan.roomBoundaries[0].poly.pop();
    expect(acceptedModel3dToLevels(malformed).reason).toBe('accepted_model3d_rooms_missing:2');

    const noPage = payload();
    delete noPage.model3d.studio.levelPlans[0].plan.acceptanceEvidence;
    expect(acceptedModel3dToLevels(noPage).reason).toBe('accepted_model3d_page_evidence_missing:1');

    const noHeads = payload();
    noHeads.model3d.studio.levelPlans[0].plan.heads = [];
    expect(acceptedModel3dToLevels(noHeads).reason).toBe('accepted_model3d_heads_missing:1');

    const stalePipe = payload();
    stalePipe.model3d.studio.levelPlans[0].plan.sprinklerEvidence.pipeSystemVerified = false;
    expect(acceptedModel3dToLevels(stalePipe).reason).toBe('accepted_model3d_pipe_missing:1');
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createBuildingModel,
  validateBuildingModel,
} from '../src/engine/building-model.js';

function baseProvenance(source = 'manual') {
  return {
    source,
    confidence: 0.9,
    needsVerification: true,
  };
}

function validModel() {
  return createBuildingModel({
    shell: {
      outline: [[0, 0], [20, 0], [20, 10], [0, 10]],
      heightFt: 12,
      provenance: baseProvenance('plan-extract'),
    },
    walls: [
      {
        id: 'wall-1',
        a: [0, 0],
        b: [20, 0],
        thicknessFt: 0.5,
        heightFt: 12,
        provenance: baseProvenance('plan-extract'),
      },
    ],
    zones: [
      {
        id: 'zone-1',
        kind: 'lobby',
        polygon: [[0, 0], [20, 0], [20, 10], [0, 10]],
        provenance: baseProvenance('zone-classifier'),
      },
    ],
    rooms: [
      {
        id: 'room-1',
        polygon: [[0, 0], [20, 0], [20, 10], [0, 10]],
        kind: 'lobby',
        areaSqft: 200,
        zoneId: 'zone-1',
        provenance: baseProvenance('plan-extract'),
      },
    ],
    meta: {
      sourceSheet: 'A101',
      scaleFtPerUnit: 0.25,
      scaleText: '1/4" = 1\'-0"',
      generatedAt: '2026-06-16T00:00:00Z',
    },
  });
}

test('validateBuildingModel rejects a wall with no provenance', () => {
  const model = validModel();
  delete model.walls[0].provenance;
  assert.throws(() => validateBuildingModel(model), /provenance/i);
});

test('validateBuildingModel rejects a door with a wallId not in walls', () => {
  const model = validModel();
  model.doors.push({
    id: 'door-1',
    wallId: 'missing-wall',
    position: [5, 0],
    widthFt: 3,
    swingDir: 'in',
    hingeSide: 'left',
    provenance: baseProvenance('door-extractor'),
  });
  assert.throws(() => validateBuildingModel(model), /wallId/i);
});

test('validateBuildingModel rejects a room with negative area', () => {
  const model = validModel();
  model.rooms[0].areaSqft = -1;
  assert.throws(() => validateBuildingModel(model), /area/i);
});

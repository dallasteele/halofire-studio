import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyZones } from '../src/engine/zone-classifier.js';

function rect(minX, minY, maxX, maxY) {
  return [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ];
}

test('classifyZones identifies parking, units, corridor, and stair on a synthetic mixed-use floor', async () => {
  const floor = {
    footprint: rect(0, 0, 100, 80),
    spaces: [
      { name: 'Parking Deck', polygon: rect(0, 0, 100, 30) },
      { name: 'Unit 101', polygon: rect(0, 40, 20, 80) },
      { name: 'Unit 102', polygon: rect(20, 40, 40, 80) },
      { name: 'Unit 103', polygon: rect(40, 40, 60, 80) },
      { name: 'Unit 104', polygon: rect(60, 40, 80, 80) },
      { name: 'Main Corridor', polygon: rect(0, 30, 80, 40) },
      { name: 'Stair 1', polygon: rect(80, 30, 100, 50) },
    ],
    walls: [
      { a: [0, 30], b: [100, 30], type: 'interior' },
      { a: [0, 40], b: [100, 40], type: 'interior' },
      { a: [80, 30], b: [80, 50], type: 'interior' },
    ],
    roomLabels: [
      { text: 'PARKING', position: [50, 15] },
      { text: 'STAIR', position: [90, 40] },
      { text: 'CORRIDOR', position: [40, 35] },
    ],
    columns: [
      { x: 10, y: 10 }, { x: 30, y: 10 }, { x: 50, y: 10 }, { x: 70, y: 10 }, { x: 90, y: 10 },
      { x: 10, y: 22 }, { x: 30, y: 22 }, { x: 50, y: 22 }, { x: 70, y: 22 }, { x: 90, y: 22 },
    ],
    parkingStalls: [
      { position: [9, 9] },
      { position: [18, 9] },
      { position: [27, 9] },
      { position: [36, 9] },
    ],
    stairs: [
      { centroidFt: [90, 40] },
    ],
    doors: [
      { position: [10, 40] },
      { position: [30, 40] },
      { position: [50, 40] },
      { position: [70, 40] },
      { position: [80, 37] },
    ],
    fixtures: [
      { fixtureKind: 'sink', position: [5, 55] },
      { fixtureKind: 'toilet', position: [15, 55] },
      { fixtureKind: 'sink', position: [25, 55] },
      { fixtureKind: 'toilet', position: [35, 55] },
      { fixtureKind: 'sink', position: [45, 55] },
      { fixtureKind: 'toilet', position: [55, 55] },
      { fixtureKind: 'sink', position: [65, 55] },
      { fixtureKind: 'toilet', position: [75, 55] },
    ],
  };

  const zones = await classifyZones(floor);
  const kinds = zones.map((zone) => zone.kind).sort();

  assert.equal(zones.length, 7);
  assert.deepEqual(kinds, ['corridor', 'parking', 'stair', 'unit', 'unit', 'unit', 'unit']);

  const parking = zones.find((zone) => zone.kind === 'parking');
  assert.ok(parking);
  assert.equal(parking.columnCount, 10);
  assert.match(parking.evidence.join(' '), /parking/i);

  const corridor = zones.find((zone) => zone.kind === 'corridor');
  assert.ok(corridor);
  assert.equal(corridor.doorCount, 5);

  const stair = zones.find((zone) => zone.kind === 'stair');
  assert.ok(stair);
  assert.equal(stair.stairCount, 1);

  const units = zones.filter((zone) => zone.kind === 'unit');
  assert.equal(units.length, 4);
  for (const unit of units) {
    assert.equal(unit.doorCount, 1);
    assert.deepEqual(unit.fixtureKinds.sort(), ['sink', 'toilet']);
  }
});

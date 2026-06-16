const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function load(relPath) {
  const abs = path.join(__dirname, '..', relPath);
  return import(pathToFileURL(abs).href);
}

test('SVG-imported walls and columns keep valid source ink refs through CAD output', async () => {
  const { buildingFromSvg } = await load('apps/autosprink/src/engine/floorplan-import.js');
  const { buildCadModel } = await load('apps/autosprink/src/engine/cad-model.js');

  const svg = '<svg>'
    + '<polygon data-space points="0,0 20,0 20,20 0,20"/>'
    + '<line data-wall data-wall-type="exterior" x1="0" y1="0" x2="20" y2="0"/>'
    + '<line data-wall data-wall-type="interior" x1="10" y1="0" x2="10" y2="20"/>'
    + '<circle data-column cx="5" cy="5" r="0.5"/>'
    + '</svg>';

  const building = buildingFromSvg(svg);
  const story = building.stories[0];
  const valid = new Set(story.sourceInkRefs);

  assert.equal(story.requireSourceInkRefs, true);
  assert.ok(valid.size >= 3);
  assert.ok(story.walls.every((wall) => typeof wall.inkRef === 'string' && valid.has(wall.inkRef)));
  assert.ok(story.columns.every((column) => typeof column.inkRef === 'string' && valid.has(column.inkRef)));

  const model = buildCadModel(building);
  const solids = model.solids.filter((solid) => solid.kind === 'wall' || solid.kind === 'column');
  assert.ok(solids.length >= 3);
  assert.ok(solids.every((solid) => typeof solid.inkRef === 'string' && valid.has(solid.inkRef)));
});

test('DXF-imported walls and columns keep valid source ink refs through CAD output', async () => {
  const { buildingFromDxf } = await load('apps/autosprink/src/engine/floorplan-import.js');
  const { buildCadModel } = await load('apps/autosprink/src/engine/cad-model.js');

  const dxf = [
    '0', 'SECTION',
    '2', 'ENTITIES',
    '0', 'LWPOLYLINE', '8', 'ROOMS', '90', '4', '70', '1',
    '10', '0', '20', '0',
    '10', '20', '20', '0',
    '10', '20', '20', '20',
    '10', '0', '20', '20',
    '0', 'LINE', '8', 'WALLS-EXT', '10', '0', '20', '0', '11', '20', '21', '0',
    '0', 'LINE', '8', 'WALLS-INT', '10', '10', '20', '0', '11', '10', '21', '20',
    '0', 'CIRCLE', '8', 'COLUMN', '10', '5', '20', '5', '40', '0.5',
    '0', 'ENDSEC',
    '0', 'EOF',
  ].join('\n');

  const building = buildingFromDxf(dxf, {
    layers: {
      spaces: ['ROOMS'],
      wallsExterior: ['WALLS-EXT'],
      wallsInterior: ['WALLS-INT'],
      columns: ['COLUMN'],
    },
  });
  const story = building.stories[0];
  const valid = new Set(story.sourceInkRefs);

  assert.equal(story.requireSourceInkRefs, true);
  assert.ok(story.walls.every((wall) => typeof wall.inkRef === 'string' && valid.has(wall.inkRef)));
  assert.ok(story.columns.every((column) => typeof column.inkRef === 'string' && valid.has(column.inkRef)));

  const model = buildCadModel(building);
  const solids = model.solids.filter((solid) => solid.kind === 'wall' || solid.kind === 'column');
  assert.ok(solids.every((solid) => typeof solid.inkRef === 'string' && valid.has(solid.inkRef)));
});

test('strict source-ink validation drops walls and columns with missing or unknown refs', async () => {
  const { normalizeBuilding } = await load('apps/autosprink/src/engine/building-model.js');
  const { buildCadModel } = await load('apps/autosprink/src/engine/cad-model.js');

  const building = normalizeBuilding({
    name: 'Strict ink',
    units: 'ft',
    stories: [{
      level: 0,
      ceilingHeightFt: 12,
      requireSourceInkRefs: true,
      sourceInkRefs: ['wall:0', 'column:0'],
      spaces: [{ name: 'Room', polygon: [[0, 0], [20, 0], [20, 20], [0, 20]], hazard: 'ordinary' }],
      walls: [
        { a: [0, 0], b: [20, 0], type: 'exterior', openings: [], inkRef: 'wall:0' },
        { a: [0, 20], b: [20, 20], type: 'exterior', openings: [] },
        { a: [20, 0], b: [20, 20], type: 'exterior', openings: [], inkRef: 'wall:missing' },
      ],
      columns: [
        { x: 5, y: 5, sizeFt: 1, inkRef: 'column:0' },
        { x: 10, y: 10, sizeFt: 1 },
        { x: 15, y: 15, sizeFt: 1, inkRef: 'column:missing' },
      ],
    }],
  });

  assert.equal(building.stories[0].walls.length, 1);
  assert.equal(building.stories[0].columns.length, 1);

  const model = buildCadModel(building);
  const walls = model.solids.filter((solid) => solid.kind === 'wall');
  const columns = model.solids.filter((solid) => solid.kind === 'column');

  assert.equal(walls.length, 1);
  assert.equal(columns.length, 1);
  assert.equal(walls[0].inkRef, 'wall:0');
  assert.equal(columns[0].inkRef, 'column:0');
});

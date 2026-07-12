import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildDillonFloorByFloorModel,
  renderDillonFloorByFloorViews,
  validateDillonFloorByFloorModel,
} from '../src/engine/dillon-floor-by-floor-model.js';

const dataDir = path.resolve(import.meta.dirname, '../src/data');
const source = JSON.parse(fs.readFileSync(path.join(dataDir, 'dillon-dwg-source-geometry.json'), 'utf8'));
let model;
beforeAll(async () => { model = await buildDillonFloorByFloorModel(source); });

describe('Dillon source-grounded floor-by-floor model', () => {
  it('extrudes every exact DWG wall polygon at the actual floor datums', async () => {
    const result = await validateDillonFloorByFloorModel(model, source);
    expect(result.status).toBe('passed');
    expect(result.counts).toEqual({ levels: 3, wallSolids: 563, sourceEntities: 13225 });
    expect(model.levels.map((level) => [level.id, level.modelElevationFt, level.projectFloorElevationFt, level.wallPolygonsFt.length])).toEqual([
      ['main-house-main', 0, 1524.5, 314],
      ['main-house-upper', 12.5, 1537, 169],
      ['toy-garage', -21.5, 1503, 80],
    ]);
    expect(model.scaleEvidence).toMatchObject({ dwgSourceInchesPerFoot: 12, architecturalPdfPointsPerFoot: 13.5 });
    expect(model.datumEvidence.derivation).toBe("1537.00' - 112'-6\" = 1424.50'");
    expect(model.complianceReady).toBe(false);
  });

  it('keeps main and upper aligned while refusing to invent toy-garage registration', () => {
    expect(model.levels[0].coordinateFrame).toBe('main-house');
    expect(model.levels[1].coordinateFrame).toBe('main-house');
    expect(model.levels[2].coordinateFrame).toBe('toy-garage-local');
    expect(model.limitations.join(' ')).toContain('horizontal registration');
    expect(model.limitations.join(' ')).toContain('exterior-elevation sheet');
  });

  it('renders source top, side/elevation, and isometric extrusion views', async () => {
    const views = renderDillonFloorByFloorViews(await validateDillonFloorByFloorModel(model, source));
    expect(views.status).toBe('passed');
    expect(views.topViews).toHaveLength(3);
    expect(views.topViews[0].svg).toContain('314 exact Wall-Hatch polygons');
    expect(views.elevationSvg).toContain('exterior elevation sheet absent');
    expect(views.isometricSvg).toContain('563 DWG wall polygons extruded floor by floor');
  });

  it.each([
    ['scale', (value) => { value.scaleEvidence.dwgSourceInchesPerFoot = 10; }, 'DILLON_MODEL_SCHEMA_INVALID'],
    ['datum', (value) => { value.levels[1].modelElevationFt = 14; }, 'DILLON_MODEL_RECEIPT_MISMATCH'],
    ['wall polygon', (value) => { value.levels[0].wallPolygonsFt[0][0][0] += 1; }, 'DILLON_MODEL_RECEIPT_MISMATCH'],
    ['roof slope', (value) => { value.roofControls[0].riseIn = 4; }, 'DILLON_MODEL_RECEIPT_MISMATCH'],
    ['source hash', (value) => { value.levels[0].sourceSha256 = '0'.repeat(64); }, 'DILLON_MODEL_RECEIPT_MISMATCH'],
  ])('blocks receipt tampering: %s', async (_label, mutate, expectedCode) => {
    const changed = structuredClone(model); mutate(changed);
    const result = await validateDillonFloorByFloorModel(changed, source);
    expect(result.status).toBe('blocked');
    expect(result.issues.map((issue) => issue.code)).toContain(expectedCode);
  });

  it('blocks substitution of a different neutral geometry packet', async () => {
    const changedSource = structuredClone(source); changedSource.levels[0].wallPolygonsFt[0][0][0] += 0.5;
    const result = await validateDillonFloorByFloorModel(model, changedSource);
    expect(result.status).toBe('blocked');
    expect(result.issues.map((issue) => issue.code)).toContain('DILLON_SOURCE_GEOMETRY_MISMATCH');
  });
});

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import {
  extractElevationDatums,
  parseArchitecturalElevation,
  sealElevationDatumPacket,
} from '../src/engine/elevation-datums.js';
import { cooperative1881PlanManifest } from '../src/data/plan-manifest.js';

const binding = {
  sourcePdfSha256: 'b'.repeat(64), physicalPageNumber: 58, pageIndex: 57,
  renderedPageSha256: '4'.repeat(64), sheetId: 'A-201', coordinateSpace: 'pdf-points',
};

function draft(observations) {
  return {
    artifactType: 'halofire.elevation-datum-packet.v1', sourceDocumentId: 'cooperative-1881-architecturals',
    sourceBinding: binding,
    observations: observations.map((observation) => ({ ...observation, sourceBinding: binding })),
  };
}

describe('source-bound elevation datum extraction', () => {
  it('validates the checked-in Cooperative 1881 A-201 evidence packet', async () => {
    const packet = JSON.parse(fs.readFileSync(new URL('../src/data/elevation-datums.cooperative-1881.json', import.meta.url), 'utf8'));
    const result = await extractElevationDatums(packet, { expectedSourcePdfSha256: '179a572ea380be805131aabdeb7c3a3a041f9c2f5aaf55d2fcde673289ab6d53' });
    expect(result.status).toBe('passed');
    expect(result.sourceBinding.sheetId).toBe('A-201');
    expect(result.datums.map((datum) => datum.elevationFt)).toEqual([0, 10, 20, 31, 41, 51, 61, 71, 81, 89.5625]);
  });

  it('publishes the same source-bound level elevations through the plan manifest', () => {
    const manifest = cooperative1881PlanManifest();
    expect(manifest.estimatedFloorToFloorFt).toBeNull();
    expect(manifest.verticalDatumsVerified).toBe(true);
    expect(manifest.roofGeometryVerified).toBe(false);
    expect(manifest.levels.map((level) => level.elevationFt)).toEqual([0, 10, 20, 31, 41, 51, 61, 71]);
    expect(manifest.levels.every((level) => level.elevationSource === 'SOURCE_BOUND_ARCHITECTURAL_ELEVATION_A-201')).toBe(true);
  });

  it('parses architectural feet-inch and fractional-inch elevations exactly', () => {
    expect(parseArchitecturalElevation('+89\'-6 3/4"')).toBeCloseTo(89.5625, 9);
    expect(parseArchitecturalElevation('+10\'-0"')).toBe(10);
    expect(parseArchitecturalElevation('±0\'')).toBe(0);
    expect(parseArchitecturalElevation('+8\'-12"')).toBeNull();
  });

  it('extracts the actual 1881 floor/eave/ridge datum sequence from one sealed source page', async () => {
    const labels = [
      ['floor-1', 'floor', 'FIRST FLOOR', '±0\''], ['floor-2', 'floor', 'SECOND FLOOR', '+10\'-0"'],
      ['floor-3', 'floor', 'THIRD FLOOR', '+20\'-0"'], ['floor-4', 'floor', 'FOURTH FLOOR', '+31\'-0"'],
      ['floor-5', 'floor', 'FIFTH FLOOR', '+41\'-0"'], ['floor-6', 'floor', 'SIXTH FLOOR', '+51\'-0"'],
      ['floor-7', 'floor', 'SEVENTH FLOOR', '+61\'-0"'], ['floor-8', 'floor', 'EIGHTH FLOOR', '+71\'-0"'],
      ['roof-eave', 'eave', 'ROOF EAVE', '+81\'-0"'], ['roof-ridge', 'ridge', 'T.O. ROOF RIDGE', '+89\'-6 3/4"'],
    ];
    const sealed = await sealElevationDatumPacket(draft(labels.map(([id, kind, label, elevationText]) => ({ id, kind, label, elevationText }))));
    const result = await extractElevationDatums(sealed, { expectedSourcePdfSha256: 'b'.repeat(64) });
    expect(result.status).toBe('passed');
    expect(result.datums.map((datum) => datum.elevationFt)).toEqual([0, 10, 20, 31, 41, 51, 61, 71, 81, 89.5625]);
    expect(result.complianceReady).toBe(false);
  });

  it('rejects packet tampering after the receipt is sealed', async () => {
    const sealed = await sealElevationDatumPacket(draft([{ id: 'ridge', kind: 'ridge', label: 'RIDGE', elevationText: '+20\'-0"' }]));
    sealed.observations[0].elevationText = '+30\'-0"';
    const result = await extractElevationDatums(sealed);
    expect(result.status).toBe('blocked');
    expect(result.issues[0].code).toBe('ELEVATION_PACKET_RECEIPT_MISMATCH');
  });

  it('rejects per-datum page/hash substitution even with a newly sealed packet', async () => {
    const substituted = { ...binding, renderedPageSha256: '9'.repeat(64) };
    const packet = draft([{ id: 'ridge', kind: 'ridge', label: 'RIDGE', elevationFt: 20 }]);
    packet.observations[0].sourceBinding = substituted;
    const sealed = await sealElevationDatumPacket(packet);
    const result = await extractElevationDatums(sealed);
    expect(result.status).toBe('blocked');
    expect(result.issues.map((entry) => entry.code)).toContain('ELEVATION_DATUM_SOURCE_MISMATCH');
  });

  it('rejects conflicting duplicate semantic datums', async () => {
    const sealed = await sealElevationDatumPacket(draft([
      { id: 'eave-a', kind: 'eave', label: 'ROOF EAVE', elevationFt: 20 },
      { id: 'eave-b', kind: 'eave', label: 'ROOF EAVE', elevationFt: 21 },
    ]));
    const result = await extractElevationDatums(sealed);
    expect(result.status).toBe('blocked');
    expect(result.issues.map((entry) => entry.code)).toContain('ELEVATION_DATUM_CONFLICT');
  });
});

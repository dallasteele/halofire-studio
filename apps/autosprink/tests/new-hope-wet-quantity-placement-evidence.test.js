import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { evaluateNewHopeWetQuantityPlacementEvidence } from '../src/engine/new-hope-wet-quantity-placement-evidence.js';

const source = () => JSON.parse(readFileSync(fileURLToPath(new URL('../src/data/new-hope-wet-quantity-placement-evidence.json', import.meta.url)), 'utf8'));

describe('New Hope repeated wet listing quantity placements', () => {
  it('closes four BL34/BL35 source vectors from exact native outlet stations and PDF head centers', () => {
    const result = evaluateNewHopeWetQuantityPlacementEvidence(source());
    expect(result.status).toBe('passed');
    expect(result.definitions.flatMap((row) => row.instances)).toHaveLength(4);
    expect(result.metrics).toEqual(expect.objectContaining({ mappedNativeOutletCount: 8, maxOutletResidualIn: 0.010417 }));
    expect(result.quantityExpandedPieceEndpointMappingReady).toBe(true);
    expect(result.scopedPieceToPlanVectorMappingReady).toBe(true);
    expect(result.listingQuantityExpansionReady).toBe(true);
    expect(result.pieceToPlanVectorMappingReady).toBe(false);
    expect(result.fabricationReady).toBe(false);
  });

  it('rejects a moved source label', () => {
    const input = source();
    input.definitions[0].instances[1].lineLabelBoxPdfPt[0] += 1;
    const result = evaluateNewHopeWetQuantityPlacementEvidence(input);
    expect(result.status).toBe('blocked');
    expect(result.issues.map((entry) => entry.code)).toContain('NH_WET_QUANTITY_PLACEMENT_INVALID');
  });

  it('rejects missing quantity expansion', () => {
    const input = source();
    input.definitions[1].instances.pop();
    expect(evaluateNewHopeWetQuantityPlacementEvidence(input).status).toBe('blocked');
  });

  it('rejects an outlet moved beyond the quarter-inch registration gate', () => {
    const input = source();
    input.definitions[1].instances[0].mappedOutletHeads[1].pdfPt[0] += 0.25;
    const result = evaluateNewHopeWetQuantityPlacementEvidence(input);
    expect(result.status).toBe('blocked');
    expect(result.issues.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      'NH_WET_QUANTITY_PLACEMENT_INVALID',
      'NH_WET_QUANTITY_REGISTRATION_NOT_CLOSED',
    ]));
  });

  it('rejects conflating the drawn centerline with the longer fabrication cut vector', () => {
    const input = source();
    input.definitions[0].instances[0].fabricationCutVector.fromPdfPt = [...input.definitions[0].instances[0].sourceCenterline.fromPdfPt];
    const result = evaluateNewHopeWetQuantityPlacementEvidence(input);
    expect(result.status).toBe('blocked');
    expect(result.issues.map((entry) => entry.code)).toContain('NH_WET_QUANTITY_REGISTRATION_NOT_CLOSED');
  });

  it('rejects global mapping, fabrication, or field-release promotion', () => {
    for (const claim of ['pieceToPlanVectorMappingReady', 'fabricationReady', 'fieldReleaseReady']) {
      const input = source();
      input.claims[claim] = true;
      expect(evaluateNewHopeWetQuantityPlacementEvidence(input).status).toBe('blocked');
    }
  });
});

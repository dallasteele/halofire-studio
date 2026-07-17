import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { evaluateNewHopeWetQuantityPlacementEvidence } from '../src/engine/new-hope-wet-quantity-placement-evidence.js';
const source = () => JSON.parse(readFileSync(fileURLToPath(new URL('../src/data/new-hope-wet-quantity-placement-evidence.json', import.meta.url)), 'utf8'));
describe('New Hope repeated wet listing quantity placements', () => {
  it('binds two BL34 and two BL35 line/dimension anchors without inventing endpoints', () => { const result = evaluateNewHopeWetQuantityPlacementEvidence(source()); expect(result.status).toBe('passed'); expect(result.definitions.flatMap((row) => row.instances)).toHaveLength(4); expect(result.quantityExpandedLineLabelAnchorsReady).toBe(true); expect(result.quantityExpandedPieceEndpointMappingReady).toBe(false); expect(result.fabricationReady).toBe(false); });
  it('rejects a moved source label', () => { const input = source(); input.definitions[0].instances[1].lineLabelBoxPdfPt[0] += 1; const result = evaluateNewHopeWetQuantityPlacementEvidence(input); expect(result.status).toBe('blocked'); expect(result.issues.map((entry) => entry.code)).toContain('NH_WET_QUANTITY_PLACEMENT_INVALID'); });
  it('rejects missing quantity expansion', () => { const input = source(); input.definitions[1].instances.pop(); const result = evaluateNewHopeWetQuantityPlacementEvidence(input); expect(result.status).toBe('blocked'); });
  it('rejects endpoint or fabrication promotion', () => { for (const claim of ['quantityExpandedPieceEndpointMappingReady', 'pieceToPlanVectorMappingReady', 'fabricationReady', 'fieldReleaseReady']) { const input = source(); input.claims[claim] = true; expect(evaluateNewHopeWetQuantityPlacementEvidence(input).status).toBe('blocked'); } });
});

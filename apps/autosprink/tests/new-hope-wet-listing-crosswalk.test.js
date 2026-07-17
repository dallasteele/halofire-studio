import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildNewHopeWetListingCrosswalk } from '../src/engine/new-hope-wet-listing-crosswalk.js';

const load = (relativePath) => JSON.parse(readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8'));
const sources = () => ({
  wetLevel1NetworkEvidence: load('../src/data/new-hope-wet-level1-network-evidence.json'),
  fabricationEndSchedule: load('../src/data/new-hope-fabrication-end-schedule.json'),
});

describe('New Hope wet native-to-listing crosswalk', () => {
  it('reconciles all native pipe records while preserving definition and quantity boundaries', () => {
    const result = buildNewHopeWetListingCrosswalk(sources());
    expect(result.status).toBe('passed');
    expect(result.nativeRowToListingDefinitionReady).toBe(true);
    expect(result.threadedCutLengthCrossSourceReady).toBe(true);
    expect(result.metrics).toEqual(expect.objectContaining({
      nativePipeRecordCount: 167,
      uniqueListingDefinitionCount: 165,
      weldedNativeRecordCount: 100,
      threadedNativeRecordCount: 67,
      exactThreadedLengthMatchCount: 67,
      listingFabricatedUnitCount: 169,
      unexpandedListingUnitCount: 2,
    }));
    expect(result.rows).toHaveLength(167);
    expect(result.rows.filter((row) => row.pieceId === 'T-1')).toHaveLength(3);
    expect(result.quantityExpansionGaps).toEqual([
      { pieceId: 'BL34.01', nativePipeRecordCount: 1, listingQuantity: 2, unexpandedUnitCount: 1 },
      { pieceId: 'BL35.01', nativePipeRecordCount: 1, listingQuantity: 2, unexpandedUnitCount: 1 },
    ]);
    expect(result.weldedCutLengthCrossSourceReady).toBe(false);
    expect(result.listingQuantityExpansionReady).toBe(false);
    expect(result.pieceToPlanVectorMappingReady).toBe(false);
    expect(result.fabricationReady).toBe(false);
  });

  it('rejects a different listing source', () => {
    const input = sources();
    input.fabricationEndSchedule.source.sha256 = 'WRONG';
    const result = buildNewHopeWetListingCrosswalk(input);
    expect(result.status).toBe('blocked');
    expect(result.issues.map((entry) => entry.code)).toContain('NH_WET_LISTING_SOURCE_INVALID');
  });

  it('rejects a missing listing definition', () => {
    const input = sources();
    input.fabricationEndSchedule.weldedPieces = input.fabricationEndSchedule.weldedPieces.filter((piece) => piece.pieceId !== 'BL01.01');
    const result = buildNewHopeWetListingCrosswalk(input);
    expect(result.status).toBe('blocked');
    expect(result.issues.map((entry) => entry.code)).toContain('NH_WET_LISTING_CROSSWALK_INVALID');
  });

  it('rejects threaded length drift across the native and approved listing sources', () => {
    const input = sources();
    input.fabricationEndSchedule.threadedPieces.find((piece) => piece.pieceId === 'BL02.03').cutLengthIn += 0.25;
    const result = buildNewHopeWetListingCrosswalk(input);
    expect(result.status).toBe('blocked');
    expect(result.issues.map((entry) => entry.code)).toContain('NH_WET_LISTING_CROSSWALK_INVALID');
  });

  it('rejects a listing-page mutation through the fixed crosswalk fingerprint', () => {
    const input = sources();
    input.fabricationEndSchedule.weldedPieces.find((piece) => piece.pieceId === 'BL01.01').physicalPage += 1;
    const result = buildNewHopeWetListingCrosswalk(input);
    expect(result.status).toBe('blocked');
    expect(result.issues.map((entry) => entry.code)).toContain('NH_WET_LISTING_CROSSWALK_INVALID');
  });
});

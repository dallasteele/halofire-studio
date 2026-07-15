import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { evaluateApprovedFp20ArchitecturalVerticalControls } from '../src/engine/approved-fp20-architectural-vertical-controls.js';

const source = JSON.parse(fs.readFileSync(new URL('../src/data/new-hope-pitched-holdout-source.json', import.meta.url), 'utf8'));
const mutate = (callback) => { const copy = structuredClone(source); callback(copy); return copy; };

describe('approved FP2.0 architectural vertical controls', () => {
  it('registers the exact RCP, roof, elevation, section, and coordinated DWG source envelope', () => {
    const result = evaluateApprovedFp20ArchitecturalVerticalControls(source);
    expect(result.status).toBe('passed');
    expect(result.registeredSheets).toEqual([
      { sheet: 'A102', physicalPageNumber: 23, role: 'reflected-ceiling-plan' },
      { sheet: 'A103', physicalPageNumber: 24, role: 'roof-plan' },
      { sheet: 'A201', physicalPageNumber: 25, role: 'exterior-elevations' },
      { sheet: 'A301', physicalPageNumber: 26, role: 'building-sections' },
    ]);
    expect(result.roofEnvelope).toEqual({ slopeRise: 4, slopeRun: 12, eaveDatumZFt: 11.083333, ridgeDatumZFt: 21.208333, trussBearingDatumZFt: 10.96875 });
    expect(result.sourceRegistrationReady).toBe(true);
    expect(result.architecturalVerticalControlReady).toBe(true);
    expect(result.pipeCenterlineOffsetReady).toBe(false);
    expect(result.endpointElevationsReady).toBe(false);
    expect(result.gradeDirectionReady).toBe(false);
    expect(result.properPipeLayoutReady).toBe(false);
  });

  it('rejects a substituted architectural PDF or coordinated DWG', () => {
    expect(evaluateApprovedFp20ArchitecturalVerticalControls(mutate((copy) => { copy.protectedSources.architecturalPdf.sha256 = 'drift'; })).blockerCodes).toContain('FP20_ARCHITECTURAL_PDF_IDENTITY_INVALID');
    expect(evaluateApprovedFp20ArchitecturalVerticalControls(mutate((copy) => { copy.protectedSources.dwgs.section3.unknownEntityCount = 1; })).blockerCodes).toContain('FP20_ARCHITECTURAL_DWG_IDENTITY_INVALID');
  });

  it('rejects sheet, pitch, and vertical datum drift', () => {
    expect(evaluateApprovedFp20ArchitecturalVerticalControls(mutate((copy) => { copy.pitchedConcealedVolume.sourceRegistration.section.pdfPageNumber = 25; })).blockerCodes).toContain('FP20_ARCHITECTURAL_SHEET_REGISTRATION_INVALID');
    expect(evaluateApprovedFp20ArchitecturalVerticalControls(mutate((copy) => { copy.pitchedConcealedVolume.ridgeDatumZFt = 22; })).blockerCodes).toContain('FP20_ARCHITECTURAL_VERTICAL_DATUM_INVALID');
  });
});

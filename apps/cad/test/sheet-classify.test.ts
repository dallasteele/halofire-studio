import { classifySheet } from '../src/lib/sheet-classify';
import { expect, it, describe } from 'vitest';

describe('classifySheet', () => {
    it('classifies a floor plan and extracts word-ordinal floor', () => {
        const info = classifySheet('SECOND FLOOR PLAN  A-102');
        expect(info.kind).toBe('floor-plan');
        expect(info.score).toBe(0.8);
        expect(info.floor).toBe(2);
    });

    it('classifies fire protection and extracts level floor', () => {
        const info = classifySheet('FP-3 FIRE SPRINKLER PLAN LEVEL 3');
        expect(info.kind).toBe('fire-protection');
        expect(info.score).toBe(0.9);
        expect(info.floor).toBe(3);
    });

    it('classifies schedules', () => {
        const info = classifySheet('DOOR SCHEDULE');
        expect(info.kind).toBe('schedule');
        expect(info.score).toBe(0.7);
        expect(info.floor).toBeNull();
    });

    it('classifies details and sections', () => {
        expect(classifySheet('TYPICAL DETAILS').kind).toBe('detail');
        expect(classifySheet('WALL SECTION').kind).toBe('detail');
        expect(classifySheet('TYPICAL DETAILS').score).toBe(0.6);
    });

    it('classifies title sheets', () => {
        const info = classifySheet('COVER SHEET / SHEET INDEX');
        expect(info.kind).toBe('title');
        expect(info.score).toBe(0.8);
    });

    it('returns other with score 0 for unrelated text', () => {
        const info = classifySheet('lorem ipsum dolor sit amet consectetur');
        expect(info.kind).toBe('other');
        expect(info.score).toBe(0);
        expect(info.floor).toBeNull();
        expect(info.sheetNo).toBeNull();
    });

    it('gives fire-protection precedence over floor-plan', () => {
        const info = classifySheet('FP-1 FIRE SPRINKLER FLOOR PLAN');
        expect(info.kind).toBe('fire-protection');
        expect(info.score).toBe(0.9);
    });

    it('extracts digit-form floor numbers', () => {
        expect(classifySheet('3RD FLOOR PLAN').floor).toBe(3);
        expect(classifySheet('12TH FLOOR PLAN').floor).toBe(12);
    });

    it('extracts sheetNo from a line mentioning sheet/dwg/no', () => {
        expect(classifySheet('SHEET NO. A-102\nFLOOR PLAN').sheetNo).toBe('A-102');
        expect(classifySheet('DWG: FP-3\nFIRE SPRINKLER PLAN').sheetNo).toBe('FP-3');
    });

    it('falls back to a sheet-number token near the word SHEET', () => {
        // Token sits on its own line (no sheet/dwg/no hint), but is within
        // 40 characters of the word SHEET on the next line.
        const info = classifySheet('A-102\nSHEET TWO OF TEN');
        expect(info.sheetNo).toBe('A-102');
    });

    it('returns null sheetNo when no token qualifies', () => {
        expect(classifySheet('SECOND FLOOR PLAN  A-102').sheetNo).toBeNull();
        expect(classifySheet('COVER SHEET / SHEET INDEX').sheetNo).toBeNull();
    });

    it('throws TypeError on non-string input', () => {
        expect(() => classifySheet(42 as unknown as string)).toThrow(TypeError);
        expect(() => classifySheet(null as unknown as string)).toThrow(TypeError);
        expect(() => classifySheet(undefined as unknown as string)).toThrow(TypeError);
    });
});

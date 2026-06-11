import { parseScaleNotation, ftPerUnitFromPdfPoints } from '../src/lib/scale-notation';
import { expect, it, describe } from 'vitest';

describe('parseScaleNotation', () => {
    it('parses eighth-inch architectural scale to 8 ft per inch', () => {
        const result = parseScaleNotation(`1/8" = 1'-0"`);
        expect(result).not.toBeNull();
        expect(result!.ftPerInch).toBe(8);
        expect(result!.notation).toBe(`1/8" = 1'-0"`);
    });

    it('parses 3/32 inch scale to 32/3 ft per inch', () => {
        const result = parseScaleNotation(`3/32"=1'-0"`);
        expect(result).not.toBeNull();
        expect(result!.ftPerInch).toBeCloseTo(32 / 3, 6);
    });

    it('parses spelled-out units, case insensitive', () => {
        const result = parseScaleNotation('1/4 IN = 1 FT');
        expect(result).not.toBeNull();
        expect(result!.ftPerInch).toBe(4);
    });

    it('parses civil whole-inch scale 1" = 40 ft', () => {
        const result = parseScaleNotation(`1" = 40'`);
        expect(result).not.toBeNull();
        expect(result!.ftPerInch).toBe(40);
    });

    it('parses ratio form 1:96 to 8 ft per inch', () => {
        const result = parseScaleNotation('SCALE 1:96');
        expect(result).not.toBeNull();
        expect(result!.ftPerInch).toBeCloseTo(8, 6);
        expect(result!.notation).toBe('1:96');
    });

    it('returns null when no notation matches', () => {
        expect(parseScaleNotation('SCALE: AS NOTED')).toBeNull();
        expect(parseScaleNotation('')).toBeNull();
        expect(parseScaleNotation('GENERAL NOTES SHEET')).toBeNull();
    });

    it('uses the first notation when multiple appear', () => {
        const inchFirst = parseScaleNotation(`1" = 40' (ALSO SHOWN 1:96)`);
        expect(inchFirst).not.toBeNull();
        expect(inchFirst!.ftPerInch).toBe(40);

        const ratioFirst = parseScaleNotation(`RATIO 1:96 THEN 1" = 40'`);
        expect(ratioFirst).not.toBeNull();
        expect(ratioFirst!.ftPerInch).toBeCloseTo(8, 6);
    });

    it('tolerates extra whitespace around tokens', () => {
        const result = parseScaleNotation(`SCALE:   1/8 "  =  1 ' - 0 "`);
        expect(result).not.toBeNull();
        expect(result!.ftPerInch).toBe(8);
    });

    it('never throws on junk input', () => {
        expect(() => parseScaleNotation(':::///===')).not.toThrow();
        expect(parseScaleNotation(':::///===')).toBeNull();
    });
});

describe('ftPerUnitFromPdfPoints', () => {
    it('divides ft per inch by 72 points per inch', () => {
        expect(ftPerUnitFromPdfPoints(8)).toBeCloseTo(8 / 72, 6);
        expect(ftPerUnitFromPdfPoints(40)).toBeCloseTo(40 / 72, 6);
    });

    it('throws on non-positive or non-finite input', () => {
        expect(() => ftPerUnitFromPdfPoints(0)).toThrow();
        expect(() => ftPerUnitFromPdfPoints(-8)).toThrow();
        expect(() => ftPerUnitFromPdfPoints(NaN)).toThrow();
        expect(() => ftPerUnitFromPdfPoints(Infinity)).toThrow();
    });
});

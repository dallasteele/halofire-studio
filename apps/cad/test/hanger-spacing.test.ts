import {
    MAX_HANGER_SPACING_FT,
    MAX_END_DISTANCE_FT,
    hangersForSegment
} from '../src/lib/hanger-spacing';
import { expect, it, describe } from 'vitest';

const A = { x: 0, y: 0, z: 10 };

describe('hanger constants', () => {
    it('all citations end with "Verify adopted edition."', () => {
        expect(MAX_END_DISTANCE_FT.citation.endsWith('Verify adopted edition.')).toBe(true);
        for (const cited of Object.values(MAX_HANGER_SPACING_FT)) {
            expect(cited.citation.endsWith('Verify adopted edition.')).toBe(true);
        }
    });

    it('carries the spec spacing values per nominal', () => {
        expect(MAX_HANGER_SPACING_FT[1].value).toBe(12);
        expect(MAX_HANGER_SPACING_FT[1.25].value).toBe(12);
        expect(MAX_HANGER_SPACING_FT[1.5].value).toBe(15);
        expect(MAX_HANGER_SPACING_FT[2].value).toBe(15);
        expect(MAX_HANGER_SPACING_FT[2.5].value).toBe(15);
        expect(MAX_HANGER_SPACING_FT[3].value).toBe(15);
        expect(MAX_HANGER_SPACING_FT[4].value).toBe(15);
        expect(MAX_HANGER_SPACING_FT[6].value).toBe(15);
        expect(MAX_HANGER_SPACING_FT[8].value).toBe(15);
        expect(MAX_END_DISTANCE_FT.value).toBe(3);
    });
});

describe('hangersForSegment', () => {
    it('places 3 hangers on a 30 ft 2 in run at t = 0.1, 0.5, 0.9 with 12 ft gaps', () => {
        const b = { x: 30, y: 0, z: 10 };
        const points = hangersForSegment({ id: 's1', diameterIn: 2, lengthFt: 30 }, A, b);

        expect(points.length).toBe(3);
        expect(points[0].t).toBeCloseTo(0.1, 6);
        expect(points[1].t).toBeCloseTo(0.5, 6);
        expect(points[2].t).toBeCloseTo(0.9, 6);

        // First/last within 3 ft of the ends.
        expect(points[0].t * 30).toBeLessThanOrEqual(MAX_END_DISTANCE_FT.value + 1e-9);
        expect((1 - points[2].t) * 30).toBeLessThanOrEqual(MAX_END_DISTANCE_FT.value + 1e-9);

        // Gaps equal (30 - 6) / 2 = 12 ft <= 15 ft.
        for (let i = 1; i < points.length; i++) {
            const gapFt = (points[i].t - points[i - 1].t) * 30;
            expect(gapFt).toBeCloseTo(12, 6);
            expect(gapFt).toBeLessThanOrEqual(15 + 1e-9);
        }

        // Positions interpolated between a and b.
        expect(points[0].x).toBeCloseTo(3, 6);
        expect(points[1].x).toBeCloseTo(15, 6);
        expect(points[2].x).toBeCloseTo(27, 6);
        for (const p of points) {
            expect(p.segmentId).toBe('s1');
            expect(p.y).toBeCloseTo(0, 6);
            expect(p.z).toBeCloseTo(10, 6);
        }
    });

    it('places a single hanger at t = 0.5 on a 4 ft run', () => {
        const b = { x: 4, y: 0, z: 10 };
        const points = hangersForSegment({ id: 's2', diameterIn: 2, lengthFt: 4 }, A, b);
        expect(points.length).toBe(1);
        expect(points[0].t).toBeCloseTo(0.5, 6);
        expect(points[0].x).toBeCloseTo(2, 6);
    });

    it('rounds the diameter UP to the next defined nominal for the spacing lookup', () => {
        // 36 ft run, span = 30 ft. Diameter 1.1 rounds up to 1.25 (12 ft max
        // spacing) -> 4 hangers; diameter 2 (15 ft) -> 3 hangers.
        const b = { x: 36, y: 0, z: 10 };
        const narrow = hangersForSegment({ id: 's3', diameterIn: 1.1, lengthFt: 36 }, A, b);
        const wide = hangersForSegment({ id: 's4', diameterIn: 2, lengthFt: 36 }, A, b);
        expect(narrow.length).toBe(4);
        expect(wide.length).toBe(3);
    });

    it('falls back to 15 ft spacing above the largest defined nominal', () => {
        // 36 ft run with a 10 in pipe (not in the table) -> 15 ft spacing -> 3 hangers.
        const b = { x: 36, y: 0, z: 10 };
        const points = hangersForSegment({ id: 's5', diameterIn: 10, lengthFt: 36 }, A, b);
        expect(points.length).toBe(3);
    });

    it('throws on lengthFt 0', () => {
        const b = { x: 0, y: 0, z: 10 };
        expect(() =>
            hangersForSegment({ id: 's6', diameterIn: 2, lengthFt: 0 }, A, b)
        ).toThrow('lengthFt must be > 0');
    });

    it('throws on non-finite inputs', () => {
        const b = { x: NaN, y: 0, z: 10 };
        expect(() =>
            hangersForSegment({ id: 's7', diameterIn: 2, lengthFt: 30 }, A, b)
        ).toThrow('Non-finite input');
    });
});

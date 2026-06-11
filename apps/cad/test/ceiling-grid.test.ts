import { ceilingGridForBounds, polygonBounds } from '../src/lib/ceiling-grid';
import { expect, it, describe } from 'vitest';

const EPSILON = 1e-6;

function assertLinesEqual(actual: any[], expected: any[]) {
    expect(actual.length).toBe(expected.length);
    for (let i = 0; i < actual.length; i++) {
        const a = actual[i];
        const e = expected[i];
        expect(a.x1).toBeCloseTo(e.x1, EPSILON);
        expect(a.y1).toBeCloseTo(e.y1, EPSILON);
        expect(a.x2).toBeCloseTo(e.x2, EPSILON);
        expect(a.y2).toBeCloseTo(e.y2, EPSILON);
    }
}

describe('ceilingGridForBounds', () => {
    it('generates correct grid for 12x8 room with defaults', () => {
        const result = ceilingGridForBounds(0, 0, 12, 8);
        expect(result.cellW).toBe(4);
        expect(result.cellH).toBe(2);
        expect(result.originX).toBe(0);
        expect(result.originY).toBe(0);

        const vLines = result.lines.filter(line => line.dir === 'y');
        const hLines = result.lines.filter(line => line.dir === 'x');

        // Vertical lines at x=4,8 spanning 0-8
        expect(vLines.length).toBe(2);
        assertLinesEqual(vLines, [
            { x1: 4, y1: 0, x2: 4, y2: 8 },
            { x1: 8, y1: 0, x2: 8, y2: 8 }
        ]);

        // Horizontal lines at y=2,4,6 spanning 0-12
        expect(hLines.length).toBe(3);
        assertLinesEqual(hLines, [
            { x1: 0, y1: 2, x2: 12, y2: 2 },
            { x1: 0, y1: 4, x2: 12, y2: 4 },
            { x1: 0, y1: 6, x2: 12, y2: 6 }
        ]);
    });

    it('shifts phase with custom origin', () => {
        const result = ceilingGridForBounds(0, 0, 12, 8, { originX: 1, originY: 3 });
        expect(result.originX).toBe(1);
        expect(result.originY).toBe(3);

        const vLines = result.lines.filter(line => line.dir === 'y');
        const hLines = result.lines.filter(line => line.dir === 'x');

        // Vertical lines at x=5,9 spanning 0-8 (originX + cellW steps)
        expect(vLines.length).toBe(2);
        assertLinesEqual(vLines, [
            { x1: 5, y1: 0, x2: 5, y2: 8 },
            { x1: 9, y1: 0, x2: 9, y2: 8 }
        ]);

        // Horizontal lines at y=5,7 spanning 0-12 (originY + cellH steps)
        expect(hLines.length).toBe(2);
        assertLinesEqual(hLines, [
            { x1: 0, y1: 5, x2: 12, y2: 5 },
            { x1: 0, y1: 7, x2: 12, y2: 7 }
        ]);
    });

    it('throws on non-positive cell dimensions', () => {
        expect(() => ceilingGridForBounds(0, 0, 10, 10, { cellW: -1 })).toThrow();
        expect(() => ceilingGridForBounds(0, 0, 10, 10, { cellH: 0 })).toThrow();
    });

    it('throws on degenerate bounds', () => {
        expect(() => ceilingGridForBounds(5, 5, 5, 10)).toThrow();
        expect(() => ceilingGridForBounds(0, 0, -1, 10)).toThrow();
    });
});

describe('polygonBounds', () => {
    it('calculates bounds for a triangle', () => {
        const poly = [{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 6 }];
        const bounds = polygonBounds(poly);
        expect(bounds.minX).toBe(1);
        expect(bounds.minY).toBe(2);
        expect(bounds.maxX).toBe(5);
        expect(bounds.maxY).toBe(6);
    });

    it('throws on non-finite points', () => {
        const poly = [{ x: 1, y: 2 }, { x: NaN, y: 4 }, { x: 5, y: 6 }];
        expect(() => polygonBounds(poly)).toThrow();
    });

    it('throws on polygons with less than 3 points', () => {
        const poly = [{ x: 1, y: 2 }, { x: 3, y: 4 }];
        expect(() => polygonBounds(poly)).toThrow();
    });
});

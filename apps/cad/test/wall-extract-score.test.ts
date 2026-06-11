import { dominantStrokeWidth, scoreWallCandidates } from '../src/lib/wall-extract-score';
import { expect, it, describe } from 'vitest';
import type { ScoredLine } from '../src/lib/wall-extract-score';

function line(
    x1: number, y1: number, x2: number, y2: number,
    strokeWidthPt: number, layer?: string
): ScoredLine {
    return { x1, y1, x2, y2, strokeWidthPt, layer };
}

describe('dominantStrokeWidth', () => {
    it('picks the most frequent width among lines longer than the median', () => {
        // Four short (length 1) thin lines, three long (length 20) lines.
        // Median length = 1, so only the long lines count: 2.83 wins 2:1.
        const lines: ScoredLine[] = [
            line(0, 0, 1, 0, 0.5),
            line(0, 1, 1, 1, 0.5),
            line(0, 2, 1, 2, 0.5),
            line(0, 3, 1, 3, 0.5),
            line(0, 10, 20, 10, 2.83),
            line(0, 20, 20, 20, 2.83),
            line(0, 30, 20, 30, 1.0)
        ];
        expect(dominantStrokeWidth(lines)).toBeCloseTo(2.83, 6);
    });

    it('rounds widths to 2 decimals when grouping', () => {
        const lines: ScoredLine[] = [
            line(0, 0, 1, 0, 0.5),
            line(0, 10, 20, 10, 2.831),
            line(0, 20, 20, 20, 2.829),
            line(0, 30, 20, 30, 1.0)
        ];
        expect(dominantStrokeWidth(lines)).toBeCloseTo(2.83, 6);
    });

    it('throws on empty input', () => {
        expect(() => dominantStrokeWidth([])).toThrow('Input lines cannot be empty');
    });
});

describe('scoreWallCandidates', () => {
    it('scores a 2.83pt long axis-aligned line 1.0 with all 3 reasons', () => {
        const lines: ScoredLine[] = [line(0, 0, 20, 0, 2.83)];
        const scores = scoreWallCandidates(lines, { targetWidthPt: 2.83 });
        expect(scores).toEqual([
            { index: 0, score: 1.0, reasons: ['stroke-match', 'long-enough', 'axis-aligned'] }
        ]);
    });

    it('scores a thin short diagonal 0 with no reasons', () => {
        const lines: ScoredLine[] = [line(0, 0, 1, 1, 0.25)];
        const scores = scoreWallCandidates(lines, { targetWidthPt: 2.83 });
        expect(scores).toEqual([{ index: 0, score: 0, reasons: [] }]);
    });

    it('defaults target to dominantStrokeWidth of the input', () => {
        // Dominant width among long lines is 2.83 — the thin short line misses.
        const lines: ScoredLine[] = [
            line(0, 0, 20, 0, 2.83),
            line(0, 5, 20, 5, 2.83),
            line(0, 9, 1, 9, 0.5)
        ];
        const scores = scoreWallCandidates(lines);
        const byIndex = [...scores].sort((a, b) => a.index - b.index);
        expect(byIndex[0].reasons).toContain('stroke-match');
        expect(byIndex[1].reasons).toContain('stroke-match');
        expect(byIndex[2].reasons).not.toContain('stroke-match');
    });

    it('sorts by score desc then index asc', () => {
        const lines: ScoredLine[] = [
            line(0, 0, 1, 0, 2.83),   // stroke-match + axis-aligned = 0.7
            line(0, 1, 20, 1, 2.83),  // all three = 1.0
            line(0, 2, 1, 2, 2.83)    // stroke-match + axis-aligned = 0.7
        ];
        const scores = scoreWallCandidates(lines, { targetWidthPt: 2.83 });
        expect(scores).toEqual([
            { index: 1, score: 1.0, reasons: ['stroke-match', 'long-enough', 'axis-aligned'] },
            { index: 0, score: 0.7, reasons: ['stroke-match', 'axis-aligned'] },
            { index: 2, score: 0.7, reasons: ['stroke-match', 'axis-aligned'] }
        ]);
    });

    it('throws on empty input', () => {
        expect(() => scoreWallCandidates([])).toThrow('Input lines cannot be empty');
    });
});

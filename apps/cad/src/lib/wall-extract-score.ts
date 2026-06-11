/**
 * Import > PDF wall-candidate scoring (stroke-weight signal, pure).
 *
 * Codifies the verified 1881 stroke-weight wall signal as a pure scorer
 * for assisted extraction (W9). Lines carry geometry + strokeWidthPt +
 * optional layer; the scorer ranks lines by how wall-like they are.
 */

export interface ScoredLine {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    strokeWidthPt: number;
    layer?: string;
}

export interface WallScore {
    index: number;
    score: number;
    reasons: string[];
}

function lineLength(line: ScoredLine): number {
    return Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
}

function roundWidth(w: number): number {
    return Math.round(w * 100) / 100;
}

function medianOf(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
        return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    return sorted[mid];
}

/**
 * The most frequent strokeWidthPt among lines LONGER than the median
 * length (widths rounded to 2 decimals). Falls back to all lines when
 * no line is strictly longer than the median (e.g. uniform lengths).
 * Throws on empty input.
 */
export function dominantStrokeWidth(lines: ScoredLine[]): number {
    if (lines.length === 0) {
        throw new Error('Input lines cannot be empty');
    }

    const lengths = lines.map(lineLength);
    const median = medianOf(lengths);
    let pool = lines.filter((_, i) => lengths[i] > median);
    if (pool.length === 0) {
        pool = lines;
    }

    const counts = new Map<number, number>();
    for (const line of pool) {
        const w = roundWidth(line.strokeWidthPt);
        counts.set(w, (counts.get(w) ?? 0) + 1);
    }

    let bestWidth = roundWidth(pool[0].strokeWidthPt);
    let bestCount = 0;
    for (const [width, count] of counts) {
        if (count > bestCount || (count === bestCount && width < bestWidth)) {
            bestWidth = width;
            bestCount = count;
        }
    }
    return bestWidth;
}

/**
 * Score each line in [0, 1] as a wall candidate:
 *   +0.5 when |strokeWidthPt - target| <= 0.05  ('stroke-match')
 *   +0.3 when length >= minLengthFt (default 3) ('long-enough')
 *   +0.2 when axis-aligned within 2 degrees    ('axis-aligned')
 * target = opts.targetWidthPt ?? dominantStrokeWidth(lines).
 * Output sorted by score desc, then index asc. Throws on empty input.
 */
export function scoreWallCandidates(
    lines: ScoredLine[],
    opts?: { targetWidthPt?: number; minLengthFt?: number }
): WallScore[] {
    if (lines.length === 0) {
        throw new Error('Input lines cannot be empty');
    }

    const target = opts?.targetWidthPt ?? dominantStrokeWidth(lines);
    const minLengthFt = opts?.minLengthFt ?? 3;

    const scores: WallScore[] = lines.map((line, index) => {
        let score = 0;
        const reasons: string[] = [];

        if (Math.abs(line.strokeWidthPt - target) <= 0.05) {
            score += 0.5;
            reasons.push('stroke-match');
        }

        if (lineLength(line) >= minLengthFt) {
            score += 0.3;
            reasons.push('long-enough');
        }

        const dx = Math.abs(line.x2 - line.x1);
        const dy = Math.abs(line.y2 - line.y1);
        const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
        if (angleDeg <= 2 || angleDeg >= 88) {
            score += 0.2;
            reasons.push('axis-aligned');
        }

        return { index, score: Math.round(score * 100) / 100, reasons };
    });

    return scores.sort((a, b) => (b.score - a.score) || (a.index - b.index));
}

/**
 * Auto Draw > Hangers — NFPA hanger placement along pipe runs (cited, pure).
 *
 * AutoSprink-style 'Hangers' auto-placement math for steel pipe. Maximum
 * hanger spacings follow the NFPA-13 hanger table class for steel pipe;
 * limits are edition-dependent — every exported constant carries a
 * citation; verify against the adopted edition.
 */

export interface CitedNumber {
    value: number;
    citation: string;
}

function steelSpacing(nominal: string, value: number): CitedNumber {
    return {
        value,
        citation: `NFPA 13 max hanger spacing, steel pipe, ${nominal} in nominal (${value} ft). Verify adopted edition.`
    };
}

export const MAX_HANGER_SPACING_FT: Record<number, CitedNumber> = {
    1: steelSpacing('1', 12),
    1.25: steelSpacing('1-1/4', 12),
    1.5: steelSpacing('1-1/2', 15),
    2: steelSpacing('2', 15),
    2.5: steelSpacing('2-1/2', 15),
    3: steelSpacing('3', 15),
    4: steelSpacing('4', 15),
    6: steelSpacing('6', 15),
    8: steelSpacing('8', 15)
};

export const MAX_END_DISTANCE_FT: CitedNumber = {
    value: 3,
    citation: 'NFPA 13 max unsupported distance from a pipe end to the nearest hanger (3 ft). Verify adopted edition.'
};

export interface HangerPoint {
    segmentId: string;
    t: number;
    x: number;
    y: number;
    z: number;
}

/** Max spacing for a diameter: nearest defined nominal >= diameterIn, else 15. */
function maxSpacingForDiameter(diameterIn: number): number {
    const nominals = Object.keys(MAX_HANGER_SPACING_FT)
        .map(Number)
        .sort((a, b) => a - b);
    for (const nominal of nominals) {
        if (nominal >= diameterIn) {
            return MAX_HANGER_SPACING_FT[nominal].value;
        }
    }
    return 15;
}

/**
 * Place hangers along a pipe segment so that the first hanger lies within
 * MAX_END_DISTANCE_FT of end a, the last within MAX_END_DISTANCE_FT of
 * end b, and adjacent hangers are no farther apart than the max hanger
 * spacing for the pipe diameter. Uses the MINIMUM hanger count satisfying
 * both, evenly spaced (equal gaps) between the first/last positions.
 * Segments shorter than 2 * MAX_END_DISTANCE_FT get exactly ONE hanger at
 * t = 0.5. Positions are linearly interpolated between a and b. Throws on
 * non-finite inputs or lengthFt <= 0.
 */
export function hangersForSegment(
    seg: { id: string; diameterIn: number; lengthFt: number },
    a: { x: number; y: number; z: number },
    b: { x: number; y: number; z: number }
): HangerPoint[] {
    const numbers = [seg.diameterIn, seg.lengthFt, a.x, a.y, a.z, b.x, b.y, b.z];
    if (numbers.some(n => !Number.isFinite(n))) {
        throw new Error('Non-finite input');
    }
    if (seg.lengthFt <= 0) {
        throw new Error('lengthFt must be > 0');
    }

    const lerp = (t: number): HangerPoint => ({
        segmentId: seg.id,
        t,
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        z: a.z + (b.z - a.z) * t
    });

    const endFt = MAX_END_DISTANCE_FT.value;
    if (seg.lengthFt < 2 * endFt) {
        return [lerp(0.5)];
    }

    const spacingFt = maxSpacingForDiameter(seg.diameterIn);
    const spanFt = seg.lengthFt - 2 * endFt;
    const count = Math.max(2, Math.ceil(spanFt / spacingFt) + 1);

    const tFirst = endFt / seg.lengthFt;
    const tLast = (seg.lengthFt - endFt) / seg.lengthFt;
    const points: HangerPoint[] = [];
    for (let i = 0; i < count; i++) {
        const t = tFirst + ((tLast - tFirst) * i) / (count - 1);
        points.push(lerp(t));
    }
    return points;
}

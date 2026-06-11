/**
 * Commands > Analyze coverage — head-to-wall clearance checks (cited, pure).
 *
 * NFPA-13-style head placement clearance checks for standard spray
 * sprinklers. Limits are edition-dependent — every exported constant
 * carries a citation; verify against the adopted edition before relying
 * on these numbers for compliance.
 */

export interface CitedNumber {
    value: number;
    citation: string;
}

export type HazardClass = 'LIGHT' | 'ORDINARY_1' | 'ORDINARY_2' | 'EXTRA_1' | 'EXTRA_2';

export const MAX_SPACING_FT: Record<HazardClass, CitedNumber> = {
    LIGHT: {
        value: 15,
        citation: 'NFPA 13 standard spray spacing, light hazard (15 ft). Verify adopted edition.'
    },
    ORDINARY_1: {
        value: 15,
        citation: 'NFPA 13 standard spray spacing, ordinary hazard group 1 (15 ft). Verify adopted edition.'
    },
    ORDINARY_2: {
        value: 15,
        citation: 'NFPA 13 standard spray spacing, ordinary hazard group 2 (15 ft). Verify adopted edition.'
    },
    EXTRA_1: {
        value: 12,
        citation: 'NFPA 13 standard spray spacing, extra hazard group 1 (12 ft). Verify adopted edition.'
    },
    EXTRA_2: {
        value: 12,
        citation: 'NFPA 13 standard spray spacing, extra hazard group 2 (12 ft). Verify adopted edition.'
    }
};

export const MIN_WALL_CLEARANCE_FT: CitedNumber = {
    value: 0.3333,
    citation: 'NFPA 13 minimum sprinkler distance from wall, 4 in (0.3333 ft). Verify adopted edition.'
};

export interface ClearanceIssue {
    headId: string;
    kind: 'too-close-to-wall' | 'too-far-from-wall';
    distanceFt: number;
    limitFt: number;
    citation: string;
}

function pointToSegmentDistance(
    px: number, pz: number,
    x1: number, z1: number, x2: number, z2: number
): number {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const lenSq = dx * dx + dz * dz;
    if (lenSq === 0) {
        return Math.hypot(px - x1, pz - z1);
    }
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (pz - z1) * dz) / lenSq));
    return Math.hypot(px - (x1 + t * dx), pz - (z1 + t * dz));
}

/**
 * Check each head's distance to its NEAREST wall segment (point-to-segment
 * 2D, plan coordinates x/z). Too-close when closer than the minimum wall
 * clearance; too-far when beyond HALF the allowed head spacing for the
 * hazard. Heads with NO walls produce no issues (honest skip). Output is
 * sorted by headId.
 */
export function checkWallClearance(
    heads: Array<{ id: string; x: number; z: number }>,
    wallSegments: Array<{ x1: number; z1: number; x2: number; z2: number }>,
    hazard: HazardClass
): ClearanceIssue[] {
    if (wallSegments.length === 0) {
        return [];
    }

    const maxFromWallFt = MAX_SPACING_FT[hazard].value / 2;
    const issues: ClearanceIssue[] = [];

    for (const head of heads) {
        let nearest = Infinity;
        for (const wall of wallSegments) {
            const d = pointToSegmentDistance(head.x, head.z, wall.x1, wall.z1, wall.x2, wall.z2);
            if (d < nearest) {
                nearest = d;
            }
        }

        if (nearest < MIN_WALL_CLEARANCE_FT.value) {
            issues.push({
                headId: head.id,
                kind: 'too-close-to-wall',
                distanceFt: nearest,
                limitFt: MIN_WALL_CLEARANCE_FT.value,
                citation: MIN_WALL_CLEARANCE_FT.citation
            });
        } else if (nearest > maxFromWallFt) {
            issues.push({
                headId: head.id,
                kind: 'too-far-from-wall',
                distanceFt: nearest,
                limitFt: maxFromWallFt,
                citation: MAX_SPACING_FT[hazard].citation
            });
        }
    }

    return issues.sort((a, b) => (a.headId < b.headId ? -1 : a.headId > b.headId ? 1 : 0));
}

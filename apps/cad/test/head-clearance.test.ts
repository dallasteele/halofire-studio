import {
    MAX_SPACING_FT,
    MIN_WALL_CLEARANCE_FT,
    checkWallClearance
} from '../src/lib/head-clearance';
import { expect, it, describe } from 'vitest';

// One wall along the z axis at x=0, from z=0 to z=20.
const WALL_X0 = [{ x1: 0, z1: 0, x2: 0, z2: 20 }];

describe('clearance constants', () => {
    it('all citations end with "Verify adopted edition."', () => {
        expect(MIN_WALL_CLEARANCE_FT.citation.endsWith('Verify adopted edition.')).toBe(true);
        for (const cited of Object.values(MAX_SPACING_FT)) {
            expect(cited.citation.endsWith('Verify adopted edition.')).toBe(true);
        }
    });

    it('carries the spec spacing values per hazard', () => {
        expect(MAX_SPACING_FT.LIGHT.value).toBe(15);
        expect(MAX_SPACING_FT.ORDINARY_1.value).toBe(15);
        expect(MAX_SPACING_FT.ORDINARY_2.value).toBe(15);
        expect(MAX_SPACING_FT.EXTRA_1.value).toBe(12);
        expect(MAX_SPACING_FT.EXTRA_2.value).toBe(12);
        expect(MIN_WALL_CLEARANCE_FT.value).toBeCloseTo(0.3333, 6);
    });
});

describe('checkWallClearance', () => {
    it('flags a head 0.2 ft from a wall as too-close (limit 0.3333)', () => {
        const issues = checkWallClearance(
            [{ id: 'h1', x: 0.2, z: 10 }], WALL_X0, 'LIGHT'
        );
        expect(issues.length).toBe(1);
        expect(issues[0].headId).toBe('h1');
        expect(issues[0].kind).toBe('too-close-to-wall');
        expect(issues[0].distanceFt).toBeCloseTo(0.2, 6);
        expect(issues[0].limitFt).toBeCloseTo(0.3333, 6);
        expect(issues[0].citation.endsWith('Verify adopted edition.')).toBe(true);
    });

    it('flags a head 9 ft from the nearest wall as too-far in LIGHT (limit 7.5)', () => {
        const issues = checkWallClearance(
            [{ id: 'h1', x: 9, z: 10 }], WALL_X0, 'LIGHT'
        );
        expect(issues.length).toBe(1);
        expect(issues[0].kind).toBe('too-far-from-wall');
        expect(issues[0].distanceFt).toBeCloseTo(9, 6);
        expect(issues[0].limitFt).toBeCloseTo(7.5, 6);
        expect(issues[0].citation.endsWith('Verify adopted edition.')).toBe(true);
    });

    it('produces no issue for a compliant head (5 ft from wall)', () => {
        const issues = checkWallClearance(
            [{ id: 'h1', x: 5, z: 10 }], WALL_X0, 'LIGHT'
        );
        expect(issues).toEqual([]);
    });

    it('produces no issues when there are no walls (honest skip)', () => {
        const issues = checkWallClearance(
            [{ id: 'h1', x: 0.1, z: 10 }, { id: 'h2', x: 99, z: 10 }], [], 'LIGHT'
        );
        expect(issues).toEqual([]);
    });

    it('uses the hazard spacing for the too-far limit (EXTRA_1 -> 6)', () => {
        const issues = checkWallClearance(
            [{ id: 'h1', x: 7, z: 10 }], WALL_X0, 'EXTRA_1'
        );
        expect(issues.length).toBe(1);
        expect(issues[0].kind).toBe('too-far-from-wall');
        expect(issues[0].limitFt).toBeCloseTo(6, 6);
    });

    it('sorts issues by headId', () => {
        const issues = checkWallClearance(
            [
                { id: 'b', x: 9, z: 5 },
                { id: 'a', x: 0.1, z: 5 },
                { id: 'c', x: 10, z: 5 }
            ],
            WALL_X0,
            'LIGHT'
        );
        expect(issues.map(i => i.headId)).toEqual(['a', 'b', 'c']);
    });
});

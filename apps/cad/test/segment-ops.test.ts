// C1/C2/C3 Break / Divide / Reverse — pure segment ops over a network slice.

import { describe, expect, it } from 'vitest';
import {
  breakSegment,
  divideSegment,
  reverseSegment,
  type NetworkSlice,
} from '../src/lib/segment-ops';

/** A 30 ft straight run from (0,10,0) to (30,10,0). */
function net(): NetworkSlice {
  return {
    nodes: [
      { id: 'a', type: 'HEAD', pos: { x: 0, y: 10, z: 0 } },
      { id: 'b', type: 'HEAD', pos: { x: 30, y: 10, z: 0 } },
    ],
    segments: [
      { id: 's1', from: 'a', to: 'b', diameterIn: 2, lengthFt: 30, role: 'BRANCH', material: 'STEEL_SCH40' },
    ],
  };
}

describe('breakSegment (C1)', () => {
  it('splits at t=0.25: node at 25% position, lengths 25/75 of original', () => {
    const out = breakSegment(net(), 's1', 0.25, 'mid', 'p1', 'p2');
    const mid = out.nodes.find((n) => n.id === 'mid')!;
    expect(mid.type).toBe('FITTING');
    expect(mid.pos).toEqual({ x: 7.5, y: 10, z: 0 });
    const p1 = out.segments.find((s) => s.id === 'p1')!;
    const p2 = out.segments.find((s) => s.id === 'p2')!;
    expect(p1.lengthFt).toBeCloseTo(7.5, 10);
    expect(p2.lengthFt).toBeCloseTo(22.5, 10);
    expect(p1.from).toBe('a');
    expect(p1.to).toBe('mid');
    expect(p2.from).toBe('mid');
    expect(p2.to).toBe('b');
    // diameter/role/material preserved on both halves
    for (const s of [p1, p2]) {
      expect(s.diameterIn).toBe(2);
      expect(s.role).toBe('BRANCH');
      expect(s.material).toBe('STEEL_SCH40');
    }
    expect(out.segments.find((s) => s.id === 's1')).toBeUndefined();
  });

  it('is pure: the input network is unchanged', () => {
    const input = net();
    const snapshot = structuredClone(input);
    breakSegment(input, 's1', 0.5, 'mid', 'p1', 'p2');
    expect(input).toEqual(snapshot);
  });

  it('throws on t outside (0,1), missing ids, and id collisions', () => {
    expect(() => breakSegment(net(), 's1', 0, 'mid', 'p1', 'p2')).toThrow();
    expect(() => breakSegment(net(), 's1', 1, 'mid', 'p1', 'p2')).toThrow();
    expect(() => breakSegment(net(), 'nope', 0.5, 'mid', 'p1', 'p2')).toThrow();
    expect(() => breakSegment(net(), 's1', 0.5, 'a', 'p1', 'p2')).toThrow(); // node id exists
    expect(() => breakSegment(net(), 's1', 0.5, 'mid', 'p1', 'p1')).toThrow(); // dup seg ids
  });
});

describe('divideSegment (C2)', () => {
  it('divides 30 ft into 3 equal 10 ft parts with a connected chain', () => {
    const out = divideSegment(net(), 's1', 3, 'd');
    const segs = out.segments.filter((s) => s.id.startsWith('d_s'));
    expect(segs).toHaveLength(3);
    for (const s of segs) expect(s.lengthFt).toBeCloseTo(10, 10);
    const newNodes = out.nodes.filter((n) => n.id.startsWith('d_n'));
    expect(newNodes).toHaveLength(2);
    expect(newNodes[0].pos.x).toBeCloseTo(10, 10);
    expect(newNodes[1].pos.x).toBeCloseTo(20, 10);
    // Connectivity: a -> d_n1 -> d_n2 -> b through d_s1..d_s3.
    expect(segs[0].from).toBe('a');
    expect(segs[0].to).toBe('d_n1');
    expect(segs[1].from).toBe('d_n1');
    expect(segs[1].to).toBe('d_n2');
    expect(segs[2].from).toBe('d_n2');
    expect(segs[2].to).toBe('b');
    // Lengths sum to the original.
    expect(segs.reduce((sum, s) => sum + s.lengthFt, 0)).toBeCloseTo(30, 10);
  });

  it('is pure and throws on bad part counts / missing segment', () => {
    const input = net();
    const snapshot = structuredClone(input);
    divideSegment(input, 's1', 4, 'q');
    expect(input).toEqual(snapshot);
    expect(() => divideSegment(net(), 's1', 1, 'q')).toThrow();
    expect(() => divideSegment(net(), 's1', 51, 'q')).toThrow();
    expect(() => divideSegment(net(), 's1', 2.5, 'q')).toThrow();
    expect(() => divideSegment(net(), 'nope', 3, 'q')).toThrow();
  });
});

describe('reverseSegment (C3)', () => {
  it('swaps endpoints; double-reverse restores; pure', () => {
    const input = net();
    const snapshot = structuredClone(input);
    const once = reverseSegment(input, 's1');
    expect(once.segments[0].from).toBe('b');
    expect(once.segments[0].to).toBe('a');
    const twice = reverseSegment(once, 's1');
    expect(twice.segments[0].from).toBe('a');
    expect(twice.segments[0].to).toBe('b');
    expect(input).toEqual(snapshot);
  });

  it('throws on a missing segment id', () => {
    expect(() => reverseSegment(net(), 'nope')).toThrow();
  });
});

// C22 Tag Leaks — open pipe ends + dangling references, sorted, pure.

import { describe, expect, it } from 'vitest';
import { findLeaks } from '../src/lib/leak-check';

const N = (id: string, type: string) => ({ id, type });
const S = (id: string, from: string, to: string) => ({ id, from, to });

describe('findLeaks — clean networks', () => {
  it('linear HEAD-FITTING-FITTING-SOURCE run is clean', () => {
    const r = findLeaks({
      nodes: [N('h', 'HEAD'), N('f1', 'FITTING'), N('f2', 'FITTING'), N('src', 'SOURCE')],
      segments: [S('s1', 'h', 'f1'), S('s2', 'f1', 'f2'), S('s3', 'f2', 'src')],
    });
    expect(r.clean).toBe(true);
    expect(r.leaks).toEqual([]);
    expect(r.checkedNodes).toBe(4);
    expect(r.checkedSegments).toBe(3);
  });

  it('HEAD/SOURCE/VALVE at degree 1 are never leaks', () => {
    const r = findLeaks({
      nodes: [N('h', 'HEAD'), N('v', 'VALVE'), N('t', 'TEE'), N('src', 'SOURCE')],
      segments: [S('s1', 'h', 't'), S('s2', 't', 'v'), S('s3', 't', 'src')],
    });
    expect(r.clean).toBe(true);
  });
});

describe('findLeaks — open ends', () => {
  it('chopping the last segment leaves a degree-1 FITTING open-end leak', () => {
    const r = findLeaks({
      nodes: [N('h', 'HEAD'), N('f1', 'FITTING'), N('f2', 'FITTING'), N('src', 'SOURCE')],
      segments: [S('s1', 'h', 'f1'), S('s2', 'f1', 'f2')], // s3 chopped
    });
    expect(r.clean).toBe(false);
    expect(r.leaks).toEqual([{ nodeId: 'f2', reason: 'open-end', segmentIds: ['s2'] }]);
  });

  it('an isolated degree-0 fitting is NOT a leak (unpiped, not open)', () => {
    const r = findLeaks({
      nodes: [N('h', 'HEAD'), N('iso', 'FITTING'), N('src', 'SOURCE')],
      segments: [S('s1', 'h', 'src')],
    });
    expect(r.clean).toBe(true);
  });
});

describe('findLeaks — dangling references', () => {
  it('a segment pointing at a nonexistent id reports the MISSING id + segment', () => {
    const r = findLeaks({
      nodes: [N('h', 'HEAD'), N('src', 'SOURCE')],
      segments: [S('s1', 'h', 'ghost'), S('s2', 'h', 'src')],
    });
    expect(r.clean).toBe(false);
    expect(r.leaks).toEqual([
      { nodeId: 'ghost', reason: 'dangling-reference', segmentIds: ['s1'] },
    ]);
  });
});

describe('findLeaks — determinism and purity', () => {
  it('leaks are sorted by nodeId regardless of input order', () => {
    const r = findLeaks({
      nodes: [N('zz', 'FITTING'), N('aa', 'FITTING'), N('mid', 'TEE'), N('src', 'SOURCE')],
      segments: [S('s1', 'zz', 'mid'), S('s2', 'aa', 'mid'), S('s3', 'mid', 'src')],
    });
    expect(r.leaks.map((l) => l.nodeId)).toEqual(['aa', 'zz']);
  });

  it('does not mutate its input', () => {
    const input = {
      nodes: [N('h', 'HEAD'), N('f', 'FITTING')],
      segments: [S('s1', 'h', 'f')],
    };
    const snapshot = structuredClone(input);
    findLeaks(input);
    expect(input).toEqual(snapshot);
  });

  it('a self-loop counts degree 2 (not an open end)', () => {
    const r = findLeaks({
      nodes: [N('f', 'FITTING')],
      segments: [S('s1', 'f', 'f')],
    });
    expect(r.clean).toBe(true);
  });
});

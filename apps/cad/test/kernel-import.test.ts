// W2E kernel-import — circles+lines on the HALOFIRE layers -> network slice.

import { describe, expect, it } from 'vitest';
import {
  buildKernelNetwork,
  KERNEL_HEAD_LAYER,
  KERNEL_PIPE_LAYER,
  SNAP_TOLERANCE_FT,
  type KernelCircle,
  type KernelLine,
} from '../src/lib/kernel-import';

const H = (cx: number, cy: number, layer = KERNEL_HEAD_LAYER): KernelCircle => ({ cx, cy, layer });
const L = (x1: number, y1: number, x2: number, y2: number, layer = KERNEL_PIPE_LAYER): KernelLine =>
  ({ x1, y1, x2, y2, layer });

describe('buildKernelNetwork — heads and snapping', () => {
  it('a line ending within tolerance of a head snaps to it (no duplicate junction)', () => {
    const net = buildKernelNetwork(
      [H(10, 10)],
      [L(0, 10, 10 + SNAP_TOLERANCE_FT / 2, 10)],
      { ftPerUnit: 1 },
    );
    expect(net.headCount).toBe(1);
    expect(net.segments).toHaveLength(1);
    const seg = net.segments[0];
    expect([seg.from, seg.to]).toContain('head_1');
    // Only ONE junction (the free end) was created.
    expect(net.junctionCount).toBe(1);
  });

  it('maps plan (x, y) -> pos {x, y: zFt, z: planY} ("y is up")', () => {
    const net = buildKernelNetwork([H(3, 4)], [], { ftPerUnit: 1, zFt: 12 });
    expect(net.nodes[0].pos).toEqual({ x: 3, y: 12, z: 4 });
  });

  it('scales by ftPerUnit: a 40-unit line at 0.25 ft/unit is 10 ft', () => {
    const net = buildKernelNetwork([], [L(0, 0, 40, 0)], { ftPerUnit: 0.25 });
    expect(net.segments[0].lengthFt).toBeCloseTo(10, 6);
  });
});

describe('buildKernelNetwork — junction typing by degree', () => {
  it('a 3-way meeting point becomes a TEE; line ends become ELBOWs', () => {
    // Three lines meeting at (10,10).
    const net = buildKernelNetwork(
      [],
      [L(0, 10, 10, 10), L(10, 0, 10, 10), L(10, 10, 20, 10)],
      { ftPerUnit: 1 },
    );
    const byPos = (x: number, z: number) =>
      net.nodes.find((n) => Math.abs(n.pos.x - x) < 1e-9 && Math.abs(n.pos.z - z) < 1e-9)!;
    expect(byPos(10, 10).type).toBe('TEE');
    expect(byPos(0, 10).type).toBe('ELBOW');
    expect(byPos(20, 10).type).toBe('ELBOW');
  });
});

describe('buildKernelNetwork — filtering, dropping, determinism, errors', () => {
  it('ignores entities on other layers', () => {
    const net = buildKernelNetwork(
      [H(0, 0, 'NOTES'), H(1, 1)],
      [L(0, 0, 5, 0, 'TITLEBLOCK'), L(0, 0, 5, 5)],
      { ftPerUnit: 1 },
    );
    expect(net.headCount).toBe(1);
    expect(net.segments).toHaveLength(1);
  });

  it('drops zero/near-zero-length lines and counts them', () => {
    const net = buildKernelNetwork([], [L(5, 5, 5, 5), L(0, 0, 9, 0)], { ftPerUnit: 1 });
    expect(net.droppedZeroLength).toBe(1);
    expect(net.segments).toHaveLength(1);
  });

  it('honors custom layer names', () => {
    const net = buildKernelNetwork(
      [H(0, 0, 'MY_HEADS')],
      [L(0, 0, 5, 0, 'MY_PIPES')],
      { ftPerUnit: 1, headLayer: 'MY_HEADS', pipeLayer: 'MY_PIPES' },
    );
    expect(net.headCount).toBe(1);
    expect(net.segments).toHaveLength(1);
  });

  it('is deterministic (same input -> deep-equal output) and pure', () => {
    const circles = [H(1, 1), H(8, 1)];
    const lines = [L(1, 1, 8, 1)];
    const snapC = structuredClone(circles);
    const snapL = structuredClone(lines);
    const a = buildKernelNetwork(circles, lines, { ftPerUnit: 1 });
    const b = buildKernelNetwork(circles, lines, { ftPerUnit: 1 });
    expect(a).toEqual(b);
    expect(circles).toEqual(snapC);
    expect(lines).toEqual(snapL);
  });

  it('throws on ftPerUnit <= 0 or non-finite', () => {
    expect(() => buildKernelNetwork([], [], { ftPerUnit: 0 })).toThrow();
    expect(() => buildKernelNetwork([], [], { ftPerUnit: Number.NaN })).toThrow();
  });
});

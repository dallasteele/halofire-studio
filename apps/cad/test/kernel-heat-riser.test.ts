import { inferKernelTopology } from '../src/lib/kernel-heat-riser';

/**
 * A small tree with a single non-head node (the root) and two segments.
 */
const smallTreeNodes = [
  { id: 'root', type: 'NON_HEAD', pos: { x: 0, y: 0 } },
  { id: 'leaf1', type: 'HEAD', pos: { x: 1, y: 0 } },
  { id: 'leaf2', type: 'HEAD', pos: { x: 2, y: 0 } }
];

const smallTreeSegments = [
  { id: 's1', from: 'root', to: 'leaf1', diameterIn: 1, lengthFt: 1 },
  { id: 's2', from: 'root', to: 'leaf2', diameterIn: 1, lengthFt: 1 }
];

/**
 * An all-HEAD input (no non-head nodes).
 */
const allHeadNodes = [
  { id: 'head1', type: 'HEAD', pos: { x: 0, y: 0 } },
  { id: 'head2', type: 'HEAD', pos: { x: 1, y: 0 } }
];

const allHeadSegments = [
  { id: 's1', from: 'head1', to: 'head2', diameterIn: 1, lengthFt: 1 }
];

describe('inferKernelTopology', () => {
  it('returns non-null with fraction 1 for a small tree', () => {
    const result = inferKernelTopology(smallTreeNodes, smallTreeSegments);
    expect(result).not.toBeNull();
    expect(result?.fraction).toBeCloseTo(1);
  });

  it('returns null for an all-HEAD input', () => {
    const result = inferKernelTopology(allHeadNodes, allHeadSegments);
    expect(result).toBeNull();
  });
});
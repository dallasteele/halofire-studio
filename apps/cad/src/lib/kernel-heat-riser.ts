import { inferRiser, orientFlow, solvableFraction } from './riser-inference';

export interface KernelTopology {
  riserId: string;
  oriented: Map<string, { from: string; to: string }>
  fraction: number;
}

/**
 * Infers the kernel topology from the given nodes and segments.
 * Returns null if no valid riser can be inferred (e.g., no non-head nodes).
 */
export function inferKernelTopology(nodes: any[], segments: any[]): KernelTopology | null {
  try {
    const candidate = inferRiser(nodes, segments);
    const oriented = orientFlow(nodes, segments, candidate.nodeId);
    const fraction = solvableFraction(segments, oriented);
    return {
      riserId: candidate.nodeId,
      oriented,
      fraction
    };
  } catch (e) {
    return null;
  }
}
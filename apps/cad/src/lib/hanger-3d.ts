import { hangersForSegment } from './hanger-spacing';
import { HangerPoint } from './hanger-spacing';

/**
 * Compute hanger positions for a single pipe segment, returning the 3D positions.
 * Uses the hangersForSegment function from hanger-spacing.ts with the given segment and endpoints.
 * 
 * @param seg - The pipe segment with diameter and length
 * @param a - Start point of the segment (x, y, z)
 * @param b - End point of the segment (x, y, z)
 * @returns Array of hanger positions with segmentId, t, x, y, z
 */
export function computeHangerPositions(
  seg: { id: string; diameterIn: number; lengthFt: number },
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number }
): HangerPoint[] {
  return hangersForSegment(seg, a, b);
}

/**
 * Compute the number of hangers for a single pipe segment.
 * 
 * @param seg - The pipe segment with diameter and length
 * @param a - Start point of the segment (x, y, z)
 * @param b - End point of the segment (x, y, z)
 * @returns The number of hangers placed on the segment
 */
export function countHangers(
  seg: { id: string; diameterIn: number; lengthFt: number },
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number }
): number {
  return computeHangerPositions(seg, a, b).length;
}

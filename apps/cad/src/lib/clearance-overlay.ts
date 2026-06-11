/**
 * Head-clearance issue overlay (W10C).
 *
 * Pure mapping from the head-clearance design-aid check to plan-canvas
 * markers. All geometry math stays here; PlanCanvas only draws the result.
 */
import { checkWallClearance, type HazardClass } from './head-clearance';
import type { Building, SprinklerNetwork } from './model';

export interface ClearanceMarker {
  headId: string;
  /** Plan coordinates (feet). */
  x: number;
  y: number;
  kind: 'too-close-to-wall' | 'too-far-from-wall';
  message: string;
}

/**
 * Runs the cited wall-clearance check over every head and maps each issue to
 * its head's plan position with a short human message carrying the citation
 * hedge. Empty walls yield no markers (honest skip — nothing to measure).
 */
export function issueMarkers(
  building: Building,
  network: SprinklerNetwork,
  hazard: HazardClass,
): ClearanceMarker[] {
  const wallSegments = building.walls.map((w) => ({
    x1: w.start.x,
    z1: w.start.y,
    x2: w.end.x,
    z2: w.end.y,
  }));
  const heads = network.nodes
    .filter((n) => n.type === 'HEAD')
    .map((n) => ({ id: n.id, x: n.pos.x, z: n.pos.z }));

  const byId = new Map(heads.map((h) => [h.id, h]));
  return checkWallClearance(heads, wallSegments, hazard).map((issue) => {
    const head = byId.get(issue.headId) as { id: string; x: number; z: number };
    const rel = issue.kind === 'too-close-to-wall' ? 'closer than' : 'farther than';
    return {
      headId: issue.headId,
      x: head.x,
      y: head.z,
      kind: issue.kind,
      message:
        `${issue.distanceFt.toFixed(2)} ft from nearest wall — ${rel} ` +
        `${issue.limitFt.toFixed(2)} ft limit. ${issue.citation}`,
    };
  });
}

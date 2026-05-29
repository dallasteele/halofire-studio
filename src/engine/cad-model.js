/**
 * HaloFire 3D-correct CAD model builder (internal alpha, best-effort).
 *
 * Turns a floor plan + sprinkler layout into a real 3D piping network with
 * correct elevations and NFPA-13 schedule pipe sizing, expressed as a backend-
 * neutral solid list. The SAME model drives three targets:
 *   - DXF export (AutoCAD-openable)            -> src/engine/dxf-export.js
 *   - OpenClaw generate_3d_model / Blender     -> src/cad/openclaw-cad.js
 *   - the in-browser Three.js viewer
 *
 * Why this exists: a flat grid of head dots is NOT a 3D model. A real wet-pipe
 * system is riser -> cross-main -> branch lines -> drops -> pendent heads, each
 * pipe a sized cylinder at a real elevation. That topology is what makes the
 * model "3D correct" and is the foundation for CAD parity. It still does NOT
 * perform hydraulic calculations or claim AutoSprink/AutoCAD parity; those
 * gates stay fail-closed.
 *
 * Coordinates: feet. X/Y are plan; Z is elevation (0 = floor).
 */

import { layoutRoom } from './sprinkler-layout.js';

// NFPA 13 schedule pipe sizing — max sprinklers served by a steel pipe size.
// Public code values. Returned diameter is the smallest size that covers count.
const SCHEDULE = {
  light: [
    [1, 1.0], [2, 1.0], [3, 1.25], [5, 1.5], [10, 2.0], [30, 2.5], [60, 3.0],
    [100, 3.5], [160, 4.0], [275, 5.0], [Infinity, 6.0],
  ],
  ordinary: [
    [1, 1.0], [2, 1.0], [3, 1.25], [5, 1.5], [10, 2.0], [20, 2.5], [40, 3.0],
    [65, 3.5], [100, 4.0], [160, 5.0], [275, 6.0], [Infinity, 8.0],
  ],
  extra: [
    [1, 1.0], [2, 1.0], [3, 1.25], [5, 1.5], [10, 2.0], [20, 2.5], [40, 3.0],
    [65, 3.5], [100, 4.0], [160, 5.0], [275, 6.0], [Infinity, 8.0],
  ],
};

/** Smallest schedule pipe (inches) that serves `count` sprinklers for a hazard. */
export function sizePipe(count, hazard = 'ordinary') {
  const table = SCHEDULE[hazard] || SCHEDULE.ordinary;
  for (const [maxHeads, dia] of table) if (count <= maxHeads) return dia;
  return table[table.length - 1][1];
}

const DEFAULT_CEILING_FT = 14;
const WALL_THICKNESS_FT = 0.5;
const SLAB_THICKNESS_FT = 0.5;

/**
 * Build the 3D-correct CAD model for one room.
 * @returns {{solids:Array, network:object, sizing:object}}
 */
export function buildRoomCad(room, layoutArg) {
  const layout = layoutArg || layoutRoom(room);
  const hazard = layout.rule.key;
  const ceiling = room.ceilingHeightFt || DEFAULT_CEILING_FT;
  const bbox = layout.bbox;

  // Elevations (ft): main highest, branches below, pendent heads lowest.
  const mainZ = round(ceiling - 0.75);
  const branchZ = round(ceiling - 1.0);
  const headZ = round(ceiling - 1.5);

  const solids = [];

  // Building shell: floor slab, roof slab, perimeter walls (one box per edge).
  solids.push({ kind: 'slab', name: `${room.name}/floor`, layer: 'FLOOR', polygon: room.polygon, z: 0, thickness: SLAB_THICKNESS_FT });
  solids.push({ kind: 'slab', name: `${room.name}/roof`, layer: 'ROOF', polygon: room.polygon, z: ceiling, thickness: SLAB_THICKNESS_FT });
  const poly = room.polygon;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    solids.push({
      kind: 'wall', name: `${room.name}/wall${i}`, layer: 'WALLS',
      a: [round(a[0]), round(a[1])], b: [round(b[0]), round(b[1])],
      center: [round((a[0] + b[0]) / 2), round((a[1] + b[1]) / 2)],
      lengthFt: round(len), heightFt: ceiling, thicknessFt: WALL_THICKNESS_FT,
      rotationY: round(-Math.atan2(b[1] - a[1], b[0] - a[0])),
    });
  }

  // Group heads into branch lines by grid row (ordered by column).
  const rows = new Map();
  for (const h of layout.heads) {
    if (!rows.has(h.row)) rows.set(h.row, []);
    rows.get(h.row).push(h);
  }
  const rowKeys = [...rows.keys()].sort((p, q) => p - q);

  // Cross-main runs along Y at the minimum-X side, feeding each branch line.
  const mainX = round(bbox.minX + layout.spacingX / 2 - layout.spacingX / 2); // = bbox.minX
  const branchLines = [];
  let totalHeads = 0;

  for (const rk of rowKeys) {
    const heads = rows.get(rk).sort((p, q) => p.x - q.x);
    totalHeads += heads.length;
    const y = heads[0].y;
    const startX = mainX; // tie into the cross-main
    const endX = round(heads[heads.length - 1].x);
    const dia = sizePipe(heads.length, hazard);
    branchLines.push({ row: rk, y, startX, endX, headCount: heads.length, diameterIn: dia, heads });

    // Branch-line pipe (horizontal, along X at branchZ).
    solids.push({ kind: 'pipe', name: `branch-${rk}`, layer: 'BRANCH', role: 'branch',
      from: [startX, y, branchZ], to: [endX, y, branchZ], diameterIn: dia });

    // Drops: vertical pipe from branch down to each pendent head deflector.
    for (const h of heads) {
      solids.push({ kind: 'pipe', name: `drop-${rk}-${h.col}`, layer: 'DROPS', role: 'drop',
        from: [round(h.x), y, branchZ], to: [round(h.x), y, headZ], diameterIn: 1.0 });
      solids.push({ kind: 'head', name: `head-${rk}-${h.col}`, layer: 'HEADS',
        position: [round(h.x), y, headZ], orientation: 'pendent' });
    }
  }

  // Cross-main (vertical-in-plan, along Y) connecting all branch starts, sized
  // for the full downstream head count.
  const mainDia = sizePipe(totalHeads, hazard);
  if (branchLines.length) {
    const ys = branchLines.map((b) => b.y);
    const y0 = round(Math.min(...ys));
    const y1 = round(Math.max(...ys));
    solids.push({ kind: 'pipe', name: 'cross-main', layer: 'MAIN', role: 'main',
      from: [mainX, y0, mainZ], to: [mainX, y1, mainZ], diameterIn: mainDia });
    // Risers from main elevation down to branch elevation at each branch tie-in.
    for (const b of branchLines) {
      solids.push({ kind: 'pipe', name: `riser-tie-${b.row}`, layer: 'MAIN', role: 'main-tie',
        from: [mainX, b.y, mainZ], to: [mainX, b.y, branchZ], diameterIn: mainDia });
    }
    // System riser: floor up to the cross-main at y0.
    solids.push({ kind: 'pipe', name: 'system-riser', layer: 'RISER', role: 'riser',
      from: [mainX, y0, 0], to: [mainX, y0, mainZ], diameterIn: mainDia });
  }

  return {
    solids,
    network: { branchLines, mainX, mainZ, branchZ, headZ, ceiling, totalHeads },
    sizing: { hazard, mainDiameterIn: mainDia, branchDiameters: branchLines.map((b) => b.diameterIn) },
  };
}

/**
 * Build the CAD model for a whole floor plan (multiple rooms).
 * @returns {{name:string, units:string, rooms:Array, solids:Array, counts:object, disclaimer:string}}
 */
export function buildCadModel(floorPlan) {
  if (!floorPlan || !Array.isArray(floorPlan.rooms) || floorPlan.rooms.length === 0) {
    throw new Error('floorPlan.rooms must be a non-empty array');
  }
  const rooms = floorPlan.rooms.map((room) => {
    const cad = buildRoomCad(room);
    return { name: room.name, ...cad };
  });
  const solids = rooms.flatMap((r) => r.solids);
  const counts = {
    heads: solids.filter((s) => s.kind === 'head').length,
    pipes: solids.filter((s) => s.kind === 'pipe').length,
    walls: solids.filter((s) => s.kind === 'wall').length,
    branchLines: rooms.reduce((n, r) => n + r.network.branchLines.length, 0),
  };
  return {
    name: floorPlan.name,
    units: floorPlan.units || 'ft',
    rooms,
    solids,
    counts,
    generatedBy: 'halofire-cad-model',
    disclaimer: 'best-effort internal alpha 3D model — NFPA-13 schedule pipe sizing, '
      + 'NOT hydraulically calculated, NOT AHJ/PE-reviewed, NOT AutoSprink/AutoCAD parity.',
  };
}

function round(n) {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}

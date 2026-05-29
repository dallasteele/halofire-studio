/**
 * HaloFire 3D geometry builder (internal alpha, best-effort).
 *
 * Converts a floor plan + generated sprinkler bid into a neutral 3D scene
 * description that a Three.js front-end can render directly. Plan coordinates
 * are in feet on the X/Z ground plane; ceiling height maps to +Y (Three.js is
 * Y-up). Deterministic: identical input -> identical scene.
 *
 * This is a best-effort visualization of a best-effort layout. It is NOT a
 * fabrication model and does not clear any claim gate.
 */

const DEFAULT_CEILING_FT = 14;
const DEFAULT_WALL_THICKNESS_FT = 0.5;

/**
 * @param {object} floorPlan  { name, rooms:[{name, polygon:[[x,y]...], ceilingHeightFt?}] }
 * @param {object} [bid]      output of generateSprinklerBid (for heads + pipes)
 * @returns {{units:string, walls:Array, floors:Array, heads:Array, pipes:Array, bounds:object}}
 */
export function buildScene(floorPlan, bid = null) {
  if (!floorPlan || !Array.isArray(floorPlan.rooms) || floorPlan.rooms.length === 0) {
    throw new Error('floorPlan.rooms must be a non-empty array');
  }

  const walls = [];
  const floors = [];
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;

  floorPlan.rooms.forEach((room, roomIndex) => {
    const ceiling = room.ceilingHeightFt || DEFAULT_CEILING_FT;
    const poly = room.polygon;
    floors.push({
      room: room.name,
      vertices: poly.map(([x, y]) => [x, 0, y]),
    });
    for (let i = 0; i < poly.length; i += 1) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      const dx = x2 - x1;
      const dy = y2 - y1;
      const length = Math.hypot(dx, dy);
      const angleRad = Math.atan2(dy, dx);
      walls.push({
        room: room.name,
        wallIndex: i,
        center: [round((x1 + x2) / 2), round(ceiling / 2), round((y1 + y2) / 2)],
        lengthFt: round(length),
        heightFt: ceiling,
        thicknessFt: DEFAULT_WALL_THICKNESS_FT,
        rotationY: round(-angleRad), // rotate box (long axis X) onto the wall direction
      });
      minX = Math.min(minX, x1, x2);
      maxX = Math.max(maxX, x1, x2);
      minZ = Math.min(minZ, y1, y2);
      maxZ = Math.max(maxZ, y1, y2);
    }
    void roomIndex;
  });

  const heads = [];
  const pipes = [];
  if (bid && Array.isArray(bid.rooms)) {
    for (const room of bid.rooms) {
      const ceiling = roomCeiling(floorPlan, room.name);
      for (const head of room.layout.heads) {
        heads.push({ room: room.name, position: [head.x, round(ceiling - 0.5), head.y] });
      }
      // Branch lines run along X just below the ceiling.
      for (const branch of room.piping.branchLines) {
        pipes.push({
          room: room.name,
          type: 'branch',
          from: [branch.startX, round(ceiling - 0.75), branch.y],
          to: [branch.endX, round(ceiling - 0.75), branch.y],
        });
      }
    }
  }

  return {
    units: floorPlan.units || 'ft',
    name: floorPlan.name,
    walls,
    floors,
    heads,
    pipes,
    bounds: {
      minX: finiteOr(minX, 0),
      maxX: finiteOr(maxX, 0),
      minZ: finiteOr(minZ, 0),
      maxZ: finiteOr(maxZ, 0),
    },
    disclaimer: 'best-effort internal alpha visualization — not a fabrication model',
  };
}

function roomCeiling(floorPlan, roomName) {
  const room = floorPlan.rooms.find((r) => r.name === roomName);
  return (room && room.ceilingHeightFt) || DEFAULT_CEILING_FT;
}

function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function round(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

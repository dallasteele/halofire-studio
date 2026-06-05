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
import { layoutBuilding } from './system-layout.js';
import { getComponent } from '../components/registry.js';

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

    // Discrete component placement markers, derived from the riser/cross-main
    // network coords above (never fabricated). Fail-closed: skip unknown keys.
    pushComponentMarkers(solids, '', mainX, y0, mainZ, branchZ, mainDia, branchLines);
  }

  return {
    solids,
    network: { branchLines, mainX, mainZ, branchZ, headZ, ceiling, totalHeads },
    sizing: { hazard, mainDiameterIn: mainDia, branchDiameters: branchLines.map((b) => b.diameterIn) },
  };
}

/** Tally the standard solid counts for a list of solids + per-floor/room CAD results. */
function tallyCounts(solids, roomResults) {
  return {
    heads: solids.filter((s) => s.kind === 'head').length,
    pipes: solids.filter((s) => s.kind === 'pipe').length,
    walls: solids.filter((s) => s.kind === 'wall').length,
    components: solids.filter((s) => s.kind === 'component').length,
    branchLines: roomResults.reduce((n, r) => n + r.network.branchLines.length, 0),
  };
}

/**
 * Offset a single solid's elevation (Z) fields by `dz` feet so a floor's whole
 * network stacks above the floors below it. Pure: returns a new solid, never
 * mutates the input. Plan (X/Y) coordinates are untouched.
 */
function offsetSolidZ(solid, dz) {
  if (!dz) return solid;
  const s = { ...solid };
  switch (s.kind) {
    case 'slab':
      s.z = round(s.z + dz);
      break;
    case 'wall':
      // Walls are extruded from baseZ up by heightFt; record the base elevation
      // so the floor sits on the slab below it (DXF/3D honor baseZ, default 0).
      s.baseZ = round((s.baseZ || 0) + dz);
      break;
    case 'column':
      // Columns extrude from baseZ up by heightFt like walls.
      s.baseZ = round((s.baseZ || 0) + dz);
      break;
    case 'pipe':
      s.from = [s.from[0], s.from[1], round(s.from[2] + dz)];
      s.to = [s.to[0], s.to[1], round(s.to[2] + dz)];
      break;
    case 'head':
      s.position = [s.position[0], s.position[1], round(s.position[2] + dz)];
      break;
    case 'component':
      s.position = [s.position[0], s.position[1], round(s.position[2] + dz)];
      break;
    default:
      break;
  }
  return s;
}

/** Lift a per-floor CAD result (room solids + network elevations) by `dz` feet. */
function offsetRoomCadZ(cad, dz) {
  if (!dz) return cad;
  return {
    ...cad,
    solids: cad.solids.map((s) => offsetSolidZ(s, dz)),
    network: {
      ...cad.network,
      mainZ: round(cad.network.mainZ + dz),
      branchZ: round(cad.network.branchZ + dz),
      headZ: round(cad.network.headZ + dz),
      baseElevationFt: dz,
    },
  };
}

/**
 * Build the CAD model for one floor (a list of rooms at a common base elevation).
 * Each floor keeps its own independent riser -> cross-main -> branch -> drop ->
 * head network and NFPA pipe sizing; its solids are offset in Z by baseElevationFt
 * so floors stack vertically.
 */
function buildFloorCad(floor, baseElevationFt) {
  if (!floor || !Array.isArray(floor.rooms) || floor.rooms.length === 0) {
    throw new Error('floor.rooms must be a non-empty array');
  }
  const rooms = floor.rooms.map((room) => {
    // A floor-level ceilingHeightFt is the default; per-room overrides win.
    const merged = (floor.ceilingHeightFt && !room.ceilingHeightFt)
      ? { ...room, ceilingHeightFt: floor.ceilingHeightFt }
      : room;
    const cad = offsetRoomCadZ(buildRoomCad(merged), baseElevationFt);
    return { name: room.name, ...cad };
  });
  const solids = rooms.flatMap((r) => r.solids);
  return {
    level: floor.level ?? null,
    baseElevationFt,
    ceilingHeightFt: floor.ceilingHeightFt ?? null,
    rooms,
    solids,
    counts: tallyCounts(solids, rooms),
  };
}

/** True iff `input` is a normalized building (stories[] each with spaces/walls). */
function isBuilding(input) {
  return !!(input && Array.isArray(input.stories) && input.stories.length > 0
    && input.stories.some((st) => st && (Array.isArray(st.spaces) || Array.isArray(st.walls))));
}

/** Wall solid in the existing wall shape, typed exterior/interior + opening metadata. */
function buildWallSolid(wall, ceiling, name) {
  const { a, b } = wall;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return {
    kind: 'wall', name,
    layer: wall.type === 'interior' ? 'WALLS-INT' : 'WALLS',
    type: wall.type === 'interior' ? 'interior' : 'exterior',
    a: [round(a[0]), round(a[1])], b: [round(b[0]), round(b[1])],
    center: [round((a[0] + b[0]) / 2), round((a[1] + b[1]) / 2)],
    lengthFt: round(len), heightFt: ceiling, thicknessFt: wall.thicknessFt ?? WALL_THICKNESS_FT,
    rotationY: round(-Math.atan2(b[1] - a[1], b[0] - a[0])),
    baseZ: 0,
    openings: (Array.isArray(wall.openings) ? wall.openings : []).map((op) => ({
      offsetFt: round(op.offsetFt ?? 0),
      widthFt: round(op.widthFt ?? 0),
      heightFt: round(op.heightFt ?? 0),
      sill: round(op.sill ?? 0),
      type: op.type === 'window' ? 'window' : 'door',
    })),
  };
}

/** Column solid: a vertical square post at (x,y), sizeFt across, full ceiling height. */
function buildColumnSolid(col, ceiling, name) {
  return {
    kind: 'column', name, layer: 'COLUMNS',
    x: round(col.x), y: round(col.y), sizeFt: round(col.sizeFt ?? 1),
    heightFt: ceiling, baseZ: 0,
  };
}

/**
 * Build the CAD model for ONE story of a normalized building: a wall solid per
 * wall segment (typed + opening metadata), a column solid per column, and the
 * per-space pipe networks + heads from the system-layout (NFPA sizing). All
 * solids are offset in Z by baseElevationFt so stories stack.
 */
function buildStoryCad(story, layoutStory) {
  const ceiling = story.ceilingHeightFt || DEFAULT_CEILING_FT;
  const baseElevationFt = story.baseElevationFt || 0;
  const localSolids = [];

  // Slab per story so stories read as distinct floors in DXF/3D.
  // (Use the union bbox of all spaces as a single floor outline.)

  // Walls: one solid per segment, typed exterior/interior, opening metadata.
  story.walls.forEach((wall, i) => {
    localSolids.push(buildWallSolid(wall, ceiling, `${story.level}/wall${i}`));
  });

  // Columns: one solid per structural column.
  story.columns.forEach((col, i) => {
    localSolids.push(buildColumnSolid(col, ceiling, `${story.level}/col${i}`));
  });

  // Pipe networks + heads, per space, from the laid-out story.
  // Elevations mirror buildRoomCad: main highest, branch below, head lowest.
  const mainZ = round(ceiling - 0.75);
  const branchZ = round(ceiling - 1.0);
  const headZ = round(ceiling - 1.5);

  for (const space of layoutStory.spaces) {
    if (!space.branchLines.length) continue;
    let totalHeads = 0;
    for (const bl of space.branchLines) {
      totalHeads += bl.headCount;
      const y = bl.y;
      const startX = round(bl.startX);
      const endX = round(bl.endX);
      localSolids.push({ kind: 'pipe', name: `${space.name}/branch-${bl.row}`, layer: 'BRANCH', role: 'branch',
        from: [startX, y, branchZ], to: [endX, y, branchZ], diameterIn: bl.diameterIn });
      for (const h of bl.heads) {
        localSolids.push({ kind: 'pipe', name: `${space.name}/drop-${bl.row}-${h.col}`, layer: 'DROPS', role: 'drop',
          from: [round(h.x), y, branchZ], to: [round(h.x), y, headZ], diameterIn: 1.0 });
        localSolids.push({ kind: 'head', name: `${space.name}/head-${bl.row}-${h.col}`, layer: 'HEADS',
          position: [round(h.x), y, headZ], orientation: 'pendent' });
      }
    }
    // Per-space cross-main + ties + riser tying the branch lines together.
    const mainDia = space.sizing.crossMainDiameterIn;
    const mainX = round(Math.min(...space.branchLines.map((b) => b.startX)));
    const ys = space.branchLines.map((b) => b.y);
    const y0 = round(Math.min(...ys));
    const y1 = round(Math.max(...ys));
    localSolids.push({ kind: 'pipe', name: `${space.name}/cross-main`, layer: 'MAIN', role: 'main',
      from: [mainX, y0, mainZ], to: [mainX, y1, mainZ], diameterIn: mainDia });
    for (const bl of space.branchLines) {
      localSolids.push({ kind: 'pipe', name: `${space.name}/riser-tie-${bl.row}`, layer: 'MAIN', role: 'main-tie',
        from: [mainX, bl.y, mainZ], to: [mainX, bl.y, branchZ], diameterIn: mainDia });
    }
    localSolids.push({ kind: 'pipe', name: `${space.name}/system-riser`, layer: 'RISER', role: 'riser',
      from: [mainX, y0, 0], to: [mainX, y0, mainZ], diameterIn: mainDia });

    // Per-space component placement markers, derived from this space's network
    // coords (never fabricated). Z-lifted below by offsetSolidZ. Fail-closed.
    pushComponentMarkers(localSolids, `${space.name}/`, mainX, y0, mainZ, branchZ, mainDia, space.branchLines);
  }

  const solids = localSolids.map((s) => offsetSolidZ(s, baseElevationFt));
  return {
    level: story.level ?? null,
    baseElevationFt,
    ceilingHeightFt: story.ceilingHeightFt ?? null,
    spaces: layoutStory.spaces.map((sp) => ({ name: sp.name, hazard: sp.hazard, headCount: sp.headCount, sizing: sp.sizing })),
    feedMain: layoutStory.feedMain,
    solids,
    counts: tallyBuildingCounts(solids),
  };
}

/** Tally building-shaped counts (spaces/walls/interiorWalls/columns/openings/heads/pipes). */
function tallyBuildingCounts(solids, spaceCount) {
  const walls = solids.filter((s) => s.kind === 'wall');
  return {
    spaces: spaceCount ?? 0,
    walls: walls.length,
    interiorWalls: walls.filter((w) => w.type === 'interior').length,
    columns: solids.filter((s) => s.kind === 'column').length,
    openings: walls.reduce((n, w) => n + (Array.isArray(w.openings) ? w.openings.length : 0), 0),
    heads: solids.filter((s) => s.kind === 'head').length,
    pipes: solids.filter((s) => s.kind === 'pipe').length,
    components: solids.filter((s) => s.kind === 'component').length,
  };
}

/**
 * Build the CAD model for a whole normalized building (see building-model.js):
 * accurate interior/exterior walls + opening metadata, structural columns, and
 * per-space pipe networks + heads from the system-layout, multi-story stacked
 * by baseElevationFt. counts include spaces/walls/interiorWalls/columns/
 * openings/heads/pipes. Geometry only — NFPA-13 schedule sizing, NOT
 * hydraulically calculated, NOT AHJ/PE/AutoSprink parity; gates stay fail-closed.
 */
function buildBuildingCad(building) {
  const layout = layoutBuilding(building);
  const layoutByLevel = new Map(layout.stories.map((st) => [st.level, st]));

  const stories = building.stories.map((story) => buildStoryCad(story, layoutByLevel.get(story.level)));
  const solids = stories.flatMap((st) => st.solids);
  const spaceCount = building.stories.reduce((n, st) => n + (Array.isArray(st.spaces) ? st.spaces.length : 0), 0);

  return {
    name: building.name,
    units: building.units || 'ft',
    generatedBy: 'halofire-cad-model',
    stories,
    solids,
    counts: tallyBuildingCounts(solids, spaceCount),
    coverageOk: layout.coverageOk,
    disclaimer: 'best-effort internal alpha 3D building model — interior/exterior walls with '
      + 'opening metadata, columns, per-space NFPA-13 schedule pipe sizing, '
      + 'NOT hydraulically calculated, NOT AHJ/PE-reviewed, NOT AutoSprink/AutoCAD parity.',
    blockedClaims: layout.blockedClaims,
  };
}

/**
 * Build the CAD model for a whole floor plan.
 *
 * Two shapes are accepted, and they are 100% backward compatible:
 *   - LEGACY: { rooms: [...] }  -> a single floor at base elevation 0 (UNCHANGED).
 *   - MULTI-FLOOR: { floors: [{ level, baseElevationFt, ceilingHeightFt?, rooms }] }
 *     -> each floor's solids are offset in Z by baseElevationFt so floors stack;
 *        counts aggregate across floors; each floor keeps its own riser network.
 *
 * @returns {{name:string, units:string, rooms:Array, solids:Array, counts:object,
 *   floors?:Array, disclaimer:string}}
 */
export function buildCadModel(floorPlan) {
  // Building shape: a normalized building (stories[] with spaces/walls). Detect
  // by the building schema so legacy {rooms}/{floors} plans take the path below.
  if (isBuilding(floorPlan)) {
    return buildBuildingCad(floorPlan);
  }

  const hasFloors = floorPlan && Array.isArray(floorPlan.floors) && floorPlan.floors.length > 0;
  if (!hasFloors && (!floorPlan || !Array.isArray(floorPlan.rooms) || floorPlan.rooms.length === 0)) {
    throw new Error('floorPlan.rooms must be a non-empty array');
  }

  const base = {
    name: floorPlan.name,
    units: floorPlan.units || 'ft',
    generatedBy: 'halofire-cad-model',
    disclaimer: 'best-effort internal alpha 3D model — NFPA-13 schedule pipe sizing, '
      + 'NOT hydraulically calculated, NOT AHJ/PE-reviewed, NOT AutoSprink/AutoCAD parity.',
  };

  // Multi-floor: build each floor independently, then aggregate.
  if (hasFloors) {
    const floors = floorPlan.floors.map((floor) => buildFloorCad(floor, floor.baseElevationFt || 0));
    const rooms = floors.flatMap((f) => f.rooms);
    const solids = floors.flatMap((f) => f.solids);
    return {
      ...base,
      floors,
      rooms,
      solids,
      counts: tallyCounts(solids, rooms),
    };
  }

  // Legacy single-floor path — output is byte-identical to the pre-T6 model.
  const rooms = floorPlan.rooms.map((room) => {
    const cad = buildRoomCad(room);
    return { name: room.name, ...cad };
  });
  const solids = rooms.flatMap((r) => r.solids);
  return {
    ...base,
    rooms,
    solids,
    counts: tallyCounts(solids, rooms),
  };
}

/**
 * Push discrete kind:'component' placement markers for one riser network onto
 * `solids`. Every position is DERIVED from the supplied network coords (mainX,
 * y0, mainZ + each branchLine.y) via the same round() helper — nothing is
 * fabricated or random. These are placement markers keyed to registry component
 * keys (for rendering/instancing + takeoff); they are NOT manufacturer-exact and
 * confer NO AutoSprink/AutoCAD/AHJ/PE parity, and flip NO gate. Each marker is
 * fail-closed: an unknown registry key (getComponent returns undefined) is
 * skipped rather than emitted.
 *
 * @param {Array} solids  target solid list (mutated)
 * @param {string} prefix name prefix (e.g. `${space.name}/`) for building paths
 * @param {number} mainX  cross-main / riser X (plan)
 * @param {number} y0     riser foot Y (min branch Y)
 * @param {number} mainZ  cross-main elevation (riser top)
 * @param {number} branchZ branch-line elevation (drops hang below this)
 * @param {number} mainDia cross-main pipe diameter (in) for reducer step detection
 * @param {Array} branchLines branch lines, each with `.row`/`.y`/`.startX`/`.endX`/`.diameterIn`
 */
function pushComponentMarkers(solids, prefix, mainX, y0, mainZ, branchZ, mainDia, branchLines) {
  const place = (key, name, position) => {
    const def = getComponent(key);
    if (!def) return; // fail-closed: skip unknown registry keys
    solids.push({
      kind: 'component', name: `${prefix}${name}`, layer: 'COMPONENTS',
      componentKey: key, category: def.category, position,
    });
  };

  // System riser assembly at the riser top (where the riser meets the cross-main).
  place('riser_assembly', 'riser-assembly', [mainX, y0, mainZ]);
  // Alarm check valve on the riser, just below the assembly (deterministic -1 ft).
  place('valve_alarm_check', 'alarm-check', [mainX, y0, round(mainZ - 1)]);
  // Fire department connection at the riser base, on the floor.
  place('fdc', 'fdc', [mainX, y0, 0]);
  // A tee at each branch-to-cross-main junction (the riser-tie top points).
  for (const b of branchLines) {
    place('fitting_tee', `tee-main-${b.row}`, [mainX, b.y, mainZ]);
  }

  // 90° elbow at the riser top turn (vertical riser -> horizontal cross-main),
  // co-located with the riser assembly but a distinct fitting marker.
  place('fitting_elbow_90', 'elbow-riser-top', [mainX, y0, mainZ]);

  for (const b of branchLines) {
    // 90° elbow at the far (end-of-line) end of each branch run, where the
    // branch turns/terminates. Derived from the branch endX coordinate.
    place('fitting_elbow_90', `elbow-branch-${b.row}`, [round(b.endX), b.y, branchZ]);
    // Coupling at the interior midpoint of each branch run (pipe-stick joint),
    // derived from startX/endX — never invented.
    const midX = round((b.startX + b.endX) / 2);
    place('fitting_coupling', `coupling-branch-${b.row}`, [midX, b.y, branchZ]);
    // Concentric reducer only where the branch is genuinely smaller than the
    // cross-main it ties into (a real size change). Equal diameters -> none.
    if (b.diameterIn < mainDia) {
      place('fitting_reducer', `reducer-branch-${b.row}`, [mainX, b.y, branchZ]);
    }
  }
}

function round(n) {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}

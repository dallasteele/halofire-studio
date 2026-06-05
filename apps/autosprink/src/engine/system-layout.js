/**
 * HaloFire full per-space sprinkler system layout (internal alpha, best-effort).
 *
 * Consumes a normalized building (see building-model.js normalizeBuilding) and
 * lays out a complete, building-wide wet-pipe sprinkler system:
 *   - EACH space on EACH story is laid out INDEPENDENTLY with the existing
 *     layoutRoom() on that space's own polygon, so heads fill every space and
 *     are clipped to the space (grid points outside the polygon are dropped).
 *   - COLUMN-AWARE: any head whose grid point falls within (sizeFt/2 + clearance)
 *     of a structural column on that story is nudged to a nearby in-polygon point,
 *     or dropped if no clear point exists. This keeps heads off columns.
 *   - The piping topology reuses the riser -> cross-main -> branch -> drop -> head
 *     model from cad-model.js: per-space cross-main + per-row branch lines + drops
 *     + heads, plus a per-story FEED MAIN that ties every space's cross-main back
 *     to the story riser. NFPA-13 schedule pipe sizing comes from sizePipe().
 *
 * Plain data only — no OpenGeometry / browser deps. Fully deterministic:
 * identical input always yields identical output.
 *
 * This is NOT CAD object-recognition AI and performs NO hydraulic calculation.
 * It makes NO AutoSprink / AutoCAD / AHJ / PE / manufacturer parity claim; all
 * claim gates stay fail-closed.
 *
 * Coordinates: feet. X/Y are plan.
 */

import { layoutRoom, pointInPolygon, polygonArea } from './sprinkler-layout.js';
import { sizePipe } from './cad-model.js';

// Extra clearance (ft) added to the column half-size when deciding whether a
// head sits "on" a column.
const COLUMN_CLEARANCE_FT = 0.5;

function round(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** True if point [x,y] is within (col.sizeFt/2 + clearance) of a column center. */
function hitsColumn(x, y, columns) {
  for (const col of columns) {
    const reach = col.sizeFt / 2 + COLUMN_CLEARANCE_FT;
    if (Math.abs(x - col.x) <= reach && Math.abs(y - col.y) <= reach) {
      return col;
    }
  }
  return null;
}

/**
 * Resolve a single head against the story's columns: if it sits on a column,
 * try a ring of small in-polygon nudges; return the nudged point, or null to
 * drop the head if no clear, in-polygon spot exists nearby.
 */
function resolveAgainstColumns(head, polygon, columns) {
  if (!columns.length) return { x: head.x, y: head.y };
  const col = hitsColumn(head.x, head.y, columns);
  if (!col) return { x: head.x, y: head.y };

  // Nudge distance: just past the column reach so we clear it.
  const step = round(col.sizeFt / 2 + COLUMN_CLEARANCE_FT + 0.5);
  // Deterministic candidate order: +x, -x, +y, -y, then diagonals.
  const offsets = [
    [step, 0], [-step, 0], [0, step], [0, -step],
    [step, step], [-step, step], [step, -step], [-step, -step],
  ];
  for (const [dx, dy] of offsets) {
    const nx = round(head.x + dx);
    const ny = round(head.y + dy);
    if (pointInPolygon([nx, ny], polygon) && !hitsColumn(nx, ny, columns)) {
      return { x: nx, y: ny, nudged: true };
    }
  }
  return null; // drop: no clear in-polygon spot
}

/**
 * Lay out one space: layoutRoom on its polygon, then make every head
 * column-aware. Returns heads grouped into branch lines (by grid row) plus
 * NFPA schedule sizing.
 */
function layoutSpace(space, columns) {
  const hazard = space.hazard;
  const layout = layoutRoom({ polygon: space.polygon, hazard });

  // Apply column-awareness, preserving each head's grid row/col for grouping.
  const heads = [];
  for (const h of layout.heads) {
    const resolved = resolveAgainstColumns(h, space.polygon, columns);
    if (!resolved) continue; // dropped at a column with no clear nudge
    heads.push({ x: resolved.x, y: resolved.y, row: h.row, col: h.col, nudged: !!resolved.nudged });
  }

  // Group into branch lines by grid row (one branch line per occupied row).
  const rowsMap = new Map();
  for (const h of heads) {
    if (!rowsMap.has(h.row)) rowsMap.set(h.row, []);
    rowsMap.get(h.row).push(h);
  }
  const branchLines = [];
  for (const row of [...rowsMap.keys()].sort((a, b) => a - b)) {
    const rowHeads = rowsMap.get(row).sort((a, b) => a.x - b.x);
    const xs = rowHeads.map((h) => h.x);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const lengthFt = round((maxX - minX) + layout.spacingX); // half-spacing stub each end
    branchLines.push({
      row,
      y: rowHeads[0].y,
      startX: round(minX),
      endX: round(maxX),
      lengthFt,
      headCount: rowHeads.length,
      diameterIn: sizePipe(rowHeads.length, hazard),
      heads: rowHeads,
    });
  }

  // Cross-main spans the vertical extent of the branch lines, sized for the
  // full space head count.
  const ys = branchLines.map((b) => b.y);
  const crossMainFt = branchLines.length > 1
    ? round((Math.max(...ys) - Math.min(...ys)) + layout.spacingY)
    : 0;
  const headCount = heads.length;

  return {
    name: space.name,
    hazard,
    headCount,
    heads,
    branchLines,
    sizing: {
      hazard,
      crossMainDiameterIn: sizePipe(headCount, hazard),
      crossMainFt,
      branchDiameters: branchLines.map((b) => b.diameterIn),
    },
    // Internal: spacing for downstream feed-main geometry.
    _spacingX: layout.spacingX,
    _spacingY: layout.spacingY,
    _bbox: layout.bbox,
  };
}

/**
 * Lay out a whole building: every space on every story, column-aware, with a
 * per-story feed main tying the space cross-mains to the story riser.
 *
 * @param {{name:string, units:string, stories:Array}} building normalizeBuilding output
 * @returns {{
 *   buildingName:string, units:string, generatedBy:string,
 *   stories:Array<{level:number, spaces:Array, storyHeadCount:number, feedMain:object}>,
 *   totalHeadCount:number, pipeSchedule:Array<{diameterIn:number,lengthFt:number}>,
 *   coverageOk:boolean, perSpace:Array, disclaimer:string, blockedClaims:Array<string>
 * }}
 */
export function layoutBuilding(building) {
  if (!building || !Array.isArray(building.stories) || building.stories.length === 0) {
    throw new Error('layoutBuilding requires a normalized building with a non-empty stories array');
  }

  let coverageOk = true;
  const perSpace = [];
  let totalHeadCount = 0;
  // Aggregate pipe lengths by diameter across the whole building.
  const pipeByDia = new Map();
  function addPipe(diameterIn, lengthFt) {
    if (!(lengthFt > 0)) return;
    const prev = pipeByDia.get(diameterIn) || 0;
    pipeByDia.set(diameterIn, round(prev + lengthFt));
  }

  const stories = building.stories.map((story) => {
    const columns = Array.isArray(story.columns) ? story.columns : [];
    const spaces = story.spaces.map((space) => {
      const laid = layoutSpace(space, columns);

      // Coverage: a non-degenerate space (>=3 verts, positive area) must keep
      // at least one head. Degenerate spaces never reach here (dropped by
      // normalizeBuilding), so headCount 0 here is a real coverage failure.
      const nonDegenerate = space.polygon.length >= 3 && polygonArea(space.polygon) > 0;
      if (nonDegenerate && laid.headCount < 1) coverageOk = false;

      totalHeadCount += laid.headCount;

      // Tally this space's pipe: branch lines + cross-main + drops (one drop
      // per head, branchZ->headZ is ~0.5ft; counted as drop allowance).
      for (const bl of laid.branchLines) addPipe(bl.diameterIn, bl.lengthFt);
      addPipe(laid.sizing.crossMainDiameterIn, laid.sizing.crossMainFt);

      const summary = {
        name: laid.name,
        hazard: laid.hazard,
        headCount: laid.headCount,
        heads: laid.heads,
        branchLines: laid.branchLines,
        sizing: laid.sizing,
      };
      perSpace.push({ level: story.level, name: laid.name, hazard: laid.hazard, headCount: laid.headCount });
      // Keep internal geometry for feed-main routing.
      summary._bbox = laid._bbox;
      return summary;
    });

    const storyHeadCount = spaces.reduce((n, s) => n + s.headCount, 0);

    // Per-story feed main: a single main tying every space cross-main back to
    // the story riser. Routed along the X extent of all space bounding boxes;
    // sized for the whole-story head count. Length = span of space centers + a
    // stub, deterministic from geometry.
    const centers = spaces
      .filter((s) => s.headCount > 0)
      .map((s) => ({
        x: round((s._bbox.minX + s._bbox.maxX) / 2),
        y: round((s._bbox.minY + s._bbox.maxY) / 2),
      }));
    let feedMainFt = 0;
    if (centers.length > 1) {
      const xs = centers.map((c) => c.x);
      const ysC = centers.map((c) => c.y);
      // Manhattan span across the space centers (main + branch-to-main runs).
      feedMainFt = round((Math.max(...xs) - Math.min(...xs)) + (Math.max(...ysC) - Math.min(...ysC)) + 2);
    }
    const feedMainDia = sizePipe(storyHeadCount, dominantHazard(spaces));
    addPipe(feedMainDia, feedMainFt);

    // Strip internal _bbox before returning.
    const publicSpaces = spaces.map(({ _bbox, ...rest }) => rest);

    return {
      level: story.level,
      baseElevationFt: story.baseElevationFt,
      spaces: publicSpaces,
      storyHeadCount,
      feedMain: { diameterIn: feedMainDia, lengthFt: feedMainFt },
    };
  });

  const pipeSchedule = [...pipeByDia.entries()]
    .map(([diameterIn, lengthFt]) => ({ diameterIn, lengthFt }))
    .sort((a, b) => a.diameterIn - b.diameterIn);

  return {
    buildingName: building.name,
    units: building.units || 'ft',
    generatedBy: 'halofire-system-layout',
    stories,
    totalHeadCount,
    pipeSchedule,
    coverageOk,
    perSpace,
    disclaimer: 'best-effort internal alpha per-space system — NFPA-13 schedule pipe sizing, '
      + 'column-aware head placement, NOT hydraulically calculated, NOT AHJ/PE-reviewed, '
      + 'NOT AutoSprink/AutoCAD parity.',
    blockedClaims: [
      'AutoSprink parity',
      'fabrication-ready layout',
      'permit-ready',
      'AHJ-approved',
      'professionally reviewed',
      'hydraulically calculated',
    ],
  };
}

/** Most-common hazard among spaces (ties -> 'ordinary'); used to size the feed main. */
function dominantHazard(spaces) {
  const counts = new Map();
  for (const s of spaces) counts.set(s.hazard, (counts.get(s.hazard) || 0) + 1);
  let best = 'ordinary';
  let bestN = -1;
  for (const [h, n] of counts) {
    if (n > bestN) { best = h; bestN = n; }
  }
  return best;
}

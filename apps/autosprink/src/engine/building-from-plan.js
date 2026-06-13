/**
 * building-from-plan.js — build TRUE-SCALE per-level 3D from extracted LevelPlans.
 *
 * Consumes the structured LevelPlan objects emitted by plan-extract.js (real footprint
 * loop, interior wall segments, classified rooms, stair cores, grid, all in FEET at the
 * scale DERIVED from each sheet's printed notation) and builds one THREE.Group per level:
 *   - the REAL footprint extruded as a thin floor slab at the level elevation;
 *   - interior + perimeter WALLS extruded to a wall height;
 *   - STAIR cores as taller shaft volumes;
 *   - ROOMS as labeled space floors (color-coded by kind);
 *   - per-level visibility switching.
 *
 * This REPLACES the single-box building massing: geometry comes from the plan, not a margin
 * box. TRUE SCALE: 1 world unit = 1 ft, where the foot is DERIVED from the drawing's printed
 * scale (carried in LevelPlan.scaleFtPerUnit) — never hardcoded here.
 *
 * THREE is dependency-injected (same pattern as building-levels.js) so this is testable with a
 * stub THREE and never imports a renderer. Everything produced is flagged
 * userData.needsVerification = true; nothing here clears a claim gate or asserts AHJ / PE /
 * manufacturer-exact / AutoSprink parity.
 */

const SLAB_COLOR = 0x2dd4bf;
const WALL_COLOR = 0x8b9bb4;
const KIND_COLORS = Object.freeze({
  parking: 0x5b6b7a,
  stair: 0xff6b4a,
  elevator: 0xffa94a,
  mech: 0x9b59b6,
  elec: 0xf1c40f,
  ramp: 0x7f8c8d,
  trash: 0x6b4a2a,
  storage: 0x4a6b5b,
  lobby: 0x4ab0ff,
  corridor: 0x3a4a5a,
  restroom: 0x4ad6c0,
  unit: 0x2ecc71,
  unknown: 0x44506a,
});

function kindColor(kind) {
  return KIND_COLORS[kind] || KIND_COLORS.unknown;
}

/**
 * PURE. Compute the world transform that registers a REAL plan-sheet PDF UNDER the
 * extracted geometry, at the SAME drawing-derived true scale (no contain-fit, no
 * re-fit). This is the honest counterpart to pdf-underlay.computeUnderlayTransform:
 * instead of squashing the page into a guessed footprint box, we place the page using
 * the EXACT plan-feet -> world map that buildBuildingFromPlans uses, so the sheet's own
 * wall lines sit beneath the extracted walls (the overlay-floor1 alignment, in 3D).
 *
 * Mapping (identical to buildBuildingFromPlans + the proven plan-extract overlay):
 *   - The sheet spans the whole PDF page. A page point (xPt, yPt) [PDF y-up, origin
 *     bottom-left] is at plan feet (xPt * s, yPt * s), s = scaleFtPerUnit.
 *   - Geometry maps plan (xFt, yFt) -> world (xFt - cx, elev, yFt - cy): plan-X -> world-X,
 *     plan-Y -> world-Z, centered on the union footprint bbox center (cx, cy).
 *   - So the page, in feet, spans world X in [-cx, pageWFt-cx] and world Z in
 *     [-cy, pageHFt-cy]; its center sits at world (pageWFt/2 - cx, elev+lift, pageHFt/2 - cy).
 *   - PlaneGeometry faces +Z with the texture upright; CanvasTexture flipY (default true)
 *     puts the image TOP at plane local +Y. PDF y-up means image-top = MAX PDF-y = MAX
 *     plan-Y, which must land at MAX world-Z. rotation.x = +PI/2 sends plane local +Y -> +Z
 *     (NOT -PI/2, which the contain-fit underlay uses and which would MIRROR plan-Y here).
 *
 * @returns {{widthFt, depthFt, scaleFtPerUnit, position:{x,y,z}, rotation:{x,y,z}, scaleSource, needsVerification}}
 */
export function computePlanUnderlayTransform({
  pageWidthPt,
  pageHeightPt,
  scaleFtPerUnit,
  unionCenterXFt = 0,
  unionCenterYFt = 0,
  elevationFt = 0,
  liftFt = 0.04,
}) {
  const wPt = Number(pageWidthPt);
  const hPt = Number(pageHeightPt);
  const s = Number(scaleFtPerUnit);
  if (!(wPt > 0) || !(hPt > 0)) throw new Error('computePlanUnderlayTransform: page size (pt) must be positive');
  if (!(s > 0)) throw new Error('computePlanUnderlayTransform: scaleFtPerUnit must be positive (derived from the sheet, never hardcoded)');
  const pageWFt = wPt * s;
  const pageHFt = hPt * s;
  return {
    widthFt: pageWFt,
    depthFt: pageHFt,
    scaleFtPerUnit: s,
    position: {
      x: pageWFt / 2 - Number(unionCenterXFt),
      y: Number(elevationFt) + Number(liftFt),
      z: pageHFt / 2 - Number(unionCenterYFt),
    },
    // +PI/2 (not -PI/2): keep plan-Y aligned with geometry world-Z (no mirror).
    rotation: { x: Math.PI / 2, y: 0, z: 0 },
    scaleSource: 'registered to extracted geometry at the sheet-derived true scale — NOT a title-block-verified plot scale; needs-verification',
    needsVerification: true,
  };
}

/**
 * PURE. The shared world origin (union footprint bbox center, in plan feet) that
 * buildBuildingFromPlans uses. Callers need this to register underlays against the
 * SAME center the geometry is built around. Returns {cx, cy, ...bounds} or null.
 */
export function unionFootprintCenter(levelPlans) {
  let uMinX = Infinity, uMinY = Infinity, uMaxX = -Infinity, uMaxY = -Infinity;
  for (const lp of (Array.isArray(levelPlans) ? levelPlans : [])) {
    const b = planBounds(lp && lp.plan && lp.plan.footprintFt);
    if (b.widthFt > 0 && b.depthFt > 0) {
      uMinX = Math.min(uMinX, b.minX); uMinY = Math.min(uMinY, b.minY);
      uMaxX = Math.max(uMaxX, b.maxX); uMaxY = Math.max(uMaxY, b.maxY);
    }
  }
  if (!Number.isFinite(uMinX)) return null;
  return {
    minX: uMinX, minY: uMinY, maxX: uMaxX, maxY: uMaxY,
    cx: (uMinX + uMaxX) / 2, cy: (uMinY + uMaxY) / 2,
    widthFt: uMaxX - uMinX, depthFt: uMaxY - uMinY,
  };
}

/** PURE. Centroid of a polygon ([[x,y],...]) in plan feet. */
export function polyCentroid(poly) {
  const pts = Array.isArray(poly) ? poly : [];
  if (pts.length === 0) return [0, 0];
  let sx = 0, sy = 0;
  for (const [x, y] of pts) { sx += x; sy += y; }
  return [sx / pts.length, sy / pts.length];
}

/** PURE. Axis-aligned bbox + center of a footprint loop in plan feet. */
export function planBounds(footprintFt) {
  const pts = Array.isArray(footprintFt) ? footprintFt : [];
  if (pts.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0, cx: 0, cy: 0, widthFt: 0, depthFt: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return {
    minX, minY, maxX, maxY,
    cx: (minX + maxX) / 2, cy: (minY + maxY) / 2,
    widthFt: maxX - minX, depthFt: maxY - minY,
  };
}

/**
 * Build a Shape-extruded floor slab for a footprint polygon (in PLAN feet), centered on the
 * footprint bbox center so the model sits at the world origin. Plan Y maps to world Z.
 */
function makeFootprintSlab(THREE, footprintFt, bounds, elevationFt, slabThicknessFt) {
  if (!THREE.Shape || !THREE.ExtrudeGeometry) {
    // Stub THREE (tests) — return a tagged group placeholder.
    const g = new THREE.Group();
    g.name = `footprint-slab:elev${elevationFt}`;
    g.userData = { kind: 'footprint-slab', needsVerification: true, vertexCount: footprintFt.length };
    return g;
  }
  const shape = new THREE.Shape();
  footprintFt.forEach(([x, y], i) => {
    const px = x - bounds.cx; const pz = y - bounds.cy;
    if (i === 0) shape.moveTo(px, pz); else shape.lineTo(px, pz);
  });
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: slabThicknessFt, bevelEnabled: false });
  // Extrude is along +Z of the shape plane; rotate so it lies flat (XZ plane), thickness up Y.
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial
    ? new THREE.MeshStandardMaterial({ color: SLAB_COLOR, transparent: true, opacity: 0.32, metalness: 0, roughness: 0.95 })
    : new THREE.MeshBasicMaterial({ color: SLAB_COLOR, transparent: true, opacity: 0.32 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = elevationFt;
  mesh.name = `footprint-slab:elev${elevationFt}`;
  mesh.userData = { kind: 'footprint-slab', needsVerification: true };
  return mesh;
}

/** Build one extruded wall box from a plan-feet segment {a:[x,y], b:[x,y]}. */
function makeWall(THREE, seg, bounds, elevationFt, heightFt, thicknessFt, mat) {
  const ax = seg.a[0] - bounds.cx, az = seg.a[1] - bounds.cy;
  const bx = seg.b[0] - bounds.cx, bz = seg.b[1] - bounds.cy;
  const len = Math.hypot(bx - ax, bz - az);
  if (!(len > 0.01)) return null;
  const geo = new THREE.BoxGeometry(len, heightFt, thicknessFt);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set((ax + bx) / 2, elevationFt + heightFt / 2, (az + bz) / 2);
  mesh.rotation.y = -Math.atan2(bz - az, bx - ax);
  mesh.name = 'plan-wall';
  mesh.userData = { kind: 'plan-wall', needsVerification: true };
  return mesh;
}

/** Build a room/space floor tile (thin colored slab) for a rectilinear room polygon. */
function makeRoomTile(THREE, room, bounds, elevationFt) {
  if (!THREE.Shape || !THREE.ExtrudeGeometry) return null;
  const shape = new THREE.Shape();
  room.poly.forEach(([x, y], i) => {
    const px = x - bounds.cx; const pz = y - bounds.cy;
    if (i === 0) shape.moveTo(px, pz); else shape.lineTo(px, pz);
  });
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.15, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial
    ? new THREE.MeshStandardMaterial({ color: kindColor(room.kind), transparent: true, opacity: 0.5, metalness: 0, roughness: 0.9 })
    : new THREE.MeshBasicMaterial({ color: kindColor(room.kind), transparent: true, opacity: 0.5 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = elevationFt + 0.05;
  mesh.name = `room:${room.kind}${room.label ? ':' + room.label : ''}`;
  mesh.userData = { kind: 'plan-room', spaceKind: room.kind, label: room.label || null, areaSqft: room.areaSqft, confidence: room.confidence, needsVerification: true };
  return mesh;
}

/**
 * Build the multi-level building from extracted LevelPlans.
 *
 * @param {Object} THREE - injected three.js namespace.
 * @param {Array<{level:number, name?:string, elevationFt:number, elevationSource?:string, plan:LevelPlan}>} levelPlans
 *   Each entry pairs a level number + elevation (from the sheets / estimated + flagged) with its
 *   extracted LevelPlan. ALL share the same world origin (the union footprint center) so floors stack.
 * @param {Object} [opts]
 *   wallHeightFt (default 9), wallThicknessFt (0.5), slabThicknessFt (0.75), stairExtraFt (height
 *   bump for stair shafts, default 2), includeRooms (true), includeWalls (true).
 * @returns {{root, levels, setActiveLevel, setLevelVisible, bounds, summary}}
 */
export function buildBuildingFromPlans(THREE, levelPlans, opts = {}) {
  if (!THREE || !THREE.Group) throw new Error('buildBuildingFromPlans: THREE namespace is required');
  if (!Array.isArray(levelPlans) || levelPlans.length === 0) {
    throw new Error('buildBuildingFromPlans: at least one {level, elevationFt, plan} entry is required (no plan -> no building; never fabricate)');
  }
  const {
    wallHeightFt = 9,
    wallThicknessFt = 0.5,
    slabThicknessFt = 0.75,
    stairExtraFt = 2,
    includeRooms = true,
    includeWalls = true,
    // Perf: real floor plans carry thousands of wall segments (floor 1 = 6858).
    // One Mesh per wall = thousands of draw calls and tanks the live viewport. When a
    // geometry merger (e.g. three's mergeGeometries) is injected AND a level exceeds
    // wallMergeThreshold walls, collapse that level's walls into ONE merged BufferGeometry
    // (drawn as a single mesh). Geometry is unchanged — only the draw-call count drops.
    // Small plans / stub-THREE tests keep the per-wall (selectable) path.
    mergeGeometries = null,
    wallMergeThreshold = 600,
  } = opts;

  // Shared world origin: union of all level footprints so floors align vertically.
  let uMinX = Infinity, uMinY = Infinity, uMaxX = -Infinity, uMaxY = -Infinity;
  for (const lp of levelPlans) {
    const b = planBounds(lp.plan && lp.plan.footprintFt);
    if (b.widthFt > 0 && b.depthFt > 0) {
      uMinX = Math.min(uMinX, b.minX); uMinY = Math.min(uMinY, b.minY);
      uMaxX = Math.max(uMaxX, b.maxX); uMaxY = Math.max(uMaxY, b.maxY);
    }
  }
  if (!Number.isFinite(uMinX)) throw new Error('buildBuildingFromPlans: no level has a positive footprint');
  const bounds = {
    minX: uMinX, minY: uMinY, maxX: uMaxX, maxY: uMaxY,
    cx: (uMinX + uMaxX) / 2, cy: (uMinY + uMaxY) / 2,
    widthFt: uMaxX - uMinX, depthFt: uMaxY - uMinY,
  };

  const root = new THREE.Group();
  root.name = 'building-from-plan';
  root.userData = { kind: 'building-from-plan', needsVerification: true };

  const wallMat = THREE.MeshStandardMaterial
    ? new THREE.MeshStandardMaterial({ color: WALL_COLOR, transparent: true, opacity: 0.6, metalness: 0, roughness: 0.9 })
    : (THREE.MeshBasicMaterial ? new THREE.MeshBasicMaterial({ color: WALL_COLOR, transparent: true, opacity: 0.6 }) : null);

  const levels = [];
  for (const lp of levelPlans) {
    const plan = lp.plan || {};
    const elevationFt = Number(lp.elevationFt) || 0;
    const group = new THREE.Group();
    group.name = `level:${lp.level}`;
    group.userData = {
      kind: 'plan-building-level',
      level: lp.level,
      name: lp.name || `Level ${lp.level}`,
      elevationFt,
      elevationSource: lp.elevationSource || 'unspecified',
      scaleFtPerUnit: plan.scaleFtPerUnit,
      scaleText: plan.scaleText,
      provenance: plan.provenance,
      needsVerification: true,
    };

    let wallCount = 0, roomCount = 0, stairCount = 0;

    // Footprint slab.
    if (Array.isArray(plan.footprintFt) && plan.footprintFt.length >= 3) {
      const slab = makeFootprintSlab(THREE, plan.footprintFt, bounds, elevationFt, slabThicknessFt);
      group.add(slab);
    }

    // Walls.
    if (includeWalls && wallMat && THREE.BoxGeometry && Array.isArray(plan.walls)) {
      const validWalls = plan.walls.filter((seg) => seg && Array.isArray(seg.a) && Array.isArray(seg.b));
      const doMerge = typeof mergeGeometries === 'function' && validWalls.length >= wallMergeThreshold;
      if (doMerge) {
        // Build each wall's geometry, bake its transform into the verts, merge into one.
        const geos = [];
        for (const seg of validWalls) {
          const ax = seg.a[0] - bounds.cx, az = seg.a[1] - bounds.cy;
          const bx = seg.b[0] - bounds.cx, bz = seg.b[1] - bounds.cy;
          const len = Math.hypot(bx - ax, bz - az);
          if (!(len > 0.01)) continue;
          const g = new THREE.BoxGeometry(len, wallHeightFt, wallThicknessFt);
          if (g.rotateY) g.rotateY(-Math.atan2(bz - az, bx - ax));
          if (g.translate) g.translate((ax + bx) / 2, elevationFt + wallHeightFt / 2, (az + bz) / 2);
          geos.push(g);
          wallCount += 1;
        }
        if (geos.length) {
          const merged = mergeGeometries(geos, false);
          for (const g of geos) { if (g.dispose) g.dispose(); }
          if (merged) {
            const mesh = new THREE.Mesh(merged, wallMat);
            mesh.name = 'plan-walls-merged';
            mesh.userData = { kind: 'plan-wall', merged: true, wallCount: geos.length, needsVerification: true };
            group.add(mesh);
          }
        }
      } else {
        for (const seg of validWalls) {
          const m = makeWall(THREE, seg, bounds, elevationFt, wallHeightFt, wallThicknessFt, wallMat);
          if (m) { group.add(m); wallCount += 1; }
        }
      }
    }

    // Rooms as labeled tiles.
    if (includeRooms && Array.isArray(plan.rooms)) {
      for (const room of plan.rooms) {
        if (!room || !Array.isArray(room.poly) || room.poly.length < 3) continue;
        const tile = makeRoomTile(THREE, room, bounds, elevationFt);
        if (tile) { group.add(tile); roomCount += 1; }
      }
    }

    // Stair cores: taller shaft volumes (extrude the stair bbox).
    if (Array.isArray(plan.stairs) && THREE.BoxGeometry) {
      for (const st of plan.stairs) {
        const b = st.bbox || {};
        const w = (b.maxX - b.minX), d = (b.maxY - b.minY);
        if (!(w > 0) || !(d > 0)) continue;
        const h = wallHeightFt + stairExtraFt;
        const geo = new THREE.BoxGeometry(w, h, d);
        const mat = THREE.MeshStandardMaterial
          ? new THREE.MeshStandardMaterial({ color: kindColor('stair'), transparent: true, opacity: 0.45, metalness: 0, roughness: 0.85 })
          : new THREE.MeshBasicMaterial({ color: kindColor('stair'), transparent: true, opacity: 0.45 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set((b.minX + b.maxX) / 2 - bounds.cx, elevationFt + h / 2, (b.minY + b.maxY) / 2 - bounds.cy);
        mesh.name = 'stair-core';
        mesh.userData = { kind: 'stair-core', evidence: st.evidence, confidence: st.confidence, needsVerification: true };
        group.add(mesh);
        stairCount += 1;
      }
    }

    root.add(group);
    levels.push({
      level: lp.level,
      name: lp.name || `Level ${lp.level}`,
      elevationFt,
      group,
      counts: { walls: wallCount, rooms: roomCount, stairs: stairCount },
    });
  }

  function levelEntry(n) { return levels.find((l) => l.level === Number(n)) || null; }
  function setActiveLevel(levelOrAll) {
    for (const l of levels) l.group.visible = levelOrAll === 'all' || l.level === Number(levelOrAll);
  }
  function setLevelVisible(level, visible) {
    const l = levelEntry(level);
    if (l) l.group.visible = !!visible;
  }

  const summary = {
    levelCount: levels.length,
    bounds: { widthFt: Math.round(bounds.widthFt * 100) / 100, depthFt: Math.round(bounds.depthFt * 100) / 100 },
    perLevel: levels.map((l) => ({ level: l.level, elevationFt: l.elevationFt, ...l.counts })),
    needsVerification: true,
    provenance: 'built from extracted LevelPlans — true scale derived from sheet, needs-verification',
  };

  return { root, levels, setActiveLevel, setLevelVisible, bounds, summary };
}

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
 *   - PlaneGeometry faces +Z. rotation.x = -PI/2 sends the textured face normal to +Y (UP),
 *     toward the top-down plan camera, so text reads FORWARD (a +PI/2 plane would show its BACK
 *     to that camera = the observed BACKWARDS text — the RECORE orientation bug, now fixed).
 *   - VERIFIED LIVE on the Studio top view: -PI/2 with NO texture flip renders every sheet
 *     text label (FLOOR PLAN GENERAL NOTES, the "22" logo, the title block, the PE seal) UPRIGHT
 *     and FORWARD, with the sheet's own wall lines sitting under the extracted walls. (flipTextureV
 *     was tried to "re-register" image-top->+Z but rendered the whole sheet UPSIDE-DOWN, so it is
 *     left false. The top-view camera up=(0,0,-1) already yields the correct readable mapping.)
 *
 * @returns {{widthFt, depthFt, scaleFtPerUnit, position:{x,y,z}, rotation:{x,y,z}, flipTextureV:boolean, scaleSource, needsVerification}}
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
    // -PI/2: textured face up (+Y) -> readable from the top-down plan camera (RECORE fix; +PI/2
    // showed the plane's BACK = backwards/mirrored text).
    // ORIENTATION (empirically re-verified 2026-06-13 via a 4-way (U,V) texture-flip sweep on the
    // live registered A-101 underlay at top+iso, evidence out/halofire-wallpipe/flipdiag/):
    // u0_v0 = NO flip (flipTextureV:false, flipTextureU:false) reads sheet text FORWARD at BOTH
    // top AND iso; flipTextureV:true MIRRORS top<->bottom (upside-down), flipTextureU:true mirrors
    // left<->right. So the registered underlay is ALREADY oriented correctly with NO flip — the
    // prior RECORE fix (-PI/2, no flip) stands. flipTextureV:true is WRONG for this path and is NOT
    // used. (flipTextureU is exposed on createUnderlayMesh as an inert default-off live-QA option.)
    // RESIDUAL: re-confirm iso-forward in a real browser when the underlay texture registers — the
    // headless build occasionally fails to register the 165MB-PDF texture (underlay===null), in
    // which case no sheet text renders and forward-at-iso is not observable (not a code defect).
    rotation: { x: -Math.PI / 2, y: 0, z: 0 },
    flipTextureV: false,
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

const DOOR_COLOR = 0xffb454;       // CONFIDENT door leaf + swing arc — warm amber
const DOOR_SUSPECT_COLOR = 0x6b7280; // SUSPECT (down-ranked) door — muted grey, visually de-emphasized
const OPENING_COLOR = 0x4ab0ff;    // cased opening / passage marker — blue
const FIXTURE_COLOR = 0x4ad6c0;    // fixture / core marker — teal
const WALLSFULL_COLOR = 0xc77dff;  // recovered partition-inclusive walls (recall layer) — violet

/**
 * Build a single DOOR as a thin leaf box + a swing-arc line, parented in one group so
 * the whole door selects/inspects as a unit. Door fields are plan-feet:
 *   position (hinge/center), width (leaf), swingDir, leafDir, swingAngleDeg.
 * The leaf is drawn along leafDir from the hinge; the swing arc traces the leaf tip.
 */
function makeDoor(THREE, door, bounds, elevationFt) {
  if (!door || !Array.isArray(door.position)) return null;
  const g = new THREE.Group();
  const hx = door.position[0] - bounds.cx, hz = door.position[1] - bounds.cy;
  const wft = Math.max(0.5, Number(door.width) || 2);
  const y = elevationFt + 0.06;
  const leaf = Array.isArray(door.leafDir) ? door.leafDir : [1, 0];
  const swing = Array.isArray(door.swingDir) ? door.swingDir : [0, 1];
  // HF-W2b: suspect (down-ranked) doors render muted + more transparent so confident doors stand out.
  const suspect = door.suspect === true || door.confidence === 'low';
  const col = suspect ? DOOR_SUSPECT_COLOR : DOOR_COLOR;
  const leafOpacity = suspect ? 0.45 : 0.92;
  // Leaf: a thin slab from hinge along leafDir.
  if (THREE.BoxGeometry) {
    const geo = new THREE.BoxGeometry(wft, 0.12, 0.34);
    const mat = THREE.MeshStandardMaterial
      ? new THREE.MeshStandardMaterial({ color: col, transparent: true, opacity: leafOpacity, metalness: 0, roughness: 0.6 })
      : new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: leafOpacity });
    const leafMesh = new THREE.Mesh(geo, mat);
    const ang = Math.atan2(leaf[1], leaf[0]);          // plan angle of the leaf
    leafMesh.position.set(hx + Math.cos(ang) * wft / 2, y, hz + Math.sin(ang) * wft / 2);
    leafMesh.rotation.y = -ang;                          // plan-Y -> world-Z (see W())
    leafMesh.name = 'plan-door-leaf';
    g.add(leafMesh);
  }
  // Swing arc: tip path from leafDir to swingDir, drawn as a thin Line (no fill).
  if (THREE.BufferGeometry && THREE.Line && THREE.LineBasicMaterial && THREE.Vector3) {
    const a0 = Math.atan2(leaf[1], leaf[0]);
    let a1 = Math.atan2(swing[1], swing[0]);
    let d = a1 - a0; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    const STEPS = 16; const pts = [];
    for (let i = 0; i <= STEPS; i++) {
      const a = a0 + d * (i / STEPS);
      pts.push(new THREE.Vector3(hx + Math.cos(a) * wft, y, hz + Math.sin(a) * wft));
    }
    const lg = new THREE.BufferGeometry().setFromPoints(pts);
    const lm = new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: suspect ? 0.4 : 0.8 });
    const arc = new THREE.Line(lg, lm);
    arc.name = 'plan-door-swing';
    g.add(arc);
  }
  g.name = `plan-door:${wft.toFixed(1)}ft`;
  g.userData = {
    kind: 'plan-door', widthFt: Math.round(wft * 100) / 100,
    swingAngleDeg: door.swingAngleDeg, hostWall: door.hostWall, onWall: door.onWall,
    confidence: door.confidence, suspect, widthClass: door.widthClass || null,
    evidence: door.evidence, needsVerification: true,
  };
  return g;
}

/** Build a small post marker for a cased OPENING / passage (no door leaf). */
function makeOpening(THREE, op, bounds, elevationFt) {
  if (!op || !Array.isArray(op.position) || !THREE.BoxGeometry) return null;
  const wft = Math.max(0.5, Number(op.width) || 3);
  const geo = new THREE.BoxGeometry(wft, 0.1, 0.2);
  const mat = THREE.MeshStandardMaterial
    ? new THREE.MeshStandardMaterial({ color: OPENING_COLOR, transparent: true, opacity: 0.7, metalness: 0, roughness: 0.7 })
    : new THREE.MeshBasicMaterial({ color: OPENING_COLOR, transparent: true, opacity: 0.7 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(op.position[0] - bounds.cx, elevationFt + 0.05, op.position[1] - bounds.cy);
  mesh.name = `plan-opening:${wft.toFixed(1)}ft`;
  mesh.userData = { kind: 'plan-opening', widthFt: Math.round(wft * 100) / 100, evidence: op.evidence, confidence: op.confidence, needsVerification: true };
  return mesh;
}

/** Build a FIXTURE/core marker (small upright box, colored by fixture kind). */
function makeFixtureMarker(THREE, fx, bounds, elevationFt) {
  if (!fx || !Array.isArray(fx.position) || !THREE.BoxGeometry) return null;
  const geo = new THREE.BoxGeometry(1.6, 1.2, 1.6);
  const col = kindColor(fx.fixtureKind) || FIXTURE_COLOR;
  const mat = THREE.MeshStandardMaterial
    ? new THREE.MeshStandardMaterial({ color: col, transparent: true, opacity: 0.8, metalness: 0, roughness: 0.6 })
    : new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.8 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(fx.position[0] - bounds.cx, elevationFt + 0.7, fx.position[1] - bounds.cy);
  mesh.name = `plan-fixture:${fx.fixtureKind || 'fixture'}`;
  mesh.userData = { kind: 'plan-fixture', fixtureKind: fx.fixtureKind, label: fx.label || null, source: fx.source, confidence: fx.confidence, needsVerification: true };
  return mesh;
}

/**
 * Build the recall-complete additive wallsFull set as ONE merged line/box layer (violet).
 * These are the previously-missed interior partitions recovered by the partition-inclusive
 * lineweight pass. Rendered as thin low walls so they read as "recovered" without masking the
 * proven single-band shell. Merged into one geometry when a merger is injected (perf: 41k segs).
 */
function makeWallsFullLayer(THREE, segs, bounds, elevationFt, heightFt, mergeGeometries) {
  if (!Array.isArray(segs) || !segs.length || !THREE.BoxGeometry) return null;
  const valid = segs.filter((s) => s && Array.isArray(s.a) && Array.isArray(s.b));
  if (!valid.length) return null;
  const mat = THREE.MeshStandardMaterial
    ? new THREE.MeshStandardMaterial({ color: WALLSFULL_COLOR, transparent: true, opacity: 0.5, metalness: 0, roughness: 0.85 })
    : new THREE.MeshBasicMaterial({ color: WALLSFULL_COLOR, transparent: true, opacity: 0.5 });
  const h = Math.max(2, heightFt * 0.5);
  if (typeof mergeGeometries === 'function') {
    const geos = [];
    for (const seg of valid) {
      const ax = seg.a[0] - bounds.cx, az = seg.a[1] - bounds.cy;
      const bx = seg.b[0] - bounds.cx, bz = seg.b[1] - bounds.cy;
      const len = Math.hypot(bx - ax, bz - az);
      if (!(len > 0.01)) continue;
      const g = new THREE.BoxGeometry(len, h, 0.25);
      if (g.rotateY) g.rotateY(-Math.atan2(bz - az, bx - ax));
      if (g.translate) g.translate((ax + bx) / 2, elevationFt + h / 2, (az + bz) / 2);
      geos.push(g);
    }
    if (!geos.length) return null;
    const merged = mergeGeometries(geos, false);
    for (const g of geos) { if (g.dispose) g.dispose(); }
    if (!merged) return null;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.name = 'plan-wallsfull-merged';
    mesh.userData = { kind: 'plan-wallsfull', merged: true, segCount: geos.length, needsVerification: true };
    return mesh;
  }
  // Stub THREE / small set: a tagged group of per-seg boxes.
  const grp = new THREE.Group();
  let n = 0;
  for (const seg of valid) {
    const ax = seg.a[0] - bounds.cx, az = seg.a[1] - bounds.cy;
    const bx = seg.b[0] - bounds.cx, bz = seg.b[1] - bounds.cy;
    const len = Math.hypot(bx - ax, bz - az);
    if (!(len > 0.01)) continue;
    const geo = new THREE.BoxGeometry(len, h, 0.25);
    const m = new THREE.Mesh(geo, mat);
    m.position.set((ax + bx) / 2, elevationFt + h / 2, (az + bz) / 2);
    m.rotation.y = -Math.atan2(bz - az, bx - ax);
    grp.add(m); n += 1;
  }
  grp.name = 'plan-wallsfull';
  grp.userData = { kind: 'plan-wallsfull', merged: false, segCount: n, needsVerification: true };
  return n ? grp : null;
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

    // Walls. RECORE: prefer the collinear-merged wall RUNS (envelope + partitions, non-wall ink
    // excluded — a plausible count of REAL walls) over the thousands of fragmented `walls`
    // segments. Each run extrudes as one continuous wall box. Falls back to `walls` only if no
    // runs were computed (older data). The fragmented `walls` set is no longer the headline.
    const wallSource = (Array.isArray(plan.wallRuns) && plan.wallRuns.length) ? plan.wallRuns : plan.walls;
    const usingRuns = (Array.isArray(plan.wallRuns) && plan.wallRuns.length) ? true : false;
    if (includeWalls && wallMat && THREE.BoxGeometry && Array.isArray(wallSource)) {
      const validWalls = wallSource.filter((seg) => seg && Array.isArray(seg.a) && Array.isArray(seg.b));
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

    // HF-W2: recovered partition-inclusive walls (additive recall layer), toggleable.
    let wallsFullCount = 0;
    if (Array.isArray(plan.wallsFull) && plan.wallsFull.length) {
      const wfGroup = new THREE.Group();
      wfGroup.name = 'recovered-walls';
      wfGroup.userData = { kind: 'plan-wallsfull-layer', toggleKey: 'WALLSFULL', needsVerification: true };
      const layer = makeWallsFullLayer(THREE, plan.wallsFull, bounds, elevationFt, wallHeightFt, mergeGeometries);
      if (layer) { wfGroup.add(layer); wallsFullCount = plan.wallsFull.length; }
      wfGroup.visible = false; // off by default — the proven shell shows first; toggle in LAYERS
      group.add(wfGroup);
    }

    // HF-W2: DOORS — leaf + swing arc at each opening, selectable/inspectable.
    let doorCount = 0;
    if (Array.isArray(plan.doors) && plan.doors.length) {
      const dGroup = new THREE.Group();
      dGroup.name = 'doors';
      dGroup.userData = { kind: 'plan-doors-layer', toggleKey: 'DOORS', needsVerification: true };
      for (const door of plan.doors) {
        const m = makeDoor(THREE, door, bounds, elevationFt);
        if (m) { dGroup.add(m); doorCount += 1; }
      }
      group.add(dGroup);
    }

    // HF-W2: OPENINGS — cased-opening / passage markers (gaps with no door).
    let openingCount = 0;
    if (Array.isArray(plan.openings) && plan.openings.length) {
      const oGroup = new THREE.Group();
      oGroup.name = 'openings';
      oGroup.userData = { kind: 'plan-openings-layer', toggleKey: 'DOORS', needsVerification: true };
      for (const op of plan.openings) {
        const m = makeOpening(THREE, op, bounds, elevationFt);
        if (m) { oGroup.add(m); openingCount += 1; }
      }
      group.add(oGroup);
    }

    // HF-W2: FIXTURES / cores — labeled space content, toggleable.
    let fixtureCount = 0;
    if (Array.isArray(plan.fixtures) && plan.fixtures.length) {
      const fGroup = new THREE.Group();
      fGroup.name = 'fixtures';
      fGroup.userData = { kind: 'plan-fixtures-layer', toggleKey: 'FIXTURES', needsVerification: true };
      for (const fx of plan.fixtures) {
        const m = makeFixtureMarker(THREE, fx, bounds, elevationFt);
        if (m) { fGroup.add(m); fixtureCount += 1; }
      }
      fGroup.visible = false; // off by default — toggle in LAYERS
      group.add(fGroup);
    }

    root.add(group);
    levels.push({
      level: lp.level,
      name: lp.name || `Level ${lp.level}`,
      elevationFt,
      group,
      counts: {
        walls: wallCount, rooms: roomCount, stairs: stairCount,
        doors: doorCount, openings: openingCount, fixtures: fixtureCount,
        wallsFull: wallsFullCount,
        // RECORE: the honest primary wall count is the merged wall RUNS (when present).
        wallRuns: (Array.isArray(plan.wallRuns) ? plan.wallRuns.length : 0),
        wallSegmentsRaw: (Array.isArray(plan.walls) ? plan.walls.length : 0),
        wallSource: usingRuns ? 'wall-runs' : 'wall-segments',
      },
      wallRunsMeta: plan.wallRunsMeta || null,
      // HF-W2: honest recall of the rendered recovered-wall set vs the sheet wall-ink.
      recallPct: (plan.wallsFullMeta && Number.isFinite(plan.wallsFullMeta.recallPct))
        ? plan.wallsFullMeta.recallPct : null,
      recallMeasure: (plan.wallsFullMeta && plan.wallsFullMeta.recallMeasure) || null,
      fixtureCounts: plan.fixtureCounts || null,
      doorExtraction: plan.doorExtraction || null,
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
  // HF-W2: toggle a named overlay layer (by group.name) across every level.
  function setLayerVisible(layerName, visible) {
    for (const l of levels) {
      l.group.traverse((o) => {
        if (o && o.name === layerName && o.userData && o.userData.toggleKey !== undefined) o.visible = !!visible;
      });
    }
  }

  // HF-W2: surface the honest extraction completeness on the summary (level with the recall figure).
  const recallLevel = levels.find((l) => Number.isFinite(l.recallPct)) || null;
  const summary = {
    levelCount: levels.length,
    bounds: { widthFt: Math.round(bounds.widthFt * 100) / 100, depthFt: Math.round(bounds.depthFt * 100) / 100 },
    perLevel: levels.map((l) => ({ level: l.level, elevationFt: l.elevationFt, ...l.counts, recallPct: l.recallPct })),
    extractionCompleteness: recallLevel ? {
      wallRecallPct: recallLevel.recallPct,
      recallMeasure: recallLevel.recallMeasure,
      doors: recallLevel.counts.doors, openings: recallLevel.counts.openings,
      // HF-W2b: honest door split — confident = on-wall + real leaf width; suspect = down-ranked.
      confidentDoors: (recallLevel.doorExtraction && Number.isFinite(recallLevel.doorExtraction.confidentDoors))
        ? recallLevel.doorExtraction.confidentDoors : null,
      suspectDoors: (recallLevel.doorExtraction && Number.isFinite(recallLevel.doorExtraction.suspectDoors))
        ? recallLevel.doorExtraction.suspectDoors : null,
      // HF-W2b: building-wall coverage measured in-envelope (drops non-wall sheet furniture).
      inEnvelopeRecallPct: (recallLevel.recallMeasure && Number.isFinite(recallLevel.recallMeasure.inEnvelopeRecallPct))
        ? recallLevel.recallMeasure.inEnvelopeRecallPct : null,
      fixtures: recallLevel.counts.fixtures, fixtureCounts: recallLevel.fixtureCounts,
      recoveredWalls: recallLevel.counts.wallsFull,
      // RECORE: the honest primary structure — collinear-merged wall RUNS (real walls), with the
      // raw fragment count + excluded non-wall ink, so the panel headlines correctness not coverage.
      wallRuns: recallLevel.counts.wallRuns,
      wallSegmentsRaw: recallLevel.counts.wallSegmentsRaw,
      wallSource: recallLevel.counts.wallSource,
      wallRunsMeta: recallLevel.wallRunsMeta,
      doorExtraction: recallLevel.doorExtraction,
      level: recallLevel.level, needsVerification: true,
    } : null,
    needsVerification: true,
    provenance: 'built from extracted LevelPlans — true scale derived from sheet, needs-verification',
  };

  return { root, levels, setActiveLevel, setLevelVisible, setLayerVisible, bounds, summary };
}

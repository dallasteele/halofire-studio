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

const SLAB_COLOR = 0x3a4150; // opaque concrete floor plate (was translucent teal film)
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
    // REGISTRATION (single source of truth) — the texture V axis MUST run the SAME direction as the
    // geometry's plan-Y -> world-Z map (worldZ = planY - cy, monotonically INCREASING). The plane is
    // rotated rotation.x = -PI/2 (textured face up, toward the top-down plan camera). With the default
    // CanvasTexture flipY=true, a -PI/2 plane maps PNG-top (PDF-HIGH-Y) to world -Z and PNG-bottom
    // (PDF-LOW-Y) to world +Z — i.e. PDF-Y DECREASES as world-Z increases, the OPPOSITE of the
    // geometry. That inversion is exactly the observed "3D lands over the UPPER title-block band, not
    // the main lower plan" defect: the extracted footprint (PDF-Y 35.8..117.7, the MAIN plan) was
    // rendered under the WRONG sheet band. flipTextureV:true mirrors V so PNG rows run with +Z, making
    // PDF-Y INCREASE with world-Z — now the geometry's footprint sits over the SAME sheet region it was
    // extracted from. VERIFIED LIVE 2026-06-15 on the 1881 top view: flipV=true registers the 3D over
    // the detailed main floor plan (split-/overlap-zoom evidence in
    // out/building-reconstruction/underlay-registration/); flipV=false placed it over the typical-floor
    // /title-block band. The prior "no-flip" note conflated text-readability with ink-registration; the
    // registration-correct value for THIS plan-Y->world-Z path is flipTextureV:true.
    rotation: { x: -Math.PI / 2, y: 0, z: 0 },
    flipTextureV: true,
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
  // REAL floor slab: an OPAQUE concrete-grey plate whose TOP sits exactly at the level elevation
  // (z=0 on L1), so walls/columns stand ON it and pipes lie ABOVE it — not a translucent film with
  // pipes flush through it. After rotateX(-PI/2) the extruded thickness runs along -Y, so the mesh
  // spans [elev - thickness, elev]; the top face is at elev. (Was opacity 0.32 with top at elev +
  // thickness, which let the network sit visually inside the plate.)
  // Opaque-reading concrete plate, but kept lightly translucent (0.6) so the registered plan ink
  // underneath stays legible in the TOP/registration view (a fully opaque slab occludes the sheet
  // and breaks the overlay check). In iso it still reads as a solid floor, not a translucent film.
  const mat = new THREE.MeshStandardMaterial
    ? new THREE.MeshStandardMaterial({ color: SLAB_COLOR, transparent: true, opacity: 0.6, metalness: 0.0, roughness: 0.98 })
    : new THREE.MeshBasicMaterial({ color: SLAB_COLOR, transparent: true, opacity: 0.6 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = elevationFt;
  mesh.renderOrder = -1; // draw slab first so transparent walls/columns sort above it
  mesh.name = `footprint-slab:elev${elevationFt}`;
  mesh.userData = { kind: 'footprint-slab', needsVerification: true };
  return mesh;
}

const PERIMETER_COLOR = 0x6b7a90; // continuous exterior shell wall — slightly cooler than partitions

/**
 * Build the CONTINUOUS PERIMETER WALL SHELL from a footprint polygon (PLAN feet). Each edge of
 * the closed footprint loop becomes one wall box extruded slab->ceiling, so the building reads as
 * an enclosed shell instead of scattered interior partitions sitting on a bare plate. The extracted
 * `wallRuns` are interior partitions that (on the 1881 set) do NOT trace the building envelope and
 * stop partway across the plan — the envelope must come from the footprint loop itself, the one
 * geometry we KNOW closes. Returned as ONE group of edge walls (selectable as the shell).
 *
 * @param {Array<[number,number]>} footprintFt - closed footprint loop in plan feet.
 * @param {{cx,cy}} bounds - shared world origin (footprint -> world: x-cx, y-cy).
 * @param {number} elevationFt - level slab elevation.
 * @param {number} heightFt - shell height (= ceiling height).
 * @param {number} thicknessFt - exterior wall thickness.
 * @returns {THREE.Group|null}
 */
function makePerimeterShell(THREE, footprintFt, bounds, elevationFt, heightFt, thicknessFt) {
  if (!Array.isArray(footprintFt) || footprintFt.length < 3 || !THREE.BoxGeometry) return null;
  // Drop a trailing duplicate closing vertex so we don't emit a zero-length edge.
  const pts = footprintFt.slice();
  const f = pts[0], l = pts[pts.length - 1];
  if (pts.length > 3 && Array.isArray(f) && Array.isArray(l) && Math.hypot(f[0] - l[0], f[1] - l[1]) < 0.01) pts.pop();
  if (pts.length < 3) return null;
  const mat = THREE.MeshStandardMaterial
    ? new THREE.MeshStandardMaterial({ color: PERIMETER_COLOR, transparent: true, opacity: 0.82, metalness: 0.05, roughness: 0.85 })
    : new THREE.MeshBasicMaterial({ color: PERIMETER_COLOR, transparent: true, opacity: 0.82 });
  const g = new THREE.Group();
  g.name = 'perimeter-shell';
  g.userData = { kind: 'plan-perimeter-shell', toggleKey: 'WALLS', edgeCount: 0, needsVerification: true };
  let n = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    if (!Array.isArray(a) || !Array.isArray(b)) continue;
    const ax = a[0] - bounds.cx, az = a[1] - bounds.cy;
    const bx = b[0] - bounds.cx, bz = b[1] - bounds.cy;
    const len = Math.hypot(bx - ax, bz - az);
    if (!(len > 0.05)) continue;
    // Extend each edge by half-thickness at both ends so adjacent edges overlap at the corner
    // (no gap at the building corners — a continuous shell, not 4 disconnected sticks).
    const lenEx = len + thicknessFt;
    const geo = new THREE.BoxGeometry(lenEx, heightFt, thicknessFt);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set((ax + bx) / 2, elevationFt + heightFt / 2, (az + bz) / 2);
    mesh.rotation.y = -Math.atan2(bz - az, bx - ax);
    mesh.name = 'plan-perimeter-wall';
    mesh.userData = { kind: 'plan-perimeter-wall', lengthFt: Math.round(len * 100) / 100, needsVerification: true };
    g.add(mesh); n += 1;
  }
  g.userData.edgeCount = n;
  return n ? g : null;
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
const WINDOW_COLOR = 0x00c8d4;     // window glazing (mullion bundle) marker — cyan
const FIXTURE_COLOR = 0x4ad6c0;    // fixture / core marker — teal
const WALLSFULL_COLOR = 0xc77dff;  // recovered partition-inclusive walls (recall layer) — violet
const COLUMN_COLOR = 0xd1495b;     // structural column — deep red

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

/** Build a glazing-bar marker for a WINDOW (mullion bundle). A thin cyan sill bar at the opening. */
function makeWindow(THREE, win, bounds, elevationFt) {
  if (!win || !Array.isArray(win.position) || !THREE.BoxGeometry) return null;
  const wft = Math.max(0.5, Number(win.width) || 3);
  const suspect = win.confidence === 'low';
  const geo = new THREE.BoxGeometry(wft, 0.12, 0.12);
  const mat = THREE.MeshStandardMaterial
    ? new THREE.MeshStandardMaterial({ color: WINDOW_COLOR, transparent: true, opacity: suspect ? 0.45 : 0.8, metalness: 0.1, roughness: 0.5 })
    : new THREE.MeshBasicMaterial({ color: WINDOW_COLOR, transparent: true, opacity: suspect ? 0.45 : 0.8 });
  const mesh = new THREE.Mesh(geo, mat);
  if (Number.isFinite(win.axisDeg)) mesh.rotation.y = -win.axisDeg * Math.PI / 180;
  mesh.position.set(win.position[0] - bounds.cx, elevationFt + 0.06, win.position[1] - bounds.cy);
  mesh.name = `plan-window:${wft.toFixed(1)}ft`;
  mesh.userData = { kind: 'plan-window', widthFt: Math.round(wft * 100) / 100, mullionLines: win.mullionLines || null, evidence: win.evidence, confidence: win.confidence, suspect, needsVerification: true };
  return mesh;
}

/** Build a structural COLUMN (square pier extruded to wall height). Selectable/inspectable. */
function makeColumn(THREE, col, bounds, elevationFt, heightFt) {
  if (!col || !Number.isFinite(col.x) || !Number.isFinite(col.y) || !THREE.BoxGeometry) return null;
  const sizeFt = Math.max(0.5, Number(col.sizeFt) || 1.2);
  const h = Math.max(1, Number(heightFt) || 9);
  const geo = new THREE.BoxGeometry(sizeFt, h, sizeFt);
  const mat = THREE.MeshStandardMaterial
    ? new THREE.MeshStandardMaterial({ color: COLUMN_COLOR, transparent: true, opacity: 0.85, metalness: 0.1, roughness: 0.6 })
    : new THREE.MeshBasicMaterial({ color: COLUMN_COLOR, transparent: true, opacity: 0.85 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(col.x - bounds.cx, elevationFt + h / 2, col.y - bounds.cy);
  mesh.name = `plan-column${col.gridLabel ? ':' + col.gridLabel : ''}`;
  mesh.userData = {
    kind: 'plan-column', sizeFt: Math.round(sizeFt * 100) / 100,
    gridLabel: col.gridLabel || null, source: col.source || 'extracted',
    confidence: col.confidence || 'low', needsVerification: true,
  };
  return mesh;
}

/**
 * PURE. Synthesize structural COLUMNS at the architectural grid intersections that fall
 * inside the building footprint, when the extracted plan carries grid datum lines but no
 * first-class column entities. This is a HEURISTIC first pass — a column is most often drawn
 * at a grid-line crossing, so the {xs} x {ys} intersection field is the honest best estimate
 * of column locations from grid data alone. It is NOT a verified column schedule: real
 * drawings omit columns at some intersections (corridors/openings) and add some off-grid. Every
 * synthesized column is flagged confidence:'low', source:'grid-intersection', needsVerification.
 *
 * Inset: intersections within `edgeInsetFt` of the footprint bbox edge are dropped (perimeter
 * grid lines usually mark the wall face, not an interior column). Caller passes the footprint
 * bbox; with no bbox every in-range intersection is kept.
 *
 * @param {{xs:number[], ys:number[], labels?:object}} grid - grid datum lines in FEET.
 * @param {{minX,minY,maxX,maxY}|null} bboxFt - footprint bbox in FEET (optional inset clip).
 * @param {Object} [opts]
 * @returns {{columns:Array<{x,y,sizeFt,gridLabel,source,confidence}>, note:string}}
 */
export function synthesizeColumnsFromGrid(grid, bboxFt = null, opts = {}) {
  const xs = (grid && Array.isArray(grid.xs)) ? grid.xs.filter(Number.isFinite) : [];
  const ys = (grid && Array.isArray(grid.ys)) ? grid.ys.filter(Number.isFinite) : [];
  const note =
    'Columns SYNTHESIZED at architectural grid-line intersections inside the footprint (heuristic ' +
    'first pass: a column is usually drawn at a grid crossing). NOT a verified column schedule — ' +
    'real plans skip some intersections and add off-grid columns. needs-verification.';
  if (xs.length < 2 || ys.length < 2) return { columns: [], note: note + ' (insufficient grid datums)' };
  const inset = Number.isFinite(opts.edgeInsetFt) ? opts.edgeInsetFt : 4;
  const sizeFt = Number.isFinite(opts.sizeFt) ? opts.sizeFt : 1.2;
  const labels = (grid && grid.labels) || {};
  const colLabels = labels.cols || labels.x || null; // optional map / array of column datum labels
  const rowLabels = labels.rows || labels.y || null;
  const inFootprint = (x, y) => {
    if (!bboxFt) return true;
    return x >= bboxFt.minX + inset && x <= bboxFt.maxX - inset &&
           y >= bboxFt.minY + inset && y <= bboxFt.maxY - inset;
  };
  const labelAt = (arr, i) => {
    if (!arr) return null;
    if (Array.isArray(arr)) return arr[i] != null ? String(arr[i]) : null;
    return null;
  };
  const columns = [];
  for (let i = 0; i < xs.length; i++) {
    for (let j = 0; j < ys.length; j++) {
      const x = Math.round(xs[i] * 100) / 100, y = Math.round(ys[j] * 100) / 100;
      if (!inFootprint(x, y)) continue;
      const cl = labelAt(colLabels, i), rl = labelAt(rowLabels, j);
      const gridLabel = (cl && rl) ? `${cl}-${rl}` : (cl || rl || null);
      columns.push({ x, y, sizeFt, gridLabel, source: 'grid-intersection', confidence: 'low' });
    }
  }
  return { columns, note };
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
// PURE. True when a footprint loop is just an axis-aligned bbox RECTANGLE (a fallback outline, not
// a real building footprint). Used to suppress the meaningless rectangular perimeter slab.
function isAxisAlignedRect(poly) {
  if (!Array.isArray(poly)) return false;
  const closed = poly.length >= 2 && poly[0][0] === poly[poly.length - 1][0] && poly[0][1] === poly[poly.length - 1][1];
  const pts = closed ? poly.slice(0, -1) : poly;
  if (pts.length !== 4) return false;
  const xs = new Set(pts.map((q) => Math.round(q[0] * 100)));
  const ys = new Set(pts.map((q) => Math.round(q[1] * 100)));
  return xs.size === 2 && ys.size === 2;
}

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

  // ASSEMBLY-COHERENCE (2026-06-15): the per-region extractors (column markers, room flood-fill,
  // fixture-symbol clusters) pick up near-square / enclosed glyphs from OTHER parts of the SHEET
  // (key plans, detail callouts, schedule tables, title block, the "22" logo) that sit OUTSIDE the
  // building footprint. Rendered as-is they scatter columns/rooms/fixtures off the slab — the
  // "floating pieces / hovering at the wrong place" the user sees. We clip every extracted entity
  // to the level's footprint bbox (+ margin for perimeter members on the wall face). Walls/windows
  // /openings already test clean (inside the envelope) so the clip is a no-op for them. The dropped
  // counts are reported honestly on each level's columnSource / counts. clipPtFt(point, bbox) is the
  // shared gate; an entity is kept iff its representative point(s) fall within the (margined) bbox.
  const clipMarginFt = Number.isFinite(opts.footprintClipMarginFt) ? opts.footprintClipMarginFt : 6;
  const ptInBbox = (x, y, fb) => fb && x >= fb.minX - clipMarginFt && x <= fb.maxX + clipMarginFt &&
    y >= fb.minY - clipMarginFt && y <= fb.maxY + clipMarginFt;

  const root = new THREE.Group();
  root.name = 'building-from-plan';
  const sourceBoundGeometryVerified = levelPlans.length > 0
    && levelPlans.every((entry) => entry?.plan?.sourceBoundGeometryStatus === 'passed'
    && entry?.plan?.sourceBinding?.sheetId && entry?.plan?.sourceBoundFootprintEvidenceReceiptSha256);
  const acceptedSystemModel = levelPlans.every((entry) => (
    entry && entry.plan && entry.plan.geometryGrounded === true
    && entry.plan.sprinklerEvidence && entry.plan.sprinklerEvidence.systemVerified === true
    && entry.plan.sprinklerEvidence.pipeSystemVerified === true
  ));
  root.userData = {
    kind: 'building-from-plan',
    needsVerification: !acceptedSystemModel,
    systemVerified: acceptedSystemModel,
    sourceBoundGeometryVerified,
    geometryClaimStatus: sourceBoundGeometryVerified ? 'per-level-building-geometry-verified-not-sprinkler-compliance' : 'building-geometry-needs-verification',
  };

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
      sourceBinding: plan.sourceBinding || lp.sourceBinding || null,
      sourceBoundGeometryStatus: plan.sourceBoundGeometryStatus || 'unverified',
      sourceBoundFootprintEvidenceReceiptSha256: plan.sourceBoundFootprintEvidenceReceiptSha256 || null,
      footprintAreaSqft: Number.isFinite(Number(plan.footprintAreaSqft)) ? Number(plan.footprintAreaSqft) : null,
      needsVerification: !acceptedSystemModel,
      systemVerified: acceptedSystemModel,
    };

    let wallCount = 0, roomCount = 0, stairCount = 0;
    let sprinklerHeadCount = 0, sprinklerPipeSegmentCount = 0;

    // Footprint slab — but NOT when footprintFt is just an axis-aligned bbox RECTANGLE: that is a
    // fallback outline (not a real building footprint), and drawing it places a meaningless
    // rectangular perimeter the walls don't follow. Skip it; the real walls define the building.
    if (Array.isArray(plan.footprintFt) && plan.footprintFt.length >= 3 && !isAxisAlignedRect(plan.footprintFt)) {
      const slab = makeFootprintSlab(THREE, plan.footprintFt, bounds, elevationFt, slabThicknessFt);
      group.add(slab);
    }

    // CONTINUOUS PERIMETER WALL SHELL — extrude every edge of the closed footprint loop slab->ceiling
    // so the building reads as an ENCLOSED shell. The extracted `wallRuns`/`walls` are interior
    // partitions that do NOT trace the envelope (on the 1881 L1 set they stop ~X210 of a 360ft-wide
    // plan); the footprint loop is the one geometry we know closes, so the exterior shell comes from
    // it. Toggleable with WALLS. needs-verification (footprint is plan-derived, not a stamped survey).
    let perimeterEdges = 0;
    if (includeWalls && Array.isArray(plan.footprintFt) && plan.footprintFt.length >= 3) {
      const shell = makePerimeterShell(THREE, plan.footprintFt, bounds, elevationFt, wallHeightFt, Math.max(wallThicknessFt, 0.66));
      if (shell) { group.add(shell); perimeterEdges = (shell.userData && shell.userData.edgeCount) || 0; }
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

    // Rooms as labeled tiles. Prefer the TRUE traced room boundaries (marching-squares polygons +
    // shoelace areas + wall-coverage closure) over the legacy bbox-rectangle flood-fill rooms.
    const roomSrc = (Array.isArray(plan.roomBoundaries) && plan.roomBoundaries.length) ? plan.roomBoundaries
      : (Array.isArray(plan.rooms) ? plan.rooms : []);
    let roomAreaSqft = 0, roomsClipped = 0;
    if (includeRooms && roomSrc.length) {
      const fbR = plan.footprintBboxFt;
      for (const room of roomSrc) {
        if (!room || !Array.isArray(room.poly) || room.poly.length < 3) continue;
        // ASSEMBLY-COHERENCE: drop rooms whose CENTROID sits outside the footprint — those are
        // enclosed voids traced in detail blocks / key plans / schedule cells on the same sheet,
        // not real building spaces. The footprint rooms (the actual plan) are kept.
        if (fbR && Number.isFinite(fbR.minX)) {
          const c = polyCentroid(room.poly);
          if (!ptInBbox(c[0], c[1], fbR)) { roomsClipped += 1; continue; }
        }
        const tile = makeRoomTile(THREE, room, bounds, elevationFt);
        if (tile) { group.add(tile); roomCount += 1; roomAreaSqft += Number(room.areaSqft) || 0; }
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

    // HF-W2: WINDOWS — glazing-bar markers (mullion bundles with no swing arc), toggleable with doors.
    let windowCount = 0;
    if (Array.isArray(plan.windows) && plan.windows.length) {
      const wGroup = new THREE.Group();
      wGroup.name = 'windows';
      wGroup.userData = { kind: 'plan-windows-layer', toggleKey: 'DOORS', needsVerification: true };
      for (const win of plan.windows) {
        const m = makeWindow(THREE, win, bounds, elevationFt);
        if (m) { wGroup.add(m); windowCount += 1; }
      }
      group.add(wGroup);
    }

    // HF-W2: FIXTURES / cores — geometric symbol clusters (fixtureSymbols) + label/room-kind cores
    // (fixtures), toggleable. Symbols are typed plumbing only inside a restroom w/ a footprint match,
    // else 'equipment' (honest: an overall plan carries workstation/casework glyphs, not plumbing).
    let fixtureCount = 0, fixtureSymbolCount = 0, fixturePlumbingCount = 0;
    const fixtureSrc = []
      .concat(Array.isArray(plan.fixtureSymbols) ? plan.fixtureSymbols : [])
      .concat(Array.isArray(plan.fixtures) ? plan.fixtures : []);
    if (fixtureSrc.length) {
      const fGroup = new THREE.Group();
      fGroup.name = 'fixtures';
      fGroup.userData = { kind: 'plan-fixtures-layer', toggleKey: 'FIXTURES', needsVerification: true };
      const fbF = plan.footprintBboxFt;
      for (const fx of fixtureSrc) {
        // ASSEMBLY-COHERENCE: drop fixture/equipment symbols outside the footprint (schedule-table
        // and legend glyphs that the symbol-cluster pass picks up).
        if (fbF && Number.isFinite(fbF.minX) && Array.isArray(fx.position) && !ptInBbox(fx.position[0], fx.position[1], fbF)) continue;
        const m = makeFixtureMarker(THREE, fx, bounds, elevationFt);
        if (m) {
          fGroup.add(m); fixtureCount += 1;
          if (fx.source && /symbol/.test(String(fx.source))) fixtureSymbolCount += 1;
          if (fx.fixtureKind && !['equipment', 'mech', 'elec', 'stair', 'elevator', 'trash'].includes(fx.fixtureKind)) fixturePlumbingCount += 1;
        }
      }
      fGroup.visible = false; // off by default — toggle in LAYERS
      group.add(fGroup);
    }

    // PHASE 4 — COLUMNS. Prefer first-class extracted columns (plan.columns from
    // structure-from-plan's detectColumns); fall back to SYNTHESIZING them at grid-line
    // intersections inside the footprint when the plan carries grid datums but no column
    // entities (the common case for the 1881 architectural set). Heuristic + flagged.
    let columnCount = 0, columnSource = null;
    let planColumns = Array.isArray(plan.columns) ? plan.columns.filter((c) => c && Number.isFinite(c.x) && Number.isFinite(c.y)) : [];
    if (!planColumns.length && plan.grid && Array.isArray(plan.grid.xs) && Array.isArray(plan.grid.ys)) {
      const synth = synthesizeColumnsFromGrid(plan.grid, plan.footprintBboxFt || null, {});
      planColumns = synth.columns;
      columnSource = planColumns.length ? 'grid-intersection(synth)' : null;
    } else if (planColumns.length) {
      // Prefer the specific extraction provenance the data carries (e.g. 'marker-extraction' —
      // real column marker boxes), falling back to the generic 'extracted' label.
      columnSource = (typeof plan.columnSource === 'string' && plan.columnSource) ? plan.columnSource : 'extracted';
      // ASSEMBLY-COHERENCE FIX (2026-06-15): marker-extraction picks up near-square glyphs from
      // OTHER regions of the sheet (key plans, detail callouts, schedule tables, the title block,
      // logo blocks) that sit OUTSIDE the building footprint — on the 1881 L1 set, 56 of 131
      // columns landed at plan-Y up to 225 ft while the footprint is Y 36..118. Those render as
      // disconnected red bars floating off the slab. Clip extracted columns to the footprint bbox
      // (shared ptInBbox gate) so every emitted column stands ON the floor plate. Honest count.
      const fb = plan.footprintBboxFt;
      if (fb && Number.isFinite(fb.minX) && Number.isFinite(fb.maxX) && Number.isFinite(fb.minY) && Number.isFinite(fb.maxY)) {
        const before = planColumns.length;
        planColumns = planColumns.filter((c) => ptInBbox(c.x, c.y, fb));
        const dropped = before - planColumns.length;
        if (dropped > 0) columnSource += `(footprint-clipped: ${dropped} off-plate of ${before} dropped)`;
      }
    }
    if (planColumns.length && THREE.BoxGeometry) {
      const cGroup = new THREE.Group();
      cGroup.name = 'columns';
      cGroup.userData = { kind: 'plan-columns-layer', toggleKey: 'COLUMNS', source: columnSource, needsVerification: true };
      for (const col of planColumns) {
        const m = makeColumn(THREE, col, bounds, elevationFt, wallHeightFt);
        if (m) { cGroup.add(m); columnCount += 1; }
      }
      group.add(cGroup);
    }

    // Accepted N3 heads share the grounded plan's coordinate frame and page
    // evidence. Provisional or unverified plans can never enter this branch.
    if (plan.sprinklerEvidence && plan.sprinklerEvidence.systemVerified === true
        && Array.isArray(plan.heads) && plan.heads.length && THREE.BoxGeometry) {
      const hGroup = new THREE.Group();
      hGroup.name = 'accepted-sprinkler-heads';
      hGroup.userData = {
        kind: 'accepted-sprinkler-heads', toggleKey: 'HEADS',
        systemVerified: true, needsVerification: false,
        evidence: plan.sprinklerEvidence,
      };
      const headMat = THREE.MeshStandardMaterial
        ? new THREE.MeshStandardMaterial({ color: 0xff3b30, metalness: 0.15, roughness: 0.45 })
        : new THREE.MeshBasicMaterial({ color: 0xff3b30 });
      for (const head of plan.heads) {
        const x = Number(head && head.x), y = Number(head && head.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        const marker = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.22, 0.55), headMat);
        marker.position.set(x - bounds.cx, elevationFt + wallHeightFt - 0.15, y - bounds.cy);
        marker.name = 'accepted-sprinkler-head';
        marker.userData = {
          kind: 'head', systemVerified: true, needsVerification: false,
          roomId: head.roomId || null,
        };
        hGroup.add(marker);
        sprinklerHeadCount += 1;
      }
      group.add(hGroup);
    }

    // The same immutable route-set digest that released accepted heads also
    // releases the connected wall-aware pipe graph. Pipe is mounted just above
    // the heads at system height; stale/unverified route bytes render nothing.
    if (plan.sprinklerEvidence && plan.sprinklerEvidence.pipeSystemVerified === true
        && Array.isArray(plan.pipeSegments) && plan.pipeSegments.length
        && THREE.BoxGeometry) {
      const pGroup = new THREE.Group();
      pGroup.name = 'accepted-sprinkler-pipe';
      pGroup.userData = {
        kind: 'accepted-sprinkler-pipe', toggleKey: 'PIPE',
        systemVerified: true, needsVerification: false,
        routeSetDigest: plan.sprinklerEvidence.routeSetDigest,
        evidence: plan.sprinklerEvidence,
      };
      const mainMat = THREE.MeshStandardMaterial
        ? new THREE.MeshStandardMaterial({ color: 0xe53935, metalness: 0.35, roughness: 0.4 })
        : new THREE.MeshBasicMaterial({ color: 0xe53935 });
      const branchMat = THREE.MeshStandardMaterial
        ? new THREE.MeshStandardMaterial({ color: 0x3b82f6, metalness: 0.3, roughness: 0.45 })
        : new THREE.MeshBasicMaterial({ color: 0x3b82f6 });
      for (const segment of plan.pipeSegments) {
        const x1 = Number(segment && segment.x1), y1 = Number(segment && segment.y1);
        const x2 = Number(segment && segment.x2), y2 = Number(segment && segment.y2);
        const sizeIn = Number(segment && segment.size_in);
        if (![x1, y1, x2, y2, sizeIn].every(Number.isFinite) || !(sizeIn > 0)) continue;
        const lengthFt = Math.hypot(x2 - x1, y2 - y1);
        if (!(lengthFt > 0.001)) continue;
        const diameterFt = Math.max(sizeIn / 12, 0.08);
        const marker = new THREE.Mesh(
          new THREE.BoxGeometry(lengthFt, diameterFt, diameterFt),
          segment.kind === 'main' || segment.kind === 'riser' ? mainMat : branchMat,
        );
        marker.position.set(
          (x1 + x2) / 2 - bounds.cx,
          elevationFt + wallHeightFt - 0.35,
          (y1 + y2) / 2 - bounds.cy,
        );
        marker.rotation.y = -Math.atan2(y2 - y1, x2 - x1);
        marker.name = 'accepted-pipe-segment';
        marker.userData = {
          kind: 'pipe', role: segment.kind, sizeIn,
          segmentId: segment.id || null,
          systemVerified: true, needsVerification: false,
        };
        pGroup.add(marker);
        sprinklerPipeSegmentCount += 1;
      }
      group.add(pGroup);
    }

    root.add(group);
    levels.push({
      level: lp.level,
      name: lp.name || `Level ${lp.level}`,
      elevationFt,
      group,
      // PHASE 4: the resolved column entities (extracted or grid-synthesized) for the intake hook.
      columns: planColumns,
      columnSource,
      counts: {
        walls: wallCount, perimeterEdges, rooms: roomCount, stairs: stairCount,
        sprinklerHeads: sprinklerHeadCount,
        sprinklerPipeSegments: sprinklerPipeSegmentCount,
        doors: doorCount, windows: windowCount, openings: openingCount, fixtures: fixtureCount,
        // FIXTURES + ROOMS chunk: honest splits + measured room area.
        fixtureSymbols: fixtureSymbolCount, fixturePlumbing: fixturePlumbingCount,
        roomAreaSqft: Math.round(roomAreaSqft),
        roomSource: (Array.isArray(plan.roomBoundaries) && plan.roomBoundaries.length) ? 'boundary-trace' : (roomCount ? 'bbox-floodfill' : 'none'),
        roomMeanCoverage: (plan.roomBoundaryMeta && Number.isFinite(plan.roomBoundaryMeta.meanWallCoverage)) ? plan.roomBoundaryMeta.meanWallCoverage : null,
        columns: columnCount, columnSource,
        roomsClippedOffFootprint: roomsClipped,
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
    sourceBoundGeometry: {
      verified: sourceBoundGeometryVerified,
      levelCount: levels.length,
      levels: levels.map((entry) => ({
        level: entry.level, elevationFt: entry.elevationFt,
        sheetId: entry.group.userData.sourceBinding?.sheetId || null,
        renderedPageSha256: entry.group.userData.sourceBinding?.renderedPageSha256 || null,
        footprintAreaSqft: entry.group.userData.footprintAreaSqft,
        status: entry.group.userData.sourceBoundGeometryStatus,
      })),
      claimStatus: 'per-level-building-geometry-only-not-sprinkler-code-compliance',
    },
    extractionCompleteness: recallLevel ? {
      wallRecallPct: recallLevel.recallPct,
      recallMeasure: recallLevel.recallMeasure,
      doors: recallLevel.counts.doors, windows: recallLevel.counts.windows, openings: recallLevel.counts.openings,
      // HF-W2b: honest door split — confident = on-wall + real leaf width; suspect = down-ranked.
      confidentDoors: (recallLevel.doorExtraction && Number.isFinite(recallLevel.doorExtraction.confidentDoors))
        ? recallLevel.doorExtraction.confidentDoors : null,
      suspectDoors: (recallLevel.doorExtraction && Number.isFinite(recallLevel.doorExtraction.suspectDoors))
        ? recallLevel.doorExtraction.suspectDoors : null,
      // HF-W2c: honest window split — confident = >=4 mullion lines w/ real band; suspect = down-ranked.
      confidentWindows: (recallLevel.doorExtraction && Number.isFinite(recallLevel.doorExtraction.windowsConfident))
        ? recallLevel.doorExtraction.windowsConfident : null,
      suspectWindows: (recallLevel.doorExtraction && Number.isFinite(recallLevel.doorExtraction.windowsSuspect))
        ? recallLevel.doorExtraction.windowsSuspect : null,
      // HF-W2b: building-wall coverage measured in-envelope (drops non-wall sheet furniture).
      inEnvelopeRecallPct: (recallLevel.recallMeasure && Number.isFinite(recallLevel.recallMeasure.inEnvelopeRecallPct))
        ? recallLevel.recallMeasure.inEnvelopeRecallPct : null,
      fixtures: recallLevel.counts.fixtures, fixtureCounts: recallLevel.fixtureCounts,
      // FIXTURES + ROOMS chunk: geometric fixture-symbol split + traced-room metrics (honest signals).
      fixtureSymbols: recallLevel.counts.fixtureSymbols, fixturePlumbing: recallLevel.counts.fixturePlumbing,
      rooms: recallLevel.counts.rooms, roomSource: recallLevel.counts.roomSource,
      roomAreaSqft: recallLevel.counts.roomAreaSqft, roomMeanCoverage: recallLevel.counts.roomMeanCoverage,
      columns: recallLevel.counts.columns, columnSource: recallLevel.counts.columnSource,
      // PHASE 4 — honest column split (marker-extraction: medium = real-sized marker box on the
      // 2-D grid; low = on-grid size outlier). Grid-intersection synth levels are all 'low'.
      confidentColumns: Array.isArray(recallLevel.columns)
        ? recallLevel.columns.filter((c) => c && (c.confidence === 'medium' || c.confidence === 'high')).length : null,
      suspectColumns: Array.isArray(recallLevel.columns)
        ? recallLevel.columns.filter((c) => c && (c.confidence === 'low' || c.confidence === 'suspect')).length : null,
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
    needsVerification: !acceptedSystemModel,
    systemVerified: acceptedSystemModel,
    provenance: acceptedSystemModel
      ? 'built from system-accepted vector LevelPlans with independently recomputed and adversarially mutation-tested N3 head and connected-pipe layouts'
      : 'built from extracted LevelPlans — true scale derived from sheet, needs-verification',
  };

  return { root, levels, setActiveLevel, setLevelVisible, setLayerVisible, bounds, summary };
}

/**
 * Stream B — multi-level building scaffold driven by the REAL plan manifest.
 *
 * Standalone engine module (not yet wired into autosprink.html — Phase 2).
 * Given a plan manifest (src/data/plan-manifest.js), builds one THREE.Group
 * per level: floor-slab outline + per-level PDF underlays + a level/discipline
 * visibility switcher API. TRUE SCALE: 1 world unit = 1 ft.
 *
 * Wall extrusion is BEST-EFFORT and dependency-injected: callers may pass
 * wall segments (e.g. from the T28 pdf-floorplan extractor or the
 * apps/studio pdf-building brick) into addWallSolids(); everything produced
 * is flagged userData.needsVerification = true. Nothing here clears any claim
 * gate and nothing is AHJ/PE/manufacturer-exact or AutoSprink-parity.
 */

import { computeUnderlayTransform, createUnderlayMesh, renderSheetToCanvas } from './pdf-underlay.js';

const SLAB_COLOR = 0x2dd4bf; // teal outline, matches studio accentwork
const WALL_COLOR = 0x8b9bb4;

/** Pure: rectangle outline points (closed loop) for a footprint at y=0. */
export function slabOutlinePoints(widthFt, depthFt) {
  const w = Number(widthFt), d = Number(depthFt);
  if (!(w > 0) || !(d > 0)) throw new Error('slabOutlinePoints: footprint must be positive');
  const hw = w / 2, hd = d / 2;
  return [
    [-hw, 0, -hd], [hw, 0, -hd], [hw, 0, hd], [-hw, 0, hd], [-hw, 0, -hd],
  ];
}

function makeSlabOutline(THREE, widthFt, depthFt, elevationFt) {
  const pts = slabOutlinePoints(widthFt, depthFt).map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: SLAB_COLOR, transparent: true, opacity: 0.85 }));
  line.position.y = elevationFt;
  line.name = `slab-outline:elev${elevationFt}`;
  line.userData = { kind: 'slab-outline', needsVerification: true };
  return line;
}

/**
 * Build the level scaffold.
 *
 * opts:
 *   pdfjsLib  — optional; when provided underlays are rendered (async).
 *   disciplines — which sheet disciplines to load as underlays (default ['arch']).
 *   targetPx  — render resolution per sheet (longest edge).
 *   underlayOpacity — default 0.95.
 *
 * Returns { root, levels, setActiveLevel, setLevelVisible, setDisciplineVisible, loadUnderlays }.
 * Underlay loading is explicit (await api.loadUnderlays()) so callers control
 * network/render cost; the scaffold itself is synchronous and deterministic.
 */
export function buildBuildingLevels(THREE, manifest, opts = {}) {
  if (!THREE) throw new Error('buildBuildingLevels: THREE namespace is required');
  if (!manifest || !Array.isArray(manifest.levels) || manifest.levels.length === 0) {
    throw new Error('buildBuildingLevels: manifest with levels is required (no real plans -> no scaffold; never fabricate)');
  }
  const {
    pdfjsLib = null,
    disciplines = ['arch'],
    targetPx = 3000,
    underlayOpacity = 0.95,
  } = opts;

  const footprint = manifest.footprint || {};
  const widthFt = Number(footprint.widthFt);
  const depthFt = Number(footprint.depthFt);
  if (!(widthFt > 0) || !(depthFt > 0)) {
    throw new Error('buildBuildingLevels: manifest.footprint {widthFt, depthFt} is required');
  }

  const root = new THREE.Group();
  root.name = `building-levels:${manifest.bidId || manifest.project}`;
  root.userData = { kind: 'building-levels', project: manifest.project, needsVerification: true };

  const levels = manifest.levels.map((lvl) => {
    const group = new THREE.Group();
    group.name = `level:${lvl.level}`;
    group.userData = {
      kind: 'building-level',
      level: lvl.level,
      elevationFt: lvl.elevationFt,
      elevationSource: lvl.elevationSource,
      needsVerification: true,
    };
    group.add(makeSlabOutline(THREE, widthFt, depthFt, lvl.elevationFt));
    root.add(group);
    return {
      level: lvl.level,
      name: lvl.name,
      elevationFt: lvl.elevationFt,
      sheets: lvl.sheets,
      group,
      underlays: [],
      walls: [],
    };
  });

  function levelEntry(n) {
    return levels.find((l) => l.level === Number(n)) || null;
  }

  /** Show one level only ('all' restores everything). */
  function setActiveLevel(levelOrAll) {
    for (const l of levels) {
      l.group.visible = levelOrAll === 'all' || l.level === Number(levelOrAll);
    }
  }

  function setLevelVisible(level, visible) {
    const l = levelEntry(level);
    if (l) l.group.visible = !!visible;
  }

  /** Toggle all underlays of one discipline across levels. */
  function setDisciplineVisible(discipline, visible) {
    for (const l of levels) {
      for (const u of l.underlays) {
        if (u.userData && u.userData.sheet && u.userData.sheet.discipline === discipline) {
          u.visible = !!visible;
        }
      }
    }
  }

  /**
   * Render + attach PDF underlays for the chosen disciplines on every level.
   * Sequential on purpose: these are big real bid sheets; avoid spawning many
   * pdfjs workers at once. Failures are collected, never thrown mid-batch.
   */
  async function loadUnderlays({ onSheet = null } = {}) {
    if (!pdfjsLib) throw new Error('loadUnderlays: pdfjsLib was not provided to buildBuildingLevels');
    const failures = [];
    for (const l of levels) {
      for (const s of l.sheets) {
        if (!disciplines.includes(s.discipline)) continue;
        try {
          const rendered = await renderSheetToCanvas(pdfjsLib, { url: s.url, page: s.page, targetPx });
          const transform = computeUnderlayTransform({
            pageWidthPt: rendered.widthPt,
            pageHeightPt: rendered.heightPt,
            targetWidthFt: widthFt,
            targetDepthFt: depthFt,
            elevationFt: l.elevationFt,
          });
          const mesh = createUnderlayMesh(THREE, {
            canvas: rendered.canvas,
            transform,
            opacity: underlayOpacity,
            name: `underlay:${s.sheet}:p${s.page}`,
            sheetMeta: s,
          });
          l.group.add(mesh);
          l.underlays.push(mesh);
          if (onSheet) onSheet({ level: l.level, sheet: s, mesh });
        } catch (err) {
          failures.push({ level: l.level, sheet: s.sheet, file: s.file, page: s.page, error: String(err && err.message ? err.message : err) });
        }
      }
    }
    return { loaded: levels.reduce((n, l) => n + l.underlays.length, 0), failures };
  }

  /**
   * Best-effort wall extrusion for one level from extracted 2D segments
   * (e.g. T28 pdf-floorplan output). segments: [{a:[x,z], b:[x,z], thicknessFt?, heightFt?}]
   * in FEET in the level's plan space (origin = footprint center). Everything
   * is flagged needs-verification; this is massing, not a verified model.
   */
  function addWallSolids(level, segments, { defaultHeightFt = 9, defaultThicknessFt = 0.5 } = {}) {
    const l = levelEntry(level);
    if (!l || !Array.isArray(segments)) return [];
    const meshes = [];
    const mat = new THREE.MeshStandardMaterial
      ? new THREE.MeshStandardMaterial({ color: WALL_COLOR, transparent: true, opacity: 0.45, metalness: 0, roughness: 0.9 })
      : new THREE.MeshBasicMaterial({ color: WALL_COLOR, transparent: true, opacity: 0.45 });
    for (const seg of segments) {
      const ax = Number(seg.a && seg.a[0]), az = Number(seg.a && seg.a[1]);
      const bx = Number(seg.b && seg.b[0]), bz = Number(seg.b && seg.b[1]);
      if (![ax, az, bx, bz].every(Number.isFinite)) continue;
      const len = Math.hypot(bx - ax, bz - az);
      if (!(len > 0.01)) continue;
      const h = Number(seg.heightFt) > 0 ? Number(seg.heightFt) : defaultHeightFt;
      const t = Number(seg.thicknessFt) > 0 ? Number(seg.thicknessFt) : defaultThicknessFt;
      const geo = new THREE.BoxGeometry(len, h, t);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set((ax + bx) / 2, l.elevationFt + h / 2, (az + bz) / 2);
      mesh.rotation.y = -Math.atan2(bz - az, bx - ax);
      mesh.name = `wall-extrusion:L${l.level}`;
      mesh.userData = { kind: 'wall-extrusion-best-effort', needsVerification: true, level: l.level };
      l.group.add(mesh);
      l.walls.push(mesh);
      meshes.push(mesh);
    }
    return meshes;
  }

  return { root, levels, setActiveLevel, setLevelVisible, setDisciplineVisible, loadUnderlays, addWallSolids };
}

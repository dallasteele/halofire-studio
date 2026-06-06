// T47 — BUILDING vector-PDF-first lane R3F scene.
//
// Given a footprint OUTLINE (polygon in feet) + a wall heightFt, render a floor
// slab plus perimeter walls extruded along the outline edges. Units: 1 ft == 1
// scene unit (so feet map directly to the drei <Grid>). The footprint is recentered
// on the origin so the building-scaled camera (layoutCam pattern) frames it.
//
// The floor slab is a THREE.Shape filled from the outline (so L-shaped / notched
// footprints fill correctly), laid flat in the XZ plane. Walls are thin boxes
// placed along each outline edge.
//
// HONESTY: the footprint is a BEST-EFFORT vector-geometry extraction; the
// PDF-point->feet scale is operator-supplied. This is NOT AHJ / PE-sealed /
// code-compliant / for construction (the disclaimer is surfaced in BuildingControls).

import { useMemo, type ReactElement } from 'react';
import { Grid, OrbitControls } from '@react-three/drei';
import { Shape, ShapeGeometry } from 'three';
import type { ViewMode } from './lib/view-mode';
import { colors } from './lib/tokens';

export interface BuildingSceneProps {
  /** Footprint outline polygon, points [x,y] in feet (plan coordinates). */
  outline: Array<[number, number]>;
  /** Wall height in feet. */
  heightFt: number;
  viewMode: ViewMode;
}

/** Wall thickness in feet (a thin visual run, not a real assembly dimension). */
const WALL_THICKNESS_FT = 0.5;

/** Compute the centroid-of-bbox offset so the footprint sits on the origin. */
function centerOffset(outline: Array<[number, number]>): { cx: number; cy: number } {
  if (!outline.length) return { cx: 0, cy: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of outline) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

export function BuildingScene({
  outline,
  heightFt,
  viewMode,
}: BuildingSceneProps): ReactElement {
  const { cx, cy } = useMemo(() => centerOffset(outline), [outline]);

  // Recenter outline points to the origin. Plan y maps to scene -z (so the plan
  // reads "up" as -z, consistent with the layout scene's top-down plan camera).
  const centered = useMemo(
    () => outline.map(([x, y]) => [x - cx, y - cy] as [number, number]),
    [outline, cx, cy],
  );

  // Floor slab: a filled THREE.Shape from the (centered) outline, laid flat in XZ.
  const floorGeometry = useMemo(() => {
    if (centered.length < 3) return null;
    const shape = new Shape();
    shape.moveTo(centered[0][0], centered[0][1]);
    for (let i = 1; i < centered.length; i++) {
      shape.lineTo(centered[i][0], centered[i][1]);
    }
    shape.closePath();
    const geo = new ShapeGeometry(shape);
    // ShapeGeometry is in the XY plane; rotate it flat into XZ (rot -90deg about X).
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, [centered]);

  // Perimeter wall segments: one box per outline edge.
  const walls = useMemo(() => {
    const out: Array<{
      cx: number;
      cz: number;
      len: number;
      yaw: number;
      key: string;
    }> = [];
    const n = centered.length;
    if (n < 2) return out;
    for (let i = 0; i < n; i++) {
      const [x1, y1] = centered[i];
      const [x2, y2] = centered[(i + 1) % n];
      // Plan (x,y) -> scene (x, z) directly (floor is XZ).
      const dx = x2 - x1;
      const dz = y2 - y1;
      const len = Math.hypot(dx, dz);
      if (len <= 1e-6) continue;
      out.push({
        cx: (x1 + x2) / 2,
        cz: (y1 + y2) / 2,
        len: len + WALL_THICKNESS_FT, // overlap corners
        yaw: Math.atan2(dz, dx),
        key: `${i}`,
      });
    }
    return out;
  }, [centered]);

  const wallHeight = heightFt > 0 ? heightFt : 9;

  return (
    <>
      <ambientLight intensity={0.9} />
      <directionalLight position={[20, 40, 25]} intensity={1.35} castShadow />
      <hemisphereLight args={['#cdd6e0', '#0e1318', 0.45]} />

      {/* Building footprint floor slab (filled outline). */}
      {floorGeometry ? (
        <mesh geometry={floorGeometry} position={[0, -0.05, 0]} receiveShadow>
          <meshStandardMaterial color="#33414f" roughness={0.92} metalness={0} side={2} />
        </mesh>
      ) : null}

      {/* Perimeter walls extruded along each outline edge. */}
      {walls.map((w) => (
        <mesh
          key={w.key}
          position={[w.cx, wallHeight / 2, w.cz]}
          rotation={[0, -w.yaw, 0]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[w.len, wallHeight, WALL_THICKNESS_FT]} />
          <meshStandardMaterial color="#7d8a9a" roughness={0.85} metalness={0.08} />
        </mesh>
      ))}

      <Grid
        args={[400, 400]}
        cellSize={1}
        cellColor="#384150"
        sectionSize={10}
        sectionColor="#4d5a6b"
        position={[0, -0.1, 0]}
        infiniteGrid={false}
      />

      <color attach="background" args={[colors.bgInset]} />

      {viewMode === 'plan' ? (
        <OrbitControls
          makeDefault
          target={[0, 0, 0]}
          minPolarAngle={0}
          maxPolarAngle={Math.PI / 12}
        />
      ) : (
        <OrbitControls makeDefault target={[0, 0, 0]} />
      )}
    </>
  );
}

// R3F sprinkler-layout scene: renders a rectangular building footprint (floor +
// thin perimeter walls), sprinkler heads on the computed best-effort grid, and
// the branch / cross-main pipe runs as thin cylinders.
//
// The pendent head STL is loaded ONCE imperatively (STLLoader.load + state, like
// PartViewer — no useLoader/Suspense), normalized, and reused for every head
// instance via drei <Instances>/<Instance>, with heads pointing DOWN.
//
// Units: 1 foot == 1 scene unit (so feet map directly to drei <Grid>). The grid
// is centered on the origin, matching layoutHeads / branchLines output.
//
// HONESTY: heads are source="generated" visual references — NOT manufacturer-
// exact and NOT a hydraulic/AHJ/PE design. The layout itself is a coarse spacing
// heuristic only (see LAYOUT_DISCLAIMER, surfaced in LayoutControls).

import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Grid, Instance, Instances, OrbitControls } from '@react-three/drei';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { Box3, Vector3, type BufferGeometry } from 'three';
import {
  branchLines,
  layoutHeads,
  type HazardClass,
  type LineSegment,
} from './lib/layout';
import type { ViewMode } from './lib/view-mode';
import { colors } from './lib/tokens';

/** Public URL of the pendent-head STL (served from public/parts). */
const HEAD_STL_URL = '/parts/head_pendent.stl';

/** Target edge (feet) the head mesh is normalized to, so it reads at room scale. */
const HEAD_TARGET_SIZE_FT = 0.8;

/** Pipe cylinder radius in feet (a thin visual run, not a real schedule size). */
const PIPE_RADIUS_FT = 0.12;

export interface LayoutSceneProps {
  widthFt: number;
  lengthFt: number;
  hazard: HazardClass;
  viewMode: ViewMode;
}

/**
 * Load the pendent head STL once, center it, recompute normals, and bake a
 * normalize-to-target scale into the geometry. Returns null until ready. Mirrors
 * PartViewer's imperative-load convention (no Suspense / useLoader).
 */
function usePendentHeadGeometry(): BufferGeometry | null {
  const [geo, setGeo] = useState<BufferGeometry | null>(null);

  useEffect(() => {
    let alive = true;
    const loader = new STLLoader();
    loader.load(
      HEAD_STL_URL,
      (g) => {
        if (!alive) return;
        g.center();
        g.computeVertexNormals();
        g.computeBoundingBox();
        const box = g.boundingBox ?? new Box3();
        const size = new Vector3();
        box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        const s = HEAD_TARGET_SIZE_FT / maxDim;
        g.scale(s, s, s);
        setGeo(g);
      },
      undefined,
      (err) => {
        console.error('STL load failed', HEAD_STL_URL, err);
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  return geo;
}

interface PipeProps {
  seg: LineSegment;
  y: number;
}

/**
 * One pipe run rendered as a thin cylinder lying flat in the XZ plane along the
 * segment. Cylinders are Y-axis aligned by default, so we rotate +90° about X to
 * lay it down, then yaw it to face the segment direction.
 */
function Pipe({ seg, y }: PipeProps): ReactElement | null {
  const dx = seg.x2 - seg.x1;
  const dz = seg.z2 - seg.z1;
  const len = Math.hypot(dx, dz);
  if (len <= 1e-6) return null;
  const cx = (seg.x1 + seg.x2) / 2;
  const cz = (seg.z1 + seg.z2) / 2;
  // Lay the cylinder flat (rot X 90deg), then yaw so its length follows (dx,dz).
  const yaw = Math.atan2(dx, dz);
  return (
    <mesh position={[cx, y, cz]} rotation={[Math.PI / 2, yaw, 0]}>
      <cylinderGeometry args={[PIPE_RADIUS_FT, PIPE_RADIUS_FT, len, 12]} />
      <meshStandardMaterial color="#9aa6b2" metalness={0.5} roughness={0.5} />
    </mesh>
  );
}

export function LayoutScene({
  widthFt,
  lengthFt,
  hazard,
  viewMode,
}: LayoutSceneProps): ReactElement {
  const geo = usePendentHeadGeometry();

  const layout = useMemo(
    () => layoutHeads({ widthFt, lengthFt, hazard }),
    [widthFt, lengthFt, hazard],
  );
  const pipes = useMemo(() => branchLines(layout), [layout]);

  // Pipe + head deck height (feet) — a notional ceiling plane above the floor.
  const deckY = 8;

  // Floor + wall sizing in feet (== scene units).
  const wallThickness = 0.5;
  const wallHeight = 9;
  const halfW = widthFt / 2;
  const halfL = lengthFt / 2;

  return (
    <>
      <ambientLight intensity={0.7} />
      <directionalLight position={[20, 40, 25]} intensity={1.1} castShadow />

      {/* Building footprint floor. */}
      <mesh
        position={[0, -0.05, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
      >
        <planeGeometry args={[widthFt, lengthFt]} />
        <meshStandardMaterial color="#1d2530" roughness={0.95} metalness={0} />
      </mesh>

      {/* Thin perimeter walls (4 boxes), centered on origin. */}
      <PerimeterWalls
        halfW={halfW}
        halfL={halfL}
        thickness={wallThickness}
        height={wallHeight}
      />

      {/* Sprinkler heads — instanced pendent meshes, pointing DOWN. */}
      {geo ? (
        <Instances
          geometry={geo}
          limit={Math.max(1, layout.count)}
          castShadow
          receiveShadow
        >
          <meshStandardMaterial color="#b8c2cc" metalness={0.35} roughness={0.55} />
          {layout.heads.map((h, i) => (
            <Instance
              key={`${h.x},${h.z},${i}`}
              position={[h.x, deckY, h.z]}
              // Pendent heads hang DOWN: rotate 180deg about X so the mesh +Y
              // (its mounting/up axis as modeled) points downward.
              rotation={[Math.PI, 0, 0]}
            />
          ))}
        </Instances>
      ) : null}

      {/* Branch lines + cross-main pipes at the deck height. */}
      {pipes.branches.map((seg, i) => (
        <Pipe key={`b${i}`} seg={seg} y={deckY} />
      ))}
      {pipes.crossMain.map((seg, i) => (
        <Pipe key={`m${i}`} seg={seg} y={deckY + PIPE_RADIUS_FT * 2} />
      ))}

      <Grid
        args={[Math.max(widthFt, lengthFt) * 1.5, Math.max(widthFt, lengthFt) * 1.5]}
        cellSize={1}
        cellColor="#384150"
        sectionSize={5}
        sectionColor="#4d5a6b"
        position={[0, -0.1, 0]}
        infiniteGrid={false}
      />

      <color attach="background" args={[colors.bgInset]} />

      {viewMode === 'plan' ? (
        <OrbitControls
          makeDefault
          target={[0, 0, 0]}
          // Lock to a near-top-down look for the plan option.
          minPolarAngle={0}
          maxPolarAngle={Math.PI / 12}
        />
      ) : (
        <OrbitControls makeDefault target={[0, 0, 0]} />
      )}
    </>
  );
}

interface PerimeterWallsProps {
  halfW: number;
  halfL: number;
  thickness: number;
  height: number;
}

/** Four thin boxes forming the footprint perimeter, centered on the origin. */
function PerimeterWalls({
  halfW,
  halfL,
  thickness,
  height,
}: PerimeterWallsProps): ReactElement {
  const y = height / 2;
  const wallColor = '#2a323d';
  return (
    <group>
      {/* North / South walls run along X (full width + corners). */}
      <mesh position={[0, y, -halfL]} castShadow receiveShadow>
        <boxGeometry args={[halfW * 2 + thickness, height, thickness]} />
        <meshStandardMaterial color={wallColor} roughness={0.9} metalness={0.05} />
      </mesh>
      <mesh position={[0, y, halfL]} castShadow receiveShadow>
        <boxGeometry args={[halfW * 2 + thickness, height, thickness]} />
        <meshStandardMaterial color={wallColor} roughness={0.9} metalness={0.05} />
      </mesh>
      {/* East / West walls run along Z. */}
      <mesh position={[-halfW, y, 0]} castShadow receiveShadow>
        <boxGeometry args={[thickness, height, halfL * 2 + thickness]} />
        <meshStandardMaterial color={wallColor} roughness={0.9} metalness={0.05} />
      </mesh>
      <mesh position={[halfW, y, 0]} castShadow receiveShadow>
        <boxGeometry args={[thickness, height, halfL * 2 + thickness]} />
        <meshStandardMaterial color={wallColor} roughness={0.9} metalness={0.05} />
      </mesh>
    </group>
  );
}

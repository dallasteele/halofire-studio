// HaloFire CAD — Viewer3D (3D). An R3F Canvas that renders the REAL building the
// operator traced/imported in 2D (W1): a filled floor slab per room and extruded
// wall runs, in feet (1 scene unit == 1 ft), plus a ground grid for context. It
// is REACTIVE — it subscribes to the shared zustand store, so a room/wall/scale
// change re-renders immediately, and selecting a room in 2D highlights it here
// (shared `selection`). When no building is loaded it shows an honest empty state.
//
// GEOMETRY: built by `buildBuildingMeshes` behind the BuildingGeometryBackend
// adapter (three.js extrude is the active backend; see lib/building3d.ts for the
// truthful OpenGeometry evaluation + fallback rationale). Nothing is fabricated —
// floors/walls map 1:1 to store.project.building.
//
// ENV-SAFETY: R3F's Canvas needs a WebGL context. In jsdom there is none, so we
// detect WebGL availability and render the DOM empty-state fallback instead of
// mounting the Canvas. This keeps the App render smoke test honest. R3F-under-
// React19 patterns mirror the studio scenes: default frameloop, gl
// preserveDrawingBuffer, a mount-time requestAnimationFrame resize kick, imperative.

import {
  useEffect,
  useMemo,
  type CSSProperties,
  type ReactElement,
} from 'react';
import { Canvas } from '@react-three/fiber';
import { Grid, OrbitControls } from '@react-three/drei';
import { useCadStore } from '../store';
import { hasBuilding, type HazardClass, type Node, type Project } from '../lib/model';
import {
  buildBuildingMeshes,
  buildingBoundsFt,
  type BuildingMeshes,
  type FloorMesh,
} from '../lib/building3d';
import { colors, spacing, typeScale } from '../lib/tokens';

/** True when a WebGL context can be created (false in jsdom / headless-no-GL). */
function webglAvailable(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

/** Subtle per-hazard floor tint (decoration only — not a code color legend). */
const HAZARD_TINT: Record<HazardClass, string> = {
  LIGHT: '#2f5d52',
  ORDINARY_1: '#3a5a73',
  ORDINARY_2: '#4a5a86',
  EXTRA_1: '#6a4f7a',
  EXTRA_2: '#7a4a55',
};

/** Selected-room highlight tint. */
const SELECTED_TINT = '#7fb4ff';

function FloorSlab({
  floor,
  selected,
}: {
  floor: FloorMesh;
  selected: boolean;
}): ReactElement | null {
  if (!floor.geometry) return null;
  return (
    <mesh geometry={floor.geometry} position={[0, 0, 0]} receiveShadow>
      <meshStandardMaterial
        color={selected ? SELECTED_TINT : HAZARD_TINT[floor.hazard]}
        roughness={0.92}
        metalness={0}
        emissive={selected ? SELECTED_TINT : '#000000'}
        emissiveIntensity={selected ? 0.35 : 0}
        side={2}
      />
    </mesh>
  );
}

/**
 * A sprinkler head marker in 3D: a small inverted-cone glyph (a stand-in pendent
 * head, NOT manufacturer-exact geometry) hanging at the ceiling plane. Heads are
 * stored in plan-FEET; the caller recenters them onto the building origin so they
 * align with the recentered floor slabs. Selected heads glow.
 */
function HeadMarker({
  x,
  y,
  z,
  selected,
  onSelect,
}: {
  x: number;
  y: number;
  z: number;
  selected: boolean;
  onSelect: () => void;
}): ReactElement {
  return (
    <group position={[x, y, z]}>
      {/* small sphere body */}
      <mesh
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
      >
        <sphereGeometry args={[selected ? 0.5 : 0.35, 16, 12]} />
        <meshStandardMaterial
          color={selected ? '#ffd27f' : '#6fb3ff'}
          emissive={selected ? '#ffd27f' : '#1b3b5f'}
          emissiveIntensity={selected ? 0.6 : 0.25}
          roughness={0.4}
          metalness={0.2}
        />
      </mesh>
      {/* deflector disc just below the body */}
      <mesh position={[0, -0.45, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.5, 0.5, 0.05, 16]} />
        <meshStandardMaterial color={selected ? '#ffd27f' : '#9fc7ff'} roughness={0.6} />
      </mesh>
    </group>
  );
}

function BuildingScene({
  meshes,
  selectedRoomId,
  heads,
  centerX,
  centerZ,
  selectedNodeId,
  onSelectHead,
}: {
  meshes: BuildingMeshes;
  selectedRoomId: string | null;
  heads: Node[];
  centerX: number;
  centerZ: number;
  selectedNodeId: string | null;
  onSelectHead: (id: string) => void;
}): ReactElement {
  // Frame size from building bounds so the grid + camera target fit it.
  const span = useMemo(() => {
    const s = Math.max(meshes.bounds.widthFt, meshes.bounds.depthFt, 10);
    return Math.ceil(s * 1.4);
  }, [meshes.bounds.widthFt, meshes.bounds.depthFt]);

  return (
    <>
      <color attach="background" args={[colors.ground3d]} />
      <ambientLight intensity={0.85} />
      <directionalLight position={[span * 0.6, span, span * 0.5]} intensity={1.2} castShadow />
      <hemisphereLight args={['#cdd6e0', '#0e1318', 0.4]} />

      {meshes.floors.map((floor) => (
        <FloorSlab
          key={floor.roomId}
          floor={floor}
          selected={floor.roomId === selectedRoomId}
        />
      ))}

      {meshes.walls.map((w) =>
        w.geometry ? (
          <mesh key={w.wallId} geometry={w.geometry} castShadow receiveShadow>
            <meshStandardMaterial color="#7d8a9a" roughness={0.85} metalness={0.08} />
          </mesh>
        ) : null,
      )}

      {/* sprinkler heads — recentered onto the building origin so they sit over the
          floor slabs. pos.y is the head's ceiling height (feet). */}
      {heads.map((h) => (
        <HeadMarker
          key={h.id}
          x={h.pos.x - centerX}
          y={h.pos.y}
          z={h.pos.z - centerZ}
          selected={h.id === selectedNodeId}
          onSelect={() => onSelectHead(h.id)}
        />
      ))}

      <Grid
        args={[span * 2, span * 2]}
        cellSize={1}
        cellColor={colors.grid3d}
        sectionSize={5}
        sectionColor={colors.gridMajor}
        position={[0, -0.05, 0]}
        infiniteGrid={false}
        fadeDistance={span * 3}
        fadeStrength={1.2}
      />

      <OrbitControls makeDefault enableDamping target={[0, 0, 0]} />
    </>
  );
}

function GroundScene({
  heads,
  selectedNodeId,
  onSelectHead,
}: {
  heads: Node[];
  selectedNodeId: string | null;
  onSelectHead: (id: string) => void;
}): ReactElement {
  return (
    <>
      <color attach="background" args={[colors.ground3d]} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[8, 14, 6]} intensity={1.1} />
      {/* Heads can exist before a building is reconstructed — show them at their
          plan-feet positions (no recentering applies with no building bounds). */}
      {heads.map((h) => (
        <HeadMarker
          key={h.id}
          x={h.pos.x}
          y={h.pos.y}
          z={h.pos.z}
          selected={h.id === selectedNodeId}
          onSelect={() => onSelectHead(h.id)}
        />
      ))}
      {/* Ground grid: honest empty floor, no building drawn. */}
      <Grid
        args={[40, 40]}
        cellSize={1}
        cellColor={colors.grid3d}
        sectionSize={5}
        sectionColor={colors.gridMajor}
        infiniteGrid
        fadeDistance={48}
        fadeStrength={1.4}
        position={[0, 0, 0]}
      />
      <OrbitControls makeDefault enableDamping />
    </>
  );
}

/** Compute the camera position framing the building bounds (or a default). */
function cameraFor(meshes: BuildingMeshes | null): {
  position: [number, number, number];
  fov: number;
} {
  if (!meshes || (meshes.bounds.widthFt === 0 && meshes.bounds.depthFt === 0)) {
    return { position: [12, 10, 12], fov: 45 };
  }
  const span = Math.max(meshes.bounds.widthFt, meshes.bounds.depthFt, 10);
  return { position: [span * 0.85, span * 0.9, span * 0.85], fov: 50 };
}

export function Viewer3D(): ReactElement {
  const project = useCadStore((s) => s.project);
  const selectedRoomId = useCadStore((s) => s.selection.selectedRoomId);
  const selectedNodeId = useCadStore((s) => s.selection.selectedNodeId);
  const select = useCadStore((s) => s.select);
  const loaded = hasBuilding(project);
  const gl = useMemo(webglAvailable, []);

  const heads = useMemo(
    () => project.network.nodes.filter((n) => n.type === 'HEAD'),
    [project.network.nodes],
  );
  // Recenter heads onto the same origin the floor slabs use (building bounds center).
  const bounds = useMemo(() => buildingBoundsFt(project.building), [project.building]);

  // PURE, deterministic rebuild whenever the building changes (room/wall/scale).
  // This is what makes the 3D view reactive to 2D edits via the shared store.
  const meshes = useMemo<BuildingMeshes | null>(() => {
    if (!loaded) return null;
    return buildBuildingMeshes(project.building, {
      ceilingHt: project.hazardDefaults.defaultCeilingHt,
      levels: project.levels.map((l) => ({
        id: l.id,
        name: l.name,
        elevationFt: l.elevationFt,
      })),
    });
  }, [loaded, project.building, project.hazardDefaults.defaultCeilingHt, project.levels]);

  // Publish a small honest 3D snapshot for the preview harness.
  useEffect(() => {
    publish3dWindow(project, meshes, heads.length);
  }, [project, meshes, heads.length]);

  // R3F sizes its canvas via ResizeObserver, which can miss the first measure in
  // headless/SSR-hydrated contexts. Kick one resize after mount so the canvas
  // fills its container reliably (no-op in a normal browser already sized).
  useEffect(() => {
    if (!gl) return;
    const id = requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
    });
    return () => cancelAnimationFrame(id);
  }, [gl]);

  const cam = useMemo(() => cameraFor(meshes), [meshes]);

  return (
    <div style={wrapStyle} aria-label="3D building viewer">
      {gl ? (
        <Canvas
          key={`${cam.position.join(',')}`}
          shadows
          dpr={[1, 2]}
          gl={{ preserveDrawingBuffer: true }}
          camera={{ position: cam.position, fov: cam.fov }}
        >
          {meshes ? (
            <BuildingScene
              meshes={meshes}
              selectedRoomId={selectedRoomId}
              heads={heads}
              centerX={bounds.cx}
              centerZ={bounds.cy}
              selectedNodeId={selectedNodeId}
              onSelectHead={(id) => select('node', id)}
            />
          ) : (
            <GroundScene heads={heads} selectedNodeId={selectedNodeId} onSelectHead={(id) => select('node', id)} />
          )}
        </Canvas>
      ) : (
        // No GL context (e.g. test env): solid ground fill stands in for the canvas.
        <div style={{ ...wrapStyle, background: colors.ground3d }} aria-hidden="true" />
      )}

      {!loaded && (
        <div style={overlayStyle}>
          <div style={overlayBadgeStyle}>3D VIEW</div>
          <div style={overlayTitleStyle}>No building yet</div>
          <div style={overlayBodyStyle}>
            Reconstruct or import a building shell to see it here.
          </div>
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------- preview handle */

/**
 * Publish a small honest 3D snapshot onto window.__cad. Truthful: has3DBuilding is
 * only true when meshes were actually built; the backend name is whatever
 * building3d reports (never faked).
 */
function publish3dWindow(
  project: Project,
  meshes: BuildingMeshes | null,
  headCount: number,
): void {
  if (typeof window === 'undefined') return;
  const prev = window.__cad;
  const next = {
    has3DBuilding: meshes !== null,
    buildingBackend: meshes?.backend ?? null,
    floorCount: meshes?.floors.length ?? 0,
    wallCount: meshes?.walls.length ?? 0,
    headCount3d: headCount,
  };
  window.__cad = { ...(prev ?? {}), ...next } as typeof window.__cad;
  // Silence unused-param lint while keeping the signature explicit for clarity.
  void project;
}

/* --------------------------------------------------------------- styles */

const wrapStyle: CSSProperties = {
  position: 'relative',
  width: '100%',
  height: '100%',
  minWidth: 0,
  minHeight: 0,
  background: colors.ground3d,
  overflow: 'hidden',
};

const overlayStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: spacing[2],
  pointerEvents: 'none',
};

const overlayBadgeStyle: CSSProperties = {
  color: colors.textMuted,
  fontSize: typeScale.xs.size,
  letterSpacing: '0.12em',
  fontWeight: 600,
  border: `1px solid ${colors.border}`,
  borderRadius: 999,
  padding: `${spacing[0.5]} ${spacing[3]}`,
  background: colors.bgInset,
};

const overlayTitleStyle: CSSProperties = {
  color: colors.textSecondary,
  fontSize: typeScale.lg.size,
  fontWeight: 600,
};

const overlayBodyStyle: CSSProperties = {
  color: colors.textMuted,
  fontSize: typeScale.sm.size,
};

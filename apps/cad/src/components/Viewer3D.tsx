// HaloFire CAD — Viewer3D (3D). An R3F Canvas that renders the REAL building the
// operator traced/imported — M-3D.1: solid walls (ONE merged wallSolid geometry,
// thickness from wall.thicknessFt else a documented 0.5 ft default, height from
// the enclosing room's ceilingHt else the project default) plus per-room floor
// AND ceiling slabs (slabSolid), lit by hemisphere + shadow-casting key light
// (lights only — no network-fetched HDR; tests run offline) — AND — W8 — the
// REAL CAD geometry of every sprinkler part: each head, tee, elbow, reducer, cross,
// and riser/valve is drawn with its actual build123d STEP body (decoded in-browser
// via occt-import-js), NOT the old placeholder glyphs (sphere+cone head, box
// fitting). Pipe runs stay correctly-sized cylinders (real pipe IS cylindrical).
//
// REAL GEOMETRY (W8): part-geometry.resolvePartModel maps each part to its committed
// STEP file (build123d dimensioned_parametric, or a local manufacturer STEP when an
// operator dropped one in). loadPartGeometry decodes + CACHES it by url, so 28 heads
// of the same SKU share ONE loaded geometry, rendered via drei <Instances>/<Instance>
// (one draw call per distinct body). A part that resolves to NO real model is drawn
// as a clearly-distinct amber wireframe PROXY and counted truthfully.
//
// HONESTY: build123d bodies are dimensioned_parametric — REAL parametric CAD
// dimensions, explicitly NOT manufacturer-exact, NOT AHJ / PE / code-certified.
// Proxies are visually distinct and counted (window.__cad.proxyPartCount). The
// per-part provenance tier is carried into the Inspector. Pipe cylinders are
// correctly-sized schematic routing. Nothing is fabricated.
//
// ENV-SAFETY: R3F's Canvas needs a WebGL context. In jsdom there is none, so we
// detect WebGL and render the DOM empty-state fallback instead of mounting the
// Canvas — the resolver still runs so the honest part counts are published.

import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactElement,
} from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { ContactShadows, Grid, Instance, Instances, OrbitControls } from '@react-three/drei';
import { useCadStore } from '../store';
import { hasBuilding, type Node, type Project, type Segment } from '../lib/model';
import { buildingBoundsFt, type BuildingBoundsFt } from '../lib/building3d';
import {
  buildingToMeshData,
  type CombinedMesh,
} from '../lib/building-mesh';
import { pressureColor, pressureRange, type HydraulicsResult } from '../lib/hydraulics';
import { selectHydraulics } from '../store';
import {
  displayScaleFor,
  loadPartGeometry,
  resolvePartModel,
  type ResolvedPartModel,
} from '../lib/part-geometry';
import { loadBuild123dManifest, type Build123dManifest } from '../../../studio/src/lib/build123d-parts';
import { loadManufacturerStepManifest, type ManufacturerStepManifest } from '../../../studio/src/lib/manufacturer-step';
import { colors, radii, spacing, typeScale } from '../lib/tokens';

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

/** Selected-room highlight tint. */
const SELECTED_TINT = '#7fb4ff';

/** Wall PBR color — light warm gray (design-aid finish, not a real material). */
const WALL_COLOR = '#b8b0a4';
/** Slab PBR color — concrete gray (design-aid finish, not a real material). */
const SLAB_COLOR = '#8f8f8a';

/** Target display size (ft) per body family so real mm bodies read at a sensible scale. */
const HEAD_TARGET_FT = 0.9;
const FITTING_TARGET_FT = 0.8;

/* --------------------------------------------- pure buffers -> THREE geometry */

/**
 * Build a THREE.BufferGeometry from the pure combined buffers produced by
 * building-mesh.ts (Float32Array positions + Uint32Array indices). Returns null
 * for an empty buffer — the caller skips the mesh honestly.
 */
function toBufferGeometry(mesh: CombinedMesh | null): THREE.BufferGeometry | null {
  if (!mesh || mesh.positions.length === 0) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geo.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  return geo;
}

/** The 3D building geometry actually handed to the scene (built per project). */
interface Building3dGeo {
  /** Which composition path built these — reported truthfully. */
  backend: string;
  bounds: BuildingBoundsFt;
  /** ONE merged geometry for ALL walls (one draw call, 1,000+ walls OK). */
  wallGeometry: THREE.BufferGeometry | null;
  /** How many source walls contributed to the merged geometry. */
  wallCount: number;
  /** Per-room floor + ceiling slab geometries (empty when no rooms — honest). */
  slabs: Array<{
    roomId: string;
    ceilingHt: number;
    floor: THREE.BufferGeometry | null;
    ceiling: THREE.BufferGeometry | null;
  }>;
}

/**
 * Floor + ceiling slab for one room. Floor top face sits at y == 0; the
 * ceiling underside sits at the room's ceiling height. Concrete-gray PBR; the
 * floor carries the selected-room highlight (existing behavior kept).
 */
function RoomSlab({
  slab,
  selected,
}: {
  slab: Building3dGeo['slabs'][number];
  selected: boolean;
}): ReactElement {
  return (
    <group>
      {slab.floor && (
        <mesh geometry={slab.floor} castShadow receiveShadow>
          <meshStandardMaterial
            color={selected ? SELECTED_TINT : SLAB_COLOR}
            roughness={0.95}
            metalness={0}
            emissive={selected ? SELECTED_TINT : '#000000'}
            emissiveIntensity={selected ? 0.35 : 0}
          />
        </mesh>
      )}
      {slab.ceiling && (
        <mesh geometry={slab.ceiling} castShadow receiveShadow>
          <meshStandardMaterial color={SLAB_COLOR} roughness={0.95} metalness={0} />
        </mesh>
      )}
    </group>
  );
}

/** Pipe role -> 3D color (visual legend only — not a code color requirement). */
const PIPE_ROLE_COLOR: Record<string, string> = {
  MAIN: '#e06c4f',
  CROSS_MAIN: '#f0a868',
  BRANCH: '#6fb3ff',
  ARM_OVER: '#9fc7ff',
  RISER: '#c062d0',
  DROP: '#9fc7ff',
};

/** Nominal diameter (in) -> 3D cylinder radius (ft), exaggerated for visibility. */
function radiusForDiameter(diameterIn: number): number {
  return Math.max(0.05, (diameterIn / 12) * 0.6);
}

/* ---------------------------------------------------- imperative STEP body load */

/**
 * Load + display-scale ONE STEP body, imperatively (no Suspense/useLoader). Returns
 * { geo, failed }. `failed` flips true on a real load error so the caller can draw a
 * proxy instead. Cached by url in loadPartGeometry, so repeat urls share the body.
 */
function useStepBody(stepUrl: string, targetFt: number): { geo: THREE.BufferGeometry | null; failed: boolean } {
  const [geo, setGeo] = useState<THREE.BufferGeometry | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setGeo(null);
    setFailed(false);
    loadPartGeometry(stepUrl)
      .then((cached) => {
        if (!alive) return;
        // Clone so each family can be display-scaled independently without mutating
        // the shared cached geometry (the cache returns the SAME instance per url).
        const g = cached.clone();
        const s = displayScaleFor(g, targetFt);
        g.scale(s, s, s);
        g.computeVertexNormals();
        setGeo(g);
      })
      .catch((err) => {
        if (!alive) return;
        console.error('CAD part STEP load failed', stepUrl, err);
        setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [stepUrl, targetFt]);

  return { geo, failed };
}

/* --------------------------------------------------------------- placed parts */

/** One placed network part with its resolved real model + render transform. */
interface PlacedPart {
  id: string;
  kind: 'head' | 'fitting';
  /** Recentered building-space position (ft). */
  position: [number, number, number];
  /** Yaw (radians) about Y to orient a fitting along its pipe; 0 for heads. */
  rotationY: number;
  model: ResolvedPartModel;
  selected: boolean;
  heatColor: string | null;
  onSelect: () => void;
}

/**
 * Instanced real-STEP bodies for every placement sharing ONE stepUrl. Loads the body
 * once (cached) and renders an <Instance> per placement. Heads flip 180deg about X so
 * the deflector points DOWN at the ceiling. Falls back to per-instance proxies on a
 * real load failure (honest — never silently blank).
 */
function StepInstances({
  stepUrl,
  placements,
  targetFt,
  flipDown,
}: {
  stepUrl: string;
  placements: PlacedPart[];
  targetFt: number;
  flipDown: boolean;
}): ReactElement | null {
  const { geo, failed } = useStepBody(stepUrl, targetFt);

  if (failed) {
    // Load failed at runtime — draw honest proxies so the part is never invisible.
    return (
      <>
        {placements.map((p) => (
          <ProxyPart key={p.id} part={p} />
        ))}
      </>
    );
  }
  if (!geo || placements.length === 0) return null;

  return (
    <Instances geometry={geo} limit={Math.max(1, placements.length)} castShadow receiveShadow>
      <meshStandardMaterial color="#c2ccd6" metalness={0.4} roughness={0.5} />
      {placements.map((p) => (
        <Instance
          key={p.id}
          position={p.position}
          rotation={flipDown ? [Math.PI, p.rotationY, 0] : [0, p.rotationY, 0]}
          color={p.selected ? '#ffd27f' : p.heatColor ?? undefined}
          onClick={(e) => {
            e.stopPropagation();
            p.onSelect();
          }}
        />
      ))}
    </Instances>
  );
}

/**
 * A clearly-distinct PROXY for a part with no resolvable real model: an amber,
 * wireframe-edged box. It can NEVER be mistaken for real CAD. Selectable.
 */
function ProxyPart({ part }: { part: PlacedPart }): ReactElement {
  const size = part.kind === 'head' ? 0.6 : 0.7;
  return (
    <group position={part.position} rotation={[0, part.rotationY, 0]}>
      <mesh
        onClick={(e) => {
          e.stopPropagation();
          part.onSelect();
        }}
      >
        <boxGeometry args={[size, size, size]} />
        <meshStandardMaterial
          color={part.selected ? '#ffd27f' : '#f0a868'}
          metalness={0}
          roughness={0.9}
          transparent
          opacity={0.5}
        />
      </mesh>
      <mesh>
        <boxGeometry args={[size, size, size]} />
        <meshStandardMaterial color={part.selected ? '#ffd27f' : '#f0a868'} wireframe />
      </mesh>
    </group>
  );
}

/**
 * A pipe run between two endpoints (feet, recentered) as a correctly-sized cylinder
 * oriented along the segment. Real pipe IS cylindrical; the radius scales with the
 * nominal diameter. Selectable.
 */
function PipeRun({
  a,
  b,
  diameterIn,
  role,
  selected,
  heatColor,
  onSelect,
}: {
  a: [number, number, number];
  b: [number, number, number];
  diameterIn: number;
  role: string;
  selected: boolean;
  heatColor: string | null;
  onSelect: () => void;
}): ReactElement | null {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-4) return null;
  const mid: [number, number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  const dir = new THREE.Vector3(dx, dy, dz).normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const quat = new THREE.Quaternion().setFromUnitVectors(up, dir);
  const r = radiusForDiameter(diameterIn) * (selected ? 1.6 : 1);
  const color = selected ? '#ffd27f' : heatColor ?? PIPE_ROLE_COLOR[role] ?? '#8aa0b4';
  return (
    <mesh
      position={mid}
      quaternion={quat}
      castShadow
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      <cylinderGeometry args={[r, r, len, 12]} />
      <meshStandardMaterial
        color={color}
        roughness={0.35}
        metalness={0.6}
        emissive={selected ? '#7a5a1f' : '#000000'}
        emissiveIntensity={selected ? 0.4 : 0}
      />
    </mesh>
  );
}

/** Heatmap color accessors (id -> css color | null) shared by heads/segments/fittings. */
interface HeatMap {
  node: (id: string) => string | null;
  seg: (id: string) => string | null;
}

/**
 * Compute the yaw (about Y) to orient a fitting along its DOMINANT adjacent pipe in
 * the floor plane. Best-effort: aligns the fitting's local +X with the run direction.
 * Honest schematic orientation — not a solved spool fit-up.
 */
function fittingYaw(node: Node, segments: Segment[], byId: Map<string, Node>): number {
  const adj = segments.filter((s) => s.from === node.id || s.to === node.id);
  for (const s of adj) {
    const other = byId.get(s.from === node.id ? s.to : s.from);
    if (!other) continue;
    const dx = other.pos.x - node.pos.x;
    const dz = other.pos.z - node.pos.z;
    if (Math.hypot(dx, dz) > 1e-4) return Math.atan2(dz, dx);
  }
  return 0;
}

/* ----------------------------------------------------------- the parts renderer */

/**
 * Resolve + render EVERY network part with its real STEP body (instanced per url),
 * plus correctly-sized pipe cylinders and amber proxies for unresolvable parts.
 * Recenters onto the building origin like the floors.
 */
function PartsLayer({
  nodes,
  segments,
  centerX,
  centerZ,
  selectedNodeId,
  selectedSegmentId,
  heat,
  manifests,
  onSelectNode,
  onSelectSegment,
}: {
  nodes: Node[];
  segments: Segment[];
  centerX: number;
  centerZ: number;
  selectedNodeId: string | null;
  selectedSegmentId: string | null;
  heat: HeatMap | null;
  manifests: Manifests;
  onSelectNode: (id: string) => void;
  onSelectSegment: (id: string) => void;
}): ReactElement {
  const byId = useMemo(() => {
    const m = new Map<string, Node>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);

  // Resolve each node to a real model (or null -> proxy), grouped by stepUrl for
  // instancing. Heads and fittings instance separately so flipDown/target differ.
  const { headGroups, fittingGroups, proxies } = useMemo(() => {
    const headGroups = new Map<string, PlacedPart[]>();
    const fittingGroups = new Map<string, PlacedPart[]>();
    const proxies: PlacedPart[] = [];
    for (const n of nodes) {
      const isHead = n.type === 'HEAD';
      const model = resolvePartModel(n, {
        build123d: manifests.build123d,
        manufacturerStep: manifests.manufacturerStep,
      });
      const placed: PlacedPart = {
        id: n.id,
        kind: isHead ? 'head' : 'fitting',
        position: [n.pos.x - centerX, n.pos.y, n.pos.z - centerZ],
        rotationY: isHead ? 0 : fittingYaw(n, segments, byId),
        // model may be null; ProxyPart doesn't read it.
        model: model as ResolvedPartModel,
        selected: n.id === selectedNodeId,
        heatColor: heat ? heat.node(n.id) : null,
        onSelect: () => onSelectNode(n.id),
      };
      if (!model) {
        proxies.push(placed);
        continue;
      }
      const group = isHead ? headGroups : fittingGroups;
      const arr = group.get(model.stepUrl);
      if (arr) arr.push(placed);
      else group.set(model.stepUrl, [placed]);
    }
    return { headGroups, fittingGroups, proxies };
  }, [nodes, segments, byId, centerX, centerZ, selectedNodeId, heat, manifests, onSelectNode]);

  return (
    <>
      {/* Pipe runs — correctly-sized cylinders (real pipe is cylindrical). */}
      {segments.map((seg) => {
        const a = byId.get(seg.from);
        const b = byId.get(seg.to);
        if (!a || !b) return null;
        return (
          <PipeRun
            key={seg.id}
            a={[a.pos.x - centerX, a.pos.y, a.pos.z - centerZ]}
            b={[b.pos.x - centerX, b.pos.y, b.pos.z - centerZ]}
            diameterIn={seg.diameterIn}
            role={seg.role}
            selected={seg.id === selectedSegmentId}
            heatColor={heat ? heat.seg(seg.id) : null}
            onSelect={() => onSelectSegment(seg.id)}
          />
        );
      })}

      {/* Real head STEP bodies, instanced per url, deflector down. */}
      {[...headGroups.entries()].map(([url, placements]) => (
        <StepInstances key={url} stepUrl={url} placements={placements} targetFt={HEAD_TARGET_FT} flipDown />
      ))}

      {/* Real fitting STEP bodies (tee/elbow/reducer/cross/riser-valve), instanced per url. */}
      {[...fittingGroups.entries()].map(([url, placements]) => (
        <StepInstances key={url} stepUrl={url} placements={placements} targetFt={FITTING_TARGET_FT} flipDown={false} />
      ))}

      {/* Honest amber-wireframe proxies for any part with no resolvable model. */}
      {proxies.map((p) => (
        <ProxyPart key={p.id} part={p} />
      ))}
    </>
  );
}

/* --------------------------------------------------------------- manifests hook */

interface Manifests {
  build123d: Build123dManifest | null;
  manufacturerStep: ManufacturerStepManifest | null;
}

/**
 * Load the committed build123d manifest (and any local manufacturer-step manifest)
 * once. Fail-soft: both default to EMPTY, so a missing file degrades parts to proxies
 * rather than crashing. The resolved part counts reflect whatever actually loaded.
 */
function useManifests(): Manifests {
  const [manifests, setManifests] = useState<Manifests>({ build123d: null, manufacturerStep: null });
  useEffect(() => {
    let alive = true;
    const fetchImpl = typeof fetch === 'function' ? fetch.bind(globalThis) : undefined;
    void Promise.all([
      loadBuild123dManifest(fetchImpl),
      loadManufacturerStepManifest(fetchImpl),
    ]).then(([build123d, manufacturerStep]) => {
      if (alive) setManifests({ build123d, manufacturerStep });
    });
    return () => {
      alive = false;
    };
  }, []);
  return manifests;
}

/* --------------------------------------------------------------- honest counts */

/**
 * PURE. Count how many network parts resolve to a REAL model vs a proxy. A part is in
 * exactly one bucket. Pipes always resolve (pipe_sch40/sch10) so they count real.
 * This is the truthful basis for window.__cad.realGeometryPartCount / proxyPartCount.
 */
export function countPartProvenance(
  nodes: Node[],
  segments: Segment[],
  manifests: Manifests,
): { realGeometryPartCount: number; proxyPartCount: number } {
  let real = 0;
  let proxy = 0;
  for (const n of nodes) {
    const m = resolvePartModel(n, {
      build123d: manifests.build123d,
      manufacturerStep: manifests.manufacturerStep,
    });
    if (m) real += 1;
    else proxy += 1;
  }
  for (const s of segments) {
    const m = resolvePartModel(s, {
      build123d: manifests.build123d,
      manufacturerStep: manifests.manufacturerStep,
    });
    if (m) real += 1;
    else proxy += 1;
  }
  return { realGeometryPartCount: real, proxyPartCount: proxy };
}

/* --------------------------------------------------------------- scenes */

function BuildingScene({
  geo,
  selectedRoomId,
  centerX,
  centerZ,
  selectedNodeId,
  selectedSegmentId,
  heat,
  manifests,
  network,
  onSelectNode,
  onSelectSegment,
}: {
  geo: Building3dGeo;
  selectedRoomId: string | null;
  centerX: number;
  centerZ: number;
  selectedNodeId: string | null;
  selectedSegmentId: string | null;
  heat: HeatMap | null;
  manifests: Manifests;
  network: Project['network'];
  onSelectNode: (id: string) => void;
  onSelectSegment: (id: string) => void;
}): ReactElement {
  const span = useMemo(() => {
    const s = Math.max(geo.bounds.widthFt, geo.bounds.depthFt, 10);
    return Math.ceil(s * 1.4);
  }, [geo.bounds.widthFt, geo.bounds.depthFt]);

  return (
    <>
      <color attach="background" args={[colors.ground3d]} />
      {/* Sky/ground fill + a single shadow-casting key light sized to the building. */}
      <hemisphereLight args={['#dbe4ee', '#23282e', 0.75]} />
      <directionalLight
        position={[span * 0.6, span * 1.1, span * 0.45]}
        intensity={1.5}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-span}
        shadow-camera-right={span}
        shadow-camera-top={span}
        shadow-camera-bottom={-span}
        shadow-camera-near={0.5}
        shadow-camera-far={span * 4}
      />

      {/* Per-room floor + ceiling slabs. NO rooms -> NO slabs (honest skip). */}
      {geo.slabs.map((slab) => (
        <RoomSlab key={slab.roomId} slab={slab} selected={slab.roomId === selectedRoomId} />
      ))}

      {/* ALL walls as ONE merged solid geometry (single draw call). */}
      {geo.wallGeometry && (
        <mesh geometry={geo.wallGeometry} castShadow receiveShadow>
          <meshStandardMaterial color={WALL_COLOR} roughness={0.9} metalness={0} />
        </mesh>
      )}

      {/* Soft grounding shadow under the building (baked once — lights only,
          no network-fetched environment maps; tests run offline). */}
      <ContactShadows
        position={[0, -0.55, 0]}
        scale={span * 2.2}
        opacity={0.45}
        blur={2.5}
        far={Math.max(20, span)}
        resolution={512}
        frames={1}
      />

      <PartsLayer
        nodes={network.nodes}
        segments={network.segments}
        centerX={centerX}
        centerZ={centerZ}
        selectedNodeId={selectedNodeId}
        selectedSegmentId={selectedSegmentId}
        heat={heat}
        manifests={manifests}
        onSelectNode={onSelectNode}
        onSelectSegment={onSelectSegment}
      />

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
  selectedNodeId,
  selectedSegmentId,
  heat,
  manifests,
  network,
  onSelectNode,
  onSelectSegment,
}: {
  selectedNodeId: string | null;
  selectedSegmentId: string | null;
  heat: HeatMap | null;
  manifests: Manifests;
  network: Project['network'];
  onSelectNode: (id: string) => void;
  onSelectSegment: (id: string) => void;
}): ReactElement {
  return (
    <>
      <color attach="background" args={[colors.ground3d]} />
      <hemisphereLight args={['#dbe4ee', '#23282e', 0.6]} />
      <directionalLight position={[8, 14, 6]} intensity={1.1} castShadow />

      <PartsLayer
        nodes={network.nodes}
        segments={network.segments}
        centerX={0}
        centerZ={0}
        selectedNodeId={selectedNodeId}
        selectedSegmentId={selectedSegmentId}
        heat={heat}
        manifests={manifests}
        onSelectNode={onSelectNode}
        onSelectSegment={onSelectSegment}
      />

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

/** Bounds (ft) of the sprinkler network nodes — the camera fallback when a
 * kernel import carries a SYSTEM but no building shell. */
function networkSpanFt(nodes: Node[]): { span: number; cx: number; cz: number } | null {
  if (nodes.length === 0) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const n of nodes) {
    if (n.pos.x < minX) minX = n.pos.x;
    if (n.pos.x > maxX) maxX = n.pos.x;
    if (n.pos.z < minZ) minZ = n.pos.z;
    if (n.pos.z > maxZ) maxZ = n.pos.z;
  }
  const span = Math.max(maxX - minX, maxZ - minZ, 10);
  return { span, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 };
}

/** Compute the camera position framing the building bounds, else the network,
 * else a default. */
function cameraFor(
  geo: Building3dGeo | null,
  net?: { span: number; cx: number; cz: number } | null,
): {
  position: [number, number, number];
  fov: number;
} {
  if (!geo || (geo.bounds.widthFt === 0 && geo.bounds.depthFt === 0)) {
    if (net) {
      return {
        position: [net.cx + net.span * 0.85, net.span * 0.9, net.cz + net.span * 0.85],
        fov: 50,
      };
    }
    return { position: [12, 10, 12], fov: 45 };
  }
  const span = Math.max(geo.bounds.widthFt, geo.bounds.depthFt, 10);
  return { position: [span * 0.85, span * 0.9, span * 0.85], fov: 50 };
}

export function Viewer3D(): ReactElement {
  const project = useCadStore((s) => s.project);
  const selectedRoomId = useCadStore((s) => s.selection.selectedRoomId);
  const selectedNodeId = useCadStore((s) => s.selection.selectedNodeId);
  const selectedSegmentId = useCadStore((s) => s.selection.selectedSegmentId);
  const select = useCadStore((s) => s.select);
  const pressureHeatmap = useCadStore((s) => s.pressureHeatmap);
  const supply = useCadStore((s) => s.supply);
  const designAreaSqFt = useCadStore((s) => s.designAreaSqFt);
  const loaded = hasBuilding(project);
  const gl = useMemo(webglAvailable, []);
  const manifests = useManifests();

  const heads = useMemo(
    () => project.network.nodes.filter((n) => n.type === 'HEAD'),
    [project.network.nodes],
  );

  // W5 pressure heatmap accessor (shared blue->red scale; only when toggled on).
  const heat = useMemo<HeatMap | null>(() => {
    if (!pressureHeatmap) return null;
    const result: HydraulicsResult = selectHydraulics(useCadStore.getState());
    const range = pressureRange(result);
    if (range.max <= range.min) return null;
    const nodePsi = new Map(result.perNode.map((n) => [n.id, n.pressurePsi]));
    const colorFor = (psi: number | undefined): string | null =>
      psi == null ? null : pressureColor(psi, range.min, range.max);
    return {
      node: (id) => colorFor(nodePsi.get(id)),
      seg: (id) => {
        const seg = project.network.segments.find((s) => s.id === id);
        if (!seg) return null;
        const a = nodePsi.get(seg.from);
        const b = nodePsi.get(seg.to);
        if (a == null || b == null) return null;
        return colorFor((a + b) / 2);
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pressureHeatmap, project.network, supply, designAreaSqFt, project.hazardDefaults.defaultClass]);

  const bounds = useMemo(() => buildingBoundsFt(project.building), [project.building]);

  // PURE composition (building-mesh.ts) -> THREE geometries. One merged wall
  // geometry + per-room floor/ceiling slabs. Wall thickness comes from
  // wall.thicknessFt when present (else the documented 0.5 ft default); wall
  // height resolves to the enclosing room's ceilingHt else the project default.
  const geo = useMemo<Building3dGeo | null>(() => {
    if (!loaded) return null;
    const data = buildingToMeshData(project.building, {
      defaultCeilingHt: project.hazardDefaults.defaultCeilingHt,
    });
    return {
      backend: data.backend,
      bounds: data.bounds,
      wallGeometry: toBufferGeometry(data.walls),
      wallCount: data.walls.wallCount,
      slabs: data.slabs.map((s) => ({
        roomId: s.roomId,
        ceilingHt: s.ceilingHt,
        floor: toBufferGeometry(s.floor),
        ceiling: toBufferGeometry(s.ceiling),
      })),
    };
  }, [loaded, project.building, project.hazardDefaults.defaultCeilingHt]);

  // Honest provenance counts (resolution-based; recomputed when network/manifests change).
  const provCounts = useMemo(
    () => countPartProvenance(project.network.nodes, project.network.segments, manifests),
    [project.network.nodes, project.network.segments, manifests],
  );

  // Publish a small honest 3D + provenance snapshot for the preview harness.
  useEffect(() => {
    publish3dWindow(geo, heads.length, provCounts);
  }, [geo, heads.length, provCounts]);

  useEffect(() => {
    if (!gl) return;
    const id = requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
    });
    return () => cancelAnimationFrame(id);
  }, [gl]);

  const netSpan = useMemo(() => networkSpanFt(project.network.nodes), [project.network.nodes]);
  const hasSystem = project.network.nodes.length > 0 || project.network.segments.length > 0;
  const cam = useMemo(() => cameraFor(geo, netSpan), [geo, netSpan]);

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
          {geo ? (
            <BuildingScene
              geo={geo}
              selectedRoomId={selectedRoomId}
              centerX={bounds.cx}
              centerZ={bounds.cy}
              selectedNodeId={selectedNodeId}
              selectedSegmentId={selectedSegmentId}
              heat={heat}
              manifests={manifests}
              network={project.network}
              onSelectNode={(id) => select('node', id)}
              onSelectSegment={(id) => select('segment', id)}
            />
          ) : (
            <GroundScene
              selectedNodeId={selectedNodeId}
              selectedSegmentId={selectedSegmentId}
              heat={heat}
              manifests={manifests}
              network={project.network}
              onSelectNode={(id) => select('node', id)}
              onSelectSegment={(id) => select('segment', id)}
            />
          )}
        </Canvas>
      ) : (
        <div style={{ ...wrapStyle, background: colors.ground3d }} aria-hidden="true" />
      )}

      {!loaded && !hasSystem && (
        <div style={overlayStyle}>
          <div style={overlayBadgeStyle}>3D VIEW</div>
          <div style={overlayTitleStyle}>No building yet</div>
          <div style={overlayBodyStyle}>
            Reconstruct or import a building shell to see it here.
          </div>
        </div>
      )}
      {!loaded && hasSystem && (
        <div style={systemOnlyHintStyle}>
          System only — no building shell in this file. Import or trace the plan
          sheets to add the architecture.
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------- preview handle */

/**
 * Publish a small honest 3D + provenance snapshot onto window.__cad. Truthful:
 * has3DBuilding only when meshes were actually built; the part counts come straight
 * from the resolver (real STEP body vs amber proxy).
 */
function publish3dWindow(
  geo: Building3dGeo | null,
  headCount: number,
  prov: { realGeometryPartCount: number; proxyPartCount: number },
): void {
  if (typeof window === 'undefined') return;
  const prev = window.__cad;
  const next = {
    has3DBuilding: geo !== null,
    buildingBackend: geo?.backend ?? null,
    floorCount: geo?.slabs.filter((s) => s.floor !== null).length ?? 0,
    wallCount: geo?.wallCount ?? 0,
    headCount3d: headCount,
    realGeometryPartCount: prov.realGeometryPartCount,
    proxyPartCount: prov.proxyPartCount,
  };
  window.__cad = { ...(prev ?? {}), ...next } as typeof window.__cad;
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

/** Corner hint when a SYSTEM renders without a building shell (kernel imports). */
const systemOnlyHintStyle: CSSProperties = {
  position: 'absolute',
  left: 12,
  bottom: 12,
  maxWidth: 360,
  background: 'rgba(20, 24, 32, 0.85)',
  border: `1px solid ${colors.border}`,
  borderRadius: radii.md,
  color: colors.textSecondary,
  fontSize: typeScale.xs.size,
  padding: `${spacing[1]} ${spacing[2]}`,
  pointerEvents: 'none',
};

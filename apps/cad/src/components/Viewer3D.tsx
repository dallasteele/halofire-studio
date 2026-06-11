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
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from 'react';
import * as THREE from 'three';
import { Canvas, useFrame } from '@react-three/fiber';
import { ContactShadows, Grid, Instance, Instances, OrbitControls } from '@react-three/drei';
import { useCadStore } from '../store';
import { hasBuilding, type Node, type Project, type Segment } from '../lib/model';
import { buildingBoundsFt, type BuildingBoundsFt } from '../lib/building3d';
import {
  buildingToMeshData,
  type CombinedMesh,
} from '../lib/building-mesh';
import { pressureColor, pressureRange, type HydraulicsResult } from '../lib/hydraulics';
import { segmentVertexColors } from '../lib/flow-gradient';
import { selectHydraulics } from '../store';
import {
  loadPartGeometry,
  resolvePartModel,
  type ResolvedPartModel,
} from '../lib/part-geometry';
import {
  attachedDirections,
  placementFor,
  type PartPlacement,
} from '../lib/part-placement';
import { useManifests, type Manifests } from '../lib/use-manifests';
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

/** NOMINAL display target (ft) per body family — used ONLY when the placement
 * contract reports 'nominal-fallback' (bbox missing or implausible). A plausible
 * physical bbox renders at REAL size instead (sizeMode 'physical', scale 1). */
const HEAD_TARGET_FT = 0.9;
const FITTING_TARGET_FT = 0.8;

/** build123d STEP bodies are exported in MILLIMETRES; the viewer renders FEET. */
const MM_PER_FT = 304.8;

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
  showCeiling,
}: {
  slab: Building3dGeo['slabs'][number];
  selected: boolean;
  /** Ceilings default OFF — they sealed the model and hid the entire sprinkler
   * system from every exterior view (standard CAD: look INTO the model). */
  showCeiling: boolean;
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
      {showCeiling && slab.ceiling && (
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

/* ------------------------------------------- placement-contract verification */

/** Per-instanced-group sizing reports (group key -> mode + part count), feeding
 * the honest physical/fallback counts on window.__cadVerify3D as bodies load. */
const placementGroupReports = new Map<string, { sizeMode: PartPlacement['sizeMode']; count: number }>();

/** Sum the loaded groups into { physical, fallback } part counts. */
function placementCounts(): { physical: number; fallback: number } {
  let physical = 0;
  let fallback = 0;
  for (const g of placementGroupReports.values()) {
    if (g.sizeMode === 'physical') physical += g.count;
    else fallback += g.count;
  }
  return { physical, fallback };
}

/** Merge the current contract counts into window.__cadVerify3D (dev handle). */
function publishPlacementCounts(): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as { __cadVerify3D?: Record<string, unknown> };
  const counts = placementCounts();
  w.__cadVerify3D = {
    ...(w.__cadVerify3D ?? {}),
    placementContract: true,
    physicalCount: counts.physical,
    fallbackCount: counts.fallback,
  };
}

function reportPlacementGroup(key: string, sizeMode: PartPlacement['sizeMode'], count: number): void {
  placementGroupReports.set(key, { sizeMode, count });
  publishPlacementCounts();
}

function removePlacementGroup(key: string): void {
  placementGroupReports.delete(key);
  publishPlacementCounts();
}

/* ---------------------------------------------------- imperative STEP body load */

/**
 * Load + contract-size ONE STEP body, imperatively (no Suspense/useLoader). The
 * cached mm geometry is cloned, converted to FEET, then sized by the placement
 * SIZING CONTRACT: a plausible physical bbox renders at REAL size ('physical',
 * scale 1); anything else is scaled to the nominal target and REPORTED as
 * 'nominal-fallback'. `failed` flips true on a real load error so the caller can
 * draw a proxy instead. Cached by url in loadPartGeometry, so repeat urls share
 * the decoded body.
 */
function useStepBody(
  stepUrl: string,
  nominalTargetFt: number,
  sizingType: string,
): { geo: THREE.BufferGeometry | null; failed: boolean; sizeMode: PartPlacement['sizeMode'] | null } {
  const [state, setState] = useState<{
    geo: THREE.BufferGeometry | null;
    sizeMode: PartPlacement['sizeMode'] | null;
  }>({ geo: null, sizeMode: null });
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setState({ geo: null, sizeMode: null });
    setFailed(false);
    loadPartGeometry(stepUrl)
      .then((cached) => {
        if (!alive) return;
        // Clone so each family can be sized independently without mutating the
        // shared cached geometry (the cache returns the SAME instance per url).
        const g = cached.clone();
        g.computeBoundingBox();
        const box = g.boundingBox;
        const maxDimRaw = box
          ? Math.max(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z)
          : 0;
        // Real bbox in FEET (bodies are mm). Degenerate bbox -> null (contract
        // reports nominal-fallback; nothing is silently fabricated).
        const bboxMaxFt = Number.isFinite(maxDimRaw) && maxDimRaw > 0 ? maxDimRaw / MM_PER_FT : null;
        const placement = placementFor(sizingType, [], { bboxMaxFt, nominalTargetFt });
        const s = (1 / MM_PER_FT) * placement.scale;
        g.scale(s, s, s);
        g.computeVertexNormals();
        setState({ geo: g, sizeMode: placement.sizeMode });
      })
      .catch((err) => {
        if (!alive) return;
        console.error('CAD part STEP load failed', stepUrl, err);
        setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [stepUrl, nominalTargetFt, sizingType]);

  return { geo: state.geo, failed, sizeMode: state.sizeMode };
}

/* --------------------------------------------------------------- placed parts */

/** One placed network part with its resolved real model + contracted transform. */
interface PlacedPart {
  id: string;
  kind: 'head' | 'fitting';
  /** The network node type (drives the placement contract's rotation rules). */
  nodeType: string;
  /** Recentered building-space position (ft). */
  position: [number, number, number];
  /** Contracted yaw (radians) about Y from part-placement.placementFor. */
  rotationY: number;
  /** Contracted deflector-down flip (true for heads). */
  deflectorDown: boolean;
  model: ResolvedPartModel;
  selected: boolean;
  heatColor: string | null;
  onSelect: () => void;
}

/**
 * Instanced real-STEP bodies for every placement sharing ONE stepUrl. Loads the body
 * once (cached), sizes it by the placement SIZING CONTRACT, and renders an
 * <Instance> per placement with its contracted rotation. Heads flip 180deg about X
 * so the deflector points DOWN at the ceiling (placement.deflectorDown). Falls back
 * to per-instance proxies on a real load failure (honest — never silently blank).
 */
function StepInstances({
  stepUrl,
  placements,
  targetFt,
}: {
  stepUrl: string;
  placements: PlacedPart[];
  targetFt: number;
}): ReactElement | null {
  const sizingType = placements[0]?.nodeType ?? 'TEE';
  const groupKey = `${placements[0]?.kind ?? 'fitting'}:${stepUrl}`;
  const { geo, failed, sizeMode } = useStepBody(stepUrl, targetFt, sizingType);

  // Report this group's contracted size mode (physical vs nominal-fallback) so
  // fake sizing is NEVER silent — the counts land on window.__cadVerify3D.
  useEffect(() => {
    if (!sizeMode) return;
    reportPlacementGroup(groupKey, sizeMode, placements.length);
    return () => removePlacementGroup(groupKey);
  }, [groupKey, sizeMode, placements.length]);

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
          rotation={p.deflectorDown ? [Math.PI, p.rotationY, 0] : [0, p.rotationY, 0]}
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

/** Endpoint pressures + shared scale for one pipe's continuous gradient. */
interface SegmentGradient {
  fromPsi: number;
  toPsi: number;
  min: number;
  max: number;
}

/** Radial faces around each pipe cylinder. */
const PIPE_RADIAL_SEGMENTS = 12;
/** Axial divisions on a GRADIENT pipe so the per-vertex ramp bends through the
 * intermediate scale colors (a 1-division cylinder could only show 2 colors). */
const PIPE_GRADIENT_DIVISIONS = 8;

/**
 * A pipe run between two endpoints (feet, recentered) as a correctly-sized cylinder
 * oriented along the segment. Real pipe IS cylindrical; the radius scales with the
 * nominal diameter. Selectable. When the pressure heatmap is on and BOTH endpoint
 * pressures are known, the cylinder carries a PER-VERTEX pressure gradient from the
 * from-node psi to the to-node psi (segmentVertexColors — the same lerp the 2D
 * gradient strokes use) plus a subtle emissive pulse so the system reads as live
 * flow. Hazen-Williams design-aid visualization, NOT a CFD solve.
 */
function PipeRun({
  a,
  b,
  diameterIn,
  role,
  selected,
  heatColor,
  gradient,
  onSelect,
}: {
  a: [number, number, number];
  b: [number, number, number];
  diameterIn: number;
  role: string;
  selected: boolean;
  heatColor: string | null;
  gradient: SegmentGradient | null;
  onSelect: () => void;
}): ReactElement | null {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz);
  const r = radiusForDiameter(diameterIn) * (selected ? 1.6 : 1);
  // The selected pipe keeps its solid highlight — gradient applies otherwise.
  const grad = !selected && len >= 1e-4 ? gradient : null;

  // Vertex-colored cylinder for the gradient path. Local +Y maps onto a->b via
  // the quaternion below, so axis t = (y + len/2) / len runs 0 at the FROM node
  // and 1 at the TO node — matching segmentVertexColors' contract.
  const gradGeo = useMemo(() => {
    if (!grad) return null;
    const g = new THREE.CylinderGeometry(r, r, len, PIPE_RADIAL_SEGMENTS, PIPE_GRADIENT_DIVISIONS);
    const pos = g.getAttribute('position');
    const axisT = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) axisT[i] = (pos.getY(i) + len / 2) / len;
    g.setAttribute(
      'color',
      new THREE.BufferAttribute(
        segmentVertexColors(axisT, grad.fromPsi, grad.toPsi, grad.min, grad.max),
        3,
      ),
    );
    return g;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grad?.fromPsi, grad?.toPsi, grad?.min, grad?.max, r, len]);
  useEffect(() => {
    return () => {
      gradGeo?.dispose();
    };
  }, [gradGeo]);

  // Subtle emissive pulse (0.15..0.35) on the heatmap material — reads as live
  // flow. Purely visual; pressures are untouched.
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    if (!grad || !matRef.current) return;
    matRef.current.emissiveIntensity = 0.25 + 0.1 * Math.sin(clock.elapsedTime * 2);
  });

  if (len < 1e-4) return null;
  const mid: [number, number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  const dir = new THREE.Vector3(dx, dy, dz).normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const quat = new THREE.Quaternion().setFromUnitVectors(up, dir);
  const color = selected ? '#ffd27f' : heatColor ?? PIPE_ROLE_COLOR[role] ?? '#8aa0b4';

  if (grad && gradGeo) {
    // Mid-pressure color drives the pulse glow so it stays on the shared scale.
    const midColor = pressureColor((grad.fromPsi + grad.toPsi) / 2, grad.min, grad.max);
    return (
      <mesh
        position={mid}
        quaternion={quat}
        geometry={gradGeo}
        castShadow
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
      >
        <meshStandardMaterial
          ref={matRef}
          vertexColors
          color="#ffffff"
          roughness={0.35}
          metalness={0.6}
          emissive={midColor}
          emissiveIntensity={0.25}
        />
      </mesh>
    );
  }

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
      <cylinderGeometry args={[r, r, len, PIPE_RADIAL_SEGMENTS]} />
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

/** Heatmap color accessors (id -> css color | null) shared by heads/segments/fittings,
 * plus the per-segment endpoint-pressure gradient + shared scale for the
 * continuous "fluid dynamics" rendering. */
interface HeatMap {
  node: (id: string) => string | null;
  seg: (id: string) => string | null;
  /** Endpoint pressures for a segment's continuous gradient (null when either
   * endpoint has no computed pressure — drawn with the mean color instead). */
  segGradient: (id: string) => SegmentGradient | null;
  /** Shared psi scale (drives the legend). */
  range: { min: number; max: number };
  /** How many segments have BOTH endpoint pressures (gradient-renderable). */
  gradientSegments: number;
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
      // Contracted rotation/orientation from the attached segment directions.
      // bboxMaxFt is null here (the body loads later); rotation and the
      // deflector flip do not depend on it — sizing is contracted at load time.
      const placement = placementFor(n.type, attachedDirections(n.id, nodes, segments), {
        bboxMaxFt: null,
        nominalTargetFt: isHead ? HEAD_TARGET_FT : FITTING_TARGET_FT,
      });
      const placed: PlacedPart = {
        id: n.id,
        kind: isHead ? 'head' : 'fitting',
        nodeType: n.type,
        position: [n.pos.x - centerX, n.pos.y, n.pos.z - centerZ],
        rotationY: placement.rotationY,
        deflectorDown: placement.deflectorDown,
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
  }, [nodes, segments, centerX, centerZ, selectedNodeId, heat, manifests, onSelectNode]);

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
            gradient={heat ? heat.segGradient(seg.id) : null}
            onSelect={() => onSelectSegment(seg.id)}
          />
        );
      })}

      {/* Real head STEP bodies, instanced per url, deflector down (contracted). */}
      {[...headGroups.entries()].map(([url, placements]) => (
        <StepInstances key={url} stepUrl={url} placements={placements} targetFt={HEAD_TARGET_FT} />
      ))}

      {/* Real fitting STEP bodies (tee/elbow/reducer/cross/riser-valve), instanced per url. */}
      {[...fittingGroups.entries()].map(([url, placements]) => (
        <StepInstances key={url} stepUrl={url} placements={placements} targetFt={FITTING_TARGET_FT} />
      ))}

      {/* Honest amber-wireframe proxies for any part with no resolvable model. */}
      {proxies.map((p) => (
        <ProxyPart key={p.id} part={p} />
      ))}
    </>
  );
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
  showCeilings,
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
  showCeilings: boolean;
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
        <RoomSlab key={slab.roomId} slab={slab} selected={slab.roomId === selectedRoomId} showCeiling={showCeilings} />
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
    // Count the segments whose BOTH endpoints carry a computed pressure — the
    // honest gradient-renderable count published on window.__cadVerify3D.
    let gradientSegments = 0;
    for (const s of project.network.segments) {
      if (nodePsi.has(s.from) && nodePsi.has(s.to)) gradientSegments += 1;
    }
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
      segGradient: (id) => {
        const seg = project.network.segments.find((s) => s.id === id);
        if (!seg) return null;
        const a = nodePsi.get(seg.from);
        const b = nodePsi.get(seg.to);
        if (a == null || b == null) return null;
        return { fromPsi: a, toPsi: b, min: range.min, max: range.max };
      },
      range,
      gradientSegments,
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
  // Ceilings OFF by default — rendered ceilings sealed the model and hid the
  // entire sprinkler system from exterior views (user-reported).
  const [showCeilings, setShowCeilings] = useState(false);

  // VERIFICATION HANDLE (DEV): numeric truth about the live scene so 3D work is
  // verified against real geometry, never a far-away screenshot vibe-check.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const heads3d = project.network.nodes.filter((n) => n.type === 'HEAD');
    const ys = heads3d.map((h) => h.pos.y);
    // Placement contract snapshot: the first 3 fitting rotations (pure, from the
    // attached segment directions) + live physical/fallback counts (updated as
    // instanced bodies load and report their contracted size mode).
    const sampleRotations = project.network.nodes
      .filter((n) => n.type !== 'HEAD')
      .slice(0, 3)
      .map(
        (n) =>
          placementFor(
            n.type,
            attachedDirections(n.id, project.network.nodes, project.network.segments),
            { bboxMaxFt: null, nominalTargetFt: FITTING_TARGET_FT },
          ).rotationY,
      );
    const counts = placementCounts();
    (window as unknown as { __cadVerify3D?: unknown }).__cadVerify3D = {
      backend: geo?.backend ?? null,
      wallCount: geo?.wallCount ?? 0,
      wallVertexCount: geo?.wallGeometry?.getAttribute('position')?.count ?? 0,
      slabRooms: geo?.slabs.length ?? 0,
      showCeilings,
      headCount: heads3d.length,
      headYMin: ys.length ? Math.min(...ys) : null,
      headYMax: ys.length ? Math.max(...ys) : null,
      systemRecentered: !!geo, // network subtracts (cx, cy) only when a building renders
      sceneCenter: geo ? [bounds.cx, bounds.cy] : [0, 0],
      placementContract: true,
      physicalCount: counts.physical,
      fallbackCount: counts.fallback,
      sampleRotations,
      // Continuous pressure-gradient state (true only while the heatmap is on).
      flowGradient: heat !== null,
      gradientSegments: heat?.gradientSegments ?? 0,
    };
  }, [geo, project.network.nodes, project.network.segments, showCeilings, bounds.cx, bounds.cy, heat]);

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
              showCeilings={showCeilings}
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
      {loaded && (
        <label style={ceilingToggleStyle}>
          <input
            type="checkbox"
            checked={showCeilings}
            onChange={(e) => setShowCeilings(e.target.checked)}
            data-cad-ceilings
          />
          {' '}Ceilings
        </label>
      )}
      {/* Continuous pressure-gradient legend — same scale as the 2D plan legend. */}
      {heat && (
        <div style={flowLegendStyle} data-cad-flow-legend aria-label="Pressure gradient legend">
          <span style={flowLegendBarStyle} aria-hidden="true" />
          <span>
            {`${heat.range.min.toFixed(0)} → ${heat.range.max.toFixed(0)} psi — Hazen-Williams design aid`}
          </span>
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

const ceilingToggleStyle: CSSProperties = {
  position: 'absolute',
  right: 12,
  top: 12,
  background: 'rgba(20, 24, 32, 0.85)',
  border: `1px solid ${colors.border}`,
  borderRadius: radii.md,
  color: colors.textSecondary,
  fontSize: typeScale.xs.size,
  padding: `${spacing[0.5]} ${spacing[2]}`,
  userSelect: 'none',
  cursor: 'pointer',
};

/** Compact pressure-gradient legend overlay (heatmap on only). */
const flowLegendStyle: CSSProperties = {
  position: 'absolute',
  right: 12,
  bottom: 12,
  display: 'flex',
  alignItems: 'center',
  gap: spacing[2],
  background: 'rgba(20, 24, 32, 0.85)',
  border: `1px solid ${colors.border}`,
  borderRadius: radii.md,
  color: colors.textSecondary,
  fontSize: typeScale.xs.size,
  padding: `${spacing[0.5]} ${spacing[2]}`,
  pointerEvents: 'none',
};

/** The same blue->red ramp pressureColor produces (5 stops) — one shared scale. */
const flowLegendBarStyle: CSSProperties = {
  display: 'inline-block',
  width: 110,
  height: 8,
  borderRadius: 999,
  background:
    'linear-gradient(90deg, rgb(59,130,246), rgb(34,211,238), rgb(74,222,128), rgb(250,204,21), rgb(239,68,68))',
  border: `1px solid ${colors.border}`,
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

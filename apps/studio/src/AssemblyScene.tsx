// R3F system-ASSEMBLY scene — the visual capstone showing how the parts FIT
// TOGETHER in the NFPA-13 wet-pipe topology.
//
// Given a computed Assembly (assembly-layout.computeAssembly — heads spaced at
// the REAL cited NFPA-13 max spacing), this scene:
//   - loads each DISTINCT build123d STEP body ONCE (occt-import-js, imperative +
//     useState — NO useLoader/Suspense, matching CatalogPartViewer/LayoutScene),
//     normalizing it to a small uniform size, then places every instance of that
//     body at its computed transform via drei <Instances>/<Instance>;
//   - draws schematic pipe runs (branch_pipe/cross_main/riser) as cylinders
//     scaled to lengthFt — clearly SCHEMATIC routing, NOT fabricated spool CAD;
//   - draws an honest, visually-DISTINCT PROXY box for any kind lacking a real
//     body (e.g. a head whose SKU resolved to no geometry).
//
// R3F-under-React19 patterns (proven in the existing scenes): default frameloop
// (not demand), gl preserveDrawingBuffer (set on the Canvas in App), a mount-time
// requestAnimationFrame resize kick (in App), no StrictMode, imperative load.
//
// HONESTY: build123d bodies are dimensioned-parametric APPROXIMATIONS — NOT
// manufacturer-exact, NOT AHJ / PE / code-certified. Pipe cylinders are SCHEMATIC
// routing. Proxies are amber, wireframe-edged boxes that read as placeholders, and
// are NEVER presented as real geometry. The assembly is a SCHEMATIC DESIGN AID.

import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Grid, Instance, Instances, OrbitControls } from '@react-three/drei';
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Vector3,
} from 'three';
import { loadStepGeometry } from './lib/step-loader';
import { colors } from './lib/tokens';
import type { Assembly, PlacedPart } from './lib/assembly-layout';
import type { ViewMode } from './lib/view-mode';

/** Public STEP url for a build123d key (served from public/parts/build123d). */
function stepUrlFor(key: string): string {
  return `/parts/build123d/${key}.step`;
}

/** Target normalized size (ft) per body family — fittings small, heads small. */
const HEAD_TARGET_FT = 0.9;
const FITTING_TARGET_FT = 0.7;

/** Schematic pipe radius (ft) — a thin visual run, NOT a real schedule size. */
const PIPE_RADIUS_FT = 0.1;

/** Proxy box edge (ft) — clearly a placeholder, not real CAD. */
const PROXY_SIZE_FT = 0.7;

/**
 * Load + normalize ONE build123d STEP body, imperatively (no Suspense/useLoader).
 * Returns null until ready / on failure. Mirrors CatalogPartViewer's StepMesh.
 */
function useStepBody(key: string | null, targetFt: number): BufferGeometry | null {
  const [geo, setGeo] = useState<BufferGeometry | null>(null);

  useEffect(() => {
    if (!key) {
      setGeo(null);
      return;
    }
    let alive = true;
    setGeo(null);
    loadStepGeometry(stepUrlFor(key))
      .then((step) => {
        if (!alive) return;
        const g = new BufferGeometry();
        g.setAttribute('position', new BufferAttribute(step.positions, 3));
        if (step.normals.length === step.positions.length) {
          g.setAttribute('normal', new BufferAttribute(step.normals, 3));
        }
        g.center();
        g.computeVertexNormals();
        g.computeBoundingBox();
        const box = g.boundingBox ?? new Box3();
        const size = new Vector3();
        box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        const s = targetFt / maxDim;
        g.scale(s, s, s);
        setGeo(g);
      })
      .catch((err) => {
        if (!alive) return;
        console.error('assembly STEP load failed', key, err);
        setGeo(null);
      });
    return () => {
      alive = false;
    };
  }, [key, targetFt]);

  return geo;
}

/**
 * Instanced placement of every part that resolves to ONE build123d body. Loads
 * the body once and renders an <Instance> per placement transform.
 */
function Build123dInstances({
  bodyKey,
  placements,
  targetFt,
  color,
  flipDown,
}: {
  bodyKey: string;
  placements: PlacedPart[];
  targetFt: number;
  color: string;
  flipDown: boolean;
}): ReactElement | null {
  const geo = useStepBody(bodyKey, targetFt);
  if (!geo || placements.length === 0) return null;
  return (
    <Instances geometry={geo} limit={Math.max(1, placements.length)} castShadow receiveShadow>
      <meshStandardMaterial color={color} metalness={0.45} roughness={0.5} />
      {placements.map((p) => (
        <Instance
          key={p.id}
          position={p.position}
          // Pendent heads hang DOWN: flip 180deg about X. rotationY is the part yaw.
          rotation={flipDown ? [Math.PI, p.rotationY, 0] : [0, p.rotationY, 0]}
        />
      ))}
    </Instances>
  );
}

/**
 * One schematic pipe run as a cylinder scaled to lengthFt. Cylinders are Y-axis
 * aligned by default; we lay flat (rot +90deg about X) then yaw by rotationY so
 * the length axis follows the run. Honest SCHEMATIC routing — not spool CAD.
 */
function SchematicPipe({ part }: { part: PlacedPart }): ReactElement | null {
  const len = part.lengthFt ?? 0;
  if (len <= 0) return null;
  return (
    <mesh
      position={part.position}
      rotation={[Math.PI / 2, part.rotationY, 0]}
      castShadow
    >
      <cylinderGeometry args={[PIPE_RADIUS_FT, PIPE_RADIUS_FT, len, 12]} />
      {/* Distinctly schematic: cool grey, slightly translucent so it reads as routing. */}
      <meshStandardMaterial color="#8aa0b6" metalness={0.3} roughness={0.6} transparent opacity={0.85} />
    </mesh>
  );
}

/**
 * An honest PROXY box for a placement with no real geometry. Visually DISTINCT
 * (amber, wireframe) so it can never be mistaken for real CAD.
 */
function ProxyBox({ part }: { part: PlacedPart }): ReactElement {
  return (
    <group position={part.position} rotation={[0, part.rotationY, 0]}>
      <mesh castShadow>
        <boxGeometry args={[PROXY_SIZE_FT, PROXY_SIZE_FT, PROXY_SIZE_FT]} />
        <meshStandardMaterial
          color="#f0a868"
          metalness={0}
          roughness={0.9}
          transparent
          opacity={0.5}
        />
      </mesh>
      {/* Wireframe overlay screams "placeholder, not real geometry". */}
      <mesh>
        <boxGeometry args={[PROXY_SIZE_FT, PROXY_SIZE_FT, PROXY_SIZE_FT]} />
        <meshStandardMaterial color="#f0a868" wireframe />
      </mesh>
    </group>
  );
}

export interface AssemblySceneProps {
  assembly: Assembly;
  viewMode: ViewMode;
}

/**
 * Render the full computed assembly. Groups placements by (partSource, partKey)
 * so each distinct build123d body loads exactly once and is instanced.
 */
export function AssemblyScene({ assembly, viewMode }: AssemblySceneProps): ReactElement {
  const { parts } = assembly;

  // Group the REAL build123d placements by body key (each loads + instances once).
  const build123dByKey = useMemo(() => {
    const map = new Map<string, PlacedPart[]>();
    for (const p of parts) {
      if (p.partSource !== 'build123d') continue;
      const arr = map.get(p.partKey);
      if (arr) arr.push(p);
      else map.set(p.partKey, [p]);
    }
    return map;
  }, [parts]);

  const schematicPipes = useMemo(
    () => parts.filter((p) => p.partSource === 'schematic'),
    [parts],
  );
  const proxies = useMemo(() => parts.filter((p) => p.partSource === 'proxy'), [parts]);

  // Span (ft) for the floor grid sizing, from the head extent.
  const span = useMemo(() => {
    let max = 10;
    for (const p of parts) {
      max = Math.max(max, Math.abs(p.position[0]) * 2, Math.abs(p.position[2]) * 2);
    }
    return max + assembly.spacingFt * 2;
  }, [parts, assembly.spacingFt]);

  return (
    <>
      <ambientLight intensity={0.75} />
      <directionalLight position={[20, 40, 25]} intensity={1.15} castShadow />
      <hemisphereLight args={['#cdd6e0', '#0e1318', 0.4]} />

      {/* Floor reference plane. */}
      <mesh position={[0, -0.05, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[span * 1.4, span * 1.4]} />
        <meshStandardMaterial color="#1d2530" roughness={0.95} metalness={0} />
      </mesh>

      {/* Real build123d heads + fittings, one load per distinct body, instanced. */}
      {[...build123dByKey.entries()].map(([key, placements]) => {
        const isHead = placements[0]?.kind === 'head';
        return (
          <Build123dInstances
            key={key}
            bodyKey={key}
            placements={placements}
            targetFt={isHead ? HEAD_TARGET_FT : FITTING_TARGET_FT}
            color={isHead ? '#c8d2dc' : '#9fb0c2'}
            flipDown={isHead}
          />
        );
      })}

      {/* Schematic pipe routing (cylinders scaled to length). */}
      {schematicPipes.map((p) => (
        <SchematicPipe key={p.id} part={p} />
      ))}

      {/* Honest proxy boxes for any part lacking real geometry. */}
      {proxies.map((p) => (
        <ProxyBox key={p.id} part={p} />
      ))}

      <Grid
        args={[span * 1.4, span * 1.4]}
        cellSize={1}
        cellColor="#384150"
        sectionSize={Math.max(1, Math.round(assembly.spacingFt))}
        sectionColor="#4d5a6b"
        position={[0, -0.1, 0]}
        infiniteGrid={false}
      />

      <color attach="background" args={[colors.bgInset]} />

      {viewMode === 'plan' ? (
        <OrbitControls makeDefault target={[0, 6, 0]} minPolarAngle={0} maxPolarAngle={Math.PI / 12} />
      ) : (
        <OrbitControls makeDefault target={[0, 6, 0]} />
      )}
    </>
  );
}

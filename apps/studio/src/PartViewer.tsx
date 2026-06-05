// R3F part gallery: loads the present generated STL meshes and lays them out
// in a grid for comparison. View-mode controls (orbit / map) are chosen by App.
//
// HONESTY: these meshes are source="generated" parametric massing — NOT
// manufacturer-exact. This component only renders what the manifest reports.

import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Grid, MapControls, OrbitControls } from '@react-three/drei';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { Box3, Vector3, type BufferGeometry } from 'three';
import type { PartRecord } from './lib/parts-manifest';
import type { ViewMode } from './lib/view-mode';

const GRID_COLUMNS = 6;
const CELL_SPACING = 3.2;
/** Target bounding-cube edge each part is normalized to, so heterogeneous parts compare. */
const TARGET_SIZE = 2;

interface PartProps {
  part: PartRecord;
  url: string;
  position: [number, number, number];
  selected: boolean;
  onSelect: (part: PartRecord) => void;
}

/**
 * Load one STL imperatively (no Suspense), center it, recompute normals, and
 * bake a normalize-to-unit scale into the geometry so heterogeneous parts
 * compare. Renders nothing until the geometry is ready. Clicking the mesh
 * selects it; the selected mesh is highlighted via emissive color.
 */
function Part({ part, url, position, selected, onSelect }: PartProps): ReactElement | null {
  const [geo, setGeo] = useState<BufferGeometry | null>(null);

  useEffect(() => {
    let alive = true;
    const loader = new STLLoader();
    loader.load(
      url,
      (g) => {
        if (!alive) return;
        g.center();
        g.computeVertexNormals();
        g.computeBoundingBox();
        const box = g.boundingBox ?? new Box3();
        const size = new Vector3();
        box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        const s = TARGET_SIZE / maxDim;
        g.scale(s, s, s);
        setGeo(g);
      },
      undefined,
      (err) => {
        console.error('STL load failed', url, err);
      },
    );
    return () => {
      alive = false;
    };
  }, [url]);

  if (!geo) return null;

  return (
    <mesh
      geometry={geo}
      position={position}
      castShadow
      receiveShadow
      onPointerDown={(e) => {
        e.stopPropagation();
        onSelect(part);
      }}
    >
      <meshStandardMaterial
        color={selected ? '#ffd166' : '#b8c2cc'}
        emissive={selected ? '#7a4f00' : '#000000'}
        emissiveIntensity={selected ? 0.6 : 0}
        metalness={0.35}
        roughness={0.55}
      />
    </mesh>
  );
}

export interface PartGalleryProps {
  parts: PartRecord[];
  viewMode: ViewMode;
  /** Key of the currently selected part, or null. */
  selectedKey: string | null;
  /** Called when a part mesh is clicked. */
  onSelect: (part: PartRecord) => void;
}

/** Lay present parts out in a grid (6 columns), centered on the origin. */
export function PartGallery({
  parts,
  viewMode,
  selectedKey,
  onSelect,
}: PartGalleryProps): ReactElement {
  const placed = useMemo(() => {
    const renderable = parts.filter((p) => p.present && p.stlUrl);
    const rows = Math.ceil(renderable.length / GRID_COLUMNS) || 1;
    return renderable.map((part, i) => {
      const col = i % GRID_COLUMNS;
      const row = Math.floor(i / GRID_COLUMNS);
      const x = (col - (GRID_COLUMNS - 1) / 2) * CELL_SPACING;
      const z = (row - (rows - 1) / 2) * CELL_SPACING;
      const position: [number, number, number] = [x, 0, z];
      return { part, position };
    });
  }, [parts]);

  return (
    <>
      <ambientLight intensity={0.7} />
      <directionalLight position={[10, 18, 8]} intensity={1.2} castShadow />
      <Grid
        args={[40, 40]}
        cellSize={1}
        cellColor="#384150"
        sectionSize={5}
        sectionColor="#4d5a6b"
        position={[0, -1.4, 0]}
      />
      {placed.map(({ part, position }) => (
        <Part
          key={part.key}
          part={part}
          url={part.stlUrl as string}
          position={position}
          selected={part.key === selectedKey}
          onSelect={onSelect}
        />
      ))}
      {viewMode === 'plan' ? (
        <MapControls makeDefault target={[0, 0, 0]} />
      ) : (
        <OrbitControls makeDefault target={[0, 0, 0]} />
      )}
    </>
  );
}

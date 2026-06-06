// Small single-part R3F viewer for the Manufacturer catalog panel. Renders ONE
// resolved STEP body (build123d dimensioned_parametric, or an operator
// manufacturer-step) decoded in-browser via occt-import-js.
//
// HONESTY: this only renders what resolveCatalogGeometry returned. A SKU that
// resolved to "none" never reaches this component (the panel shows an honest
// "no 3D geometry yet" note instead). build123d bodies are dimensioned-parametric
// approximations — NOT manufacturer-exact. The caption preserves that.

import { useEffect, useState, type ReactElement } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Box3, BufferAttribute, BufferGeometry, Vector3 } from 'three';
import { loadStepGeometry } from './lib/step-loader';
import { colors } from './lib/tokens';

const TARGET_SIZE = 2;

function StepMesh({ url }: { url: string }): ReactElement | null {
  const [geo, setGeo] = useState<BufferGeometry | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setGeo(null);
    setFailed(false);
    loadStepGeometry(url)
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
        const s = TARGET_SIZE / maxDim;
        g.scale(s, s, s);
        setGeo(g);
      })
      .catch((err) => {
        if (!alive) return;
        console.error('catalog STEP load failed', url, err);
        setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [url]);

  if (failed || !geo) return null;

  return (
    <mesh geometry={geo} castShadow receiveShadow>
      <meshStandardMaterial color="#b8c2cc" metalness={0.35} roughness={0.55} />
    </mesh>
  );
}

export interface CatalogPartViewerProps {
  /** Resolved STEP asset URL (build123d or manufacturer-step). */
  stepUrl: string;
}

/** A small fixed-height canvas rendering the one resolved STEP body. */
export function CatalogPartViewer({ stepUrl }: CatalogPartViewerProps): ReactElement {
  return (
    <div
      style={{
        height: 220,
        borderRadius: 8,
        overflow: 'hidden',
        background: colors.bgInset,
        border: `1px solid ${colors.border}`,
      }}
      aria-label="Resolved 3D part viewer"
    >
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [3.2, 2.4, 3.2], fov: 45 }}
        key={stepUrl}
      >
        <color attach="background" args={[colors.bgInset]} />
        <ambientLight intensity={0.7} />
        <directionalLight position={[6, 10, 6]} intensity={1.2} castShadow />
        <StepMesh url={stepUrl} />
        <OrbitControls makeDefault enablePan={false} />
      </Canvas>
    </div>
  );
}

// HaloFire CAD — PartViewer3D: a small turntable preview of ONE part body for the
// Inspector. Renders the SAME real CAD model the 3D viewer draws (resolved via
// resolvePartModel -> loadPartGeometry, mm converted to feet), in its CANONICAL
// orientation — no placement rotation. This is a part inspection, not a scene:
// fittings show run +X / branch +Z as modeled; heads get the SAME deflector-down
// flip the main viewer applies so a pendent head reads deflector-down.
//
// PIPE mode: a segment's preview is a diameter-true parametric cylinder — a
// parametric cylinder IS the real geometry of pipe, and the caption says so.
//
// HONESTY: the provenance badge never claims more than the tier earns
// (manufacturer verified / dimensioned parametric — NOT manufacturer-exact /
// proxy — no real body). A load failure draws the amber wireframe proxy box with
// an explicit 'no real body — proxy' note. In jsdom / no-GL environments the
// component renders an honest 'WebGL unavailable' div instead of a Canvas.

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react';
import * as THREE from 'three';
import { Canvas, useFrame } from '@react-three/fiber';
import { loadPartGeometry } from '../lib/part-geometry';
import { colors, radii, spacing, typeScale } from '../lib/tokens';

/** build123d STEP bodies are exported in MILLIMETRES; the preview renders FEET —
 * the SAME conversion Viewer3D applies. */
const MM_PER_FT = 304.8;

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

/** Honest badge text + color per provenance tier. null tier = best-guess
 * geometry the operator should verify. Doctrine: flag, never gate — the lowest
 * tier is still a usable best-effort model, labelled needs-verification, never
 * a dead "no body" state. */
export function provenanceBadge(tier: string | null): { text: string; color: string } {
  if (tier === 'manufacturer_verified') {
    return { text: 'manufacturer verified', color: colors.success };
  }
  if (tier === 'dimensioned_parametric') {
    return {
      text: 'dimensioned parametric — NOT manufacturer-exact',
      color: colors.warn,
    };
  }
  return { text: 'best guess — needs verification', color: colors.warn };
}

export interface PartViewer3DProps {
  /** STEP body url (the SAME url resolvePartModel gave the 3D viewer), or null
   * when no real body resolved (proxy mode). Ignored in pipe-cylinder mode. */
  stepUrl: string | null;
  /** Provenance tier of the shown body — drives the honest badge line. */
  provenanceTier: string | null;
  /** Caption under the preview (what the body is). */
  label: string;
  /** Apply the main viewer's 180° X flip so a pendent head shows deflector-down. */
  deflectorDown?: boolean;
  /** Canonical-orientation note shown under the caption. */
  orientationNote?: string;
  /** PIPE mode: render a diameter-true parametric cylinder (inches) instead of a
   * STEP body — a parametric cylinder is the REAL geometry of pipe. */
  cylinderDiameterIn?: number | null;
}

/** Slow auto-rotate turntable group. */
function Turntable({ children }: { children: ReactNode }): ReactElement {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.6;
  });
  return <group ref={ref}>{children}</group>;
}

/** Neutral studio lighting: hemisphere fill + two directionals (no network HDR). */
function StudioLights(): ReactElement {
  return (
    <>
      <hemisphereLight args={['#dbe4ee', '#23282e', 0.8]} />
      <directionalLight position={[3, 4, 2]} intensity={1.3} />
      <directionalLight position={[-3, 2, -2]} intensity={0.6} />
    </>
  );
}

/** Loaded preview body: feet-space geometry + its bounding-sphere fit. */
interface PreviewBody {
  geo: THREE.BufferGeometry;
  /** Bounding-sphere radius (ft) for fit-to-view. Always finite > 0. */
  radiusFt: number;
}

/** Compute the fit radius from a geometry's bounding sphere (>= a tiny floor). */
function fitRadius(geo: THREE.BufferGeometry): number {
  geo.computeBoundingSphere();
  const r = geo.boundingSphere?.radius ?? 0;
  return Number.isFinite(r) && r > 0 ? r : 0.5;
}

/**
 * Load the STEP body (cached by url via loadPartGeometry — the SAME cache the 3D
 * viewer fills), clone it, convert mm -> feet. failed=true on a real load error
 * so the caller draws the honest proxy box instead.
 */
function useCanonicalBody(stepUrl: string | null): {
  body: PreviewBody | null;
  failed: boolean;
  loading: boolean;
} {
  const [state, setState] = useState<{ body: PreviewBody | null; failed: boolean }>({
    body: null,
    failed: false,
  });

  useEffect(() => {
    if (!stepUrl) {
      setState({ body: null, failed: false });
      return;
    }
    let alive = true;
    setState({ body: null, failed: false });
    loadPartGeometry(stepUrl)
      .then((cached) => {
        if (!alive) return;
        // Clone so the preview's mm->ft scaling never mutates the shared cache.
        const g = cached.clone();
        const s = 1 / MM_PER_FT;
        g.scale(s, s, s);
        g.computeVertexNormals();
        setState({ body: { geo: g, radiusFt: fitRadius(g) }, failed: false });
      })
      .catch((err) => {
        if (!alive) return;
        console.error('PartViewer3D STEP load failed', stepUrl, err);
        setState({ body: null, failed: true });
      });
    return () => {
      alive = false;
    };
  }, [stepUrl]);

  return { body: state.body, failed: state.failed, loading: !!stepUrl && !state.body && !state.failed };
}

/** The amber wireframe proxy box (same visual language as the 3D viewer's proxy). */
function ProxyBox(): ReactElement {
  return (
    <group>
      <mesh>
        <boxGeometry args={[0.6, 0.6, 0.6]} />
        <meshStandardMaterial color="#f0a868" metalness={0} roughness={0.9} transparent opacity={0.5} />
      </mesh>
      <mesh>
        <boxGeometry args={[0.6, 0.6, 0.6]} />
        <meshStandardMaterial color="#f0a868" wireframe />
      </mesh>
    </group>
  );
}

/**
 * The Inspector's mini part viewer. ~220px tall, slow turntable, neutral studio
 * lights, fit-to-view from the body's bounding sphere. See module header for the
 * honesty + canonical-orientation rules.
 */
export function PartViewer3D({
  stepUrl,
  provenanceTier,
  label,
  deflectorDown = false,
  orientationNote,
  cylinderDiameterIn = null,
}: PartViewer3DProps): ReactElement {
  const gl = useMemo(webglAvailable, []);
  const badge = provenanceBadge(provenanceTier);

  // PIPE mode: a diameter-true parametric cylinder (the real geometry of pipe).
  const cylinder = useMemo<PreviewBody | null>(() => {
    if (cylinderDiameterIn == null || !(cylinderDiameterIn > 0)) return null;
    const rFt = cylinderDiameterIn / 2 / 12; // inches -> feet radius (diameter-true)
    const lenFt = Math.max(0.5, rFt * 12); // a short stub of run, proportionate
    const geo = new THREE.CylinderGeometry(rFt, rFt, lenFt, 28);
    // Lay the run along +X (the canonical run axis used by the fitting bodies).
    geo.rotateZ(Math.PI / 2);
    return { geo, radiusFt: fitRadius(geo) };
  }, [cylinderDiameterIn]);

  const isCylinder = cylinder !== null;
  const { body, failed, loading } = useCanonicalBody(isCylinder ? null : stepUrl);
  const shown = isCylinder ? cylinder : body;
  const showProxy = !isCylinder && !loading && (failed || !stepUrl);

  // Fit-to-view: camera distance from the bounding sphere (proxy box r≈0.52 ft).
  const radius = shown?.radiusFt ?? 0.52;
  const dist = radius * 2.7;

  return (
    <div style={blockStyle} data-cad-part-viewer>
      {!gl ? (
        <div style={noGlStyle} data-cad-part-viewer-fallback>
          WebGL unavailable — 3D part preview disabled in this environment.
        </div>
      ) : loading ? (
        <div style={noGlStyle} role="status">
          <span style={spinnerStyle} aria-hidden="true" />
          Loading part body…
        </div>
      ) : (
        <div style={canvasWrapStyle}>
          <Canvas
            key={`${radius.toFixed(4)}:${stepUrl ?? 'cyl'}`}
            dpr={[1, 2]}
            camera={{
              position: [dist, dist * 0.45, dist],
              fov: 38,
              near: Math.max(0.001, radius / 100),
              far: dist * 20,
            }}
          >
            <color attach="background" args={[colors.ground3d]} />
            <StudioLights />
            <Turntable>
              {shown ? (
                <mesh
                  geometry={shown.geo}
                  rotation={deflectorDown ? [Math.PI, 0, 0] : [0, 0, 0]}
                >
                  <meshStandardMaterial color="#c2ccd6" metalness={0.4} roughness={0.5} />
                </mesh>
              ) : (
                <ProxyBox />
              )}
            </Turntable>
          </Canvas>
        </div>
      )}

      <div style={badgeRowStyle}>
        <span
          style={{ ...badgeStyle, color: badge.color, borderColor: badge.color }}
          data-cad-provenance-badge
        >
          {badge.text}
        </span>
      </div>
      {showProxy && <div style={captionStyle}>best-guess geometry — verify against the cut sheet</div>}
      <div style={captionStyle}>{label}</div>
      {orientationNote && <div style={captionStyle}>{orientationNote}</div>}
    </div>
  );
}

/* --------------------------------------------------------------- styles */

const blockStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: spacing[1],
};

const canvasWrapStyle: CSSProperties = {
  height: 220,
  borderRadius: radii.md,
  border: `1px solid ${colors.border}`,
  overflow: 'hidden',
  background: colors.ground3d,
};

const noGlStyle: CSSProperties = {
  height: 220,
  borderRadius: radii.md,
  border: `1px dashed ${colors.border}`,
  background: colors.bgInset,
  color: colors.textMuted,
  fontSize: typeScale.xs.size,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: spacing[1],
  textAlign: 'center',
  padding: spacing[2],
};

const spinnerStyle: CSSProperties = {
  width: 12,
  height: 12,
  borderRadius: '50%',
  border: `2px solid ${colors.border}`,
  borderTopColor: colors.accentText,
  display: 'inline-block',
  animation: 'spin 0.9s linear infinite',
};

const badgeRowStyle: CSSProperties = {
  display: 'flex',
};

const badgeStyle: CSSProperties = {
  border: '1px solid',
  borderRadius: 999,
  padding: `1px ${spacing[2]}`,
  fontSize: typeScale.xs.size,
  fontWeight: 600,
  lineHeight: 1.5,
};

const captionStyle: CSSProperties = {
  color: colors.textMuted,
  fontSize: typeScale.xs.size,
  lineHeight: 1.4,
};

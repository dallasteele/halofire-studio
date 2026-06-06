// HaloFire CAD — Viewer3D (3D). An R3F Canvas showing a ground plane + grid and,
// when no building is loaded, an honest empty state ("No building yet"). When the
// project has geometry this is where walls/heads/pipe render — until then it is
// ground + grid only. Nothing fake is drawn.
//
// ENV-SAFETY: R3F's Canvas needs a WebGL context. In a jsdom test environment
// there is none, so we detect WebGL availability and render the DOM empty-state
// fallback instead of mounting the Canvas. This keeps the App render smoke test
// honest (it asserts the panel chrome, not a GL context).

import {
  useMemo,
  type CSSProperties,
  type ReactElement,
} from 'react';
import { Canvas } from '@react-three/fiber';
import { Grid, OrbitControls } from '@react-three/drei';
import { useCadStore } from '../store';
import { hasBuilding } from '../lib/model';
import { colors, spacing, typeScale } from '../lib/tokens';

/** True when a WebGL context can be created (false in jsdom / headless-no-GL). */
function webglAvailable(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return !!(
      canvas.getContext('webgl2') || canvas.getContext('webgl')
    );
  } catch {
    return false;
  }
}

function GroundScene(): ReactElement {
  return (
    <>
      <color attach="background" args={[colors.ground3d]} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[8, 14, 6]} intensity={1.1} />
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

export function Viewer3D(): ReactElement {
  const project = useCadStore((s) => s.project);
  const loaded = hasBuilding(project);
  const gl = useMemo(webglAvailable, []);

  return (
    <div style={wrapStyle} aria-label="3D building viewer">
      {gl ? (
        <Canvas
          shadows
          dpr={[1, 2]}
          camera={{ position: [12, 10, 12], fov: 45 }}
        >
          <GroundScene />
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

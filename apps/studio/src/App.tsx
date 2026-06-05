// HaloFire Studio — T41 R3F viewer foundation.
// Fetches the parts manifest, renders the present generated STL meshes in a
// full-viewport Canvas, and offers a Plan / 3D view toggle.
//
// HONESTY: every mesh here is source="generated" parametric massing. The UI
// states plainly that these are NOT manufacturer-exact and NOT
// dimensionally-accurate / AHJ / fabrication-ready.

import { Suspense, useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { Canvas } from '@react-three/fiber';
import {
  normalizeManifest,
  presentParts,
  type PartRecord,
  type RawManifest,
} from './lib/parts-manifest';
import {
  cameraConfigFor,
  toggleViewMode,
  type ViewMode,
} from './lib/view-mode';
import { PartGallery } from './PartViewer';

declare global {
  interface Window {
    __studio?: {
      ready: boolean;
      partCount: number;
      presentCount: number;
      viewMode: ViewMode;
    };
  }
}

export function App(): ReactElement {
  const [records, setRecords] = useState<PartRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('perspective');

  useEffect(() => {
    let cancelled = false;
    fetch('/parts/parts-manifest.json')
      .then((r) => {
        if (!r.ok) {
          throw new Error(`manifest fetch failed: ${r.status}`);
        }
        return r.json() as Promise<RawManifest>;
      })
      .then((raw) => {
        if (cancelled) return;
        setRecords(normalizeManifest(raw));
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const present = useMemo(
    () => (records ? presentParts(records) : []),
    [records],
  );

  // Expose state for screenshot / E2E verification once parts are loaded.
  useEffect(() => {
    if (!records) return;
    window.__studio = {
      ready: true,
      partCount: records.length,
      presentCount: present.length,
      viewMode,
    };
  }, [records, present.length, viewMode]);

  // R3F sizes its canvas via ResizeObserver, which can miss the first measure in
  // headless/SSR-hydrated contexts. Kick one resize after mount so the canvas
  // fills its container reliably (no-op in a normal browser that already sized).
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const onToggle = useCallback(() => {
    setViewMode((m) => toggleViewMode(m));
  }, []);

  const cam = useMemo(() => cameraConfigFor(viewMode), [viewMode]);

  return (
    <div style={rootStyle}>
      <header style={toolbarStyle}>
        <strong style={{ fontSize: 15 }}>HaloFire Studio</strong>
        <button type="button" onClick={onToggle} style={toggleBtnStyle}>
          {viewMode === 'plan' ? 'Switch to 3D' : 'Switch to Plan'}
        </button>
        <span style={{ opacity: 0.85 }}>
          {records
            ? `${present.length} present / ${records.length} catalogued · view: ${viewMode}`
            : error
              ? `error: ${error}`
              : 'loading manifest…'}
        </span>
        <span style={provenanceStyle}>
          source: generated · NOT manufacturer-exact · not dimensionally-accurate / AHJ / fabrication-ready
        </span>
      </header>

      <div style={canvasWrapStyle}>
        <Canvas
          shadows
          dpr={[1, 2]}
          gl={{ preserveDrawingBuffer: true }}
          camera={{ position: cam.position, up: cam.up, fov: 45 }}
          key={viewMode}
        >
          <color attach="background" args={['#11161d']} />
          <Suspense fallback={null}>
            <PartGallery parts={present} viewMode={viewMode} />
          </Suspense>
        </Canvas>
      </div>
    </div>
  );
}

const rootStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  fontFamily: 'system-ui, sans-serif',
  color: '#e6edf3',
  background: '#11161d',
};

const toolbarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 16,
  padding: '8px 14px',
  background: '#161c25',
  borderBottom: '1px solid #2a323d',
  flexWrap: 'wrap',
  fontSize: 13,
};

const toggleBtnStyle: React.CSSProperties = {
  background: '#2563eb',
  color: 'white',
  border: 'none',
  borderRadius: 6,
  padding: '6px 12px',
  cursor: 'pointer',
  fontSize: 13,
};

const provenanceStyle: React.CSSProperties = {
  marginLeft: 'auto',
  color: '#f0a868',
  fontSize: 12,
};

const canvasWrapStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
};

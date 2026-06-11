// HaloFire CAD — shared geometry-manifest loading hook. ONE place that loads the
// committed build123d parametric manifest plus any operator-supplied local
// manufacturer-step manifest, so the 3D viewer and the Inspector resolve parts
// against the SAME libraries (lifted out of Viewer3D for the Inspector mini-viewer).
//
// Fail-soft: both manifests default to null/EMPTY, so a missing file degrades
// parts to honest proxies rather than crashing. Nothing is fabricated.

import { useEffect, useState } from 'react';
import {
  loadBuild123dManifest,
  type Build123dManifest,
} from '../../../studio/src/lib/build123d-parts';
import {
  loadManufacturerStepManifest,
  type ManufacturerStepManifest,
} from '../../../studio/src/lib/manufacturer-step';

/** The two geometry libraries a part can resolve against. */
export interface Manifests {
  build123d: Build123dManifest | null;
  manufacturerStep: ManufacturerStepManifest | null;
}

/**
 * Load the committed build123d manifest (and any local manufacturer-step manifest)
 * once per mounted component. Fail-soft: both default to EMPTY, so a missing file
 * degrades parts to proxies rather than crashing. The resolved part counts reflect
 * whatever actually loaded.
 */
export function useManifests(): Manifests {
  const [manifests, setManifests] = useState<Manifests>({
    build123d: null,
    manufacturerStep: null,
  });
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

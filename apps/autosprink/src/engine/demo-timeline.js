/**
 * Demo-mode rise timeline (V2).
 *
 * demoTimeline(elapsedMs, opts) drives a watchable presentation where the
 * building structure rises out of the floor plan first, then the sprinkler
 * system rises into place, while the camera eases into a 3D view. Pure +
 * deterministic so the studio's rAF loop just maps elapsed time -> per-group
 * progress (0..1). Browser-free; no geometry kernel calls.
 */

/** Clamp to [0,1]. */
function clamp01(t) {
  if (!(t > 0)) return 0;
  return t > 1 ? 1 : t;
}

/** Smooth ease-in-out on [0,1] (quadratic). */
export function easeInOut(t) {
  const c = clamp01(t);
  return c < 0.5 ? 2 * c * c : 1 - ((-2 * c + 2) ** 2) / 2;
}

/**
 * @param {number} elapsedMs  time since the demo started.
 * @param {{wallsMs?:number, systemMs?:number, gapMs?:number}} [opts]
 * @returns {{wallsT:number, systemT:number, cameraT:number, done:boolean, totalMs:number}}
 *   wallsT  : structure rise progress 0..1 (phase 1)
 *   systemT : sprinkler-system rise progress 0..1 (phase 2, starts after walls + gap)
 *   cameraT : overall camera-ease progress 0..1 across the whole timeline
 *   done    : true once the full timeline has elapsed
 */
export function demoTimeline(elapsedMs, opts = {}) {
  const wallsMs = opts.wallsMs > 0 ? opts.wallsMs : 1200;
  const systemMs = opts.systemMs > 0 ? opts.systemMs : 1200;
  const gapMs = opts.gapMs >= 0 ? opts.gapMs : 150;
  const t = elapsedMs > 0 ? elapsedMs : 0;

  const sysStart = wallsMs + gapMs;
  const totalMs = sysStart + systemMs;

  return {
    wallsT: easeInOut(t / wallsMs),
    systemT: easeInOut((t - sysStart) / systemMs),
    cameraT: easeInOut(t / totalMs),
    done: t >= totalMs,
    totalMs,
  };
}

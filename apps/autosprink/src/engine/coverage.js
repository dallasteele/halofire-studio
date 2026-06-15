/**
 * HaloFire — Live coverage + NFPA-13 spacing-violation engine (Phase 2, system intelligence).
 *
 * Smart Pipe classifies pipe ROLES; branch-connect proves the network is wired;
 * drop-connect joins each head to a branch. This module answers the question the
 * designer stares at every time a head moves: IS THE FLOOR COVERED, and is every
 * head legally spaced for the hazard?
 *
 * For each sprinkler head it computes a coverage disc — the area that head can
 * actually protect — derived from the hazard's public NFPA-13 standard-spray
 * limits (max protection area + max spacing), NOT a random radius. Then it runs
 * three REAL geometric checks against the NFPA rule for the hazard:
 *
 *   1. TOO CLOSE  — a pair of heads closer than the hazard minimum spacing
 *      (NFPA-13 standard spray: 6 ft). Over-spray / cold-soldering risk.
 *   2. TOO FAR    — a head whose NEAREST neighbour exceeds the hazard maximum
 *      spacing (light/ordinary 15 ft, extra 12 ft). The pair leaves a strip of
 *      ceiling each head is too far apart to jointly wet.
 *   3. GAP        — a sampled point inside the head field that lies outside EVERY
 *      head's coverage disc: unprotected floor with no sprinkler over it.
 *
 * The coverage radius is the half-spacing protection reach: for a square layout
 * at the hazard max spacing S, a head must throw to the mid-point between it and
 * its neighbour (S/2) and the disc must reach the grid corner (S/2 * sqrt2). We
 * use the corner reach so two correctly-spaced heads' discs overlap and leave no
 * gap — exactly the geometry NFPA spacing guarantees. An equivalent-area radius
 * sqrt(maxArea/pi) is also reported for reference.
 *
 * HONESTY: this is the public standard-spray GEOMETRY only — flat smooth ceiling,
 * non-storage, no obstructions, no sloped-ceiling / draft-stop / in-rack rules.
 * Passing it is NOT AHJ approval and NOT a hydraulic pass. Every violation it
 * raises is real (computed against the cited rule); silence is not a guarantee.
 *
 * Pure + deterministic: identical solids+hazard in -> identical coverage out.
 * No DOM, no THREE, no I/O. Unit-tested in tests/coverage.test.js.
 */

import { getHazardRule } from './sprinkler-layout.js';

// NFPA-13 standard-spray minimum head-to-head spacing (ft), all hazards.
export const MIN_SPACING_FT = 6;

const SQRT2 = Math.SQRT2;

function round(n, p = 2) {
  const f = 10 ** p;
  return Math.round((n + Number.EPSILON) * f) / f;
}

function dist2d(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Pull the plan-position {x,y} of every sprinkler head solid. Heads store
 * position as [planX, planY, elevZ]; we ignore Z for the ceiling-plan coverage
 * grid (standard spray protects the floor footprint under the head).
 */
function headsOf(model) {
  const out = [];
  if (!model || !Array.isArray(model.solids)) return out;
  model.solids.forEach((s, i) => {
    if (!s || s.kind !== 'head' || !Array.isArray(s.position)) return;
    const x = s.position[0];
    const y = s.position[1];
    if (typeof x !== 'number' || typeof y !== 'number') return;
    out.push({ x, y, z: s.position[2], name: s.name, hazard: s.hazard, _idx: i });
  });
  return out;
}

/**
 * Resolve the hazard class to size every head's coverage against. Precedence:
 * an explicit per-head s.hazard, then the model's sizing.hazard (what the layout
 * was generated for), then the caller-supplied default, then 'ordinary'.
 */
function resolveHazard(head, model, fallback) {
  const raw = head.hazard
    || (model && model.sizing && model.sizing.hazard)
    || fallback
    || 'ordinary';
  try {
    return getHazardRule(raw);
  } catch (_) {
    return getHazardRule('ordinary');
  }
}

/**
 * The coverage disc for a head at the hazard max spacing S:
 *   - protectRadiusFt = (S/2) * sqrt2  — reach to the square-grid corner so two
 *     correctly-spaced discs overlap and tile the floor with no gap.
 *   - equivAreaRadiusFt = sqrt(maxArea/pi) — the circle of equal area to the
 *     hazard's max protection area, reported for reference.
 */
function discFor(rule) {
  const protectRadiusFt = round((rule.maxSpacingFt / 2) * SQRT2);
  const equivAreaRadiusFt = round(Math.sqrt(rule.maxAreaSqFt / Math.PI));
  return { protectRadiusFt, equivAreaRadiusFt };
}

/**
 * Compute live coverage + spacing violations for a CAD model.
 *
 * @param {object} model     currentCadModel ({solids:[...], sizing?:{hazard}}).
 * @param {string} [hazard]  default hazard class when the model/heads carry none.
 * @param {object} [opts]    { gapSampleFt } grid step for the gap scan (default
 *                           = half the hazard max spacing, clamped to >=2 ft).
 * @returns {{
 *   heads: Array<{x,y,protectRadiusFt,equivAreaRadiusFt,nearestFt,hazard,tooClose,tooFar}>,
 *   violations: Array<{code,severity,kind,detail,a,b,at}>,
 *   maxSpacingFt: number, minSpacingFt: number, hazard: string,
 *   counts: {heads,tooClose,tooFar,gaps,total}, coveredPct: number, gapCells: Array
 * }}
 */
export function computeCoverage(model, hazard, opts = {}) {
  const rawHeads = headsOf(model);
  const fallback = hazard || (model && model.sizing && model.sizing.hazard) || 'ordinary';
  // Hazard used for the FIELD-level checks (gap scan grid, the headline rule).
  let fieldRule;
  try { fieldRule = getHazardRule(fallback); } catch (_) { fieldRule = getHazardRule('ordinary'); }

  const heads = rawHeads.map((h) => {
    const rule = resolveHazard(h, model, fallback);
    const disc = discFor(rule);
    return {
      x: round(h.x), y: round(h.y), z: typeof h.z === 'number' ? round(h.z) : null,
      name: h.name || null,
      hazard: rule.key,
      protectRadiusFt: disc.protectRadiusFt,
      equivAreaRadiusFt: disc.equivAreaRadiusFt,
      maxSpacingFt: rule.maxSpacingFt,
      minSpacingFt: rule.minSpacingFt || MIN_SPACING_FT,
      nearestFt: null,
      nearestName: null,
      tooClose: false,
      tooFar: false,
      _idx: h._idx,
    };
  });

  const violations = [];

  // ── Nearest-neighbour pass: min/max spacing per head, pair violations once ──
  // Pairs are deduped (i<j) so TOO CLOSE / TOO FAR are reported per offending pair.
  for (let i = 0; i < heads.length; i += 1) {
    let nearest = Infinity;
    let nearestJ = -1;
    for (let j = 0; j < heads.length; j += 1) {
      if (i === j) continue;
      const d = dist2d(heads[i], heads[j]);
      if (d < nearest) { nearest = d; nearestJ = j; }
    }
    if (nearestJ >= 0) {
      heads[i].nearestFt = round(nearest);
      heads[i].nearestName = heads[nearestJ].name;
    }
  }

  // Pair checks: walk unordered pairs once. Each head's hazard governs its own
  // minimum; the pair fails TOO CLOSE if the gap is below EITHER head's minimum.
  for (let i = 0; i < heads.length; i += 1) {
    for (let j = i + 1; j < heads.length; j += 1) {
      const d = dist2d(heads[i], heads[j]);
      const minReq = Math.max(heads[i].minSpacingFt, heads[j].minSpacingFt);
      if (d < minReq - 1e-9) {
        heads[i].tooClose = true; heads[j].tooClose = true;
        violations.push({
          code: 'NFPA13_MIN_SPACING', severity: 'fail', kind: 'too-close',
          a: i, b: j,
          at: { x: round((heads[i].x + heads[j].x) / 2), y: round((heads[i].y + heads[j].y) / 2) },
          detail: `heads ${round(d)} ft apart — below the ${minReq} ft minimum spacing`,
        });
      }
    }
  }

  // TOO FAR is a per-head condition on the NEAREST neighbour: if even the closest
  // head exceeds the hazard max spacing, this head is over-spaced (its disc and
  // the neighbour's leave a strip neither can wet). Reported once per head.
  for (let i = 0; i < heads.length; i += 1) {
    const h = heads[i];
    if (h.nearestFt !== null && h.nearestFt > h.maxSpacingFt + 1e-9) {
      h.tooFar = true;
      violations.push({
        code: 'NFPA13_MAX_SPACING', severity: 'fail', kind: 'too-far',
        a: i, b: -1,
        at: { x: h.x, y: h.y },
        detail: `nearest head is ${h.nearestFt} ft away — beyond the ${h.maxSpacingFt} ft max spacing for ${h.hazard} hazard`,
      });
    }
  }

  // ── Coverage-gap scan ──────────────────────────────────────────────────────
  // Sample a grid over the heads' bounding box and flag any cell-centre that is
  // NOT inside ANY head's protection disc. A gap = unprotected floor under the
  // ceiling the heads are meant to cover. Only scan inside the convex extent of
  // the heads (bbox) so we don't flag floor that is simply outside the system.
  const gapCells = [];
  let sampled = 0;
  let covered = 0;
  if (heads.length >= 1) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, maxR = 0;
    for (const h of heads) {
      if (h.x < minX) minX = h.x; if (h.x > maxX) maxX = h.x;
      if (h.y < minY) minY = h.y; if (h.y > maxY) maxY = h.y;
      if (h.protectRadiusFt > maxR) maxR = h.protectRadiusFt;
    }
    // Only meaningful with >=2 heads spanning area; a single head trivially covers
    // its own disc. Pad the box by half a spacing so the field edge is examined.
    const pad = fieldRule.maxSpacingFt / 2;
    minX -= pad; maxX += pad; minY -= pad; maxY += pad;
    const span = Math.max(maxX - minX, maxY - minY);
    if (heads.length >= 2 && span > 1e-6) {
      let step = typeof opts.gapSampleFt === 'number' && opts.gapSampleFt > 0
        ? opts.gapSampleFt
        : Math.max(2, fieldRule.maxSpacingFt / 2);
      // Cap total samples so huge buildings stay responsive (deterministic clamp).
      const MAX_SAMPLES = 20000;
      let nx = Math.floor((maxX - minX) / step) + 1;
      let ny = Math.floor((maxY - minY) / step) + 1;
      if (nx * ny > MAX_SAMPLES) {
        const scale = Math.sqrt((nx * ny) / MAX_SAMPLES);
        step = round(step * scale, 3);
        nx = Math.floor((maxX - minX) / step) + 1;
        ny = Math.floor((maxY - minY) / step) + 1;
      }
      for (let ix = 0; ix < nx; ix += 1) {
        for (let iy = 0; iy < ny; iy += 1) {
          const px = minX + ix * step;
          const py = minY + iy * step;
          sampled += 1;
          let inside = false;
          for (const h of heads) {
            const dx = px - h.x, dy = py - h.y;
            if (dx * dx + dy * dy <= h.protectRadiusFt * h.protectRadiusFt + 1e-9) { inside = true; break; }
          }
          if (inside) {
            covered += 1;
          } else {
            // Only a gap if it sits reasonably WITHIN the head field — i.e. there
            // is a head within ~1.5 max-spacings (else it's just outside the
            // system and not our responsibility to wet).
            let nearestHead = Infinity;
            for (const h of heads) {
              const dd = Math.hypot(px - h.x, py - h.y);
              if (dd < nearestHead) nearestHead = dd;
            }
            if (nearestHead <= fieldRule.maxSpacingFt * 1.5) {
              gapCells.push({ x: round(px), y: round(py), nearestHeadFt: round(nearestHead) });
            }
          }
        }
      }
    }
  }

  for (const g of gapCells) {
    violations.push({
      code: 'NFPA13_COVERAGE_GAP', severity: 'warn', kind: 'gap',
      a: -1, b: -1, at: { x: g.x, y: g.y },
      detail: `no sprinkler disc covers this point (nearest head ${g.nearestHeadFt} ft away)`,
    });
  }

  const counts = {
    heads: heads.length,
    tooClose: heads.filter((h) => h.tooClose).length,
    tooFar: heads.filter((h) => h.tooFar).length,
    gaps: gapCells.length,
    total: violations.length,
  };
  const coveredPct = sampled > 0 ? round((covered / sampled) * 100, 1) : (heads.length ? 100 : 0);

  return {
    heads,
    violations,
    gapCells,
    maxSpacingFt: fieldRule.maxSpacingFt,
    minSpacingFt: fieldRule.minSpacingFt || MIN_SPACING_FT,
    hazard: fieldRule.key,
    counts,
    coveredPct,
    sampled,
  };
}

/**
 * HaloFire NFPA-13 standard-spray compliance checker (internal alpha, best-effort).
 *
 * Given a single laid-out room (the output of layoutRoom) OR a whole building /
 * system layout (a {stories:[{spaces:[...]}]} object whose spaces carry heads),
 * this runs the PUBLIC NFPA-13 standard-spray geometric limits per hazard class
 * and returns a flat list of pass/warn/fail findings plus an overall passed flag.
 *
 * Rules checked (public NFPA-13 standard-spray, smooth flat ceiling, non-storage):
 *   - Max protection area per head:  light 225 / ordinary 130 / extra 100 sqft.
 *   - Max spacing between heads:     light & ordinary 15 ft, extra 12 ft.
 *   - Min spacing between heads:     6 ft (all hazards).
 *   - Max distance to wall:          <= half the max spacing.
 *   - Max coverage per head:         the per-head grid area must not exceed the
 *     hazard's max protection area (re-checked from actual head positions).
 *   - Max heads per system (note):   ~100 for light / ordinary hazard.
 *
 * HONESTY / fail-closed: passing these geometric checks is NOT AHJ approval, NOT
 * a PE review, NOT permit-ready, NOT AutoSprink/AutoCAD parity, and does NOT
 * clear ANY claim/evidence gate. A licensed professional must review the design.
 * Every result carries the NFPA_NOTE saying exactly this, and a 'warn'-severity
 * NFPA13_REVIEW_NOTE finding is always present so the message can never be read
 * as an approval.
 *
 * Deterministic: identical input always yields identical findings.
 */

import { getHazardRule } from './sprinkler-layout.js';

// Min head-to-head spacing (ft), all hazards (NFPA-13 standard spray).
const MIN_SPACING_FT = 6;

// Public NFPA-13 maximum number of sprinklers on a single system, by hazard
// (light & ordinary ~100; extra hazard is lower — 100 for pipe-schedule extra).
const MAX_HEADS_PER_SYSTEM = Object.freeze({ light: 100, ordinary: 100, extra: 100 });

export const NFPA_NOTE =
  'Best-effort geometric NFPA-13 standard-spray check only. Passing these checks '
  + 'is NOT AHJ approval, NOT a PE/professional review, NOT permit-ready, NOT '
  + 'fabrication-ready, and NOT AutoSprink/AutoCAD parity. It clears NO claim '
  + 'gate. A licensed fire-protection professional must review and stamp the '
  + 'design before any regulated use.';

function round(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function finding(code, severity, rule, detail) {
  return { code, severity, rule, detail };
}

/**
 * Check one laid-out space's heads against the hazard's geometric limits.
 * Returns an array of pass/fail findings (no note here — the caller adds it once).
 */
function checkSpace(space, rule, label) {
  const findings = [];
  const heads = Array.isArray(space.heads) ? space.heads : [];
  const where = label ? `${label}: ` : '';
  const maxToWall = round(rule.maxSpacingFt / 2);

  // --- Max coverage area per head -----------------------------------------
  // Prefer an explicit per-head coverage figure; otherwise derive from spacing.
  let coverage = null;
  if (typeof space.coveragePerHeadSqFt === 'number') {
    coverage = space.coveragePerHeadSqFt;
  } else if (typeof space.spacingX === 'number' && typeof space.spacingY === 'number') {
    coverage = space.spacingX * space.spacingY;
  }
  if (coverage !== null && heads.length > 0) {
    if (coverage > rule.maxAreaSqFt + 1e-9) {
      findings.push(finding(
        'NFPA13_MAX_COVERAGE_AREA', 'fail', 'Max protection area per head',
        `${where}coverage ${round(coverage)} sqft/head exceeds ${rule.label} max ${rule.maxAreaSqFt} sqft`,
      ));
    } else {
      findings.push(finding(
        'NFPA13_MAX_COVERAGE_AREA', 'pass', 'Max protection area per head',
        `${where}coverage ${round(coverage)} sqft/head within ${rule.label} max ${rule.maxAreaSqFt} sqft`,
      ));
    }
  }

  // --- Max spacing between adjacent heads ---------------------------------
  // Measure actual nearest-neighbour and same-row gaps from head positions.
  if (heads.length >= 2) {
    let maxGap = 0;
    let minGap = Infinity;
    for (let i = 0; i < heads.length; i += 1) {
      let nearest = Infinity;
      for (let j = 0; j < heads.length; j += 1) {
        if (i === j) continue;
        const d = dist(heads[i], heads[j]);
        if (d < nearest) nearest = d;
      }
      if (nearest > maxGap) maxGap = nearest;
      if (nearest < minGap) minGap = nearest;
    }
    maxGap = round(maxGap);
    minGap = round(minGap);

    if (maxGap > rule.maxSpacingFt + 1e-9) {
      findings.push(finding(
        'NFPA13_MAX_SPACING', 'fail', 'Max spacing between heads',
        `${where}max head spacing ${maxGap} ft exceeds ${rule.label} max ${rule.maxSpacingFt} ft`,
      ));
    } else {
      findings.push(finding(
        'NFPA13_MAX_SPACING', 'pass', 'Max spacing between heads',
        `${where}max head spacing ${maxGap} ft within ${rule.label} max ${rule.maxSpacingFt} ft`,
      ));
    }

    // --- Min spacing between heads (6 ft) ----------------------------------
    if (minGap < MIN_SPACING_FT - 1e-9) {
      findings.push(finding(
        'NFPA13_MIN_SPACING', 'fail', 'Minimum spacing between heads',
        `${where}closest head spacing ${minGap} ft is below the ${MIN_SPACING_FT} ft minimum`,
      ));
    } else {
      findings.push(finding(
        'NFPA13_MIN_SPACING', 'pass', 'Minimum spacing between heads',
        `${where}closest head spacing ${minGap} ft meets the ${MIN_SPACING_FT} ft minimum`,
      ));
    }
  }

  // --- Max distance to wall (<= half max spacing) -------------------------
  // Use the bounding box as a proxy for the enclosing walls.
  const bbox = space.bbox;
  if (bbox && heads.length > 0
    && typeof bbox.minX === 'number' && typeof bbox.maxX === 'number'
    && typeof bbox.minY === 'number' && typeof bbox.maxY === 'number') {
    let worst = 0;
    for (const h of heads) {
      const toWall = Math.min(
        h.x - bbox.minX, bbox.maxX - h.x,
        h.y - bbox.minY, bbox.maxY - h.y,
      );
      if (toWall > worst) worst = toWall;
    }
    worst = round(worst);
    if (worst > maxToWall + 1e-9) {
      findings.push(finding(
        'NFPA13_MAX_DISTANCE_TO_WALL', 'fail', 'Max distance to wall',
        `${where}a head is ${worst} ft from the nearest bounding wall, exceeding the ${maxToWall} ft limit (half of ${rule.maxSpacingFt} ft max spacing)`,
      ));
    } else {
      findings.push(finding(
        'NFPA13_MAX_DISTANCE_TO_WALL', 'pass', 'Max distance to wall',
        `${where}farthest head is ${worst} ft from the nearest bounding wall, within the ${maxToWall} ft limit`,
      ));
    }
  }

  return findings;
}

/**
 * Extract checkable "spaces" from either a single layoutRoom output or a
 * building / system layout. Each returned space carries its own hazard (falling
 * back to the supplied default) plus heads and optional spacing/bbox/coverage.
 */
function collectSpaces(input, defaultHazard) {
  // Building / system-layout shape: { stories: [{ spaces: [...] }] }.
  if (input && Array.isArray(input.stories)) {
    const spaces = [];
    for (const story of input.stories) {
      const storySpaces = Array.isArray(story.spaces) ? story.spaces : [];
      for (const s of storySpaces) {
        spaces.push({
          label: s.name || `level ${story.level ?? '?'}`,
          hazard: s.hazard || (s.sizing && s.sizing.hazard) || defaultHazard,
          heads: s.heads,
          spacingX: s.spacingX,
          spacingY: s.spacingY,
          coveragePerHeadSqFt: s.coveragePerHeadSqFt,
          bbox: s.bbox,
        });
      }
    }
    return spaces;
  }

  // Single laid-out room (layoutRoom output) or a hand-built layout.
  const hazard = (input && input.rule && input.rule.key) || defaultHazard;
  return [{
    label: null,
    hazard,
    heads: input && input.heads,
    spacingX: input && input.spacingX,
    spacingY: input && input.spacingY,
    coveragePerHeadSqFt: input && input.coveragePerHeadSqFt,
    bbox: input && input.bbox,
  }];
}

/**
 * Check a layout or building against public NFPA-13 standard-spray geometric
 * limits.
 *
 * @param {object} layoutOrBuilding layoutRoom output, a hand-built layout
 *   ({heads,spacingX,spacingY,coveragePerHeadSqFt,bbox}), or a building/system
 *   layout ({stories:[{spaces:[...]}]}).
 * @param {string} hazard default hazard class ('light'|'ordinary'|'extra') used
 *   when a space does not carry its own.
 * @returns {{findings:Array<{code,severity,rule,detail}>, passed:boolean, note:string}}
 */
export function checkCompliance(layoutOrBuilding, hazard) {
  // Validate the default hazard up front (throws on unknown class).
  const defaultRule = getHazardRule(hazard);

  const spaces = collectSpaces(layoutOrBuilding, defaultRule.key);
  const findings = [];
  let totalHeads = 0;

  for (const space of spaces) {
    const rule = getHazardRule(space.hazard || defaultRule.key);
    totalHeads += Array.isArray(space.heads) ? space.heads.length : 0;
    findings.push(...checkSpace(space, rule, space.label));
  }

  // --- Max heads per system (note) ----------------------------------------
  // Use the default/most-permissive hazard limit for the system-wide cap.
  const sysMax = MAX_HEADS_PER_SYSTEM[defaultRule.key] ?? 100;
  if (totalHeads > 0) {
    if (totalHeads > sysMax) {
      findings.push(finding(
        'NFPA13_MAX_HEADS_PER_SYSTEM', 'fail', 'Max heads per system',
        `${totalHeads} heads exceed the ~${sysMax}-head ${defaultRule.label} per-system guideline; split into multiple systems`,
      ));
    } else {
      findings.push(finding(
        'NFPA13_MAX_HEADS_PER_SYSTEM', 'pass', 'Max heads per system',
        `${totalHeads} heads within the ~${sysMax}-head ${defaultRule.label} per-system guideline`,
      ));
    }
  }

  // Honesty note: always present, never a 'pass' implying approval.
  findings.push(finding(
    'NFPA13_REVIEW_NOTE', 'warn', 'Professional review required', NFPA_NOTE,
  ));

  const passed = !findings.some((f) => f.severity === 'fail');

  return { findings, passed, note: NFPA_NOTE };
}

// PURE, typed, deterministic system-ASSEMBLY layout — no React / three / DOM.
//
// computeAssembly(spec) lays out a real NFPA-13 wet-pipe branch-line GRID as a
// flat list of typed PlacedPart transforms (position + rotation + length), so the
// AssemblyScene can place real CAD bodies at those transforms. It is the visual
// capstone of the studio: it shows how the parts FIT TOGETHER in the canonical
// supply -> cross_main -> branch_line -> head topology (system-model.ts), with
// heads spaced at the REAL published NFPA-13 maximum spacing for the hazard
// (nfpa13-rules.MAX_SPACING_FT — cited), branch lines spaced at the same rule, a
// tee at every branch tap on the cross main, and an elbow at each branch end.
//
// Each placement carries a partKey + partSource so the renderer can pull the REAL
// geometry: a build123d parametric STEP key (build123d-parts.json) for heads /
// fittings, or an honest PROXY (a clearly-labelled box) for any kind with no real
// body. A proxy NEVER claims a real provenance tier — its provenanceTier is null.
//
// HONESTY (hard, fail-closed): this is a SCHEMATIC DESIGN AID. It is NOT a
// coordinated / clash-checked model, NOT manufacturer-exact geometry, NOT
// AHJ-approved, NOT PE-sealed, NOT code-compliant, and NOT for construction.
//   - Head spacing comes from the real cited nfpa13-rules value, never invented.
//   - Pipe runs are SCHEMATIC routing (cylinders scaled to length), NOT fabricated
//     spool geometry — they are tagged kind:"branch_pipe"/"cross_main"/"riser"
//     with partSource:"schematic" and provenanceTier null.
//   - Any part with no real build123d/catalog geometry is an explicit proxy
//     (partSource:"proxy", provenanceTier null). We never silently fake real CAD.
//   - provenanceTier is ONLY ever what resolveCatalogGeometry would grant for the
//     resolved key (dimensioned_parametric for build123d) — never higher.

import type { ModelStatus } from './provenance';
import {
  MAX_SPACING_FT,
  MIN_HEAD_TO_HEAD_FT,
  NFPA13_DESIGN_AID_DISCLAIMER,
  type HazardClass,
} from './nfpa13-rules';

export { NFPA13_DESIGN_AID_DISCLAIMER };

/** The distinct kinds of part a placement can be. */
export type PlacedPartKind =
  | 'head'
  | 'branch_pipe'
  | 'cross_main'
  | 'riser'
  | 'tee'
  | 'elbow'
  | 'reducer';

export const PLACED_PART_KINDS: readonly PlacedPartKind[] = [
  'head',
  'branch_pipe',
  'cross_main',
  'riser',
  'tee',
  'elbow',
  'reducer',
] as const;

/**
 * Where a placement's geometry comes from:
 *   - "build123d": a real parametric STEP body keyed by partKey (real CAD).
 *   - "schematic": a pipe run drawn as a cylinder scaled to lengthFt — honest
 *     SCHEMATIC routing, NOT fabricated spool geometry.
 *   - "proxy": a clearly-labelled placeholder box — no real geometry exists for
 *     this kind/size. NEVER presented as real CAD.
 */
export type PlacedPartSource = 'build123d' | 'schematic' | 'proxy';

/** One placed part instance with its full transform (feet / radians). */
export interface PlacedPart {
  /** Stable, deterministic id. */
  id: string;
  kind: PlacedPartKind;
  /**
   * The geometry key this placement references:
   *   - a build123d manifest key (e.g. "head_pendent", "fitting_tee") when
   *     partSource === "build123d";
   *   - the same key (for traceability) for schematic pipes — the renderer draws
   *     a cylinder, not this body; provenanceTier stays null;
   *   - a descriptive proxy label when partSource === "proxy".
   */
  partKey: string;
  partSource: PlacedPartSource;
  /** Position in FEET, [x, y, z], grid centered on the origin. */
  position: [number, number, number];
  /** Rotation about Y in RADIANS (yaw). 0 unless the part is directional. */
  rotationY: number;
  /** Run length in FEET — present only for pipe runs (branch_pipe/cross_main/riser). */
  lengthFt?: number;
  /**
   * The provenance tier the resolved geometry earns, or null. ONLY build123d
   * heads/fittings carry "dimensioned_parametric"; schematic pipes and proxies
   * carry null — they make NO real-tier claim. Never exceeds what the resolver
   * would grant for partKey.
   */
  provenanceTier: ModelStatus | null;
}

/** Spec for computeAssembly. */
export interface AssemblySpec {
  /**
   * Chosen head SKU id from the real catalog. Used to resolve the head's real
   * build123d body by (category, nominalSizeIn) via the provided resolver. When
   * the SKU resolves to no real body, heads are placed as honest proxies.
   */
  headSku: string;
  hazard: HazardClass;
  /** Number of branch lines (>= 1). */
  branchCount: number;
  /** Heads per branch line (>= 1). */
  headsPerBranch: number;
  /**
   * The resolved head geometry for the chosen SKU, supplied by the caller (App)
   * via resolveCatalogGeometry. Keeps this module PURE — it never touches the
   * catalog/network. When omitted/none, heads are proxies. The resolver's tier
   * is the CEILING for the head placement's provenanceTier.
   */
  headGeometry?: ResolvedHeadGeometry | null;
}

/**
 * The subset of a resolveCatalogGeometry() result this layout needs. Passing it
 * in (rather than importing the resolver) keeps the module pure + deterministic
 * and lets the head tier be exactly what the resolver granted — never more.
 */
export interface ResolvedHeadGeometry {
  /** "build123d" | "none" (others are not produced for catalog heads here). */
  source: string;
  /** The matched build123d key, when source === "build123d". */
  build123dKey?: string;
  /** The tier the resolver granted, or null. */
  modelStatus: ModelStatus | null;
}

/** The computed assembly. */
export interface Assembly {
  spec: AssemblySpec;
  hazard: HazardClass;
  /** The cited NFPA-13 max spacing (ft) used for head + branch spacing. */
  spacingFt: number;
  /** The citation for the spacing value used. */
  spacingCitation: string;
  /** All placed parts (heads, pipes, fittings). */
  parts: PlacedPart[];
  /** Number of heads placed (= branchCount * headsPerBranch). */
  headsPlaced: number;
  /**
   * True iff at least one placement references REAL geometry (a build123d body).
   * Schematic pipes and proxies alone do NOT count as real geometry.
   */
  usesRealGeometry: boolean;
  /** The honest design-aid disclaimer, restated for the assembly view. */
  disclaimer: string;
}

/** Map a head category to its canonical build123d 1/2" key (for proxy labelling). */
const HEAD_PROXY_LABEL = 'sprinkler_head';

/** build123d fitting keys (present in build123d-parts.json). */
const TEE_KEY = 'fitting_tee';
const ELBOW_KEY = 'fitting_elbow_90';
const REDUCER_KEY = 'fitting_reducer';

/** Deck height (ft) at which mains/branches/heads hang — a notional ceiling plane. */
const DECK_Y = 8;

/** Round to 4 decimals for deterministic, stable transforms. */
function round(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/**
 * Pick the head/branch spacing from the REAL cited NFPA-13 maximum-spacing rule
 * for the hazard. We lay heads at the published MAXIMUM allowable spacing (the
 * widest legal grid) — the value is the real cited constant, never invented. If
 * the rule is somehow null we fail closed to the head-to-head minimum (also a
 * cited constant) rather than fabricate a number.
 */
function spacingForHazard(hazard: HazardClass): { value: number; citation: string } {
  const rule = MAX_SPACING_FT[hazard];
  if (rule && typeof rule.value === 'number') {
    return { value: rule.value, citation: rule.citation };
  }
  const min = MIN_HEAD_TO_HEAD_FT;
  return {
    value: min.value ?? 6,
    citation: min.citation,
  };
}

/**
 * Compute a deterministic system-assembly layout.
 *
 * Geometry (1 ft == 1 scene unit), grid centered on the origin:
 *   - Heads sit on a regular grid: headsPerBranch columns spaced `spacing` ft
 *     along X, branchCount rows spaced `spacing` ft along Z, at DECK_Y.
 *   - Each branch line is a single cross-X pipe run feeding its row of heads.
 *   - The cross main is one Z-running pipe at x = leftmost head column - spacing,
 *     just above the branches, with a TEE at each branch tap and an ELBOW at the
 *     far end of each branch line.
 *   - A REDUCER sits at the cross-main -> branch tap (the main is larger than the
 *     branch), and a short RISER pipe drops into the cross main.
 *
 * Real geometry: heads resolve to a build123d body when headGeometry says so
 * (provenanceTier = the resolver's tier); tees/elbows/reducers reference real
 * build123d fitting keys (dimensioned_parametric). Pipe runs are SCHEMATIC
 * cylinders (partSource "schematic", tier null). Anything without a real body is
 * an honest proxy (partSource "proxy", tier null). Pure + deterministic.
 */
export function computeAssembly(spec: AssemblySpec): Assembly {
  const branchCount = Math.max(1, Math.floor(spec.branchCount));
  const headsPerBranch = Math.max(1, Math.floor(spec.headsPerBranch));
  const { value: spacing, citation: spacingCitation } = spacingForHazard(spec.hazard);

  // Resolve the head body once. The resolver's tier is the CEILING — a head
  // placement can never claim more than resolveCatalogGeometry granted.
  const headGeo = spec.headGeometry ?? null;
  const headIsReal =
    !!headGeo && headGeo.source === 'build123d' && typeof headGeo.build123dKey === 'string';
  const headKey = headIsReal ? (headGeo!.build123dKey as string) : HEAD_PROXY_LABEL;
  const headTier: ModelStatus | null = headIsReal ? (headGeo!.modelStatus ?? null) : null;

  const parts: PlacedPart[] = [];

  // Grid origin: center the head columns on X and the branch rows on Z.
  const xStart = -((headsPerBranch - 1) / 2) * spacing;
  const zStart = -((branchCount - 1) / 2) * spacing;
  // The cross main runs one spacing-step to the "left" (−X) of the first head
  // column, so each branch taps off it and runs to the right across its heads.
  const crossMainX = round(xStart - spacing);
  const crossMainY = DECK_Y + 0.25; // sits just above the branch runs

  for (let b = 0; b < branchCount; b += 1) {
    const branchZ = round(zStart + b * spacing);

    // --- Heads on this branch ---
    for (let h = 0; h < headsPerBranch; h += 1) {
      const headX = round(xStart + h * spacing);
      parts.push({
        id: `head_${b}_${h}`,
        kind: 'head',
        partKey: headKey,
        partSource: headIsReal ? 'build123d' : 'proxy',
        position: [headX, DECK_Y, branchZ],
        // Pendent heads hang DOWN; the scene applies the flip — yaw is 0 here.
        rotationY: 0,
        provenanceTier: headTier,
      });
    }

    // --- Branch line pipe run (schematic): from the cross-main tap across the
    // heads to the last head column. Lies along +X at branchZ. ---
    const branchEndX = round(xStart + (headsPerBranch - 1) * spacing);
    const branchStartX = crossMainX;
    const branchLen = round(branchEndX - branchStartX);
    parts.push({
      id: `branch_pipe_${b}`,
      kind: 'branch_pipe',
      partKey: 'pipe_sch40',
      partSource: 'schematic',
      // Center of the run.
      position: [round((branchStartX + branchEndX) / 2), DECK_Y, branchZ],
      // Run is along X: yaw so the cylinder's length axis points +X.
      rotationY: Math.PI / 2,
      lengthFt: branchLen > 0 ? branchLen : spacing,
      provenanceTier: null,
    });

    // --- Tee at the cross-main tap for this branch (real build123d fitting). ---
    parts.push({
      id: `tee_${b}`,
      kind: 'tee',
      partKey: TEE_KEY,
      partSource: 'build123d',
      position: [crossMainX, crossMainY, branchZ],
      rotationY: 0,
      provenanceTier: 'dimensioned_parametric',
    });

    // --- Reducer at the tap (cross main steps DOWN to branch size). ---
    parts.push({
      id: `reducer_${b}`,
      kind: 'reducer',
      partKey: REDUCER_KEY,
      partSource: 'build123d',
      position: [round(crossMainX + spacing * 0.25), DECK_Y, branchZ],
      rotationY: Math.PI / 2,
      provenanceTier: 'dimensioned_parametric',
    });

    // --- Elbow at the far (downstream) end of the branch line. ---
    parts.push({
      id: `elbow_${b}`,
      kind: 'elbow',
      partKey: ELBOW_KEY,
      partSource: 'build123d',
      position: [branchEndX, DECK_Y, branchZ],
      rotationY: 0,
      provenanceTier: 'dimensioned_parametric',
    });
  }

  // --- Cross main pipe run (schematic): one Z-running pipe spanning all rows. ---
  const crossStartZ = round(zStart - spacing * 0.5);
  const crossEndZ = round(zStart + (branchCount - 1) * spacing + spacing * 0.5);
  const crossLen = round(crossEndZ - crossStartZ);
  parts.push({
    id: 'cross_main',
    kind: 'cross_main',
    partKey: 'pipe_sch10',
    partSource: 'schematic',
    position: [crossMainX, crossMainY, round((crossStartZ + crossEndZ) / 2)],
    // Run is along Z: cylinder default length axis is Y; lay flat along Z (yaw 0
    // after the scene's flat rotation). Encode yaw 0 (Z-aligned in the scene).
    rotationY: 0,
    lengthFt: crossLen > 0 ? crossLen : spacing,
    provenanceTier: null,
  });

  // --- Riser (schematic): a short vertical drop into the cross main. ---
  parts.push({
    id: 'riser',
    kind: 'riser',
    partKey: 'pipe_sch10',
    partSource: 'schematic',
    position: [crossMainX, round(crossMainY + 1.5), crossStartZ],
    rotationY: 0,
    lengthFt: 3,
    provenanceTier: null,
  });

  const headsPlaced = branchCount * headsPerBranch;
  // Real geometry iff any placement references a real build123d body. The fittings
  // (tee/elbow/reducer) are always real build123d bodies, so this is true whenever
  // there is at least one branch; the head being a proxy does NOT erase that, but
  // we report truthfully: usesRealGeometry reflects the actual placed parts.
  const usesRealGeometry = parts.some((p) => p.partSource === 'build123d');

  return {
    spec,
    hazard: spec.hazard,
    spacingFt: spacing,
    spacingCitation,
    parts,
    headsPlaced,
    usesRealGeometry,
    disclaimer: ASSEMBLY_DESIGN_AID_DISCLAIMER,
  };
}

/**
 * The PROMINENT honest banner for the assembly view. Restates, fail-closed, that
 * this is a schematic design aid — NOT a coordinated/clash-checked model, NOT
 * manufacturer-exact, NOT AHJ / PE / code-compliant, NOT for construction.
 */
export const ASSEMBLY_DESIGN_AID_DISCLAIMER =
  'Schematic design-aid assembly from published NFPA-13 spacing + ' +
  'dimensioned-parametric parts. NOT a coordinated/clash-checked model, NOT ' +
  'manufacturer-exact, NOT AHJ-approved, NOT PE-sealed, NOT for construction.';

/** Count placements by kind — exposed for verification / the legend. */
export function summarizeAssembly(assembly: Assembly): {
  byKind: Record<PlacedPartKind, number>;
  total: number;
} {
  const byKind = {
    head: 0,
    branch_pipe: 0,
    cross_main: 0,
    riser: 0,
    tee: 0,
    elbow: 0,
    reducer: 0,
  } as Record<PlacedPartKind, number>;
  for (const p of assembly.parts) byKind[p.kind] += 1;
  return { byKind, total: assembly.parts.length };
}

/** The distinct part sources present in an assembly (for the legend). */
export function assemblyPartSources(assembly: Assembly): PlacedPartSource[] {
  const seen = new Set<PlacedPartSource>();
  for (const p of assembly.parts) seen.add(p.partSource);
  return [...seen];
}

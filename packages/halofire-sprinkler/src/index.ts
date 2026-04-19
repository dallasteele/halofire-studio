/**
 * @halofire/sprinkler — NFPA 13 sprinkler placement + head library
 *
 * This package is the core rules engine for fire sprinkler design.
 * Exposes:
 *   - Hazard classification enums + rule tables from NFPA 13 2022
 *   - Head catalog entries (Victaulic VK102, Tyco TY-FRB, etc.)
 *   - Placement validator: given a head location + ceiling context, returns
 *     PASS/FAIL and a list of rule violations
 *   - Grid helpers for auto-placing heads per spacing rules
 *
 * This file is a stub. Phase 3 of HALOFIRE_ROADMAP.md fills it in.
 */

export { HazardClass } from './hazard-class.js'
export type { Head, HeadOrientation, KFactor } from './head.js'
export type { PlacementContext, PlacementResult } from './placement.js'

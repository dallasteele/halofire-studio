/**
 * Best-effort floor-plan fixtures for the internal-alpha engine.
 *
 * The Home Depot Rexburg plan is a SIMPLIFIED rectangle sized to the proposal
 * square footage (121,500 sqft). It is NOT a surveyed or AHJ-reviewed plan and
 * the hazard classification is an internal-alpha assumption, not an
 * engineering determination. A real plan must replace this fixture and the
 * hazard class must be confirmed by a licensed professional.
 */

import { HOME_DEPOT_PROJECT_NAME } from './evidence-gates.js';

// 300 ft x 405 ft = 121,500 sqft, matching the proposal workbook square footage.
const HOME_DEPOT_WIDTH_FT = 300;
const HOME_DEPOT_DEPTH_FT = 405;

export function homeDepotRexburgFloorPlan() {
  return {
    name: HOME_DEPOT_PROJECT_NAME,
    units: 'ft',
    source: 'simplified rectangle from proposal sqft (121500); not a surveyed plan',
    hazardAssumption: 'ordinary (UNVERIFIED — high-piled storage may require Extra Hazard / ESFR)',
    rooms: [
      {
        name: 'Sales + Warehouse Floor',
        polygon: [
          [0, 0],
          [HOME_DEPOT_WIDTH_FT, 0],
          [HOME_DEPOT_WIDTH_FT, HOME_DEPOT_DEPTH_FT],
          [0, HOME_DEPOT_DEPTH_FT],
        ],
        hazard: 'ordinary',
        ceilingHeightFt: 24,
      },
    ],
  };
}

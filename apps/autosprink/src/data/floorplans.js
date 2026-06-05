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

// The Cooperative 1881 Apartments (1881 West North Temple, Salt Lake City UT;
// GC Kier Construction) is a RESIDENTIAL apartment sprinkler job. There is NO
// DXF (the real plans are PDF only), so this built-in plan is a SIMPLIFIED
// rectangle whose AREA equals the REAL sprinklered square footage from the
// proposal workbook (170,654 sqft, Building (1)!G6). The footprint SHAPE is a
// placeholder — only the area is real-source. The hazard is the residential
// standard-spray class (NOT ESFR); ordinary best matches the real ~120
// sqft/head density (G6/B9). This is NOT a surveyed or AHJ-reviewed plan and
// the hazard class is an internal-alpha assumption, not an engineering
// determination. A real plan must replace this fixture.
export const COOPERATIVE_1881_PROJECT_NAME = 'The Cooperative 1881 - Salt Lake City UT';

// 413 ft x 413.21 ft ≈ 170,654 sqft. Square-ish placeholder footprint; the
// AREA is the real proposal square footage, the SHAPE is a documented stand-in.
const COOPERATIVE_1881_SQFT = 170654;
const COOPERATIVE_1881_WIDTH_FT = 413;
const COOPERATIVE_1881_DEPTH_FT = COOPERATIVE_1881_SQFT / COOPERATIVE_1881_WIDTH_FT;

export function cooperative1881FloorPlan() {
  return {
    name: COOPERATIVE_1881_PROJECT_NAME,
    units: 'ft',
    source:
      'simplified rectangle whose AREA equals the real sprinklered sqft (170654, '
      + 'Building (1)!G6); footprint SHAPE is a placeholder, area is real-source. '
      + 'No DXF exists (PDF plans only).',
    hazardAssumption:
      'ordinary (residential apartment standard-spray, NOT ESFR; matches the real '
      + '~120 sqft/head density — internal-alpha assumption, not an engineering call)',
    rooms: [
      {
        name: 'Residential + Parking/Attic (combined footprint)',
        polygon: [
          [0, 0],
          [COOPERATIVE_1881_WIDTH_FT, 0],
          [COOPERATIVE_1881_WIDTH_FT, COOPERATIVE_1881_DEPTH_FT],
          [0, COOPERATIVE_1881_DEPTH_FT],
        ],
        hazard: 'ordinary',
        ceilingHeightFt: 10,
      },
    ],
  };
}

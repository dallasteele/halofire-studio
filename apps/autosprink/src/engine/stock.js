import { getComponent } from '../components/registry.js';

const STOCK_BY_KEY = Object.freeze({
  riser_assembly: { unit: 'EA', unitCost: 1850, laborHoursPerUnit: 4.5 },
  fdc: { unit: 'EA', unitCost: 650, laborHoursPerUnit: 2.5 },
  valve_alarm_check: { unit: 'EA', unitCost: 900, laborHoursPerUnit: 2.25 },
  backflow_preventer: { unit: 'EA', unitCost: 2400, laborHoursPerUnit: 5.5 },
  riser_trim: { unit: 'EA', unitCost: 320, laborHoursPerUnit: 1.5 },
  drain_main: { unit: 'EA', unitCost: 280, laborHoursPerUnit: 1.25 },
  inspector_test: { unit: 'EA', unitCost: 190, laborHoursPerUnit: 1.0 },
  fitting_tee: { unit: 'EA', unitCost: 42, laborHoursPerUnit: 0.45 },
  fitting_elbow_90: { unit: 'EA', unitCost: 28, laborHoursPerUnit: 0.35 },
  fitting_coupling: { unit: 'EA', unitCost: 12, laborHoursPerUnit: 0.18 },
  fitting_reducer: { unit: 'EA', unitCost: 24, laborHoursPerUnit: 0.3 },
  hanger: { unit: 'EA', unitCost: 18, laborHoursPerUnit: 0.2 },
  seismic_brace: { unit: 'EA', unitCost: 95, laborHoursPerUnit: 0.6 },
});

const STOCK_BY_CATEGORY = Object.freeze({
  heads: { unit: 'EA', unitCost: 18, laborHoursPerUnit: 0.6 },
  fittings: { unit: 'EA', unitCost: 25, laborHoursPerUnit: 0.3 },
  valves: { unit: 'EA', unitCost: 700, laborHoursPerUnit: 1.75 },
  hanger: { unit: 'EA', unitCost: 18, laborHoursPerUnit: 0.2 },
  seismic_brace: { unit: 'EA', unitCost: 95, laborHoursPerUnit: 0.6 },
  pipe: { unit: 'EA', unitCost: 120, laborHoursPerUnit: 0.75 },
});

export function stock(componentKey) {
  const def = getComponent(componentKey);
  const exact = STOCK_BY_KEY[componentKey];
  if (exact) {
    return {
      key: componentKey,
      description: def?.name || componentKey,
      category: def?.category || 'unknown',
      ...exact,
    };
  }

  const byCategory = def ? STOCK_BY_CATEGORY[def.category] : null;
  if (byCategory) {
    return {
      key: componentKey,
      description: def.name,
      category: def.category,
      ...byCategory,
    };
  }

  return {
    key: componentKey,
    description: def?.name || componentKey,
    category: def?.category || 'unknown',
    unit: 'EA',
    unitCost: 50,
    laborHoursPerUnit: 0.25,
  };
}

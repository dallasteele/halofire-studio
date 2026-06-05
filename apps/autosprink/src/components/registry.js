/**
 * Canonical fire-sprinkler component registry + AutoSprink parity inventory.
 *
 * This is the single source of truth for *every* module/component a sprinkler
 * layout or bid needs to be considered "complete". It is a catalog of what
 * SHOULD exist — it does NOT itself contain 3D models. Whether a given component
 * actually has a usable model is decided elsewhere (the model resolver, T16) and
 * fed in here as `modelStatusByKey`.
 *
 * HONESTY / fail-closed: a component only counts as "present" when its resolved
 * status is a REAL source ('catalog' or 'generated') AND carries an actual
 * model. A bare 'placeholder'/'missing' status, or a 'catalog' flag with no
 * model, is counted as MISSING. The AUTOSPRINK_PARITY gate stays BLOCKED until
 * every required component has a genuine model with real evidence. We never
 * claim AutoSprink / AutoCAD / manufacturer parity or AHJ/PE approval from this
 * module.
 *
 * Pure, deterministic, browser-free.
 */

/** A model source counts as "real" only if it is one of these. */
const REAL_SOURCES = Object.freeze(['catalog', 'generated']);

/** Deep-freeze a component entry (including its params) before export. */
function freezeComponent(c) {
  Object.freeze(c.params);
  return Object.freeze(c);
}

/**
 * Canonical component inventory. Each entry:
 *   { key, category, name, params:{...nominal sizes/options}, required:boolean }
 *
 * `required` marks the components without which a layout/bid cannot be claimed
 * complete (and therefore which gate AutoSprink parity). Optional members are
 * still inventoried so the parity matrix is exhaustive.
 */
export const COMPONENTS = Object.freeze(
  [
    // ---- Sprinkler heads -------------------------------------------------
    {
      key: 'head_pendent',
      category: 'heads',
      name: 'Pendent sprinkler head',
      params: { kFactors: [5.6, 8.0], thread: '1/2 NPT', orientation: 'pendent', response: ['standard', 'quick'] },
      required: true,
    },
    {
      key: 'head_upright',
      category: 'heads',
      name: 'Upright sprinkler head',
      params: { kFactors: [5.6, 8.0], thread: '1/2 NPT', orientation: 'upright', response: ['standard', 'quick'] },
      required: true,
    },
    {
      key: 'head_sidewall',
      category: 'heads',
      name: 'Sidewall sprinkler head',
      params: { kFactors: [5.6, 8.0], thread: '1/2 NPT', orientation: 'horizontal_sidewall' },
      required: true,
    },
    {
      key: 'head_concealed',
      category: 'heads',
      name: 'Concealed pendent sprinkler head',
      params: { kFactors: [5.6], thread: '1/2 NPT', orientation: 'pendent', coverPlate: true },
      required: true,
    },
    {
      key: 'head_dry_pendent',
      category: 'heads',
      name: 'Dry pendent sprinkler head',
      params: { kFactors: [5.6], thread: '1 NPT', orientation: 'pendent', barrelLengthsIn: [12, 18, 24, 36, 48] },
      required: false,
    },
    {
      key: 'head_esfr',
      category: 'heads',
      name: 'ESFR storage sprinkler head',
      params: { kFactors: [14.0, 16.8, 25.2], thread: '3/4 NPT', orientation: 'pendent', application: 'storage' },
      required: false,
    },

    // ---- Pipe ------------------------------------------------------------
    {
      key: 'pipe_sch10',
      category: 'pipe',
      name: 'Schedule 10 steel pipe',
      params: { schedule: '10', material: 'steel', nominalSizesIn: [1, 1.25, 1.5, 2, 2.5, 3, 4, 6] },
      required: true,
    },
    {
      key: 'pipe_sch40',
      category: 'pipe',
      name: 'Schedule 40 steel pipe',
      params: { schedule: '40', material: 'steel', nominalSizesIn: [1, 1.25, 1.5, 2, 2.5, 3, 4, 6, 8] },
      required: true,
    },

    // ---- Threaded / welded fittings -------------------------------------
    { key: 'fitting_tee', category: 'fittings', name: 'Tee', params: { nominalSizesIn: [1, 1.25, 1.5, 2, 2.5, 3, 4], reducing: true }, required: true },
    { key: 'fitting_elbow_90', category: 'fittings', name: '90° elbow', params: { nominalSizesIn: [1, 1.25, 1.5, 2, 2.5, 3, 4], angleDeg: 90 }, required: true },
    { key: 'fitting_elbow_45', category: 'fittings', name: '45° elbow', params: { nominalSizesIn: [1, 1.25, 1.5, 2, 2.5, 3, 4], angleDeg: 45 }, required: true },
    { key: 'fitting_coupling', category: 'fittings', name: 'Coupling', params: { nominalSizesIn: [1, 1.25, 1.5, 2, 2.5, 3, 4] }, required: true },
    { key: 'fitting_reducer', category: 'fittings', name: 'Reducer', params: { nominalSizesIn: [1.25, 1.5, 2, 2.5, 3, 4], concentric: true }, required: true },
    { key: 'fitting_cap', category: 'fittings', name: 'Cap', params: { nominalSizesIn: [1, 1.25, 1.5, 2, 2.5, 3, 4] }, required: true },
    { key: 'fitting_cross', category: 'fittings', name: 'Cross', params: { nominalSizesIn: [2, 2.5, 3, 4] }, required: false },

    // ---- Grooved (Victaulic-style) couplings ----------------------------
    { key: 'grooved_coupling', category: 'grooved', name: 'Grooved coupling', params: { nominalSizesIn: [2, 2.5, 3, 4, 6, 8], type: ['rigid', 'flexible'] }, required: true },
    { key: 'grooved_flange_adapter', category: 'grooved', name: 'Grooved flange adapter', params: { nominalSizesIn: [2.5, 3, 4, 6, 8], flangeClass: 150 }, required: false },

    // ---- Valves ----------------------------------------------------------
    { key: 'valve_alarm_check', category: 'valves', name: 'Alarm check valve', params: { nominalSizesIn: [2.5, 3, 4, 6], service: 'wet' }, required: true },
    { key: 'valve_check', category: 'valves', name: 'Check valve', params: { nominalSizesIn: [2, 2.5, 3, 4, 6], style: 'swing' }, required: true },
    { key: 'valve_butterfly', category: 'valves', name: 'Butterfly valve (supervised)', params: { nominalSizesIn: [2, 2.5, 3, 4, 6, 8], supervised: true, tamperSwitch: true }, required: true },
    { key: 'valve_osy_gate', category: 'valves', name: 'OS&Y gate valve', params: { nominalSizesIn: [2.5, 3, 4, 6, 8], indicating: true }, required: true },
    { key: 'valve_prv', category: 'valves', name: 'Pressure reducing valve', params: { nominalSizesIn: [2.5, 3, 4, 6], maxInletPsi: 300 }, required: false },
    { key: 'valve_deluge', category: 'valves', name: 'Deluge valve', params: { nominalSizesIn: [3, 4, 6], service: 'deluge' }, required: false },

    // ---- Standalone system assemblies / appliances ----------------------
    { key: 'fdc', category: 'fdc', name: 'Fire department connection', params: { type: ['freestanding', 'wall'], inlets: 2, threadInlet: '2.5 NST', outletSizeIn: 4 }, required: true },
    { key: 'backflow_preventer', category: 'backflow_preventer', name: 'Backflow preventer (double-check / RPZ)', params: { nominalSizesIn: [2, 2.5, 3, 4, 6], type: ['double_check', 'rpz'] }, required: true },
    { key: 'riser_assembly', category: 'riser_assembly', name: 'System riser assembly', params: { nominalSizesIn: [2.5, 3, 4, 6], service: ['wet', 'dry'] }, required: true },
    { key: 'riser_trim', category: 'riser_trim', name: 'Riser trim kit', params: { includes: ['gauges', 'test_valve', 'drain', 'retard_chamber'] }, required: true },

    // ---- Instrumentation / supports / identification --------------------
    { key: 'gauge', category: 'gauge', name: 'Pressure gauge', params: { rangePsi: [0, 300], faceDiameterIn: 3.5, connectionIn: 0.25 }, required: true },
    { key: 'hanger', category: 'hanger', name: 'Pipe hanger', params: { nominalSizesIn: [1, 1.25, 1.5, 2, 2.5, 3, 4, 6], type: ['clevis', 'adjustable_swivel_ring'] }, required: true },
    { key: 'seismic_brace', category: 'seismic_brace', name: 'Seismic sway brace', params: { nominalSizesIn: [1, 1.25, 1.5, 2, 2.5, 3, 4], type: ['lateral', 'longitudinal', '4-way'] }, required: false },

    // ---- Drains ----------------------------------------------------------
    { key: 'drain_main', category: 'drain', name: 'Main drain', params: { nominalSizesIn: [2, 2.5], discharge: 'exterior' }, required: true },
    { key: 'drain_aux', category: 'drain', name: 'Auxiliary / low-point drain', params: { nominalSizesIn: [0.75, 1, 1.25], discharge: 'bucket' }, required: false },

    // ---- Testing + signage ----------------------------------------------
    { key: 'inspector_test', category: 'inspector_test', name: 'Inspector test connection', params: { orificeIn: 0.5, sightGlass: true, discharge: 'exterior' }, required: true },
    { key: 'identification_sign', category: 'identification_sign', name: 'Identification / hydraulic data sign', params: { types: ['control_valve', 'main_drain', 'hydraulic_placard'], material: 'rigid_plastic' }, required: true },
  ].map(freezeComponent)
);

/** Index by key for O(1) lookup. */
const BY_KEY = new Map(COMPONENTS.map((c) => [c.key, c]));

/** Return the component entry for `key`, or undefined if unknown. */
export function getComponent(key) {
  return BY_KEY.get(key);
}

/** Group components by category -> { [category]: Component[] }. */
export function componentsByCategory() {
  const out = {};
  for (const c of COMPONENTS) {
    (out[c.category] ||= []).push(c);
  }
  return out;
}

/**
 * A status entry counts as a real, present model only when its source is one of
 * REAL_SOURCES AND it carries an actual model. Everything else (missing,
 * placeholder, a real source with no model, undefined) is MISSING.
 */
function hasRealModel(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (!REAL_SOURCES.includes(entry.source)) return false;
  return entry.model != null && entry.model !== '';
}

/**
 * Build the AutoSprink parity inventory from a per-component model status map.
 *
 * @param {Record<string, {source?:string, model?:unknown}>} [modelStatusByKey]
 * @returns {{ total:number, present:number, missing:string[],
 *   byCategory:Record<string,{present:number,total:number,missing:string[]}>,
 *   parityComplete:boolean }}
 *
 * parityComplete is true only when EVERY required component has a real model.
 */
export function buildParityInventory(modelStatusByKey = {}) {
  const status = modelStatusByKey || {};
  const missing = [];
  const byCategory = {};
  let present = 0;
  let requiredMissing = 0;

  for (const c of COMPONENTS) {
    const cat = (byCategory[c.category] ||= { present: 0, total: 0, missing: [] });
    cat.total += 1;
    if (hasRealModel(status[c.key])) {
      present += 1;
      cat.present += 1;
    } else {
      missing.push(c.key);
      cat.missing.push(c.key);
      if (c.required) requiredMissing += 1;
    }
  }

  return {
    total: COMPONENTS.length,
    present,
    missing,
    byCategory,
    parityComplete: requiredMissing === 0,
  };
}

/**
 * Fail-closed claim gate for AutoSprink parity. Stays BLOCKED until the
 * component inventory is genuinely complete with real models/evidence. This
 * descriptor is the default (blocked) state; use parityGateStatus(inventory)
 * to derive the live status from a built inventory.
 */
export const AUTOSPRINK_PARITY_GATE = Object.freeze({
  code: 'AUTOSPRINK_PARITY_INCOMPLETE',
  severity: 'blocking',
  status: 'blocked',
  blockedClaims: Object.freeze([
    'AutoSprink parity',
    'complete component library',
    'manufacturer-exact models',
  ]),
  reason:
    'Component model inventory is incomplete: one or more required fire-sprinkler ' +
    'components have no real (catalog/generated) model with evidence. Generated ' +
    '(OpenSCAD/SAM) models are best-effort, not manufacturer-exact. No AutoSprink/' +
    'AutoCAD/manufacturer parity and no AHJ/PE approval is claimed.',
});

/**
 * Live gate status derived from a parity inventory: 'clear' only when the
 * inventory is genuinely complete, otherwise 'blocked' (fail-closed).
 *
 * @param {{parityComplete?:boolean}} [inventory]
 * @returns {'clear'|'blocked'}
 */
export function parityGateStatus(inventory) {
  return inventory && inventory.parityComplete === true ? 'clear' : 'blocked';
}

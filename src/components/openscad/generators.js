/**
 * OpenSCAD parametric generators (T17).
 *
 * Deterministic, browser-free functions that return OpenSCAD (.scad) SOURCE
 * STRINGS for fire-sprinkler component types from their params. Each generator
 * emits valid, parametric .scad text with a commented header that names the
 * component AND states plainly that the geometry is a BEST-EFFORT representation,
 * NOT manufacturer-exact.
 *
 * HONESTY / fail-closed:
 *   - Generated geometry is approximate primitive massing for visualization and
 *     take-off context only. It is explicitly NOT manufacturer-exact and confers
 *     NO AutoSprink / AutoCAD / manufacturer parity and NO AHJ/PE approval.
 *   - generateScadFor returns null for component categories we cannot model
 *     (no fake geometry is invented).
 *   - renderScadToStl NEVER spawns a process here. The real `openscad` CLI is an
 *     external binary that the caller injects as `runner`. With no runner we fail
 *     closed to { ok:false, reason:'openscad_not_installed' }; a throwing runner
 *     fails closed to { ok:false, reason:'render_failed' } — success is never
 *     fabricated.
 *
 * All dimensions are in millimetres in the emitted .scad (OpenSCAD is unitless;
 * we standardize on mm and convert nominal inches / feet at generation time).
 */

const IN_TO_MM = 25.4;
const FT_TO_MM = 304.8;
/** Smooth-enough facet count for round bodies. */
const FN = 48;

/** Coerce to a finite positive number with a fallback. */
function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** First element of an array-or-scalar, else the value itself. */
function first(value, fallback) {
  if (Array.isArray(value)) return value.length ? value[0] : fallback;
  return value == null ? fallback : value;
}

/**
 * Standard commented header naming the component and the honesty disclaimer.
 * Every generator embeds this so the .scad text is self-documenting.
 */
function header(title, detailLines = []) {
  const lines = [
    `// ${title}`,
    '// HaloFire OpenSCAD generator (T17) — BEST-EFFORT parametric representation.',
    '// This is approximate massing for visualization/take-off context ONLY.',
    '// It is NOT manufacturer-exact geometry and confers NO AutoSprink / AutoCAD /',
    '// manufacturer parity and NO AHJ/PE approval.',
    ...detailLines.map((l) => `// ${l}`),
    `$fn = ${FN};`,
    '',
  ];
  return lines.join('\n');
}

/**
 * Sprinkler head — body cylinder + deflector disc + threaded nipple stub.
 * @param {{type?:string,k?:number,thread?:string}} p
 */
export function sprinklerHeadScad(p = {}) {
  const type = first(p.type, 'pendent');
  const k = num(p.k, 5.6);
  const thread = p.thread || '1/2 NPT';
  // Orifice diameter scales loosely with K-factor (visual only, not hydraulic).
  const orificeMm = (3 + k * 0.6).toFixed(2);
  const bodyDia = (Number(orificeMm) * 2.2).toFixed(2);
  const bodyH = (16).toFixed(2);
  const deflectorDia = (Number(bodyDia) * 1.6).toFixed(2);
  const flip = type === 'upright' ? 'rotate([180, 0, 0])' : '';
  return (
    header(`Sprinkler head — ${type}, K=${k}, thread ${thread}`, [
      `orifice ~${orificeMm}mm (derived from K, visual only)`,
    ]) +
    [
      `module sprinkler_head() {`,
      `  ${flip} union() {`,
      `    // body`,
      `    cylinder(h = ${bodyH}, d = ${bodyDia});`,
      `    // threaded nipple stub (${thread})`,
      `    translate([0, 0, ${bodyH}]) cylinder(h = 8, d = ${(Number(bodyDia) * 0.7).toFixed(2)});`,
      `    // deflector disc`,
      `    translate([0, 0, -2]) cylinder(h = 2, d = ${deflectorDia});`,
      `  }`,
      `}`,
      `sprinkler_head();`,
      '',
    ].join('\n')
  );
}

/**
 * Straight pipe — hollow cylinder of nominal bore over a run length.
 * @param {{nominalIn?:number,lengthFt?:number,schedule?:string}} p
 */
export function pipeScad(p = {}) {
  const nominalIn = num(p.nominalIn, 2);
  const lengthFt = num(p.lengthFt, 10);
  const schedule = String(p.schedule == null ? '40' : p.schedule);
  const od = (nominalIn * IN_TO_MM * 1.05).toFixed(2);
  // Wall thickness loosely larger for sch40 than sch10 (visual only).
  const wall = (schedule === '10' ? 2.5 : 3.5).toFixed(2);
  const bore = (Number(od) - 2 * Number(wall)).toFixed(2);
  const lengthMm = (lengthFt * FT_TO_MM).toFixed(2);
  return (
    header(`Pipe — Schedule ${schedule}, ${nominalIn}" nominal, ${lengthFt} ft`, [
      `OD ~${od}mm, wall ~${wall}mm (visual only)`,
    ]) +
    [
      `module pipe() {`,
      `  difference() {`,
      `    cylinder(h = ${lengthMm}, d = ${od});`,
      `    translate([0, 0, -1]) cylinder(h = ${(Number(lengthMm) + 2).toFixed(2)}, d = ${bore});`,
      `  }`,
      `}`,
      `pipe();`,
      '',
    ].join('\n')
  );
}

/**
 * Tee — run cylinder with a perpendicular branch cylinder.
 * @param {{runIn?:number,branchIn?:number}} p
 */
export function teeScad(p = {}) {
  const runIn = num(p.runIn, 2);
  const branchIn = num(p.branchIn, runIn);
  const runD = (runIn * IN_TO_MM * 1.1).toFixed(2);
  const branchD = (branchIn * IN_TO_MM * 1.1).toFixed(2);
  const runL = (runIn * IN_TO_MM * 3).toFixed(2);
  const branchL = (branchIn * IN_TO_MM * 1.8).toFixed(2);
  return (
    header(`Tee — run ${runIn}", branch ${branchIn}"`, ['fitting massing (visual only)']) +
    [
      `module tee() {`,
      `  union() {`,
      `    // run`,
      `    rotate([0, 90, 0]) translate([0, 0, ${(-Number(runL) / 2).toFixed(2)}]) cylinder(h = ${runL}, d = ${runD});`,
      `    // branch`,
      `    cylinder(h = ${branchL}, d = ${branchD});`,
      `  }`,
      `}`,
      `tee();`,
      '',
    ].join('\n')
  );
}

/**
 * Elbow — two cylinder legs joined at the requested angle.
 * @param {{nominalIn?:number,deg?:number}} p
 */
export function elbowScad(p = {}) {
  const nominalIn = num(p.nominalIn, 2);
  const deg = num(p.deg, 90);
  const d = (nominalIn * IN_TO_MM * 1.1).toFixed(2);
  const leg = (nominalIn * IN_TO_MM * 1.8).toFixed(2);
  return (
    header(`Elbow — ${nominalIn}", ${deg} degrees`, ['fitting massing (visual only)']) +
    [
      `module elbow() {`,
      `  union() {`,
      `    // first leg`,
      `    cylinder(h = ${leg}, d = ${d});`,
      `    // sphere at the bend`,
      `    translate([0, 0, ${leg}]) sphere(d = ${d});`,
      `    // second leg at ${deg} degrees`,
      `    translate([0, 0, ${leg}]) rotate([${deg}, 0, 0]) cylinder(h = ${leg}, d = ${d});`,
      `  }`,
      `}`,
      `elbow();`,
      '',
    ].join('\n')
  );
}

/**
 * Coupling — short sleeve over the nominal pipe OD.
 * @param {{nominalIn?:number}} p
 */
export function couplingScad(p = {}) {
  const nominalIn = num(p.nominalIn, 2);
  const od = (nominalIn * IN_TO_MM * 1.25).toFixed(2);
  const bore = (nominalIn * IN_TO_MM * 1.05).toFixed(2);
  const len = (nominalIn * IN_TO_MM * 1.2).toFixed(2);
  return (
    header(`Coupling — ${nominalIn}"`, ['sleeve massing (visual only)']) +
    [
      `module coupling() {`,
      `  difference() {`,
      `    cylinder(h = ${len}, d = ${od});`,
      `    translate([0, 0, -1]) cylinder(h = ${(Number(len) + 2).toFixed(2)}, d = ${bore});`,
      `  }`,
      `}`,
      `coupling();`,
      '',
    ].join('\n')
  );
}

/**
 * Reducer — tapered sleeve from one nominal size to another.
 * @param {{fromIn?:number,toIn?:number}} p
 */
export function reducerScad(p = {}) {
  const fromIn = num(p.fromIn, 2);
  const toIn = num(p.toIn, 1.5);
  const d1 = (fromIn * IN_TO_MM * 1.15).toFixed(2);
  const d2 = (toIn * IN_TO_MM * 1.15).toFixed(2);
  const len = (Math.max(fromIn, toIn) * IN_TO_MM * 1.5).toFixed(2);
  return (
    header(`Reducer — ${fromIn}" to ${toIn}"`, ['concentric taper massing (visual only)']) +
    [
      `module reducer() {`,
      `  cylinder(h = ${len}, d1 = ${d1}, d2 = ${d2});`,
      `}`,
      `reducer();`,
      '',
    ].join('\n')
  );
}

/**
 * Valve — body box/cylinder with two flange discs and a stem.
 * @param {{type?:string,nominalIn?:number}} p
 */
export function valveScad(p = {}) {
  const type = p.type || 'check';
  const nominalIn = num(p.nominalIn, 2);
  const bodyD = (nominalIn * IN_TO_MM * 1.6).toFixed(2);
  const flangeD = (nominalIn * IN_TO_MM * 2.2).toFixed(2);
  const bodyH = (nominalIn * IN_TO_MM * 1.4).toFixed(2);
  const stemH = (nominalIn * IN_TO_MM * 1.2).toFixed(2);
  return (
    header(`Valve — ${type}, ${nominalIn}"`, ['valve body massing (visual only)']) +
    [
      `module valve() {`,
      `  union() {`,
      `    // body`,
      `    cylinder(h = ${bodyH}, d = ${bodyD});`,
      `    // inlet flange`,
      `    cylinder(h = 6, d = ${flangeD});`,
      `    // outlet flange`,
      `    translate([0, 0, ${(Number(bodyH) - 6).toFixed(2)}]) cylinder(h = 6, d = ${flangeD});`,
      `    // stem / handwheel post (${type})`,
      `    translate([0, 0, ${bodyH}]) cylinder(h = ${stemH}, d = ${(Number(bodyD) * 0.3).toFixed(2)});`,
      `  }`,
      `}`,
      `valve();`,
      '',
    ].join('\n')
  );
}

/**
 * Hanger — clevis-style ring strap around the nominal pipe OD.
 * @param {{nominalIn?:number}} p
 */
export function hangerScad(p = {}) {
  const nominalIn = num(p.nominalIn, 2);
  const ringOd = (nominalIn * IN_TO_MM * 1.4).toFixed(2);
  const ringId = (nominalIn * IN_TO_MM * 1.1).toFixed(2);
  const width = (8).toFixed(2);
  const rodH = (nominalIn * IN_TO_MM * 2).toFixed(2);
  return (
    header(`Hanger — ${nominalIn}" pipe`, ['clevis ring + rod massing (visual only)']) +
    [
      `module hanger() {`,
      `  union() {`,
      `    // ring strap`,
      `    difference() {`,
      `      cylinder(h = ${width}, d = ${ringOd});`,
      `      translate([0, 0, -1]) cylinder(h = ${(Number(width) + 2).toFixed(2)}, d = ${ringId});`,
      `    }`,
      `    // hanger rod`,
      `    translate([0, 0, ${width}]) cylinder(h = ${rodH}, d = 9.5);`,
      `  }`,
      `}`,
      `hanger();`,
      '',
    ].join('\n')
  );
}

/** Pick the first present numeric size out of an array param or a scalar. */
function sizeOf(params, fallback) {
  if (!params) return fallback;
  if (Array.isArray(params.nominalSizesIn) && params.nominalSizesIn.length) {
    return params.nominalSizesIn[0];
  }
  return num(params.nominalIn, fallback);
}

/**
 * Dispatch a registry-style component to the right generator and return its
 * .scad source — or null when we have no honest parametric model for it.
 *
 * @param {{key?:string, category?:string, name?:string, params?:object}} component
 * @returns {string|null}
 */
export function generateScadFor(component) {
  if (!component || typeof component !== 'object') return null;
  const { key, category, name, params = {} } = component;

  switch (category) {
    case 'heads': {
      const type = params.type || params.orientation || 'pendent';
      const k = first(params.kFactors, params.k);
      return sprinklerHeadScad({ type, k, thread: params.thread });
    }
    case 'pipe':
      return pipeScad({
        nominalIn: sizeOf(params, 2),
        lengthFt: num(params.lengthFt, 10),
        schedule: params.schedule,
      });
    case 'fittings': {
      const size = sizeOf(params, 2);
      if (key === 'fitting_tee' || /tee/i.test(name || '')) {
        return teeScad({ runIn: size, branchIn: num(params.branchIn, size) });
      }
      if (key === 'fitting_elbow_90' || key === 'fitting_elbow_45' || /elbow/i.test(name || '')) {
        return elbowScad({ nominalIn: size, deg: num(params.angleDeg, 90) });
      }
      if (key === 'fitting_coupling' || /coupling/i.test(name || '')) {
        return couplingScad({ nominalIn: size });
      }
      if (key === 'fitting_reducer' || /reducer/i.test(name || '')) {
        const sizes = Array.isArray(params.nominalSizesIn) ? params.nominalSizesIn : [size, size];
        return reducerScad({ fromIn: sizes[0], toIn: sizes[1] != null ? sizes[1] : sizes[0] });
      }
      return null;
    }
    case 'grooved':
      return couplingScad({ nominalIn: sizeOf(params, 2) });
    case 'valves':
      return valveScad({
        type: params.type || (name ? String(name).split(' ')[0].toLowerCase() : 'check'),
        nominalIn: sizeOf(params, 2),
      });
    case 'hanger':
      return hangerScad({ nominalIn: sizeOf(params, 2) });
    default:
      // No honest parametric massing for this category (e.g. signs, trim kits) —
      // fail closed rather than invent fake geometry.
      return null;
  }
}

/**
 * Render .scad source to STL using an INJECTED runner. This function NEVER
 * spawns a process itself — the real `openscad` CLI is external and lives behind
 * `runner`, supplied by the caller (e.g. an adapter that shells out only when
 * the binary is genuinely installed).
 *
 * @param {string} scad  OpenSCAD source text.
 * @param {{runner?:(scad:string)=>Promise<{stl:string}|string>}} [opts]
 * @returns {Promise<{ok:true, stl:string} | {ok:false, reason:string}>}
 *
 * - No runner injected -> { ok:false, reason:'openscad_not_installed' } (fail-closed).
 * - Runner throws       -> { ok:false, reason:'render_failed' } (never fabricates success).
 */
export async function renderScadToStl(scad, opts = {}) {
  const runner = opts && opts.runner;
  if (typeof runner !== 'function') {
    return { ok: false, reason: 'openscad_not_installed' };
  }
  try {
    const result = await runner(scad);
    const stl = result && typeof result === 'object' ? result.stl : result;
    if (stl == null || stl === '') {
      return { ok: false, reason: 'render_failed' };
    }
    return { ok: true, stl };
  } catch {
    return { ok: false, reason: 'render_failed' };
  }
}

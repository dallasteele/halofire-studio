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

import {
  PIPE_WALL_IN,
  HEAD_DIMS,
  FITTING_B16_4,
  ELBOW_45_CTE_FACTOR,
  GROOVED_DIMS,
  ESCUTCHEON_DIMS,
  HANGER_DIMS,
  NIPPLE_DIMS,
  REDUCER_DIMS,
  COUPLING_DIMS,
  pipeOdIn,
  nearestNps,
  nearestGroovedNps,
} from './part-dims.js';

const IN_TO_MM = 25.4;
const FT_TO_MM = 304.8;
/** Smooth-enough facet count for round bodies. */
const FN = 48;

/** inches -> mm string with 2dp (every emitted dimension goes through here). */
function mm(inch) {
  return (Number(inch) * IN_TO_MM).toFixed(2);
}

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
 * Sprinkler head — SPEC-DIMENSIONED frame + deflector + threaded nipple.
 *
 * Built to real submittal geometry (part-dims.js HEAD_DIMS), not K*0.6 guesses:
 *   - threaded male nipple at the listed NPT OD (1/2 / 3/4 / 1 NPT) and length,
 *   - hex wrench boss across-flats (1.0"),
 *   - two cast frame arms forming the yoke up to the deflector,
 *   - a stamped deflector disc sized to the K class (5.6 / 8.0 / ESFR).
 * Orientation is GENUINELY distinct per type:
 *   - pendent: deflector down (nipple +Z up, frame/deflector below boss),
 *   - upright: deflector up (whole assembly flipped),
 *   - sidewall: deflector offset laterally to throw horizontally,
 *   - concealed: pendent body + a flush cover plate ring and recess.
 *
 * @param {{type?:string,k?:number,thread?:string,coverPlate?:boolean}} p
 */
export function sprinklerHeadScad(p = {}) {
  const type = first(p.type, 'pendent');
  const k = num(p.k, 5.6);
  const thread = p.thread || '1/2 NPT';
  const concealed = type === 'concealed' || p.coverPlate === true;

  // Thread OD from the listed NPT size (not a K guess).
  let threadOd = HEAD_DIMS.thread_half_npt_od.value;
  if (/3\/4/.test(thread)) threadOd = HEAD_DIMS.thread_three_quarter_npt_od.value;
  else if (/(^|\D)1\s*NPT/.test(thread)) threadOd = HEAD_DIMS.thread_one_npt_od.value;

  // Deflector + orifice from the K class.
  let deflectorDia = HEAD_DIMS.deflector_dia_5_6.value;
  let orifice = HEAD_DIMS.orifice_5_6.value;
  if (k >= 14) {
    deflectorDia = HEAD_DIMS.deflector_dia_esfr.value;
    orifice = HEAD_DIMS.orifice_esfr.value;
  } else if (k >= 7.9) {
    deflectorDia = HEAD_DIMS.deflector_dia_8_0.value;
    orifice = HEAD_DIMS.orifice_8_0.value;
  }

  const tLen = HEAD_DIMS.thread_len.value;
  const hexAf = HEAD_DIMS.hex_across_flats.value;
  const hexH = HEAD_DIMS.hex_height.value;
  const hexDia = hexAf / Math.cos(Math.PI / 6); // across-flats -> circumscribed dia for $fn=6
  const armDia = HEAD_DIMS.frame_arm_dia.value;
  const frameH = HEAD_DIMS.frame_height.value;
  const defThk = HEAD_DIMS.deflector_thk.value;
  const armOffset = deflectorDia * 0.32; // arms spread to the deflector rim

  // Geometry built nipple-up at Z=0..tLen, hex boss above, frame arms reaching
  // DOWN to a deflector at the bottom (a pendent). 'flip' inverts for upright.
  const detail = [
    `orifice ${orifice}" (listed K=${k} nominal)`,
    `deflector ${deflectorDia}" dia, thread ${thread} (${threadOd}" OD)`,
    type === 'sidewall' ? 'sidewall deflector offset for horizontal throw' : '',
    concealed ? `concealed cover plate ${HEAD_DIMS.cover_plate_dia.value}" dia` : '',
  ].filter(Boolean);

  const flip = type === 'upright' ? 'rotate([180, 0, 0])' : '';

  // Deflector + frame block (pendent reference). For sidewall the deflector is a
  // flat plate offset to +X. For others it is a concentric stamped disc.
  let deflectorBlock;
  if (type === 'sidewall') {
    const dw = HEAD_DIMS.sidewall_deflector_w.value;
    const dh = HEAD_DIMS.sidewall_deflector_h.value;
    const off = HEAD_DIMS.sidewall_deflector_offset.value;
    deflectorBlock = [
      `    // sidewall deflector — flat plate thrown to one side (horizontal pattern)`,
      `    translate([${mm(off)}, 0, ${mm(-frameH)}])`,
      `      cube([${mm(dw)}, ${mm(dh)}, ${mm(defThk)}], center = true);`,
    ];
  } else {
    deflectorBlock = [
      `    // stamped deflector disc`,
      `    translate([0, 0, ${mm(-frameH - defThk)}]) cylinder(h = ${mm(defThk)}, d = ${mm(deflectorDia)});`,
    ];
  }

  const coverBlock = concealed
    ? [
        `    // concealed cover plate (flush ring) + recess collar`,
        `    translate([0, 0, ${mm(-HEAD_DIMS.recess_depth.value)}])`,
        `      cylinder(h = ${mm(HEAD_DIMS.cover_plate_thk.value)}, d = ${mm(HEAD_DIMS.cover_plate_dia.value)});`,
      ]
    : [];

  return (
    header(`Sprinkler head — ${type}, K=${k}, thread ${thread}`, detail) +
    [
      `module sprinkler_head() {`,
      `  ${flip} union() {`,
      `    // threaded male nipple (${thread})`,
      `    cylinder(h = ${mm(tLen)}, d = ${mm(threadOd)});`,
      `    // hex wrench boss (across-flats ${hexAf}")`,
      `    translate([0, 0, ${mm(-hexH)}]) cylinder(h = ${mm(hexH)}, d = ${mm(hexDia)}, $fn = 6);`,
      `    // two cast frame arms (yoke) down to the deflector`,
      `    for (a = [-1, 1]) translate([a * ${mm(armOffset)}, 0, ${mm(-frameH / 2 - hexH)}])`,
      `      cylinder(h = ${mm(frameH)}, d = ${mm(armDia)}, center = true);`,
      `    // central orifice boss`,
      `    translate([0, 0, ${mm(-hexH)}]) cylinder(h = ${mm(hexH * 0.6)}, d = ${mm(orifice * 1.4)});`,
      ...deflectorBlock,
      ...coverBlock,
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
  // TRUE OD (ASME B36.10) is fixed per NPS; wall (ASTM A795/A53) sets the bore.
  const nps = nearestNps(nominalIn);
  const odIn = pipeOdIn(nominalIn);
  const wallTbl = PIPE_WALL_IN[schedule === '10' ? 10 : 40];
  const wallIn = wallTbl[nps] != null ? wallTbl[nps] : (schedule === '10' ? 0.109 : 0.154);
  const od = mm(odIn);
  const wall = mm(wallIn);
  const bore = mm(odIn - 2 * wallIn);
  const lengthMm = (lengthFt * FT_TO_MM).toFixed(2);
  return (
    header(`Pipe — Schedule ${schedule}, ${nominalIn}" nominal (NPS ${nps}), ${lengthFt} ft`, [
      `OD ${odIn}" (${od}mm) spec, wall ${wallIn}" (${wall}mm), ASTM/ASME B36.10`,
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
  const runNps = nearestNps(runIn);
  const brNps = nearestNps(branchIn);
  const run = FITTING_B16_4[runNps] || FITTING_B16_4[2];
  const br = FITTING_B16_4[brNps] || FITTING_B16_4[2];
  const runBandOd = run.bandOd; // fitting body OD over the run
  const brBandOd = br.bandOd;
  const runCte = run.cte; // center-to-end -> run length = 2x cte
  const brCte = br.cte;
  const runL = mm(runCte * 2);
  const runD = mm(runBandOd);
  const brD = mm(brBandOd);
  const brL = mm(brCte);
  // Short threaded end-bands ONLY at the openings (NOT a star-profile body).
  const bandLen = mm(0.28);
  return (
    header(
      `Tee — run ${runIn}" branch ${branchIn}"${runIn !== branchIn ? ' (reducing)' : ''}`,
      [`ASME B16.4 Class 125 cast tee: run CTE ${runCte}", body OD ${runBandOd}"`],
    ) +
    [
      `module tee() {`,
      `  union() {`,
      `    // run body (band OD over the run pipe, true center-to-end)`,
      `    rotate([0, 90, 0]) translate([0, 0, ${mm(-runCte)}]) cylinder(h = ${runL}, d = ${runD});`,
      `    // branch body`,
      `    cylinder(h = ${brL}, d = ${brD});`,
      `    // threaded end-bands (short ridge at each opening, not a star body)`,
      `    rotate([0, 90, 0]) translate([0, 0, ${mm(runCte - 0.28)}]) cylinder(h = ${bandLen}, d = ${mm(runBandOd * 1.06)});`,
      `    rotate([0, 90, 0]) translate([0, 0, ${mm(-runCte)}]) cylinder(h = ${bandLen}, d = ${mm(runBandOd * 1.06)});`,
      `    translate([0, 0, ${mm(brCte - 0.28)}]) cylinder(h = ${bandLen}, d = ${mm(brBandOd * 1.06)});`,
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
  const nps = nearestNps(nominalIn);
  const f = FITTING_B16_4[nps] || FITTING_B16_4[2];
  // center-to-end: 45 ell is shorter than the 90 ell per ASME B16.4.
  const cte = deg === 45 ? f.cte * ELBOW_45_CTE_FACTOR : f.cte;
  const d = mm(f.bandOd);
  const leg = mm(cte);
  const bandLen = mm(0.28);
  return (
    header(`Elbow — ${nominalIn}", ${deg} degrees`, [
      `ASME B16.4 Class 125 cast elbow: CTE ${cte.toFixed(2)}", body OD ${f.bandOd}"`,
    ]) +
    [
      `module elbow() {`,
      `  union() {`,
      `    // first leg (center-to-end)`,
      `    cylinder(h = ${leg}, d = ${d});`,
      `    // bend fillet`,
      `    sphere(d = ${d});`,
      `    // second leg turned ${deg} degrees`,
      `    rotate([${deg}, 0, 0]) cylinder(h = ${leg}, d = ${d});`,
      `    // threaded end-bands at the two openings (short ridge only)`,
      `    translate([0, 0, ${mm(cte - 0.28)}]) cylinder(h = ${bandLen}, d = ${mm(f.bandOd * 1.06)});`,
      `    rotate([${deg}, 0, 0]) translate([0, 0, ${mm(cte - 0.28)}]) cylinder(h = ${bandLen}, d = ${mm(f.bandOd * 1.06)});`,
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
  const nps = nearestNps(nominalIn);
  const c = COUPLING_DIMS[nps] || COUPLING_DIMS[2];
  const odIn = c.bandOd;
  const lenIn = c.len;
  const boreIn = pipeOdIn(nominalIn); // bore seats the real pipe OD
  const od = mm(odIn);
  const len = mm(lenIn);
  const bore = mm(boreIn);
  const lipOd = mm(odIn * 1.05);
  const lipLen = mm(lenIn * 0.14);
  return (
    header(`Coupling — ${nominalIn}"`, [
      `ASME B16.4 Class 150 straight coupling: length ${lenIn}", body OD ${odIn}"`,
    ]) +
    [
      `module coupling() {`,
      `  difference() {`,
      `    union() {`,
      `      cylinder(h = ${len}, d = ${od});`,
      `      // raised end lips (concentric band) at each end`,
      `      cylinder(h = ${lipLen}, d = ${lipOd});`,
      `      translate([0, 0, ${mm(lenIn - lenIn * 0.14)}]) cylinder(h = ${lipLen}, d = ${lipOd});`,
      `    }`,
      `    translate([0, 0, -1]) cylinder(h = ${mm(lenIn + 0.08)}, d = ${bore});`,
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
  const largeNps = nearestNps(Math.max(fromIn, toIn));
  const lenIn = REDUCER_DIMS.lengthByLargeNps[largeNps] || 2.25;
  // Band OD ~ real fitting body over each pipe end (B16.4 reducing coupling).
  const bigOd = (FITTING_B16_4[nearestNps(Math.max(fromIn, toIn))] || FITTING_B16_4[2]).bandOd;
  const smallOd = (FITTING_B16_4[nearestNps(Math.min(fromIn, toIn))] || FITTING_B16_4[1.5]).bandOd;
  const d1 = mm(bigOd);
  const d2 = mm(smallOd);
  const len = mm(lenIn);
  const collar = mm(lenIn * 0.16);
  return (
    header(`Reducer — ${fromIn}" to ${toIn}" (concentric)`, [
      `ASME B16.4 reducing coupling: length ${lenIn}", ${bigOd}" -> ${smallOd}" body`,
    ]) +
    [
      `module reducer() {`,
      `  union() {`,
      `    // large-end collar`,
      `    cylinder(h = ${collar}, d = ${d1});`,
      `    // concentric taper`,
      `    translate([0, 0, ${collar}]) cylinder(h = ${mm(lenIn - lenIn * 0.32)}, d1 = ${d1}, d2 = ${d2});`,
      `    // small-end collar`,
      `    translate([0, 0, ${mm(lenIn - lenIn * 0.16)}]) cylinder(h = ${collar}, d = ${d2});`,
      `  }`,
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
  // Body/flange referenced to the TRUE pipe OD so the valve seats real pipe.
  const odIn = pipeOdIn(nominalIn);
  const bodyD = mm(odIn * 1.5);
  // ASME B16.1 Class 125 flange OD ~ pipe OD + ~2.5-3" (size-dependent).
  const flangeD = mm(odIn + (nominalIn <= 2.5 ? 2.6 : 3.2));
  const bodyH = mm(odIn * 1.4);
  const stemH = mm(odIn * 1.2);
  return (
    header(`Valve — ${type}, ${nominalIn}"`, [
      `body referenced to ${odIn}" pipe OD; Class 125 flange OD ~${(odIn + (nominalIn <= 2.5 ? 2.6 : 3.2)).toFixed(2)}"`,
    ]) +
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
  const odIn = pipeOdIn(nominalIn); // strap wraps the real pipe OD
  const clr = HANGER_DIMS.clearance.value;
  const thk = HANGER_DIMS.strap_thk.value;
  const ringIdIn = odIn + 2 * clr;
  const ringOdIn = ringIdIn + 2 * thk;
  const widthIn = HANGER_DIMS.strap_width.value;
  const rodDiaIn = HANGER_DIMS.rod_dia.value;
  const rodLenIn = HANGER_DIMS.rod_len.value;
  const ringOd = mm(ringOdIn);
  const ringId = mm(ringIdIn);
  const width = mm(widthIn);
  return (
    header(`Hanger — ${nominalIn}" pipe (adjustable swivel ring)`, [
      `ring strap ID ${ringIdIn.toFixed(2)}" over ${odIn}" pipe OD, 3/8" rod`,
    ]) +
    [
      `module hanger() {`,
      `  union() {`,
      `    // ring strap (band iron wrapping the pipe OD)`,
      `    difference() {`,
      `      cylinder(h = ${width}, d = ${ringOd});`,
      `      translate([0, 0, -1]) cylinder(h = ${mm(widthIn + 0.08)}, d = ${ringId});`,
      `    }`,
      `    // 3/8" all-thread hanger rod`,
      `    translate([0, 0, ${width}]) cylinder(h = ${mm(rodLenIn)}, d = ${mm(rodDiaIn)});`,
      `  }`,
      `}`,
      `hanger();`,
      '',
    ].join('\n')
  );
}

/**
 * Grooved coupling — Victaulic FireLock submittal geometry, VISUALLY DISTINCT
 * by type (doctrine requirement):
 *   - RIGID (Style 005H): compact two-segment housing, two bolt pads, NO visible
 *     flex gasket band — a tight, short body.
 *   - FLEXIBLE (Style 177): wider housing with a raised central gasket band
 *     (the flexing/expansion zone) between the bolt pads — clearly different.
 * Bore seats the real pipe OD; housing OD + width per GROOVED_DIMS.
 *
 * @param {{nominalIn?:number,grooveType?:string}} p
 */
export function groovedCouplingScad(p = {}) {
  const nominalIn = num(p.nominalIn, 3);
  const grooveType = /flex/i.test(String(p.grooveType || '')) ? 'flexible' : 'rigid';
  const nps = nearestGroovedNps(nominalIn);
  const g = GROOVED_DIMS[nps] || GROOVED_DIMS[3];
  const odIn = grooveType === 'flexible' ? g.flexOd : g.rigidOd;
  const widthIn = grooveType === 'flexible' ? g.flexWidth : g.rigidWidth;
  const boreIn = pipeOdIn(nominalIn);
  const boltDiaIn = g.boltDia;
  const padSpread = odIn * 0.5; // bolt pads project laterally from the housing
  const od = mm(odIn);
  const width = mm(widthIn);
  const bore = mm(boreIn);
  // Flexible has a raised central gasket band; rigid does not.
  const gasketBlock =
    grooveType === 'flexible'
      ? [
          `    // raised central gasket band (flexible Style 177 — the flex zone)`,
          `    translate([0, 0, ${mm(widthIn * 0.32)}]) cylinder(h = ${mm(widthIn * 0.36)}, d = ${mm(odIn * 1.08)});`,
        ]
      : [
          `    // rigid: two key-pad ribs, no flex band (Style 005H)`,
          `    cylinder(h = ${mm(widthIn * 0.18)}, d = ${mm(odIn * 1.04)});`,
          `    translate([0, 0, ${mm(widthIn - widthIn * 0.18)}]) cylinder(h = ${mm(widthIn * 0.18)}, d = ${mm(odIn * 1.04)});`,
        ];
  return (
    header(`Grooved coupling — ${nominalIn}", ${grooveType}`, [
      `${GROOVED_DIMS.source}`,
      `housing OD ${odIn}", width ${widthIn}", ${grooveType === 'flexible' ? 'flex gasket band' : 'rigid (no flex band)'}`,
    ]) +
    [
      `module grooved_coupling() {`,
      `  difference() {`,
      `    union() {`,
      `      // housing barrel`,
      `      cylinder(h = ${width}, d = ${od});`,
      ...gasketBlock,
      `      // two bolt pads (lug ears) on opposite sides`,
      `      for (a = [0, 180]) rotate([0, 0, a])`,
      `        translate([${mm(padSpread)}, 0, ${mm(widthIn / 2)}])`,
      `          rotate([90, 0, 0]) cylinder(h = ${mm(odIn * 0.36)}, d = ${mm(boltDiaIn * 2.4)}, center = true);`,
      `      // bolt shanks through the pads`,
      `      for (a = [0, 180]) rotate([0, 0, a])`,
      `        translate([${mm(padSpread)}, 0, ${mm(widthIn / 2)}])`,
      `          rotate([90, 0, 0]) cylinder(h = ${mm(odIn * 0.9)}, d = ${mm(boltDiaIn)}, center = true);`,
      `    }`,
      `    // bore seats the real pipe OD`,
      `    translate([0, 0, -1]) cylinder(h = ${mm(widthIn + 0.08)}, d = ${bore});`,
      `  }`,
      `}`,
      `grooved_coupling();`,
      '',
    ].join('\n')
  );
}

/**
 * Escutcheon — flat flanged cover ring around a sprinkler drop at the ceiling.
 * Spec geometry: ~2-3/4" OD flat flange + a shallow adjustable cup skirt, bored
 * to clear the drop/thread. (ESCUTCHEON_DIMS.)
 * @param {{}} _p
 */
export function escutcheonScad() {
  const outer = ESCUTCHEON_DIMS.outer_dia.value;
  const bore = ESCUTCHEON_DIMS.inner_bore.value;
  const flangeThk = ESCUTCHEON_DIMS.flange_thk.value;
  const cup = ESCUTCHEON_DIMS.cup_depth.value;
  return (
    header(`Escutcheon — cover ring`, [
      `flat flange OD ${outer}", bore ${bore}", cup depth ${cup}"`,
    ]) +
    [
      `module escutcheon() {`,
      `  difference() {`,
      `    union() {`,
      `      // flat flange ring`,
      `      cylinder(h = ${mm(flangeThk)}, d = ${mm(outer)});`,
      `      // adjustable cup skirt`,
      `      translate([0, 0, ${mm(flangeThk)}]) cylinder(h = ${mm(cup)}, d = ${mm(bore + 0.4)});`,
      `    }`,
      `    translate([0, 0, -1]) cylinder(h = ${mm(flangeThk + cup + 0.08)}, d = ${mm(bore)});`,
      `  }`,
      `}`,
      `escutcheon();`,
      '',
    ].join('\n')
  );
}

/**
 * Drop nipple — short threaded pipe nipple from a branch tee/reducer down to a
 * head. Bore at the real pipe OD, real short-nipple length, with helical male
 * NPT threads at both ends instead of stacked ridge bands.
 * @param {{nominalIn?:number,lengthIn?:number}} p
 */
export function dropNippleScad(p = {}) {
  const nominalIn = num(p.nominalIn, 1);
  const lengthIn = num(p.lengthIn, NIPPLE_DIMS.default_len.value);
  const nps = nearestNps(nominalIn);
  const odIn = pipeOdIn(nominalIn);
  const wallIn = PIPE_WALL_IN[40][nps] || 0.133;
  const boreIn = odIn - 2 * wallIn;
  const tLen = NIPPLE_DIMS.thread_len.value;
  const tpi =
    NIPPLE_DIMS.thread_tpi_by_nps[nps] && Number.isFinite(NIPPLE_DIMS.thread_tpi_by_nps[nps].value)
      ? NIPPLE_DIMS.thread_tpi_by_nps[nps].value
      : 11.5;
  const pitchIn = 1 / tpi;
  const threadHeightIn = 0.8 / tpi;
  const taperDiamPerIn = NIPPLE_DIMS.thread_taper_diam_per_in.value;
  const threadMajorTipIn = Math.max(odIn - taperDiamPerIn * tLen, boreIn + threadHeightIn * 2.1);
  const threadMinorTipIn = Math.max(threadMajorTipIn - threadHeightIn * 2, boreIn + 0.02);
  const threadMinorBodyIn = Math.max(odIn - threadHeightIn * 2, boreIn + 0.02);
  const centerLenIn = Math.max(0, lengthIn - tLen * 2);
  const turns = tLen * tpi;
  const slices = Math.max(72, Math.ceil(turns * 24));
  const od = mm(odIn);
  const bore = mm(boreIn);
  const len = mm(lengthIn);
  const pitch = mm(pitchIn);
  const threadLen = mm(tLen);
  const centerLen = mm(centerLenIn);
  const threadDepth = mm(threadHeightIn);
  const threadScale = (threadMinorBodyIn / threadMinorTipIn).toFixed(6);
  return (
    header(`Drop nipple — ${nominalIn}", ${lengthIn}" long`, [
      `Sch 40 pipe OD ${odIn}", male NPT threads ${tLen}" each end`,
      `${nps}" NPT thread pitch ${tpi} TPI, taper ${taperDiamPerIn}" per inch on diameter`,
    ]) +
    [
      `module drop_nipple() {`,
      `  module tapered_thread_segment() {`,
      `    union() {`,
      `      cylinder(h = ${threadLen}, d1 = ${mm(threadMinorTipIn)}, d2 = ${mm(threadMinorBodyIn)});`,
      `      linear_extrude(height = ${threadLen}, twist = ${(turns * 360).toFixed(2)}, slices = ${slices}, scale = ${threadScale})`,
      `        translate([${mm(threadMinorTipIn / 2)}, 0, 0]) polygon(points = [[0, 0], [${threadDepth}, ${(Number(pitch) / 2).toFixed(2)}], [0, ${pitch}]]);`,
      `    }`,
      `  }`,
      `  difference() {`,
      `    union() {`,
      `      if (${centerLenIn.toFixed(4)} > 0) translate([0, 0, ${threadLen}]) cylinder(h = ${centerLen}, d = ${od});`,
      `      // helical NPT thread at the lower end`,
      `      tapered_thread_segment();`,
      `      // mirrored helical NPT thread at the upper end`,
      `      translate([0, 0, ${len}]) mirror([0, 0, 1]) tapered_thread_segment();`,
      `    }`,
      `    translate([0, 0, -1]) cylinder(h = ${mm(lengthIn + 0.08)}, d = ${bore});`,
      `  }`,
      `}`,
      `drop_nipple();`,
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
      // A concealed head (coverPlate flag) and a sidewall head are GENUINELY
      // distinct geometries — surface them as the type, not just 'pendent'.
      let type = params.type || params.orientation || 'pendent';
      if (params.coverPlate === true) type = 'concealed';
      else if (/sidewall/i.test(type) || /sidewall/i.test(key || '') || /sidewall/i.test(name || '')) {
        type = 'sidewall';
      }
      const k = first(params.kFactors, params.k);
      return sprinklerHeadScad({ type, k, thread: params.thread, coverPlate: params.coverPlate });
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
    case 'grooved': {
      if (key === 'grooved_flange_adapter' || /flange/i.test(name || '')) {
        // Flange adapter approximated as a short grooved housing with a flange
        // disc — until a dedicated emitter exists, reuse the valve flange massing.
        return groovedCouplingScad({ nominalIn: sizeOf(params, 3), grooveType: 'rigid' });
      }
      // Grooved coupling: default the canonical key to the RIGID variant; the
      // flexible variant is emitted separately by the build pipeline (variants).
      return groovedCouplingScad({
        nominalIn: sizeOf(params, 3),
        grooveType: params.grooveType || 'rigid',
      });
    }
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

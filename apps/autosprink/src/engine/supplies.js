/**
 * HaloFire — WATER SUPPLIES (Phase 3 hydraulics).
 *
 * A fire sprinkler system is only adequate if the WATER SUPPLY can deliver the
 * system DEMAND (gpm) at the REQUIRED pressure (psi) at the point of connection.
 * This module models the three supply types AutoSprink/NFPA-13 hand calcs use and
 * evaluates them against a demand point, producing the classic supply-vs-demand
 * graph (the "N^1.85 curve" plotted against the system demand curve).
 *
 *   1. CITY-WATER FLOW TEST — the field flow test gives a static pressure (no
 *      flow), and a residual pressure at a measured test flow. The available
 *      pressure at ANY other flow Q follows the Hazen-Williams 1.85 power law:
 *        P_avail(Q) = P_static − (P_static − P_residual) · (Q / Q_test)^1.85
 *      (NFPA-13 / AWWA: the supply curve is a straight line on N^1.85 graph paper.)
 *
 *   2. PUMP — a fire pump rated curve: churn (0 flow) head, rated point, and the
 *      150%-of-rated overload point (NFPA-20 three-point curve). The pump ADDS
 *      head on top of its suction supply. We fit a quadratic through the three
 *      published points P(Q) = a·Q² + b·Q + c, the standard pump-curve shape.
 *
 *   3. TANK — a gravity/pressure tank: a fixed available pressure (elevation head
 *      + any air-charge), roughly flat with flow until the tank draws down; we
 *      model it as a constant available pressure (the conservative full-tank value)
 *      with an optional capacity (gal) → duration (min) at the demand flow.
 *
 * Multiple NAMED supplies can be defined; evaluateSupplies picks the BINDING
 * (governing) supply at the demand point — the one with the LEAST margin — which is
 * what the system must be designed against.
 *
 * 🔬 NUMERICAL TRUTH: the flow-test 1.85 law, the pump three-point quadratic, and
 * the margin arithmetic are golden-tested against hand-computed values
 * (tests/supplies.test.js). Units: gpm (flow), psi (pressure), feet (elevation).
 *
 * HONESTY: ENGINEERING AID. A supply curve is only as good as the field flow test
 * (and its date/location); the pump curve must match the stamped pump submittal;
 * tank drawdown is simplified. NOT AHJ/PE-stamped. Verify before permit.
 */

export const SUPPLY_DISCLAIMER =
  'ENGINEERING AID — supply curves from a field flow test / pump submittal / tank '
  + 'rating, evaluated against the system demand (N^1.85 law). NOT AHJ/PE-stamped. '
  + 'Verify the flow-test date/location, the stamped pump curve, and tank drawdown '
  + 'before permit.';

const HW_EXP = 1.85; // Hazen-Williams flow exponent for the supply (N^1.85) curve

function num(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d; }
function round(n) { return Math.round((Number(n) + Number.EPSILON) * 1000) / 1000; }

// ---------------------------------------------------------------------------
// City-water flow test.
// ---------------------------------------------------------------------------

/**
 * Available pressure from a flow test at an arbitrary flow Q.
 *   P(Q) = P_static − (P_static − P_residual)·(Q/Q_test)^1.85
 * Clamped at 0 (can't deliver negative pressure).
 */
export function flowTestAvailablePsi(test, gpm) {
  const Ps = num(test.staticPsi);
  const Pr = num(test.residualPsi);
  const Qt = num(test.testFlowGpm);
  const Q = Math.max(0, num(gpm));
  if (!(Qt > 0)) return Ps; // no test flow → static only
  const drop = (Ps - Pr) * Math.pow(Q / Qt, HW_EXP);
  return Math.max(0, Ps - drop);
}

/**
 * Inverse: the maximum flow a flow-test supply can deliver while still holding a
 * required residual pressure Preq.  Solve Preq = Ps − (Ps−Pr)(Q/Qt)^1.85 for Q.
 *   Q = Qt · ((Ps − Preq)/(Ps − Pr))^(1/1.85)
 */
export function flowTestFlowAtPsi(test, requiredPsi) {
  const Ps = num(test.staticPsi);
  const Pr = num(test.residualPsi);
  const Qt = num(test.testFlowGpm);
  const Preq = num(requiredPsi);
  if (!(Qt > 0) || !(Ps - Pr > 0)) return 0;
  if (Preq >= Ps) return 0;
  if (Preq <= 0) return Qt * Math.pow(Ps / (Ps - Pr), 1 / HW_EXP);
  return Qt * Math.pow((Ps - Preq) / (Ps - Pr), 1 / HW_EXP);
}

// ---------------------------------------------------------------------------
// Pump (NFPA-20 three-point quadratic curve).
// ---------------------------------------------------------------------------

/** Fit a quadratic P(Q)=a·Q²+b·Q+c through the three published pump points. */
function fitPumpQuadratic(p0, p1, p2) {
  // p0 = churn (Q=0), p1 = rated, p2 = 150% overload. Solve the 3×3 system.
  const [x0, y0] = p0; const [x1, y1] = p1; const [x2, y2] = p2;
  const d = (x0 - x1) * (x0 - x2) * (x1 - x2);
  if (Math.abs(d) < 1e-9) return { a: 0, b: 0, c: y0 };
  const a = (x2 * (y1 - y0) + x1 * (y0 - y2) + x0 * (y2 - y1)) / d;
  const b = (x2 * x2 * (y0 - y1) + x1 * x1 * (y2 - y0) + x0 * x0 * (y1 - y2)) / d;
  const c = (x1 * x2 * (x1 - x2) * y0 + x2 * x0 * (x2 - x0) * y1 + x0 * x1 * (x0 - x1) * y2) / d;
  return { a, b, c };
}

/** Pump boost (psi added) at flow Q from its three-point curve. */
export function pumpBoostPsi(pump, gpm) {
  const churn = num(pump.churnPsi);
  const rated = [num(pump.ratedFlowGpm), num(pump.ratedPsi)];
  const over = [num(pump.ratedFlowGpm) * 1.5, num(pump.overloadPsi != null ? pump.overloadPsi : pump.ratedPsi * 0.65)];
  const fit = fitPumpQuadratic([0, churn], rated, over);
  const Q = Math.max(0, num(gpm));
  const boost = fit.a * Q * Q + fit.b * Q + fit.c;
  return Math.max(0, boost);
}

// ---------------------------------------------------------------------------
// Supply factory + evaluation.
// ---------------------------------------------------------------------------

/**
 * Normalize a supply spec into a typed supply object with an available(Q) fn.
 * spec.kind: 'cityWater' | 'pump' | 'tank'.
 */
export function buildSupply(spec) {
  const s = spec || {};
  const name = s.name || (s.kind || 'supply');
  if (s.kind === 'pump') {
    // a pump sits on a suction supply (default 0 — boost only) and ADDS head.
    const suctionPsi = num(s.suctionPsi);
    return {
      kind: 'pump', name,
      ratedFlowGpm: num(s.ratedFlowGpm), ratedPsi: num(s.ratedPsi),
      churnPsi: num(s.churnPsi, s.ratedPsi != null ? num(s.ratedPsi) * 1.4 : 0),
      overloadPsi: s.overloadPsi != null ? num(s.overloadPsi) : round(num(s.ratedPsi) * 0.65),
      suctionPsi,
      availablePsi: (Q) => round(suctionPsi + pumpBoostPsi({
        churnPsi: num(s.churnPsi, num(s.ratedPsi) * 1.4),
        ratedFlowGpm: num(s.ratedFlowGpm), ratedPsi: num(s.ratedPsi),
        overloadPsi: s.overloadPsi != null ? num(s.overloadPsi) : round(num(s.ratedPsi) * 0.65),
      }, Q)),
    };
  }
  if (s.kind === 'tank') {
    const psi = num(s.availablePsi, s.elevationFt != null ? num(s.elevationFt) * 0.433 : 0);
    return {
      kind: 'tank', name,
      capacityGal: num(s.capacityGal),
      availablePsiFlat: round(psi),
      availablePsi: () => round(psi),
      durationMin: (Q) => (Q > 0 && s.capacityGal ? round(num(s.capacityGal) / Q) : null),
    };
  }
  // default: city-water flow test
  const test = { staticPsi: num(s.staticPsi), residualPsi: num(s.residualPsi), testFlowGpm: num(s.testFlowGpm) };
  return {
    kind: 'cityWater', name,
    staticPsi: test.staticPsi, residualPsi: test.residualPsi, testFlowGpm: test.testFlowGpm,
    availablePsi: (Q) => round(flowTestAvailablePsi(test, Q)),
    maxFlowAtPsi: (P) => round(flowTestFlowAtPsi(test, P)),
  };
}

/**
 * Evaluate a single supply at a demand point {demandGpm, requiredPsi}.
 * Returns availablePsi at the demand flow, the margin (available − required),
 * and demandMet. For a flow-test supply, also the max flow it can deliver at
 * the required pressure (the "delivered at requiredPsi" capacity).
 */
export function evaluateSupply(supply, demand) {
  const sup = (supply && typeof supply.availablePsi === 'function') ? supply : buildSupply(supply);
  const Q = num(demand && demand.demandGpm);
  const Preq = num(demand && demand.requiredPsi);
  const avail = sup.availablePsi(Q);
  const margin = round(avail - Preq);
  const out = {
    name: sup.name,
    kind: sup.kind,
    demandGpm: round(Q),
    requiredPsi: round(Preq),
    availablePsi: round(avail),
    marginPsi: margin,
    demandMet: avail >= Preq,
  };
  if (sup.kind === 'cityWater') out.maxFlowAtRequiredPsi = sup.maxFlowAtPsi(Preq);
  if (sup.kind === 'tank' && typeof sup.durationMin === 'function') out.durationMin = sup.durationMin(Q);
  return out;
}

/**
 * Evaluate MULTIPLE named supplies and pick the BINDING (governing) one — the
 * supply with the LEAST margin at the demand point. If all are met, the system
 * is adequate against the binding supply; if the binding supply fails, the
 * system fails. Returns per-supply evaluations + the binding pick.
 */
export function evaluateSupplies(specs, demand) {
  const list = (Array.isArray(specs) ? specs : (specs ? [specs] : [])).filter(Boolean);
  const evals = list.map((spec) => evaluateSupply(buildSupply(spec), demand));
  if (!evals.length) return { supplies: [], binding: null, demandMet: null, demandGpm: round(num(demand && demand.demandGpm)), requiredPsi: round(num(demand && demand.requiredPsi)), disclaimer: SUPPLY_DISCLAIMER };
  // binding = least margin (the one the design must satisfy / the weakest link)
  let binding = evals[0];
  for (const e of evals) if (e.marginPsi < binding.marginPsi) binding = e;
  return {
    supplies: evals,
    binding,
    bindingName: binding.name,
    demandMet: binding.demandMet,
    demandGpm: round(num(demand && demand.demandGpm)),
    requiredPsi: round(num(demand && demand.requiredPsi)),
    marginPsi: binding.marginPsi,
    disclaimer: SUPPLY_DISCLAIMER,
  };
}

/**
 * Supply-vs-demand graph data. Samples the supply curve and the demand curve over
 * a flow range so the UI can plot them. The DEMAND curve uses the system's N^1.85
 * relation anchored at the design point (Q_design, P_required): a sprinkler system
 * demand follows P_req ∝ Q^1.85 (same hydraulic law), so
 *   P_demand(Q) = P_required · (Q/Q_design)^1.85.
 * The intersection of supply and demand curves is the system operating point.
 *
 * @param {object} supplySpec  one supply spec (the binding one, typically)
 * @param {{demandGpm:number, requiredPsi:number}} demand  the design point
 * @param {{samples?:number, maxFlowGpm?:number}} [opts]
 * @returns {{supplyCurve:Array, demandCurve:Array, designPoint:object, operatingPoint:object|null}}
 */
export function supplyDemandCurve(supplySpec, demand, opts = {}) {
  const sup = (supplySpec && typeof supplySpec.availablePsi === 'function') ? supplySpec : buildSupply(supplySpec);
  const Qd = Math.max(1, num(demand && demand.demandGpm));
  const Preq = num(demand && demand.requiredPsi);
  const samples = opts.samples > 1 ? Math.floor(opts.samples) : 24;
  const maxQ = opts.maxFlowGpm > 0 ? opts.maxFlowGpm : Qd * 1.6;
  const supplyCurve = [];
  const demandCurve = [];
  for (let i = 0; i <= samples; i += 1) {
    const Q = (maxQ * i) / samples;
    supplyCurve.push({ flowGpm: round(Q), psi: round(sup.availablePsi(Q)) });
    demandCurve.push({ flowGpm: round(Q), psi: round(Qd > 0 ? Preq * Math.pow(Q / Qd, HW_EXP) : 0) });
  }
  // operating point: where supply == demand (bisection on supply−demand sign change).
  const f = (Q) => sup.availablePsi(Q) - (Qd > 0 ? Preq * Math.pow(Q / Qd, HW_EXP) : 0);
  let op = null;
  let lo = 0; let hi = maxQ;
  if (f(lo) >= 0 && f(hi) <= 0) {
    for (let i = 0; i < 60; i += 1) {
      const mid = (lo + hi) / 2;
      if (f(mid) >= 0) lo = mid; else hi = mid;
    }
    const Qop = (lo + hi) / 2;
    op = { flowGpm: round(Qop), psi: round(sup.availablePsi(Qop)) };
  }
  return {
    supplyName: sup.name,
    supplyKind: sup.kind,
    supplyCurve,
    demandCurve,
    designPoint: { flowGpm: round(Qd), psi: round(Preq) },
    operatingPoint: op,
    disclaimer: SUPPLY_DISCLAIMER,
  };
}

/** A representative default city-water supply for the demo (typical municipal). */
export function defaultCityWaterSpec() {
  return { kind: 'cityWater', name: 'City water (flow test)', staticPsi: 74, residualPsi: 58, testFlowGpm: 1200 };
}

/**
 * OpenClaw CAD automation adapter (internal alpha, best-effort).
 *
 * Lets HaloFire drive OpenClaw's CAD tools (generate_3d_model / generate_dxf)
 * from the backend-neutral CAD model produced by src/engine/cad-model.js.
 *
 * Design:
 *   - The payload builders are PURE: cad-model -> plain-object args. Deterministic,
 *     no network, fully unit-testable.
 *   - invokeOpenClawCad takes an INJECTED async invoker(toolName, payload). There is
 *     no hardcoded network call here; production wires the GX10 OpenClaw bridge as the
 *     invoker, tests inject a mock. If the invoker is missing or throws (gateway
 *     unreachable), we degrade gracefully — { ok:false, skipped:true, reason } — so
 *     HaloFire keeps working whether or not the GX10 gateway is live.
 *
 * This adapter ships GEOMETRY ONLY. It does NOT clear any regulated claim gate and
 * makes no AHJ/PE/AutoSprink/manufacturer parity claim; those stay fail-closed.
 */

/**
 * Compact solids spec for OpenClaw: walls as boxes, pipes as sized cylinders
 * (from/to), heads as oriented points. Deterministic — preserves solid order.
 */
function compactSolids(cadModel) {
  const boxes = [];
  const cylinders = [];
  const points = [];

  for (const s of cadModel.solids) {
    if (s.kind === 'wall') {
      boxes.push({
        type: 'box',
        name: s.name,
        layer: s.layer,
        center: s.center,
        lengthFt: s.lengthFt,
        heightFt: s.heightFt,
        thicknessFt: s.thicknessFt,
        rotationY: s.rotationY,
      });
    } else if (s.kind === 'pipe') {
      cylinders.push({
        type: 'cylinder',
        name: s.name,
        layer: s.layer,
        role: s.role,
        from: s.from,
        to: s.to,
        diameterIn: s.diameterIn,
      });
    } else if (s.kind === 'head') {
      points.push({
        type: 'point',
        name: s.name,
        layer: s.layer,
        position: s.position,
        orientation: s.orientation,
      });
    }
    // slabs/roof are intentionally omitted from the compact CAD spec; the
    // box/cylinder/point primitives are what OpenClaw's CAD tools consume.
  }

  return { boxes, cylinders, points };
}

function counts(cadModel, solids) {
  return {
    heads: solids.points.length,
    pipes: solids.cylinders.length,
    walls: solids.boxes.length,
    solids: cadModel.solids.length,
  };
}

/**
 * Build args for OpenClaw's generate_3d_model tool.
 * @param {object} cadModel - output of buildCadModel().
 * @returns {object} deterministic plain-object payload.
 */
export function buildGenerate3dModelPayload(cadModel) {
  if (!cadModel || !Array.isArray(cadModel.solids)) {
    throw new Error('buildGenerate3dModelPayload requires a cad model with a solids array');
  }
  const solids = compactSolids(cadModel);
  return {
    tool: 'generate_3d_model',
    project: cadModel.name,
    units: cadModel.units || 'ft',
    counts: counts(cadModel, solids),
    solids,
    disclaimer: cadModel.disclaimer,
  };
}

/**
 * Build args for OpenClaw's generate_dxf tool. Same geometry summary as the
 * 3d payload (project name + box/cylinder/point spec + counts).
 * @param {object} cadModel - output of buildCadModel().
 * @returns {object} deterministic plain-object payload.
 */
export function buildGenerateDxfPayload(cadModel) {
  if (!cadModel || !Array.isArray(cadModel.solids)) {
    throw new Error('buildGenerateDxfPayload requires a cad model with a solids array');
  }
  const solids = compactSolids(cadModel);
  return {
    tool: 'generate_dxf',
    project: cadModel.name,
    units: cadModel.units || 'ft',
    counts: counts(cadModel, solids),
    geometry: solids,
    disclaimer: cadModel.disclaimer,
  };
}

/**
 * Invoke an OpenClaw CAD tool via an injected async invoker. Never throws:
 * on success returns { ok:true, result }; if the invoker is missing/not callable
 * or throws (e.g. GX10 gateway unreachable) returns { ok:false, skipped:true, reason }.
 *
 * @param {string} toolName - 'generate_3d_model' | 'generate_dxf' | ...
 * @param {object} payload - args built by the builders above.
 * @param {{invoker?: function}} [opts] - production wires the OpenClaw bridge here.
 * @returns {Promise<{ok:boolean, result?:any, skipped?:boolean, reason?:string}>}
 */
export async function invokeOpenClawCad(toolName, payload, opts = {}) {
  const invoker = opts && opts.invoker;
  if (typeof invoker !== 'function') {
    return {
      ok: false,
      skipped: true,
      reason: 'OpenClaw invoker not provided — GX10 CAD gateway not wired; skipping.',
    };
  }
  try {
    const result = await invoker(toolName, payload);
    return { ok: true, result };
  } catch (err) {
    const reason = err && err.message ? err.message : String(err);
    return { ok: false, skipped: true, reason };
  }
}

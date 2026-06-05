import { describe, expect, it } from 'vitest';
import { buildCadModel } from '../src/engine/cad-model.js';
import {
  buildGenerate3dModelPayload,
  buildGenerateDxfPayload,
  invokeOpenClawCad,
} from '../src/cad/openclaw-cad.js';

const rect = (w, h) => [[0, 0], [w, 0], [w, h], [0, h]];
const floorPlan = {
  name: 'Test Plant',
  units: 'ft',
  rooms: [
    { name: 'Bay', polygon: rect(60, 40), hazard: 'light', ceilingHeightFt: 14 },
    { name: 'Storage', polygon: rect(40, 30), hazard: 'ordinary', ceilingHeightFt: 16 },
  ],
};
const cadModel = buildCadModel(floorPlan);

describe('buildGenerate3dModelPayload', () => {
  const payload = buildGenerate3dModelPayload(cadModel);

  it('carries project name and units', () => {
    expect(payload.project).toBe('Test Plant');
    expect(payload.units).toBe('ft');
    expect(payload.tool).toBe('generate_3d_model');
  });

  it('includes counts that match the cad model', () => {
    expect(payload.counts.heads).toBe(cadModel.counts.heads);
    expect(payload.counts.pipes).toBe(cadModel.counts.pipes);
    expect(payload.counts.walls).toBe(cadModel.counts.walls);
    expect(payload.counts.solids).toBe(cadModel.solids.length);
  });

  it('emits a compact solids spec: walls as boxes, pipes as cylinders, heads as points', () => {
    const wallCount = cadModel.solids.filter((s) => s.kind === 'wall').length;
    const pipeCount = cadModel.solids.filter((s) => s.kind === 'pipe').length;
    const headCount = cadModel.solids.filter((s) => s.kind === 'head').length;

    expect(payload.solids.boxes.length).toBe(wallCount);
    expect(payload.solids.cylinders.length).toBe(pipeCount);
    expect(payload.solids.points.length).toBe(headCount);

    const box = payload.solids.boxes[0];
    expect(box.type).toBe('box');
    expect(typeof box.lengthFt).toBe('number');
    expect(typeof box.heightFt).toBe('number');
    expect(typeof box.thicknessFt).toBe('number');
    expect(Array.isArray(box.center)).toBe(true);

    const cyl = payload.solids.cylinders[0];
    expect(cyl.type).toBe('cylinder');
    expect(Array.isArray(cyl.from)).toBe(true);
    expect(Array.isArray(cyl.to)).toBe(true);
    expect(typeof cyl.diameterIn).toBe('number');

    const pt = payload.solids.points[0];
    expect(pt.type).toBe('point');
    expect(Array.isArray(pt.position)).toBe(true);
    expect(pt.orientation).toBe('pendent');
  });

  it('is deterministic (same input -> identical payload)', () => {
    const again = buildGenerate3dModelPayload(buildCadModel(floorPlan));
    expect(JSON.stringify(again)).toBe(JSON.stringify(payload));
  });

  it('carries the fail-closed disclaimer from the cad model', () => {
    expect(payload.disclaimer).toBe(cadModel.disclaimer);
  });
});

describe('buildGenerateDxfPayload', () => {
  const payload = buildGenerateDxfPayload(cadModel);

  it('carries project name and the dxf tool name', () => {
    expect(payload.project).toBe('Test Plant');
    expect(payload.tool).toBe('generate_dxf');
    expect(payload.units).toBe('ft');
  });

  it('carries the same geometry summary counts as the 3d payload', () => {
    const threeD = buildGenerate3dModelPayload(cadModel);
    expect(payload.geometry).toEqual(threeD.solids);
    expect(payload.counts).toEqual(threeD.counts);
  });

  it('is deterministic', () => {
    const again = buildGenerateDxfPayload(buildCadModel(floorPlan));
    expect(JSON.stringify(again)).toBe(JSON.stringify(payload));
  });
});

describe('invokeOpenClawCad — graceful degradation', () => {
  it('returns ok:true with the result when the invoker succeeds', async () => {
    const calls = [];
    const invoker = async (toolName, payload) => {
      calls.push({ toolName, payload });
      return { modelId: 'm-123', status: 'queued' };
    };
    const payload = buildGenerate3dModelPayload(cadModel);
    const out = await invokeOpenClawCad('generate_3d_model', payload, { invoker });

    expect(out.ok).toBe(true);
    expect(out.skipped).toBeUndefined();
    expect(out.result).toEqual({ modelId: 'm-123', status: 'queued' });
    expect(calls).toHaveLength(1);
    expect(calls[0].toolName).toBe('generate_3d_model');
    expect(calls[0].payload).toBe(payload);
  });

  it('returns ok:false skipped:true (no throw) when the invoker is absent', async () => {
    const out = await invokeOpenClawCad('generate_3d_model', {}, {});
    expect(out.ok).toBe(false);
    expect(out.skipped).toBe(true);
    expect(typeof out.reason).toBe('string');
    expect(out.reason.length).toBeGreaterThan(0);
  });

  it('returns ok:false skipped:true when no options object is passed at all', async () => {
    const out = await invokeOpenClawCad('generate_dxf', {});
    expect(out.ok).toBe(false);
    expect(out.skipped).toBe(true);
  });

  it('returns ok:false skipped:true (no throw) when the invoker throws (gateway unreachable)', async () => {
    const invoker = async () => {
      throw new Error('ECONNREFUSED gx10 gateway unreachable');
    };
    let threw = false;
    let out;
    try {
      out = await invokeOpenClawCad('generate_3d_model', {}, { invoker });
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(out.ok).toBe(false);
    expect(out.skipped).toBe(true);
    expect(out.reason).toContain('ECONNREFUSED');
  });

  it('returns ok:false skipped:true when invoker is not a function', async () => {
    const out = await invokeOpenClawCad('generate_dxf', {}, { invoker: 'not-a-fn' });
    expect(out.ok).toBe(false);
    expect(out.skipped).toBe(true);
  });
});

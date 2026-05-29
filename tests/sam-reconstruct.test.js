import { describe, it, expect } from 'vitest';
import {
  buildSamReconstructPayload,
  reconstructComponentModel,
} from '../src/components/sam-reconstruct.js';

const BEST_EFFORT = /best-effort SAM 3\.1 reconstruction — NOT manufacturer-exact/;

describe('buildSamReconstructPayload — deterministic request shape', () => {
  it('includes component key + image ref + desired output mesh format', () => {
    const component = { key: 'head_pendent', category: 'heads', name: 'Pendent sprinkler head' };
    const imageRef = 'catalog/heads/pendent.png';
    const payload = buildSamReconstructPayload(component, imageRef);

    expect(payload).toBeTypeOf('object');
    expect(payload.componentKey).toBe('head_pendent');
    expect(payload.imageRef).toBe('catalog/heads/pendent.png');
    expect(payload.outputFormat).toBeTruthy();
    expect(typeof payload.outputFormat).toBe('string');
  });

  it('is deterministic for the same inputs', () => {
    const component = { key: 'valve_check', name: 'Check valve' };
    const a = buildSamReconstructPayload(component, 'img/a.png');
    const b = buildSamReconstructPayload(component, 'img/a.png');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('accepts a bare string component key', () => {
    const payload = buildSamReconstructPayload('hanger', 'img/h.png');
    expect(payload.componentKey).toBe('hanger');
    expect(payload.imageRef).toBe('img/h.png');
  });
});

describe('reconstructComponentModel — injected async invoker', () => {
  const component = { key: 'fitting_tee', name: 'Tee' };
  const imageRef = 'catalog/fittings/tee.png';

  it('returns ok + best-effort label on a successful mock invoker', async () => {
    const invoker = async (payload) => {
      expect(payload.componentKey).toBe('fitting_tee');
      return { mesh: 'SOLID tee ...', format: 'stl' };
    };
    const result = await reconstructComponentModel(component, imageRef, { invoker });
    expect(result.ok).toBe(true);
    expect(result.source).toBe('generated_sam');
    expect(result.model).toEqual({ mesh: 'SOLID tee ...', format: 'stl' });
    expect(result.label).toMatch(BEST_EFFORT);
  });

  it('accepts a raw (non-object) invoker return as the model', async () => {
    const invoker = async () => 'SOLID raw-mesh ...';
    const result = await reconstructComponentModel(component, imageRef, { invoker });
    expect(result.ok).toBe(true);
    expect(result.model).toBe('SOLID raw-mesh ...');
  });

  it('returns ok:false skipped:true when invoker is absent (no throw)', async () => {
    const result = await reconstructComponentModel(component, imageRef, {});
    expect(result.ok).toBe(false);
    expect(result.skipped).toBe(true);
    expect(typeof result.reason).toBe('string');
  });

  it('returns ok:false skipped:true when opts is omitted (no throw)', async () => {
    const result = await reconstructComponentModel(component, imageRef);
    expect(result.ok).toBe(false);
    expect(result.skipped).toBe(true);
  });

  it('returns ok:false skipped:true when invoker is not a function (no throw)', async () => {
    const result = await reconstructComponentModel(component, imageRef, { invoker: 'nope' });
    expect(result.ok).toBe(false);
    expect(result.skipped).toBe(true);
  });

  it('returns ok:false skipped:true when invoker throws (GX10/gateway down, no throw)', async () => {
    const invoker = async () => {
      throw new Error('ECONNREFUSED gx10');
    };
    const result = await reconstructComponentModel(component, imageRef, { invoker });
    expect(result.ok).toBe(false);
    expect(result.skipped).toBe(true);
    expect(typeof result.reason).toBe('string');
  });

  it('returns ok:false skipped:true when invoker yields an empty model (no fabricated success)', async () => {
    const invoker = async () => null;
    const result = await reconstructComponentModel(component, imageRef, { invoker });
    expect(result.ok).toBe(false);
    expect(result.skipped).toBe(true);
  });
});

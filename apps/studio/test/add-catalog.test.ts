import { describe, expect, it } from 'vitest';
import {
  samLaneState,
  validateImportFileName,
  DURABLE_IMPORT_INSTRUCTIONS,
  SAM_NOT_CONFIGURED_MESSAGE,
} from '../src/lib/add-catalog';

describe('Add-Catalog SAM lane (fail-closed by default)', () => {
  it('no invoker -> not available, honest not-configured reason', () => {
    const state = samLaneState(undefined);
    expect(state.available).toBe(false);
    if (!state.available) {
      expect(state.reason).toBe('sam_endpoint_not_configured');
    }
  });

  it('non-function invoker -> not available (never fabricates availability)', () => {
    expect(samLaneState(null).available).toBe(false);
    expect(samLaneState('http://sam').available).toBe(false);
    expect(samLaneState({}).available).toBe(false);
  });

  it('a configured invoker function -> available', () => {
    const invoker = async () => ({ ok: true });
    expect(samLaneState(invoker).available).toBe(true);
  });

  it('the not-configured message never claims fabricated geometry', () => {
    expect(SAM_NOT_CONFIGURED_MESSAGE).toMatch(/not configured/i);
    expect(SAM_NOT_CONFIGURED_MESSAGE).toMatch(/never fabricates/i);
  });
});

describe('Add-Catalog import path (STEP file validation)', () => {
  it('accepts a .stp file', () => {
    const v = validateImportFileName('Etanorm_FXE.stp');
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.ext).toBe('stp');
  });

  it('accepts a .step file (case-insensitive)', () => {
    const v = validateImportFileName('PART.STEP');
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.ext).toBe('step');
  });

  it('rejects a non-STEP file honestly', () => {
    const v = validateImportFileName('drawing.pdf');
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe('not_a_step_file');
  });

  it('rejects an empty / missing name honestly', () => {
    expect(validateImportFileName('')).toEqual({ ok: false, reason: 'no_file' });
    expect(validateImportFileName(null)).toEqual({ ok: false, reason: 'no_file' });
    expect(validateImportFileName(undefined)).toEqual({ ok: false, reason: 'no_file' });
  });

  it('the durable instructions point at the incoming folder + import script', () => {
    expect(DURABLE_IMPORT_INSTRUCTIONS).toMatch(/manufacturer-incoming/);
    expect(DURABLE_IMPORT_INSTRUCTIONS).toMatch(/import-manufacturer-step\.mjs/);
  });
});

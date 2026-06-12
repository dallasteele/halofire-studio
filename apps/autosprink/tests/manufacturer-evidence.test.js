import { describe, it, expect } from 'vitest';
import { buildManufacturerEvidence } from '../src/autobid/manufacturer-evidence.js';

describe('buildManufacturerEvidence', () => {
  it('should yield an evidence record with the best-effort type and no_claims_cleared when cutSheetUrl is provided', () => {
    const part = {
      sku: 'PIPE-001',
      manufacturer: 'Acme Corp',
      cutSheetUrl: 'https://example.com/sheet.pdf'
    };

    const result = buildManufacturerEvidence(part);

    expect(result.evidence_type).toBe('manufacturer_model_best_effort');
    expect(result.source_ref).toBe('https://example.com/sheet.pdf');
    expect(JSON.parse(result.notes).verificationStatus).toBe('needs-verification');
    expect(result.claim_gate_effect).toBe('no_claims_cleared');
  });

  it('should yield an evidence record with the best-effort type and no_claims_cleared when generatedModelRef is provided', () => {
    const part = {
      sku: 'VALVE-99',
      manufacturer: 'FlowCo',
      generatedModelRef: 'model-ref-123'
    };

    const result = buildManufacturerEvidence(part);

    expect(result.evidence_type).toBe('manufacturer_model_best_effort');
    expect(result.source_ref).toBe('model-ref-123');
    expect(JSON.parse(result.notes).verificationStatus).toBe('needs-verification');
    expect(result.claim_gate_effect).toBe('no_claims_cleared');
  });

  it('should throw TypeError if sku is missing', () => {
    const part = { manufacturer: 'Acme Corp' };
    expect(() => buildManufacturerEvidence(part)).toThrow();
  });

  it('should throw TypeError if sku is not a string', () => {
    const part = { sku: 123, manufacturer: 'Acme Corp' };
    expect(() => buildManufacturerEvidence(part)).toThrow();
  });
});
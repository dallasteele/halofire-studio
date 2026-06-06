import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CONNECTOR_INGEST_LANES,
  CONNECTOR_SOURCE_TYPES,
  CONNECTOR_STATUSES,
  connectorCount,
  connectorsEnabledCount,
  isSafeApiKeyRef,
  loadConnectorRegistry,
  parseConnector,
  parseConnectorRegistry,
  type ManufacturerConnector,
} from '../src/lib/manufacturer-connectors';

const REGISTRY_PATH = resolve(
  __dirname,
  '../public/connectors/manufacturer-connectors.json',
);

function shippedRegistryJson(): unknown {
  return JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
}

describe('isSafeApiKeyRef (secret guard)', () => {
  it('accepts SCREAMING_SNAKE env-var names', () => {
    expect(isSafeApiKeyRef('TRACEPARTS_API_KEY')).toBe(true);
    expect(isSafeApiKeyRef('ARCAT_LOGIN')).toBe(true);
    expect(isSafeApiKeyRef('THREEDFINDIT_ACCOUNT')).toBe(true);
  });

  it('rejects null / empty / non-string', () => {
    expect(isSafeApiKeyRef(null)).toBe(false);
    expect(isSafeApiKeyRef(undefined)).toBe(false);
    expect(isSafeApiKeyRef('')).toBe(false);
    expect(isSafeApiKeyRef('   ')).toBe(false);
    expect(isSafeApiKeyRef(123)).toBe(false);
  });

  it('rejects values that LOOK like real secrets', () => {
    expect(isSafeApiKeyRef('sk-abc123def456')).toBe(false); // provider key
    expect(isSafeApiKeyRef('eyJhbGc.eyJzdWI.SflKxwRJ')).toBe(false); // JWT-ish
    expect(isSafeApiKeyRef('abcd1234efgh5678ijkl9012mnop3456')).toBe(false); // 32-hex
    expect(isSafeApiKeyRef('has spaces')).toBe(false);
    expect(isSafeApiKeyRef('has-dashes-and.dots')).toBe(false);
    expect(isSafeApiKeyRef('x'.repeat(80))).toBe(false); // too long
  });
});

describe('parseConnector', () => {
  it('drops a secret-looking apiKeyRef to null (never carries a key)', () => {
    const c = parseConnector({
      id: 'x',
      name: 'X',
      status: 'needs_config',
      sourceType: 'rest_api',
      apiKeyRef: 'sk-LIVE-SECRET-VALUE',
    });
    expect(c).not.toBeNull();
    expect(c?.apiKeyRef).toBeNull();
  });

  it('keeps a valid env-var-name apiKeyRef', () => {
    const c = parseConnector({
      id: 'x',
      name: 'X',
      status: 'needs_config',
      sourceType: 'rest_api',
      apiKeyRef: 'TRACEPARTS_API_KEY',
    });
    expect(c?.apiKeyRef).toBe('TRACEPARTS_API_KEY');
  });

  it('returns null for a row missing id/name/status', () => {
    expect(parseConnector({ name: 'no id', status: 'enabled' })).toBeNull();
    expect(parseConnector({ id: 'a', status: 'enabled' })).toBeNull();
    expect(parseConnector({ id: 'a', name: 'A', status: 'bogus' })).toBeNull();
    expect(parseConnector(null)).toBeNull();
  });

  it('coerces unknown sourceType to "unknown" and bad ingestLane to catalog_spec', () => {
    const c = parseConnector({
      id: 'x',
      name: 'X',
      status: 'needs_config',
      sourceType: 'made_up',
      ingestLane: 'made_up',
    });
    expect(c?.sourceType).toBe('unknown');
    expect(c?.ingestLane).toBe('catalog_spec');
  });
});

describe('parseConnectorRegistry + counts', () => {
  it('parses the SHIPPED registry with all expected manufacturers', () => {
    const reg = parseConnectorRegistry(shippedRegistryJson());
    const ids = reg.connectors.map((c) => c.id);

    const researched = [
      'victaulic',
      'argco',
      'potter-roemer',
      'potter-electric',
      'watts',
      'reliable',
      'viking',
      'wheatland',
      'bull-moose',
    ];
    const userAdded = [
      'tyco-johnson-controls',
      'afcon',
      'patterson-pump',
      'clarke',
      'tornatech',
      'siemens',
      'engineered-corrosion-systems',
    ];
    for (const id of [...researched, ...userAdded]) {
      expect(ids, `missing connector ${id}`).toContain(id);
    }
    expect(reg.connectors.length).toBe(researched.length + userAdded.length);
  });

  it('every connector has a valid status / sourceType / ingestLane', () => {
    const reg = parseConnectorRegistry(shippedRegistryJson());
    for (const c of reg.connectors) {
      expect(CONNECTOR_STATUSES).toContain(c.status);
      expect(CONNECTOR_SOURCE_TYPES).toContain(c.sourceType);
      expect(CONNECTOR_INGEST_LANES).toContain(c.ingestLane);
    }
  });

  it('apiKeyRef is ALWAYS an env-name string or null — NEVER a key-looking secret', () => {
    const reg = parseConnectorRegistry(shippedRegistryJson());
    for (const c of reg.connectors) {
      for (const ref of [c.apiKeyRef, c.secondaryApiKeyRef]) {
        if (ref === null) continue;
        expect(typeof ref).toBe('string');
        expect(isSafeApiKeyRef(ref)).toBe(true);
        expect(ref).not.toMatch(/^sk-/i);
      }
    }
  });

  it('only genuinely ungated sources are "enabled"; gated sources name a key', () => {
    const reg = parseConnectorRegistry(shippedRegistryJson());
    const byId = new Map(reg.connectors.map((c) => [c.id, c]));

    // Zero-credential ungated => enabled, apiKeyRef null.
    for (const id of ['victaulic', 'reliable', 'wheatland', 'bull-moose']) {
      const c = byId.get(id) as ManufacturerConnector;
      expect(c.status, id).toBe('enabled');
      expect(c.apiKeyRef, id).toBeNull();
    }

    // Argco has no automatable CAD => manual.
    expect(byId.get('argco')?.status).toBe('manual');

    // Gated sources => needs_config, with the specific key named.
    for (const id of ['watts', 'viking', 'potter-electric', 'potter-roemer']) {
      const c = byId.get(id) as ManufacturerConnector;
      expect(c.status, id).toBe('needs_config');
      expect(c.apiKeyRef, id).not.toBeNull();
    }

    // User-added vendors => needs_config + unknown sourceType (honest research-TODO).
    for (const id of [
      'tyco-johnson-controls',
      'afcon',
      'patterson-pump',
      'clarke',
      'tornatech',
      'siemens',
      'engineered-corrosion-systems',
    ]) {
      const c = byId.get(id) as ManufacturerConnector;
      expect(c.status, id).toBe('needs_config');
      expect(c.sourceType, id).toBe('unknown');
    }
  });

  it('exactly four enabled connectors in the shipped registry', () => {
    const reg = parseConnectorRegistry(shippedRegistryJson());
    expect(connectorCount(reg)).toBe(16);
    expect(connectorsEnabledCount(reg)).toBe(4);
  });
});

describe('loadConnectorRegistry (fail-soft)', () => {
  it('returns EMPTY with no fetch impl', async () => {
    const reg = await loadConnectorRegistry(undefined);
    expect(reg.connectors).toEqual([]);
  });

  it('returns EMPTY on a non-2xx response', async () => {
    const reg = await loadConnectorRegistry(
      (async () => ({ ok: false, status: 404 })) as unknown as typeof fetch,
    );
    expect(reg.connectors).toEqual([]);
  });

  it('parses a good response', async () => {
    const json = shippedRegistryJson();
    const reg = await loadConnectorRegistry(
      (async () => ({ ok: true, json: async () => json })) as unknown as typeof fetch,
    );
    expect(reg.connectors.length).toBe(16);
  });
});

import { describe, expect, it } from 'vitest';
import {
  DEFERRED_SAVE_MESSAGE,
  applyConfigInput,
  createMemoryStore,
  defaultConfigState,
  loadConfigState,
  parseConfigState,
  redactSecret,
  saveConfigState,
  serializeConfigState,
  type ConnectorConfigState,
} from '../src/lib/connector-config';

const NOW = '2026-06-05T00:00:00.000Z';

describe('applyConfigInput — catalog link', () => {
  it('saves a valid http(s) link, marks DEFERRED', () => {
    const res = applyConfigInput(
      defaultConfigState('victaulic'),
      { kind: 'catalog-link', url: 'https://example.com/cad ' },
      NOW,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.catalogUrlOverride).toBe('https://example.com/cad');
    expect(res.state.deferred).toBe(true);
    expect(res.state.message).toBe(DEFERRED_SAVE_MESSAGE);
    expect(res.state.savedAt).toBe(NOW);
  });

  it('rejects a non-URL', () => {
    const res = applyConfigInput(
      defaultConfigState('victaulic'),
      { kind: 'catalog-link', url: 'not a url' },
      NOW,
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('invalid_url');
  });

  it('rejects a non-http scheme (e.g. javascript:)', () => {
    const res = applyConfigInput(
      defaultConfigState('x'),
      { kind: 'catalog-link', url: 'javascript:alert(1)' },
      NOW,
    );
    expect(res.ok).toBe(false);
  });
});

describe('applyConfigInput — credential (NEVER stores the secret)', () => {
  it('records ONLY the env-var name + a flag, discards the value', () => {
    const res = applyConfigInput(
      defaultConfigState('watts'),
      { kind: 'credential', apiKeyRef: 'TRACEPARTS_API_KEY', value: 'sk-SUPER-SECRET' },
      NOW,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.credentialConfigured).toBe(true);
    expect(res.state.credentialRef).toBe('TRACEPARTS_API_KEY');
    expect(res.state.deferred).toBe(true);
    expect(res.state.message).toBe(DEFERRED_SAVE_MESSAGE);
    // The secret value appears NOWHERE in the resulting state.
    const blob = JSON.stringify(res.state);
    expect(blob).not.toContain('sk-SUPER-SECRET');
    expect(blob).not.toContain('SUPER-SECRET');
  });

  it('rejects an empty credential value', () => {
    const res = applyConfigInput(
      defaultConfigState('watts'),
      { kind: 'credential', apiKeyRef: 'TRACEPARTS_API_KEY', value: '   ' },
      NOW,
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('empty_credential');
  });

  it('rejects an apiKeyRef that looks like a secret (not an env-var name)', () => {
    const res = applyConfigInput(
      defaultConfigState('watts'),
      { kind: 'credential', apiKeyRef: 'sk-not-a-name', value: 'x' },
      NOW,
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('looks_like_secret_ref');
  });
});

describe('applyConfigInput — toggle', () => {
  it('records enable/disable intent, marks DEFERRED', () => {
    const off = applyConfigInput(
      defaultConfigState('victaulic'),
      { kind: 'toggle', enabled: false },
      NOW,
    );
    expect(off.ok).toBe(true);
    if (!off.ok) return;
    expect(off.state.enabledOverride).toBe(false);
    expect(off.state.deferred).toBe(true);
    expect(off.state.message).toBe(DEFERRED_SAVE_MESSAGE);
  });
});

describe('redactSecret', () => {
  it('never returns the input value', () => {
    expect(redactSecret('sk-LIVE-KEY')).not.toContain('LIVE');
    expect(redactSecret('anything')).toBe('••••••••');
  });
});

describe('serialize/parse roundtrip is secret-free', () => {
  it('roundtrips a credential-configured state without a value', () => {
    const res = applyConfigInput(
      defaultConfigState('viking'),
      { kind: 'credential', apiKeyRef: 'TRACEPARTS_API_KEY', value: 'leak-me-please' },
      NOW,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const json = serializeConfigState(res.state);
    expect(json).not.toContain('leak-me-please');
    const back = parseConfigState('viking', json);
    expect(back.credentialConfigured).toBe(true);
    expect(back.credentialRef).toBe('TRACEPARTS_API_KEY');
    expect(back.deferred).toBe(true);
  });

  it('parse fail-softs to default on bad JSON', () => {
    const s = parseConfigState('x', '{not json');
    expect(s).toEqual(defaultConfigState('x'));
  });
});

describe('store persistence (settings-panel state machine)', () => {
  it('saves + loads via the store, persisting the DEFERRED marker, no secret', () => {
    const store = createMemoryStore();
    const res = applyConfigInput(
      defaultConfigState('potter-electric'),
      { kind: 'credential', apiKeyRef: 'THREEDFINDIT_ACCOUNT', value: 'topsecret' },
      NOW,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    saveConfigState(store, res.state);

    const loaded: ConnectorConfigState = loadConfigState(store, 'potter-electric');
    expect(loaded.credentialConfigured).toBe(true);
    expect(loaded.credentialRef).toBe('THREEDFINDIT_ACCOUNT');
    expect(loaded.message).toBe(DEFERRED_SAVE_MESSAGE);
    expect(loaded.deferred).toBe(true);

    // The raw stored bytes contain NO secret.
    const raw = store.getItem('halofire.connector-config.potter-electric');
    expect(raw).toBeTruthy();
    expect(raw).not.toContain('topsecret');
  });

  it('loadConfigState returns default for an unsaved connector', () => {
    const store = createMemoryStore();
    expect(loadConfigState(store, 'nope')).toEqual(defaultConfigState('nope'));
  });
});

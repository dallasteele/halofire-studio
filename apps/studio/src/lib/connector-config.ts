// PURE connector-config state machine — no React / three / network imports.
//
// The honest logic behind the Manufacturers settings panel. The operator can, per
// connector, paste a catalog LINK or an API key / login and toggle enable/disable.
// Saving stores the value as connector config and CLEARLY marks the integration
// DEFERRED — saving config does NOT execute any live pull.
//
// HONESTY (hard, fail-closed):
//   - A saved config NEVER performs a live integration. Every saved state is
//     `deferred: true` with the message "saved — will sync when Halo Fire enables
//     integration". The studio never claims a sync happened.
//   - A secret value is NEVER stored or echoed. When the operator pastes an API
//     key/login, we record ONLY a boolean `credentialConfigured` flag plus the
//     env-var NAME (apiKeyRef) the value belongs under — the value itself is
//     discarded immediately (redactSecret). A committed registry / persisted config
//     therefore can never contain a key.
//   - A pasted catalog LINK is not a secret and IS stored (catalogUrlOverride), but
//     it is validated as an http(s) URL; anything else is rejected.
//
// Persistence is a thin Storage port (localStorage in the app, an in-memory map in
// tests) keyed by connector id. The committed registry supplies defaults.

import { isSafeApiKeyRef } from './manufacturer-connectors';

/** What the operator is saving for a connector. */
export type ConnectorConfigInput =
  | { kind: 'catalog-link'; url: string }
  | { kind: 'credential'; apiKeyRef: string; value: string }
  | { kind: 'toggle'; enabled: boolean };

/**
 * Persisted, SECRET-FREE config for one connector. This is what lands in storage
 * and could be committed — it carries NO secret value, only flags + the env-var
 * NAME + a non-secret catalog link.
 */
export interface ConnectorConfigState {
  connectorId: string;
  /** Operator-pasted catalog/resource link override (http/https), or null. */
  catalogUrlOverride: string | null;
  /**
   * The env-var NAME the operator's credential belongs under (e.g.
   * "TRACEPARTS_API_KEY"). NEVER the value. null when no credential was supplied.
   */
  credentialRef: string | null;
  /** True once the operator supplied a credential value (value itself discarded). */
  credentialConfigured: boolean;
  /** Operator enable/disable intent. null = inherit the registry default. */
  enabledOverride: boolean | null;
  /**
   * ALWAYS true: a saved config is DEFERRED — it does not run a live integration.
   * Surfaced verbatim to the operator. Honest by construction.
   */
  deferred: true;
  /** Honest operator-facing message shown after save. */
  message: string;
  /** ISO-ish timestamp string, or null. Injected (never wall-clock guessed here). */
  savedAt: string | null;
}

/** Result of applying a config input. */
export type ConnectorConfigResult =
  | { ok: true; state: ConnectorConfigState }
  | { ok: false; reason: ConnectorConfigError };

export type ConnectorConfigError =
  | 'invalid_url'
  | 'empty_credential'
  | 'looks_like_secret_ref'; // apiKeyRef supplied was not a safe env-var name

/** The honest deferred message every saved config carries. */
export const DEFERRED_SAVE_MESSAGE =
  'saved — will sync when Halo Fire enables integration';

/** Minimal storage port (localStorage-compatible subset). */
export interface ConfigStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** An in-memory ConfigStore (tests / SSR-safe fallback). */
export function createMemoryStore(initial?: Record<string, string>): ConfigStore {
  const map = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

const STORE_PREFIX = 'halofire.connector-config.';

function storeKey(connectorId: string): string {
  return STORE_PREFIX + connectorId;
}

/** A pristine default state for a connector (no overrides). */
export function defaultConfigState(connectorId: string): ConnectorConfigState {
  return {
    connectorId,
    catalogUrlOverride: null,
    credentialRef: null,
    credentialConfigured: false,
    enabledOverride: null,
    deferred: true,
    message: '',
    savedAt: null,
  };
}

/**
 * Irreversibly drop a secret value. The studio never stores or echoes a pasted
 * key/login — this returns a redacted marker for logs/UI, never the value.
 */
export function redactSecret(_value: string): string {
  void _value;
  return '••••••••';
}

function isValidHttpUrl(s: string): boolean {
  const t = s.trim();
  if (!/^https?:\/\//i.test(t)) return false;
  try {
    // eslint-disable-next-line no-new
    new URL(t);
    return true;
  } catch {
    return false;
  }
}

/**
 * Apply a config input to a prior state, producing the next SECRET-FREE state.
 * Pure: state in + input in -> result out. The credential value is consumed and
 * discarded here; it never appears in the returned state.
 *
 * @param prev   prior state (use defaultConfigState for a fresh connector).
 * @param input  what the operator is saving.
 * @param now    ISO timestamp to stamp (injected for determinism/testability).
 */
export function applyConfigInput(
  prev: ConnectorConfigState,
  input: ConnectorConfigInput,
  now: string | null = null,
): ConnectorConfigResult {
  const base: ConnectorConfigState = { ...prev, deferred: true };

  switch (input.kind) {
    case 'catalog-link': {
      if (!isValidHttpUrl(input.url)) {
        return { ok: false, reason: 'invalid_url' };
      }
      return {
        ok: true,
        state: {
          ...base,
          catalogUrlOverride: input.url.trim(),
          message: DEFERRED_SAVE_MESSAGE,
          savedAt: now,
        },
      };
    }
    case 'credential': {
      // The apiKeyRef MUST be a safe env-var NAME (not a secret-looking string).
      if (!isSafeApiKeyRef(input.apiKeyRef)) {
        return { ok: false, reason: 'looks_like_secret_ref' };
      }
      const value = typeof input.value === 'string' ? input.value.trim() : '';
      if (value.length === 0) {
        return { ok: false, reason: 'empty_credential' };
      }
      // CONSUME + DISCARD the value. We record ONLY the env-var name + a flag.
      return {
        ok: true,
        state: {
          ...base,
          credentialRef: input.apiKeyRef.trim(),
          credentialConfigured: true,
          message: DEFERRED_SAVE_MESSAGE,
          savedAt: now,
        },
      };
    }
    case 'toggle': {
      return {
        ok: true,
        state: {
          ...base,
          enabledOverride: input.enabled,
          message: DEFERRED_SAVE_MESSAGE,
          savedAt: now,
        },
      };
    }
  }
}

/**
 * Serialize a config state to JSON for storage. Guarantees NO secret leaks: the
 * state shape carries no value field, and we assert that here as a hard invariant.
 */
export function serializeConfigState(state: ConnectorConfigState): string {
  const safe: ConnectorConfigState = {
    connectorId: state.connectorId,
    catalogUrlOverride: state.catalogUrlOverride,
    credentialRef: state.credentialRef,
    credentialConfigured: state.credentialConfigured,
    enabledOverride: state.enabledOverride,
    deferred: true,
    message: state.message,
    savedAt: state.savedAt,
  };
  return JSON.stringify(safe);
}

/** Parse a stored config state, fail-soft to the default. */
export function parseConfigState(
  connectorId: string,
  json: string | null,
): ConnectorConfigState {
  if (typeof json !== 'string' || json.length === 0) {
    return defaultConfigState(connectorId);
  }
  try {
    const o = JSON.parse(json) as Record<string, unknown>;
    return {
      connectorId,
      catalogUrlOverride:
        typeof o.catalogUrlOverride === 'string' ? o.catalogUrlOverride : null,
      credentialRef: typeof o.credentialRef === 'string' ? o.credentialRef : null,
      credentialConfigured: o.credentialConfigured === true,
      enabledOverride:
        typeof o.enabledOverride === 'boolean' ? o.enabledOverride : null,
      deferred: true,
      message: typeof o.message === 'string' ? o.message : '',
      savedAt: typeof o.savedAt === 'string' ? o.savedAt : null,
    };
  } catch {
    return defaultConfigState(connectorId);
  }
}

/** Load a connector's persisted config (default when absent). */
export function loadConfigState(
  store: ConfigStore,
  connectorId: string,
): ConnectorConfigState {
  return parseConfigState(connectorId, store.getItem(storeKey(connectorId)));
}

/** Persist a connector's config state (secret-free by construction). */
export function saveConfigState(store: ConfigStore, state: ConnectorConfigState): void {
  store.setItem(storeKey(state.connectorId), serializeConfigState(state));
}

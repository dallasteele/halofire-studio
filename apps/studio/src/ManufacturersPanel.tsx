// HaloFire Studio — "Manufacturers / Connectors" settings panel.
//
// Lists every per-manufacturer connector as a row: name, sourceType, status badge,
// the how-to-add note, a FIELD to paste a catalog link OR an API key / login, and
// an enable/disable toggle. Saving stores the value as connector config (localStorage
// keyed by connector id, committed registry as defaults) and CLEARLY marks the
// integration DEFERRED — saving does NOT execute any live pull.
//
// HONESTY (hard): a pasted secret is NEVER stored or echoed — only a boolean
// "configured" flag + the env-var NAME are persisted (see connector-config.ts). The
// row shows "saved — will sync when Halo Fire enables integration". Statuses come
// from the committed registry (truthful per the research). NOT AHJ / PE / certified.

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactElement,
} from 'react';
import {
  type ManufacturerConnector,
  type ConnectorStatus,
} from './lib/manufacturer-connectors';
import {
  applyConfigInput,
  defaultConfigState,
  loadConfigState,
  saveConfigState,
  createMemoryStore,
  type ConfigStore,
  type ConnectorConfigState,
} from './lib/connector-config';
import { colors, radii, spacing, typeScale } from './lib/tokens';

export interface ManufacturersPanelProps {
  /** Connectors to render (from the DB, fail-soft to the committed registry). */
  connectors: ManufacturerConnector[];
  /** Where connector config persists. Defaults to localStorage; tests inject one. */
  store?: ConfigStore;
  /** Clock for the deferred-save timestamp (injected for determinism). */
  now?: () => string;
}

/** localStorage-backed store, SSR/test-safe (falls back to in-memory). */
function browserStore(): ConfigStore {
  try {
    if (typeof localStorage !== 'undefined') {
      return {
        getItem: (k) => localStorage.getItem(k),
        setItem: (k, v) => localStorage.setItem(k, v),
        removeItem: (k) => localStorage.removeItem(k),
      };
    }
  } catch {
    /* fall through */
  }
  return createMemoryStore();
}

const STATUS_LABEL: Record<ConnectorStatus, string> = {
  enabled: 'Enabled',
  needs_config: 'Needs config',
  manual: 'Manual',
  disabled: 'Disabled',
};

const STATUS_COLOR: Record<ConnectorStatus, string> = {
  enabled: colors.success,
  needs_config: colors.warn,
  manual: colors.textMuted,
  disabled: colors.danger,
};

export function ManufacturersPanel({
  connectors,
  store,
  now,
}: ManufacturersPanelProps): ReactElement {
  const cfgStore = useMemo(() => store ?? browserStore(), [store]);

  const enabledCount = connectors.filter((c) => c.status === 'enabled').length;

  return (
    <section
      style={wrapStyle}
      aria-label="Manufacturers connectors"
      data-testid="manufacturers-panel"
    >
      <header style={headerStyle}>
        <h2 style={titleStyle}>Manufacturers &amp; Connectors</h2>
        <p style={subtitleStyle}>
          {connectors.length} connectors · {enabledCount} enabled. Paste a catalog
          link or an API key / login per manufacturer. Saving stores config only —
          integration is DEFERRED until Halo Fire enables it. A pasted key is never
          stored or shown; we record only that it is configured.
        </p>
      </header>

      <ul style={listStyle} data-testid="connector-list">
        {connectors.map((c) => (
          <ConnectorRow
            key={c.id}
            connector={c}
            store={cfgStore}
            now={now}
          />
        ))}
      </ul>
    </section>
  );
}

interface ConnectorRowProps {
  connector: ManufacturerConnector;
  store: ConfigStore;
  now?: () => string;
}

function ConnectorRow({ connector, store, now }: ConnectorRowProps): ReactElement {
  const [config, setConfig] = useState<ConnectorConfigState>(() =>
    defaultConfigState(connector.id),
  );
  const [linkDraft, setLinkDraft] = useState('');
  const [keyDraft, setKeyDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Hydrate persisted config on mount.
  useEffect(() => {
    setConfig(loadConfigState(store, connector.id));
  }, [store, connector.id]);

  const stamp = useCallback(() => (now ? now() : new Date().toISOString()), [now]);

  const persist = useCallback(
    (next: ConnectorConfigState) => {
      saveConfigState(store, next);
      setConfig(next);
    },
    [store],
  );

  const onSaveLink = useCallback(() => {
    setError(null);
    const res = applyConfigInput(config, { kind: 'catalog-link', url: linkDraft }, stamp());
    if (!res.ok) {
      setError(
        res.reason === 'invalid_url'
          ? 'Enter a valid http(s) catalog link.'
          : 'Could not save link.',
      );
      return;
    }
    persist(res.state);
    setLinkDraft('');
  }, [config, linkDraft, stamp, persist]);

  const onSaveKey = useCallback(() => {
    setError(null);
    // The env-var NAME the value belongs under: the registry's apiKeyRef when set,
    // else a derived NAME from the connector id (never a secret).
    const ref =
      connector.apiKeyRef ??
      `${connector.id.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_CREDENTIAL`;
    const res = applyConfigInput(
      config,
      { kind: 'credential', apiKeyRef: ref, value: keyDraft },
      stamp(),
    );
    if (!res.ok) {
      setError(
        res.reason === 'empty_credential'
          ? 'Paste a non-empty key / login value.'
          : res.reason === 'looks_like_secret_ref'
            ? 'Credential reference is not a valid env-var name.'
            : 'Could not save credential.',
      );
      return;
    }
    persist(res.state);
    // CLEAR the draft immediately — the secret value is never retained in state.
    setKeyDraft('');
  }, [config, keyDraft, stamp, persist, connector.apiKeyRef, connector.id]);

  const onToggle = useCallback(() => {
    setError(null);
    const currentlyEnabled =
      config.enabledOverride ?? connector.status === 'enabled';
    const res = applyConfigInput(
      config,
      { kind: 'toggle', enabled: !currentlyEnabled },
      stamp(),
    );
    if (res.ok) persist(res.state);
  }, [config, connector.status, stamp, persist]);

  const effectiveEnabled = config.enabledOverride ?? connector.status === 'enabled';
  const requiresKey = connector.apiKeyRef !== null || connector.status === 'needs_config';

  return (
    <li style={rowStyle} data-testid={`connector-row-${connector.id}`}>
      <div style={rowHeadStyle}>
        <div style={rowTitleWrapStyle}>
          <span style={rowNameStyle}>{connector.name}</span>
          <span style={sourceTypeStyle}>{connector.sourceType}</span>
          <span style={laneStyle}>lane: {connector.ingestLane}</span>
        </div>
        <span
          style={{ ...badgeStyle, background: STATUS_COLOR[connector.status] }}
          data-testid={`connector-status-${connector.id}`}
        >
          {STATUS_LABEL[connector.status]}
        </span>
      </div>

      <p style={noteStyle}>{connector.notes}</p>

      {connector.apiKeyRef ? (
        <p style={keyRefStyle}>
          Requires env var <code style={codeStyle}>{connector.apiKeyRef}</code>
          {connector.secondaryApiKeyRef ? (
            <>
              {' '}+ <code style={codeStyle}>{connector.secondaryApiKeyRef}</code>
            </>
          ) : null}
        </p>
      ) : null}

      <div style={fieldsStyle}>
        <div style={fieldGroupStyle}>
          <label style={fieldLabelStyle}>
            Catalog link
            <input
              type="url"
              value={linkDraft}
              placeholder={connector.catalogUrl ?? 'https://…'}
              onChange={(e) => setLinkDraft(e.target.value)}
              style={inputStyle}
              data-testid={`link-input-${connector.id}`}
            />
          </label>
          <button
            type="button"
            onClick={onSaveLink}
            style={saveBtnStyle}
            data-testid={`save-link-${connector.id}`}
          >
            Save link
          </button>
        </div>

        {requiresKey ? (
          <div style={fieldGroupStyle}>
            <label style={fieldLabelStyle}>
              API key / login (never stored as text)
              <input
                type="password"
                value={keyDraft}
                placeholder="paste key / login"
                onChange={(e) => setKeyDraft(e.target.value)}
                style={inputStyle}
                data-testid={`key-input-${connector.id}`}
                autoComplete="off"
              />
            </label>
            <button
              type="button"
              onClick={onSaveKey}
              style={saveBtnStyle}
              data-testid={`save-key-${connector.id}`}
            >
              Save key
            </button>
          </div>
        ) : null}

        <button
          type="button"
          onClick={onToggle}
          role="switch"
          aria-checked={effectiveEnabled}
          style={{
            ...toggleBtnStyle,
            background: effectiveEnabled ? colors.success : colors.surfaceRaised,
            color: effectiveEnabled ? colors.onAccent : colors.textSecondary,
          }}
          data-testid={`toggle-${connector.id}`}
        >
          {effectiveEnabled ? 'Enabled' : 'Disabled'}
        </button>
      </div>

      {error ? (
        <p role="alert" style={errorStyle} data-testid={`config-error-${connector.id}`}>
          {error}
        </p>
      ) : null}

      {config.message ? (
        <div style={savedStyle} role="status" data-testid={`saved-${connector.id}`}>
          <strong style={{ color: colors.textPrimary }}>{config.message}</strong>
          <span style={deferredHintStyle}>
            {' '}
            Integration is deferred — no live pull runs in the demo.
          </span>
          {config.credentialConfigured ? (
            <span style={configuredHintStyle}>
              {' '}
              Credential configured under{' '}
              <code style={codeStyle}>{config.credentialRef}</code> (value not stored).
            </span>
          ) : null}
          {config.catalogUrlOverride ? (
            <span style={configuredHintStyle}>
              {' '}
              Link saved: {config.catalogUrlOverride}
            </span>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/* -------------------------------------------------------------- styles */

const wrapStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: spacing[4],
  padding: spacing[5],
  overflowY: 'auto',
  background: colors.bg,
};

const headerStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: spacing[1],
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: typeScale.lg.size,
  fontWeight: 700,
  color: colors.textPrimary,
};

const subtitleStyle: CSSProperties = {
  margin: 0,
  fontSize: typeScale.sm.size,
  color: colors.textSecondary,
  maxWidth: 720,
  lineHeight: 1.5,
};

const listStyle: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: spacing[3],
};

const rowStyle: CSSProperties = {
  border: `1px solid ${colors.border}`,
  borderRadius: radii.lg,
  background: colors.surface,
  padding: spacing[4],
  display: 'flex',
  flexDirection: 'column',
  gap: spacing[2],
  maxWidth: 760,
};

const rowHeadStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: spacing[3],
};

const rowTitleWrapStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: spacing[2],
  flexWrap: 'wrap',
};

const rowNameStyle: CSSProperties = {
  fontSize: typeScale.base.size,
  fontWeight: 700,
  color: colors.textPrimary,
};

const sourceTypeStyle: CSSProperties = {
  fontSize: typeScale.xs.size,
  fontFamily: 'var(--hf-font-mono)',
  color: colors.textSecondary,
};

const laneStyle: CSSProperties = {
  fontSize: typeScale.xs.size,
  color: colors.textMuted,
};

const badgeStyle: CSSProperties = {
  fontSize: typeScale.xs.size,
  fontWeight: 700,
  color: colors.onAccent,
  padding: `${spacing[0.5]} ${spacing[2]}`,
  borderRadius: radii.pill,
  whiteSpace: 'nowrap',
};

const noteStyle: CSSProperties = {
  margin: 0,
  fontSize: typeScale.sm.size,
  lineHeight: 1.5,
  color: colors.textSecondary,
};

const keyRefStyle: CSSProperties = {
  margin: 0,
  fontSize: typeScale.xs.size,
  color: colors.accentText,
};

const codeStyle: CSSProperties = {
  fontFamily: 'var(--hf-font-mono)',
  fontSize: typeScale.xs.size,
  background: colors.bgInset,
  padding: `0 ${spacing[1]}`,
  borderRadius: radii.sm,
  color: colors.textPrimary,
};

const fieldsStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: spacing[3],
  alignItems: 'flex-end',
};

const fieldGroupStyle: CSSProperties = {
  display: 'flex',
  gap: spacing[2],
  alignItems: 'flex-end',
};

const fieldLabelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: spacing[1],
  fontSize: typeScale.xs.size,
  color: colors.textSecondary,
};

const inputStyle: CSSProperties = {
  minWidth: 220,
  padding: `${spacing[1]} ${spacing[2]}`,
  fontSize: typeScale.sm.size,
  background: colors.surfaceRaised,
  border: `1px solid ${colors.border}`,
  borderRadius: radii.md,
  color: colors.textPrimary,
};

const saveBtnStyle: CSSProperties = {
  border: 'none',
  borderRadius: radii.md,
  padding: `${spacing[1]} ${spacing[3]}`,
  fontSize: typeScale.sm.size,
  background: colors.interactiveActive,
  color: '#ffffff',
  cursor: 'pointer',
};

const toggleBtnStyle: CSSProperties = {
  border: `1px solid ${colors.border}`,
  borderRadius: radii.pill,
  padding: `${spacing[1]} ${spacing[3]}`,
  fontSize: typeScale.sm.size,
  cursor: 'pointer',
};

const errorStyle: CSSProperties = {
  margin: 0,
  fontSize: typeScale.sm.size,
  color: colors.danger,
};

const savedStyle: CSSProperties = {
  marginTop: spacing[1],
  padding: spacing[2],
  background: colors.bgInset,
  border: `1px solid ${colors.border}`,
  borderRadius: radii.md,
  fontSize: typeScale.xs.size,
  lineHeight: 1.5,
  color: colors.textSecondary,
};

const deferredHintStyle: CSSProperties = {
  color: colors.accentText,
};

const configuredHintStyle: CSSProperties = {
  color: colors.textSecondary,
};

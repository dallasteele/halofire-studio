// HaloFire Studio — catalog browser (React DOM, LEFT panel).
//
// A search input + a categorized, KEYBOARD-ACCESSIBLE listbox of every
// catalogued part. Each row shows the part name, a small provenance badge, and
// a present/missing indicator. Present rows are selectable (click or
// Enter/Space); missing rows are disabled. Arrow keys move the active option;
// Home/End jump to ends. The selected row stays in sync with the 3D selection
// (selectedKey) and is scrolled into view.
//
// HONESTY: the per-row badge is derived from provenance (badgeFor /
// deriveModelStatus) — it never claims more accuracy than the manifest reports,
// and missing parts can never read as selectable/manufactured.

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import type { PartRecord } from './lib/parts-manifest';
import { filterParts, groupByCategory } from './lib/catalog';
import { badgeFor } from './lib/provenance';
import { colors, radii, spacing, typeScale } from './lib/tokens';

export interface CatalogBrowserProps {
  records: PartRecord[];
  selectedKey: string | null;
  onSelect: (part: PartRecord) => void;
}

export function CatalogBrowser({
  records,
  selectedKey,
  onSelect,
}: CatalogBrowserProps): ReactElement {
  const [query, setQuery] = useState('');
  const listId = useId();
  const listRef = useRef<HTMLDivElement | null>(null);

  const filtered = useMemo(() => filterParts(records, query), [records, query]);
  const groups = useMemo(() => groupByCategory(filtered), [filtered]);

  // Flat, in-display-order list of options for arrow-key navigation.
  const flat = useMemo(() => groups.flatMap((g) => g.parts), [groups]);

  // The "active" (roving-tabindex) option. Defaults to the selected part, else
  // the first present part, else the first row.
  const [activeKey, setActiveKey] = useState<string | null>(null);

  useEffect(() => {
    // Keep the active option valid as the filter changes / selection syncs.
    if (selectedKey && flat.some((p) => p.key === selectedKey)) {
      setActiveKey(selectedKey);
      return;
    }
    if (activeKey && flat.some((p) => p.key === activeKey)) {
      return;
    }
    const firstPresent = flat.find((p) => p.present);
    setActiveKey((firstPresent ?? flat[0])?.key ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flat, selectedKey]);

  // Scroll the selected/active row into view when it changes.
  useEffect(() => {
    const key = selectedKey ?? activeKey;
    if (!key || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-part-key="${cssEscape(key)}"]`,
    );
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedKey, activeKey]);

  const moveActive = useCallback(
    (delta: number) => {
      if (flat.length === 0) return;
      const idx = Math.max(
        0,
        flat.findIndex((p) => p.key === activeKey),
      );
      const next = Math.min(flat.length - 1, Math.max(0, idx + delta));
      setActiveKey(flat[next].key);
    },
    [flat, activeKey],
  );

  const onListKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          moveActive(1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          moveActive(-1);
          break;
        case 'Home':
          e.preventDefault();
          if (flat.length) setActiveKey(flat[0].key);
          break;
        case 'End':
          e.preventDefault();
          if (flat.length) setActiveKey(flat[flat.length - 1].key);
          break;
        case 'Enter':
        case ' ': {
          e.preventDefault();
          const part = flat.find((p) => p.key === activeKey);
          if (part && part.present) onSelect(part);
          break;
        }
        default:
          break;
      }
    },
    [flat, activeKey, moveActive, onSelect],
  );

  return (
    <aside style={panelStyle} aria-label="Part catalog">
      <div style={searchWrapStyle}>
        <label htmlFor={`${listId}-search`} style={visuallyHidden}>
          Search catalogued parts
        </label>
        <input
          id={`${listId}-search`}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search parts, keys, categories…"
          style={searchInputStyle}
          aria-controls={listId}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div
        id={listId}
        ref={listRef}
        className="hf-scroll"
        role="listbox"
        aria-label="Catalogued parts"
        aria-activedescendant={activeKey ? optionDomId(listId, activeKey) : undefined}
        tabIndex={0}
        onKeyDown={onListKeyDown}
        style={listStyle}
      >
        {flat.length === 0 ? (
          <p style={emptyStyle}>No parts match “{query}”.</p>
        ) : (
          groups.map((group) => (
            <div key={group.category} role="group" aria-label={group.category}>
              <div role="presentation" style={groupHeadingStyle}>
                {prettyCategory(group.category)}
                <span style={groupCountStyle}>{group.parts.length}</span>
              </div>
              {group.parts.map((part) => (
                <Row
                  key={part.key}
                  listId={listId}
                  part={part}
                  selected={part.key === selectedKey}
                  active={part.key === activeKey}
                  onSelect={onSelect}
                  onActivate={() => setActiveKey(part.key)}
                />
              ))}
            </div>
          ))
        )}
      </div>
    </aside>
  );
}

interface RowProps {
  listId: string;
  part: PartRecord;
  selected: boolean;
  active: boolean;
  onSelect: (part: PartRecord) => void;
  onActivate: () => void;
}

function Row({
  listId,
  part,
  selected,
  active,
  onSelect,
  onActivate,
}: RowProps): ReactElement {
  const badge = badgeFor(part.modelStatus);
  const disabled = !part.present;

  const rowStyle: CSSProperties = {
    ...rowBaseStyle,
    background: selected
      ? colors.surfaceHover
      : active
        ? colors.surfaceRaised
        : 'transparent',
    borderLeft: `3px solid ${selected ? colors.accent : 'transparent'}`,
    opacity: disabled ? 0.55 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
  };

  return (
    <div
      id={optionDomId(listId, part.key)}
      data-part-key={part.key}
      role="option"
      aria-selected={selected}
      aria-disabled={disabled || undefined}
      title={`${part.name} — ${badge.label}`}
      style={rowStyle}
      onMouseEnter={onActivate}
      onClick={() => {
        if (!disabled) onSelect(part);
      }}
    >
      <span
        aria-hidden="true"
        style={{
          ...presenceDotStyle,
          background: part.present ? colors.success : colors.border,
          boxShadow: part.present ? `0 0 0 2px ${colors.surface}` : 'none',
        }}
      />
      <span style={rowTextStyle}>
        <span style={rowNameStyle}>{part.name}</span>
        <span className="hf-mono" style={rowKeyStyle}>
          {part.key}
        </span>
      </span>
      <span
        style={{ ...rowBadgeStyle, background: badge.color }}
        title={badge.label}
      >
        {shortBadge(badge.modelStatus)}
      </span>
      <span style={visuallyHidden}>
        {part.present ? 'present, ' : 'missing, not available. '}
        {badge.label}.
        {badge.engineeringAccurate
          ? ''
          : ' Not manufacturer-exact, not dimensionally accurate.'}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------- helpers */

function optionDomId(listId: string, key: string): string {
  return `${listId}-opt-${key}`;
}

function cssEscape(s: string): string {
  return s.replace(/["\\]/g, '\\$&');
}

function prettyCategory(category: string): string {
  return category
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const SHORT_BADGE: Record<string, string> = {
  visual_reference: 'VIS',
  proxy: 'PRX',
  dimensioned_parametric: 'DIM',
  manufacturer_verified: 'MFR',
  sealed_approved: 'PE',
};
function shortBadge(status: string): string {
  return SHORT_BADGE[status] ?? 'VIS';
}

/* -------------------------------------------------------------- styles */

const panelStyle: CSSProperties = {
  width: 320,
  flex: '0 0 320px',
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  background: colors.surface,
  borderRight: `1px solid ${colors.border}`,
  boxSizing: 'border-box',
};

const searchWrapStyle: CSSProperties = {
  padding: spacing[3],
  borderBottom: `1px solid ${colors.border}`,
};

const searchInputStyle: CSSProperties = {
  width: '100%',
  padding: `${spacing[2]} ${spacing[3]}`,
  background: colors.bg,
  color: colors.textPrimary,
  border: `1px solid ${colors.border}`,
  borderRadius: radii.md,
  fontSize: typeScale.sm.size,
  boxSizing: 'border-box',
};

const listStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  padding: `${spacing[2]} 0 ${spacing[4]}`,
};

const groupHeadingStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: spacing[2],
  padding: `${spacing[3]} ${spacing[4]} ${spacing[1]}`,
  fontSize: typeScale.xs.size,
  fontWeight: typeScale.xs.weight,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: colors.textMuted,
};

const groupCountStyle: CSSProperties = {
  fontSize: typeScale.xs.size,
  color: colors.textMuted,
  fontVariantNumeric: 'tabular-nums',
};

const rowBaseStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: spacing[3],
  padding: `${spacing[2]} ${spacing[4]} ${spacing[2]} calc(${spacing[4]} - 3px)`,
  transition: 'background var(--hf-duration-fast) var(--hf-easing-standard)',
};

const presenceDotStyle: CSSProperties = {
  flex: '0 0 auto',
  width: 8,
  height: 8,
  borderRadius: radii.pill,
};

const rowTextStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: spacing[0.5],
};

const rowNameStyle: CSSProperties = {
  fontSize: typeScale.sm.size,
  color: colors.textPrimary,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const rowKeyStyle: CSSProperties = {
  fontSize: typeScale.xs.size,
  color: colors.textMuted,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const rowBadgeStyle: CSSProperties = {
  flex: '0 0 auto',
  padding: `2px ${spacing[2]}`,
  borderRadius: radii.sm,
  color: colors.onAccent,
  fontSize: '0.6875rem',
  fontWeight: 700,
  letterSpacing: '0.04em',
  fontFamily: 'var(--hf-font-mono)',
};

const emptyStyle: CSSProperties = {
  padding: spacing[4],
  color: colors.textMuted,
  fontSize: typeScale.sm.size,
};

const visuallyHidden: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

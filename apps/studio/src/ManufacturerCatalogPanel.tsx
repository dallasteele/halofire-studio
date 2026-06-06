// HaloFire Studio — Manufacturer catalog browser (React DOM, full-width panel).
//
// Shows the REAL ingested manufacturer SKU/SIN spec records (Tyco, Reliable, …)
// grouped by manufacturer + category, searchable, each row showing model / SIN,
// K-factor, port (method + nominal size), temperature ratings, response type,
// and a datasheet link that opens the source data-sheet PDF.
//
// HONESTY: these are catalog SPEC records sourced from PUBLIC manufacturer data
// sheets (provenance = catalog metadata). They are NOT manufacturer-exact 3D
// geometry (that is a separate tier and is NOT attached here), and NOT AHJ / PE /
// code-certified selections. The header banner states this plainly. Null fields
// render as "—" — the UI never invents a value the data sheet did not provide.

import {
  useMemo,
  useState,
  type CSSProperties,
  type ReactElement,
} from 'react';
import {
  filterCatalog,
  groupByManufacturer,
  type CatalogPart,
  type ManufacturerCatalog,
} from './lib/manufacturer-catalog';
import { colors, radii, spacing, typeScale } from './lib/tokens';

export interface ManufacturerCatalogPanelProps {
  catalog: ManufacturerCatalog | null;
}

export function ManufacturerCatalogPanel({
  catalog,
}: ManufacturerCatalogPanelProps): ReactElement {
  const [query, setQuery] = useState('');
  const entries = catalog?.entries ?? [];
  const filtered = useMemo(() => filterCatalog(entries, query), [entries, query]);
  const groups = useMemo(() => groupByManufacturer(filtered), [filtered]);

  return (
    <section style={wrapStyle} aria-label="Manufacturer catalog">
      <div style={toolbarStyle}>
        <label htmlFor="hf-mfr-search" style={visuallyHidden}>
          Search manufacturer catalog
        </label>
        <input
          id="hf-mfr-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search model, SIN, manufacturer, K-factor…"
          style={searchInputStyle}
          autoComplete="off"
          spellCheck={false}
        />
        <span style={countChipStyle} role="status">
          <strong style={{ color: colors.textPrimary }}>{filtered.length}</strong>{' '}
          / {entries.length} SKUs
        </span>
      </div>

      <p style={provenanceNote}>
        Catalog SPEC records extracted from public manufacturer data sheets
        (provenance = catalog metadata). NOT manufacturer-exact 3D geometry —
        that is a separate tier and is not attached to these. NOT AHJ / PE /
        code-certified selections.
      </p>

      <div className="hf-scroll" style={scrollStyle}>
        {entries.length === 0 ? (
          <p style={emptyStyle}>
            No manufacturer catalog loaded. Run{' '}
            <code>scripts/ingest-catalog/crawl.py</code> to ingest real data
            sheets.
          </p>
        ) : groups.length === 0 ? (
          <p style={emptyStyle}>No catalog parts match “{query}”.</p>
        ) : (
          groups.map((group) => (
            <div key={group.mfr} style={mfrGroupStyle}>
              <h3 style={mfrHeadingStyle}>
                {group.mfr}
                <span style={mfrCountStyle}>{group.count} parts</span>
              </h3>
              {group.categories.map((cat) => (
                <div key={cat.category} role="group" aria-label={cat.category}>
                  <div style={catHeadingStyle}>
                    {prettyCategory(cat.category)}
                    <span style={catCountStyle}>{cat.parts.length}</span>
                  </div>
                  <div role="table" style={tableStyle}>
                    <div role="row" style={headerRowStyle}>
                      <span role="columnheader" style={colModel}>
                        Model / SIN
                      </span>
                      <span role="columnheader" style={colK}>
                        K-factor
                      </span>
                      <span role="columnheader" style={colPort}>
                        Port
                      </span>
                      <span role="columnheader" style={colTemp}>
                        Temp °F
                      </span>
                      <span role="columnheader" style={colResp}>
                        Response
                      </span>
                      <span role="columnheader" style={colSheet}>
                        Datasheet
                      </span>
                    </div>
                    {cat.parts.map((p) => (
                      <CatalogRow key={p.id} part={p} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function CatalogRow({ part }: { part: CatalogPart }): ReactElement {
  return (
    <div role="row" style={dataRowStyle}>
      <span role="cell" style={colModel}>
        <span style={modelNameStyle}>{part.model}</span>
        {part.sin ? (
          <span className="hf-mono" style={sinStyle}>
            {part.sin}
          </span>
        ) : null}
      </span>
      <span role="cell" className="hf-mono" style={colK}>
        {part.kFactor !== null ? part.kFactor.toFixed(1) : DASH}
      </span>
      <span role="cell" style={colPort}>
        {formatPort(part)}
      </span>
      <span role="cell" className="hf-mono" style={colTemp}>
        {part.tempRatingsF && part.tempRatingsF.length > 0
          ? part.tempRatingsF.join(', ')
          : DASH}
      </span>
      <span role="cell" style={colResp}>
        {part.responseType ?? DASH}
      </span>
      <span role="cell" style={colSheet}>
        <a
          href={part.datasheetUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={linkStyle}
          title={`Open data sheet for ${part.model}`}
        >
          data sheet ↗
        </a>
      </span>
    </div>
  );
}

/* ------------------------------------------------------------- helpers */

const DASH = '—';

function formatPort(part: CatalogPart): string {
  const p = part.port;
  if (!p) return DASH;
  const size =
    p.nominalSizeIn !== null ? `${formatSize(p.nominalSizeIn)} in` : '';
  const method = p.method ? prettyMethod(p.method) : '';
  const joined = [size, method].filter(Boolean).join(' ');
  return joined.length > 0 ? joined : DASH;
}

function formatSize(n: number): string {
  // Common fractional nominal sizes read better as fractions.
  const map: Record<string, string> = {
    '0.5': '1/2',
    '0.75': '3/4',
    '1.25': '1-1/4',
    '1.5': '1-1/2',
    '2.5': '2-1/2',
  };
  return map[String(n)] ?? String(n);
}

function prettyMethod(m: string): string {
  switch (m) {
    case 'THREADED_NPT':
      return 'NPT';
    case 'GROOVED':
      return 'grooved';
    case 'FLANGED':
      return 'flanged';
    default:
      return m.toLowerCase();
  }
}

function prettyCategory(category: string): string {
  return category
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/* -------------------------------------------------------------- styles */

const wrapStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  background: colors.bg,
};

const toolbarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: spacing[3],
  padding: spacing[4],
  borderBottom: `1px solid ${colors.border}`,
};

const searchInputStyle: CSSProperties = {
  flex: 1,
  maxWidth: 520,
  padding: `${spacing[2]} ${spacing[3]}`,
  background: colors.surface,
  color: colors.textPrimary,
  border: `1px solid ${colors.border}`,
  borderRadius: radii.md,
  fontSize: typeScale.sm.size,
  boxSizing: 'border-box',
};

const countChipStyle: CSSProperties = {
  padding: `${spacing[1]} ${spacing[3]}`,
  background: colors.surfaceRaised,
  border: `1px solid ${colors.border}`,
  borderRadius: radii.pill,
  fontSize: typeScale.sm.size,
  color: colors.textSecondary,
  fontVariantNumeric: 'tabular-nums',
};

const provenanceNote: CSSProperties = {
  margin: 0,
  padding: `${spacing[2]} ${spacing[4]}`,
  color: colors.accentText,
  fontSize: typeScale.xs.size,
  lineHeight: 1.5,
  borderBottom: `1px solid ${colors.border}`,
  background: colors.surface,
};

const scrollStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  padding: `${spacing[3]} ${spacing[4]} ${spacing[6]}`,
};

const mfrGroupStyle: CSSProperties = {
  marginBottom: spacing[6],
};

const mfrHeadingStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: spacing[2],
  margin: `${spacing[3]} 0 ${spacing[2]}`,
  fontSize: typeScale.lg.size,
  fontWeight: 700,
  color: colors.textPrimary,
  borderBottom: `2px solid ${colors.accent}`,
  paddingBottom: spacing[1],
};

const mfrCountStyle: CSSProperties = {
  fontSize: typeScale.sm.size,
  fontWeight: 500,
  color: colors.textMuted,
  fontVariantNumeric: 'tabular-nums',
};

const catHeadingStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: spacing[2],
  padding: `${spacing[3]} 0 ${spacing[1]}`,
  fontSize: typeScale.xs.size,
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: colors.textMuted,
};

const catCountStyle: CSSProperties = {
  fontSize: typeScale.xs.size,
  color: colors.textMuted,
  fontVariantNumeric: 'tabular-nums',
};

const tableStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  border: `1px solid ${colors.border}`,
  borderRadius: radii.md,
  overflow: 'hidden',
};

const rowBase: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '2.4fr 0.8fr 1.4fr 1.8fr 1fr 1fr',
  alignItems: 'center',
  gap: spacing[3],
  padding: `${spacing[2]} ${spacing[3]}`,
};

const headerRowStyle: CSSProperties = {
  ...rowBase,
  background: colors.surfaceRaised,
  fontSize: typeScale.xs.size,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: colors.textMuted,
  borderBottom: `1px solid ${colors.border}`,
};

const dataRowStyle: CSSProperties = {
  ...rowBase,
  fontSize: typeScale.sm.size,
  color: colors.textPrimary,
  borderBottom: `1px solid ${colors.border}`,
  background: colors.surface,
};

const colModel: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  minWidth: 0,
};
const colK: CSSProperties = { textAlign: 'right' };
const colPort: CSSProperties = { color: colors.textSecondary };
const colTemp: CSSProperties = {
  color: colors.textSecondary,
  fontSize: typeScale.xs.size,
};
const colResp: CSSProperties = { color: colors.textSecondary };
const colSheet: CSSProperties = { textAlign: 'right' };

const modelNameStyle: CSSProperties = {
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const sinStyle: CSSProperties = {
  fontSize: typeScale.xs.size,
  color: colors.textMuted,
};

const linkStyle: CSSProperties = {
  color: colors.accentText,
  textDecoration: 'none',
  fontSize: typeScale.sm.size,
  whiteSpace: 'nowrap',
};

const emptyStyle: CSSProperties = {
  padding: spacing[5],
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

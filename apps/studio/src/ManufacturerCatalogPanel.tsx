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
import type { CatalogGeometry } from './lib/catalog-geometry';
import { badgeFor } from './lib/provenance';
import { CatalogPartViewer } from './CatalogPartViewer';
import { colors, radii, spacing, typeScale } from './lib/tokens';

export interface ManufacturerCatalogPanelProps {
  catalog: ManufacturerCatalog | null;
  /**
   * Resolved geometry per SKU id (resolveCatalogGeometryAll). When omitted,
   * every SKU shows the honest "no 3D geometry yet" note. Honest by
   * construction — the panel never claims geometry it was not handed.
   */
  geometryById?: Map<string, CatalogGeometry> | null;
}

export function ManufacturerCatalogPanel({
  catalog,
  geometryById,
}: ManufacturerCatalogPanelProps): ReactElement {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const entries = catalog?.entries ?? [];
  const filtered = useMemo(() => filterCatalog(entries, query), [entries, query]);
  const groups = useMemo(() => groupByManufacturer(filtered), [filtered]);

  const selectedGeo =
    selectedId && geometryById ? geometryById.get(selectedId) ?? null : null;
  const selectedPart = selectedId
    ? entries.find((p) => p.id === selectedId) ?? null
    : null;
  const withGeometryCount = useMemo(() => {
    if (!geometryById) return 0;
    let n = 0;
    for (const p of entries) {
      const g = geometryById.get(p.id);
      if (g && g.source !== 'none') n += 1;
    }
    return n;
  }, [entries, geometryById]);

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
        <span style={countChipStyle} role="status" data-testid="skus-with-geometry">
          <strong style={{ color: colors.textPrimary }}>{withGeometryCount}</strong>{' '}
          with 3D geometry
        </span>
      </div>

      <p style={provenanceNote}>
        Catalog SPEC records extracted from public manufacturer data sheets
        (provenance = catalog metadata). NOT manufacturer-exact 3D geometry —
        that is a separate tier and is not attached to these. NOT AHJ / PE /
        code-certified selections.
      </p>

      <div style={bodyRowStyle}>
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
                      <span role="columnheader" style={colGeo}>
                        3D geometry
                      </span>
                      <span role="columnheader" style={colResp}>
                        Response
                      </span>
                      <span role="columnheader" style={colSheet}>
                        Datasheet
                      </span>
                    </div>
                    {cat.parts.map((p) => (
                      <CatalogRow
                        key={p.id}
                        part={p}
                        geometry={geometryById?.get(p.id) ?? null}
                        selected={p.id === selectedId}
                        onSelect={setSelectedId}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
      </div>

      <aside style={viewerAsideStyle} aria-label="Selected part geometry">
        {selectedPart && selectedGeo && selectedGeo.assetUrl &&
        (selectedGeo.source === 'build123d' ||
          selectedGeo.source === 'manufacturer-step') ? (
          <>
            <div style={viewerTitleStyle}>
              {selectedPart.model}
              {selectedPart.sin ? (
                <span className="hf-mono" style={sinStyle}> · {selectedPart.sin}</span>
              ) : null}
            </div>
            <CatalogPartViewer stepUrl={selectedGeo.assetUrl} />
            <p style={viewerCaptionStyle}>
              {selectedGeo.source === 'manufacturer-step'
                ? 'Operator-supplied manufacturer STEP (manufacturer-verified).'
                : 'build123d dimensioned-parametric body: REAL NPT thread nominal size, APPROXIMATE body/orifice (K-factor-informed). NOT manufacturer-exact, NOT AHJ / PE / code-certified.'}
            </p>
          </>
        ) : (
          <p style={viewerEmptyStyle}>
            Select a SKU with resolved parametric geometry to preview its 3D
            body. SKUs showing “no 3D geometry yet” have no real asset — the
            studio never fabricates one.
          </p>
        )}
      </aside>
      </div>
    </section>
  );
}

interface CatalogRowProps {
  part: CatalogPart;
  geometry: CatalogGeometry | null;
  selected: boolean;
  onSelect: (id: string) => void;
}

function CatalogRow({
  part,
  geometry,
  selected,
  onSelect,
}: CatalogRowProps): ReactElement {
  const hasGeometry = geometry != null && geometry.source !== 'none';
  return (
    <div
      role="row"
      data-sku-id={part.id}
      data-geometry-source={geometry?.source ?? 'none'}
      style={{
        ...dataRowStyle,
        ...(selected ? selectedRowStyle : null),
        ...(hasGeometry ? { cursor: 'pointer' } : null),
      }}
      onClick={hasGeometry ? () => onSelect(part.id) : undefined}
    >
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
      <span role="cell" style={colGeo}>
        <GeometryCell geometry={geometry} />
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
          onClick={(e) => e.stopPropagation()}
        >
          data sheet ↗
        </a>
      </span>
    </div>
  );
}

/**
 * Geometry cell: a provenance-tier badge + source label when geometry resolved,
 * or an honest "no 3D geometry yet" note when it did not. NEVER claims a tier
 * the resolver did not return.
 */
function GeometryCell({
  geometry,
}: {
  geometry: CatalogGeometry | null;
}): ReactElement {
  if (!geometry || geometry.source === 'none' || geometry.modelStatus === null) {
    return <span style={noGeoStyle}>no 3D geometry yet</span>;
  }
  const badge = badgeFor(geometry.modelStatus);
  return (
    <span style={geoCellStyle}>
      <span
        style={{ ...geoBadgeStyle, background: `${badge.color}22`, color: badge.color, borderColor: `${badge.color}66` }}
        title={badge.label}
      >
        {SOURCE_LABEL[geometry.source]}
      </span>
      <span style={geoTierStyle}>{TIER_SHORT[geometry.modelStatus]}</span>
    </span>
  );
}

const SOURCE_LABEL: Record<string, string> = {
  'manufacturer-step': 'mfr STEP',
  build123d: 'parametric',
  'ai-placeholder': 'AI ref',
  none: '—',
};

const TIER_SHORT: Record<string, string> = {
  visual_reference: 'visual ref',
  proxy: 'proxy',
  dimensioned_parametric: 'dimensioned (approx body)',
  manufacturer_verified: 'mfr-verified',
  sealed_approved: 'sealed',
};

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
const colGeo: CSSProperties = {
  color: colors.textSecondary,
  fontSize: typeScale.xs.size,
};
const colResp: CSSProperties = { color: colors.textSecondary };
const colSheet: CSSProperties = { textAlign: 'right' };

const selectedRowStyle: CSSProperties = {
  background: colors.surfaceRaised,
  boxShadow: `inset 3px 0 0 ${colors.accent}`,
};

const noGeoStyle: CSSProperties = {
  color: colors.textMuted,
  fontStyle: 'italic',
  fontSize: typeScale.xs.size,
};

const geoCellStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  minWidth: 0,
};

const geoBadgeStyle: CSSProperties = {
  display: 'inline-block',
  alignSelf: 'flex-start',
  padding: '1px 6px',
  borderRadius: radii.pill,
  border: '1px solid',
  fontSize: typeScale.xs.size,
  fontWeight: 700,
  whiteSpace: 'nowrap',
};

const geoTierStyle: CSSProperties = {
  fontSize: typeScale.xs.size,
  color: colors.textMuted,
};

const bodyRowStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'row',
};

const viewerAsideStyle: CSSProperties = {
  width: 320,
  flexShrink: 0,
  borderLeft: `1px solid ${colors.border}`,
  background: colors.surface,
  padding: spacing[4],
  overflowY: 'auto',
};

const viewerTitleStyle: CSSProperties = {
  fontSize: typeScale.sm.size,
  fontWeight: 700,
  color: colors.textPrimary,
  marginBottom: spacing[2],
};

const viewerCaptionStyle: CSSProperties = {
  marginTop: spacing[3],
  fontSize: typeScale.xs.size,
  lineHeight: 1.5,
  color: colors.accentText,
};

const viewerEmptyStyle: CSSProperties = {
  fontSize: typeScale.xs.size,
  lineHeight: 1.5,
  color: colors.textMuted,
};

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

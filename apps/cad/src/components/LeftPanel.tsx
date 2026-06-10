// HaloFire CAD — LeftPanel. Two stacked sections: the Tools list (every tool in
// the store catalog, grouped, each wired to setTool with the active one
// highlighted) and a Catalog browser stub. The catalog stub reports the part-DB
// count honestly when a count is available, otherwise shows a labeled empty
// state — it never fabricates parts. The real catalog wiring lands later.

import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { TOOLS, useCadStore, type ToolDef, type ToolId } from '../store';
import { importFile } from '../lib/import-actions';
import {
  findHeadBySku,
  headSkus,
  loadManufacturerCatalog,
  type CatalogPart,
} from '../lib/head-catalog';
import { colors, radii, spacing, typeScale } from '../lib/tokens';

const GROUP_LABEL: Record<ToolDef['group'], string> = {
  edit: 'Edit',
  plan: 'Plan',
  draw: 'Draw',
  layout: 'Layout',
  pipe: 'Pipe',
};

const GROUP_ORDER: ToolDef['group'][] = ['edit', 'plan', 'draw', 'layout', 'pipe'];

export function LeftPanel(): ReactElement {
  const activeTool = useCadStore((s) => s.activeTool);
  const setTool = useCadStore((s) => s.setTool);

  return (
    <aside style={panelStyle} aria-label="Tools and catalog">
      <ImportSection />
      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>Tools</h2>
        <div style={toolListStyle} className="hf-scroll">
          {GROUP_ORDER.map((group) => {
            const tools = TOOLS.filter((t) => t.group === group);
            if (tools.length === 0) return null;
            return (
              <div key={group} style={groupStyle}>
                <div style={groupLabelStyle}>{GROUP_LABEL[group]}</div>
                {tools.map((tool) => (
                  <ToolRow
                    key={tool.id}
                    tool={tool}
                    active={tool.id === activeTool}
                    onSelect={setTool}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </section>

      <HeadCatalogSection />
    </aside>
  );
}

/**
 * Real head-SKU picker. Loads the ingested manufacturer catalog (public/catalog/
 * manufacturer-catalog.json) and lists every catalog HEAD that carries a real
 * K-factor. Selecting one sets the active head SKU used for placement / auto-layout.
 *
 * HONESTY: SKUs + K-factors are real extracted catalog values; nothing is invented.
 * If the catalog fails to load the list is empty and the panel says so.
 */
function HeadCatalogSection(): ReactElement {
  const activeHeadSku = useCadStore((s) => s.activeHeadSku);
  const setActiveHeadSku = useCadStore((s) => s.setActiveHeadSku);
  const [parts, setParts] = useState<CatalogPart[] | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let alive = true;
    const fetchImpl =
      typeof fetch === 'function' ? fetch.bind(globalThis) : undefined;
    void loadManufacturerCatalog(fetchImpl).then((cat) => {
      if (alive) setParts(headSkus(cat));
    });
    return () => {
      alive = false;
    };
  }, []);

  const q = query.trim().toLowerCase();
  const visible =
    parts === null
      ? []
      : q === ''
        ? parts
        : parts.filter(
            (p) =>
              p.model.toLowerCase().includes(q) ||
              p.mfr.toLowerCase().includes(q) ||
              (p.sin?.toLowerCase().includes(q) ?? false),
          );

  return (
    <section style={catalogSectionStyle}>
      <h2 style={sectionTitleStyle}>Head Catalog</h2>
      {parts === null ? (
        <div style={catalogEmptyStyle}>
          <div style={catalogEmptyTitleStyle}>Loading head SKUs…</div>
        </div>
      ) : parts.length === 0 ? (
        <div style={catalogEmptyStyle}>
          <div style={catalogEmptyTitleStyle}>No head SKUs loaded</div>
          <p style={catalogEmptyBodyStyle}>
            The manufacturer catalog could not be loaded. Heads need a real SKU
            (model + K-factor) before placement.
          </p>
        </div>
      ) : (
        <>
          <input
            type="text"
            value={query}
            placeholder={`Filter ${parts.length} head SKUs…`}
            onChange={(e) => setQuery(e.target.value)}
            style={skuSearchStyle}
            aria-label="Filter head SKUs"
          />
          <div style={skuListStyle} className="hf-scroll">
            {visible.map((p) => {
              const active = p.id === activeHeadSku;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setActiveHeadSku(active ? null : p.id)}
                  aria-pressed={active}
                  title={`${p.mfr} ${p.model} — K=${p.kFactor ?? '—'} (${p.datasheetUrl})`}
                  style={skuRowStyle(active)}
                >
                  <span style={skuModelStyle}>{p.model}</span>
                  <span style={skuMetaStyle}>
                    {p.mfr} · K={p.kFactor ?? '—'}
                  </span>
                </button>
              );
            })}
            {visible.length === 0 && (
              <div style={catalogEmptyBodyStyle}>No head SKU matches “{query}”.</div>
            )}
          </div>
          <ActiveSkuNote />
        </>
      )}
    </section>
  );
}

/** A small confirmation of the active SKU (model + K-factor) for placement. */
function ActiveSkuNote(): ReactElement | null {
  const activeHeadSku = useCadStore((s) => s.activeHeadSku);
  const [part, setPart] = useState<CatalogPart | null>(null);

  useEffect(() => {
    if (!activeHeadSku) {
      setPart(null);
      return;
    }
    let alive = true;
    const fetchImpl = typeof fetch === 'function' ? fetch.bind(globalThis) : undefined;
    void loadManufacturerCatalog(fetchImpl).then((cat) => {
      if (alive) setPart(findHeadBySku(cat, activeHeadSku));
    });
    return () => {
      alive = false;
    };
  }, [activeHeadSku]);

  if (!activeHeadSku) {
    return (
      <p style={catalogEmptyBodyStyle}>
        No active head SKU — pick one above before placing or auto-laying heads.
      </p>
    );
  }
  return (
    <div style={activeSkuStyle}>
      <span style={catalogEmptyTitleStyle}>Active: {part?.model ?? activeHeadSku}</span>
      <span style={catalogEmptyBodyStyle}>
        {part ? `${part.mfr} · K=${part.kFactor ?? '—'} gpm/psi^0.5` : activeHeadSku}
      </span>
    </div>
  );
}

function ImportSection(): ReactElement {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const setBuilding = useCadStore((s) => s.setBuilding);
  const setUnderlay = useCadStore((s) => s.setUnderlay);
  const setTool = useCadStore((s) => s.setTool);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState(false);

  async function onPick(file: File | null): Promise<void> {
    if (!file) return;
    setBusy(true);
    setMsg(`Importing ${file.name}…`);
    setErr(false);
    try {
      const outcome = await importFile(file);
      setErr(!outcome.ok);
      setMsg(outcome.message);
      if (outcome.ok) {
        if (outcome.underlay) setUnderlay(outcome.underlay);
        if (outcome.building) {
          // DXF lane: apply walls + real scale + source, then nudge to the scale
          // tool so the operator can verify the auto-derived scale if they wish.
          setBuilding(outcome.building);
          setTool('set-scale');
        } else {
          // PDF lane: no geometry yet — guide the operator to set the scale first.
          setTool('set-scale');
        }
      }
    } catch (e) {
      setErr(true);
      setMsg(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={importSectionStyle}>
      <h2 style={sectionTitleStyle}>Import Plan</h2>
      <input
        ref={inputRef}
        type="file"
        accept=".dxf,.pdf,application/pdf"
        style={{ display: 'none' }}
        onChange={(e) => {
          void onPick(e.target.files?.[0] ?? null);
          e.target.value = '';
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        style={importButtonStyle(busy)}
      >
        {busy ? 'Importing…' : 'Choose DXF or PDF…'}
      </button>
      <p style={importHintStyle}>
        DXF imports walls + a real scale from its own coordinates. PDF loads as a
        raster underlay — set the scale (two points) then trace.
      </p>
      {msg && (
        <div style={importMsgStyle(err)} role={err ? 'alert' : 'status'}>
          {msg}
        </div>
      )}
    </section>
  );
}

function ToolRow({
  tool,
  active,
  onSelect,
}: {
  tool: ToolDef;
  active: boolean;
  onSelect: (id: ToolId) => void;
}): ReactElement {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={() => onSelect(tool.id)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      aria-pressed={active}
      title={tool.hint}
      style={toolRowStyle(active, hover)}
    >
      <span
        style={{
          ...toolDotStyle,
          background: active ? colors.interactiveText : colors.border,
        }}
        aria-hidden="true"
      />
      <span style={toolRowLabelStyle}>{tool.label}</span>
    </button>
  );
}

/* --------------------------------------------------------------- styles */

const panelStyle: CSSProperties = {
  background: colors.panel,
  borderRight: `1px solid ${colors.border}`,
  width: 232,
  flex: '0 0 232px',
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
};

const sectionStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  flex: '1 1 auto',
  padding: spacing[3],
  gap: spacing[2],
};

const sectionTitleStyle: CSSProperties = {
  color: colors.textMuted,
  fontSize: typeScale.xs.size,
  textTransform: 'uppercase',
  letterSpacing: '0.09em',
  fontWeight: 600,
};

const toolListStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: spacing[3],
  overflowY: 'auto',
  minHeight: 0,
};

const groupStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: spacing[1],
};

const groupLabelStyle: CSSProperties = {
  color: colors.textSecondary,
  fontSize: typeScale.xs.size,
  fontWeight: 600,
  padding: `0 ${spacing[1]}`,
  marginBottom: spacing[0.5],
};

function toolRowStyle(active: boolean, hover: boolean): CSSProperties {
  const bg = active
    ? colors.surfaceHover
    : hover
      ? colors.surfaceRaised
      : 'transparent';
  return {
    display: 'flex',
    alignItems: 'center',
    gap: spacing[2],
    background: bg,
    color: colors.textPrimary,
    border: `1px solid ${active ? colors.borderStrong : 'transparent'}`,
    borderRadius: radii.md,
    padding: `${spacing[2]} ${spacing[2]}`,
    fontSize: typeScale.sm.size,
    width: '100%',
    textAlign: 'left',
    transition: 'background 140ms, border-color 140ms',
  };
}

const toolDotStyle: CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: radii.pill,
  flex: '0 0 auto',
};

const toolRowLabelStyle: CSSProperties = {
  fontWeight: 500,
};

const catalogSectionStyle: CSSProperties = {
  borderTop: `1px solid ${colors.border}`,
  padding: spacing[3],
  display: 'flex',
  flexDirection: 'column',
  gap: spacing[2],
  flex: '0 0 auto',
};

const catalogEmptyStyle: CSSProperties = {
  background: colors.bgInset,
  border: `1px dashed ${colors.border}`,
  borderRadius: radii.lg,
  padding: spacing[3],
  display: 'flex',
  flexDirection: 'column',
  gap: spacing[1],
};

const catalogEmptyTitleStyle: CSSProperties = {
  color: colors.textSecondary,
  fontSize: typeScale.sm.size,
  fontWeight: 600,
};

const catalogEmptyBodyStyle: CSSProperties = {
  color: colors.textMuted,
  fontSize: typeScale.xs.size,
  lineHeight: 1.5,
};

const skuSearchStyle: CSSProperties = {
  background: colors.surfaceRaised,
  color: colors.textPrimary,
  border: `1px solid ${colors.border}`,
  borderRadius: radii.md,
  padding: `${spacing[1]} ${spacing[2]}`,
  fontSize: typeScale.xs.size,
  width: '100%',
};

const skuListStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: spacing[1],
  maxHeight: 220,
  overflowY: 'auto',
};

function skuRowStyle(active: boolean): CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 2,
    background: active ? colors.surfaceHover : 'transparent',
    color: colors.textPrimary,
    border: `1px solid ${active ? colors.borderStrong : colors.border}`,
    borderRadius: radii.md,
    padding: `${spacing[1]} ${spacing[2]}`,
    width: '100%',
    textAlign: 'left',
    cursor: 'pointer',
  };
}

const skuModelStyle: CSSProperties = {
  color: colors.textPrimary,
  fontSize: typeScale.xs.size,
  fontWeight: 600,
};

const skuMetaStyle: CSSProperties = {
  color: colors.textMuted,
  fontSize: typeScale.xs.size,
  fontFamily: 'var(--hf-font-mono)',
};

const activeSkuStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  background: colors.bgInset,
  border: `1px solid ${colors.border}`,
  borderRadius: radii.md,
  padding: spacing[2],
};

const importSectionStyle: CSSProperties = {
  borderBottom: `1px solid ${colors.border}`,
  padding: spacing[3],
  display: 'flex',
  flexDirection: 'column',
  gap: spacing[2],
  flex: '0 0 auto',
};

function importButtonStyle(busy: boolean): CSSProperties {
  return {
    background: busy ? colors.surfaceRaised : colors.interactiveActive,
    color: '#ffffff',
    border: `1px solid ${colors.interactive}`,
    borderRadius: radii.md,
    padding: `${spacing[2]} ${spacing[2]}`,
    fontSize: typeScale.sm.size,
    fontWeight: 600,
    cursor: busy ? 'default' : 'pointer',
  };
}

const importHintStyle: CSSProperties = {
  color: colors.textMuted,
  fontSize: typeScale.xs.size,
  lineHeight: 1.5,
  margin: 0,
};

function importMsgStyle(err: boolean): CSSProperties {
  return {
    color: err ? colors.danger : colors.accentText,
    fontSize: typeScale.xs.size,
    lineHeight: 1.4,
    fontFamily: 'var(--hf-font-mono)',
    wordBreak: 'break-word',
  };
}

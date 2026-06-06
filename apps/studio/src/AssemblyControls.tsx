// HaloFire Studio — system-ASSEMBLY controls + legend (React DOM, LEFT panel in
// assembly mode). Lets the operator pick a head SKU (from the REAL ingested
// manufacturer catalog), a hazard class, a branch count, and heads/branch; shows
// a live readout (heads placed, spacing + its NFPA-13 citation), a LEGEND of each
// placed kind with its part source + provenance tier, and a PROMINENT honest
// banner stating this is a schematic design aid.
//
// HONESTY: the banner is shown verbatim and styled as a caution. The spacing
// readout cites the real nfpa13-rules value. The legend shows each kind's true
// source (build123d real CAD / schematic routing / honest proxy) and tier — a
// proxy is never labelled as real geometry.

import { useId, type CSSProperties, type ReactElement } from 'react';
import type { CatalogPart } from './lib/manufacturer-catalog';
import { HAZARD_CLASSES, type HazardClass } from './lib/nfpa13-rules';
import {
  summarizeAssembly,
  type Assembly,
  type PlacedPartKind,
  type PlacedPartSource,
} from './lib/assembly-layout';
import { badgeFor } from './lib/provenance';
import { colors, radii, spacing, typeScale } from './lib/tokens';

const HAZARD_LABEL: Record<HazardClass, string> = {
  light: 'Light',
  ordinary_1: 'Ordinary Group 1',
  ordinary_2: 'Ordinary Group 2',
  extra_1: 'Extra Group 1',
  extra_2: 'Extra Group 2',
};

const KIND_LABEL: Record<PlacedPartKind, string> = {
  head: 'Sprinkler head',
  branch_pipe: 'Branch line pipe',
  cross_main: 'Cross main pipe',
  riser: 'Riser drop',
  tee: 'Tee (branch tap)',
  elbow: 'Elbow (branch end)',
  reducer: 'Reducer (tap step-down)',
};

const SOURCE_LABEL: Record<PlacedPartSource, string> = {
  build123d: 'build123d parametric STEP (real CAD, dimensioned)',
  schematic: 'schematic routing (cylinder — not spool CAD)',
  proxy: 'honest proxy box (no real geometry)',
};

export interface AssemblyControlsProps {
  headSku: string | null;
  hazard: HazardClass;
  branchCount: number;
  headsPerBranch: number;
  headOptions: CatalogPart[];
  assembly: Assembly;
  onHeadSkuChange: (id: string) => void;
  onHazardChange: (h: HazardClass) => void;
  onBranchCountChange: (n: number) => void;
  onHeadsPerBranchChange: (n: number) => void;
}

export function AssemblyControls({
  headSku,
  hazard,
  branchCount,
  headsPerBranch,
  headOptions,
  assembly,
  onHeadSkuChange,
  onHazardChange,
  onBranchCountChange,
  onHeadsPerBranchChange,
}: AssemblyControlsProps): ReactElement {
  const ids = useId();
  const skuId = `${ids}-sku`;
  const hazId = `${ids}-haz`;
  const bcId = `${ids}-bc`;
  const hpbId = `${ids}-hpb`;

  const summary = summarizeAssembly(assembly);
  // The distinct kinds present, in canonical order, for the legend.
  const legendKinds = (Object.keys(KIND_LABEL) as PlacedPartKind[]).filter(
    (k) => summary.byKind[k] > 0,
  );

  return (
    <aside style={panelStyle} aria-label="System assembly controls">
      <h2 style={headingStyle}>Assembly</h2>

      {/* PROMINENT honest banner. */}
      <p style={bannerStyle} role="note">
        <strong style={bannerStrongStyle}>Schematic design aid.</strong>{' '}
        {assembly.disclaimer}
      </p>

      <div style={fieldGroupStyle}>
        <div style={fieldWrapStyle}>
          <label htmlFor={skuId} style={labelStyle}>
            Head SKU (real catalog)
          </label>
          <select
            id={skuId}
            value={headSku ?? ''}
            onChange={(e) => onHeadSkuChange(e.target.value)}
            style={selectStyle}
            disabled={headOptions.length === 0}
          >
            {headOptions.length === 0 ? (
              <option value="">no catalog heads loaded</option>
            ) : (
              headOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.mfr} {p.model}
                  {p.sin ? ` · ${p.sin}` : ''}
                  {p.port?.nominalSizeIn ? ` · ${p.port.nominalSizeIn}"` : ''}
                </option>
              ))
            )}
          </select>
        </div>

        <div style={fieldWrapStyle}>
          <label htmlFor={hazId} style={labelStyle}>
            Hazard class
          </label>
          <select
            id={hazId}
            value={hazard}
            onChange={(e) => onHazardChange(e.target.value as HazardClass)}
            style={selectStyle}
          >
            {HAZARD_CLASSES.map((h) => (
              <option key={h} value={h}>
                {HAZARD_LABEL[h]}
              </option>
            ))}
          </select>
        </div>

        <NumberField
          id={bcId}
          label="Branch lines"
          value={branchCount}
          min={1}
          max={20}
          onChange={onBranchCountChange}
        />
        <NumberField
          id={hpbId}
          label="Heads per branch"
          value={headsPerBranch}
          min={1}
          max={30}
          onChange={onHeadsPerBranchChange}
        />
      </div>

      <dl style={readoutStyle} aria-live="polite">
        <Readout label="Heads placed" value={String(assembly.headsPlaced)} />
        <Readout label="Spacing" value={`${assembly.spacingFt} ft`} />
        <Readout label="Parts placed" value={String(summary.total)} />
        <Readout
          label="Real geometry"
          value={assembly.usesRealGeometry ? 'yes (build123d)' : 'no'}
        />
      </dl>

      <p style={hintStyle}>
        Spacing source: {assembly.spacingCitation}
      </p>

      {/* Legend: each placed kind, its part source + provenance tier. */}
      <div style={legendWrapStyle} aria-label="Assembly legend">
        <h3 style={legendHeadingStyle}>Legend</h3>
        <ul style={legendListStyle}>
          {legendKinds.map((kind) => {
            const example = assembly.parts.find((p) => p.kind === kind)!;
            const tierLabel = example.provenanceTier
              ? badgeFor(example.provenanceTier).label
              : 'no tier claim';
            return (
              <li key={kind} style={legendItemStyle}>
                <span style={legendDot(example.partSource)} aria-hidden="true" />
                <span style={legendTextStyle}>
                  <strong style={legendKindStyle}>
                    {KIND_LABEL[kind]} ({summary.byKind[kind]})
                  </strong>
                  <span style={legendMetaStyle}>
                    key: {example.partKey} · {SOURCE_LABEL[example.partSource]}
                  </span>
                  <span style={legendTierStyle}>tier: {tierLabel}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}

interface NumberFieldProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}

function NumberField({ id, label, value, min, max, onChange }: NumberFieldProps): ReactElement {
  return (
    <div style={fieldWrapStyle}>
      <label htmlFor={id} style={labelStyle}>
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n) && n >= min) onChange(Math.min(max, Math.round(n)));
        }}
        style={inputStyle}
      />
    </div>
  );
}

function Readout({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div style={readoutRowStyle}>
      <dt style={labelStyle}>{label}</dt>
      <dd style={readoutValueStyle}>{value}</dd>
    </div>
  );
}

/* -------------------------------------------------------------- styles */

const panelStyle: CSSProperties = {
  width: 340,
  flex: '0 0 340px',
  display: 'flex',
  flexDirection: 'column',
  gap: spacing[4],
  minHeight: 0,
  overflowY: 'auto',
  padding: `${spacing[4]} ${spacing[5]}`,
  background: colors.surface,
  borderRight: `1px solid ${colors.border}`,
  color: colors.textPrimary,
  fontSize: typeScale.sm.size,
  boxSizing: 'border-box',
};

const headingStyle: CSSProperties = {
  fontSize: typeScale.xs.size,
  margin: 0,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: colors.textMuted,
  fontWeight: 600,
};

const bannerStyle: CSSProperties = {
  margin: 0,
  background: '#2a1f12',
  border: `1px solid #5a3c1a`,
  color: colors.accentText,
  borderRadius: radii.md,
  padding: `${spacing[3]} ${spacing[3]}`,
  lineHeight: 1.6,
  fontSize: typeScale.xs.size,
};

const bannerStrongStyle: CSSProperties = {
  color: colors.accent,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

const fieldGroupStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: spacing[4],
};

const fieldWrapStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: spacing[1],
};

const labelStyle: CSSProperties = {
  color: colors.textSecondary,
  fontSize: typeScale.sm.size,
};

const inputStyle: CSSProperties = {
  width: '100%',
  padding: `${spacing[2]} ${spacing[3]}`,
  background: colors.bg,
  color: colors.textPrimary,
  border: `1px solid ${colors.border}`,
  borderRadius: radii.md,
  fontSize: typeScale.sm.size,
  boxSizing: 'border-box',
};

const selectStyle: CSSProperties = { ...inputStyle };

const hintStyle: CSSProperties = {
  margin: 0,
  color: colors.textMuted,
  fontSize: typeScale.xs.size,
  lineHeight: 1.5,
};

const readoutStyle: CSSProperties = {
  margin: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: spacing[2],
  padding: `${spacing[3]} ${spacing[4]}`,
  background: colors.surfaceRaised,
  border: `1px solid ${colors.border}`,
  borderRadius: radii.md,
};

const readoutRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  margin: 0,
  gap: spacing[3],
};

const readoutValueStyle: CSSProperties = {
  margin: 0,
  color: colors.textPrimary,
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
  fontFamily: 'var(--hf-font-mono)',
};

const legendWrapStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: spacing[2],
};

const legendHeadingStyle: CSSProperties = {
  fontSize: typeScale.xs.size,
  margin: 0,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: colors.textMuted,
  fontWeight: 600,
};

const legendListStyle: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: spacing[2],
};

const legendItemStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: spacing[2],
  padding: `${spacing[2]} ${spacing[3]}`,
  background: colors.bg,
  border: `1px solid ${colors.border}`,
  borderRadius: radii.md,
};

function legendDot(source: PlacedPartSource): CSSProperties {
  const color =
    source === 'build123d' ? '#3b82f6' : source === 'schematic' ? '#8aa0b6' : '#f0a868';
  return {
    width: 10,
    height: 10,
    borderRadius: 3,
    background: color,
    marginTop: 4,
    flex: '0 0 auto',
  };
}

const legendTextStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  minWidth: 0,
};

const legendKindStyle: CSSProperties = {
  color: colors.textPrimary,
  fontSize: typeScale.sm.size,
  fontWeight: 600,
};

const legendMetaStyle: CSSProperties = {
  color: colors.textSecondary,
  fontSize: typeScale.xs.size,
  lineHeight: 1.4,
};

const legendTierStyle: CSSProperties = {
  color: colors.textMuted,
  fontSize: typeScale.xs.size,
};

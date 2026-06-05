// HaloFire Studio — sprinkler layout controls (React DOM, LEFT panel in layout
// mode). Width / length number inputs + a hazard-class select, a live head-count
// and spacing readout, and a PROMINENT honesty notice styled with the ember
// caution token.
//
// Keyboard-accessible and fully labeled. All text-on-surface pairings reuse the
// design tokens that the AAA gate (test/tokens.test.ts) verifies.
//
// HONESTY (hard): the LAYOUT_DISCLAIMER is shown verbatim and styled as a
// caution — the layout is a coarse VISUAL spacing heuristic, NOT hydraulic /
// AHJ / PE / code-compliant / for construction.

import {
  useId,
  type CSSProperties,
  type ReactElement,
} from 'react';
import {
  HAZARD_CLASSES,
  HAZARD_MAX_COVERAGE_SQFT,
  HAZARD_MAX_SPACING_FT,
  LAYOUT_DISCLAIMER,
  layoutHeads,
  type HazardClass,
} from './lib/layout';
import { colors, radii, spacing, typeScale } from './lib/tokens';

export interface LayoutControlsProps {
  widthFt: number;
  lengthFt: number;
  hazard: HazardClass;
  onWidthChange: (ft: number) => void;
  onLengthChange: (ft: number) => void;
  onHazardChange: (h: HazardClass) => void;
}

const HAZARD_LABEL: Record<HazardClass, string> = {
  light: 'Light hazard',
  ordinary: 'Ordinary hazard',
  extra: 'Extra hazard',
};

export function LayoutControls({
  widthFt,
  lengthFt,
  hazard,
  onWidthChange,
  onLengthChange,
  onHazardChange,
}: LayoutControlsProps): ReactElement {
  const ids = useId();
  const widthId = `${ids}-w`;
  const lengthId = `${ids}-l`;
  const hazardId = `${ids}-h`;

  const layout = layoutHeads({ widthFt, lengthFt, hazard });

  return (
    <aside style={panelStyle} aria-label="Sprinkler layout controls">
      <h2 style={headingStyle}>Layout</h2>

      <div style={fieldGroupStyle}>
        <NumberField
          id={widthId}
          label="Building width (ft)"
          value={widthFt}
          onChange={onWidthChange}
        />
        <NumberField
          id={lengthId}
          label="Building length (ft)"
          value={lengthFt}
          onChange={onLengthChange}
        />

        <div style={fieldWrapStyle}>
          <label htmlFor={hazardId} style={labelStyle}>
            Hazard class
          </label>
          <select
            id={hazardId}
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
          <p style={hintStyle}>
            Max spacing {HAZARD_MAX_SPACING_FT[hazard]} ft · max coverage{' '}
            {HAZARD_MAX_COVERAGE_SQFT[hazard]} ft² (NFPA 13 upper bounds — used
            only as a ceiling for this sketch).
          </p>
        </div>
      </div>

      <dl style={readoutStyle} aria-live="polite">
        <Readout label="Heads" value={String(layout.count)} />
        <Readout label="Grid" value={`${layout.cols} × ${layout.rows}`} />
        <Readout label="Spacing" value={`${layout.spacingFt} ft`} />
        <Readout
          label="Coverage / head"
          value={`${layout.coveragePerHeadSqft} ft²`}
        />
      </dl>

      <p style={disclaimerStyle} role="note">
        <strong style={disclaimerStrongStyle}>Heuristic only.</strong>{' '}
        {LAYOUT_DISCLAIMER}
      </p>
    </aside>
  );
}

interface NumberFieldProps {
  id: string;
  label: string;
  value: number;
  onChange: (n: number) => void;
}

function NumberField({ id, label, value, onChange }: NumberFieldProps): ReactElement {
  return (
    <div style={fieldWrapStyle}>
      <label htmlFor={id} style={labelStyle}>
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={1}
        max={1000}
        step={1}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n) && n >= 1) onChange(Math.min(1000, Math.round(n)));
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
  width: 320,
  flex: '0 0 320px',
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

const selectStyle: CSSProperties = {
  ...inputStyle,
};

const hintStyle: CSSProperties = {
  margin: `${spacing[1]} 0 0`,
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

const disclaimerStyle: CSSProperties = {
  margin: 0,
  background: '#2a1f12',
  border: `1px solid #5a3c1a`,
  color: colors.accentText,
  borderRadius: radii.md,
  padding: `${spacing[3]} ${spacing[3]}`,
  lineHeight: 1.6,
  fontSize: typeScale.xs.size,
};

const disclaimerStrongStyle: CSSProperties = {
  color: colors.accent,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

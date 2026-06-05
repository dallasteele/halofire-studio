// HaloFire Studio — T42 part inspector panel (React DOM, NOT inside the Canvas).
//
// Given the selected PartRecord, shows its identity (name, category/key, source)
// and an AccuracyBadge chip. The badge states PLAINLY whether the part is
// engineering-accurate and dimension-verified. Restyled onto the design-token
// system; all provenance honesty text + the badge are preserved verbatim.
//
// HONESTY (hard, fail-closed): a visual_reference / generated / placeholder part
// must be impossible to read as manufacturer-exact, dimensionally-accurate, AHJ,
// PE, or fabrication-ready. The badge text says so explicitly.

import type { CSSProperties, ReactElement } from 'react';
import type { PartRecord } from './lib/parts-manifest';
import { badgeFor } from './lib/provenance';
import { colors, radii, spacing, typeScale } from './lib/tokens';

export interface InspectorProps {
  part: PartRecord | null;
}

export function Inspector({ part }: InspectorProps): ReactElement {
  if (!part) {
    return (
      <aside style={panelStyle} aria-label="Part inspector">
        <h2 style={headingStyle}>Inspector</h2>
        <p style={hintStyle}>Click a part in the viewer to inspect its provenance.</p>
      </aside>
    );
  }

  const badge = badgeFor(part.modelStatus);

  return (
    <aside style={panelStyle} aria-label="Part inspector">
      <h2 style={headingStyle}>Inspector</h2>

      <div style={fieldGroupStyle}>
        <div style={partNameStyle}>{part.name}</div>
        <Field label="Key" value={part.key} mono />
        <Field label="Category" value={part.category} />
        <Field label="Source" value={part.source} mono />
        <Field label="Present" value={part.present ? 'yes' : 'no'} />
        {part.manufacturer ? <Field label="Manufacturer" value={part.manufacturer} /> : null}
        {part.productCode ? <Field label="Product code" value={part.productCode} mono /> : null}
      </div>

      <div style={{ ...badgeChipStyle, background: badge.color }} data-testid="accuracy-badge">
        {badge.label}
      </div>

      <dl style={verdictListStyle}>
        <Verdict label="engineering-accurate" yes={badge.engineeringAccurate} />
        <Verdict label="dimension-verified" yes={badge.dimensionVerified} />
      </dl>

      {part.modelStatus === 'manufacturer_verified' && part.stepUrl ? (
        <div style={stepLinkWrapStyle}>
          <a
            href={part.stepUrl}
            download
            style={stepLinkStyle}
            data-testid="step-download-link"
          >
            Download STEP
          </a>
          <p style={stepCaptionStyle}>operator-supplied manufacturer file</p>
          <p style={mfgVerifiedCaveatStyle}>
            Manufacturer-CAD-accurate. NOT permit-ready / AHJ / PE-sealed —
            CAD geometry only, not code-compliance evidence.
          </p>
        </div>
      ) : null}

      {!badge.engineeringAccurate ? (
        <p style={warnStyle}>
          This mesh is a {badge.modelStatus.replace(/_/g, ' ')} model. It is NOT
          manufacturer-exact, NOT dimensionally accurate, and NOT AHJ / PE /
          fabrication-ready. Do not use for shop drawings or submittals.
        </p>
      ) : null}
    </aside>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): ReactElement {
  return (
    <div style={fieldRowStyle}>
      <span style={fieldLabelStyle}>{label}</span>
      <span
        className={mono ? 'hf-mono' : undefined}
        style={mono ? fieldValueMonoStyle : fieldValueStyle}
      >
        {value}
      </span>
    </div>
  );
}

function Verdict({ label, yes }: { label: string; yes: boolean }): ReactElement {
  return (
    <div style={verdictRowStyle}>
      <dt style={fieldLabelStyle}>{label}</dt>
      <dd style={{ ...verdictValueStyle, color: yes ? colors.success : colors.accentText }}>
        {yes ? 'yes' : 'no'}
      </dd>
    </div>
  );
}

const panelStyle: CSSProperties = {
  width: 320,
  flex: '0 0 320px',
  padding: `${spacing[4]} ${spacing[5]}`,
  background: colors.surface,
  borderLeft: `1px solid ${colors.border}`,
  color: colors.textPrimary,
  overflowY: 'auto',
  fontSize: typeScale.sm.size,
  boxSizing: 'border-box',
};

const headingStyle: CSSProperties = {
  fontSize: typeScale.xs.size,
  margin: `0 0 ${spacing[4]}`,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: colors.textMuted,
  fontWeight: 600,
};

const hintStyle: CSSProperties = {
  color: colors.textMuted,
  lineHeight: 1.6,
};

const fieldGroupStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: spacing[2],
  marginBottom: spacing[4],
};

const partNameStyle: CSSProperties = {
  fontSize: typeScale.lg.size,
  fontWeight: 600,
  lineHeight: typeScale.lg.lineHeight,
  color: colors.textPrimary,
  marginBottom: spacing[1],
};

const fieldRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: spacing[3],
  alignItems: 'baseline',
};

const fieldLabelStyle: CSSProperties = {
  color: colors.textSecondary,
};

const fieldValueStyle: CSSProperties = {
  textAlign: 'right',
  color: colors.textPrimary,
};

const fieldValueMonoStyle: CSSProperties = {
  ...fieldValueStyle,
  fontFamily: 'var(--hf-font-mono)',
  fontSize: typeScale.xs.size,
};

const badgeChipStyle: CSSProperties = {
  display: 'inline-block',
  padding: `${spacing[2]} ${spacing[3]}`,
  borderRadius: radii.md,
  color: colors.onAccent,
  fontWeight: 700,
  fontSize: typeScale.xs.size,
  marginBottom: spacing[3],
  lineHeight: 1.3,
};

const verdictListStyle: CSSProperties = {
  margin: `0 0 ${spacing[3]}`,
  display: 'flex',
  flexDirection: 'column',
  gap: spacing[2],
};

const verdictRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  margin: 0,
};

const verdictValueStyle: CSSProperties = {
  margin: 0,
  fontWeight: 600,
};

const stepLinkWrapStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: spacing[1],
  marginBottom: spacing[3],
  padding: `${spacing[3]} ${spacing[3]}`,
  background: '#0f2a18',
  border: `1px solid #1c5234`,
  borderRadius: radii.md,
};

const stepLinkStyle: CSSProperties = {
  color: '#86efac',
  fontWeight: 600,
  textDecoration: 'underline',
  fontSize: typeScale.sm.size,
};

const stepCaptionStyle: CSSProperties = {
  margin: 0,
  color: colors.textSecondary,
  fontSize: typeScale.xs.size,
  lineHeight: 1.4,
};

const mfgVerifiedCaveatStyle: CSSProperties = {
  margin: `${spacing[1]} 0 0`,
  color: colors.accentText,
  fontSize: typeScale.xs.size,
  lineHeight: 1.45,
};

const warnStyle: CSSProperties = {
  background: '#2a1f12',
  border: `1px solid #5a3c1a`,
  color: colors.accentText,
  borderRadius: radii.md,
  padding: `${spacing[3]} ${spacing[3]}`,
  lineHeight: 1.6,
  fontSize: typeScale.xs.size,
};

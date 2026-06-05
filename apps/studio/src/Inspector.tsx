// HaloFire Studio — T42 part inspector panel (React DOM, NOT inside the Canvas).
//
// Given the selected PartRecord, shows its identity (name, category/key, source)
// and an AccuracyBadge chip. The badge states PLAINLY whether the part is
// engineering-accurate and dimension-verified.
//
// HONESTY (hard, fail-closed): a visual_reference / generated / placeholder part
// must be impossible to read as manufacturer-exact, dimensionally-accurate, AHJ,
// PE, or fabrication-ready. The badge text says so explicitly.

import type { ReactElement } from 'react';
import type { PartRecord } from './lib/parts-manifest';
import { badgeFor } from './lib/provenance';

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
        <Field label="Key" value={part.key} />
        <Field label="Category" value={part.category} />
        <Field label="Source" value={part.source} />
        <Field label="Present" value={part.present ? 'yes' : 'no'} />
      </div>

      <div style={{ ...badgeChipStyle, background: badge.color }} data-testid="accuracy-badge">
        {badge.label}
      </div>

      <dl style={verdictListStyle}>
        <Verdict label="engineering-accurate" yes={badge.engineeringAccurate} />
        <Verdict label="dimension-verified" yes={badge.dimensionVerified} />
      </dl>

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

function Field({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div style={fieldRowStyle}>
      <span style={fieldLabelStyle}>{label}</span>
      <span style={fieldValueStyle}>{value}</span>
    </div>
  );
}

function Verdict({ label, yes }: { label: string; yes: boolean }): ReactElement {
  return (
    <div style={verdictRowStyle}>
      <dt style={fieldLabelStyle}>{label}</dt>
      <dd style={{ ...verdictValueStyle, color: yes ? '#22c55e' : '#f0a868' }}>
        {yes ? 'yes' : 'no'}
      </dd>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  width: 300,
  flex: '0 0 300px',
  padding: '14px 16px',
  background: '#161c25',
  borderLeft: '1px solid #2a323d',
  color: '#e6edf3',
  overflowY: 'auto',
  fontSize: 13,
  boxSizing: 'border-box',
};

const headingStyle: React.CSSProperties = {
  fontSize: 14,
  margin: '0 0 12px',
  letterSpacing: 0.3,
  textTransform: 'uppercase',
  opacity: 0.7,
};

const hintStyle: React.CSSProperties = {
  opacity: 0.6,
  lineHeight: 1.5,
};

const fieldGroupStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  marginBottom: 14,
};

const partNameStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  marginBottom: 4,
};

const fieldRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
};

const fieldLabelStyle: React.CSSProperties = {
  opacity: 0.6,
};

const fieldValueStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  textAlign: 'right',
};

const badgeChipStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '6px 10px',
  borderRadius: 6,
  color: '#11161d',
  fontWeight: 600,
  fontSize: 12,
  marginBottom: 12,
  lineHeight: 1.3,
};

const verdictListStyle: React.CSSProperties = {
  margin: '0 0 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const verdictRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  margin: 0,
};

const verdictValueStyle: React.CSSProperties = {
  margin: 0,
  fontWeight: 600,
};

const warnStyle: React.CSSProperties = {
  background: '#2a1f12',
  border: '1px solid #5a3c1a',
  color: '#f0a868',
  borderRadius: 6,
  padding: '8px 10px',
  lineHeight: 1.5,
  fontSize: 12,
};

// HaloFire CAD — HydraulicsPanel (W5). The Hydraulics ribbon-tab content: water-
// supply inputs (static / residual @ flow), a remote-design-area input, a pressure-
// heatmap toggle, and a CITED results table (demand gpm, required psi @ riser,
// available psi, adequate/short, operating head count) with the design-aid findings
// + disclaimer. Reads the LIVE hydraulics from the store selector, so it recomputes
// on every network OR supply OR design-area edit.
//
// HONESTY: every number comes from solveHydraulics over the persisted network (cited
// nfpa13-rules constants only — no forked numbers). The disclaimer is restated and
// every finding carries its citation. This is a DESIGN AID / estimate, NOT a
// certified hydraulic calculation, AHJ, PE, or for construction.

import { useMemo, useState, type CSSProperties, type ReactElement } from 'react';
import { selectHydraulics, useCadStore } from '../store';
import { colors, radii, spacing, typeScale } from '../lib/tokens';

export function HydraulicsPanel(): ReactElement {
  const project = useCadStore((s) => s.project);
  const supply = useCadStore((s) => s.supply);
  const designAreaSqFt = useCadStore((s) => s.designAreaSqFt);
  const setSupply = useCadStore((s) => s.setSupply);
  const setDesignArea = useCadStore((s) => s.setDesignArea);
  const pressureHeatmap = useCadStore((s) => s.pressureHeatmap);
  const setPressureHeatmap = useCadStore((s) => s.setPressureHeatmap);

  // LIVE result — recomputed whenever the network / supply / design area change.
  const result = useMemo(
    () => selectHydraulics(useCadStore.getState()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project.network, supply, designAreaSqFt, project.hazardDefaults.defaultClass],
  );

  const [staticDraft, setStaticDraft] = useState<string>(supply ? String(supply.staticPsi) : '');
  const [residualDraft, setResidualDraft] = useState<string>(supply ? String(supply.residualPsi) : '');
  const [flowDraft, setFlowDraft] = useState<string>(supply ? String(supply.flowGpm) : '');
  const [areaDraft, setAreaDraft] = useState<string>(designAreaSqFt ? String(designAreaSqFt) : '');

  const applySupply = (): void => {
    const st = Number(staticDraft);
    const rs = Number(residualDraft);
    const fl = Number(flowDraft);
    if ([st, rs, fl].every((n) => Number.isFinite(n) && n >= 0) && (staticDraft || residualDraft || flowDraft)) {
      setSupply({ staticPsi: st, residualPsi: rs, flowGpm: fl });
    }
  };

  const hasSystem = result.systemDemand.gpm > 0;
  const adequacy = result.findings.find((f) => f.code === 'adequacy');

  return (
    <div style={panelStyle} aria-label="Hydraulics design aid">
      <div style={titleRowStyle}>
        <h2 style={sectionTitleStyle}>Hydraulic design aid</h2>
        <label style={toggleLabelStyle}>
          <input
            type="checkbox"
            checked={pressureHeatmap}
            onChange={(e) => setPressureHeatmap(e.target.checked)}
          />
          Pressure heatmap
        </label>
      </div>

      {/* Water supply inputs (operator flow test). */}
      <fieldset style={fieldsetStyle}>
        <legend style={legendStyle}>Water supply (flow test)</legend>
        <div style={inputRowStyle}>
          <Field label="Static (psi)" value={staticDraft} onChange={setStaticDraft} />
          <Field label="Residual (psi)" value={residualDraft} onChange={setResidualDraft} />
          <Field label="@ Flow (gpm)" value={flowDraft} onChange={setFlowDraft} />
        </div>
        <div style={btnRowStyle}>
          <button type="button" style={primaryBtnStyle} onClick={applySupply}>
            Apply supply
          </button>
          <button
            type="button"
            style={ghostBtnStyle}
            onClick={() => {
              setSupply(null);
              setStaticDraft('');
              setResidualDraft('');
              setFlowDraft('');
            }}
          >
            Clear
          </button>
        </div>
      </fieldset>

      {/* Remote design area. */}
      <fieldset style={fieldsetStyle}>
        <legend style={legendStyle}>Remote design area (optional)</legend>
        <div style={inputRowStyle}>
          <Field label="Area (ft²)" value={areaDraft} onChange={setAreaDraft} />
          <button
            type="button"
            style={primaryBtnStyle}
            onClick={() => setDesignArea(areaDraft ? Number(areaDraft) : null)}
          >
            Set
          </button>
          <button
            type="button"
            style={ghostBtnStyle}
            onClick={() => {
              setDesignArea(null);
              setAreaDraft('');
            }}
          >
            All heads
          </button>
        </div>
        <p style={hintStyle}>
          The remote-area magnitude is operator-supplied (from the adopted edition
          density/area curves) — not a single cited constant. Blank operates all heads.
        </p>
      </fieldset>

      {/* Results table. */}
      <div style={cardStyle}>
        <div style={cardTitleStyle}>Results</div>
        {hasSystem ? (
          <dl style={dlStyle}>
            <ResultRow label="Operating heads (remote area)" value={String(result.remoteAreaHeadIds.length)} />
            <ResultRow label="System demand" value={`${result.systemDemand.gpm.toFixed(1)} gpm`} />
            <ResultRow label="Required @ riser" value={`${result.systemDemand.psiAtRiser.toFixed(1)} psi`} />
            <ResultRow
              label="Available @ demand"
              value={result.supplyAtDemand.psi == null ? '— (no supply)' : `${result.supplyAtDemand.psi.toFixed(1)} psi`}
            />
            <ResultRow
              label="Adequacy"
              value={
                result.supplyAtDemand.psi == null
                  ? 'not evaluated'
                  : result.adequate
                    ? 'ADEQUATE'
                    : 'SHORT'
              }
              color={
                result.supplyAtDemand.psi == null
                  ? colors.textMuted
                  : result.adequate
                    ? colors.accentText
                    : colors.danger
              }
            />
          </dl>
        ) : (
          <p style={emptyBodyStyle}>
            No routed system. Place heads and Route pipe (W4) first, then enter a supply.
          </p>
        )}
        {adequacy && (
          <div
            style={{
              ...adequacyNoteStyle,
              color: adequacy.severity === 'ok' ? colors.accentText : colors.danger,
              borderColor: adequacy.severity === 'ok' ? colors.border : colors.danger,
            }}
          >
            {adequacy.message}
          </div>
        )}
      </div>

      {/* Cited findings. */}
      <div style={cardStyle}>
        <div style={cardTitleStyle}>Cited findings</div>
        <ul style={findingsStyle}>
          {result.findings
            .filter((f) => f.code !== 'disclaimer')
            .map((f, i) => (
              <li key={`${f.code}-${i}`} style={findingItemStyle}>
                <span style={{ ...findingSevStyle, color: sevColor(f.severity) }}>
                  {f.severity.toUpperCase()}
                </span>
                <span style={findingMsgStyle}>{f.message}</span>
                <span style={citationStyle}>{f.citation}</span>
              </li>
            ))}
        </ul>
      </div>

      <p style={disclaimerStyle}>{result.disclaimer}</p>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}): ReactElement {
  return (
    <label style={fieldLabelStyle}>
      <span style={fieldCaptionStyle}>{label}</span>
      <input
        type="number"
        min={0}
        step="any"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={inputStyle}
      />
    </label>
  );
}

function ResultRow({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}): ReactElement {
  return (
    <div style={rowStyle}>
      <dt style={dtStyle}>{label}</dt>
      <dd style={{ ...ddStyle, color: color ?? colors.textPrimary }}>{value}</dd>
    </div>
  );
}

function sevColor(sev: string): string {
  if (sev === 'error') return colors.danger;
  if (sev === 'warn') return colors.warn;
  if (sev === 'ok') return colors.accentText;
  return colors.textMuted;
}

/* --------------------------------------------------------------- styles */

const panelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: spacing[3],
  padding: spacing[3],
  overflowY: 'auto',
  maxHeight: '100%',
};

const titleRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: spacing[2],
};

const sectionTitleStyle: CSSProperties = {
  color: colors.textPrimary,
  fontSize: typeScale.base.size,
  fontWeight: 600,
};

const toggleLabelStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: spacing[1],
  color: colors.textSecondary,
  fontSize: typeScale.xs.size,
  cursor: 'pointer',
};

const fieldsetStyle: CSSProperties = {
  border: `1px solid ${colors.border}`,
  borderRadius: radii.md,
  padding: spacing[2],
  display: 'flex',
  flexDirection: 'column',
  gap: spacing[2],
};

const legendStyle: CSSProperties = {
  color: colors.textMuted,
  fontSize: typeScale.xs.size,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  padding: `0 ${spacing[1]}`,
};

const inputRowStyle: CSSProperties = {
  display: 'flex',
  gap: spacing[2],
  alignItems: 'flex-end',
  flexWrap: 'wrap',
};

const btnRowStyle: CSSProperties = {
  display: 'flex',
  gap: spacing[2],
};

const fieldLabelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: spacing[0.5],
  flex: '1 1 80px',
};

const fieldCaptionStyle: CSSProperties = {
  color: colors.textMuted,
  fontSize: typeScale.xs.size,
};

const inputStyle: CSSProperties = {
  background: colors.surfaceRaised,
  color: colors.textPrimary,
  border: `1px solid ${colors.border}`,
  borderRadius: 6,
  padding: '4px 6px',
  fontSize: typeScale.xs.size,
  fontFamily: 'var(--hf-font-mono)',
  width: '100%',
  boxSizing: 'border-box',
};

const primaryBtnStyle: CSSProperties = {
  background: colors.interactiveActive,
  color: '#ffffff',
  border: `1px solid ${colors.interactive}`,
  borderRadius: 6,
  padding: '4px 10px',
  fontSize: typeScale.xs.size,
  fontWeight: 600,
  cursor: 'pointer',
};

const ghostBtnStyle: CSSProperties = {
  background: colors.surfaceRaised,
  color: colors.textPrimary,
  border: `1px solid ${colors.border}`,
  borderRadius: 6,
  padding: '4px 10px',
  fontSize: typeScale.xs.size,
  fontWeight: 500,
  cursor: 'pointer',
};

const hintStyle: CSSProperties = {
  color: colors.textMuted,
  fontSize: typeScale.xs.size,
  lineHeight: 1.4,
};

const cardStyle: CSSProperties = {
  background: colors.surface,
  border: `1px solid ${colors.border}`,
  borderRadius: radii.lg,
  padding: spacing[3],
  display: 'flex',
  flexDirection: 'column',
  gap: spacing[2],
};

const cardTitleStyle: CSSProperties = {
  color: colors.textSecondary,
  fontSize: typeScale.xs.size,
  textTransform: 'uppercase',
  letterSpacing: '0.09em',
  fontWeight: 600,
};

const dlStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: spacing[1],
};

const rowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: spacing[2],
  padding: `${spacing[1]} 0`,
  borderBottom: `1px solid ${colors.border}`,
};

const dtStyle: CSSProperties = {
  color: colors.textMuted,
  fontSize: typeScale.xs.size,
};

const ddStyle: CSSProperties = {
  color: colors.textPrimary,
  fontSize: typeScale.xs.size,
  fontFamily: 'var(--hf-font-mono)',
  fontWeight: 600,
};

const adequacyNoteStyle: CSSProperties = {
  border: `1px solid ${colors.border}`,
  borderRadius: radii.md,
  padding: spacing[2],
  fontSize: typeScale.xs.size,
  lineHeight: 1.4,
};

const emptyBodyStyle: CSSProperties = {
  color: colors.textMuted,
  fontSize: typeScale.xs.size,
  lineHeight: 1.5,
};

const findingsStyle: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: spacing[2],
};

const findingItemStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: spacing[0.5],
  borderLeft: `2px solid ${colors.border}`,
  paddingLeft: spacing[2],
};

const findingSevStyle: CSSProperties = {
  fontSize: typeScale.xs.size,
  fontWeight: 700,
  letterSpacing: '0.06em',
};

const findingMsgStyle: CSSProperties = {
  color: colors.textPrimary,
  fontSize: typeScale.xs.size,
  lineHeight: 1.4,
};

const citationStyle: CSSProperties = {
  color: colors.textMuted,
  fontSize: typeScale.xs.size,
  lineHeight: 1.4,
};

const disclaimerStyle: CSSProperties = {
  color: colors.textMuted,
  fontSize: typeScale.xs.size,
  lineHeight: 1.5,
  fontStyle: 'italic',
  borderTop: `1px solid ${colors.border}`,
  paddingTop: spacing[2],
};

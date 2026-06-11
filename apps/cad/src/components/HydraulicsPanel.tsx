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
import { solveFlow } from '../lib/flow-calculator';
import { hydrantFlow } from '../lib/hydrant-flow';
import { effectiveHeadDemand, type HazardClass } from '../lib/density-demand';
import { HAZARD_CLASSES } from '../lib/model';
import { formatHydraulicReport } from '../lib/hydraulic-report';
import { buildReportInput, safePipeVolumes } from '../lib/report-from-result';

export function HydraulicsPanel(): ReactElement {
  const project = useCadStore((s) => s.project);
  const supply = useCadStore((s) => s.supply);
  const designAreaSqFt = useCadStore((s) => s.designAreaSqFt);
  const setSupply = useCadStore((s) => s.setSupply);
  const setDesignArea = useCadStore((s) => s.setDesignArea);
  const pressureHeatmap = useCadStore((s) => s.pressureHeatmap);
  const showClearanceIssues = useCadStore((s) => s.showClearanceIssues);
  const setPressureHeatmap = useCadStore((s) => s.setPressureHeatmap);
  const setShowClearanceIssues = useCadStore((s) => s.setShowClearanceIssues);

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
  const hasSegments = project.network.segments.length > 0;

  // Pipe water volume of the CURRENT routed network. Fail-soft: kernel-imported
  // odd (non-schedule) nominal sizes make pipeVolumes throw -> render "n/a".
  const volumes = useMemo(
    () => safePipeVolumes(project.network.segments),
    [project.network.segments],
  );

  const downloadSummary = (): void => {
    const text = formatHydraulicReport(
      buildReportInput({
        projectName: project.name,
        hazard: project.hazardDefaults.defaultClass,
        result,
        supply,
      }),
    );
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name.replace(/[^\w.-]+/g, '_')}-hydraulic-summary.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

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
        <label style={toggleLabelStyle}>
          <input
            type="checkbox"
            checked={showClearanceIssues}
            onChange={(e) => setShowClearanceIssues(e.target.checked)}
          />
          Clearance issues
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
        {/* H17 pipe water volume — fail-soft on non-schedule nominal sizes. */}
        <div style={rowStyle}>
          <span style={dtStyle}>Pipe water volume (routed network)</span>
          <span style={ddStyle}>
            {volumes == null
              ? 'n/a (non-schedule sizes present)'
              : `${volumes.totalGallons.toFixed(1)} gal`}
          </span>
        </div>
        <div style={btnRowStyle}>
          <button
            type="button"
            style={hasSegments ? ghostBtnStyle : disabledBtnStyle}
            disabled={!hasSegments}
            title={
              hasSegments
                ? 'Download the design-aid calc summary as plain text'
                : 'No pipe segments — route the system first (W4)'
            }
            onClick={downloadSummary}
          >
            Download calc summary (.txt)
          </button>
        </div>
      </div>

      {/* Calculators — small self-contained design-aid calculators. */}
      <div style={cardStyle}>
        <div style={cardTitleStyle}>Calculators</div>
        <p style={hintStyle}>
          Design-aid calculators using the cited published formulas — estimates only,
          not a certified hydraulic calculation.
        </p>
        <div style={calcGridStyle}>
          <FlowCalcCard />
          <HydrantFlowCard />
          <DensityFloorCard defaultHazard={project.hazardDefaults.defaultClass} />
        </div>
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

/* --------------------------------------------------------------- calculators */

/** AutoSprink Flow Calculator: enter exactly two of {Q, K, P}; the third solves
 *  via the cited Q = K * sqrt(P). Library errors render inline (no crash). */
function FlowCalcCard(): ReactElement {
  const [flow, setFlow] = useState('');
  const [k, setK] = useState('');
  const [press, setPress] = useState('');

  const givenCount = [flow, k, press].filter((v) => v.trim() !== '').length;
  let body: ReactElement;
  if (givenCount !== 2) {
    body = (
      <p style={hintStyle}>Enter exactly two values — the third is solved (Q = K·√P).</p>
    );
  } else {
    try {
      const res = solveFlow({
        flowGpm: flow.trim() === '' ? undefined : Number(flow),
        kFactor: k.trim() === '' ? undefined : Number(k),
        pressurePsi: press.trim() === '' ? undefined : Number(press),
      });
      const solved =
        res.solvedFor === 'flowGpm'
          ? `flow = ${res.flowGpm.toFixed(2)} gpm`
          : res.solvedFor === 'kFactor'
            ? `K-factor = ${res.kFactor.toFixed(2)}`
            : `pressure = ${res.pressurePsi.toFixed(2)} psi`;
      body = (
        <p style={calcResultStyle}>
          Solved {solved} ({res.formula})
        </p>
      );
    } catch (e) {
      body = <p style={calcErrorStyle}>{e instanceof Error ? e.message : String(e)}</p>;
    }
  }

  return (
    <div style={calcCardStyle}>
      <div style={calcTitleStyle}>Flow Calculator</div>
      <div style={inputRowStyle}>
        <Field label="Flow (gpm)" value={flow} onChange={setFlow} />
        <Field label="K-factor" value={k} onChange={setK} />
        <Field label="Pressure (psi)" value={press} onChange={setPress} />
      </div>
      {body}
    </div>
  );
}

/** Hydrant flow from a pitot reading: Q = 29.83 * c * d^2 * sqrt(P) (NFPA 291 style). */
function HydrantFlowCard(): ReactElement {
  const [coeff, setCoeff] = useState('');
  const [dia, setDia] = useState('');
  const [pitot, setPitot] = useState('');

  const allGiven = [coeff, dia, pitot].every((v) => v.trim() !== '');
  let body: ReactElement;
  if (!allGiven) {
    body = <p style={hintStyle}>Enter coefficient, orifice diameter and pitot pressure.</p>;
  } else {
    try {
      const res = hydrantFlow({
        coefficient: Number(coeff),
        diameterIn: Number(dia),
        pitotPsi: Number(pitot),
      });
      body = (
        <p style={calcResultStyle}>
          {res.flowGpm.toFixed(1)} gpm ({res.formula})
        </p>
      );
    } catch (e) {
      body = <p style={calcErrorStyle}>{e instanceof Error ? e.message : String(e)}</p>;
    }
  }

  return (
    <div style={calcCardStyle}>
      <div style={calcTitleStyle}>Hydrant Flow</div>
      <div style={inputRowStyle}>
        <Field label="Coefficient" value={coeff} onChange={setCoeff} />
        <Field label="Orifice Ø (in)" value={dia} onChange={setDia} />
        <Field label="Pitot (psi)" value={pitot} onChange={setPitot} />
      </div>
      {body}
    </div>
  );
}

/** Per-head demand floor: GREATER of the min-operating-pressure flow and the
 *  cited NFPA-13 density floor for the chosen hazard. */
function DensityFloorCard({ defaultHazard }: { defaultHazard: HazardClass }): ReactElement {
  const [k, setK] = useState('');
  const [minPsi, setMinPsi] = useState('');
  const [hazard, setHazard] = useState<HazardClass>(defaultHazard);

  const allGiven = k.trim() !== '' && minPsi.trim() !== '';
  let body: ReactElement;
  if (!allGiven) {
    body = <p style={hintStyle}>Enter the head K-factor and minimum operating pressure.</p>;
  } else {
    try {
      const res = effectiveHeadDemand(Number(k), Number(minPsi), hazard);
      body = (
        <div style={calcResultColStyle}>
          <p style={calcResultStyle}>
            {res.flowGpm.toFixed(2)} gpm @ {res.pressurePsi.toFixed(2)} psi — governed by{' '}
            {res.governedBy}
          </p>
          <p style={citationStyle}>{res.citation}</p>
        </div>
      );
    } catch (e) {
      body = <p style={calcErrorStyle}>{e instanceof Error ? e.message : String(e)}</p>;
    }
  }

  return (
    <div style={calcCardStyle}>
      <div style={calcTitleStyle}>Density floor (per head)</div>
      <div style={inputRowStyle}>
        <Field label="K-factor" value={k} onChange={setK} />
        <Field label="Min op (psi)" value={minPsi} onChange={setMinPsi} />
        <label style={fieldLabelStyle}>
          <span style={fieldCaptionStyle}>Hazard</span>
          <select
            value={hazard}
            onChange={(e) => setHazard(e.target.value as HazardClass)}
            style={inputStyle}
          >
            {HAZARD_CLASSES.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
        </label>
      </div>
      {body}
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

const disabledBtnStyle: CSSProperties = {
  background: colors.surfaceRaised,
  color: colors.textMuted,
  border: `1px solid ${colors.border}`,
  borderRadius: 6,
  padding: '4px 10px',
  fontSize: typeScale.xs.size,
  fontWeight: 500,
  cursor: 'not-allowed',
  opacity: 0.6,
};

const calcGridStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: spacing[2],
};

const calcCardStyle: CSSProperties = {
  background: colors.surfaceRaised,
  border: `1px solid ${colors.border}`,
  borderRadius: radii.md,
  padding: spacing[2],
  display: 'flex',
  flexDirection: 'column',
  gap: spacing[2],
};

const calcTitleStyle: CSSProperties = {
  color: colors.textSecondary,
  fontSize: typeScale.xs.size,
  fontWeight: 600,
};

const calcResultStyle: CSSProperties = {
  color: colors.textPrimary,
  fontSize: typeScale.xs.size,
  fontFamily: 'var(--hf-font-mono)',
  lineHeight: 1.4,
};

const calcResultColStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: spacing[0.5],
};

const calcErrorStyle: CSSProperties = {
  color: colors.danger,
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

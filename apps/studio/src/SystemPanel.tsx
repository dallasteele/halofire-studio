// HaloFire Studio — NFPA-13 System mode (React DOM, full-width panel).
//
// Lets an operator pick a head SKU (from the REAL ingested manufacturer catalog)
// + a hazard class, builds a tiny example wet-pipe branch-line system from the
// catalog head's real inlet port, runs validateSystem + the cited rule checks,
// and shows the typed findings — each labelled with the NFPA-13 section it cites.
//
// HONESTY: a PROMINENT banner states this is a design aid built from published
// NFPA-13 values — NOT a certified hydraulic calculation, NOT AHJ-approved, NOT
// PE-sealed, NOT for construction. Every finding shows its cited rule. Uncertain
// code values are surfaced (from nfpa13-rules) as cite-TODOs, never fabricated.

import {
  useMemo,
  useState,
  type CSSProperties,
  type ReactElement,
} from 'react';
import {
  type CatalogPart,
  type ManufacturerCatalog,
} from './lib/manufacturer-catalog';
import {
  HAZARD_CLASSES,
  NFPA13_DESIGN_AID_DISCLAIMER,
  RULES,
  UNCERTAIN_VALUES,
  type HazardClass,
} from './lib/nfpa13-rules';
import {
  buildSystem,
  summarizeFindings,
  validateSystem,
  type FireSystem,
  type SystemFinding,
} from './lib/system-model';
import { type Method, type Port } from './lib/connectivity';
import { colors, radii, spacing, typeScale } from './lib/tokens';

export interface SystemPanelProps {
  catalog: ManufacturerCatalog | null;
}

const HAZARD_LABELS: Record<HazardClass, string> = {
  light: 'Light',
  ordinary_1: 'Ordinary Group 1',
  ordinary_2: 'Ordinary Group 2',
  extra_1: 'Extra Group 1',
  extra_2: 'Extra Group 2',
};

/** Map a catalog port (loose strings) to a typed connectivity inlet Port. */
function headInletFromSku(part: CatalogPart | null): Port {
  const fallback: Port = { method: 'THREADED_NPT', nominalSizeIn: 0.5, role: 'INLET' };
  if (!part || !part.port) return fallback;
  const method = (part.port.method as Method) ?? 'THREADED_NPT';
  const size = part.port.nominalSizeIn ?? 0.5;
  return { method, nominalSizeIn: size, role: 'INLET' };
}

export function SystemPanel({ catalog }: SystemPanelProps): ReactElement {
  const heads = useMemo(
    () => (catalog?.entries ?? []).filter((p) => p.category.startsWith('head')),
    [catalog],
  );

  const [headId, setHeadId] = useState<string>('');
  const [hazard, setHazard] = useState<HazardClass>('ordinary_1');
  // Footprint defaults sized so an "ordinary" example validates cleanly; the
  // operator can stretch the footprint to deliberately trip the over-area check.
  const [widthFt, setWidthFt] = useState(40);
  const [lengthFt, setLengthFt] = useState(40);

  const selectedHead = useMemo(
    () => heads.find((h) => h.id === headId) ?? heads[0] ?? null,
    [heads, headId],
  );

  const system: FireSystem = useMemo(() => {
    const headInlet = headInletFromSku(selectedHead);
    // Branch one size up from the head so the connection exercises a real
    // reducing-bushing adapter when the head is 1/2" (3/4 -> 1/2 bushing).
    const branchSizeIn = headInlet.nominalSizeIn <= 0.5 ? 0.75 : 1;
    return buildSystem({
      hazard,
      widthFt,
      lengthFt,
      headsPerBranch: 3,
      branchCount: 3,
      headSku: selectedHead?.id ?? null,
      headInlet,
      branchSizeIn,
      branchMethod: 'THREADED_NPT',
    });
  }, [selectedHead, hazard, widthFt, lengthFt]);

  const findings = useMemo(() => validateSystem(system), [system]);
  const summary = useMemo(() => summarizeFindings(findings), [findings]);

  return (
    <section style={wrapStyle} aria-label="NFPA-13 system model">
      {/* PROMINENT design-aid banner */}
      <div style={bannerStyle} role="alert">
        <strong style={bannerStrongStyle}>Design aid</strong> based on published
        NFPA-13 values. NOT a certified hydraulic calculation, NOT AHJ-approved,
        NOT PE-sealed, NOT for construction.
      </div>

      <div style={controlsStyle}>
        <label style={fieldStyle}>
          <span style={labelTextStyle}>Head SKU</span>
          <select
            value={selectedHead?.id ?? ''}
            onChange={(e) => setHeadId(e.target.value)}
            style={selectStyle}
            aria-label="Head SKU"
          >
            {heads.length === 0 ? (
              <option value="">no catalog heads loaded</option>
            ) : (
              heads.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.mfr} {h.model}
                  {h.sin ? ` (${h.sin})` : ''}
                  {h.kFactor !== null ? ` · K${h.kFactor.toFixed(1)}` : ''}
                </option>
              ))
            )}
          </select>
        </label>

        <label style={fieldStyle}>
          <span style={labelTextStyle}>Hazard class</span>
          <select
            value={hazard}
            onChange={(e) => setHazard(e.target.value as HazardClass)}
            style={selectStyle}
            aria-label="Hazard class"
          >
            {HAZARD_CLASSES.map((h) => (
              <option key={h} value={h}>
                {HAZARD_LABELS[h]}
              </option>
            ))}
          </select>
        </label>

        <label style={fieldStyle}>
          <span style={labelTextStyle}>Footprint width (ft)</span>
          <input
            type="number"
            min={5}
            max={400}
            value={widthFt}
            onChange={(e) => setWidthFt(clampNum(e.target.value, 5, 400, 40))}
            style={inputStyle}
            aria-label="Footprint width feet"
          />
        </label>

        <label style={fieldStyle}>
          <span style={labelTextStyle}>Footprint length (ft)</span>
          <input
            type="number"
            min={5}
            max={400}
            value={lengthFt}
            onChange={(e) => setLengthFt(clampNum(e.target.value, 5, 400, 40))}
            style={inputStyle}
            aria-label="Footprint length feet"
          />
        </label>

        <span style={summaryChipStyle} role="status">
          <span style={{ color: colors.danger }}>{summary.error} error</span>
          {' · '}
          <span style={{ color: colors.accentText }}>{summary.warn} warn</span>
          {' · '}
          <span style={{ color: '#22c55e' }}>{summary.ok} ok</span>
        </span>
      </div>

      <div className="hf-scroll" style={scrollStyle}>
        <h3 style={sectionHeadStyle}>
          Example wet-pipe system —{' '}
          <span style={{ color: colors.textSecondary, fontWeight: 500 }}>
            {system.nodes.length} nodes · {system.heads.length} heads ·{' '}
            {HAZARD_LABELS[hazard]}
          </span>
        </h3>

        <ol style={findingListStyle}>
          {findings.map((f, i) => (
            <FindingRow key={`${f.code}-${i}`} finding={f} />
          ))}
        </ol>

        <h3 style={sectionHeadStyle}>Cited NFPA-13 values (each with citation)</h3>
        <div role="table" style={rulesTableStyle}>
          <div role="row" style={rulesHeaderRowStyle}>
            <span role="columnheader" style={ruleColDesc}>Value</span>
            <span role="columnheader" style={ruleColNum}>Number</span>
            <span role="columnheader" style={ruleColCite}>Citation</span>
          </div>
          {RULES.filter((r) => r.value !== null).map((r) => (
            <div key={r.id} role="row" style={rulesDataRowStyle}>
              <span role="cell" style={ruleColDesc}>{r.description}</span>
              <span role="cell" className="hf-mono" style={ruleColNum}>
                {r.value} {r.unit}
              </span>
              <span role="cell" style={ruleColCite}>{r.citation}</span>
            </div>
          ))}
        </div>

        <h3 style={sectionHeadStyle}>
          Uncertain values — left as cite-TODO (NOT fabricated)
        </h3>
        <ul style={uncertainListStyle}>
          {UNCERTAIN_VALUES.map((u) => (
            <li key={u.id} style={uncertainItemStyle}>
              <strong>{u.description}</strong>
              <span style={uncertainCiteStyle}>{u.citation}</span>
            </li>
          ))}
        </ul>

        <p style={footerDisclaimerStyle}>{NFPA13_DESIGN_AID_DISCLAIMER}</p>
      </div>
    </section>
  );
}

function FindingRow({ finding }: { finding: SystemFinding }): ReactElement {
  const sev = finding.severity;
  const color =
    sev === 'error' ? colors.danger : sev === 'warn' ? colors.accentText : '#22c55e';
  return (
    <li style={findingItemStyle}>
      <span style={{ ...sevBadgeStyle, background: color }}>{sev.toUpperCase()}</span>
      <div style={findingBodyStyle}>
        <div style={findingMsgStyle}>{finding.message}</div>
        <div style={findingCiteStyle}>
          <span style={citeLabelStyle}>cite:</span> {finding.citedRule}
        </div>
      </div>
    </li>
  );
}

/* ------------------------------------------------------------- helpers */

function clampNum(raw: string, lo: number, hi: number, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
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

const bannerStyle: CSSProperties = {
  margin: spacing[4],
  marginBottom: 0,
  padding: `${spacing[3]} ${spacing[4]}`,
  background: '#3a1d1d',
  border: `2px solid ${colors.danger}`,
  borderRadius: radii.md,
  color: '#ffd9d9',
  fontSize: typeScale.sm.size,
  lineHeight: 1.5,
};

const bannerStrongStyle: CSSProperties = {
  color: '#ffffff',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

const controlsStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'flex-end',
  gap: spacing[3],
  padding: spacing[4],
  borderBottom: `1px solid ${colors.border}`,
};

const fieldStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: spacing[1],
};

const labelTextStyle: CSSProperties = {
  fontSize: typeScale.xs.size,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: colors.textMuted,
};

const selectStyle: CSSProperties = {
  padding: `${spacing[2]} ${spacing[3]}`,
  background: colors.surface,
  color: colors.textPrimary,
  border: `1px solid ${colors.border}`,
  borderRadius: radii.md,
  fontSize: typeScale.sm.size,
  minWidth: 220,
};

const inputStyle: CSSProperties = {
  padding: `${spacing[2]} ${spacing[3]}`,
  background: colors.surface,
  color: colors.textPrimary,
  border: `1px solid ${colors.border}`,
  borderRadius: radii.md,
  fontSize: typeScale.sm.size,
  width: 110,
  boxSizing: 'border-box',
};

const summaryChipStyle: CSSProperties = {
  marginLeft: 'auto',
  padding: `${spacing[2]} ${spacing[3]}`,
  background: colors.surfaceRaised,
  border: `1px solid ${colors.border}`,
  borderRadius: radii.pill,
  fontSize: typeScale.sm.size,
  fontVariantNumeric: 'tabular-nums',
};

const scrollStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  padding: `${spacing[3]} ${spacing[4]} ${spacing[6]}`,
};

const sectionHeadStyle: CSSProperties = {
  margin: `${spacing[5]} 0 ${spacing[2]}`,
  fontSize: typeScale.base.size,
  fontWeight: 700,
  color: colors.textPrimary,
};

const findingListStyle: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: spacing[2],
};

const findingItemStyle: CSSProperties = {
  display: 'flex',
  gap: spacing[3],
  padding: spacing[3],
  background: colors.surface,
  border: `1px solid ${colors.border}`,
  borderRadius: radii.md,
};

const sevBadgeStyle: CSSProperties = {
  flexShrink: 0,
  alignSelf: 'flex-start',
  padding: `2px ${spacing[2]}`,
  borderRadius: radii.sm,
  color: '#0b0b0b',
  fontSize: typeScale.xs.size,
  fontWeight: 800,
  letterSpacing: '0.04em',
};

const findingBodyStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: spacing[1],
  minWidth: 0,
};

const findingMsgStyle: CSSProperties = {
  fontSize: typeScale.sm.size,
  color: colors.textPrimary,
};

const findingCiteStyle: CSSProperties = {
  fontSize: typeScale.xs.size,
  color: colors.textSecondary,
  lineHeight: 1.5,
};

const citeLabelStyle: CSSProperties = {
  color: colors.accentText,
  fontWeight: 700,
};

const rulesTableStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  border: `1px solid ${colors.border}`,
  borderRadius: radii.md,
  overflow: 'hidden',
};

const ruleRowBase: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '2fr 1.2fr 3fr',
  gap: spacing[3],
  padding: `${spacing[2]} ${spacing[3]}`,
  alignItems: 'start',
};

const rulesHeaderRowStyle: CSSProperties = {
  ...ruleRowBase,
  background: colors.surfaceRaised,
  fontSize: typeScale.xs.size,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: colors.textMuted,
  borderBottom: `1px solid ${colors.border}`,
};

const rulesDataRowStyle: CSSProperties = {
  ...ruleRowBase,
  fontSize: typeScale.sm.size,
  color: colors.textPrimary,
  background: colors.surface,
  borderBottom: `1px solid ${colors.border}`,
};

const ruleColDesc: CSSProperties = { color: colors.textPrimary };
const ruleColNum: CSSProperties = { textAlign: 'right', color: colors.textSecondary };
const ruleColCite: CSSProperties = {
  color: colors.textSecondary,
  fontSize: typeScale.xs.size,
  lineHeight: 1.5,
};

const uncertainListStyle: CSSProperties = {
  margin: 0,
  paddingLeft: spacing[5],
  display: 'flex',
  flexDirection: 'column',
  gap: spacing[2],
};

const uncertainItemStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  fontSize: typeScale.sm.size,
  color: colors.textPrimary,
};

const uncertainCiteStyle: CSSProperties = {
  fontSize: typeScale.xs.size,
  color: colors.textMuted,
};

const footerDisclaimerStyle: CSSProperties = {
  marginTop: spacing[6],
  padding: spacing[4],
  background: colors.surface,
  border: `1px solid ${colors.border}`,
  borderRadius: radii.md,
  color: colors.accentText,
  fontSize: typeScale.xs.size,
  lineHeight: 1.6,
};

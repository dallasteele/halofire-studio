// HaloFire Studio — auto-bid ESTIMATE panel (React DOM, RIGHT panel in layout
// mode). Renders the deterministic priced line-item table plus the
// material / labor / OH&P / total rollup, styled with the design tokens, behind a
// PROMINENT honesty disclaimer.
//
// HONESTY (hard): the BID_DISCLAIMER is shown verbatim and styled as a caution —
// this is a BEST-EFFORT ESTIMATE from REPRESENTATIVE prices + standard labor
// assumptions, NOT a quote, NOT a committed bid, NOT AHJ / PE / permit /
// code-compliant. The autosprink app retains the REAL pricebook-backed bid; this
// panel is a quick estimate only.

import { type CSSProperties, type ReactElement } from 'react';
import { BID_DISCLAIMER, type BidEstimate } from './lib/bid';
import { colors, radii, spacing, typeScale } from './lib/tokens';

export interface BidPanelProps {
  bid: BidEstimate;
}

/** Format a USD amount with thousands separators and 2 decimals. */
function usd(n: number): string {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Format a quantity (drops trailing .00, keeps up to 2 decimals). */
function qtyFmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

export function BidPanel({ bid }: BidPanelProps): ReactElement {
  return (
    <aside style={panelStyle} aria-label="Auto-bid estimate">
      <h2 style={headingStyle}>Bid estimate</h2>

      <p style={subheadStyle}>
        Best-effort estimate from representative prices + standard labor
        assumptions.
      </p>

      <table style={tableStyle}>
        <thead>
          <tr>
            <th scope="col" style={thLeftStyle}>
              Item
            </th>
            <th scope="col" style={thRightStyle}>
              Qty
            </th>
            <th scope="col" style={thRightStyle}>
              Unit $
            </th>
            <th scope="col" style={thRightStyle}>
              Ext.
            </th>
          </tr>
        </thead>
        <tbody>
          {bid.lineItems.map((li) => (
            <tr key={li.key}>
              <td style={tdLeftStyle}>{li.description}</td>
              <td style={tdNumStyle}>
                {qtyFmt(li.qty)} {li.unit}
              </td>
              <td style={tdNumStyle}>{usd(li.unitPrice)}</td>
              <td style={tdNumStyle}>{usd(li.extended)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl style={rollupStyle} aria-live="polite">
        <Row label="Materials" value={usd(bid.materialTotal)} />
        <Row label={`Labor (${qtyFmt(bid.laborHours)} hr)`} value={usd(bid.laborCost)} />
        <Row label="Subtotal" value={usd(bid.subtotal)} />
        <Row label="Overhead (10%)" value={usd(bid.overhead)} />
        <Row label="Profit (10%)" value={usd(bid.profit)} />
        <Row label="Estimated total" value={usd(bid.total)} emphatic />
      </dl>

      <p style={disclaimerStyle} role="note">
        <strong style={disclaimerStrongStyle}>Estimate only — not a quote.</strong>{' '}
        {BID_DISCLAIMER}
      </p>
    </aside>
  );
}

function Row({
  label,
  value,
  emphatic = false,
}: {
  label: string;
  value: string;
  emphatic?: boolean;
}): ReactElement {
  return (
    <div style={emphatic ? rollupRowEmphaticStyle : rollupRowStyle}>
      <dt style={emphatic ? rollupLabelEmphaticStyle : labelStyle}>{label}</dt>
      <dd style={emphatic ? rollupValueEmphaticStyle : rollupValueStyle}>{value}</dd>
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
  borderLeft: `1px solid ${colors.border}`,
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

const subheadStyle: CSSProperties = {
  margin: 0,
  color: colors.textSecondary,
  fontSize: typeScale.xs.size,
  lineHeight: 1.5,
};

const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: typeScale.xs.size,
};

const thLeftStyle: CSSProperties = {
  textAlign: 'left',
  padding: `${spacing[1]} ${spacing[2]} ${spacing[2]} 0`,
  borderBottom: `1px solid ${colors.border}`,
  color: colors.textMuted,
  fontWeight: 600,
};

const thRightStyle: CSSProperties = {
  ...thLeftStyle,
  textAlign: 'right',
  padding: `${spacing[1]} 0 ${spacing[2]} ${spacing[2]}`,
};

const tdLeftStyle: CSSProperties = {
  padding: `${spacing[1]} ${spacing[2]} ${spacing[1]} 0`,
  borderBottom: `1px solid ${colors.border}`,
  color: colors.textSecondary,
};

const tdNumStyle: CSSProperties = {
  padding: `${spacing[1]} 0 ${spacing[1]} ${spacing[2]}`,
  borderBottom: `1px solid ${colors.border}`,
  textAlign: 'right',
  color: colors.textPrimary,
  fontVariantNumeric: 'tabular-nums',
  fontFamily: 'var(--hf-font-mono)',
  whiteSpace: 'nowrap',
};

const rollupStyle: CSSProperties = {
  margin: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: spacing[2],
  padding: `${spacing[3]} ${spacing[4]}`,
  background: colors.surfaceRaised,
  border: `1px solid ${colors.border}`,
  borderRadius: radii.md,
};

const rollupRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  margin: 0,
  gap: spacing[3],
};

const rollupRowEmphaticStyle: CSSProperties = {
  ...rollupRowStyle,
  marginTop: spacing[1],
  paddingTop: spacing[2],
  borderTop: `1px solid ${colors.borderStrong}`,
};

const labelStyle: CSSProperties = {
  color: colors.textSecondary,
  fontSize: typeScale.sm.size,
};

const rollupLabelEmphaticStyle: CSSProperties = {
  ...labelStyle,
  color: colors.textPrimary,
  fontWeight: 600,
};

const rollupValueStyle: CSSProperties = {
  margin: 0,
  color: colors.textPrimary,
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
  fontFamily: 'var(--hf-font-mono)',
};

const rollupValueEmphaticStyle: CSSProperties = {
  ...rollupValueStyle,
  color: colors.accentText,
  fontSize: typeScale.lg.size,
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

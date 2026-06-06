// HaloFire CAD — BidPanel (W6). The Bid ribbon-tab content: the live grouped BOM
// table (qty / unit / unit price / extended / priceSource), the materials / labor /
// OH&P / total summary, an honest "design aid — NOT a committed quote" banner, an
// Export bid (JSON / CSV) button, and a best-effort "Send to HaloFire bid" action.
//
// Reads the LIVE priced bid from the store selector, so it recomputes on every
// network OR pricebook edit. Numbers come ONLY from the studio bid math over the
// routed-network takeoff (real pricebook medians preferred; unpriced lines 0 +
// flagged). The autosprink send is fail-soft and NEVER blocks the in-app bid.
//
// HONESTY: this is a BEST-EFFORT design-aid ESTIMATE, NOT a committed quote / AHJ /
// PE / final bid (banner restated). Quantities map 1:1 to the network.

import { useMemo, useState, type CSSProperties, type ReactElement } from 'react';
import { selectPricedBid, selectTakeoff, useCadStore } from '../store';
import { bidToCsv, bidToJson, type PricedBomLine } from '../lib/priced-bid';
import { sendBidToAutosprink, type AutosprinkSendResult } from '../lib/autosprink-bid';
import { colors, radii, spacing, typeScale } from '../lib/tokens';

const USD = (n: number): string =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

const PRICE_SOURCE_LABEL: Record<PricedBomLine['priceSource'], string> = {
  'pricebook-median': 'pricebook median',
  'representative-fallback': 'representative',
  'representative-only': 'representative (no band)',
  'no-price': 'NO PRICE',
};

function triggerDownload(filename: string, content: string, mime: string): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function BidPanel(): ReactElement {
  const project = useCadStore((s) => s.project);
  const priceTable = useCadStore((s) => s.priceTable);

  // LIVE bid + takeoff — recomputed when the network or price table change.
  const bid = useMemo(
    () => selectPricedBid(useCadStore.getState()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project.network, priceTable],
  );
  const takeoff = useMemo(
    () => selectTakeoff(useCadStore.getState()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project.network],
  );

  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<AutosprinkSendResult | null>(null);

  const e = bid.estimate;
  const hasNetwork = bid.bomLines.length > 0;

  const handleSend = async (): Promise<void> => {
    setSending(true);
    setSendResult(null);
    const result = await sendBidToAutosprink({
      total: e.total,
      project: project.name,
      notes:
        'Design-aid ESTIMATE from HaloFire CAD. ' + e.disclaimer,
    });
    setSendResult(result);
    setSending(false);
  };

  return (
    <div style={panelStyle} aria-label="Takeoff and bid">
      {/* Honest banner — restated, never hidden. */}
      <div style={bannerStyle}>
        Estimate (design aid) — NOT a committed quote / AHJ / PE / final bid.
      </div>

      {!hasNetwork ? (
        <p style={emptyBodyStyle}>
          No routed system. Place heads and Route pipe (W4) first — the takeoff and
          bid recompute from the routed network.
        </p>
      ) : (
        <>
          {/* Takeoff summary line. */}
          <div style={summaryRowStyle}>
            <Pill label="Heads" value={String(takeoff.headCount)} />
            <Pill label="Pipe (ft)" value={takeoff.totalPipeFt.toFixed(1)} />
            <Pill label="Fittings" value={String(takeoff.fittingCount)} />
            <Pill label="BOM lines" value={String(bid.bomLines.length)} />
          </div>

          {/* BOM table. */}
          <div style={cardStyle}>
            <div style={cardTitleStyle}>Bill of materials</div>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thLeft}>Item</th>
                  <th style={thRight}>Qty</th>
                  <th style={thLeft}>Unit</th>
                  <th style={thRight}>Unit $</th>
                  <th style={thRight}>Extended</th>
                  <th style={thLeft}>Price source</th>
                </tr>
              </thead>
              <tbody>
                {bid.bomLines.map((l) => (
                  <tr key={l.key}>
                    <td style={tdLeft}>{l.description}</td>
                    <td style={tdRight}>{l.qty}</td>
                    <td style={tdLeft}>{l.unit}</td>
                    <td style={tdRight}>{l.priceSource === 'no-price' ? '—' : USD(l.unitPrice)}</td>
                    <td style={tdRight}>{l.priceSource === 'no-price' ? '$0.00' : USD(l.extended)}</td>
                    <td
                      style={{
                        ...tdLeft,
                        color: l.priceSource === 'no-price' ? colors.danger : colors.textMuted,
                      }}
                    >
                      {PRICE_SOURCE_LABEL[l.priceSource]}
                      {l.matchedRows ? ` (${l.matchedRows} rows)` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {bid.unpricedLineCount > 0 && (
              <div style={warnNoteStyle}>
                {bid.unpricedLineCount} line(s) had no price — shown at $0 and flagged
                (NO PRICE). They are NOT silently dropped.
              </div>
            )}
          </div>

          {/* Totals. */}
          <div style={cardStyle}>
            <div style={cardTitleStyle}>Estimate</div>
            <dl style={dlStyle}>
              <TotalRow label="Materials" value={USD(e.materialTotal)} />
              <TotalRow label={`Labor (${e.laborHours} hr @ $90/hr)`} value={USD(e.laborCost)} />
              <TotalRow label="Subtotal" value={USD(e.subtotal)} />
              <TotalRow label="Overhead (10%)" value={USD(e.overhead)} />
              <TotalRow label="Profit (10% compounded)" value={USD(e.profit)} />
              <TotalRow label="TOTAL (estimate)" value={USD(e.total)} strong />
            </dl>
            <div style={citationStyle}>
              Pricing source:{' '}
              {e.priceSource === 'pricebook-median'
                ? `real pricebook medians (${e.pricebookRowCount} rows)`
                : 'representative fallback (pricebook medians unavailable)'}
              . {bid.pricedLineCount} priced / {bid.unpricedLineCount} unpriced lines.
            </div>
          </div>

          {/* Actions. */}
          <div style={actionsRowStyle}>
            <button
              type="button"
              style={ghostBtnStyle}
              onClick={() => triggerDownload('halofire-cad-bid.json', bidToJson(bid), 'application/json')}
            >
              Export JSON
            </button>
            <button
              type="button"
              style={ghostBtnStyle}
              onClick={() => triggerDownload('halofire-cad-bid.csv', bidToCsv(bid), 'text/csv')}
            >
              Export CSV
            </button>
            <button
              type="button"
              style={primaryBtnStyle}
              disabled={sending}
              onClick={() => void handleSend()}
            >
              {sending ? 'Sending…' : 'Send to HaloFire bid'}
            </button>
          </div>

          {sendResult && (
            <div
              style={{
                ...sendNoteStyle,
                color: sendResult.status === 'wired' ? colors.accentText : colors.warn,
                borderColor: sendResult.status === 'wired' ? colors.border : colors.warn,
              }}
            >
              <strong>{sendResult.status.toUpperCase()}</strong> — {sendResult.message}
            </div>
          )}
        </>
      )}

      <p style={disclaimerStyle}>{e.disclaimer}</p>
    </div>
  );
}

function Pill({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div style={pillStyle}>
      <span style={pillLabelStyle}>{label}</span>
      <span style={pillValueStyle}>{value}</span>
    </div>
  );
}

function TotalRow({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}): ReactElement {
  return (
    <div style={rowStyle}>
      <dt style={dtStyle}>{label}</dt>
      <dd style={{ ...ddStyle, fontWeight: strong ? 700 : 600, color: strong ? colors.textPrimary : colors.textPrimary }}>
        {value}
      </dd>
    </div>
  );
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

const bannerStyle: CSSProperties = {
  background: colors.bgInset,
  border: `1px solid ${colors.warn}`,
  color: colors.warn,
  borderRadius: radii.md,
  padding: spacing[2],
  fontSize: typeScale.xs.size,
  fontWeight: 600,
  lineHeight: 1.4,
};

const summaryRowStyle: CSSProperties = {
  display: 'flex',
  gap: spacing[2],
  flexWrap: 'wrap',
};

const pillStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: spacing[0.5],
  background: colors.surfaceRaised,
  border: `1px solid ${colors.border}`,
  borderRadius: radii.md,
  padding: `${spacing[1]} ${spacing[2]}`,
  minWidth: 64,
};

const pillLabelStyle: CSSProperties = {
  color: colors.textMuted,
  fontSize: typeScale.xs.size,
};

const pillValueStyle: CSSProperties = {
  color: colors.textPrimary,
  fontSize: typeScale.sm.size,
  fontWeight: 700,
  fontFamily: 'var(--hf-font-mono)',
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

const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: typeScale.xs.size,
};

const thBase: CSSProperties = {
  color: colors.textMuted,
  fontSize: typeScale.xs.size,
  fontWeight: 600,
  padding: `${spacing[1]} ${spacing[1]}`,
  borderBottom: `1px solid ${colors.border}`,
};
const thLeft: CSSProperties = { ...thBase, textAlign: 'left' };
const thRight: CSSProperties = { ...thBase, textAlign: 'right' };

const tdBase: CSSProperties = {
  color: colors.textPrimary,
  padding: `${spacing[1]} ${spacing[1]}`,
  borderBottom: `1px solid ${colors.border}`,
  fontFamily: 'var(--hf-font-mono)',
};
const tdLeft: CSSProperties = { ...tdBase, textAlign: 'left', fontFamily: 'inherit' };
const tdRight: CSSProperties = { ...tdBase, textAlign: 'right' };

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
};

const actionsRowStyle: CSSProperties = {
  display: 'flex',
  gap: spacing[2],
  flexWrap: 'wrap',
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

const warnNoteStyle: CSSProperties = {
  color: colors.warn,
  fontSize: typeScale.xs.size,
  lineHeight: 1.4,
};

const sendNoteStyle: CSSProperties = {
  border: `1px solid ${colors.border}`,
  borderRadius: radii.md,
  padding: spacing[2],
  fontSize: typeScale.xs.size,
  lineHeight: 1.4,
};

const citationStyle: CSSProperties = {
  color: colors.textMuted,
  fontSize: typeScale.xs.size,
  lineHeight: 1.4,
};

const emptyBodyStyle: CSSProperties = {
  color: colors.textMuted,
  fontSize: typeScale.xs.size,
  lineHeight: 1.5,
};

const disclaimerStyle: CSSProperties = {
  color: colors.textMuted,
  fontSize: typeScale.xs.size,
  lineHeight: 1.5,
  fontStyle: 'italic',
  borderTop: `1px solid ${colors.border}`,
  paddingTop: spacing[2],
};

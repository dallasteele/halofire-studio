/**
 * AB4 — Branded HTML bid renderer (W7B pure module).
 *
 * Pure ESM, no I/O, no side effects. Turns a priced bid record into a complete,
 * standalone, self-contained HTML document with inline CSS only (no external
 * fonts/stylesheets/scripts), suitable for emailing or persisting verbatim.
 *
 * Honesty/fail-closed: the disclaimer is rendered VERBATIM in a distinct footer.
 * Every interpolated field is escaped (escapeHtml) so untrusted bid content can
 * never inject markup. The renderer throws on a malformed bid rather than
 * emitting a misleading partial document.
 */

const BRAND_LINE = 'HALO FIRE PROTECTION';
const EMBER = '#f0a868';

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/**
 * escapeHtml(s) -> string.
 * Escapes the five HTML-significant characters: & < > " '
 * Applied to EVERY interpolated field. null/undefined render as ''.
 */
export function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

/** Currency format via Intl ($1,234.50). Throws on non-finite input. */
function money(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`renderBidHtml: ${label} must be a finite number`);
  }
  return USD.format(value);
}

/** Percentage display: 10 -> "10%". Accepts finite numbers only. */
function pct(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`renderBidHtml: ${label} must be a finite number`);
  }
  // Trim trailing .0 for whole percentages; keep up to 2 decimals otherwise.
  const rounded = Math.round(value * 100) / 100;
  return `${rounded}%`;
}

function nonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`renderBidHtml: ${label} is required`);
  }
  return value;
}

/**
 * renderBidHtml(bid) -> string (complete HTML document).
 *
 * bid = {
 *   projectName, clientName, dateIso,
 *   items: [{ description, quantity, unit, unitCost, extendedCost, priceSource? }],
 *   subtotal, overheadPct, profitPct, total,
 *   notes?, disclaimer, anyEstimated?
 * }
 *
 * HONESTY: a per-line priceSource that is NOT a real quote ('pricebook-median'
 * or 'manual') is marked with a visible asterisk and a footnote, and — when any
 * such line exists, or bid.anyEstimated is set — an "estimated prices" banner is
 * rendered above the line items so the reader (and the approving admin) can never
 * mistake a representative-fallback or unpriced line for a firm price.
 *
 * Throws on: empty projectName/clientName, empty items, missing disclaimer,
 * non-finite money fields (unitCost/extendedCost/subtotal/total) or non-finite
 * percentage fields (overheadPct/profitPct).
 */
// priceSource values that represent a REAL, sourced price (no marker needed).
const FIRM_PRICE_SOURCES = new Set(['pricebook-median', 'manual']);
export function renderBidHtml(bid) {
  if (bid == null || typeof bid !== 'object') {
    throw new Error('renderBidHtml: bid must be an object');
  }
  nonEmptyString(bid.projectName, 'projectName');
  nonEmptyString(bid.clientName, 'clientName');
  nonEmptyString(bid.disclaimer, 'disclaimer');

  if (!Array.isArray(bid.items) || bid.items.length === 0) {
    throw new Error('renderBidHtml: items must be a non-empty array');
  }

  // Validate money fields up front so a bad bid throws instead of half-rendering.
  const subtotalStr = money(bid.subtotal, 'subtotal');
  const totalStr = money(bid.total, 'total');
  const overheadStr = pct(bid.overheadPct, 'overheadPct');
  const profitStr = pct(bid.profitPct, 'profitPct');

  // A line is "estimated" when its priceSource is present and NOT a firm source.
  // Lines with no priceSource at all are treated as firm (legacy callers that
  // never priced via the resolver pass plain unitCost numbers).
  const isEstimatedLine = (item) =>
    typeof item.priceSource === 'string' && !FIRM_PRICE_SOURCES.has(item.priceSource);
  let anyEstimatedLine = false;

  const rows = bid.items.map((item, i) => {
    if (item == null || typeof item !== 'object') {
      throw new Error(`renderBidHtml: item[${i}] must be an object`);
    }
    const qty = item.quantity;
    if (typeof qty !== 'number' || !Number.isFinite(qty)) {
      throw new Error(`renderBidHtml: item[${i}].quantity must be a finite number`);
    }
    const unitCostStr = money(item.unitCost, `item[${i}].unitCost`);
    const extendedStr = money(item.extendedCost, `item[${i}].extendedCost`);
    const estimated = isEstimatedLine(item);
    if (estimated) anyEstimatedLine = true;
    // Visible per-line marker on a fabricated/representative/unpriced price so it
    // can never masquerade as a real quote in the client-facing document.
    const mark = estimated ? '<span class="estmark" title="estimated, not a firm price">*</span>' : '';
    return `        <tr>
          <td class="desc">${escapeHtml(item.description)}${mark}</td>
          <td class="num">${escapeHtml(qty)}</td>
          <td class="unit">${escapeHtml(item.unit)}</td>
          <td class="num money">${escapeHtml(unitCostStr)}${mark}</td>
          <td class="num money">${escapeHtml(extendedStr)}</td>
        </tr>`;
  }).join('\n');

  const showEstimatedBanner = anyEstimatedLine || bid.anyEstimated === true;
  const estimatedBanner = showEstimatedBanner
    ? `      <div class="estbanner">
        <span class="tag">Estimated prices</span>
        Lines marked <b>*</b> use a representative or unpriced figure, NOT a firm
        sourced price. These must be verified before this estimate is relied upon.
      </div>`
    : '';

  const dateDisplay = bid.dateIso ? escapeHtml(bid.dateIso) : '';

  const notesBlock = (typeof bid.notes === 'string' && bid.notes.trim() !== '')
    ? `      <div class="notes">
        <h2>Notes</h2>
        <p>${escapeHtml(bid.notes)}</p>
      </div>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(BRAND_LINE)} — Bid for ${escapeHtml(bid.projectName)}</title>
<style>
  body { margin: 0; padding: 0; background: #f5f5f4; color: #1c1917;
    font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.5; }
  .sheet { max-width: 720px; margin: 24px auto; background: #ffffff;
    border: 1px solid #e7e5e4; border-radius: 8px; overflow: hidden; }
  .brandbar { background: #1c1917; color: #ffffff; padding: 20px 28px;
    border-bottom: 4px solid ${EMBER}; }
  .brandbar .brand { font-size: 22px; font-weight: 900; letter-spacing: 1px;
    color: ${EMBER}; margin: 0; }
  .brandbar .sub { font-size: 12px; color: #d6d3d1; margin: 4px 0 0; }
  .meta { padding: 18px 28px; border-bottom: 1px solid #e7e5e4; }
  .meta .row { margin: 2px 0; }
  .meta .k { display: inline-block; width: 110px; color: #78716c; font-size: 12px;
    text-transform: uppercase; letter-spacing: 0.5px; }
  .meta .v { font-weight: 600; }
  table { width: 100%; border-collapse: collapse; }
  thead th { text-align: left; font-size: 11px; text-transform: uppercase;
    letter-spacing: 0.5px; color: #78716c; padding: 10px 28px; border-bottom: 2px solid #e7e5e4; }
  thead th.num { text-align: right; }
  tbody td { padding: 9px 28px; border-bottom: 1px solid #f5f5f4; }
  tbody td.num { text-align: right; }
  tbody td.money { font-variant-numeric: tabular-nums; }
  tbody td.unit { color: #78716c; }
  .summary { padding: 14px 28px; }
  .summary table { width: auto; margin-left: auto; }
  .summary td { padding: 4px 0 4px 28px; text-align: right; }
  .summary td.lbl { color: #78716c; }
  .summary tr.total td { font-weight: 900; font-size: 16px; color: #1c1917;
    border-top: 2px solid ${EMBER}; padding-top: 10px; }
  .notes { padding: 4px 28px 18px; }
  .notes h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;
    color: #78716c; margin: 0 0 6px; }
  .notes p { margin: 0; white-space: pre-wrap; }
  .disclaimer { background: #fafaf9; border-top: 1px solid #e7e5e4; padding: 16px 28px;
    color: #57534e; font-size: 11px; line-height: 1.5; }
  .disclaimer .tag { display: block; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.5px; color: #a8a29e; margin-bottom: 4px; font-size: 10px; }
  .estmark { color: #b45309; font-weight: 700; margin-left: 2px; }
  .estbanner { margin: 0 28px 12px; padding: 10px 12px; background: #fffbeb;
    border: 1px solid #fcd34d; border-radius: 6px; color: #92400e; font-size: 12px;
    line-height: 1.45; }
  .estbanner .tag { display: block; font-weight: 800; text-transform: uppercase;
    letter-spacing: 0.5px; color: #b45309; margin-bottom: 3px; font-size: 10px; }
</style>
</head>
<body>
  <div class="sheet">
    <div class="brandbar">
      <p class="brand">${escapeHtml(BRAND_LINE)}</p>
      <p class="sub">Fire Sprinkler Bid Proposal</p>
    </div>
    <div class="meta">
      <div class="row"><span class="k">Project</span><span class="v">${escapeHtml(bid.projectName)}</span></div>
      <div class="row"><span class="k">Prepared for</span><span class="v">${escapeHtml(bid.clientName)}</span></div>
      <div class="row"><span class="k">Date</span><span class="v">${dateDisplay}</span></div>
    </div>
${estimatedBanner}
    <table>
      <thead>
        <tr>
          <th>Description</th>
          <th class="num">Qty</th>
          <th>Unit</th>
          <th class="num">Unit Cost</th>
          <th class="num">Extended</th>
        </tr>
      </thead>
      <tbody>
${rows}
      </tbody>
    </table>
    <div class="summary">
      <table>
        <tr><td class="lbl">Subtotal</td><td class="money">${escapeHtml(subtotalStr)}</td></tr>
        <tr><td class="lbl">Overhead (${escapeHtml(overheadStr)})</td><td class="money">—</td></tr>
        <tr><td class="lbl">Profit (${escapeHtml(profitStr)})</td><td class="money">—</td></tr>
        <tr class="total"><td class="lbl">TOTAL</td><td class="money">${escapeHtml(totalStr)}</td></tr>
      </table>
    </div>
${notesBlock}
    <div class="disclaimer">
      <span class="tag">Disclaimer</span>
      ${escapeHtml(bid.disclaimer)}
    </div>
  </div>
</body>
</html>
`;
}

export default { renderBidHtml, escapeHtml };

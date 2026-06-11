import { describe, expect, it } from 'vitest';
import { renderBidHtml, escapeHtml } from '../src/autobid/bid-html.js';

// AB4 — W7B branded HTML bid renderer. Pure module; golden structural assertions
// + throws cases. No I/O.

const DISCLAIMER = 'This is a best-effort design-aid estimate and NOT a committed bid.';

function validBid(overrides = {}) {
  return {
    projectName: 'Warehouse Sprinkler ITB',
    clientName: 'Acme General Contractors',
    dateIso: '2026-06-11',
    items: [
      { description: 'Pendent sprinkler head', quantity: 42, unit: 'ea', unitCost: 12.5, extendedCost: 525 },
      { description: 'Branch pipe Sch 40', quantity: 300, unit: 'ft', unitCost: 4.115, extendedCost: 1234.5 },
    ],
    subtotal: 1759.5,
    overheadPct: 10,
    profitPct: 10,
    total: 2128.99,
    disclaimer: DISCLAIMER,
    ...overrides,
  };
}

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml('<a href="x">a & b\'c</a>')).toBe(
      '&lt;a href=&quot;x&quot;&gt;a &amp; b&#39;c&lt;/a&gt;',
    );
  });
  it('renders null/undefined as empty string', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});

describe('renderBidHtml — golden structure', () => {
  it('produces a complete standalone HTML document', () => {
    const html = renderBidHtml(validBid());
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('</html>');
    // Self-contained: inline CSS only, no external resources.
    expect(html).toContain('<style>');
    expect(html).not.toMatch(/<link[^>]+stylesheet/i);
    expect(html).not.toMatch(/<script/i);
  });

  it('renders the HALO FIRE PROTECTION brand line and the ember accent', () => {
    const html = renderBidHtml(validBid());
    expect(html).toContain('HALO FIRE PROTECTION');
    expect(html).toContain('#f0a868');
  });

  it('renders the project, client, and date', () => {
    const html = renderBidHtml(validBid());
    expect(html).toContain('Warehouse Sprinkler ITB');
    expect(html).toContain('Acme General Contractors');
    expect(html).toContain('2026-06-11');
  });

  it('formats currency via Intl as $1,234.50', () => {
    const html = renderBidHtml(validBid());
    expect(html).toContain('$1,234.50'); // extendedCost of the branch pipe line
    expect(html).toContain('$12.50'); // unitCost of the head line
  });

  it('escapes a <script> embedded in an item description', () => {
    const html = renderBidHtml(validBid({
      items: [
        { description: '<script>alert(1)</script>', quantity: 1, unit: 'ea', unitCost: 1, extendedCost: 1 },
      ],
    }));
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    // The raw, unescaped script tag must NOT appear in the output.
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('escapes an injection attempt in the project name', () => {
    const html = renderBidHtml(validBid({ projectName: 'Job "A" <b>& B</b>' }));
    expect(html).toContain('Job &quot;A&quot; &lt;b&gt;&amp; B&lt;/b&gt;');
  });

  it('renders the disclaimer VERBATIM in a distinct footer', () => {
    const html = renderBidHtml(validBid());
    expect(html).toContain('class="disclaimer"');
    expect(html).toContain(DISCLAIMER);
  });

  it('renders a bolded TOTAL row with the total currency', () => {
    const html = renderBidHtml(validBid());
    expect(html).toContain('class="total"');
    expect(html).toContain('TOTAL');
    expect(html).toContain('$2,128.99'); // total formatted via Intl
  });

  it('renders overhead and profit percentages in the summary', () => {
    const html = renderBidHtml(validBid({ overheadPct: 10, profitPct: 12.5 }));
    expect(html).toContain('Overhead (10%)');
    expect(html).toContain('Profit (12.5%)');
  });

  it('renders a notes paragraph when notes is provided', () => {
    const html = renderBidHtml(validBid({ notes: 'Excludes underground; permit by GC.' }));
    expect(html).toContain('class="notes"');
    expect(html).toContain('Excludes underground; permit by GC.');
  });

  it('omits the notes block entirely when notes is absent or blank', () => {
    expect(renderBidHtml(validBid())).not.toContain('class="notes"');
    expect(renderBidHtml(validBid({ notes: '   ' }))).not.toContain('class="notes"');
  });
});

describe('renderBidHtml — throws on bad input (fail-closed)', () => {
  it('throws on empty projectName', () => {
    expect(() => renderBidHtml(validBid({ projectName: '' }))).toThrow(/projectName/);
    expect(() => renderBidHtml(validBid({ projectName: '   ' }))).toThrow(/projectName/);
  });
  it('throws on empty clientName', () => {
    expect(() => renderBidHtml(validBid({ clientName: '' }))).toThrow(/clientName/);
  });
  it('throws on empty items', () => {
    expect(() => renderBidHtml(validBid({ items: [] }))).toThrow(/items/);
  });
  it('throws on a missing disclaimer', () => {
    expect(() => renderBidHtml(validBid({ disclaimer: '' }))).toThrow(/disclaimer/);
    const noDisc = validBid(); delete noDisc.disclaimer;
    expect(() => renderBidHtml(noDisc)).toThrow(/disclaimer/);
  });
  it('throws on a non-finite subtotal', () => {
    expect(() => renderBidHtml(validBid({ subtotal: NaN }))).toThrow(/subtotal/);
    expect(() => renderBidHtml(validBid({ subtotal: Infinity }))).toThrow(/subtotal/);
  });
  it('throws on a non-finite total', () => {
    expect(() => renderBidHtml(validBid({ total: NaN }))).toThrow(/total/);
  });
  it('throws on a non-finite overheadPct/profitPct', () => {
    expect(() => renderBidHtml(validBid({ overheadPct: NaN }))).toThrow(/overheadPct/);
    expect(() => renderBidHtml(validBid({ profitPct: NaN }))).toThrow(/profitPct/);
  });
  it('throws on a non-finite item money field', () => {
    expect(() => renderBidHtml(validBid({
      items: [{ description: 'x', quantity: 1, unit: 'ea', unitCost: NaN, extendedCost: 1 }],
    }))).toThrow(/unitCost/);
    expect(() => renderBidHtml(validBid({
      items: [{ description: 'x', quantity: 1, unit: 'ea', unitCost: 1, extendedCost: NaN }],
    }))).toThrow(/extendedCost/);
  });
  it('throws on a non-finite item quantity', () => {
    expect(() => renderBidHtml(validBid({
      items: [{ description: 'x', quantity: NaN, unit: 'ea', unitCost: 1, extendedCost: 1 }],
    }))).toThrow(/quantity/);
  });
});

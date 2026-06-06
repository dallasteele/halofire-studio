// store.ts W6 takeoff + bid: selectTakeoff / selectPricedBid live-recalc, the
// priceTable load action, and the window.__cad bid fields. Adding heads + routing
// changes bomLineCount and the bid total — live, over the persisted network.
//
// HONESTY: selectors are pure over the persisted network; no fabrication.

import { beforeEach, describe, expect, it } from 'vitest';
import { emptyProject } from '../src/lib/model';
import {
  EMPTY_SELECTION,
  selectPricedBid,
  selectTakeoff,
  useCadStore,
} from '../src/store';
import { parsePricebook, resolvePriceTable } from '../src/lib/bid';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function reset(): void {
  useCadStore.setState({
    project: emptyProject(),
    selection: { ...EMPTY_SELECTION },
    viewMode: 'split',
    activeTool: 'select',
    underlay: null,
    activeHeadSku: 'VK-A',
    supplyPoint: null,
    supply: null,
    designAreaSqFt: null,
    priceTable: null,
  });
}

function addRow(n: number, z: number, y = 10): void {
  for (let i = 0; i < n; i += 1) {
    useCadStore.getState().addHead({ x: i * 10, y, z }, 'VK-A');
  }
}

describe('selectTakeoff / selectPricedBid — live recalc', () => {
  beforeEach(reset);

  it('an empty network yields an empty BOM and a zero bid', () => {
    const t = selectTakeoff(useCadStore.getState());
    expect(t.lines).toHaveLength(0);
    const bid = selectPricedBid(useCadStore.getState());
    expect(bid.bomLines).toHaveLength(0);
    expect(bid.estimate.total).toBe(0);
  });

  it('adding heads + routing increases bomLineCount and the bid total (live)', () => {
    addRow(3, 0);
    useCadStore.getState().routeSystem();
    const before = selectPricedBid(useCadStore.getState());
    const beforeLines = before.bomLines.length;
    expect(beforeLines).toBeGreaterThan(0);
    expect(before.estimate.total).toBeGreaterThan(0);

    // Add a second row of heads and re-route — more heads + pipe -> higher total.
    addRow(3, 10);
    useCadStore.getState().routeSystem();
    const after = selectPricedBid(useCadStore.getState());
    expect(after.estimate.total).toBeGreaterThan(before.estimate.total);
    // The head count line reflects all 6 heads now.
    const headLines = after.bomLines.filter((l) => l.category === 'head');
    const heads = headLines.reduce((s, l) => s + l.qty, 0);
    expect(heads).toBe(6);
  });

  it('uses the real pricebook table when loaded (pricebook-median priceSource)', () => {
    addRow(3, 0);
    useCadStore.getState().routeSystem();
    // Without a table -> representative fallback.
    expect(selectPricedBid(useCadStore.getState()).estimate.priceSource).toBe('representative-fallback');

    // Load the real pricebook medians the app ships and resolve the table.
    const path = join(__dirname, '..', 'public', 'parts', 'pricebook-medians.json');
    const book = parsePricebook(JSON.parse(readFileSync(path, 'utf8')));
    useCadStore.setState({ priceTable: resolvePriceTable(book) });

    expect(selectPricedBid(useCadStore.getState()).estimate.priceSource).toBe('pricebook-median');
  });
});

describe('ensurePricebookLoaded', () => {
  beforeEach(reset);

  it('fail-softs to a representative table when the fetch fails', async () => {
    const failingFetch = (async () => ({ ok: false, status: 404 })) as unknown as typeof fetch;
    await useCadStore.getState().ensurePricebookLoaded(failingFetch);
    const table = useCadStore.getState().priceTable;
    expect(table).not.toBeNull();
    expect(table!.kind).toBe('representative');
  });
});

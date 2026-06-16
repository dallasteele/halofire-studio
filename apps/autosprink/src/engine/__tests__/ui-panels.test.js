import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCadModel, buildRoomCad } from '../cad-model.js';
import { generateSprinklerBid } from '../sprinkler-layout.js';
import { balanceNetwork } from '../hydraulics.js';
import { checkCompliance } from '../nfpa-compliance.js';
import { getBidTotal, getSubmittalData } from '../ui-panels.js';

const rect = (w, h) => [[0, 0], [w, 0], [w, h], [0, h]];

const floorPlan = {
  name: 'Panel Test Plant',
  units: 'ft',
  rooms: [
    { name: 'Bay 1', polygon: rect(60, 40), hazard: 'light', ceilingHeightFt: 14 },
  ],
};

const cadModel = buildCadModel(floorPlan);
const bid = generateSprinklerBid(floorPlan);
const roomCad = buildRoomCad({ name: 'Bay 1', polygon: rect(60, 40), hazard: 'light', ceilingHeightFt: 14 });
const hydraulics = balanceNetwork({ cadModel: roomCad, hazard: 'light' });
const compliance = checkCompliance(cadModel, 'light');

test('getSubmittalData builds deterministic submittal data from the engine payload', () => {
  const submittal = getSubmittalData({
    projectName: 'Panel Test Plant',
    floorPlan,
    bid,
    cadModel,
    hydraulics,
    compliance,
  });

  assert.ok(submittal);
  assert.equal(submittal.header.project, 'Panel Test Plant');
  assert.ok(Array.isArray(submittal.headSchedule));
  assert.ok(submittal.headSchedule.length > 0);
  assert.ok(Array.isArray(submittal.pipeSchedule));
  assert.ok(submittal.pipeSchedule.length > 0);
  assert.equal(submittal.bidSummary.total, bid.pricing.total);
  assert.equal(submittal.gateStatus.submittalReady, false);
});

test('getSubmittalData prefers balanced network hydraulics and ignores error-only compliance', () => {
  const submittal = getSubmittalData({
    projectName: 'Panel Test Plant',
    bid,
    cadModel,
    hydraulics: { error: 'single-path unavailable' },
    hydraulicNetwork: { requiredSourcePsi: 88, totalDemandGpm: 325, balanced: true },
    compliance: { error: 'no compliance payload' },
  });

  assert.ok(submittal);
  assert.equal(submittal.hydraulicSummary.requiredSourcePsi, 88);
  assert.equal(submittal.gateStatus.compliancePassed, null);
});

test('getBidTotal prefers full-scope totals and falls back to priced bid totals', () => {
  const fullScope = getBidTotal({
    bid,
    fullScopeBid: { fullScopeTotal: 42000 },
  });
  assert.deepEqual(fullScope, {
    amount: 42000,
    label: 'Full-scope estimate',
    source: 'full_scope_bid',
    estimated: true,
  });

  const priced = getBidTotal({ bid });
  assert.equal(priced.amount, bid.pricing.total);
  assert.match(priced.label, /Bare-materials total/);
  assert.equal(priced.source, 'bid_pricing');
});

test('getBidTotal returns null when no adapter totals exist', () => {
  assert.equal(getBidTotal({}), null);
});

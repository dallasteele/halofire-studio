import { describe, expect, it } from 'vitest';
import { buildCadModel, buildRoomCad } from '../src/engine/cad-model.js';
import { generateSprinklerBid } from '../src/engine/sprinkler-layout.js';
import { balanceNetwork } from '../src/engine/hydraulics.js';
import { checkCompliance } from '../src/engine/nfpa-compliance.js';
import {
  buildSubmittal,
  renderSubmittalPdf,
  SUBMITTAL_DISCLAIMER,
} from '../src/engine/submittal.js';

const rect = (w, h) => [[0, 0], [w, 0], [w, h], [0, h]];
const floorPlan = {
  name: 'Test Plant',
  units: 'ft',
  rooms: [
    { name: 'Bay', polygon: rect(60, 40), hazard: 'light', ceilingHeightFt: 14 },
    { name: 'Storage', polygon: rect(40, 30), hazard: 'ordinary', ceilingHeightFt: 16 },
  ],
};
const cadModel = buildCadModel(floorPlan);
const bid = generateSprinklerBid(floorPlan);
const roomCad = buildRoomCad({ name: 'Bay', polygon: rect(60, 40), hazard: 'light', ceilingHeightFt: 14 });
const hydraulics = balanceNetwork({ cadModel: roomCad, hazard: 'light' });
const compliance = checkCompliance(cadModel, 'ordinary');

const project = { name: 'Test Plant', client: 'ACME', address: '1 Main St' };

describe('buildSubmittal', () => {
  const pkg = buildSubmittal({ project, bid, cadModel, hydraulics, compliance });

  it('returns all required sections', () => {
    expect(pkg.header).toBeTruthy();
    expect(Array.isArray(pkg.headSchedule)).toBe(true);
    expect(Array.isArray(pkg.pipeSchedule)).toBe(true);
    expect(pkg.hydraulicSummary).toBeTruthy();
    expect(Array.isArray(pkg.billOfMaterials)).toBe(true);
    expect(pkg.gateStatus).toBeTruthy();
    expect(typeof pkg.disclaimer).toBe('string');
  });

  it('carries a best-effort / NOT-a-stamped-submittal disclaimer', () => {
    expect(pkg.disclaimer).toBe(SUBMITTAL_DISCLAIMER);
    expect(pkg.disclaimer.toLowerCase()).toContain('best-effort');
    expect(pkg.disclaimer.toLowerCase()).toContain('not');
    // explicitly disclaims the regulated readiness claims (negated, never asserted)
    expect(pkg.disclaimer.toLowerCase()).toContain('not a stamped');
    expect(pkg.disclaimer.toLowerCase()).toContain('not ahj-approved');
    expect(pkg.disclaimer.toLowerCase()).toContain('not pe-reviewed');
  });

  it('header carries project identity but makes no parity/AHJ claim', () => {
    expect(pkg.header.project).toBe('Test Plant');
    expect(pkg.header.client).toBe('ACME');
    expect(pkg.header.stamped).toBe(false);
    expect(pkg.header.ahjApproved).toBe(false);
    expect(pkg.header.peReviewed).toBe(false);
  });

  it('head schedule summarizes heads with counts', () => {
    const totalHeads = cadModel.solids.filter((s) => s.kind === 'head').length;
    const scheduled = pkg.headSchedule.reduce((n, r) => n + r.count, 0);
    expect(scheduled).toBe(totalHeads);
    expect(pkg.headSchedule.every((r) => typeof r.orientation === 'string')).toBe(true);
  });

  it('pipe schedule summarizes pipe lengths grouped by diameter', () => {
    expect(pkg.pipeSchedule.length).toBeGreaterThan(0);
    expect(pkg.pipeSchedule.every((r) => typeof r.diameterIn === 'number')).toBe(true);
    expect(pkg.pipeSchedule.every((r) => r.totalLengthFt >= 0)).toBe(true);
    expect(pkg.pipeSchedule.every((r) => r.count >= 1)).toBe(true);
  });

  it('hydraulic summary reflects the supplied balance result', () => {
    expect(pkg.hydraulicSummary.requiredSourcePsi).toBe(hydraulics.requiredSourcePsi);
    expect(pkg.hydraulicSummary.totalDemandGpm).toBe(hydraulics.totalDemandGpm);
    expect(pkg.hydraulicSummary.estimate).toBe(true);
  });

  it('bill of materials lists heads and pipe as best-effort takeoff items', () => {
    expect(pkg.billOfMaterials.length).toBeGreaterThan(0);
    expect(pkg.billOfMaterials.every((l) => typeof l.item === 'string' && l.qty >= 0)).toBe(true);
    const headLine = pkg.billOfMaterials.find((l) => /head/i.test(l.item));
    expect(headLine).toBeTruthy();
  });

  it('gateStatus reflects blocked gates (parity fail-closed) and is never cleared', () => {
    expect(pkg.gateStatus.autosprinkParity).toBe('blocked');
    expect(Array.isArray(pkg.gateStatus.blockedGates)).toBe(true);
    expect(pkg.gateStatus.blockedGates.length).toBeGreaterThan(0);
    expect(pkg.gateStatus.submittalReady).toBe(false);
  });

  it('reflects a failing compliance result in gateStatus', () => {
    const failing = checkCompliance(
      { heads: [[0, 0], [20, 0]].map(([x, y], i) => ({ x, y, row: 0, col: i })), spacingX: 20, spacingY: 20, coveragePerHeadSqFt: 400, bbox: { minX: 0, minY: 0, maxX: 20, maxY: 0 } },
      'ordinary',
    );
    const pkg2 = buildSubmittal({ project, bid, cadModel, hydraulics, compliance: failing });
    expect(pkg2.gateStatus.compliancePassed).toBe(failing.passed);
  });

  it('works without optional hydraulics/compliance (graceful)', () => {
    const pkg3 = buildSubmittal({ project, bid, cadModel });
    expect(pkg3.header).toBeTruthy();
    expect(pkg3.headSchedule.length).toBeGreaterThan(0);
    expect(pkg3.hydraulicSummary).toBeNull();
    expect(pkg3.gateStatus.autosprinkParity).toBe('blocked');
  });
});

describe('renderSubmittalPdf', () => {
  const pkg = buildSubmittal({ project, bid, cadModel, hydraulics, compliance });

  it('builds a generate_pdf_report payload and calls the injected invoker', async () => {
    let captured = null;
    const invoker = async (toolName, payload) => {
      captured = { toolName, payload };
      return { url: 'file:///tmp/submittal.pdf' };
    };
    const res = await renderSubmittalPdf(pkg, { invoker });
    expect(res.ok).toBe(true);
    expect(res.result.url).toBe('file:///tmp/submittal.pdf');
    expect(captured.toolName).toBe('generate_pdf_report');
    expect(captured.payload.title).toContain('Test Plant');
    expect(captured.payload.disclaimer).toBe(SUBMITTAL_DISCLAIMER);
    expect(Array.isArray(captured.payload.sections)).toBe(true);
    expect(captured.payload.sections.length).toBeGreaterThan(0);
  });

  it('accepts a single-arg invoker (payload only)', async () => {
    const invoker = async (payload) => ({ bytes: (payload.sections || []).length });
    const res = await renderSubmittalPdf(pkg, { invoker });
    expect(res.ok).toBe(true);
  });

  it('gracefully skips with no invoker (no throw)', async () => {
    const res = await renderSubmittalPdf(pkg, {});
    expect(res.ok).toBe(false);
    expect(res.skipped).toBe(true);
    expect(typeof res.reason).toBe('string');
  });

  it('gracefully skips with omitted opts (no throw)', async () => {
    const res = await renderSubmittalPdf(pkg);
    expect(res.ok).toBe(false);
    expect(res.skipped).toBe(true);
  });

  it('gracefully skips with a non-function invoker (no throw)', async () => {
    const res = await renderSubmittalPdf(pkg, { invoker: 'nope' });
    expect(res.ok).toBe(false);
    expect(res.skipped).toBe(true);
  });

  it('gracefully skips when the invoker throws (gateway down, no throw)', async () => {
    const invoker = async () => { throw new Error('pdf gateway unreachable'); };
    const res = await renderSubmittalPdf(pkg, { invoker });
    expect(res.ok).toBe(false);
    expect(res.skipped).toBe(true);
    expect(res.reason).toContain('pdf gateway unreachable');
  });
});

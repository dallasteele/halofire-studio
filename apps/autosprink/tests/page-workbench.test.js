import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(import.meta.dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'workbench.html'), 'utf8');

const overviewPayload = {
  user: { id: 7, name: 'Esther Sparks', username: 'esther', role: 'estimator' },
  report: { view: 'bid-performance', label: 'Open my bid performance', href: '/reports.html?view=bid-performance' },
  metrics: { jobs: 2, flagged: 1, tasks: 2, calendar: 2 },
  jobs: [
    {
      key: 'bid:11',
      entity_type: 'bid',
      entity_id: 11,
      title: 'Mesa Hangar Renovation',
      subtitle: 'Mesa GC · Wet',
      status: 'Pending',
      status_tone: 'flagged',
      date_label: '2026-06-18T17:00:00.000Z',
      amount: 64000,
      href: '/crm.html?bid=11',
      search_text: 'Mesa Hangar Renovation Mesa GC Wet Pending',
    },
    {
      key: 'bid:12',
      entity_type: 'bid',
      entity_id: 12,
      title: 'Phoenix Retail TI',
      subtitle: 'Copper State Builders · NFPA 13',
      status: 'Sent',
      status_tone: 'active',
      date_label: '2026-06-19T16:00:00.000Z',
      amount: 42000,
      href: '/crm.html?bid=12',
      search_text: 'Phoenix Retail TI Copper State Builders NFPA 13 Sent',
    },
  ],
  flagged_items: [
    {
      key: 'bid:11',
      entity_type: 'bid',
      entity_id: 11,
      title: 'Mesa Hangar Renovation',
      subtitle: 'Mesa GC · Wet',
      status: 'Pending',
      status_tone: 'flagged',
      summary: 'Mesa GC · Wet · Pending',
      review_label: 'Review',
      reviewed: false,
      reviewed_at: null,
      href: '/crm.html?bid=11',
    },
  ],
  tasks: [
    { key: 'task:bid:11', title: 'Review Mesa Hangar Renovation', detail: 'Mesa GC · Wet · Pending', kind: 'review', href: '/crm.html?bid=11' },
    { key: 'followup:bid:12', title: 'Check bid deadline', detail: 'Phoenix Retail TI · Sent', kind: 'followup', href: '/crm.html?bid=12' },
  ],
  calendar: [
    { key: 'calendar:bid:11', label: 'Mesa Hangar Renovation', detail: 'Mesa GC · Wet', starts_at: '2026-06-18T17:00:00.000Z', href: '/crm.html?bid=11', status: 'Pending' },
    { key: 'calendar:bid:12', label: 'Phoenix Retail TI', detail: 'Copper State Builders · NFPA 13', starts_at: '2026-06-19T16:00:00.000Z', href: '/crm.html?bid=12', status: 'Sent' },
  ],
};

async function createHarness() {
  const dom = new JSDOM(HTML, { url: 'http://127.0.0.1:3001/workbench.html' });
  const { createWorkbenchApp } = await import('../src/ui/workbench-page.js');
  const calls = [];
  const app = createWorkbenchApp({
    window: dom.window,
    document: dom.window.document,
    authGuard: async () => overviewPayload.user,
    api: async (pathname, init = {}) => {
      calls.push({ pathname, init });
      if (pathname === '/workbench/overview') {
        return structuredClone(overviewPayload);
      }
      if (pathname === '/workbench/reviews') {
        return {
          ok: true,
          review: {
            entity_type: init.body.entity_type,
            entity_id: init.body.entity_id,
            reviewed_at: '2026-06-17T12:00:00.000Z',
            reviewed_by: 'Esther Sparks',
            note: init.body.note,
          },
        };
      }
      throw new Error(`Unexpected API call: ${pathname}`);
    },
  });
  await app.load();
  return { dom, app, calls };
}

test('workbench page wires the role-aware report button and live job search', async () => {
  assert.match(HTML, /data-workbench-report-button/);
  assert.match(HTML, /type="module" src="\/src\/ui\/workbench-page\.js"/);

  const { dom } = await createHarness();
  const reportButton = dom.window.document.querySelector('[data-workbench-report-button]');
  const searchInput = dom.window.document.querySelector('[data-workbench-search]');

  assert.equal(reportButton.textContent.trim(), 'Open my bid performance');
  assert.equal(reportButton.dataset.reportView, 'bid-performance');

  assert.equal(dom.window.document.querySelectorAll('[data-workbench-jobs] .wb-job').length, 2);
  searchInput.value = 'mesa';
  searchInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal(dom.window.document.querySelectorAll('[data-workbench-jobs] .wb-job').length, 1);
  assert.match(dom.window.document.querySelector('[data-workbench-jobs]').textContent, /Mesa Hangar Renovation/);

  searchInput.value = 'missing';
  searchInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal(dom.window.document.querySelectorAll('[data-workbench-jobs] .wb-job').length, 0);
  assert.equal(dom.window.document.querySelector('[data-workbench-jobs-empty]').hidden, false);
  assert.match(dom.window.document.querySelector('[data-workbench-jobs-empty]').textContent, /No jobs match this filter/);
});

test('workbench review actions hit the API and update rendered state', async () => {
  const { dom, calls } = await createHarness();

  assert.match(dom.window.document.querySelector('[data-workbench-tasks]').textContent, /Review Mesa Hangar Renovation/);
  assert.match(dom.window.document.querySelector('[data-workbench-calendar]').textContent, /Phoenix Retail TI/);

  const reviewButton = dom.window.document.querySelector('[data-workbench-review]');
  reviewButton.click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const reviewCall = calls.find((call) => call.pathname === '/workbench/reviews');
  assert.ok(reviewCall, 'expected a review API call');
  assert.equal(reviewCall.init.method, 'POST');
  assert.deepEqual(reviewCall.init.body, {
    entity_type: 'bid',
    entity_id: 11,
    note: 'Reviewed from workbench',
  });

  const updatedButton = dom.window.document.querySelector('[data-workbench-review]');
  assert.equal(updatedButton.textContent.trim(), 'Reviewed');
  assert.equal(updatedButton.disabled, true);
  assert.match(dom.window.document.querySelector('[data-workbench-status]').textContent, /audit trail/);
});

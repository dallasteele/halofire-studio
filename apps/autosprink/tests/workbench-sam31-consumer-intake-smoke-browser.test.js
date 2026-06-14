import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3231;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'sam31-smoke-browser-pw';
const PROJECT_NAME = 'The Cooperative 1881 - Salt Lake City UT';
const PROJECT_PATH = `/api/projects/${encodeURIComponent(PROJECT_NAME)}`;

let server;
let tempDir;
let dbPath;
let browser;

async function waitForHealth() {
  const started = Date.now();
  while (Date.now() - started < 8000) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('server not healthy');
}

async function api(pathname, token, options = {}) {
  const response = await fetch(`${BASE}${pathname}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${pathname} failed ${response.status}: ${text}`);
  return body;
}

async function adminToken() {
  const body = await api('/api/auth/login', null, {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: PASSWORD }),
  });
  return body.token;
}

function insertConsumerReview(consumer) {
  const db = new Database(dbPath);
  const result = db.prepare(
    `INSERT INTO project_evidence (project_name, evidence_type, source_file, source_ref, status, notes)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    PROJECT_NAME,
    'openclaw_sam31_consumer_review',
    'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx',
    `${consumer}://sam31/reviews/browser-smoke-section-artifacts.json`,
    'present',
    JSON.stringify({
      kind: 'openclaw_sam31_consumer_review',
      review: {
        artifact_type: 'openclaw.sam31.consumer_review_task_decision.v1',
        source_application: 'halo_fire',
        source_pdf_boundary_evidence_id: 8810,
        source_openclaw_sam31_consumer_smoke_evidence_id: 8811,
        consumer,
        review_decision: 'replaced',
        accepted_queue_id: `browser-smoke-section-artifacts-${consumer}`,
        persisted_review_packet_ref: `openclaw://${consumer}/sam31/product-review/browser-smoke-section-artifacts`,
        replacement_ref: `${consumer}://sam31/reviews/browser-smoke-section-artifacts.json`,
        replacement_values: {
          sections: [{ id: `section-${consumer}`, semantic_label: `temporary_${consumer}_zone` }],
          object_hypotheses: [{ id: `object:${consumer}`, segment_id: `section-${consumer}` }],
          vector_overlays: [{ id: `vector:${consumer}` }],
          model_3d_candidates: [{ id: `model3d:${consumer}` }],
          source_ref: `${consumer}://sam31/temporary/browser-smoke-section-artifacts`,
        },
        blocked_claims: ['brand_ready', 'production_ready'],
        use_for_claims: false,
        no_claim_gates_cleared: true,
        claim_gate_effect: 'no_claims_cleared',
      },
    }),
  );
  db.close();
  return Number(result.lastInsertRowid);
}

async function seedSavedConsumerIntakeSmoke(token, { withFollowupReview = true } = {}) {
  const consumer = 'nameforge';
  const reviewEvidenceId = insertConsumerReview(consumer);
  const replacement = await api(`${PROJECT_PATH}/openclaw/sam31/actual-value-replacements`, token, {
    method: 'POST',
    body: JSON.stringify({
      source_openclaw_sam31_consumer_review_evidence_id: reviewEvidenceId,
      source_pdf_boundary_evidence_id: 8810,
      source_openclaw_sam31_consumer_smoke_evidence_id: 8811,
      consumer,
      source_file: 'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx',
      source_ref: 'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#NameForge!A1',
      replacement_values_source_ref: 'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#NameForge!A1',
      source_refs: [
        'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#NameForge!A1',
        'nameforge://employee/reviewed/browser-smoke-section.png',
      ],
      replacement_values: {
        sections: [{
          id: 'section-nameforge',
          semantic_label: 'reviewed_nameforge_zone',
          polygon: [[0, 0], [10, 0], [10, 8], [0, 8], [0, 0]],
          confidence: 0.76,
        }],
        object_hypotheses: [{
          id: 'object:nameforge',
          segment_id: 'section-nameforge',
          semantic_label: 'reviewed_nameforge_asset',
          confidence: 0.73,
        }],
        vector_overlays: [{
          id: 'vector:nameforge',
          segment_id: 'section-nameforge',
          svg_path: 'M 0 0 L 10 0 L 10 8 L 0 8 Z',
          source_refs: ['nameforge://employee/vector/browser-smoke-section.svg'],
        }],
        model_3d_candidates: [{
          id: 'model3d:nameforge',
          segment_id: 'section-nameforge',
          primitive: 'reviewed_nameforge_extrusion',
          source_refs: ['nameforge://employee/model/browser-smoke-section.glb'],
        }],
      },
    }),
  });
  const smoke = await api(`${PROJECT_PATH}/openclaw/sam31/section-to-artifacts-consumer-intake-smoke`, token, {
    method: 'POST',
    body: JSON.stringify({
      consumer,
      source_sam31_actual_value_replacement_evidence_id: replacement.evidence_id,
    }),
  });
  if (withFollowupReview) {
    await api(`${PROJECT_PATH}/openclaw/sam31/section-to-artifacts-consumer-intake-smoke/${smoke.evidence_id}/followup-packet/review`, token, {
      method: 'POST',
      body: JSON.stringify({
        review_decision: 'accepted_internal_alpha_followup',
        reviewer_name: 'HaloFire Browser Smoke',
        review_ref: 'halofire://sam31/consumer-intake-smoke/nameforge/browser-smoke-followup-review.json',
        marked_up_screenshot_ref: 'halofire://sam31/consumer-intake-smoke/nameforge/browser-smoke-followup.png',
        issue_decisions: [
          {
            issue_type: 'sam31_consumer_intake_room_boundary_visual_audit',
            supported_sprinkler_review_lane: 'room_boundary_visual_audit',
            decision: 'accepted_for_internal_alpha_room_boundary_review',
            reviewed_values: {
              corrected_room_polygons: [
                { room: 'Browser Smoke Area', polygon: [[0, 0], [10, 0], [10, 8], [0, 8]] },
              ],
            },
          },
        ],
        notes: 'Browser smoke prerequisite for source-linked sprinkler review packet download.',
      }),
    });
  }
  return smoke;
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-sam31-smoke-browser-'));
  dbPath = path.join(tempDir, 'h.db');
  server = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: 'test',
      HALOFIRE_DB_PATH: dbPath,
      JWT_SECRET: 'sam31-smoke-browser-jwt-secret-more-than-32-chars',
      HALOFIRE_ADMIN_USER: 'admin',
      HALOFIRE_ADMIN_PASSWORD: PASSWORD,
      HALOFIRE_ALLOW_DEV_DEFAULTS: '0',
      HALOFIRE_CORS_ORIGINS: 'http://allowed.test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  if (browser) await browser.close();
  if (server && !server.killed) {
    server.kill();
    await new Promise((resolve) => server.once('exit', resolve));
  }
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('Workbench SAM31 saved consumer intake smoke browser controls', () => {
  it('clicks from saved smoke evidence into filtered queue readback and HaloFire follow-up packets', async () => {
    const token = await adminToken();
    const smoke = await seedSavedConsumerIntakeSmoke(token);

    const page = await browser.newPage();
    page.setDefaultTimeout(10_000);
    await page.context().addCookies([{ name: 'halofire_session', value: token, url: BASE }]);
    try {
      await page.goto(`${BASE}/workbench.html`, { waitUntil: 'domcontentloaded' });
      await page.selectOption('#projectTarget', PROJECT_NAME);
      await page.locator(`#evidence-${smoke.evidence_id}`).waitFor();

      const openQueue = page.locator(`[data-sam31-section-to-artifacts-consumer-intake-smoke-open-queue="${smoke.evidence_id}"]`);
      expect(await openQueue.getAttribute('data-sam31-section-to-artifacts-consumer-intake-smoke-open-queue-consumer')).toBe('nameforge');
      expect(await openQueue.getAttribute('data-sam31-section-to-artifacts-consumer-intake-smoke-open-queue-href')).toBe(
        `/api/openclaw/sam31/actual-value-resolver-queue?projectName=${encodeURIComponent(PROJECT_NAME)}&consumer=nameforge&consumerIntakeSmokeEvidenceId=${smoke.evidence_id}`,
      );
      await openQueue.click();
      await page.waitForFunction(
        (evidenceId) => document.getElementById('sam31ActualValueQueue')?.dataset.sam31ConsumerIntakeSmokeEvidenceFilterId === evidenceId,
        String(smoke.evidence_id),
      );

      const queue = page.locator('#sam31ActualValueQueue');
      expect(await queue.getAttribute('data-sam31-consumer-intake-smoke-evidence-filter-id')).toBe(String(smoke.evidence_id));
      expect(await queue.getAttribute('data-sam31-consumer-filter')).toBe('nameforge');
      expect(await page.locator('#sam31ActualValueQueueStatus').getAttribute('data-sam31-consumer-intake-smoke-evidence-filter-id')).toBe(String(smoke.evidence_id));
      expect(await page.locator('#sam31ActualValueQueueSummary').innerText()).toContain(`consumer_intake_smoke_evidence_filter_id ${smoke.evidence_id}`);

      const readbackDownload = page.locator(`[data-sam31-section-to-artifacts-consumer-intake-smoke-queue-readback-download="${smoke.evidence_id}"]`);
      expect(await readbackDownload.getAttribute('data-sam31-section-to-artifacts-consumer-intake-smoke-queue-readback-href')).toBe(
        `/api/openclaw/sam31/actual-value-resolver-queue?projectName=${encodeURIComponent(PROJECT_NAME)}&consumer=nameforge&consumerIntakeSmokeEvidenceId=${smoke.evidence_id}`,
      );
      await readbackDownload.click();
      await page.waitForFunction(() => document.getElementById('sam31ActualValueQueueStatus')?.textContent?.includes('Downloaded filtered SAM31 queue readback from saved consumer intake smoke evidence'));

      const followup = page.locator(`[data-sam31-consumer-intake-smoke-followup-packet="${smoke.evidence_id}"]`).first();
      expect(await followup.getAttribute('data-sam31-consumer-intake-smoke-followup-packet-href')).toBe(
        `${PROJECT_PATH}/openclaw/sam31/section-to-artifacts-consumer-intake-smoke/${smoke.evidence_id}/followup-packet`,
      );
      await followup.click();
      await page.waitForFunction(() => document.getElementById('sam31ActualValueQueueStatus')?.textContent?.includes('Downloaded HaloFire SAM31 consumer intake smoke follow-up packet'));

      const sprinkler = page.locator(`[data-sam31-consumer-intake-smoke-sprinkler-review-packet="${smoke.evidence_id}"]`).first();
      expect(await sprinkler.getAttribute('data-sam31-consumer-intake-smoke-sprinkler-review-packet-href')).toBe(
        `${PROJECT_PATH}/openclaw/sam31/section-to-artifacts-consumer-intake-smoke/${smoke.evidence_id}/sprinkler-review-packet`,
      );
      await sprinkler.click();
      await page.waitForFunction(() => document.getElementById('sam31ActualValueQueueStatus')?.textContent?.includes('Downloaded HaloFire SAM31 consumer intake smoke sprinkler review packet'));
    } finally {
      await page.close();
    }
  }, 35_000);

  it('explains the saved follow-up review prerequisite before sprinkler review packets', async () => {
    const token = await adminToken();
    const smoke = await seedSavedConsumerIntakeSmoke(token, { withFollowupReview: false });

    const page = await browser.newPage();
    page.setDefaultTimeout(10_000);
    await page.context().addCookies([{ name: 'halofire_session', value: token, url: BASE }]);
    try {
      await page.goto(`${BASE}/workbench.html`, { waitUntil: 'domcontentloaded' });
      await page.selectOption('#projectTarget', PROJECT_NAME);
      await page.locator(`#evidence-${smoke.evidence_id}`).waitFor();

      const sprinkler = page.locator(`[data-sam31-consumer-intake-smoke-sprinkler-review-packet="${smoke.evidence_id}"]`).first();
      expect(await sprinkler.getAttribute('data-sam31-consumer-intake-smoke-sprinkler-review-prerequisite')).toBe('halofire_sam31_consumer_intake_smoke_followup_review_decision');
      await sprinkler.click();
      await page.waitForFunction(() => document.getElementById('sam31ActualValueQueueStatus')?.textContent?.includes('Save a HaloFire smoke follow-up review first'));
      const statusText = await page.locator('#sam31ActualValueQueueStatus').innerText();
      expect(statusText).toContain('halofire.sam31_consumer_intake_smoke_followup_review_decision.v1');
      expect(statusText).toContain('claim gates remain blocked');
    } finally {
      await page.close();
    }
  }, 35_000);
});

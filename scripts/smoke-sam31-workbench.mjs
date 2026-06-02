import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

import { COOPERATIVE_1881_PROJECT_NAME } from '../src/data/floorplans.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.HALOFIRE_SMOKE_PORT || 3371);
const BASE = `http://127.0.0.1:${PORT}`;
const PROJECT_PATH = `/api/projects/${encodeURIComponent(COOPERATIVE_1881_PROJECT_NAME)}`;
const PASSWORD = 'sam31-workbench-smoke-pw';
const OUT_DIR_REL = 'output/playwright';
const OUT_DIR = path.join(ROOT, ...OUT_DIR_REL.split('/'));

function log(message) {
  process.stdout.write(`[sam31-workbench-smoke] ${message}\n`);
}

async function request(pathname, token, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };
  const response = await fetch(`${BASE}${pathname}`, { ...options, headers });
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${pathname} failed ${response.status}: ${text}`);
  }
  return body;
}

async function waitForHealth() {
  const started = Date.now();
  while (Date.now() - started < 10_000) {
    try {
      await request('/api/health');
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw new Error('HaloFire API did not become healthy within 10s');
}

function startServer(tempDir) {
  return spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: 'test',
      HALOFIRE_DB_PATH: path.join(tempDir, 'h.db'),
      JWT_SECRET: 'sam31-workbench-smoke-jwt-secret-more-than-32-chars',
      HALOFIRE_ADMIN_USER: 'admin',
      HALOFIRE_ADMIN_PASSWORD: PASSWORD,
      HALOFIRE_ALLOW_DEV_DEFAULTS: '0',
      HALOFIRE_CORS_ORIGINS: 'http://allowed.test',
      OPENCLAW_BRIDGE_URL: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function seedSam31ReplayEvidence(token) {
  const candidate = {
    mode: 'outline',
    label: 'Wall-network outline',
    status: 'candidate',
    bbox: { minX: 0, minY: 0, maxX: 120, maxY: 80, widthFt: 120, heightFt: 80 },
    segmentCount: 12,
    areaSqft: 9600,
    method: 'wall-network-outline',
    blockedClaims: [
      'geometry_accuracy',
      'drawing_scale',
      'AHJ_approval',
      'PE_review',
      'AutoSprink_parity',
      'permit_ready',
      'fabrication_ready',
      'manufacturer_exact',
    ],
  };
  const boundary = await request(`${PROJECT_PATH}/pdf-boundary-decision`, token, {
    method: 'POST',
    body: JSON.stringify({
      pdfPageIndex: 7,
      pdfScale: 0.0833,
      pdfExtract: 'outline',
      candidate,
      source_file: 'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx',
      source_ref: '1881 plan PDF sheet 7 / outline candidate',
      notes: 'Browser smoke chose sheet 7 outline extraction; claims still blocked.',
    }),
  });

  const samResult = await request(`${PROJECT_PATH}/resolver-packets/pdf-boundary/${boundary.evidence.id}/sam31-visual-audit/results`, token, {
    method: 'POST',
    body: JSON.stringify({
      review_decision: 'corrected',
      reviewer_name: 'Halo Fire SAM smoke',
      sam31_result_ref: '1881://sam31/smoke-sheet-7-segmentation.json',
      screenshot_ref: '1881://sam31/smoke-sheet-7-overlay.png',
      console_log_ref: '1881://sam31/smoke-sheet-7-console.log',
      marked_up_plan_ref: '1881://marked-up/smoke-sheet-7-sam31-room-boundary.png',
      corrected_room_polygons: [
        {
          room_id: 'sam31-smoke-corridor',
          source_ref: '1881://sam31/smoke-sheet-7-segmentation.json',
          polygon: [[0, 0], [30, 0], [30, 10], [0, 10]],
        },
      ],
      issue_list: [
        {
          issue_type: 'sam31_visual_boundary_mismatch',
          severity: 'blocking',
          observed: 'SAM included annotation border.',
          expected: 'Only the corridor boundary.',
          required_action: 'Use corrected SAM review polygon for replay.',
        },
      ],
      openclaw_sam31_perception_packet: {
        artifact_type: 'openclaw.sam31_perception_packet',
        status: 'best_effort_perception_ready',
        project_ref: 'halo-fire:1881',
        application: 'halo_fire',
        source_runtime: 'sam-3.1+llm',
        perception_lanes: ['segmentation', 'object_identification', 'vector_overlay', 'model_3d_candidate', 'spatial_observation'],
        segments: [
          {
            id: 'seg-smoke-room',
            semantic_label: 'corridor',
            polygon: [[0, 0], [30, 0], [30, 10], [0, 10]],
            confidence: 0.91,
          },
        ],
        object_hypotheses: [
          {
            id: 'obj-smoke-sleeve',
            segment_id: 'seg-smoke-room',
            semantic_label: 'sleeve_or_penetration_candidate',
            confidence: 0.62,
          },
        ],
        vector_overlays: [
          {
            id: 'vector:seg-smoke-room',
            segment_id: 'seg-smoke-room',
            kind: 'polygon_path',
            svg_path: 'M 0 0 L 30 0 L 30 10 L 0 10 Z',
            confidence: 0.73,
          },
        ],
        model_3d_candidates: [
          {
            id: 'model3d:seg-smoke-room',
            segment_id: 'seg-smoke-room',
            primitive: 'extruded_polygon',
            height_ft: 10,
            confidence: 0.46,
          },
        ],
        extrapolation_contract: {
          artifact_type: 'openclaw.sam31_extrapolation_contract',
          status: 'best_effort_extrapolation_ready',
          source_runtime: 'sam-3.1+llm',
          consumes: ['segments', 'object_hypotheses'],
          produces: ['llm_observations', 'vector_overlays', 'model_3d_candidates'],
          supported_applications: ['halo_fire', 'landscout', 'nameforge'],
          temporary_value_policy: 'Generated object labels, vector overlays, and 3D candidates are editable best guesses until HaloFire employees or owning product reviewers replace them with actual values.',
          claim_gate_effect: 'no_claims_cleared',
        },
        application_contracts: {
          halo_fire: {
            application: 'halo_fire',
            contract_ref: 'openclaw.sam31.application_contract.halo_fire.v1',
            supported_evidence_lanes: [
              'room_boundary_visual_audit',
              'sleeve_or_firestop_candidate_review',
              'obstruction_or_clash_review',
              'vector_overlay_generation',
              'model_3d_candidate_generation',
            ],
            temporary_value_policy: 'best_guess_until_employee_replaced',
            acceptable_human_updates: [
              'semantic_label',
              'polygon',
              'bbox',
              'object_hypothesis',
              'vector_overlay',
              'model_3d_candidate',
              'source_ref',
              'confidence',
            ],
            blocked_claims: ['geometry_accuracy', 'permit_ready', 'AHJ_approval', 'AutoSprink_parity', 'fabrication_ready', 'manufacturer_exact'],
            claim_gate_effect: 'no_claims_cleared',
          },
        },
        perception_summary: {
          artifact_type: 'openclaw.sam31_perception_summary',
          status: 'best_effort_perception_ready',
          project_ref: 'halo-fire:1881',
          application: 'halo_fire',
          source_runtime: 'sam-3.1+llm',
          claim_gate_effect: 'no_claims_cleared',
          perception_lanes: ['segmentation', 'object_identification', 'vector_overlay', 'model_3d_candidate', 'spatial_observation'],
          segment_count: 1,
          object_hypothesis_count: 1,
          vector_overlay_count: 1,
          model_3d_candidate_count: 1,
          spatial_observation_count: 0,
          blocked_claims: ['geometry_accuracy', 'permit_ready', 'AutoSprink_parity'],
          extrapolation_contract_ref: 'openclaw.sam31_extrapolation_contract',
          application_contract_refs: ['openclaw.sam31.application_contract.halo_fire.v1'],
          next_action: 'Use this summary to queue HaloFire room-boundary replay; do not promote blocked claims.',
        },
        blocked_claims: ['geometry_accuracy', 'permit_ready', 'AutoSprink_parity'],
        claim_gate_effect: 'no_claims_cleared',
      },
      notes: 'Browser smoke SAM 3.1 result persisted for internal-alpha correction only.',
    }),
  });

  return { boundary, samResult };
}

async function runBrowserSmoke(token, evidenceIds) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
  } catch {
    browser = await chromium.launch({ headless: true });
  }
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1440, height: 1100 },
  });
  const page = await context.newPage();
  const downloads = [];
  try {
    await page.addInitScript((authToken) => {
      localStorage.setItem('halofire_token', authToken);
    }, token);
    await page.goto(`${BASE}/workbench.html`, { waitUntil: 'networkidle' });
    await page.selectOption('#projectTarget', COOPERATIVE_1881_PROJECT_NAME);
    await page.waitForSelector('text=SAM31 perception summary', { timeout: 8_000 });
    await page.waitForSelector('text=object_hypothesis_count 1', { timeout: 8_000 });
    await page.waitForSelector('text=model_3d_candidate_count 1', { timeout: 8_000 });
    await page.waitForSelector('text=SAM31 HaloFire application contract', { timeout: 8_000 });
    await page.waitForSelector('text=openclaw.sam31.application_contract.halo_fire.v1', { timeout: 8_000 });
    await page.waitForSelector('text=sleeve_or_firestop_candidate_review', { timeout: 8_000 });
    await page.waitForSelector('text=acceptable_human_updates', { timeout: 8_000 });
    await page.waitForSelector('text=best_guess_until_employee_replaced', { timeout: 8_000 });
    await page.waitForSelector('text=no_claims_cleared', { timeout: 8_000 });
    await page.waitForSelector('text=Download full SAM31 packet', { timeout: 8_000 });

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download full SAM31 packet' }).first().click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    const suggestedName = download.suggestedFilename();
    const downloadBytes = downloadPath ? fs.statSync(downloadPath).size : 0;
    downloads.push({ suggestedName, bytes: downloadBytes });
    if (!suggestedName.includes('sam31-room-boundary-visual-audit-packet') || downloadBytes <= 0) {
      throw new Error(`Unexpected SAM31 packet download ${suggestedName} (${downloadBytes} bytes)`);
    }

    const screenshotPath = path.join(OUT_DIR, `halofire-sam31-workbench-${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    const sha256 = crypto.createHash('sha256').update(fs.readFileSync(screenshotPath)).digest('hex');
    return {
      ok: true,
      url: page.url(),
      screenshotPath,
      screenshotSha256: `sha256:${sha256}`,
      evidenceIds,
      downloads,
      claim_gate_effect: 'no_claims_cleared',
    };
  } finally {
    await page.close();
    await context.close();
    await browser.close();
  }
}

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-sam31-workbench-smoke-'));
  const server = startServer(tempDir);
  let stdout = '';
  let stderr = '';
  server.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  server.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  try {
    await waitForHealth();
    const login = await request('/api/auth/login', null, {
      method: 'POST',
      body: JSON.stringify({ username: 'admin', password: PASSWORD }),
    });
    const token = login.token;
    const seeded = await seedSam31ReplayEvidence(token);
    const smoke = await runBrowserSmoke(token, {
      boundaryEvidenceId: seeded.boundary.evidence.id,
      sam31EvidenceId: seeded.samResult.evidence.id,
    });
    log(JSON.stringify(smoke, null, 2));
  } finally {
    if (!server.killed) {
      server.kill();
      await new Promise((resolve) => server.once('exit', resolve));
    }
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    if (stderr.trim()) log(`server stderr tail: ${stderr.trim().split('\n').slice(-6).join('\n')}`);
    if (stdout.trim()) log(`server stdout tail: ${stdout.trim().split('\n').slice(-3).join('\n')}`);
  }
}

main().catch((error) => {
  process.stderr.write(`[sam31-workbench-smoke] FAILED ${error.stack || error.message}\n`);
  process.exitCode = 1;
});

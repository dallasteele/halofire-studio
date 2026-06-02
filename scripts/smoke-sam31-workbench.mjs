import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

import { COOPERATIVE_1881_PROJECT_NAME } from '../src/data/floorplans.js';
import { createSam31BridgeApp } from '../src/sam31/bridge.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.HALOFIRE_SMOKE_PORT || 3371);
const BASE = `http://127.0.0.1:${PORT}`;
const PROJECT_PATH = `/api/projects/${encodeURIComponent(COOPERATIVE_1881_PROJECT_NAME)}`;
const SAM31_BRIDGE_SMOKE_ROUTE_SUFFIX = '/openclaw/sam31/smoke-artifact';
const SAM31_BRIDGE_SMOKE_SELECTOR = '[data-sam31-bridge-smoke-evidence-id]';
const SAM31_BRIDGE_SMOKE_STATUS_PREFIX = 'sam31BridgeSmokeStatus';
const SAM31_BRIDGE_SMOKE_WORKBENCH_HANDLER = 'runSam31BridgeSmokeArtifact';
const SAM31_BRIDGE_SMOKE_EVIDENCE_TYPE = 'openclaw_sam31_bridge_smoke_artifact';
const SAM31_REPLACEMENTS_ROUTE_SUFFIX = '/sam31-replacements';
const SAM31_REPLACEMENTS_RECORDED_STATUS = 'sam31_replacements_recorded';
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

function startServer(tempDir, bridgeBaseUrl) {
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
      OPENCLAW_BRIDGE_URL: bridgeBaseUrl,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function startSam31Bridge() {
  const app = createSam31BridgeApp();
  let server;
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('SAM31 bridge did not expose a TCP address');
  }
  return {
    server,
    bridgeBaseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function closeHttpServer(server) {
  if (!server) return;
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function seedOpenClawSam31LocalBridgeExtrapolation(token, boundaryEvidenceId) {
  return request(`${PROJECT_PATH}/resolver-packets/pdf-boundary/${boundaryEvidenceId}/openclaw/sam31/extrapolation-artifact`, token, {
    method: 'POST',
    body: JSON.stringify({}),
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

  const localBridgeExtrapolation = await seedOpenClawSam31LocalBridgeExtrapolation(token, boundary.evidence.id);

  return { boundary, samResult, localBridgeExtrapolation };
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
    await page.waitForSelector('text=Replace temporary SAM31 values', { timeout: 8_000 });
    await page.waitForSelector('text=OpenClaw SAM31 bridge smoke artifact', { timeout: 8_000 });
    await page.waitForSelector(SAM31_BRIDGE_SMOKE_SELECTOR, { timeout: 8_000 });
    await page.waitForSelector('[id^="sam31BridgeSmokeStatus-"]', { state: 'attached', timeout: 8_000 });
    await page.waitForSelector('text=SAM31 1881 bid truth', { timeout: 8_000 });
    await page.waitForSelector('text=head_count 1420', { timeout: 8_000 });
    await page.waitForSelector('text=square_feet 170654', { timeout: 8_000 });
    await page.waitForSelector('text=bid_total 538792.35', { timeout: 8_000 });
    await page.waitForSelector('text=SAM31 missing evidence rows', { timeout: 8_000 });
    await page.waitForSelector('text=HALOFIRE_1881_ROOM_BOUNDARY_EMPLOYEE_REVIEW_MISSING', { timeout: 8_000 });
    await page.waitForSelector('text=HALOFIRE_1881_PROFESSIONAL_AHJ_APPROVAL_MISSING', { timeout: 8_000 });
    await page.waitForSelector('text=Download SAM31 queue item', { timeout: 8_000 });

    const queueDownloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download SAM31 queue item' }).first().click();
    const queueDownload = await queueDownloadPromise;
    const queueDownloadPath = await queueDownload.path();
    const queueSuggestedName = queueDownload.suggestedFilename();
    const queueDownloadBytes = queueDownloadPath ? fs.statSync(queueDownloadPath).size : 0;
    downloads.push({ suggestedName: queueSuggestedName, bytes: queueDownloadBytes });
    if (!queueSuggestedName.includes('sam31-product-review-queue-item') || queueDownloadBytes <= 0) {
      throw new Error(`Unexpected SAM31 queue item download ${queueSuggestedName} (${queueDownloadBytes} bytes)`);
    }
    const queueItem = JSON.parse(fs.readFileSync(queueDownloadPath, 'utf8'));
    if (queueItem.artifact_type !== 'openclaw.sam31.product_review_queue_item.v1') {
      throw new Error(`Unexpected SAM31 queue item artifact type ${queueItem.artifact_type}`);
    }
    const missingEvidenceCodes = Array.isArray(queueItem.missing_evidence_rows)
      ? queueItem.missing_evidence_rows.map((row) => row.code)
      : [];
    if (!missingEvidenceCodes.includes('HALOFIRE_1881_ROOM_BOUNDARY_EMPLOYEE_REVIEW_MISSING')) {
      throw new Error('SAM31 queue item is missing the room-boundary employee review evidence row');
    }
    if (!missingEvidenceCodes.includes('HALOFIRE_1881_PROFESSIONAL_AHJ_APPROVAL_MISSING')) {
      throw new Error('SAM31 queue item is missing the professional/AHJ approval evidence row');
    }
    if (queueItem.use_for_claims !== false || queueItem.claim_gate_effect !== 'no_claims_cleared') {
      throw new Error(`SAM31 queue item cleared a claim gate: ${queueItem.claim_gate_effect}`);
    }
    await page.waitForSelector('text=OpenClaw SAM31 consumer queue smoke', { timeout: 8_000 });
    await page.waitForSelector('[data-sam31-consumer-smoke-evidence-id]', { timeout: 8_000 });
    await page.waitForSelector('[id^="sam31ConsumerSmokeStatus-"]', { state: 'attached', timeout: 8_000 });
    await page.getByRole('button', { name: 'Run LandScout/NameForge SAM31 queue smoke' }).first().click();
    await page.waitForSelector('text=openclaw_sam31_consumer_smoke_artifact evidence', { timeout: 8_000 });
    await page.waitForSelector('text=Latest consumer smoke', { timeout: 8_000 });
    await page.waitForSelector('text=posted_consumer_count', { timeout: 8_000 });
    await page.waitForSelector('text=blocked_consumer_count', { timeout: 8_000 });
    await page.waitForSelector('text=posted_consumer_count 2', { timeout: 8_000 });
    await page.waitForSelector('text=blocked_consumer_count 0', { timeout: 8_000 });
    await page.waitForSelector('text=openclaw.sam31.consumer_smoke_artifact.v1', { timeout: 8_000 });
    await page.waitForSelector('text=consumer_result', { timeout: 8_000 });
    await page.waitForSelector('text=accepted_queue_id', { timeout: 8_000 });
    await page.waitForSelector('text=persisted_review_packet_ref', { timeout: 8_000 });
    await page.waitForSelector('text=consumer_review_tasks', { timeout: 8_000 });
    await page.waitForSelector('text=openclaw.sam31.consumer_review_task.v1', { timeout: 8_000 });
    await page.waitForSelector('text=requires_product_review', { timeout: 8_000 });
    await page.waitForSelector('text=acceptable_evidence', { timeout: 8_000 });
    await page.waitForSelector('text=no_claims_cleared', { timeout: 8_000 });
    await page.waitForSelector('[data-sam31-consumer-smoke-packet-evidence-id]', { timeout: 8_000 });
    const consumerSmokeDownloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download SAM31 consumer smoke packet' }).first().click();
    const consumerSmokeDownload = await consumerSmokeDownloadPromise;
    const consumerSmokePath = await consumerSmokeDownload.path();
    const consumerSmokeSuggestedName = consumerSmokeDownload.suggestedFilename();
    const consumerSmokeDownloadBytes = consumerSmokePath ? fs.statSync(consumerSmokePath).size : 0;
    downloads.push({ suggestedName: consumerSmokeSuggestedName, bytes: consumerSmokeDownloadBytes });
    if (!consumerSmokeSuggestedName.includes('sam31-consumer-smoke-artifact') || consumerSmokeDownloadBytes <= 0) {
      throw new Error(`Unexpected SAM31 consumer smoke download ${consumerSmokeSuggestedName} (${consumerSmokeDownloadBytes} bytes)`);
    }
    const consumerSmokeArtifact = JSON.parse(fs.readFileSync(consumerSmokePath, 'utf8'));
    if (consumerSmokeArtifact.artifact_type !== 'openclaw.sam31.consumer_smoke_artifact.v1') {
      throw new Error(`Unexpected SAM31 consumer smoke artifact type ${consumerSmokeArtifact.artifact_type}`);
    }
    if (consumerSmokeArtifact.posted_consumer_count !== 2) {
      throw new Error(`Expected posted_consumer_count 2, got ${consumerSmokeArtifact.posted_consumer_count}`);
    }
    if (consumerSmokeArtifact.blocked_consumer_count !== 0) {
      throw new Error(`Expected blocked_consumer_count 0, got ${consumerSmokeArtifact.blocked_consumer_count}`);
    }
    if (consumerSmokeArtifact.use_for_claims !== false || consumerSmokeArtifact.claim_gate_effect !== 'no_claims_cleared') {
      throw new Error(`SAM31 consumer smoke cleared a claim gate: ${consumerSmokeArtifact.claim_gate_effect}`);
    }
    const consumerSmokeResults = Array.isArray(consumerSmokeArtifact.consumer_results)
      ? consumerSmokeArtifact.consumer_results
      : [];
    const consumerReviewTasks = Array.isArray(consumerSmokeArtifact.consumer_review_tasks)
      ? consumerSmokeArtifact.consumer_review_tasks
      : [];
    for (const consumer of ['landscout', 'nameforge']) {
      const result = consumerSmokeResults.find((item) => item.consumer === consumer);
      if (!result || result.status !== 'posted' || result.response_status !== 202) {
        throw new Error(`SAM31 consumer smoke did not post ${consumer}: ${JSON.stringify(result)}`);
      }
      if (!result.accepted_queue_id || !String(result.accepted_queue_id).startsWith(`sam31-${consumer}-`)) {
        throw new Error(`SAM31 consumer smoke ${consumer} is missing accepted_queue_id: ${JSON.stringify(result)}`);
      }
      if (!result.persisted_review_packet_ref || !String(result.persisted_review_packet_ref).startsWith(`openclaw://${consumer}/sam31/product-review/`)) {
        throw new Error(`SAM31 consumer smoke ${consumer} is missing persisted_review_packet_ref: ${JSON.stringify(result)}`);
      }
      const task = consumerReviewTasks.find((item) => item.consumer === consumer);
      if (!task || task.artifact_type !== 'openclaw.sam31.consumer_review_task.v1' || task.status !== 'requires_product_review') {
        throw new Error(`SAM31 consumer smoke ${consumer} is missing consumer_review_task: ${JSON.stringify(task)}`);
      }
      if (task.accepted_queue_id !== result.accepted_queue_id) {
        throw new Error(`SAM31 consumer task ${consumer} accepted_queue_id mismatch: ${JSON.stringify(task)}`);
      }
      if (task.persisted_review_packet_ref !== result.persisted_review_packet_ref) {
        throw new Error(`SAM31 consumer task ${consumer} persisted_review_packet_ref mismatch: ${JSON.stringify(task)}`);
      }
      if (!Array.isArray(task.acceptable_evidence) || task.acceptable_evidence.length < 3) {
        throw new Error(`SAM31 consumer task ${consumer} lacks acceptable_evidence: ${JSON.stringify(task)}`);
      }
      if (task.use_for_claims !== false || task.claim_gate_effect !== 'no_claims_cleared') {
        throw new Error(`SAM31 consumer task ${consumer} cleared a claim gate: ${JSON.stringify(task)}`);
      }
    }
    const consumerReviewTask = consumerReviewTasks.find((task) => task.consumer === 'landscout');
    if (!consumerReviewTask) {
      throw new Error('SAM31 consumer smoke did not expose a LandScout consumer review task');
    }
    await page.waitForSelector('text=Save SAM31 consumer review decision', { timeout: 8_000 });
    const consumerReviewButtonSelector = `button[data-sam31-consumer-review-save-evidence-id="${evidenceIds.boundaryEvidenceId}"][data-sam31-consumer="landscout"]`;
    await page.locator(consumerReviewButtonSelector).evaluate((button) => {
      button.closest('details')?.setAttribute('open', '');
    });
    await page.waitForSelector('[id^="sam31ConsumerReviewStatus-"]', { state: 'attached', timeout: 8_000 });
    await page.locator(`#sam31ConsumerReviewReviewer-${evidenceIds.boundaryEvidenceId}-landscout`).fill('LandScout product owner smoke');
    await page.locator(`#sam31ConsumerReviewReplacementRef-${evidenceIds.boundaryEvidenceId}-landscout`).fill('landscout://sam31/reviews/smoke-landscout/replacement.json');
    await page.locator(`#sam31ConsumerReviewScreenshotRef-${evidenceIds.boundaryEvidenceId}-landscout`).fill('landscout://sam31/reviews/smoke-landscout/screenshot.png');
    await page.locator(`#sam31ConsumerReviewConsoleLogRef-${evidenceIds.boundaryEvidenceId}-landscout`).fill('landscout://sam31/reviews/smoke-landscout/console.log');
    await page.locator(`#sam31ConsumerReviewReplacementValues-${evidenceIds.boundaryEvidenceId}-landscout`).fill(JSON.stringify({
      semantic_labels: ['reviewed parcel frontage', 'reviewed access lane'],
      object_hypotheses: [{ id: 'landscout-object-smoke', semantic_label: 'parcel_access_candidate', confidence: 0.78 }],
      vector_overlays: [{ id: 'landscout-vector-smoke', kind: 'polyline', source_ref: 'landscout://sam31/reviews/smoke-landscout/vector.svg' }],
      model_3d_candidates: [{ id: 'landscout-model-smoke', primitive: 'extruded_site_area', source_ref: 'landscout://sam31/reviews/smoke-landscout/model.glb' }],
      source_ref: 'landscout://sam31/reviews/smoke-landscout/reviewer-values.json',
      confidence: 0.82,
    }));
    await page.locator(`#sam31ConsumerReviewNotes-${evidenceIds.boundaryEvidenceId}-landscout`).fill('Smoke saved product owner review note tied to accepted queue id.');
    await page.locator(consumerReviewButtonSelector).click();
    await page.waitForSelector('text=openclaw_sam31_consumer_review evidence', { timeout: 8_000 });
    await page.waitForSelector('text=openclaw.sam31.consumer_review_task_decision.v1', { timeout: 8_000 });
    await page.waitForSelector('text=Latest landscout review', { timeout: 8_000 });
    await page.waitForSelector('text=no_claims_cleared', { timeout: 8_000 });
    const queueAfterConsumerReview = await request(`${PROJECT_PATH}/resolver-queue`, token);
    const reviewedQueueItem = queueAfterConsumerReview.items.find((item) => item.evidence_id === evidenceIds.boundaryEvidenceId);
    const consumerReview = reviewedQueueItem?.latest_openclaw_sam31_consumer_reviews?.find((review) => review.consumer === 'landscout');
    if (!consumerReview || consumerReview.artifact_type !== 'openclaw.sam31.consumer_review_task_decision.v1') {
      throw new Error(`SAM31 LandScout review decision was not persisted: ${JSON.stringify(consumerReview)}`);
    }
    if (consumerReview.accepted_queue_id !== consumerReviewTask.accepted_queue_id) {
      throw new Error(`SAM31 LandScout review accepted_queue_id mismatch: ${JSON.stringify(consumerReview)}`);
    }
    if (consumerReview.persisted_review_packet_ref !== consumerReviewTask.persisted_review_packet_ref) {
      throw new Error(`SAM31 LandScout review packet ref mismatch: ${JSON.stringify(consumerReview)}`);
    }
    if (consumerReview.claim_gate_effect !== 'no_claims_cleared') {
      throw new Error(`SAM31 LandScout review cleared a claim gate: ${JSON.stringify(consumerReview)}`);
    }
    await page.waitForSelector('text=Download SAM31 consumer review decision', { timeout: 8_000 });
    const consumerReviewDownloadPromise = page.waitForEvent('download');
    await page.locator(`button[data-sam31-consumer-review-packet-evidence-id="${consumerReview.evidence_id}"]`).click();
    const consumerReviewDownload = await consumerReviewDownloadPromise;
    const consumerReviewPath = await consumerReviewDownload.path();
    const consumerReviewSuggestedName = consumerReviewDownload.suggestedFilename();
    const consumerReviewDownloadBytes = consumerReviewPath ? fs.statSync(consumerReviewPath).size : 0;
    downloads.push({ suggestedName: consumerReviewSuggestedName, bytes: consumerReviewDownloadBytes });
    if (!consumerReviewSuggestedName.includes('sam31-consumer-review-decision') || consumerReviewDownloadBytes <= 0) {
      throw new Error(`Unexpected SAM31 consumer review decision download ${consumerReviewSuggestedName} (${consumerReviewDownloadBytes} bytes)`);
    }
    const consumerReviewPacket = JSON.parse(fs.readFileSync(consumerReviewPath, 'utf8'));
    if (consumerReviewPacket.artifact_type !== 'openclaw.sam31.consumer_review_decision_packet.v1') {
      throw new Error(`Unexpected SAM31 consumer review decision packet type ${consumerReviewPacket.artifact_type}`);
    }
    if (consumerReviewPacket.accepted_queue_id !== consumerReview.accepted_queue_id) {
      throw new Error(`SAM31 consumer review packet accepted_queue_id mismatch: ${JSON.stringify(consumerReviewPacket)}`);
    }
    if (consumerReviewPacket.claim_gate_effect !== 'no_claims_cleared') {
      throw new Error(`SAM31 consumer review packet cleared a claim gate: ${consumerReviewPacket.claim_gate_effect}`);
    }
    await page.waitForSelector('text=Download SAM31 sprinkler review adapter', { timeout: 8_000 });
    const sprinklerAdapterDownloadPromise = page.waitForEvent('download');
    await page.locator(`button[data-sam31-sprinkler-review-adapter-evidence-id="${consumerReview.evidence_id}"]`).click();
    const sprinklerAdapterDownload = await sprinklerAdapterDownloadPromise;
    const sprinklerAdapterPath = await sprinklerAdapterDownload.path();
    const sprinklerAdapterSuggestedName = sprinklerAdapterDownload.suggestedFilename();
    const sprinklerAdapterDownloadBytes = sprinklerAdapterPath ? fs.statSync(sprinklerAdapterPath).size : 0;
    downloads.push({ suggestedName: sprinklerAdapterSuggestedName, bytes: sprinklerAdapterDownloadBytes });
    if (!sprinklerAdapterSuggestedName.includes('sam31-to-sprinkler-review') || sprinklerAdapterDownloadBytes <= 0) {
      throw new Error(`Unexpected SAM31 sprinkler review adapter download ${sprinklerAdapterSuggestedName} (${sprinklerAdapterDownloadBytes} bytes)`);
    }
    const sprinklerAdapterPacket = JSON.parse(fs.readFileSync(sprinklerAdapterPath, 'utf8'));
    if (sprinklerAdapterPacket.artifact_type !== 'openclaw.sam31_to_sprinkler_review_adapter.v1') {
      throw new Error(`Unexpected SAM31 sprinkler review adapter type ${sprinklerAdapterPacket.artifact_type}`);
    }
    if (sprinklerAdapterPacket.sprinkler_review_packet?.artifact_type !== 'halofire.sam31_sprinkler_review_packet.v1') {
      throw new Error(`Unexpected HaloFire sprinkler review packet type ${sprinklerAdapterPacket.sprinkler_review_packet?.artifact_type}`);
    }
    if (sprinklerAdapterPacket.claim_gate_effect !== 'no_claims_cleared' || sprinklerAdapterPacket.use_for_claims !== false) {
      throw new Error(`SAM31 sprinkler review adapter cleared a claim gate: ${JSON.stringify(sprinklerAdapterPacket)}`);
    }
    if (!Array.isArray(sprinklerAdapterPacket.supported_sprinkler_review_lanes) || !sprinklerAdapterPacket.supported_sprinkler_review_lanes.includes('obstruction_or_clash_review')) {
      throw new Error(`SAM31 sprinkler review adapter missing sprinkler review lanes: ${JSON.stringify(sprinklerAdapterPacket.supported_sprinkler_review_lanes)}`);
    }
    const unresolvedNameForge = await request(`${PROJECT_PATH}/resolver-queue?sam31ConsumerReview=unresolved&consumer=nameforge`, token);
    const unresolvedItem = unresolvedNameForge.items.find((item) => item.evidence_id === evidenceIds.boundaryEvidenceId);
    const unresolvedNameForgeReviews = unresolvedItem?.sam31_unresolved_consumer_reviews || [];
    if (!unresolvedNameForgeReviews.some((review) => review.consumer === 'nameforge')) {
      throw new Error(`SAM31 unresolved NameForge review filter did not return NameForge: ${JSON.stringify(unresolvedNameForge)}`);
    }
    if (unresolvedNameForgeReviews.some((review) => review.consumer === 'landscout')) {
      throw new Error(`SAM31 unresolved NameForge review filter leaked LandScout: ${JSON.stringify(unresolvedNameForgeReviews)}`);
    }
    await page.waitForSelector('[data-sam31-replacement-action-field="semantic_label"]', { timeout: 8_000 });
    await page.waitForSelector('[data-sam31-replacement-action-field="polygon"]', { timeout: 8_000 });
    await page.waitForSelector('[data-sam31-replacement-action-field="bbox"]', { timeout: 8_000 });
    await page.waitForSelector('[data-sam31-replacement-action-field="object_hypothesis"]', { timeout: 8_000 });
    await page.waitForSelector('[data-sam31-replacement-action-field="vector_overlay"]', { timeout: 8_000 });
    await page.waitForSelector('[data-sam31-replacement-action-field="model_3d_candidate"]', { timeout: 8_000 });
    await page.waitForSelector('[data-sam31-replacement-action-field="source_ref"]', { timeout: 8_000 });
    await page.waitForSelector('[data-sam31-replacement-action-field="confidence"]', { timeout: 8_000 });
    await page.waitForSelector('[data-sam31-replacement-action-evidence-id]', { timeout: 8_000 });
    await page.getByRole('button', { name: 'Record employee replacements' }).first().click();
    await page.waitForSelector('[id^="sam31EmployeeReplacementValues-"]:focus', { timeout: 8_000 });
    await page.locator('[id^="sam31EmployeeReplacementReviewer-"]').first().fill('Halo Fire employee smoke');
    await page.locator('[id^="sam31EmployeeReplacementRef-"]').first().fill('1881://employee-replacements/smoke-sheet-7-sam31-values.json');
    await page.locator('[id^="sam31EmployeeReplacementValues-"]').first().fill(JSON.stringify({
      semantic_label: 'employee adjusted corridor',
      polygon: [[1, 1], [29, 1], [29, 9], [1, 9]],
      bbox: { minX: 1, minY: 1, maxX: 29, maxY: 9 },
      object_hypothesis: { id: 'obj-smoke-sleeve', semantic_label: 'employee field sleeve candidate' },
      vector_overlay: { id: 'vector:employee:seg-smoke-room', svg_path: 'M 1 1 L 29 1 L 29 9 L 1 9 Z' },
      model_3d_candidate: { id: 'model3d:employee:seg-smoke-room', primitive: 'employee_adjusted_extruded_polygon' },
      source_ref: '1881://employee-field-notes/smoke-sheet-7',
      confidence: 0.86,
    }));
    await page.locator('[id^="sam31EmployeeReplacementNotes-"]').first().fill('Smoke saved employee replacements for temporary SAM31 values.');
    await page.waitForSelector('[id^="sam31ReplacementStatus-"]', { state: 'attached', timeout: 8_000 });
    await page.getByRole('button', { name: 'Save employee replacements' }).first().click();
    await page.waitForSelector('text=sam31_employee_replacement evidence', { timeout: 8_000 });
    await page.waitForSelector('text=SAM31_REPLACEMENTS_RECORDED', { timeout: 8_000 });
    await page.waitForSelector('text=Employee SAM31 replacements', { timeout: 8_000 });
    await page.waitForSelector('text=employee_adjusted_extruded_polygon', { timeout: 8_000 });
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

    await page.waitForSelector('text=Run replay bid', { timeout: 8_000 });
    const replayDownloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Run replay bid' }).first().click();
    const replayDownload = await replayDownloadPromise;
    const replayDownloadPath = await replayDownload.path();
    const replaySuggestedName = replayDownload.suggestedFilename();
    const replayDownloadBytes = replayDownloadPath ? fs.statSync(replayDownloadPath).size : 0;
    downloads.push({ suggestedName: replaySuggestedName, bytes: replayDownloadBytes });
    if (!replaySuggestedName.includes('room-boundary-replay-bid-artifact') || replayDownloadBytes <= 0) {
      throw new Error(`Unexpected replay bid artifact download ${replaySuggestedName} (${replayDownloadBytes} bytes)`);
    }
    const replayArtifact = JSON.parse(fs.readFileSync(replayDownloadPath, 'utf8'));
    if (replayArtifact.artifact_type !== 'room_boundary_replay_bid_artifact') {
      throw new Error(`Unexpected replay artifact type ${replayArtifact.artifact_type}`);
    }
    if (!Number.isSafeInteger(replayArtifact.source_sam31_replacement_evidence_id) || replayArtifact.source_sam31_replacement_evidence_id <= 0) {
      throw new Error('Replay artifact is missing source_sam31_replacement_evidence_id');
    }
    if (replayArtifact.sam31_replacement_source !== 'latest_sam31_employee_replacement') {
      throw new Error(`Replay artifact used wrong SAM31 replacement source ${replayArtifact.sam31_replacement_source}`);
    }
    if (replayArtifact.sam31_employee_replacement?.replacement_values?.semantic_label !== 'employee adjusted corridor') {
      throw new Error('Replay artifact did not preserve the employee semantic label');
    }
    if (replayArtifact.sam31_employee_replacement?.replacement_values?.model_3d_candidate?.primitive !== 'employee_adjusted_extruded_polygon') {
      throw new Error('Replay artifact did not preserve the employee 3D candidate replacement');
    }
    if (replayArtifact.roomBoundaryReplay?.source_sam31_replacement_evidence_id !== replayArtifact.source_sam31_replacement_evidence_id) {
      throw new Error('Replay artifact roomBoundaryReplay does not point at the same SAM31 replacement evidence');
    }
    if (replayArtifact.bid?.totalAreaSqFt !== 224 || replayArtifact.bid?.rooms?.[0]?.name !== 'employee adjusted corridor') {
      throw new Error('Replay artifact bid did not use the employee replacement polygon and label');
    }
    if (replayArtifact.claim_gate_effect !== 'no_claims_cleared') {
      throw new Error(`Replay artifact cleared a claim gate: ${replayArtifact.claim_gate_effect}`);
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
      queueItemDownload: {
        artifact_type: queueItem.artifact_type,
        suggestedName: queueSuggestedName,
        missing_evidence_codes: missingEvidenceCodes,
        use_for_claims: queueItem.use_for_claims,
        claim_gate_effect: queueItem.claim_gate_effect,
      },
      consumerSmokeArtifact: {
        artifact_type: consumerSmokeArtifact.artifact_type,
        suggestedName: consumerSmokeSuggestedName,
        posted_consumer_count: consumerSmokeArtifact.posted_consumer_count,
        blocked_consumer_count: consumerSmokeArtifact.blocked_consumer_count,
        consumer_results: consumerSmokeResults.map((result) => ({
          consumer: result.consumer,
          status: result.status,
          response_status: result.response_status,
          accepted_queue_id: result.accepted_queue_id,
          persisted_review_packet_ref: result.persisted_review_packet_ref,
        })),
        consumer_review_tasks: consumerReviewTasks.map((task) => ({
          artifact_type: task.artifact_type,
          consumer: task.consumer,
          status: task.status,
          accepted_queue_id: task.accepted_queue_id,
          persisted_review_packet_ref: task.persisted_review_packet_ref,
          acceptable_evidence_count: Array.isArray(task.acceptable_evidence) ? task.acceptable_evidence.length : 0,
          use_for_claims: task.use_for_claims,
          claim_gate_effect: task.claim_gate_effect,
        })),
        use_for_claims: consumerSmokeArtifact.use_for_claims,
        claim_gate_effect: consumerSmokeArtifact.claim_gate_effect,
      },
      consumerReviewDecision: {
        artifact_type: 'openclaw.sam31.consumer_review_task_decision.v1',
        evidence_type: 'openclaw_sam31_consumer_review',
        consumer: consumerReview.consumer,
        review_decision: consumerReview.review_decision,
        accepted_queue_id: consumerReview.accepted_queue_id,
        persisted_review_packet_ref: consumerReview.persisted_review_packet_ref,
        claim_gate_effect: consumerReview.claim_gate_effect,
      },
      consumerReviewDecisionPacket: {
        artifact_type: consumerReviewPacket.artifact_type,
        suggestedName: consumerReviewSuggestedName,
        accepted_queue_id: consumerReviewPacket.accepted_queue_id,
        source_openclaw_sam31_consumer_review_evidence_id: consumerReviewPacket.source_openclaw_sam31_consumer_review_evidence_id,
        claim_gate_effect: consumerReviewPacket.claim_gate_effect,
      },
      sprinklerReviewAdapterPacket: {
        artifact_type: sprinklerAdapterPacket.artifact_type,
        suggestedName: sprinklerAdapterSuggestedName,
        source_openclaw_sam31_consumer_review_evidence_id: sprinklerAdapterPacket.source_openclaw_sam31_consumer_review_evidence_id,
        sprinkler_review_packet_type: sprinklerAdapterPacket.sprinkler_review_packet?.artifact_type,
        supported_sprinkler_review_lanes: sprinklerAdapterPacket.supported_sprinkler_review_lanes,
        claim_gate_effect: sprinklerAdapterPacket.claim_gate_effect,
      },
      unresolvedNameForgeReview: {
        filter: 'sam31ConsumerReview=unresolved',
        count: unresolvedNameForgeReviews.length,
        consumers: unresolvedNameForgeReviews.map((review) => review.consumer),
      },
      replayArtifact: {
        artifact_type: replayArtifact.artifact_type,
        source_sam31_replacement_evidence_id: replayArtifact.source_sam31_replacement_evidence_id,
        sam31_replacement_source: replayArtifact.sam31_replacement_source,
        semantic_label: replayArtifact.sam31_employee_replacement.replacement_values.semantic_label,
        model_3d_candidate: replayArtifact.sam31_employee_replacement.replacement_values.model_3d_candidate.primitive,
        totalAreaSqFt: replayArtifact.bid.totalAreaSqFt,
        claim_gate_effect: replayArtifact.claim_gate_effect,
      },
      sam31ReplacementRouteSuffix: SAM31_REPLACEMENTS_ROUTE_SUFFIX,
      sam31ReplacementQueueStatus: SAM31_REPLACEMENTS_RECORDED_STATUS,
      sam31BridgeSmokeRouteSuffix: SAM31_BRIDGE_SMOKE_ROUTE_SUFFIX,
      sam31BridgeSmokeSelector: SAM31_BRIDGE_SMOKE_SELECTOR,
      sam31BridgeSmokeStatusPrefix: SAM31_BRIDGE_SMOKE_STATUS_PREFIX,
      sam31BridgeSmokeWorkbenchHandler: SAM31_BRIDGE_SMOKE_WORKBENCH_HANDLER,
      sam31BridgeSmokeEvidenceType: SAM31_BRIDGE_SMOKE_EVIDENCE_TYPE,
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
  let bridge;
  let server;
  let stdout = '';
  let stderr = '';
  try {
    bridge = await startSam31Bridge();
    server = startServer(tempDir, bridge.bridgeBaseUrl);
    server.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    server.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
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
      localBridgeExtrapolationEvidenceId: seeded.localBridgeExtrapolation.evidence.id,
    });
    log(JSON.stringify(smoke, null, 2));
  } finally {
    if (server && !server.killed) {
      server.kill();
      await new Promise((resolve) => server.once('exit', resolve));
    }
    if (bridge?.server) {
      await closeHttpServer(bridge.server);
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

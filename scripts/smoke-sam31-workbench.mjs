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
const requiredSectioningPipelineStages = [
  'sam31_sectioning',
  'llm_object_identification',
  'vector_overlay_generation',
  'model_3d_candidate_generation',
  'product_review_queue',
];
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
    await page.waitForSelector('text=Canonical OpenClaw SAM31 tool', { timeout: 8_000 });
    await page.waitForSelector('text=Download SAM31 tool contract', { timeout: 8_000 });
    await page.waitForSelector('text=halofire-api-local-contract', { timeout: 8_000 });
    const toolContractDownloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download SAM31 tool contract' }).first().click();
    const toolContractDownload = await toolContractDownloadPromise;
    const toolContractPath = await toolContractDownload.path();
    const toolContractSuggestedName = toolContractDownload.suggestedFilename();
    const toolContractBytes = toolContractPath ? fs.statSync(toolContractPath).size : 0;
    downloads.push({ suggestedName: toolContractSuggestedName, bytes: toolContractBytes });
    if (!toolContractSuggestedName.includes('openclaw-sam31-tool-contract') || toolContractBytes <= 0) {
      throw new Error(`Unexpected SAM31 tool contract download ${toolContractSuggestedName} (${toolContractBytes} bytes)`);
    }
    const toolContract = JSON.parse(fs.readFileSync(toolContractPath, 'utf8'));
    if (toolContract.artifact_type !== 'openclaw.sam31_llm_extrapolation_tool_contract_packet.v1') {
      throw new Error(`Unexpected SAM31 tool contract packet type ${toolContract.artifact_type}`);
    }
    if (toolContract.source_runtime !== 'halofire-api-local-contract'
      || toolContract.use_for_claims !== false
      || toolContract.claim_gate_effect !== 'no_claims_cleared') {
      throw new Error(`SAM31 tool contract cleared a claim gate or lost source truth: ${JSON.stringify(toolContract)}`);
    }
    const sectioningContract = toolContract.sectioning_pipeline_contract;
    if (!sectioningContract
      || sectioningContract.artifact_type !== 'openclaw.sam31.sectioning_pipeline_contract.v1'
      || sectioningContract.use_for_claims !== false
      || sectioningContract.claim_gate_effect !== 'no_claims_cleared') {
      throw new Error(`SAM31 tool contract lost fail-closed sectioning pipeline contract: ${JSON.stringify(sectioningContract)}`);
    }
    const sectioningStageNames = Array.isArray(sectioningContract.stages)
      ? new Set(sectioningContract.stages.map((stage) => stage.stage))
      : new Set();
    for (const stageName of requiredSectioningPipelineStages) {
      if (!sectioningStageNames.has(stageName)) {
        throw new Error(`SAM31 tool contract lost sectioning pipeline stage ${stageName}: ${JSON.stringify(sectioningContract.stages)}`);
      }
    }
    const toolContractConsumers = Array.isArray(toolContract.cross_product_handoff_rows)
      ? toolContract.cross_product_handoff_rows.map((row) => row.consumer)
      : [];
    if (!toolContractConsumers.includes('landscout') || !toolContractConsumers.includes('nameforge')) {
      throw new Error(`SAM31 tool contract lost cross-product handoff rows: ${JSON.stringify(toolContract.cross_product_handoff_rows)}`);
    }
    await page.waitForSelector('text=Download SAM31 sectioning pipeline contract', { timeout: 8_000 });
    const sectioningContractDownloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download SAM31 sectioning pipeline contract' }).first().click();
    const sectioningContractDownload = await sectioningContractDownloadPromise;
    const sectioningContractPath = await sectioningContractDownload.path();
    const sectioningContractSuggestedName = sectioningContractDownload.suggestedFilename();
    const sectioningContractBytes = sectioningContractPath ? fs.statSync(sectioningContractPath).size : 0;
    downloads.push({ suggestedName: sectioningContractSuggestedName, bytes: sectioningContractBytes });
    if (!sectioningContractSuggestedName.includes('sam31-sectioning-pipeline-contract') || sectioningContractBytes <= 0) {
      throw new Error(`Unexpected SAM31 sectioning pipeline contract download ${sectioningContractSuggestedName} (${sectioningContractBytes} bytes)`);
    }
    const sectioningContractPacket = JSON.parse(fs.readFileSync(sectioningContractPath, 'utf8'));
    if (sectioningContractPacket.artifact_type !== 'openclaw.sam31.sectioning_pipeline_contract_packet.v1') {
      throw new Error(`Unexpected SAM31 sectioning pipeline contract packet type ${sectioningContractPacket.artifact_type}`);
    }
    if (sectioningContractPacket.source_pdf_boundary_evidence_id !== evidenceIds.boundaryEvidenceId
      || sectioningContractPacket.source_openclaw_sam31_extrapolation_evidence_id !== evidenceIds.localBridgeExtrapolationEvidenceId
      || sectioningContractPacket.use_for_claims !== false
      || sectioningContractPacket.claim_gate_effect !== 'no_claims_cleared'
      || sectioningContractPacket.no_claim_gates_cleared !== true) {
      throw new Error(`SAM31 sectioning pipeline contract cleared a claim gate or lost source truth: ${JSON.stringify(sectioningContractPacket)}`);
    }
    const downloadedSectioningContract = sectioningContractPacket.sectioning_pipeline_contract;
    if (!downloadedSectioningContract
      || downloadedSectioningContract.artifact_type !== 'openclaw.sam31.sectioning_pipeline_contract.v1'
      || downloadedSectioningContract.use_for_claims !== false
      || downloadedSectioningContract.claim_gate_effect !== 'no_claims_cleared') {
      throw new Error(`SAM31 sectioning pipeline contract lost fail-closed payload: ${JSON.stringify(downloadedSectioningContract)}`);
    }
    const downloadedSectioningStageNames = Array.isArray(downloadedSectioningContract.stages)
      ? new Set(downloadedSectioningContract.stages.map((stage) => stage.stage))
      : new Set();
    for (const stageName of requiredSectioningPipelineStages) {
      if (!downloadedSectioningStageNames.has(stageName)) {
        throw new Error(`Downloaded SAM31 sectioning pipeline contract lost stage ${stageName}: ${JSON.stringify(downloadedSectioningContract.stages)}`);
      }
    }
    await page.waitForSelector('text=SAM31 vector/model artifact packet', { timeout: 8_000 });
    await page.waitForSelector('text=Download SAM31 vector/model artifact packet', { timeout: 8_000 });
    await page.waitForSelector('text=Record SAM31 vector/model artifacts', { timeout: 8_000 });
    await page.waitForSelector('text=openclaw.sam31_vector_model_artifact_packet.v1', { timeout: 8_000 });
    const vectorModelDownloadPromise = page.waitForEvent('download');
    await page.locator('[data-sam31-vector-model-artifact-evidence-id]').first().click();
    const vectorModelDownload = await vectorModelDownloadPromise;
    const vectorModelPath = await vectorModelDownload.path();
    const vectorModelSuggestedName = vectorModelDownload.suggestedFilename();
    const vectorModelDownloadBytes = vectorModelPath ? fs.statSync(vectorModelPath).size : 0;
    downloads.push({ suggestedName: vectorModelSuggestedName, bytes: vectorModelDownloadBytes });
    if (!vectorModelSuggestedName.includes('sam31-vector-model-artifacts') || vectorModelDownloadBytes <= 0) {
      throw new Error(`Unexpected SAM31 vector/model artifact download ${vectorModelSuggestedName} (${vectorModelDownloadBytes} bytes)`);
    }
    const vectorModelPacket = JSON.parse(fs.readFileSync(vectorModelPath, 'utf8'));
    if (vectorModelPacket.artifact_type !== 'openclaw.sam31_vector_model_artifact_packet.v1') {
      throw new Error(`Unexpected SAM31 vector/model artifact packet type ${vectorModelPacket.artifact_type}`);
    }
    if (vectorModelPacket.use_for_claims !== false
      || vectorModelPacket.claim_gate_effect !== 'no_claims_cleared'
      || vectorModelPacket.no_claim_gates_cleared !== true) {
      throw new Error(`SAM31 vector/model artifact cleared a claim gate: ${JSON.stringify(vectorModelPacket)}`);
    }
    if (!Array.isArray(vectorModelPacket.vector_overlays)
      || vectorModelPacket.vector_overlays.length !== 1
      || !Array.isArray(vectorModelPacket.model_3d_candidates)
      || vectorModelPacket.model_3d_candidates.length !== 1) {
      throw new Error(`SAM31 vector/model artifact lost generated geometry rows: ${JSON.stringify(vectorModelPacket)}`);
    }
    if (vectorModelPacket.operator_audit_summary?.source_pdf_boundary_evidence_id !== evidenceIds.boundaryEvidenceId
      || vectorModelPacket.operator_audit_summary?.source_sam31_visual_audit_evidence_id !== evidenceIds.sam31EvidenceId
      || vectorModelPacket.operator_audit_summary?.vector_overlay_count !== 1
      || vectorModelPacket.operator_audit_summary?.model_3d_candidate_count !== 1
      || vectorModelPacket.operator_audit_summary?.temporary_value_policy !== 'best_guess_until_employee_replaced'
      || vectorModelPacket.operator_audit_summary?.claim_gate_effect !== 'no_claims_cleared') {
      throw new Error(`SAM31 vector/model artifact lost operator audit summary: ${JSON.stringify(vectorModelPacket.operator_audit_summary)}`);
    }
    await page.locator('[data-sam31-vector-model-artifact-save-evidence-id]').first().click();
    await page.waitForSelector('text=Saved openclaw_sam31_vector_model_artifact_packet evidence', { timeout: 8_000 });
    await page.waitForSelector('text=Saved SAM31 vector/model evidence detail', { timeout: 8_000 });
    await page.waitForSelector('text=sam31_vector_model_artifacts_recorded 1', { timeout: 8_000 });
    const vectorModelQueue = await request(`${PROJECT_PATH}/resolver-queue`, token);
    if (vectorModelQueue.summary?.sam31_vector_model_artifacts_recorded !== 1
      || vectorModelQueue.items.some((item) => item.latest_openclaw_sam31_vector_model_artifact
        && item.latest_openclaw_sam31_vector_model_artifact.claim_gate_effect !== 'no_claims_cleared')) {
      throw new Error(`SAM31 vector/model artifact queue summary is not fail-closed: ${JSON.stringify(vectorModelQueue.summary)}`);
    }
    const vectorModelArtifactEvidenceId = vectorModelQueue.items
      .find((item) => item.evidence_id === evidenceIds.boundaryEvidenceId)
      ?.latest_openclaw_sam31_vector_model_artifact?.evidence_id;
    if (!vectorModelArtifactEvidenceId) {
      throw new Error(`SAM31 vector/model artifact evidence id missing from queue: ${JSON.stringify(vectorModelQueue.items)}`);
    }
    await page.waitForSelector('text=Download SAM31 queue item', { timeout: 8_000 });
    await page.locator('[data-catalog-source-record-family-ref="family:pipe_steel_sch40_2p0in"]').first().click();
    await page.waitForSelector('text=Recorded evidence:', { timeout: 8_000 });
    await page.waitForSelector('text=catalog_approval_packet_ready', { timeout: 8_000 });
    await page.waitForSelector('text=Ready approval packets', { timeout: 8_000 });
    await page.waitForSelector('text=ready_for_signed_evidence_upload', { timeout: 8_000 });
    await page.waitForSelector('text=no claim gates cleared', { timeout: 8_000 });
    await page.waitForSelector('text=AHJ approval packets', { timeout: 8_000 });
    await page.locator('[data-resolver-queue-filter="catalogApproval=ready&evidenceType=ahj_approval"]').first().click();
    await page.waitForSelector('text=catalog_approval_packet_ready 3', { timeout: 8_000 });
    await page.waitForSelector('text=AHJ approval packets 3', { timeout: 8_000 });
    await page.locator('[data-resolver-queue-filter=""]').first().click();
    await page.waitForSelector('text=catalog_approval_packet_ready 12', { timeout: 8_000 });
    const catalogEvidenceQueue = await request(`${PROJECT_PATH}/resolver-queue`, token);
    if (catalogEvidenceQueue.summary?.catalog_approval_packet_ready !== 12
      || catalogEvidenceQueue.summary?.catalog_approval_professional_packets !== 3
      || catalogEvidenceQueue.summary?.catalog_approval_ahj_packets !== 3
      || catalogEvidenceQueue.summary?.catalog_approval_autosprink_packets !== 3
      || catalogEvidenceQueue.summary?.catalog_approval_claims_cleared !== 0) {
      throw new Error(`Catalog approval packet readiness summary is not fail-closed: ${JSON.stringify(catalogEvidenceQueue.summary)}`);
    }
    const ahjCatalogApprovalQueue = await request(`${PROJECT_PATH}/resolver-queue?catalogApproval=ready&evidenceType=ahj_approval`, token);
    if (ahjCatalogApprovalQueue.filters?.catalogApproval !== 'ready'
      || ahjCatalogApprovalQueue.filters?.evidenceType !== 'ahj_approval'
      || ahjCatalogApprovalQueue.summary?.catalog_approval_packet_ready !== 3
      || ahjCatalogApprovalQueue.summary?.catalog_approval_ahj_packets !== 3
      || ahjCatalogApprovalQueue.summary?.catalog_approval_professional_packets !== 0
      || ahjCatalogApprovalQueue.summary?.catalog_approval_autosprink_packets !== 0
      || ahjCatalogApprovalQueue.summary?.catalog_approval_claims_cleared !== 0
      || ahjCatalogApprovalQueue.items.some((item) => !Array.isArray(item.catalog_approval_packet_rows)
        || item.catalog_approval_packet_rows.length !== 1
        || item.catalog_approval_packet_rows[0].target_gate_code !== 'AHJ_APPROVAL_MISSING'
        || item.catalog_approval_packet_rows[0].claim_gate_effect !== 'no_claims_cleared')) {
      throw new Error(`AHJ catalog approval packet filter is not fail-closed: ${JSON.stringify(ahjCatalogApprovalQueue)}`);
    }
    const pipeCatalogItem = catalogEvidenceQueue.items.find((item) => item.kind === 'catalog_vendor_acquisition'
      && item.input_defaults?.family_ref === 'family:pipe_steel_sch40_2p0in');
    if (pipeCatalogItem?.status !== 'catalog_evidence_recorded'
      || pipeCatalogItem?.latest_review?.claim_gate_effect !== 'no_claims_cleared') {
      throw new Error(`Catalog source evidence was not recorded fail-closed from the workbench: ${JSON.stringify(pipeCatalogItem)}`);
    }
    if (!Array.isArray(pipeCatalogItem.catalog_approval_packet_rows)
      || pipeCatalogItem.catalog_approval_packet_rows.length !== 4
      || pipeCatalogItem.catalog_approval_packet_rows.some((row) => row.claim_gate_effect !== 'no_claims_cleared' || row.status !== 'ready_for_signed_evidence_upload')) {
      throw new Error(`Catalog approval packet rows lost fail-closed readiness: ${JSON.stringify(pipeCatalogItem.catalog_approval_packet_rows)}`);
    }
    const catalogGates = await request(`${PROJECT_PATH}/claim-gates`, token);
    const manufacturerGate = catalogGates.find((gate) => gate.code === 'MANUFACTURER_MODEL_APPROVAL_MISSING');
    if (manufacturerGate?.status !== 'blocked') {
      throw new Error(`Catalog source evidence cleared manufacturer gate unexpectedly: ${JSON.stringify(manufacturerGate)}`);
    }
    await page.waitForSelector('text=Download catalog source packet', { timeout: 8_000 });
    const catalogPacketDownloadPromise = page.waitForEvent('download');
    await page.locator('[data-catalog-source-packet-family-ref="family:pipe_steel_sch40_2p0in"]').first().click();
    const catalogPacketDownload = await catalogPacketDownloadPromise;
    const catalogPacketPath = await catalogPacketDownload.path();
    const catalogPacketSuggestedName = catalogPacketDownload.suggestedFilename();
    const catalogPacketBytes = catalogPacketPath ? fs.statSync(catalogPacketPath).size : 0;
    downloads.push({ suggestedName: catalogPacketSuggestedName, bytes: catalogPacketBytes });
    if (!catalogPacketSuggestedName.includes('catalog-source-evidence-packet') || catalogPacketBytes <= 0) {
      throw new Error(`Unexpected catalog source packet download ${catalogPacketSuggestedName} (${catalogPacketBytes} bytes)`);
    }
    const catalogPacket = JSON.parse(fs.readFileSync(catalogPacketPath, 'utf8'));
    if (catalogPacket.artifact_type !== 'halofire.catalog_source_evidence_packet.v1') {
      throw new Error(`Unexpected catalog source packet type ${catalogPacket.artifact_type}`);
    }
    if (catalogPacket.family_ref !== 'family:pipe_steel_sch40_2p0in'
      || catalogPacket.claim_gate_effect !== 'no_claims_cleared'
      || catalogPacket.manufacturer_exact !== false
      || catalogPacket.latest_catalog_source_acquisition?.claim_gate_effect !== 'no_claims_cleared') {
      throw new Error(`Catalog source packet cleared claims or lost family evidence: ${JSON.stringify(catalogPacket)}`);
    }
    const catalogApprovalButton = page.locator('[data-catalog-source-approval-family-ref="family:pipe_steel_sch40_2p0in"]').first();
    await catalogApprovalButton.evaluate((button) => {
      button.closest('details')?.setAttribute('open', '');
    });
    const catalogRowKey = 'family:pipe_steel_sch40_2p0in';
    await page.waitForSelector('text=Next action: Upload signed manufacturer model approval', { timeout: 8_000 });
    await page.waitForSelector('text=Download selected approval packet', { timeout: 8_000 });
    await page.locator(`[id="catalogApprovalRefField-${catalogRowKey}"]`).selectOption('professional_or_ahj_review_ref');
    await page.waitForFunction((rowKey) => {
      const gate = document.getElementById('catalogApprovalTargetGate-' + rowKey);
      const button = document.querySelector('[data-catalog-source-approval-family-ref="family:pipe_steel_sch40_2p0in"]');
      const disabledManufacturerGate = Array.from(gate?.options || [])
        .find((option) => option.value === 'MANUFACTURER_MODEL_APPROVAL_MISSING')?.disabled === true;
      return gate
        && gate.value === 'PROFESSIONAL_REVIEW_MISSING'
        && disabledManufacturerGate
        && button?.textContent.includes('Upload signed professional review');
    }, catalogRowKey, { timeout: 8_000 });
    const professionalApprovalPacketPromise = page.waitForEvent('download');
    await page.locator('[data-catalog-source-approval-packet-family-ref="family:pipe_steel_sch40_2p0in"]').first().click();
    const professionalApprovalPacketDownload = await professionalApprovalPacketPromise;
    const professionalApprovalPacketPath = await professionalApprovalPacketDownload.path();
    const professionalApprovalPacketSuggestedName = professionalApprovalPacketDownload.suggestedFilename();
    const professionalApprovalPacketBytes = professionalApprovalPacketPath ? fs.statSync(professionalApprovalPacketPath).size : 0;
    downloads.push({ suggestedName: professionalApprovalPacketSuggestedName, bytes: professionalApprovalPacketBytes });
    if (!professionalApprovalPacketSuggestedName.includes('catalog-approval-professional-review-packet') || professionalApprovalPacketBytes <= 0) {
      throw new Error(`Unexpected professional catalog approval packet download ${professionalApprovalPacketSuggestedName} (${professionalApprovalPacketBytes} bytes)`);
    }
    const professionalApprovalPacket = JSON.parse(fs.readFileSync(professionalApprovalPacketPath, 'utf8'));
    if (professionalApprovalPacket.artifact_type !== 'halofire.catalog_approval_resolver_packet.v1'
      || professionalApprovalPacket.approval_ref_field !== 'professional_or_ahj_review_ref'
      || professionalApprovalPacket.target_gate_code !== 'PROFESSIONAL_REVIEW_MISSING'
      || professionalApprovalPacket.claim_gate_effect !== 'no_claims_cleared') {
      throw new Error(`Professional catalog approval packet lost fail-closed resolver truth: ${JSON.stringify(professionalApprovalPacket)}`);
    }
    await page.locator(`[id="catalogApprovalTargetGate-${catalogRowKey}"]`).selectOption('AHJ_APPROVAL_MISSING');
    await page.waitForSelector('text=Next action: Upload signed AHJ approval', { timeout: 8_000 });
    await page.locator(`[id="catalogApprovalRefField-${catalogRowKey}"]`).selectOption('autosprink_or_equivalent_export_ref');
    await page.waitForFunction((rowKey) => {
      const gate = document.getElementById('catalogApprovalTargetGate-' + rowKey);
      const button = document.querySelector('[data-catalog-source-approval-family-ref="family:pipe_steel_sch40_2p0in"]');
      return gate
        && gate.value === 'AUTOSPRINK_EVIDENCE_MISSING'
        && button?.textContent.includes('Upload signed AutoSprink/equivalent export');
    }, catalogRowKey, { timeout: 8_000 });
    const autosprinkApprovalPacketPromise = page.waitForEvent('download');
    await page.locator('[data-catalog-source-approval-packet-family-ref="family:pipe_steel_sch40_2p0in"]').first().click();
    const autosprinkApprovalPacketDownload = await autosprinkApprovalPacketPromise;
    const autosprinkApprovalPacketPath = await autosprinkApprovalPacketDownload.path();
    const autosprinkApprovalPacketSuggestedName = autosprinkApprovalPacketDownload.suggestedFilename();
    const autosprinkApprovalPacketBytes = autosprinkApprovalPacketPath ? fs.statSync(autosprinkApprovalPacketPath).size : 0;
    downloads.push({ suggestedName: autosprinkApprovalPacketSuggestedName, bytes: autosprinkApprovalPacketBytes });
    if (!autosprinkApprovalPacketSuggestedName.includes('catalog-approval-autosprink-packet') || autosprinkApprovalPacketBytes <= 0) {
      throw new Error(`Unexpected AutoSprink catalog approval packet download ${autosprinkApprovalPacketSuggestedName} (${autosprinkApprovalPacketBytes} bytes)`);
    }
    const autosprinkApprovalPacket = JSON.parse(fs.readFileSync(autosprinkApprovalPacketPath, 'utf8'));
    if (autosprinkApprovalPacket.artifact_type !== 'halofire.catalog_approval_resolver_packet.v1'
      || autosprinkApprovalPacket.approval_ref_field !== 'autosprink_or_equivalent_export_ref'
      || autosprinkApprovalPacket.target_gate_code !== 'AUTOSPRINK_EVIDENCE_MISSING'
      || autosprinkApprovalPacket.claim_gate_effect !== 'no_claims_cleared') {
      throw new Error(`AutoSprink catalog approval packet lost fail-closed resolver truth: ${JSON.stringify(autosprinkApprovalPacket)}`);
    }
    await page.locator(`[id="catalogApprovalRefField-${catalogRowKey}"]`).selectOption('manufacturer_model_approval_ref');
    await page.waitForFunction((rowKey) => {
      const gate = document.getElementById('catalogApprovalTargetGate-' + rowKey);
      const button = document.querySelector('[data-catalog-source-approval-family-ref="family:pipe_steel_sch40_2p0in"]');
      return gate
        && gate.value === 'MANUFACTURER_MODEL_APPROVAL_MISSING'
        && button?.textContent.includes('Upload signed manufacturer model approval');
    }, catalogRowKey, { timeout: 8_000 });
    await page.locator(`[id="catalogApprovalSourceRef-${catalogRowKey}"]`).fill('manufacturer://smoke/pipe-sch40-2in-approval');
    await page.locator(`[id="catalogApprovalSourceFile-${catalogRowKey}"]`).fill('catalog-manufacturer-approval-smoke.pdf');
    await page.locator(`[id="catalogApprovalReviewerName-${catalogRowKey}"]`).fill('Smoke Manufacturer Reviewer');
    await page.locator(`[id="catalogApprovalReviewerTitle-${catalogRowKey}"]`).fill('HaloFire Manufacturer Review Lead');
    await page.locator(`[id="catalogApprovalSignedAt-${catalogRowKey}"]`).fill('2026-06-02T15:10:00.000Z');
    await page.locator(`[id="catalogApprovalOrganization-${catalogRowKey}"]`).fill('Halo Fire');
    await page.locator(`[id="catalogApprovalLicenseId-${catalogRowKey}"]`).fill('HF-MFG-SMOKE');
    await page.locator(`[id="catalogApprovalNotes-${catalogRowKey}"]`).fill('Smoke signed manufacturer approval validation for catalog packet ladder.');
    await catalogApprovalButton.click();
    await page.waitForSelector('text=Validated catalog approval gate MANUFACTURER_MODEL_APPROVAL_MISSING', { timeout: 8_000 });
    const catalogValidatedGates = await request(`${PROJECT_PATH}/claim-gates`, token);
    const validatedManufacturerGate = catalogValidatedGates.find((gate) => gate.code === 'MANUFACTURER_MODEL_APPROVAL_MISSING');
    if (validatedManufacturerGate?.status !== 'cleared'
      || validatedManufacturerGate?.resolved_evidence_ref !== 'manufacturer://smoke/pipe-sch40-2in-approval') {
      throw new Error(`Catalog approval validation did not clear manufacturer gate with signed evidence: ${JSON.stringify(validatedManufacturerGate)}`);
    }

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
    const consumerSmokeActionTimeoutMs = 20_000;
    await page.waitForSelector('text=Latest consumer smoke', { timeout: consumerSmokeActionTimeoutMs });
    await page.waitForSelector('text=posted_consumer_count', { timeout: consumerSmokeActionTimeoutMs });
    await page.waitForSelector('text=blocked_consumer_count', { timeout: consumerSmokeActionTimeoutMs });
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
    const sprinklerReviewQueueItems = reviewedQueueItem?.sam31_sprinkler_review_queue_items || [];
    if (!sprinklerReviewQueueItems.some((item) => item.artifact_type === 'halofire.sam31_sprinkler_review_queue_item.v1')) {
      throw new Error(`SAM31 sprinkler review queue items missing: ${JSON.stringify(reviewedQueueItem)}`);
    }
    if (!sprinklerReviewQueueItems.some((item) => item.supported_sprinkler_review_lane === 'obstruction_or_clash_review')) {
      throw new Error(`SAM31 sprinkler review queue missing obstruction lane: ${JSON.stringify(sprinklerReviewQueueItems)}`);
    }
    if (sprinklerReviewQueueItems.some((item) => item.use_for_claims !== false || item.claim_gate_effect !== 'no_claims_cleared')) {
      throw new Error(`SAM31 sprinkler review queue cleared a claim gate: ${JSON.stringify(sprinklerReviewQueueItems)}`);
    }
    if (sprinklerReviewQueueItems.some((item) => item.source_openclaw_sam31_vector_model_artifact_evidence_id !== vectorModelArtifactEvidenceId
      || item.source_linked_vector_overlay_count < 1
      || item.source_linked_model_3d_candidate_count < 1)) {
      throw new Error(`SAM31 sprinkler review queue lost visible vector/model source evidence: ${JSON.stringify(sprinklerReviewQueueItems)}`);
    }
    const obstructionQueue = await request(`${PROJECT_PATH}/resolver-queue?sam31SprinklerReview=queued&lane=obstruction_or_clash_review`, token);
    const obstructionQueueItem = obstructionQueue.items.find((item) => item.evidence_id === evidenceIds.boundaryEvidenceId);
    const obstructionRows = obstructionQueueItem?.sam31_sprinkler_review_queue_items || [];
    if (!obstructionRows.length || obstructionRows.some((item) => item.supported_sprinkler_review_lane !== 'obstruction_or_clash_review')) {
      throw new Error(`SAM31 sprinkler review lane filter failed: ${JSON.stringify(obstructionQueue)}`);
    }
    await page.waitForSelector('text=SAM31 sprinkler review queue', { timeout: 8_000 });
    await page.waitForSelector(`text=SAM31 vector/model source evidence #${vectorModelArtifactEvidenceId}`, { timeout: 8_000 });
    await page.waitForSelector('text=sam31SprinklerReview=queued', { timeout: 8_000 });
    await page.waitForSelector('text=Save SAM31 sprinkler review decision', { timeout: 8_000 });
    const sprinklerReviewReviewerSelector = `#sam31SprinklerReviewReviewer-${evidenceIds.boundaryEvidenceId}-${consumerReview.evidence_id}-sam31_consumer_reviewed_object_hypotheses`;
    await page.locator(sprinklerReviewReviewerSelector).evaluate((element) => {
      const details = element.closest('details');
      if (details) details.open = true;
    });
    await page.locator(sprinklerReviewReviewerSelector).fill('Smoke sprinkler reviewer');
    await page.locator(`#sam31SprinklerReviewRef-${evidenceIds.boundaryEvidenceId}-${consumerReview.evidence_id}-sam31_consumer_reviewed_object_hypotheses`).fill('halofire://sam31/smoke/sprinkler-review/object-hypothesis.json');
    await page.locator(`#sam31SprinklerReviewScreenshotRef-${evidenceIds.boundaryEvidenceId}-${consumerReview.evidence_id}-sam31_consumer_reviewed_object_hypotheses`).fill('halofire://sam31/smoke/sprinkler-review/object-hypothesis.png');
    await page.locator(`#sam31SprinklerReviewValues-${evidenceIds.boundaryEvidenceId}-${consumerReview.evidence_id}-sam31_consumer_reviewed_object_hypotheses`).fill(JSON.stringify({
      obstruction_candidates: [{ id: 'landscout-object-smoke', sprinkler_relevance: 'needs_employee_followup' }],
      confidence: 0.76,
    }));
    await page.locator(`#sam31SprinklerReviewNotes-${evidenceIds.boundaryEvidenceId}-${consumerReview.evidence_id}-sam31_consumer_reviewed_object_hypotheses`).fill('Smoke sprinkler review decision for SAM31 object hypothesis.');
    await page.locator(`button[data-sam31-sprinkler-review-save-issue-type="sam31_consumer_reviewed_object_hypotheses"]`).click();
    await page.waitForSelector('text=halofire_sam31_sprinkler_review_decision evidence', { timeout: 8_000 });
    await page.waitForSelector('text=employee_sprinkler_review_recorded', { timeout: 8_000 });
    const reviewedObstructionQueue = await request(`${PROJECT_PATH}/resolver-queue?sam31SprinklerReview=queued&lane=obstruction_or_clash_review`, token);
    const reviewedObstructionItem = reviewedObstructionQueue.items.find((item) => item.evidence_id === evidenceIds.boundaryEvidenceId);
    const reviewedObstructionRows = reviewedObstructionItem?.sam31_sprinkler_review_queue_items || [];
    if (!reviewedObstructionRows.some((item) => item.latest_sam31_sprinkler_review_decision?.review_decision === 'replaced')) {
      throw new Error(`SAM31 sprinkler review decision did not persist to resolver queue: ${JSON.stringify(reviewedObstructionQueue)}`);
    }
    const latestSprinklerDecision = reviewedObstructionRows.find((item) => item.latest_sam31_sprinkler_review_decision?.review_decision === 'replaced')?.latest_sam31_sprinkler_review_decision;
    if (!latestSprinklerDecision?.evidence_id) {
      throw new Error(`SAM31 sprinkler review decision evidence id missing from resolver queue: ${JSON.stringify(reviewedObstructionRows)}`);
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
    if (sprinklerAdapterPacket.source_openclaw_sam31_vector_model_artifact_evidence_id !== vectorModelQueue.items
      .find((item) => item.evidence_id === evidenceIds.boundaryEvidenceId)
      ?.latest_openclaw_sam31_vector_model_artifact?.evidence_id
      || sprinklerAdapterPacket.openclaw_sam31_vector_model_artifact?.artifact_type !== 'openclaw.sam31_vector_model_artifact_packet.v1'
      || !Array.isArray(sprinklerAdapterPacket.sprinkler_review_packet?.source_linked_vector_overlays)
      || sprinklerAdapterPacket.sprinkler_review_packet.source_linked_vector_overlays.length < 1
      || !Array.isArray(sprinklerAdapterPacket.sprinkler_review_packet?.source_linked_model_3d_candidates)
      || sprinklerAdapterPacket.sprinkler_review_packet.source_linked_model_3d_candidates.length < 1
      || sprinklerAdapterPacket.openclaw_sam31_vector_model_artifact?.use_for_claims !== false
      || sprinklerAdapterPacket.openclaw_sam31_vector_model_artifact?.claim_gate_effect !== 'no_claims_cleared') {
      throw new Error(`SAM31 sprinkler adapter lost source-linked vector/model evidence: ${JSON.stringify(sprinklerAdapterPacket)}`);
    }
    await page.waitForSelector('text=Download SAM31 sprinkler review decision packet', { timeout: 8_000 });
    const sprinklerReviewPacketDownloadPromise = page.waitForEvent('download');
    await page.locator(`button[data-sam31-sprinkler-review-packet-evidence-id="${latestSprinklerDecision.evidence_id}"]`).click();
    const sprinklerReviewPacketDownload = await sprinklerReviewPacketDownloadPromise;
    const sprinklerReviewPacketPath = await sprinklerReviewPacketDownload.path();
    const sprinklerReviewPacketSuggestedName = sprinklerReviewPacketDownload.suggestedFilename();
    const sprinklerReviewPacketDownloadBytes = sprinklerReviewPacketPath ? fs.statSync(sprinklerReviewPacketPath).size : 0;
    downloads.push({ suggestedName: sprinklerReviewPacketSuggestedName, bytes: sprinklerReviewPacketDownloadBytes });
    if (!sprinklerReviewPacketSuggestedName.includes('sam31-sprinkler-review-decision') || sprinklerReviewPacketDownloadBytes <= 0) {
      throw new Error(`Unexpected SAM31 sprinkler review decision packet download ${sprinklerReviewPacketSuggestedName} (${sprinklerReviewPacketDownloadBytes} bytes)`);
    }
    const sprinklerReviewDecisionPacket = JSON.parse(fs.readFileSync(sprinklerReviewPacketPath, 'utf8'));
    if (sprinklerReviewDecisionPacket.artifact_type !== 'halofire.sam31_sprinkler_review_decision_packet.v1') {
      throw new Error(`Unexpected SAM31 sprinkler review decision packet type ${sprinklerReviewDecisionPacket.artifact_type}`);
    }
    if (sprinklerReviewDecisionPacket.preliminary_replay_inputs?.artifact_type !== 'halofire.sam31_sprinkler_review_preliminary_replay_inputs.v1') {
      throw new Error(`Unexpected SAM31 sprinkler replay input type ${sprinklerReviewDecisionPacket.preliminary_replay_inputs?.artifact_type}`);
    }
    if (sprinklerReviewDecisionPacket.claim_gate_effect !== 'no_claims_cleared' || sprinklerReviewDecisionPacket.use_for_claims !== false) {
      throw new Error(`SAM31 sprinkler review decision packet cleared a claim gate: ${JSON.stringify(sprinklerReviewDecisionPacket)}`);
    }
    const preliminaryReplayQueue = await request(`${PROJECT_PATH}/resolver-queue?sam31SprinklerReplay=ready&lane=obstruction_or_clash_review`, token);
    const preliminaryReplayItem = preliminaryReplayQueue.items.find((item) => item.evidence_id === evidenceIds.boundaryEvidenceId);
    const preliminaryReplayRows = preliminaryReplayItem?.sam31_sprinkler_preliminary_replay_queue_items || [];
    if (!preliminaryReplayRows.some((item) => item.artifact_type === 'halofire.sam31_sprinkler_preliminary_replay_queue_item.v1')) {
      throw new Error(`SAM31 sprinkler preliminary replay queue item missing: ${JSON.stringify(preliminaryReplayQueue)}`);
    }
    if (preliminaryReplayRows.some((item) => item.use_for_claims !== false || item.claim_gate_effect !== 'no_claims_cleared')) {
      throw new Error(`SAM31 sprinkler preliminary replay queue cleared a claim gate: ${JSON.stringify(preliminaryReplayRows)}`);
    }
    if (preliminaryReplayRows.some((item) => item.source_openclaw_sam31_vector_model_artifact_evidence_id !== vectorModelArtifactEvidenceId
      || item.source_linked_vector_overlay_count < 1
      || item.source_linked_model_3d_candidate_count < 1)) {
      throw new Error(`SAM31 sprinkler preliminary replay queue lost visible vector/model source evidence: ${JSON.stringify(preliminaryReplayRows)}`);
    }
    await page.waitForSelector('text=SAM31 sprinkler preliminary replay queue', { timeout: 8_000 });
    await page.waitForSelector('text=Run SAM31 sprinkler preliminary replay', { timeout: 8_000 });
    const preliminaryReplayDownloadPromise = page.waitForEvent('download');
    await page.locator(`button[data-sam31-sprinkler-preliminary-replay-evidence-id="${latestSprinklerDecision.evidence_id}"]`).click();
    const preliminaryReplayDownload = await preliminaryReplayDownloadPromise;
    const preliminaryReplayPath = await preliminaryReplayDownload.path();
    const preliminaryReplaySuggestedName = preliminaryReplayDownload.suggestedFilename();
    const preliminaryReplayDownloadBytes = preliminaryReplayPath ? fs.statSync(preliminaryReplayPath).size : 0;
    downloads.push({ suggestedName: preliminaryReplaySuggestedName, bytes: preliminaryReplayDownloadBytes });
    if (!preliminaryReplaySuggestedName.includes('sam31-sprinkler-preliminary-replay') || preliminaryReplayDownloadBytes <= 0) {
      throw new Error(`Unexpected SAM31 sprinkler preliminary replay download ${preliminaryReplaySuggestedName} (${preliminaryReplayDownloadBytes} bytes)`);
    }
    const sprinklerPreliminaryReplayArtifact = JSON.parse(fs.readFileSync(preliminaryReplayPath, 'utf8'));
    if (sprinklerPreliminaryReplayArtifact.artifact_type !== 'halofire.sam31_sprinkler_preliminary_replay_artifact.v1') {
      throw new Error(`Unexpected SAM31 sprinkler preliminary replay artifact type ${sprinklerPreliminaryReplayArtifact.artifact_type}`);
    }
    if (sprinklerPreliminaryReplayArtifact.replay_inputs?.artifact_type !== 'halofire.sam31_sprinkler_review_preliminary_replay_inputs.v1') {
      throw new Error(`Unexpected SAM31 sprinkler preliminary replay inputs type ${sprinklerPreliminaryReplayArtifact.replay_inputs?.artifact_type}`);
    }
    if (sprinklerPreliminaryReplayArtifact.claim_gate_effect !== 'no_claims_cleared' || sprinklerPreliminaryReplayArtifact.use_for_claims !== false) {
      throw new Error(`SAM31 sprinkler preliminary replay artifact cleared a claim gate: ${JSON.stringify(sprinklerPreliminaryReplayArtifact)}`);
    }
    if (sprinklerPreliminaryReplayArtifact.source_openclaw_sam31_vector_model_artifact_evidence_id !== sprinklerAdapterPacket.source_openclaw_sam31_vector_model_artifact_evidence_id
      || !Array.isArray(sprinklerPreliminaryReplayArtifact.source_linked_vector_overlays)
      || sprinklerPreliminaryReplayArtifact.source_linked_vector_overlays.length < 1
      || !Array.isArray(sprinklerPreliminaryReplayArtifact.source_linked_model_3d_candidates)
      || sprinklerPreliminaryReplayArtifact.source_linked_model_3d_candidates.length < 1) {
      throw new Error(`SAM31 preliminary replay lost source-linked vector/model evidence: ${JSON.stringify(sprinklerPreliminaryReplayArtifact)}`);
    }
    await page.waitForSelector('text=Save SAM31 preliminary replay follow-up', { timeout: 8_000 });
    const replayFollowupKey = `${evidenceIds.boundaryEvidenceId}-${consumerReview.evidence_id}-${latestSprinklerDecision.evidence_id}`;
    await page.getByText('Save SAM31 preliminary replay follow-up').first().click();
    await page.locator(`#sam31SprinklerReplayFollowupReviewer-${replayFollowupKey}`).fill('HaloFire replay smoke reviewer');
    await page.locator(`#sam31SprinklerReplayFollowupRef-${replayFollowupKey}`).fill('halofire://sam31/smoke/preliminary-replay/followup.json');
    await page.locator(`#sam31SprinklerReplayFollowupScreenshotRef-${replayFollowupKey}`).fill('halofire://sam31/smoke/preliminary-replay/followup.png');
    await page.locator(`#sam31SprinklerReplayFollowupPacketRef-${replayFollowupKey}`).fill('halofire://sam31/smoke/obstruction-clash/packet.json');
    await page.locator(`#sam31SprinklerReplayFollowupIssueDecisions-${replayFollowupKey}`).fill(JSON.stringify([
      {
        source_field: 'obstruction_candidates',
        source_index: 0,
        decision: 'not_a_sprinkler_obstruction',
        target_packet_lane: 'obstruction_or_clash_review',
        notes: 'Smoke replay follow-up keeps parcel-edge hypothesis out of sprinkler obstruction claims.',
      },
    ]));
    await page.locator(`#sam31SprinklerReplayFollowupNotes-${replayFollowupKey}`).fill('Smoke replay follow-up only; claims remain blocked.');
    await page.locator(`button[data-sam31-sprinkler-preliminary-replay-followup-evidence-id="${latestSprinklerDecision.evidence_id}"]`).click();
    await page.waitForSelector(`text=Saved halofire_sam31_sprinkler_preliminary_replay_followup_decision`, { timeout: 8_000 });
    const replayFollowupQueue = await request(`${PROJECT_PATH}/resolver-queue?sam31SprinklerReplay=ready&lane=obstruction_or_clash_review`, token);
    if ((replayFollowupQueue.summary?.sam31_sprinkler_preliminary_replay_followups_recorded || 0) < 1) {
      throw new Error(`SAM31 preliminary replay follow-up was not recorded in resolver summary: ${JSON.stringify(replayFollowupQueue.summary)}`);
    }
    if ((replayFollowupQueue.summary?.sam31_sprinkler_packet_queue_items || 0) < 1) {
      throw new Error(`SAM31 preliminary replay follow-up did not create a packet queue item: ${JSON.stringify(replayFollowupQueue.summary)}`);
    }
    const replayFollowupItem = replayFollowupQueue.items.find((item) => item.evidence_id === evidenceIds.boundaryEvidenceId);
    const replayFollowupRows = replayFollowupItem?.sam31_sprinkler_preliminary_replay_queue_items || [];
    const replayFollowupRow = replayFollowupRows.find((row) => row.source_halofire_sam31_sprinkler_review_decision_evidence_id === latestSprinklerDecision.evidence_id);
    if (!replayFollowupRow?.latest_sam31_sprinkler_preliminary_replay_followup_decision) {
      throw new Error(`SAM31 preliminary replay follow-up missing from queue row: ${JSON.stringify(replayFollowupRows)}`);
    }
    if (!replayFollowupRow.packet_queue_items?.some((item) => item.artifact_type === 'halofire.sam31_obstruction_clash_packet_queue_item.v1')) {
      throw new Error(`SAM31 preliminary replay follow-up packet queue item missing: ${JSON.stringify(replayFollowupRow)}`);
    }
    if (replayFollowupRow.packet_queue_items.some((item) => item.use_for_claims !== false || item.claim_gate_effect !== 'no_claims_cleared')) {
      throw new Error(`SAM31 preliminary replay follow-up packet queue cleared a claim gate: ${JSON.stringify(replayFollowupRow.packet_queue_items)}`);
    }
    if (replayFollowupRow.packet_queue_items.some((item) => item.source_openclaw_sam31_vector_model_artifact_evidence_id !== vectorModelArtifactEvidenceId
      || item.source_linked_vector_overlay_count < 1
      || item.source_linked_model_3d_candidate_count < 1)) {
      throw new Error(`SAM31 preliminary replay follow-up packet queue lost visible vector/model source evidence: ${JSON.stringify(replayFollowupRow.packet_queue_items)}`);
    }
    await page.waitForSelector('text=Download SAM31 follow-up packet', { timeout: 8_000 });
    const replayFollowupPacketDownloadPromise = page.waitForEvent('download');
    await page.locator(`button[data-sam31-sprinkler-replay-followup-packet-evidence-id="${latestSprinklerDecision.evidence_id}"]`).first().click();
    const replayFollowupPacketDownload = await replayFollowupPacketDownloadPromise;
    const replayFollowupPacketPath = await replayFollowupPacketDownload.path();
    const replayFollowupPacketSuggestedName = replayFollowupPacketDownload.suggestedFilename();
    const replayFollowupPacketDownloadBytes = replayFollowupPacketPath ? fs.statSync(replayFollowupPacketPath).size : 0;
    downloads.push({ suggestedName: replayFollowupPacketSuggestedName, bytes: replayFollowupPacketDownloadBytes });
    if (!replayFollowupPacketSuggestedName.includes('sam31-obstruction-clash-packet') || replayFollowupPacketDownloadBytes <= 0) {
      throw new Error(`Unexpected SAM31 follow-up packet download ${replayFollowupPacketSuggestedName} (${replayFollowupPacketDownloadBytes} bytes)`);
    }
    const replayFollowupPacket = JSON.parse(fs.readFileSync(replayFollowupPacketPath, 'utf8'));
    if (replayFollowupPacket.artifact_type !== 'halofire.sam31_obstruction_clash_packet.v1') {
      throw new Error(`Unexpected SAM31 follow-up packet type ${replayFollowupPacket.artifact_type}`);
    }
    if (replayFollowupPacket.source_followup_decision_evidence_id !== replayFollowupRow.latest_sam31_sprinkler_preliminary_replay_followup_decision.evidence_id) {
      throw new Error(`SAM31 follow-up packet source evidence mismatch: ${JSON.stringify(replayFollowupPacket)}`);
    }
    if (replayFollowupPacket.use_for_claims !== false || replayFollowupPacket.claim_gate_effect !== 'no_claims_cleared') {
      throw new Error(`SAM31 follow-up packet cleared a claim gate: ${JSON.stringify(replayFollowupPacket)}`);
    }
    if (replayFollowupPacket.source_openclaw_sam31_vector_model_artifact_evidence_id !== sprinklerAdapterPacket.source_openclaw_sam31_vector_model_artifact_evidence_id
      || !Array.isArray(replayFollowupPacket.source_linked_vector_overlays)
      || replayFollowupPacket.source_linked_vector_overlays.length < 1
      || !Array.isArray(replayFollowupPacket.source_linked_model_3d_candidates)
      || replayFollowupPacket.source_linked_model_3d_candidates.length < 1
      || !replayFollowupPacket.source_refs?.some((ref) => ref.evidence_type === 'openclaw_sam31_vector_model_artifact_packet')) {
      throw new Error(`SAM31 follow-up packet lost source-linked vector/model evidence: ${JSON.stringify(replayFollowupPacket)}`);
    }
    const replayFollowupPacketReviewKey = `${evidenceIds.boundaryEvidenceId}-${consumerReview.evidence_id}-${latestSprinklerDecision.evidence_id}-${replayFollowupRow.latest_sam31_sprinkler_preliminary_replay_followup_decision.evidence_id}-0`;
    await page.getByText('Save SAM31 follow-up packet review').first().click();
    await page.locator(`#sam31SprinklerReplayPacketReviewReviewer-${replayFollowupPacketReviewKey}`).fill('HaloFire obstruction smoke reviewer');
    await page.locator(`#sam31SprinklerReplayPacketReviewRef-${replayFollowupPacketReviewKey}`).fill('halofire://sam31/smoke/obstruction-clash/review.json');
    await page.locator(`#sam31SprinklerReplayPacketReviewSignedPacketRef-${replayFollowupPacketReviewKey}`).fill('halofire://sam31/smoke/obstruction-clash/signed-packet.json');
    await page.locator(`#sam31SprinklerReplayPacketReviewMarkedUpScreenshotRef-${replayFollowupPacketReviewKey}`).fill('halofire://sam31/smoke/obstruction-clash/markup.png');
    await page.locator(`#sam31SprinklerReplayPacketReviewNotes-${replayFollowupPacketReviewKey}`).fill('Smoke packet review only; claims remain blocked.');
    await page.locator(`button[data-sam31-sprinkler-replay-followup-packet-review-evidence-id="${latestSprinklerDecision.evidence_id}"]`).first().click();
    await page.waitForSelector(`text=Saved halofire_sam31_sprinkler_followup_packet_review_decision`, { timeout: 8_000 });
    const replayFollowupPacketReviewQueue = await request(`${PROJECT_PATH}/resolver-queue?sam31SprinklerReplay=ready&lane=obstruction_or_clash_review`, token);
    if ((replayFollowupPacketReviewQueue.summary?.sam31_sprinkler_packet_reviews_recorded || 0) < 1) {
      throw new Error(`SAM31 follow-up packet review was not recorded in resolver summary: ${JSON.stringify(replayFollowupPacketReviewQueue.summary)}`);
    }
    if ((replayFollowupPacketReviewQueue.summary?.sam31_approval_upload_resolver_rows || 0) < 3) {
      throw new Error(`SAM31 approval upload resolver rows were not recorded in resolver summary: ${JSON.stringify(replayFollowupPacketReviewQueue.summary)}`);
    }
    const replayFollowupPacketReviewItem = replayFollowupPacketReviewQueue.items.find((item) => item.evidence_id === evidenceIds.boundaryEvidenceId);
    const replayFollowupPacketReviewRows = replayFollowupPacketReviewItem?.sam31_sprinkler_preliminary_replay_queue_items || [];
    const replayFollowupPacketReviewRow = replayFollowupPacketReviewRows.find((row) => row.source_halofire_sam31_sprinkler_review_decision_evidence_id === latestSprinklerDecision.evidence_id);
    const replayFollowupPacketReviewPacket = replayFollowupPacketReviewRow?.packet_queue_items?.[0] || null;
    const replayFollowupPacketReview = replayFollowupPacketReviewPacket?.latest_packet_review_decision || null;
    if (!replayFollowupPacketReview) {
      throw new Error(`SAM31 follow-up packet review missing from queue row: ${JSON.stringify(replayFollowupPacketReviewRows)}`);
    }
    if (replayFollowupPacketReview.review_decision !== 'accepted_internal_alpha_packet' || replayFollowupPacketReview.claim_gate_effect !== 'no_claims_cleared') {
      throw new Error(`SAM31 follow-up packet review did not preserve no-claim state: ${JSON.stringify(replayFollowupPacketReview)}`);
    }
    const approvalRows = replayFollowupPacketReviewPacket?.approval_upload_resolver_rows || [];
    const approvalCodes = new Set(approvalRows.map((row) => row.code));
    for (const code of [
      'HALOFIRE_SAM31_PROFESSIONAL_APPROVAL_UPLOAD_MISSING',
      'HALOFIRE_SAM31_AHJ_APPROVAL_UPLOAD_MISSING',
      'HALOFIRE_SAM31_MANUFACTURER_EVIDENCE_UPLOAD_MISSING',
    ]) {
      if (!approvalCodes.has(code)) {
        throw new Error(`SAM31 approval upload resolver row ${code} missing: ${JSON.stringify(approvalRows)}`);
      }
    }
    if (approvalRows.some((row) => row.use_for_claims !== false || row.claim_gate_effect !== 'no_claims_cleared')) {
      throw new Error(`SAM31 approval upload resolver row cleared a claim gate: ${JSON.stringify(approvalRows)}`);
    }
    const professionalApprovalCode = 'HALOFIRE_SAM31_PROFESSIONAL_APPROVAL_UPLOAD_MISSING';
    await page.locator(`details:has([data-sam31-approval-upload-code="${professionalApprovalCode}"]) summary`).first().click();
    const professionalApprovalButton = page.locator(`[data-sam31-approval-upload-code="${professionalApprovalCode}"]`).first();
    const approvalDataset = await professionalApprovalButton.evaluate((button) => ({ ...button.dataset }));
    const approvalRowKey = [
      approvalDataset.sam31ApprovalUploadBoundaryEvidenceId || 'boundary',
      approvalDataset.sam31ApprovalUploadConsumerReviewEvidenceId || 'consumer',
      approvalDataset.sam31ApprovalUploadSprinklerReviewEvidenceId || 'sprinkler',
      approvalDataset.sam31ApprovalUploadFollowupEvidenceId || 'followup',
      approvalDataset.sam31ApprovalUploadPacketIndex || 0,
      approvalDataset.sam31ApprovalUploadPacketReviewEvidenceId || 'packetreview',
      approvalDataset.sam31ApprovalUploadCode || 'approval_upload_missing',
    ].join('-');
    await page.locator(`[id="sam31ApprovalUploadSourceRef-${approvalRowKey}"]`).fill('1881://sam31/professional-review/smoke-signed-review.pdf');
    await page.locator(`[id="sam31ApprovalUploadSourceFile-${approvalRowKey}"]`).fill('sam31-smoke-professional-review.pdf');
    await page.locator(`[id="sam31ApprovalUploadReviewerName-${approvalRowKey}"]`).fill('Smoke Licensed Reviewer');
    await page.locator(`[id="sam31ApprovalUploadReviewerTitle-${approvalRowKey}"]`).fill('Licensed Fire Protection Engineer');
    await page.locator(`[id="sam31ApprovalUploadSignedAt-${approvalRowKey}"]`).fill('2026-06-02T16:30:00.000Z');
    await page.locator(`[id="sam31ApprovalUploadOrganization-${approvalRowKey}"]`).fill('Halo Fire');
    await page.locator(`[id="sam31ApprovalUploadLicenseId-${approvalRowKey}"]`).fill('PE-SMOKE-SAM31');
    await page.locator(`[id="sam31ApprovalUploadNotes-${approvalRowKey}"]`).fill('Smoke uploaded signed professional review evidence for later gate validation only.');
    await professionalApprovalButton.click();
    await page.waitForSelector('text=Saved halofire.sam31_approval_upload_intake.v1 evidence', { timeout: 8_000 });
    const replayFollowupApprovalUploadQueue = await request(`${PROJECT_PATH}/resolver-queue?sam31SprinklerReplay=ready&lane=obstruction_or_clash_review`, token);
    if ((replayFollowupApprovalUploadQueue.summary?.sam31_approval_uploads_recorded || 0) < 1) {
      throw new Error(`SAM31 approval upload was not recorded in resolver summary: ${JSON.stringify(replayFollowupApprovalUploadQueue.summary)}`);
    }
    const replayFollowupApprovalUploadItem = replayFollowupApprovalUploadQueue.items.find((item) => item.evidence_id === evidenceIds.boundaryEvidenceId);
    const replayFollowupApprovalUploadRows = replayFollowupApprovalUploadItem?.sam31_sprinkler_preliminary_replay_queue_items || [];
    const replayFollowupApprovalUploadRow = replayFollowupApprovalUploadRows.find((row) => row.source_halofire_sam31_sprinkler_review_decision_evidence_id === latestSprinklerDecision.evidence_id);
    const packetWithApprovalUpload = replayFollowupApprovalUploadRow?.packet_queue_items?.[0] || null;
    const professionalApprovalRow = (packetWithApprovalUpload?.approval_upload_resolver_rows || []).find((row) => row.code === professionalApprovalCode);
    if (professionalApprovalRow?.status !== 'approval_upload_recorded_pending_gate_validation'
      || professionalApprovalRow?.latest_approval_upload_intake?.claim_gate_effect !== 'no_claims_cleared'
      || professionalApprovalRow?.use_for_claims !== false) {
      throw new Error(`SAM31 approval upload resolver row did not remain pending/no-claim: ${JSON.stringify(professionalApprovalRow)}`);
    }
    const gatesAfterApprovalUpload = await request(`${PROJECT_PATH}/claim-gates`, token);
    const professionalGate = gatesAfterApprovalUpload.find((gate) => gate.code === 'PROFESSIONAL_REVIEW_MISSING');
    if (professionalGate?.status !== 'blocked') {
      throw new Error(`SAM31 approval upload cleared or failed to create blocked professional gate: ${JSON.stringify(professionalGate)}`);
    }
    await page.locator('[data-sam31-approval-upload-resolve-gate-code="PROFESSIONAL_REVIEW_MISSING"]').first().click();
    await page.waitForSelector('text=Validated SAM31 approval upload gate PROFESSIONAL_REVIEW_MISSING', { timeout: 8_000 });
    const gatesAfterExplicitApprovalValidation = await request(`${PROJECT_PATH}/claim-gates`, token);
    const professionalGateAfterExplicitValidation = gatesAfterExplicitApprovalValidation.find((gate) => gate.code === 'PROFESSIONAL_REVIEW_MISSING');
    if (professionalGateAfterExplicitValidation?.status !== 'cleared') {
      throw new Error(`SAM31 explicit approval upload validation did not clear professional gate: ${JSON.stringify(professionalGateAfterExplicitValidation)}`);
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
      sprinklerReviewDecisionPacket: {
        artifact_type: sprinklerReviewDecisionPacket.artifact_type,
        suggestedName: sprinklerReviewPacketSuggestedName,
        source_halofire_sam31_sprinkler_review_decision_evidence_id: sprinklerReviewDecisionPacket.source_halofire_sam31_sprinkler_review_decision_evidence_id,
        preliminary_replay_inputs_type: sprinklerReviewDecisionPacket.preliminary_replay_inputs?.artifact_type,
        supported_sprinkler_review_lane: sprinklerReviewDecisionPacket.supported_sprinkler_review_lane,
        claim_gate_effect: sprinklerReviewDecisionPacket.claim_gate_effect,
      },
      sprinklerPreliminaryReplayArtifact: {
        artifact_type: sprinklerPreliminaryReplayArtifact.artifact_type,
        suggestedName: preliminaryReplaySuggestedName,
        source_halofire_sam31_sprinkler_review_decision_evidence_id: sprinklerPreliminaryReplayArtifact.source_halofire_sam31_sprinkler_review_decision_evidence_id,
        replay_inputs_type: sprinklerPreliminaryReplayArtifact.replay_inputs?.artifact_type,
        replay_output_type: sprinklerPreliminaryReplayArtifact.replay_output?.artifact_type,
        claim_gate_effect: sprinklerPreliminaryReplayArtifact.claim_gate_effect,
      },
      sprinklerPreliminaryReplayFollowup: {
        artifact_type: replayFollowupRow.latest_sam31_sprinkler_preliminary_replay_followup_decision.artifact_type,
        evidence_id: replayFollowupRow.latest_sam31_sprinkler_preliminary_replay_followup_decision.evidence_id,
        followup_decision: replayFollowupRow.latest_sam31_sprinkler_preliminary_replay_followup_decision.followup_decision,
        packet_queue_item_type: replayFollowupRow.packet_queue_items[0]?.artifact_type,
        claim_gate_effect: replayFollowupRow.latest_sam31_sprinkler_preliminary_replay_followup_decision.claim_gate_effect,
      },
      sprinklerPreliminaryReplayFollowupPacket: {
        artifact_type: replayFollowupPacket.artifact_type,
        suggestedName: replayFollowupPacketSuggestedName,
        source_followup_decision_evidence_id: replayFollowupPacket.source_followup_decision_evidence_id,
        source_packet_queue_item_artifact_type: replayFollowupPacket.source_packet_queue_item_artifact_type,
        claim_gate_effect: replayFollowupPacket.claim_gate_effect,
      },
      sprinklerPreliminaryReplayFollowupPacketReview: {
        artifact_type: replayFollowupPacketReview.artifact_type,
        evidence_id: replayFollowupPacketReview.evidence_id,
        review_decision: replayFollowupPacketReview.review_decision,
        source_packet_artifact_type: replayFollowupPacketReview.source_packet_artifact_type,
        claim_gate_effect: replayFollowupPacketReview.claim_gate_effect,
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

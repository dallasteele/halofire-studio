import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { COOPERATIVE_1881_PROJECT_NAME } from '../src/data/floorplans.js';
import { createSam31BridgeApp } from '../src/sam31/bridge.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3217;
const BASE = `http://127.0.0.1:${PORT}`;
const COOPERATIVE_1881_PATH = `/api/projects/${encodeURIComponent(COOPERATIVE_1881_PROJECT_NAME)}`;

let bridgeServer;
let bridgeBaseUrl;
let perceptionServer;
let perceptionBaseUrl;
let apiServer;
let tempDir;
let token;

function request(pathname, options = {}) {
  return fetch(`${BASE}${pathname}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
}

async function waitForHealth() {
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    try {
      const r = await request('/api/health');
      if (r.ok) return;
    } catch {
      // server is still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('HaloFire API did not become healthy');
}

beforeAll(async () => {
  const bridgeApp = createSam31BridgeApp();
  await new Promise((resolve) => {
    bridgeServer = bridgeApp.listen(0, '127.0.0.1', resolve);
  });
  const bridgeAddress = bridgeServer.address();
  bridgeBaseUrl = `http://127.0.0.1:${bridgeAddress.port}`;

  const perceptionApp = express();
  perceptionApp.use(express.json({ limit: '2mb' }));
  perceptionApp.post('/vision/sam31/extrapolate', (req, res) => {
    const body = req.body || {};
    const sections = Array.isArray(body.sections) ? body.sections : [];
    const objectHypotheses = Array.isArray(body.object_hypotheses) ? body.object_hypotheses : [];
    res.json({
      artifact_type: 'openclaw.sam31_llm_extrapolation_artifact',
      status: 'best_effort_extrapolation_ready',
      source_runtime: 'sam-3.1+llm',
      tool: {
        artifact_type: 'openclaw.sam31_llm_extrapolation_tool',
        action: {
          method: 'POST',
          href: '/vision/sam31/extrapolate',
          contract_ref: 'openclaw.sam31_extrapolation_contract',
        },
        claim_gate_effect: 'no_claims_cleared',
      },
      project_ref: body.project_ref,
      application: body.application || 'halo_fire',
      source_ref: body.source_ref,
      image_ref: body.image_ref,
      section_count: sections.length,
      object_hypothesis_count: objectHypotheses.length,
      source_refs: [
        {
          source_ref: body.source_ref,
          image_ref: body.image_ref,
          runtime: 'sam-3.1+llm',
        },
      ],
      product_review_action: {
        application: body.application || 'halo_fire',
        contract_ref: 'openclaw.sam31.application_contract.halo_fire.v1',
        status: 'ready_for_product_review_queue',
        next_action: 'Queue HaloFire room-boundary or sleeve/firestop review with SAM31 vector/3D best guesses; keep permit, AHJ, AutoSprink, fabrication, and manufacturer claims blocked.',
        claim_gate_effect: 'no_claims_cleared',
      },
      perception_packet: {
        artifact_type: 'openclaw.sam31_perception_packet',
        status: 'best_effort_perception_ready',
        project_ref: body.project_ref,
        application: body.application || 'halo_fire',
        source_runtime: 'sam-3.1+llm',
        source_ref: body.source_ref,
        image_ref: body.image_ref,
        perception_lanes: ['segmentation', 'object_identification', 'vector_overlay', 'model_3d_candidate', 'spatial_observation'],
        segments: sections,
        object_hypotheses: objectHypotheses,
        vector_overlays: [
          {
            id: 'vector:section-room-101',
            segment_id: sections[0]?.id || 'section-room-101',
            kind: 'polygon_path',
            svg_path: 'M 10 20 L 510 20 L 510 320 L 10 320 Z',
            confidence: 0.52,
            source: 'mock-openclaw-sam31',
          },
        ],
        model_3d_candidates: [
          {
            id: 'model3d:section-room-101',
            segment_id: sections[0]?.id || 'section-room-101',
            primitive: 'extruded_polygon',
            height_ft: 10,
            confidence: 0.33,
            source: 'mock-openclaw-sam31',
            limitations: ['Mock OpenClaw SAM31 artifact for deterministic HaloFire API test only.'],
          },
        ],
        blocked_claims: ['permit_ready', 'AHJ_approval', 'AutoSprink_parity'],
        claim_gate_effect: 'no_claims_cleared',
      },
      blocked_claims: ['permit_ready', 'AHJ_approval', 'AutoSprink_parity'],
      claim_gate_effect: 'no_claims_cleared',
      limitations: ['Mock OpenClaw SAM31 artifact for deterministic HaloFire API test only.'],
    });
  });
  await new Promise((resolve) => {
    perceptionServer = perceptionApp.listen(0, '127.0.0.1', resolve);
  });
  const perceptionAddress = perceptionServer.address();
  perceptionBaseUrl = `http://127.0.0.1:${perceptionAddress.port}`;

  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-sam31-status-'));
  apiServer = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: 'test',
      HALOFIRE_DB_PATH: path.join(tempDir, 'h.db'),
      JWT_SECRET: 'test-jwt-secret-with-more-than-32-characters',
      HALOFIRE_ADMIN_USER: 'admin',
      HALOFIRE_ADMIN_PASSWORD: 'sam31-status-test-pw',
      HALOFIRE_ALLOW_DEV_DEFAULTS: '0',
      HALOFIRE_CORS_ORIGINS: 'http://allowed.test',
      OPENCLAW_BRIDGE_URL: bridgeBaseUrl,
      OPENCLAW_PERCEPTION_URL: perceptionBaseUrl,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
  token = (await (await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: 'sam31-status-test-pw' }),
  })).json()).token;
});

afterAll(async () => {
  if (apiServer && !apiServer.killed) {
    apiServer.kill();
    await new Promise((resolve) => apiServer.once('exit', resolve));
  }
  if (bridgeServer) {
    await new Promise((resolve) => bridgeServer.close(resolve));
  }
  if (perceptionServer) {
    await new Promise((resolve) => perceptionServer.close(resolve));
  }
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('OpenClaw SAM31 bridge status API', () => {
  it('probes a configured bridge and reports verified reachability without clearing claims', async () => {
    const res = await request('/api/openclaw/sam31/status', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31_bridge_status',
      status: 'verified_reachable',
      tool_ref: 'pdfExtract:sam',
      bridge_url_configured: true,
      bridge_url: bridgeBaseUrl,
      bridge_reachable: true,
      openclaw_status: 'local-shim',
      sam31_status: 'online',
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(body.probe_status_url).toBe(`${bridgeBaseUrl}/status`);
    expect(body.observed_at).toEqual(expect.any(String));
    expect(body.supported_applications).toEqual(expect.arrayContaining(['halo_fire', 'landscout', 'nameforge']));
    expect(body.blocked_claims).toEqual(expect.arrayContaining(['OpenClaw_runtime_verified', 'permit_ready']));
    expect(body.limitations.join(' ')).toMatch(/does not clear/i);
    expect(body.raw_status).toEqual(expect.objectContaining({
      service: 'halofire-sam31-bridge',
      services: expect.objectContaining({
        sam31: expect.objectContaining({ status: 'online' }),
      }),
    }));
  });

  it('runs a SAM31 bridge invocation and persists a best-effort smoke artifact without clearing claims', async () => {
    const res = await request(`${COOPERATIVE_1881_PATH}/openclaw/sam31/smoke-artifact`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        pdfRef: 'provided-docs:Proposal-Cooperative-1881-Salt-Lake-City-UT-9-18-25.pdf#page=7',
        pdfPageIndex: 7,
        pdfScale: 0.083333,
        targets: ['building_outline', 'walls', 'rooms', 'sprinkler_obstructions'],
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31_bridge_smoke_artifact',
      status: 'sam31_invocation_verified',
      project_name: COOPERATIVE_1881_PROJECT_NAME,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(body.bridge_status).toEqual(expect.objectContaining({
      status: 'verified_reachable',
      bridge_reachable: true,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(body.invocation).toEqual(expect.objectContaining({
      tool: 'sam_segment_floorplan',
      endpoint: `${bridgeBaseUrl}/codex-bridge/invoke`,
    }));
    expect(body.sam31_request).toEqual(expect.objectContaining({
      service: 'sam-3.1',
      op: 'segment_floorplan',
      pdfRef: 'provided-docs:Proposal-Cooperative-1881-Salt-Lake-City-UT-9-18-25.pdf#page=7',
      pageIndex: 7,
      scale: 0.083333,
    }));
    expect(body.sam31_request.targets).toEqual(expect.arrayContaining(['building_outline', 'sprinkler_obstructions']));
    expect(body.result_summary).toEqual(expect.objectContaining({
      ok: true,
      source: 'sam-3.1-shim',
      runtime: 'halofire-local-sam31-bridge',
      layer_keys: expect.arrayContaining(['building_outline', 'walls', 'rooms']),
    }));
    expect(body.blocked_claims).toEqual(expect.arrayContaining([
      'geometry_accuracy',
      'permit_ready',
      'AutoSprink_parity',
      'SAM31_runtime_verified',
      'OpenClaw_runtime_verified',
    ]));
    expect(body.evidence).toEqual(expect.objectContaining({
      evidence_type: 'openclaw_sam31_bridge_smoke_artifact',
      source_file: 'OPENCLAW_BRIDGE_URL',
      source_ref: `${bridgeBaseUrl}/codex-bridge/invoke`,
      status: 'best_effort',
    }));
    const savedNotes = JSON.parse(body.evidence.notes);
    expect(savedNotes).toEqual(expect.objectContaining({
      kind: 'openclaw_sam31_bridge_smoke_artifact',
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(savedNotes.artifact.status).toBe('sam31_invocation_verified');

    const evidenceRes = await request(`${COOPERATIVE_1881_PATH}/evidence`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(evidenceRes.status).toBe(200);
    const evidenceRows = await evidenceRes.json();
    expect(evidenceRows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: body.evidence.id,
        evidence_type: 'openclaw_sam31_bridge_smoke_artifact',
        status: 'best_effort',
      }),
    ]));
  });

  it('surfaces the SAM31 bridge smoke action and latest artifact in the resolver queue', async () => {
    const boundaryRes = await request(`${COOPERATIVE_1881_PATH}/pdf-boundary-decision`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        pdfPageIndex: 4,
        pdfScale: 0.075,
        pdfExtract: 'sam-action-test-outline',
        source_file: 'Proposal-Cooperative-1881-Salt-Lake-City-UT-9-18-25.pdf',
        source_ref: '1881 plan PDF sheet 4 / SAM31 smoke queue action',
        candidate: {
          mode: 'outline',
          label: 'SAM31 queue smoke outline',
          status: 'candidate',
          bbox: { x: 10, y: 20, width: 500, height: 300 },
          segmentCount: 9,
        },
      }),
    });
    expect(boundaryRes.status).toBe(201);
    const boundary = await boundaryRes.json();

    const beforeQueueRes = await request(`${COOPERATIVE_1881_PATH}/resolver-queue`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(beforeQueueRes.status).toBe(200);
    const beforeQueue = await beforeQueueRes.json();
    const beforeItem = beforeQueue.items.find((row) => row.evidence_id === boundary.id);
    expect(beforeItem.sam31_bridge_smoke_action).toEqual(expect.objectContaining({
      label: 'Run OpenClaw SAM31 bridge smoke artifact',
      method: 'POST',
      href: `${COOPERATIVE_1881_PATH}/openclaw/sam31/smoke-artifact`,
      status: 'configured_unverified',
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(beforeItem.sam31_bridge_smoke_action.request_body).toEqual(expect.objectContaining({
      pdfRef: 'Proposal-Cooperative-1881-Salt-Lake-City-UT-9-18-25.pdf',
      pdfPageIndex: 4,
      pdfScale: 0.075,
    }));
    expect(beforeItem.sam31_bridge_smoke_action.request_body.targets).toEqual(expect.arrayContaining([
      'building_outline',
      'walls',
      'rooms',
      'sprinkler_obstructions',
    ]));
    expect(beforeItem.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'Run OpenClaw SAM31 bridge smoke artifact',
        href: `${COOPERATIVE_1881_PATH}/openclaw/sam31/smoke-artifact`,
        method: 'POST',
      }),
    ]));

    const smokeRes = await request(beforeItem.sam31_bridge_smoke_action.href, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(beforeItem.sam31_bridge_smoke_action.request_body),
    });
    expect(smokeRes.status).toBe(201);
    const smoke = await smokeRes.json();

    const afterQueueRes = await request(`${COOPERATIVE_1881_PATH}/resolver-queue`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(afterQueueRes.status).toBe(200);
    const afterQueue = await afterQueueRes.json();
    const afterItem = afterQueue.items.find((row) => row.evidence_id === boundary.id);
    expect(afterItem.latest_openclaw_sam31_bridge_smoke_artifact).toEqual(expect.objectContaining({
      evidence_id: smoke.id,
      evidence_status: 'best_effort',
      status: 'sam31_invocation_verified',
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(afterItem.latest_openclaw_sam31_bridge_smoke_artifact.result_summary).toEqual(expect.objectContaining({
      source: 'sam-3.1-shim',
      runtime: 'halofire-local-sam31-bridge',
    }));
    expect(afterQueue.summary.sam31_bridge_smoke_recorded).toBeGreaterThanOrEqual(1);
  });

  it('posts the visual-audit packet to OpenClaw SAM31 extrapolate and persists product-review evidence', async () => {
    const boundaryRes = await request(`${COOPERATIVE_1881_PATH}/pdf-boundary-decision`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        pdfPageIndex: 8,
        pdfScale: 0.08,
        pdfExtract: 'sam31-extrapolate-outline',
        source_file: 'Proposal-Cooperative-1881-Salt-Lake-City-UT-9-18-25.pdf',
        source_ref: '1881 plan PDF sheet 8 / SAM31 extrapolate queue action',
        candidate: {
          mode: 'outline',
          label: 'SAM31 extrapolate outline',
          status: 'candidate',
          bbox: { x: 10, y: 20, width: 500, height: 300 },
          segmentCount: 11,
        },
      }),
    });
    expect(boundaryRes.status).toBe(201);
    const boundary = await boundaryRes.json();

    const queueRes = await request(`${COOPERATIVE_1881_PATH}/resolver-queue`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(queueRes.status).toBe(200);
    const queue = await queueRes.json();
    const item = queue.items.find((row) => row.evidence_id === boundary.id);
    expect(item.openclaw_sam31_extrapolation_action).toEqual(expect.objectContaining({
      label: 'Run OpenClaw SAM31 extrapolation artifact',
      method: 'POST',
      href: `${COOPERATIVE_1881_PATH}/resolver-packets/pdf-boundary/${boundary.id}/openclaw/sam31/extrapolation-artifact`,
      status: 'configured_unverified',
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(item.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'Run OpenClaw SAM31 extrapolation artifact',
        method: 'POST',
      }),
    ]));

    const artifactRes = await request(item.openclaw_sam31_extrapolation_action.href, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(artifactRes.status).toBe(201);
    const artifact = await artifactRes.json();
    expect(artifact).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31_llm_extrapolation_artifact',
      status: 'best_effort_extrapolation_ready',
      project_name: COOPERATIVE_1881_PROJECT_NAME,
      source_pdf_boundary_evidence_id: boundary.id,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(artifact.openclaw_endpoint).toBe(`${perceptionBaseUrl}/vision/sam31/extrapolate`);
    expect(artifact.request.sections[0]).toEqual(expect.objectContaining({
      id: 'candidate:pdf-boundary',
      semantic_label: 'room_boundary_candidate',
    }));
    expect(artifact.perception_packet).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31_perception_packet',
      project_ref: `halo_fire:${COOPERATIVE_1881_PROJECT_NAME}`,
      application: 'halo_fire',
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(artifact.product_review_action).toEqual(expect.objectContaining({
      status: 'ready_for_product_review_queue',
      contract_ref: 'openclaw.sam31.application_contract.halo_fire.v1',
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(artifact.evidence).toEqual(expect.objectContaining({
      evidence_type: 'openclaw_sam31_extrapolation_artifact',
      source_file: 'OPENCLAW_PERCEPTION_URL',
      source_ref: `${perceptionBaseUrl}/vision/sam31/extrapolate`,
      status: 'best_effort',
    }));
    const notes = JSON.parse(artifact.evidence.notes);
    expect(notes).toEqual(expect.objectContaining({
      kind: 'openclaw_sam31_extrapolation_artifact',
      claim_gate_effect: 'no_claims_cleared',
    }));

    const afterQueueRes = await request(`${COOPERATIVE_1881_PATH}/resolver-queue`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(afterQueueRes.status).toBe(200);
    const afterQueue = await afterQueueRes.json();
    const afterItem = afterQueue.items.find((row) => row.evidence_id === boundary.id);
    expect(afterItem.latest_openclaw_sam31_extrapolation_artifact).toEqual(expect.objectContaining({
      evidence_id: artifact.id,
      evidence_status: 'best_effort',
      status: 'best_effort_extrapolation_ready',
      source_pdf_boundary_evidence_id: boundary.id,
      product_review_action: expect.objectContaining({
        status: 'ready_for_product_review_queue',
        claim_gate_effect: 'no_claims_cleared',
      }),
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(afterQueue.summary.sam31_extrapolation_recorded).toBeGreaterThanOrEqual(1);

    const reviewRes = await request(`${COOPERATIVE_1881_PATH}/resolver-packets/pdf-boundary/${boundary.id}/openclaw/sam31/extrapolation-review`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        source_openclaw_sam31_extrapolation_evidence_id: artifact.id,
        review_decision: 'replaced',
        reviewer_name: 'HaloFire estimator',
        replacement_ref: '1881://employee-review/sam31/extrapolation/room-101',
        replacement_values: {
          object_hypotheses: [
            {
              id: 'obj:door-reviewed',
              label: 'rated corridor door',
              segment_id: 'section-room-101',
              confidence: 0.82,
              source_ref: '1881://employee-review/sam31/extrapolation/door',
            },
          ],
          vector_overlays: [
            {
              id: 'vector:room-101-reviewed',
              kind: 'polygon_path',
              svg_path: 'M 12 22 L 508 22 L 508 318 L 12 318 Z',
              source_ref: '1881://employee-review/sam31/extrapolation/vector',
            },
          ],
          model_3d_candidates: [
            {
              id: 'model3d:room-101-reviewed',
              primitive: 'extruded_polygon',
              height_ft: 11,
              source_ref: '1881://employee-review/sam31/extrapolation/model3d',
            },
          ],
          confidence: 0.81,
        },
        notes: 'Employee replacement values for temporary SAM31 extrapolation only.',
      }),
    });
    expect(reviewRes.status).toBe(201);
    const review = await reviewRes.json();
    expect(review).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31_extrapolation_product_review',
      status: 'present',
      source_pdf_boundary_evidence_id: boundary.id,
      source_openclaw_sam31_extrapolation_evidence_id: artifact.id,
      review_decision: 'replaced',
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(review.evidence).toEqual(expect.objectContaining({
      evidence_type: 'openclaw_sam31_extrapolation_review',
      status: 'present',
    }));
    expect(review.replacement_values).toEqual(expect.objectContaining({
      object_hypotheses: expect.any(Array),
      vector_overlays: expect.any(Array),
      model_3d_candidates: expect.any(Array),
      confidence: 0.81,
    }));
    expect(review.replaced_fields).toEqual(expect.arrayContaining([
      'object_hypotheses',
      'vector_overlays',
      'model_3d_candidates',
      'confidence',
    ]));

    const reviewedQueueRes = await request(`${COOPERATIVE_1881_PATH}/resolver-queue`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(reviewedQueueRes.status).toBe(200);
    const reviewedQueue = await reviewedQueueRes.json();
    const reviewedItem = reviewedQueue.items.find((row) => row.evidence_id === boundary.id);
    expect(reviewedItem.latest_openclaw_sam31_extrapolation_review).toEqual(expect.objectContaining({
      evidence_id: review.id,
      evidence_status: 'present',
      review_decision: 'replaced',
      source_openclaw_sam31_extrapolation_evidence_id: artifact.id,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(reviewedQueue.summary.sam31_extrapolation_reviews_recorded).toBeGreaterThanOrEqual(1);

    const packetRes = await request(`${COOPERATIVE_1881_PATH}/resolver-packets/pdf-boundary/${boundary.id}/openclaw/sam31/extrapolation-review-packet`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(packetRes.status).toBe(200);
    const packet = await packetRes.json();
    expect(packet).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31_extrapolation_product_review_packet',
      status: 'ready_for_sprinkler_cad_review',
      project_name: COOPERATIVE_1881_PROJECT_NAME,
      source_pdf_boundary_evidence_id: boundary.id,
      source_openclaw_sam31_extrapolation_evidence_id: artifact.id,
      source_openclaw_sam31_extrapolation_review_evidence_id: review.id,
      claim_gate_effect: 'no_claims_cleared',
      download_name: expect.stringContaining('sam31-extrapolation-product-review-packet'),
    }));
    expect(packet.reviewed_values).toEqual(expect.objectContaining({
      object_hypotheses: expect.arrayContaining([
        expect.objectContaining({ id: 'obj:door-reviewed', label: 'rated corridor door' }),
      ]),
      vector_overlays: expect.arrayContaining([
        expect.objectContaining({ id: 'vector:room-101-reviewed' }),
      ]),
      model_3d_candidates: expect.arrayContaining([
        expect.objectContaining({ id: 'model3d:room-101-reviewed', primitive: 'extruded_polygon' }),
      ]),
      confidence: 0.81,
    }));
    expect(packet.downstream_review_lanes).toEqual(expect.arrayContaining([
      'sprinkler_obstruction_review',
      'cad_vector_overlay_review',
      'model_3d_candidate_review',
      'room_boundary_visual_audit',
    ]));
    expect(packet.source_refs).toEqual(expect.arrayContaining([
      expect.objectContaining({ evidence_id: boundary.id, evidence_type: 'pdf_boundary_decision' }),
      expect.objectContaining({ evidence_id: artifact.id, evidence_type: 'openclaw_sam31_extrapolation_artifact' }),
      expect.objectContaining({ evidence_id: review.id, evidence_type: 'openclaw_sam31_extrapolation_review' }),
    ]));
    expect(packet.blocked_claims).toEqual(expect.arrayContaining([
      'permit_ready',
      'AHJ_approval',
      'AutoSprink_parity',
      'professional_approval',
      'SAM31_runtime_verified',
      'OpenClaw_runtime_verified',
    ]));
  });

  it('carries saved bridge smoke artifacts into SAM31 audit defaults and replay evidence without clearing claims', async () => {
    const boundaryRes = await request(`${COOPERATIVE_1881_PATH}/pdf-boundary-decision`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        pdfPageIndex: 6,
        pdfScale: 0.0625,
        pdfExtract: 'sam31-smoke-default-outline',
        source_file: 'Proposal-Cooperative-1881-Salt-Lake-City-UT-9-18-25.pdf',
        source_ref: '1881 plan PDF sheet 6 / SAM31 smoke-to-review default',
        candidate: {
          mode: 'outline',
          label: 'SAM31 smoke default outline',
          status: 'candidate',
          bbox: { x: 40, y: 50, width: 620, height: 340 },
          segmentCount: 14,
        },
      }),
    });
    expect(boundaryRes.status).toBe(201);
    const boundary = await boundaryRes.json();

    const queueRes = await request(`${COOPERATIVE_1881_PATH}/resolver-queue`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(queueRes.status).toBe(200);
    const queue = await queueRes.json();
    const item = queue.items.find((row) => row.evidence_id === boundary.id);
    expect(item.sam31_bridge_smoke_action.request_body.source_pdf_boundary_evidence_id).toBe(boundary.id);

    const smokeRes = await request(item.sam31_bridge_smoke_action.href, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(item.sam31_bridge_smoke_action.request_body),
    });
    expect(smokeRes.status).toBe(201);
    const smoke = await smokeRes.json();

    const packetRes = await request(`${COOPERATIVE_1881_PATH}/resolver-packets/pdf-boundary/${boundary.id}/sam31-visual-audit`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(packetRes.status).toBe(200);
    const packet = await packetRes.json();
    expect(packet.latest_openclaw_sam31_bridge_smoke_artifact).toEqual(expect.objectContaining({
      evidence_id: smoke.id,
      evidence_status: 'best_effort',
      status: 'sam31_invocation_verified',
      source_pdf_boundary_evidence_id: boundary.id,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(packet.employee_capture_defaults).toEqual(expect.objectContaining({
      source_openclaw_sam31_bridge_smoke_evidence_id: smoke.id,
      sam31_result_ref: `openclaw-sam31-smoke-artifact:${smoke.id}`,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(packet.employee_capture_defaults.console_log_ref).toContain('/codex-bridge/invoke');
    expect(packet.source_refs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        evidence_id: smoke.id,
        evidence_type: 'openclaw_sam31_bridge_smoke_artifact',
        claim_gate_effect: 'no_claims_cleared',
      }),
    ]));

    const auditRes = await request(`${COOPERATIVE_1881_PATH}/resolver-packets/pdf-boundary/${boundary.id}/sam31-visual-audit/results`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        review_decision: 'corrected',
        reviewer_name: 'Halo Fire SAM bridge reviewer',
        source_openclaw_sam31_bridge_smoke_evidence_id: packet.employee_capture_defaults.source_openclaw_sam31_bridge_smoke_evidence_id,
        sam31_result_ref: packet.employee_capture_defaults.sam31_result_ref,
        screenshot_ref: 'employee://sam31/sheet-6-after-smoke-review.png',
        console_log_ref: packet.employee_capture_defaults.console_log_ref,
        marked_up_plan_ref: 'employee://sam31/sheet-6-marked-up-boundary.png',
        corrected_room_polygons: [
          {
            room_id: 'sam31-smoke-reviewed-room',
            source_ref: packet.employee_capture_defaults.sam31_result_ref,
            polygon: [[0, 0], [42, 0], [42, 12], [0, 12]],
          },
        ],
        issue_list: [
          {
            issue_type: 'sam31_bridge_smoke_review_required',
            severity: 'blocking',
            observed: 'Bridge smoke produced best-effort segmentation only.',
            expected: 'Employee reviewed boundary before replay.',
            required_action: 'Keep regulated claims blocked until professional/AHJ evidence exists.',
          },
        ],
      }),
    });
    expect(auditRes.status).toBe(201);
    const audit = await auditRes.json();
    expect(audit.result).toEqual(expect.objectContaining({
      source_openclaw_sam31_bridge_smoke_evidence_id: smoke.id,
      sam31_result_ref: `openclaw-sam31-smoke-artifact:${smoke.id}`,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(audit.result.openclaw_sam31_bridge_smoke_artifact).toEqual(expect.objectContaining({
      evidence_id: smoke.id,
      status: 'sam31_invocation_verified',
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(audit.result.source_refs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        evidence_id: smoke.id,
        evidence_type: 'openclaw_sam31_bridge_smoke_artifact',
        claim_gate_effect: 'no_claims_cleared',
      }),
    ]));

    const replayRes = await request(`${COOPERATIVE_1881_PATH}/resolver-packets/pdf-boundary/${boundary.id}/replay-input`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(replayRes.status).toBe(200);
    const replay = await replayRes.json();
    expect(replay).toEqual(expect.objectContaining({
      review_source: 'latest_sam31_visual_audit',
      source_openclaw_sam31_bridge_smoke_evidence_id: smoke.id,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(replay.openclaw_sam31_bridge_smoke_artifact).toEqual(expect.objectContaining({
      evidence_id: smoke.id,
      source_pdf_boundary_evidence_id: boundary.id,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(replay.sprinkler_bid_request).toEqual(expect.objectContaining({
      source_openclaw_sam31_bridge_smoke_evidence_id: smoke.id,
      use_for_claims: false,
    }));
    expect(replay.source_refs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        evidence_id: smoke.id,
        evidence_type: 'openclaw_sam31_bridge_smoke_artifact',
        claim_gate_effect: 'no_claims_cleared',
      }),
    ]));
    expect(replay.blocked_claims).toEqual(expect.arrayContaining([
      'geometry_accuracy',
      'permit_ready',
      'AutoSprink_parity',
      'SAM31_runtime_verified',
      'OpenClaw_runtime_verified',
    ]));
  });
});

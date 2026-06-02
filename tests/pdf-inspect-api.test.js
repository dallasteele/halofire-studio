import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { COOPERATIVE_1881_PROJECT_NAME } from '../src/data/floorplans.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3202;
const BASE = `http://127.0.0.1:${PORT}`;
const COOPERATIVE_1881_PATH = `/api/projects/${encodeURIComponent(COOPERATIVE_1881_PROJECT_NAME)}`;

let server;
let tempDir;
let token;

function makeMultiPagePdf() {
  const streams = [
    '0 0 m 300 0 l 300 200 l 0 200 l 0 0 l S\n',
    '0 0 m 612 0 l 612 792 l 0 792 l 0 0 l S\n',
    '0 0 m 840 0 l 840 594 l 0 594 l 0 0 l S\n',
  ];
  const objects = [
    null,
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << >> >>',
    `<< /Length ${streams[0].length} >>\nstream\n${streams[0]}endstream`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 6 0 R /Resources << >> >>',
    `<< /Length ${streams[1].length} >>\nstream\n${streams[1]}endstream`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 840 594] /Contents 8 0 R /Resources << >> >>',
    `<< /Length ${streams[2].length} >>\nstream\n${streams[2]}endstream`,
  ];
  let pdf = '%PDF-1.7\n';
  const offsets = [];
  for (let i = 1; i < objects.length; i += 1) {
    offsets[i] = Buffer.byteLength(pdf, 'latin1');
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefStart = Buffer.byteLength(pdf, 'latin1');
  let xref = `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objects.length; i += 1) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += xref;
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

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
  throw new Error('server not healthy');
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-pdf-inspect-'));
  server = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: 'test',
      HALOFIRE_DB_PATH: path.join(tempDir, 'h.db'),
      JWT_SECRET: 'test-jwt-secret-with-more-than-32-characters',
      HALOFIRE_ADMIN_USER: 'admin',
      HALOFIRE_ADMIN_PASSWORD: 'pdf-inspect-test-pw',
      HALOFIRE_ALLOW_DEV_DEFAULTS: '0',
      HALOFIRE_CORS_ORIGINS: 'http://allowed.test',
      OPENCLAW_BRIDGE_URL: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
  token = (await (await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: 'pdf-inspect-test-pw' }),
  })).json()).token;
});

afterAll(async () => {
  if (server && !server.killed) {
    server.kill();
    await new Promise((resolve) => server.once('exit', resolve));
  }
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('PDF page inspection API', () => {
  it('requires authentication', async () => {
    const res = await request('/api/pdf/inspect', {
      method: 'POST',
      body: JSON.stringify({ pdf: makeMultiPagePdf().toString('base64') }),
    });
    expect(res.status).toBe(401);
  });

  it('returns page count and per-page dimensions for employee page selection', async () => {
    const res = await request('/api/pdf/inspect', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ pdf: makeMultiPagePdf().toString('base64') }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pageCount).toBe(3);
    expect(body.pages).toEqual([
      { index: 0, widthPt: 300, heightPt: 200, rotation: 0 },
      { index: 1, widthPt: 612, heightPt: 792, rotation: 0 },
      { index: 2, widthPt: 840, heightPt: 594, rotation: 0 },
    ]);
    expect(body.note).toContain('page selection');
    expect(body.blockedClaims).toEqual(expect.arrayContaining(['geometry_accuracy', 'AHJ_approval']));
  }, 30000);

  it('rejects an invalid PDF with 400', async () => {
    const res = await request('/api/pdf/inspect', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ pdf: Buffer.from('not a pdf').toString('base64') }),
    });
    expect(res.status).toBe(400);
  }, 30000);

  it('returns selected-page boundary candidates without clearing regulated claims', async () => {
    const res = await request('/api/pdf/boundary-candidates', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        pdf: makeMultiPagePdf().toString('base64'),
        pdfPageIndex: 0,
        pdfScale: 0.1,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pageIndex).toBe(0);
    expect(body.scale).toBe(0.1);
    expect(body.candidates.map((c) => c.mode)).toEqual([
      'vector',
      'dominant',
      'fullExtent',
      'outline',
      'wallLayer',
    ]);
    for (const candidate of body.candidates) {
      expect(candidate.status).toBe('candidate');
      expect(candidate.bbox.widthFt).toBeGreaterThan(0);
      expect(candidate.bbox.heightFt).toBeGreaterThan(0);
      expect(candidate.segmentCount).toBeGreaterThan(0);
      expect(candidate.blockedClaims).toEqual(expect.arrayContaining(['geometry_accuracy', 'AHJ_approval']));
    }
    const outline = body.candidates.find((c) => c.mode === 'outline');
    expect(outline.method).toBeTruthy();
    expect(outline.areaSqft).toBeGreaterThan(0);
    const wallLayer = body.candidates.find((c) => c.mode === 'wallLayer');
    expect(wallLayer.method).toBeTruthy();
    expect(wallLayer.wallSegmentCount).toBeGreaterThan(0);
    expect(body.note).toContain('candidate');
  }, 30000);

  it('rejects boundary candidates when operator scale is missing', async () => {
    const res = await request('/api/pdf/boundary-candidates', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        pdf: makeMultiPagePdf().toString('base64'),
        pdfPageIndex: 0,
      }),
    });
    expect(res.status).toBe(400);
  }, 30000);

  it('persists an employee-selected boundary decision as best-effort evidence for 1881 without clearing gates', async () => {
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
    const res = await request(`${COOPERATIVE_1881_PATH}/pdf-boundary-decision`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        pdfPageIndex: 7,
        pdfScale: 0.0833,
        pdfExtract: 'outline',
        candidate,
        source_file: 'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx',
        source_ref: '1881 plan PDF sheet 7 / outline candidate',
        notes: 'Employee chose sheet 7 and outline extraction pending professional review.',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.evidence.evidence_type).toBe('pdf_boundary_decision');
    expect(body.evidence.status).toBe('best_effort');
    expect(body.decision.projectName).toBe(COOPERATIVE_1881_PROJECT_NAME);
    expect(body.decision.pageIndex).toBe(7);
    expect(body.decision.scale).toBe(0.0833);
    expect(body.decision.extractMode).toBe('outline');
    expect(body.decision.candidate.bbox.widthFt).toBe(120);
    expect(body.decision.blockedClaims).toEqual(expect.arrayContaining(['AutoSprink_parity', 'permit_ready']));

    const latest = await (await request(`${COOPERATIVE_1881_PATH}/pdf-boundary-decision`, {
      headers: { Authorization: `Bearer ${token}` },
    })).json();
    expect(latest.decision.pageIndex).toBe(7);
    expect(latest.evidence.status).toBe('best_effort');

    const evidence = await (await request(`${COOPERATIVE_1881_PATH}/evidence`, {
      headers: { Authorization: `Bearer ${token}` },
    })).json();
    const row = evidence.find((e) => e.id === body.evidence.id);
    expect(row).toBeTruthy();
    expect(row.status).toBe('best_effort');
    expect(row.notes).toContain('claims still blocked');

    const queue = await (await request(`${COOPERATIVE_1881_PATH}/resolver-queue`, {
      headers: { Authorization: `Bearer ${token}` },
    })).json();
    const item = queue.items.find((q) => q.kind === 'room_boundary_visual_audit');
    expect(item).toBeTruthy();
    expect(item.status).toBe('ready');
    expect(item.evidence_id).toBe(body.evidence.id);
    expect(item.input_defaults.pdfPageIndex).toBe(7);
    expect(item.input_defaults.pdfScale).toBe(0.0833);
    expect(item.input_defaults.pdfExtract).toBe('outline');
    expect(item.input_defaults.candidate.bbox.widthFt).toBe(120);
    expect(item.blocked_claims).toEqual(expect.arrayContaining(['geometry_accuracy', 'AutoSprink_parity']));
    expect(item.next_action).toMatch(/room-boundary/i);
    expect(item.acceptable_evidence).toEqual(expect.arrayContaining(['employee room-boundary review packet']));
    expect(item.ai_fallback).toMatch(/SAM/i);

    const packetRes = await request(`${COOPERATIVE_1881_PATH}/resolver-packets/pdf-boundary/${body.evidence.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(packetRes.status).toBe(200);
    const packet = await packetRes.json();
    expect(packet.artifact_type).toBe('room_boundary_review_packet');
    expect(packet.project_name).toBe(COOPERATIVE_1881_PROJECT_NAME);
    expect(packet.source_evidence_id).toBe(body.evidence.id);
    expect(packet.source_ref).toBe('1881 plan PDF sheet 7 / outline candidate');
    expect(packet.download_name).toContain('room-boundary-review-packet');
    expect(packet.input_defaults).toMatchObject({
      pdfPageIndex: 7,
      pdfScale: 0.0833,
      pdfExtract: 'outline',
    });
    expect(packet.candidate_summary).toMatchObject({
      mode: 'outline',
      label: 'Wall-network outline',
      segmentCount: 12,
      method: 'wall-network-outline',
    });
    expect(packet.source_refs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        evidence_id: body.evidence.id,
        evidence_type: 'pdf_boundary_decision',
        source_ref: '1881 plan PDF sheet 7 / outline candidate',
      }),
    ]));
    expect(packet.review_steps.join(' ')).toMatch(/marked-up plan screenshot/i);
    expect(packet.employee_decision_fields).toEqual(expect.arrayContaining([
      'review_decision',
      'corrected_room_polygons',
      'issue_list',
      'marked_up_plan_ref',
    ]));
    expect(packet.issue_list_template[0]).toEqual(expect.objectContaining({
      issue_type: 'room_boundary_mismatch',
      required_action: expect.stringMatching(/correct/i),
    }));
    expect(packet.acceptable_evidence).toEqual(expect.arrayContaining(['employee room-boundary review packet']));
    expect(packet.blocked_claims).toEqual(expect.arrayContaining(['geometry_accuracy', 'AutoSprink_parity', 'permit_ready']));
    expect(packet.claim_gate_effect).toBe('no_claims_cleared');
    expect(packet.limitations.join(' ')).toMatch(/does not prove/i);

    const samPacketRes = await request(`${COOPERATIVE_1881_PATH}/resolver-packets/pdf-boundary/${body.evidence.id}/sam31-visual-audit`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(samPacketRes.status).toBe(200);
    const samPacket = await samPacketRes.json();
    expect(samPacket).toEqual(expect.objectContaining({
      artifact_type: 'sam31_room_boundary_visual_audit_packet',
      status: 'ready_for_sam31_visual_audit',
      project_name: COOPERATIVE_1881_PROJECT_NAME,
      source_evidence_id: body.evidence.id,
      source_evidence_type: 'pdf_boundary_decision',
      source_runtime: 'sam-3.1',
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(samPacket.download_name).toContain('sam31-room-boundary-visual-audit-packet');
    expect(samPacket.sam31_request).toEqual(expect.objectContaining({
      service: 'sam-3.1',
      op: 'segment_floorplan',
      pageIndex: 7,
      scale: 0.0833,
      pdfRef: expect.any(String),
    }));
    expect(samPacket.sam31_request.targets).toEqual(expect.arrayContaining(['building_outline', 'walls', 'rooms', 'layers']));
    expect(samPacket.bridge).toEqual(expect.objectContaining({
      openclaw_bridge_url_configured: false,
      local_bridge_command: 'npm run sam31:bridge',
    }));
    expect(samPacket.employee_capture_fields).toEqual(expect.arrayContaining([
      'sam31_result_ref',
      'screenshot_ref',
      'console_log_ref',
      'marked_up_plan_ref',
      'issue_list',
      'corrected_room_polygons',
    ]));
    expect(samPacket.supported_evidence_lanes).toEqual(expect.arrayContaining([
      'room_boundary_visual_audit',
      'spatial_observation_correction_loop',
    ]));
    expect(samPacket.source_refs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        evidence_id: body.evidence.id,
        evidence_type: 'pdf_boundary_decision',
      }),
    ]));
    expect(samPacket.blocked_claims).toEqual(
      expect.arrayContaining(['geometry_accuracy', 'permit_ready', 'AHJ_approval', 'PE_review', 'AutoSprink_parity']),
    );
    expect(samPacket.limitations.join(' ')).toMatch(/does not prove/i);

    const samResultRes = await request(`${COOPERATIVE_1881_PATH}/resolver-packets/pdf-boundary/${body.evidence.id}/sam31-visual-audit/results`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        review_decision: 'corrected',
        reviewer_name: 'Halo Fire SAM reviewer',
        sam31_result_ref: '1881://sam31/sheet-7-segmentation.json',
        screenshot_ref: '1881://sam31/sheet-7-overlay.png',
        console_log_ref: '1881://sam31/sheet-7-console.log',
        marked_up_plan_ref: '1881://marked-up/sheet-7-sam31-room-boundary.png',
        corrected_room_polygons: [
          {
            room_id: 'sam31-corridor-a',
            source_ref: '1881://sam31/sheet-7-segmentation.json',
            polygon: [[0, 0], [30, 0], [30, 10], [0, 10]],
          },
        ],
        issue_list: [
          {
            issue_type: 'sam31_visual_boundary_mismatch',
            severity: 'blocking',
            observed: 'SAM included the annotation border.',
            expected: 'Only the corridor boundary.',
            required_action: 'Use corrected SAM review polygon for replay.',
          },
        ],
        notes: 'SAM 3.1 result persisted for internal-alpha correction only.',
      }),
    });
    expect(samResultRes.status).toBe(201);
    const samResult = await samResultRes.json();
    expect(samResult.evidence.evidence_type).toBe('sam31_room_boundary_visual_audit');
    expect(samResult.evidence.status).toBe('best_effort');
    expect(samResult.result).toEqual(expect.objectContaining({
      source_evidence_id: body.evidence.id,
      review_decision: 'corrected',
      reviewer_name: 'Halo Fire SAM reviewer',
      sam31_result_ref: '1881://sam31/sheet-7-segmentation.json',
      screenshot_ref: '1881://sam31/sheet-7-overlay.png',
      console_log_ref: '1881://sam31/sheet-7-console.log',
      marked_up_plan_ref: '1881://marked-up/sheet-7-sam31-room-boundary.png',
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(samResult.result.corrected_room_polygons[0].room_id).toBe('sam31-corridor-a');
    expect(samResult.result.issue_list[0].issue_type).toBe('sam31_visual_boundary_mismatch');
    expect(samResult.result.blocked_claims).toEqual(expect.arrayContaining(['geometry_accuracy', 'permit_ready', 'AutoSprink_parity']));

    const evidenceAfterSamResult = await (await request(`${COOPERATIVE_1881_PATH}/evidence`, {
      headers: { Authorization: `Bearer ${token}` },
    })).json();
    const samResultRow = evidenceAfterSamResult.find((e) => e.id === samResult.evidence.id);
    expect(samResultRow).toBeTruthy();
    expect(samResultRow.source_ref).toContain(`pdf-boundary:${body.evidence.id}:sam31-visual-audit`);
    expect(samResultRow.notes).toContain('sam31_room_boundary_visual_audit_result');
    expect(samResultRow.notes).toContain('no_claims_cleared');

    const reviewRes = await request(`${COOPERATIVE_1881_PATH}/resolver-packets/pdf-boundary/${body.evidence.id}/reviews`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        review_decision: 'corrected',
        reviewer_name: 'Halo Fire estimator',
        marked_up_plan_ref: '1881://marked-up/sheet-7-room-boundary.png',
        corrected_room_polygons: [
          {
            room_id: 'level-1-corridor-a',
            source_ref: '1881 plan PDF sheet 7 / outline candidate',
            polygon: [[0, 0], [40, 0], [40, 12], [0, 12]],
          },
        ],
        issue_list: [
          {
            issue_type: 'room_boundary_mismatch',
            severity: 'blocking',
            observed: 'outline included annotation border',
            expected: 'corridor boundary only',
            required_action: 'Use corrected polygon before layout replay',
          },
        ],
        notes: 'Corrected room boundary packet for internal alpha replay.',
      }),
    });
    expect(reviewRes.status).toBe(201);
    const reviewBody = await reviewRes.json();
    expect(reviewBody.evidence.evidence_type).toBe('room_boundary_review_packet');
    expect(reviewBody.evidence.status).toBe('best_effort');
    expect(reviewBody.review.review_decision).toBe('corrected');
    expect(reviewBody.review.source_evidence_id).toBe(body.evidence.id);
    expect(reviewBody.review.marked_up_plan_ref).toBe('1881://marked-up/sheet-7-room-boundary.png');
    expect(reviewBody.review.issue_list[0].issue_type).toBe('room_boundary_mismatch');
    expect(reviewBody.review.corrected_room_polygons[0].room_id).toBe('level-1-corridor-a');
    expect(reviewBody.review.blocked_claims).toEqual(expect.arrayContaining(['geometry_accuracy', 'AutoSprink_parity', 'permit_ready']));
    expect(reviewBody.review.claim_gate_effect).toBe('no_claims_cleared');

    const evidenceAfterReview = await (await request(`${COOPERATIVE_1881_PATH}/evidence`, {
      headers: { Authorization: `Bearer ${token}` },
    })).json();
    const reviewRow = evidenceAfterReview.find((e) => e.id === reviewBody.evidence.id);
    expect(reviewRow).toBeTruthy();
    expect(reviewRow.source_ref).toContain(`pdf-boundary:${body.evidence.id}:room-boundary-review`);
    expect(reviewRow.notes).toContain('room_boundary_review_packet_decision');
    expect(reviewRow.notes).toContain('no_claims_cleared');

    const gatesAfterReview = await (await request(`${COOPERATIVE_1881_PATH}/claim-gates`, {
      headers: { Authorization: `Bearer ${token}` },
    })).json();
    expect(gatesAfterReview.some((g) => g.status === 'cleared')).toBe(false);

    const queueAfterReview = await (await request(`${COOPERATIVE_1881_PATH}/resolver-queue`, {
      headers: { Authorization: `Bearer ${token}` },
    })).json();
    const reviewedItem = queueAfterReview.items.find((q) => q.evidence_id === body.evidence.id);
    expect(reviewedItem.status).toBe('correction_ready');
    expect(reviewedItem.next_action).toMatch(/Replay/i);
    expect(reviewedItem.latest_review).toEqual(expect.objectContaining({
      evidence_id: reviewBody.evidence.id,
      review_decision: 'corrected',
      reviewer_name: 'Halo Fire estimator',
      marked_up_plan_ref: '1881://marked-up/sheet-7-room-boundary.png',
      issue_count: 1,
      corrected_room_polygon_count: 1,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(queueAfterReview.summary.correction_ready).toBe(1);
    expect(queueAfterReview.summary.ready).toBe(0);

    const replayRes = await request(`${COOPERATIVE_1881_PATH}/resolver-packets/pdf-boundary/${body.evidence.id}/replay-input`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(replayRes.status).toBe(200);
    const replayPacket = await replayRes.json();
    expect(replayPacket.artifact_type).toBe('room_boundary_replay_input_packet');
    expect(replayPacket.status).toBe('ready_for_internal_alpha_replay');
    expect(replayPacket.source_review_evidence_id).toBe(reviewBody.evidence.id);
    expect(replayPacket.review_decision).toBe('corrected');
    expect(replayPacket.corrected_room_polygons[0]).toEqual(expect.objectContaining({
      room_id: 'level-1-corridor-a',
      polygon: [[0, 0], [40, 0], [40, 12], [0, 12]],
    }));
    expect(replayPacket.sprinkler_bid_request.room_boundary_source).toBe('latest_employee_review_packet');
    expect(replayPacket.sprinkler_bid_request.corrected_room_polygons).toHaveLength(1);
    expect(replayPacket.blocked_claims).toEqual(expect.arrayContaining(['geometry_accuracy', 'AutoSprink_parity', 'permit_ready']));
    expect(replayPacket.claim_gate_effect).toBe('no_claims_cleared');

    const replayBidRes = await request(`${COOPERATIVE_1881_PATH}/sprinkler-bid`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(replayPacket.sprinkler_bid_request),
    });
    expect(replayBidRes.status).toBe(200);
    const replayBid = await replayBidRes.json();
    expect(replayBid.replayInput).toEqual(expect.objectContaining({
      room_boundary_source: 'latest_employee_review_packet',
      source_review_evidence_id: reviewBody.evidence.id,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(replayBid.bid.totalAreaSqFt).toBe(480);
    expect(replayBid.bid.rooms[0]).toEqual(expect.objectContaining({
      name: 'level-1-corridor-a',
      areaSqFt: 480,
    }));

    const evidenceAfterReplay = await (await request(`${COOPERATIVE_1881_PATH}/evidence`, {
      headers: { Authorization: `Bearer ${token}` },
    })).json();
    const replayRow = evidenceAfterReplay.find((e) => (
      e.evidence_type === 'best_effort_ai_layout'
      && e.source_ref === `pdf-boundary:${body.evidence.id}:room-boundary-replay:${reviewBody.evidence.id}`
    ));
    expect(replayRow).toBeTruthy();
    const replayNotes = JSON.parse(replayRow.notes);
    expect(replayNotes.kind).toBe('best_effort_ai_layout_replay');
    expect(replayNotes.artifact_type).toBe('room_boundary_replay_bid_artifact');
    expect(replayNotes.download_name).toContain('room-boundary-replay-bid-artifact');
    expect(replayNotes.source_evidence_id).toBe(body.evidence.id);
    expect(replayNotes.source_review_evidence_id).toBe(reviewBody.evidence.id);
    expect(replayNotes.corrected_room_polygon_count).toBe(1);
    expect(replayNotes.claim_gate_effect).toBe('no_claims_cleared');
    expect(replayNotes.blocked_claims).toEqual(expect.arrayContaining(['geometry_accuracy', 'AutoSprink_parity', 'permit_ready']));

    const replayArtifactRes = await request(`${COOPERATIVE_1881_PATH}/evidence/${replayRow.id}/replay-bid-artifact`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(replayArtifactRes.status).toBe(200);
    const replayArtifact = await replayArtifactRes.json();
    expect(replayArtifact.artifact_type).toBe('room_boundary_replay_bid_artifact');
    expect(replayArtifact.evidence_id).toBe(replayRow.id);
    expect(replayArtifact.download_name).toBe(replayNotes.download_name);
    expect(replayArtifact.bid_summary).toEqual(expect.objectContaining({
      total_area_sqft: 480,
      total_head_count: replayBid.bid.totalHeadCount,
    }));
    expect(replayArtifact.claim_gate_effect).toBe('no_claims_cleared');
    expect(replayArtifact.blocked_claims).toEqual(expect.arrayContaining(['geometry_accuracy', 'AutoSprink_parity', 'permit_ready']));
  }, 30000);

  it('rejects a persisted boundary decision without a positive operator scale', async () => {
    const res = await request(`${COOPERATIVE_1881_PATH}/pdf-boundary-decision`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        pdfPageIndex: 0,
        pdfScale: 0,
        pdfExtract: 'outline',
        candidate: { mode: 'outline', bbox: { widthFt: 10, heightFt: 10 }, segmentCount: 4 },
      }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects packet review decisions without a marked-up source reference', async () => {
    const candidate = {
      mode: 'outline',
      bbox: { minX: 0, minY: 0, maxX: 10, maxY: 10, widthFt: 10, heightFt: 10 },
      segmentCount: 4,
    };
    const saved = await (await request(`${COOPERATIVE_1881_PATH}/pdf-boundary-decision`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        pdfPageIndex: 2,
        pdfScale: 0.1,
        pdfExtract: 'outline',
        candidate,
      }),
    })).json();
    const res = await request(`${COOPERATIVE_1881_PATH}/resolver-packets/pdf-boundary/${saved.evidence.id}/reviews`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ review_decision: 'accepted', reviewer_name: 'Estimator' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/marked_up_plan_ref/);
  });

  it('replays corrected room-boundary packets through /sprinkler-bid as internal-alpha overrides with source refs recorded', async () => {
    const candidate = {
      mode: 'outline',
      bbox: { minX: 0, minY: 0, maxX: 10, maxY: 10, widthFt: 10, heightFt: 10 },
      segmentCount: 4,
    };
    const saved = await (await request(`${COOPERATIVE_1881_PATH}/pdf-boundary-decision`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        pdfPageIndex: 1,
        pdfScale: 0.1,
        pdfExtract: 'outline',
        candidate,
        source_ref: '1881://sheet-7',
      }),
    })).json();
    const reviewBody = await (await request(`${COOPERATIVE_1881_PATH}/resolver-packets/pdf-boundary/${saved.evidence.id}/reviews`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        review_decision: 'corrected',
        reviewer_name: 'Halo Fire estimator',
        marked_up_plan_ref: '1881://marked-up/sheet-7-room-boundary.png',
        corrected_room_polygons: [
          {
            room_id: 'level-1-corridor-a',
            polygon: [[0, 0], [40, 0], [40, 12], [0, 12]],
          },
        ],
        issue_list: [
          {
            issue_type: 'room_boundary_mismatch',
            severity: 'blocking',
            source_ref: '1881://sheet-7',
            observed: 'Sheet-wide footprint captured extra geometry.',
            expected: 'Replay only the reviewed corridor boundary.',
            required_action: 'Use the corrected corridor polygon for internal-alpha replay only.',
          },
        ],
      }),
    })).json();
    const replayPacket = await (await request(`${COOPERATIVE_1881_PATH}/resolver-packets/pdf-boundary/${saved.evidence.id}/replay-input`, {
      headers: { Authorization: `Bearer ${token}` },
    })).json();

    const replayRes = await request(`${COOPERATIVE_1881_PATH}/sprinkler-bid`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        markupPct: 30,
        ...replayPacket.sprinkler_bid_request,
      }),
    });
    expect(replayRes.status).toBe(200);
    const replayBody = await replayRes.json();
    expect(replayBody.roomBoundaryReplay).toEqual(expect.objectContaining({
      room_boundary_source: 'latest_employee_review_packet',
      source_evidence_id: saved.evidence.id,
      source_review_evidence_id: reviewBody.evidence.id,
      corrected_room_polygon_count: 1,
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(replayBody.roomBoundaryReplay.source_refs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        evidence_id: saved.evidence.id,
        source_ref: '1881://sheet-7',
      }),
      expect.objectContaining({
        evidence_id: reviewBody.evidence.id,
      }),
    ]));
    expect(replayBody.bid.totalAreaSqFt).toBe(480);
    expect(replayBody.bid.rooms).toHaveLength(1);
    expect(replayBody.bid.rooms[0].name).toBe('level-1-corridor-a');
    expect(replayBody.bid.blockedClaims).toEqual(expect.arrayContaining(['AutoSprink parity', 'permit-ready']));

    const evidenceRows = await (await request(`${COOPERATIVE_1881_PATH}/evidence`, {
      headers: { Authorization: `Bearer ${token}` },
    })).json();
    const replayEvidence = evidenceRows.find((row) => row.evidence_type === 'best_effort_ai_layout' && String(row.source_ref || '').includes(String(reviewBody.evidence.id)));
    expect(replayEvidence).toBeTruthy();
    const replayNotes = JSON.parse(replayEvidence.notes);
    expect(replayNotes.kind).toBe('best_effort_ai_layout_replay');
    expect(replayNotes.claim_gate_effect).toBe('no_claims_cleared');
    expect(replayNotes.source_review_evidence_id).toBe(reviewBody.evidence.id);
  }, 30000);
});

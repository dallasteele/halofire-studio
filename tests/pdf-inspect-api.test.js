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

  it('reports OpenClaw SAM31 bridge readiness as fail-closed when the bridge URL is unset', async () => {
    const res = await request('/api/openclaw/sam31/status', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31_bridge_status',
      status: 'unavailable',
      tool_ref: 'pdfExtract:sam',
      bridge_url_configured: false,
      bridge_url: null,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(body.supported_applications).toEqual(expect.arrayContaining(['halo_fire', 'landscout', 'nameforge']));
    expect(body.blocked_claims).toEqual(expect.arrayContaining(['geometry_accuracy', 'OpenClaw_runtime_verified']));
    expect(body.next_action).toMatch(/OPENCLAW_BRIDGE_URL|OpenClaw/i);
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
      id: 'candidate:1881-sheet-7-outline',
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
        selected_sheet_ref: '1881://proposal-cooperative/sheet-7',
        selected_scale_ref: '1881://operator-scale/sheet-7/0.0833',
        selected_boundary_candidate_ref: 'candidate:1881-sheet-7-outline',
        source_refs: [
          '1881://proposal-cooperative/sheet-7',
          '1881://operator-scale/sheet-7/0.0833',
          'candidate:1881-sheet-7-outline',
        ],
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
    expect(body.decision.employeeDecision).toEqual(expect.objectContaining({
      artifact_type: 'halofire.pdf_boundary_employee_decision.v1',
      status: 'employee_selected_internal_alpha',
      selected_sheet_ref: '1881://proposal-cooperative/sheet-7',
      selected_scale_ref: '1881://operator-scale/sheet-7/0.0833',
      selected_boundary_candidate_ref: 'candidate:1881-sheet-7-outline',
      source_document_ref: 'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx',
      use_for_claims: false,
      no_claim_gates_cleared: true,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(body.decision.employeeDecision.source_refs).toEqual(expect.arrayContaining([
      '1881://proposal-cooperative/sheet-7',
      '1881://operator-scale/sheet-7/0.0833',
      'candidate:1881-sheet-7-outline',
    ]));

    const latest = await (await request(`${COOPERATIVE_1881_PATH}/pdf-boundary-decision`, {
      headers: { Authorization: `Bearer ${token}` },
    })).json();
    expect(latest.decision.pageIndex).toBe(7);
    expect(latest.evidence.status).toBe('best_effort');
    expect(latest.decision.employeeDecision.selected_boundary_candidate_ref).toBe('candidate:1881-sheet-7-outline');

    const evidence = await (await request(`${COOPERATIVE_1881_PATH}/evidence`, {
      headers: { Authorization: `Bearer ${token}` },
    })).json();
    const row = evidence.find((e) => e.id === body.evidence.id);
    expect(row).toBeTruthy();
    expect(row.status).toBe('best_effort');
    expect(row.notes).toContain('claims still blocked');
    expect(row.notes).toContain('halofire.pdf_boundary_employee_decision.v1');

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
    expect(item.input_defaults.employeeDecision).toEqual(expect.objectContaining({
      artifact_type: 'halofire.pdf_boundary_employee_decision.v1',
      selected_sheet_ref: '1881://proposal-cooperative/sheet-7',
      selected_scale_ref: '1881://operator-scale/sheet-7/0.0833',
      selected_boundary_candidate_ref: 'candidate:1881-sheet-7-outline',
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(item.input_defaults.source_refs).toEqual(expect.arrayContaining([
      '1881://proposal-cooperative/sheet-7',
      '1881://operator-scale/sheet-7/0.0833',
      'candidate:1881-sheet-7-outline',
    ]));
    expect(item.employee_decision).toEqual(expect.objectContaining({
      artifact_type: 'halofire.pdf_boundary_employee_decision.v1',
      selected_boundary_candidate_ref: 'candidate:1881-sheet-7-outline',
    }));
    expect(item.blocked_claims).toEqual(expect.arrayContaining(['geometry_accuracy', 'AutoSprink_parity']));
    expect(item.next_action).toMatch(/room-boundary/i);
    expect(item.acceptable_evidence).toEqual(expect.arrayContaining(['employee room-boundary review packet']));
    expect(item.ai_fallback).toMatch(/SAM/i);
    expect(item.openclaw_sam31_bridge_status).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31_bridge_status',
      status: 'unavailable',
      tool_ref: 'pdfExtract:sam',
      bridge_url_configured: false,
      source_runtime: 'openclaw.sam31',
      claim_gate_effect: 'no_claims_cleared',
      next_action: expect.stringMatching(/OPENCLAW_BRIDGE_URL|OpenClaw/i),
    }));
    expect(item.openclaw_sam31_bridge_status.supported_applications).toEqual(expect.arrayContaining([
      'halo_fire',
      'landscout',
      'nameforge',
    ]));
    expect(item.openclaw_sam31_bridge_status.blocked_claims).toEqual(expect.arrayContaining([
      'geometry_accuracy',
      'AutoSprink_parity',
      'permit_ready',
    ]));

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
    expect(packet.employee_decision).toEqual(expect.objectContaining({
      artifact_type: 'halofire.pdf_boundary_employee_decision.v1',
      selected_sheet_ref: '1881://proposal-cooperative/sheet-7',
      selected_boundary_candidate_ref: 'candidate:1881-sheet-7-outline',
      claim_gate_effect: 'no_claims_cleared',
    }));
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
    expect(samPacket.openclaw_sam31_perception_request).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31_perception_request',
      project_ref: `halo_fire:${COOPERATIVE_1881_PROJECT_NAME}`,
      application: 'halo_fire',
      source_runtime: 'sam-3.1+llm',
      llm_model: 'openclaw-local-llm-best-effort',
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(samPacket.openclaw_sam31_perception_request.perception_lanes).toEqual(expect.arrayContaining([
      'segmentation',
      'object_identification',
      'vector_overlay',
      'model_3d_candidate',
      'spatial_observation',
    ]));
    expect(samPacket.openclaw_sam31_perception_request.segments[0]).toEqual(expect.objectContaining({
      id: 'candidate:pdf-boundary',
      semantic_label: 'room_boundary_candidate',
      confidence: expect.any(Number),
    }));
    expect(samPacket.openclaw_sam31_perception_request.object_hypotheses).toEqual(expect.arrayContaining([
      expect.objectContaining({ semantic_label: 'room_boundary' }),
      expect.objectContaining({ semantic_label: 'wall_candidate' }),
      expect.objectContaining({ semantic_label: 'sleeve_or_penetration_candidate' }),
      expect.objectContaining({ semantic_label: 'sprinkler_obstruction_candidate' }),
    ]));
    expect(samPacket.openclaw_sam31_perception_request.extrapolation_contract).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31_extrapolation_contract',
      status: 'best_effort_extrapolation_ready',
      source_runtime: 'sam-3.1+llm',
      consumes: ['segments', 'object_hypotheses'],
      supported_applications: ['halo_fire', 'landscout', 'nameforge'],
      temporary_value_policy: expect.stringContaining('editable best guesses'),
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(samPacket.openclaw_sam31_perception_request.extrapolation_contract.produces).toEqual(expect.arrayContaining([
      'llm_observations',
      'vector_overlays',
      'model_3d_candidates',
      'extrapolation_index',
    ]));
    expect(Object.keys(samPacket.openclaw_sam31_perception_request.application_contracts)).toEqual([
      'halo_fire',
      'landscout',
      'nameforge',
    ]);
    expect(samPacket.openclaw_sam31_perception_request.application_contracts.halo_fire).toEqual(expect.objectContaining({
      contract_ref: 'openclaw.sam31.application_contract.halo_fire.v1',
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
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(samPacket.openclaw_sam31_perception_request.application_contracts.landscout.blocked_claims).toEqual(expect.arrayContaining([
      'survey_grade',
      'CEO_ready',
      'production_ready',
    ]));
    expect(samPacket.openclaw_sam31_perception_request.application_contracts.nameforge.blocked_claims).toEqual(expect.arrayContaining([
      'brand_ready',
      'trademark_ready',
      'production_ready',
    ]));
    expect(samPacket.openclaw_sam31_perception_request.application_adapter).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31.application_adapter.halo_fire.v1',
      application: 'halo_fire',
      contract_ref: 'openclaw.sam31.application_contract.halo_fire.v1',
      status: 'best_effort_adapter_ready',
      next_action: expect.stringContaining('Queue HaloFire room-boundary or sleeve/firestop review'),
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(samPacket.openclaw_sam31_perception_request.vector_overlays[0]).toEqual(expect.objectContaining({
      id: 'vector:candidate:pdf-boundary',
      segment_id: 'candidate:pdf-boundary',
      kind: 'polygon_path',
      svg_path: expect.stringMatching(/^M /),
      source: 'generated_best_effort_from_segment_polygon',
    }));
    expect(samPacket.openclaw_sam31_perception_request.model_3d_candidates[0]).toEqual(expect.objectContaining({
      id: 'model3d:candidate:pdf-boundary',
      segment_id: 'candidate:pdf-boundary',
      primitive: 'extruded_polygon',
      source: 'generated_best_effort_from_segment_polygon',
    }));
    expect(samPacket.openclaw_sam31_perception_request.perception_summary).toEqual(expect.objectContaining({
      extrapolation_contract_ref: 'openclaw.sam31_extrapolation_contract',
      active_application_contract_ref: 'openclaw.sam31.application_contract.halo_fire.v1',
      application_adapter_ref: 'openclaw.sam31.application_adapter.halo_fire.v1',
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(samPacket.openclaw_sam31_perception_request.perception_summary.application_contract_refs).toEqual([
      'openclaw.sam31.application_contract.halo_fire.v1',
      'openclaw.sam31.application_contract.landscout.v1',
      'openclaw.sam31.application_contract.nameforge.v1',
    ]);
    expect(samPacket.bridge).toEqual(expect.objectContaining({
      openclaw_bridge_url_configured: false,
      local_bridge_command: 'npm run sam31:bridge',
    }));
    expect(samPacket.bridge.openclaw_sam31_bridge_status).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31_bridge_status',
      status: 'unavailable',
      tool_ref: 'pdfExtract:sam',
      bridge_url_configured: false,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(samPacket.bridge.openclaw_sam31_bridge_status.limitations.join(' ')).toMatch(/does not clear/i);
    expect(samPacket.employee_capture_fields).toEqual(expect.arrayContaining([
      'sam31_result_ref',
      'screenshot_ref',
      'console_log_ref',
      'marked_up_plan_ref',
      'issue_list',
      'corrected_room_polygons',
      'openclaw_sam31_perception_packet',
    ]));
    expect(samPacket.supported_evidence_lanes).toEqual(expect.arrayContaining([
      'room_boundary_visual_audit',
      'spatial_observation_correction_loop',
      'object_identification_review',
      'vector_overlay_generation',
      'model_3d_candidate_generation',
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
        openclaw_sam31_perception_packet: {
          artifact_type: 'openclaw.sam31_perception_packet',
          status: 'best_effort_perception_ready',
          application: 'halo_fire',
          source_runtime: 'sam-3.1+llm',
          segments: [
            {
              id: 'seg-room-1',
              semantic_label: 'corridor',
              polygon: [[0, 0], [30, 0], [30, 10], [0, 10]],
              confidence: 0.91,
            },
          ],
          object_hypotheses: [
            {
              id: 'obj-sleeve-1',
              segment_id: 'seg-room-1',
              semantic_label: 'sleeve_or_penetration_candidate',
              confidence: 0.62,
            },
          ],
          vector_overlays: [
            {
              id: 'vector:seg-room-1',
              segment_id: 'seg-room-1',
              kind: 'polygon_path',
              svg_path: 'M 0 0 L 30 0 L 30 10 L 0 10 Z',
              confidence: 0.73,
            },
          ],
          model_3d_candidates: [
            {
              id: 'model3d:seg-room-1',
              segment_id: 'seg-room-1',
              primitive: 'extruded_polygon',
              height_ft: 10,
              confidence: 0.46,
            },
          ],
          blocked_claims: ['geometry_accuracy', 'permit_ready', 'AutoSprink_parity'],
          claim_gate_effect: 'no_claims_cleared',
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
            next_action: 'Use this summary to queue HaloFire room-boundary replay; do not promote blocked claims.',
          },
        },
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
    expect(samResult.result.openclaw_sam31_perception_packet).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31_perception_packet',
      status: 'best_effort_perception_ready',
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(samResult.result.openclaw_sam31_perception_packet.perception_summary).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31_perception_summary',
      project_ref: 'halo-fire:1881',
      application: 'halo_fire',
      source_runtime: 'sam-3.1+llm',
      segment_count: 1,
      object_hypothesis_count: 1,
      vector_overlay_count: 1,
      model_3d_candidate_count: 1,
      spatial_observation_count: 0,
      next_action: 'Use this summary to queue HaloFire room-boundary replay; do not promote blocked claims.',
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(samResult.result.openclaw_sam31_perception_packet.object_hypotheses[0]).toEqual(expect.objectContaining({
      semantic_label: 'sleeve_or_penetration_candidate',
    }));
    expect(samResult.result.openclaw_sam31_perception_packet.vector_overlays[0].svg_path).toContain('M 0 0');
    expect(samResult.result.openclaw_sam31_perception_packet.model_3d_candidates[0]).toEqual(expect.objectContaining({
      primitive: 'extruded_polygon',
    }));
    expect(samResult.result.source_refs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        evidence_type: 'openclaw.sam31_perception_packet',
        source_ref: 'openclaw.sam31_perception_packet',
      }),
    ]));

    const evidenceAfterSamResult = await (await request(`${COOPERATIVE_1881_PATH}/evidence`, {
      headers: { Authorization: `Bearer ${token}` },
    })).json();
    const samResultRow = evidenceAfterSamResult.find((e) => e.id === samResult.evidence.id);
    expect(samResultRow).toBeTruthy();
    expect(samResultRow.source_ref).toContain(`pdf-boundary:${body.evidence.id}:sam31-visual-audit`);
    expect(samResultRow.notes).toContain('sam31_room_boundary_visual_audit_result');
    expect(samResultRow.notes).toContain('openclaw.sam31_perception_packet');
    expect(samResultRow.notes).toContain('no_claims_cleared');

    const replacementRes = await request(`${COOPERATIVE_1881_PATH}/resolver-packets/pdf-boundary/${body.evidence.id}/sam31-replacements`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        source_sam31_evidence_id: samResult.evidence.id,
        reviewer_name: 'Halo Fire estimator',
        replacement_ref: '1881://employee-replacements/sheet-7-sam31-values.json',
        replacement_values: {
          semantic_label: 'main corridor',
          polygon: [[1, 1], [29, 1], [29, 9], [1, 9]],
          bbox: { minX: 1, minY: 1, maxX: 29, maxY: 9 },
          object_hypothesis: { id: 'obj-sleeve-1', semantic_label: 'field-verified sleeve candidate' },
          vector_overlay: { id: 'vector:employee:seg-room-1', svg_path: 'M 1 1 L 29 1 L 29 9 L 1 9 Z' },
          model_3d_candidate: { id: 'model3d:employee:seg-room-1', primitive: 'field_adjusted_extruded_polygon' },
          source_ref: '1881://employee-field-notes/sheet-7',
          confidence: 0.88,
        },
        notes: 'Employee replaced temporary SAM31 values for internal replay only.',
      }),
    });
    expect(replacementRes.status).toBe(201);
    const replacement = await replacementRes.json();
    expect(replacement.evidence.evidence_type).toBe('sam31_employee_replacement');
    expect(replacement.evidence.status).toBe('present');
    expect(replacement.replacement).toEqual(expect.objectContaining({
      source_evidence_id: body.evidence.id,
      source_sam31_evidence_id: samResult.evidence.id,
      reviewer_name: 'Halo Fire estimator',
      replacement_ref: '1881://employee-replacements/sheet-7-sam31-values.json',
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(replacement.replacement.replacement_values).toEqual(expect.objectContaining({
      semantic_label: 'main corridor',
      source_ref: '1881://employee-field-notes/sheet-7',
      confidence: 0.88,
    }));
    expect(replacement.replacement.replaced_fields).toEqual(expect.arrayContaining([
      'semantic_label',
      'polygon',
      'bbox',
      'object_hypothesis',
      'vector_overlay',
      'model_3d_candidate',
      'source_ref',
      'confidence',
    ]));
    expect(replacement.replacement.blocked_claims).toEqual(expect.arrayContaining(['permit_ready', 'AHJ_approval', 'AutoSprink_parity']));
    expect(replacement.message).toMatch(/claims still blocked/i);

    const evidenceAfterReplacement = await (await request(`${COOPERATIVE_1881_PATH}/evidence`, {
      headers: { Authorization: `Bearer ${token}` },
    })).json();
    const replacementRow = evidenceAfterReplacement.find((e) => e.id === replacement.evidence.id);
    expect(replacementRow).toBeTruthy();
    expect(replacementRow.source_ref).toContain(`pdf-boundary:${body.evidence.id}:sam31-replacement:${samResult.evidence.id}`);
    expect(replacementRow.notes).toContain('sam31_employee_replacement');
    expect(replacementRow.notes).toContain('field_adjusted_extruded_polygon');
    expect(replacementRow.notes).toContain('no_claims_cleared');

    const queueAfterSamResult = await (await request(`${COOPERATIVE_1881_PATH}/resolver-queue`, {
      headers: { Authorization: `Bearer ${token}` },
    })).json();
    const samReviewedItem = queueAfterSamResult.items.find((q) => q.evidence_id === body.evidence.id);
    expect(samReviewedItem.status).toBe('sam31_replacements_recorded');
    expect(samReviewedItem.next_action).toMatch(/SAM 3\.1/i);
    expect(samReviewedItem.latest_sam31_visual_audit).toEqual(expect.objectContaining({
      evidence_id: samResult.evidence.id,
      review_decision: 'corrected',
      reviewer_name: 'Halo Fire SAM reviewer',
      sam31_result_ref: '1881://sam31/sheet-7-segmentation.json',
      corrected_room_polygon_count: 1,
      issue_count: 1,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(samReviewedItem.latest_sam31_employee_replacement).toEqual(expect.objectContaining({
      evidence_id: replacement.evidence.id,
      source_sam31_evidence_id: samResult.evidence.id,
      reviewer_name: 'Halo Fire estimator',
      replacement_ref: '1881://employee-replacements/sheet-7-sam31-values.json',
      replaced_fields: expect.arrayContaining(['semantic_label', 'polygon', 'bbox', 'model_3d_candidate', 'confidence']),
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(samReviewedItem.latest_sam31_visual_audit.openclaw_sam31_perception_packet).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31_perception_summary',
      status: 'best_effort_perception_ready',
      project_ref: 'halo-fire:1881',
      segment_count: 1,
      object_hypothesis_count: 1,
      vector_overlay_count: 1,
      model_3d_candidate_count: 1,
      spatial_observation_count: 0,
      next_action: 'Use this summary to queue HaloFire room-boundary replay; do not promote blocked claims.',
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(samReviewedItem.openclaw_sam31_tool_contract_action).toEqual(expect.objectContaining({
      label: 'Download SAM31 tool contract',
      method: 'GET',
      href: expect.stringContaining('/resolver-packets/openclaw/sam31/tool-contract'),
      artifact_type: 'openclaw.sam31_llm_extrapolation_tool_contract_packet.v1',
      source_runtime: 'halofire-api-local-contract',
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(samReviewedItem.openclaw_sam31_vector_model_artifact_action).toEqual(expect.objectContaining({
      label: 'Download SAM31 vector/model artifact packet',
      method: 'GET',
      href: expect.stringContaining(`/resolver-packets/pdf-boundary/${body.evidence.id}/openclaw/sam31/vector-model-artifacts`),
      artifact_type: 'openclaw.sam31_vector_model_artifact_packet.v1',
      status: 'ready',
      source_pdf_boundary_evidence_id: body.evidence.id,
      source_sam31_visual_audit_evidence_id: samResult.evidence.id,
      source_runtime: 'sam-3.1+llm',
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(samReviewedItem.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'Download SAM31 tool contract',
        href: expect.stringContaining('/resolver-packets/openclaw/sam31/tool-contract'),
        artifact_type: 'openclaw.sam31_llm_extrapolation_tool_contract_packet.v1',
      }),
      expect.objectContaining({
        label: 'Download SAM31 vector/model artifact packet',
        href: expect.stringContaining('/openclaw/sam31/vector-model-artifacts'),
        artifact_type: 'openclaw.sam31_vector_model_artifact_packet.v1',
      }),
    ]));
    expect(queueAfterSamResult.summary.sam31_replacements_recorded).toBe(1);

    const vectorModelPacketRes = await request(`${COOPERATIVE_1881_PATH}/resolver-packets/pdf-boundary/${body.evidence.id}/openclaw/sam31/vector-model-artifacts`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(vectorModelPacketRes.status).toBe(200);
    const vectorModelPacket = await vectorModelPacketRes.json();
    expect(vectorModelPacket).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31_vector_model_artifact_packet.v1',
      status: 'ready_for_internal_alpha_review',
      project_name: 'The Cooperative 1881 - Salt Lake City UT',
      source_pdf_boundary_evidence_id: body.evidence.id,
      source_sam31_visual_audit_evidence_id: samResult.evidence.id,
      source_runtime: 'sam-3.1+llm',
      temporary_value_policy: 'best_guess_until_employee_replaced',
      use_for_claims: false,
      no_claim_gates_cleared: true,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(vectorModelPacket.operator_audit_summary).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31_vector_model_operator_audit_summary.v1',
      source_pdf_boundary_evidence_id: body.evidence.id,
      source_sam31_visual_audit_evidence_id: samResult.evidence.id,
      vector_overlay_count: 1,
      model_3d_candidate_count: 1,
      temporary_value_policy: 'best_guess_until_employee_replaced',
      use_for_claims: false,
      no_claim_gates_cleared: true,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(vectorModelPacket.vector_overlays[0]).toEqual(expect.objectContaining({
      id: 'vector:seg-room-1',
      svg_path: 'M 0 0 L 30 0 L 30 10 L 0 10 Z',
      source_pdf_boundary_evidence_id: body.evidence.id,
      source_sam31_visual_audit_evidence_id: samResult.evidence.id,
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(vectorModelPacket.model_3d_candidates[0]).toEqual(expect.objectContaining({
      id: 'model3d:seg-room-1',
      primitive: 'extruded_polygon',
      source_pdf_boundary_evidence_id: body.evidence.id,
      source_sam31_visual_audit_evidence_id: samResult.evidence.id,
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(vectorModelPacket.source_refs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        evidence_id: body.evidence.id,
        evidence_type: 'pdf_boundary_decision',
      }),
      expect.objectContaining({
        evidence_id: samResult.evidence.id,
        evidence_type: 'sam31_room_boundary_visual_audit',
      }),
    ]));
    expect(vectorModelPacket.supported_evidence_lanes).toEqual(expect.arrayContaining([
      'vector_overlay_generation',
      'model_3d_candidate_generation',
    ]));
    expect(vectorModelPacket.blocked_claims).toEqual(expect.arrayContaining([
      'geometry_accuracy',
      'permit_ready',
      'AHJ_approval',
      'AutoSprink_parity',
      'manufacturer_exact',
    ]));

    const vectorModelPersistRes = await request(`${COOPERATIVE_1881_PATH}/resolver-packets/pdf-boundary/${body.evidence.id}/openclaw/sam31/vector-model-artifacts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(vectorModelPersistRes.status).toBe(201);
    const vectorModelPersisted = await vectorModelPersistRes.json();
    expect(vectorModelPersisted.evidence.evidence_type).toBe('openclaw_sam31_vector_model_artifact_packet');
    expect(vectorModelPersisted.evidence.status).toBe('best_effort');
    expect(vectorModelPersisted.message).toMatch(/claims still blocked/i);
    expect(vectorModelPersisted.artifact_type).toBe('openclaw.sam31_vector_model_artifact_packet.v1');
    expect(vectorModelPersisted.claim_gate_effect).toBe('no_claims_cleared');

    const queueAfterVectorModel = await (await request(`${COOPERATIVE_1881_PATH}/resolver-queue`, {
      headers: { Authorization: `Bearer ${token}` },
    })).json();
    const vectorModelItem = queueAfterVectorModel.items.find((q) => q.evidence_id === body.evidence.id);
    expect(vectorModelItem.latest_openclaw_sam31_vector_model_artifact).toEqual(expect.objectContaining({
      evidence_id: vectorModelPersisted.evidence.id,
      artifact_type: 'openclaw.sam31_vector_model_artifact_packet.v1',
      vector_overlay_count: 1,
      model_3d_candidate_count: 1,
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(queueAfterVectorModel.summary.sam31_vector_model_artifacts_recorded).toBe(1);

    const samReplayRes = await request(`${COOPERATIVE_1881_PATH}/resolver-packets/pdf-boundary/${body.evidence.id}/replay-input`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(samReplayRes.status).toBe(200);
    const samReplayPacket = await samReplayRes.json();
    expect(samReplayPacket).toEqual(expect.objectContaining({
      artifact_type: 'room_boundary_replay_input_packet',
      status: 'ready_for_internal_alpha_replay',
      source_evidence_id: body.evidence.id,
      source_sam31_evidence_id: samResult.evidence.id,
      source_sam31_replacement_evidence_id: replacement.evidence.id,
      review_decision: 'corrected',
      review_source: 'latest_sam31_visual_audit',
      sam31_replacement_source: 'latest_sam31_employee_replacement',
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(samReplayPacket.latest_sam31_employee_replacement).toEqual(expect.objectContaining({
      evidence_id: replacement.evidence.id,
      replacement_ref: '1881://employee-replacements/sheet-7-sam31-values.json',
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(samReplayPacket.corrected_room_polygons[0]).toEqual(expect.objectContaining({
      room_id: 'main corridor',
      polygon: [[1, 1], [29, 1], [29, 9], [1, 9]],
      source_ref: '1881://employee-field-notes/sheet-7',
      sam31_employee_replacement_evidence_id: replacement.evidence.id,
    }));
    expect(samReplayPacket.sprinkler_bid_request).toEqual(expect.objectContaining({
      room_boundary_source: 'latest_sam31_visual_audit',
      source_evidence_id: body.evidence.id,
      source_sam31_evidence_id: samResult.evidence.id,
      source_sam31_replacement_evidence_id: replacement.evidence.id,
      sam31_replacement_source: 'latest_sam31_employee_replacement',
      use_for_claims: false,
    }));
    expect(samReplayPacket.sprinkler_bid_request.sam31_employee_replacement).toEqual(expect.objectContaining({
      evidence_id: replacement.evidence.id,
      replacement_values: expect.objectContaining({
        semantic_label: 'main corridor',
        source_ref: '1881://employee-field-notes/sheet-7',
      }),
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(samReplayPacket.openclaw_sam31_perception_packet).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31_perception_summary',
      project_ref: 'halo-fire:1881',
      object_hypothesis_count: 1,
      vector_overlay_count: 1,
      model_3d_candidate_count: 1,
      spatial_observation_count: 0,
      next_action: 'Use this summary to queue HaloFire room-boundary replay; do not promote blocked claims.',
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(samReplayPacket.sprinkler_bid_request.openclaw_sam31_perception_packet).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31_perception_summary',
      project_ref: 'halo-fire:1881',
      next_action: 'Use this summary to queue HaloFire room-boundary replay; do not promote blocked claims.',
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(samReplayPacket.source_refs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        evidence_id: body.evidence.id,
        evidence_type: 'pdf_boundary_decision',
      }),
      expect.objectContaining({
        evidence_id: samResult.evidence.id,
        evidence_type: 'sam31_room_boundary_visual_audit',
      }),
    ]));
    expect(samReplayPacket.blocked_claims).toEqual(expect.arrayContaining(['geometry_accuracy', 'permit_ready', 'AutoSprink_parity']));

    const samReplayBidRes = await request(`${COOPERATIVE_1881_PATH}/sprinkler-bid`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        markupPct: 25,
        ...samReplayPacket.sprinkler_bid_request,
      }),
    });
    expect(samReplayBidRes.status).toBe(200);
    const samReplayBid = await samReplayBidRes.json();
    expect(samReplayBid.roomBoundaryReplay).toEqual(expect.objectContaining({
      room_boundary_source: 'latest_sam31_visual_audit',
      source_sam31_evidence_id: samResult.evidence.id,
      source_sam31_replacement_evidence_id: replacement.evidence.id,
      corrected_room_polygon_count: 1,
      sam31_replacement_source: 'latest_sam31_employee_replacement',
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(samReplayBid.roomBoundaryReplay.sam31_employee_replacement).toEqual(expect.objectContaining({
      evidence_id: replacement.evidence.id,
      replacement_ref: '1881://employee-replacements/sheet-7-sam31-values.json',
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(samReplayBid.roomBoundaryReplay.openclaw_sam31_perception_packet).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31_perception_summary',
      project_ref: 'halo-fire:1881',
      object_hypothesis_count: 1,
      vector_overlay_count: 1,
      model_3d_candidate_count: 1,
      spatial_observation_count: 0,
      next_action: 'Use this summary to queue HaloFire room-boundary replay; do not promote blocked claims.',
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(samReplayBid.bid.totalAreaSqFt).toBe(224);
    expect(samReplayBid.bid.rooms[0]).toEqual(expect.objectContaining({
      name: 'main corridor',
      areaSqFt: 224,
    }));

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

    const correctionQueueRes = await request(`${COOPERATIVE_1881_PATH}/resolver-queue?roomBoundarySource=employee_review&roomBoundaryState=correction_ready`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(correctionQueueRes.status).toBe(200);
    const correctionQueue = await correctionQueueRes.json();
    expect(correctionQueue.filters).toEqual(expect.objectContaining({
      roomBoundarySource: 'employee_review',
      roomBoundaryState: 'correction_ready',
    }));
    expect(correctionQueue.summary.correction_ready).toBe(1);
    expect(correctionQueue.summary.ready).toBe(0);
    expect(correctionQueue.items).toHaveLength(1);
    expect(correctionQueue.items[0]).toEqual(expect.objectContaining({
      kind: 'room_boundary_visual_audit',
      status: 'correction_ready',
      evidence_id: body.evidence.id,
      latest_review: expect.objectContaining({
        evidence_id: reviewBody.evidence.id,
        review_decision: 'corrected',
      }),
    }));

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

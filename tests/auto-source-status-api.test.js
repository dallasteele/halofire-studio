import { afterAll, beforeAll, afterEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// S5: GET /api/auto-source/status — read-only observability of the autonomous
// part-sourcing run. Auth required (NOT admin-only). HONESTY/fail-closed: with no
// status file it returns 200 status:"never-run" + parityGateStatus blocked; when a
// crafted file claims a cleared gate the endpoint RE-FORCES parityGateStatus
// 'blocked' + manufacturerExactCount 0. Never 500s.
const ROOT = path.resolve(import.meta.dirname, '..');
const STATUS_PATH = path.join(ROOT, 'out', 'auto-source-status.json');
const PORT = 3203;
const BASE = `http://127.0.0.1:${PORT}`;
let server; let tempDir; let token;

async function waitForHealth() {
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server not healthy');
}

function removeStatusFile() {
  try { fs.rmSync(STATUS_PATH, { force: true }); } catch { /* ignore */ }
}

beforeAll(async () => {
  removeStatusFile();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-autosource-api-'));
  server = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env, PORT: String(PORT), NODE_ENV: 'test',
      HALOFIRE_DB_PATH: path.join(tempDir, 'h.db'),
      JWT_SECRET: 'test-jwt-secret-with-more-than-32-characters',
      HALOFIRE_ADMIN_USER: 'admin', HALOFIRE_ADMIN_PASSWORD: 'autosource-test-pw',
      HALOFIRE_ALLOW_DEV_DEFAULTS: '0', HALOFIRE_CORS_ORIGINS: 'http://allowed.test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
  token = (await (await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'autosource-test-pw' }),
  })).json()).token;
});

afterAll(async () => {
  if (server && !server.killed) { server.kill(); await new Promise((r) => server.once('exit', r)); }
  removeStatusFile();
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

afterEach(() => { removeStatusFile(); });

describe('S5 GET /api/auto-source/status', () => {
  it('requires auth', async () => {
    const res = await fetch(`${BASE}/api/auto-source/status`);
    expect(res.status).toBe(401);
  });

  it('with no status file returns 200 status:"never-run" + parityGateStatus blocked', async () => {
    removeStatusFile();
    const res = await fetch(`${BASE}/api/auto-source/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('never-run');
    expect(body.parityGateStatus).toBe('blocked');
    expect(body.manufacturerExactCount).toBe(0);
    expect(typeof body.note).toBe('string');
    expect(body.sourceAcquisitionLedger.map((row) => row.family_ref)).toEqual([
      'family:pipe_steel_sch40_2p0in',
      'family:fitting_tee_2p0in',
      'family:valve_check_2p5in',
    ]);
    expect(body.sourceAcquisitionLedger.every((row) => row.status_tier === 'missing_catalog_source')).toBe(true);
  });

  it('RE-FORCES parityGateStatus blocked + manufacturerExactCount 0 from a tampered file', async () => {
    fs.mkdirSync(path.dirname(STATUS_PATH), { recursive: true });
    fs.writeFileSync(STATUS_PATH, JSON.stringify({
      lastRunAt: '2026-05-29T00:00:00.000Z',
      durationMs: 1234,
      bridgeUrl: 'http://127.0.0.1:15000',
      openclawReachable: true,
      openclawStatus: 'online',
      invokeAttempted: true,
      report: { foundCount: 9, createdCount: 0, generatedCount: 0, missingCount: 0 },
      functionalCoverage: { present: 9, total: 9, complete: true },
      // tampered honesty claims:
      manufacturerExactCount: 9,
      parityGateStatus: 'clear',
      disclaimer: 'tampered',
    }));

    const res = await fetch(`${BASE}/api/auto-source/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    // RE-FORCED regardless of file contents:
    expect(body.parityGateStatus).toBe('blocked');
    expect(body.manufacturerExactCount).toBe(0);
    // legit observability fields still pass through:
    expect(body.report.foundCount).toBe(9);
    expect(body.openclawReachable).toBe(true);
    expect(body.lastRunAt).toBe('2026-05-29T00:00:00.000Z');
  });

  it('adds catalog vendor/source acquisition items to the project resolver queue without clearing claims', async () => {
    removeStatusFile();
    const res = await fetch(`${BASE}/api/projects/Home%20Depot%20-%20Rexburg%20ID/resolver-queue`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const catalogItems = body.items.filter((item) => item.kind === 'catalog_vendor_acquisition');

    expect(catalogItems).toHaveLength(3);
    expect(body.summary.catalog_source_needed).toBe(3);
    expect(body.summary.catalog_review_needed).toBe(0);
    expect(catalogItems.map((item) => item.input_defaults.family_ref)).toEqual([
      'family:pipe_steel_sch40_2p0in',
      'family:fitting_tee_2p0in',
      'family:valve_check_2p5in',
    ]);
    expect(catalogItems[0]).toEqual(expect.objectContaining({
      status: 'catalog_source_needed',
      source_evidence_type: 'catalog_source_acquisition',
      claim_gate_effect: 'no_claims_cleared',
      next_action: expect.stringMatching(/manufacturer|vendor|catalog/i),
      ai_fallback: expect.stringMatching(/OpenClaw|step\.parts|vendor/i),
    }));
    expect(catalogItems[0].acceptable_evidence).toEqual(expect.arrayContaining([
      'manufacturer catalog page or vendor product page URL',
      'license or terms for downloaded CAD/BIM/STEP artifact',
    ]));
    expect(catalogItems[0].blocked_claims).toEqual(
      expect.arrayContaining(['manufacturer_exact', 'AutoSprink_parity', 'fabrication_ready']),
    );
    expect(catalogItems[0].actions[0].href).toContain('/settings.html?');
    expect(catalogItems[0].actions[0].href).toContain('component=pipe_sch40');
  });

  it('surfaces catalog approval packet readiness in resolver queue summaries without clearing claims', async () => {
    removeStatusFile();
    const projectName = 'Home Depot - Rexburg ID';
    const res = await fetch(`${BASE}/api/projects/${encodeURIComponent(projectName)}/resolver-queue`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const catalogItems = body.items.filter((item) => item.kind === 'catalog_vendor_acquisition');

    expect(catalogItems).toHaveLength(3);
    expect(body.summary.catalog_approval_packet_ready).toBe(12);
    expect(body.summary.catalog_approval_professional_packets).toBe(3);
    expect(body.summary.catalog_approval_ahj_packets).toBe(3);
    expect(body.summary.catalog_approval_autosprink_packets).toBe(3);
    expect(body.summary.catalog_approval_claims_cleared).toBe(0);

    const pipeItem = catalogItems.find((item) => item.input_defaults.family_ref === 'family:pipe_steel_sch40_2p0in');
    expect(pipeItem.catalog_approval_packet_rows).toHaveLength(4);
    expect(pipeItem.catalog_approval_packet_rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        artifact_type: 'halofire.catalog_approval_resolver_packet.v1',
        status: 'ready_for_signed_evidence_upload',
        approval_ref_field: 'professional_or_ahj_review_ref',
        target_gate_code: 'PROFESSIONAL_REVIEW_MISSING',
        required_evidence_type: 'professional_review',
        claim_gate_effect: 'no_claims_cleared',
        use_for_claims: false,
        download_href: expect.stringContaining('/approval-packet?'),
        upload_route: expect.stringContaining('/approval-validation'),
        next_action: expect.stringMatching(/signed professional/i),
      }),
      expect.objectContaining({
        target_gate_code: 'AHJ_APPROVAL_MISSING',
        required_evidence_type: 'ahj_approval',
        next_action: expect.stringMatching(/signed AHJ/i),
      }),
      expect.objectContaining({
        target_gate_code: 'AUTOSPRINK_EVIDENCE_MISSING',
        required_evidence_type: 'autosprink_packet',
        blocked_claims: expect.arrayContaining(['AutoSprink_parity']),
      }),
    ]));
    for (const row of pipeItem.catalog_approval_packet_rows) {
      expect(row.no_claim_gates_cleared).toBe(true);
      expect(row.blocked_claims).not.toHaveLength(0);
      expect(row.acceptable_evidence).not.toHaveLength(0);
      expect(row.limitations.join(' ')).toMatch(/does not clear/i);
    }
  });

  it('filters resolver queue to AHJ approval upload packets while keeping AHJ and permit claims blocked', async () => {
    removeStatusFile();
    const projectName = 'Home Depot - Rexburg ID';
    const res = await fetch(`${BASE}/api/projects/${encodeURIComponent(projectName)}/resolver-queue?catalogApproval=ready&evidenceType=ahj_approval`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const catalogItems = body.items.filter((item) => item.kind === 'catalog_vendor_acquisition');

    expect(body.filters.catalogApproval).toBe('ready');
    expect(body.filters.evidenceType).toBe('ahj_approval');
    expect(catalogItems).toHaveLength(3);
    expect(body.summary.catalog_approval_packet_ready).toBe(3);
    expect(body.summary.catalog_approval_ahj_packets).toBe(3);
    expect(body.summary.catalog_approval_professional_packets).toBe(0);
    expect(body.summary.catalog_approval_autosprink_packets).toBe(0);
    expect(body.summary.catalog_approval_claims_cleared).toBe(0);

    for (const item of catalogItems) {
      expect(item.catalog_approval_packet_rows).toHaveLength(1);
      const [row] = item.catalog_approval_packet_rows;
      expect(row).toEqual(expect.objectContaining({
        artifact_type: 'halofire.catalog_approval_resolver_packet.v1',
        status: 'ready_for_signed_evidence_upload',
        approval_ref_field: 'professional_or_ahj_review_ref',
        target_gate_code: 'AHJ_APPROVAL_MISSING',
        required_evidence_type: 'ahj_approval',
        claim_gate_effect: 'no_claims_cleared',
        use_for_claims: false,
        no_claim_gates_cleared: true,
        next_action: expect.stringMatching(/signed AHJ/i),
      }));
      expect(row.blocked_claims).toEqual(expect.arrayContaining(['permit_ready', 'AHJ_ready', 'AHJ_approval']));
      expect(row.limitations.join(' ')).toMatch(/does not clear/i);
    }
  });

  it('serves a local executable OpenClaw SAM31+LLM tool contract for HaloFire, LandScout, and NameForge without clearing claims', async () => {
    const descriptorRes = await fetch(`${BASE}/api/openclaw/sam31/tool`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(descriptorRes.status).toBe(200);
    const descriptor = await descriptorRes.json();

    expect(descriptor).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31_llm_extrapolation_tool',
      status: 'internal_alpha_ready',
      source_runtime: 'halofire-api-local-contract',
      local_tool_descriptor_source: 'halofire-api-local-contract',
      temporary_value_policy: 'best_guess_until_employee_replaced',
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(descriptor.output_lanes).toEqual(expect.arrayContaining([
      'llm_observations',
      'vector_overlays',
      'model_3d_candidates',
      'extrapolation_index',
    ]));
    expect(descriptor.sectioning_pipeline_contract).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31.sectioning_pipeline_contract.v1',
      status: 'internal_alpha_ready',
      source_runtime: 'halofire-api-local-contract',
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(descriptor.sectioning_pipeline_contract.stages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stage: 'sam31_sectioning',
        produces: expect.arrayContaining(['segments']),
      }),
      expect.objectContaining({
        stage: 'llm_object_identification',
        produces: expect.arrayContaining(['llm_observations', 'object_hypotheses']),
      }),
      expect.objectContaining({
        stage: 'vector_overlay_generation',
        produces: expect.arrayContaining(['vector_overlays']),
      }),
      expect.objectContaining({
        stage: 'model_3d_candidate_generation',
        produces: expect.arrayContaining(['model_3d_candidates']),
      }),
    ]));
    expect(descriptor.supported_applications).toEqual(['halo_fire', 'landscout', 'nameforge']);
    expect(descriptor.application_contracts.halo_fire.supported_evidence_lanes).toEqual(expect.arrayContaining([
      'room_boundary_visual_audit',
      'sleeve_or_firestop_candidate_review',
      'obstruction_or_clash_review',
    ]));
    expect(descriptor.application_contracts.landscout.blocked_claims).toEqual(expect.arrayContaining(['CEO_ready', 'production_ready']));
    expect(descriptor.application_contracts.nameforge.blocked_claims).toEqual(expect.arrayContaining(['brand_ready', 'trademark_ready']));
    expect(descriptor.halofire_api_actions.extrapolation_artifact.href_template).toContain('/openclaw/sam31/extrapolation-artifact');
    expect(descriptor.halofire_api_actions.consumer_smoke.href_template).toContain('/openclaw/sam31/consumer-smoke');
    expect(descriptor.product_review_queue_contract).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31.product_review_queue_contract.v1',
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(descriptor.product_review_queue_contract.required_source_provenance_fields).toEqual(expect.arrayContaining([
      'source_pdf_boundary_evidence_id',
      'source_openclaw_sam31_extrapolation_evidence_id',
      'source_openclaw_sam31_vector_model_artifact_evidence_id',
      'source_halofire_sam31_sectioning_sprinkler_review_adapter_evidence_id',
      'source_halofire_sam31_sectioning_downstream_resolver_packet_evidence_id',
    ]));
    expect(descriptor.product_review_queue_contract.supported_provenance_artifacts).toEqual(expect.arrayContaining([
      'openclaw.sam31_llm_extrapolation_artifact',
      'openclaw.sam31_vector_model_artifact_packet.v1',
      'halofire_sam31_sectioning_sprinkler_review_adapter',
    ]));

    const projectName = 'Home Depot - Rexburg ID';
    const packetRes = await fetch(`${BASE}/api/projects/${encodeURIComponent(projectName)}/resolver-packets/openclaw/sam31/tool-contract`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(packetRes.status).toBe(200);
    const packet = await packetRes.json();
    expect(packet).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31_llm_extrapolation_tool_contract_packet.v1',
      status: 'ready_for_internal_alpha_use',
      project_name: projectName,
      source_runtime: 'halofire-api-local-contract',
      temporary_value_policy: 'best_guess_until_employee_replaced',
      use_for_claims: false,
      no_claim_gates_cleared: true,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(packet.download_name).toContain('openclaw-sam31-tool-contract');
    expect(packet.canonical_tool_descriptor).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31_llm_extrapolation_tool',
      local_tool_descriptor_source: 'halofire-api-local-contract',
    }));
    expect(packet.sectioning_pipeline_contract).toEqual(expect.objectContaining({
      artifact_type: 'openclaw.sam31.sectioning_pipeline_contract.v1',
      status: 'internal_alpha_ready',
      source_runtime: 'halofire-api-local-contract',
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(packet.cross_product_handoff_rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        consumer: 'landscout',
        artifact_type: 'openclaw.sam31.consumer_review_queue.landscout.v1',
        required_payload_type: 'openclaw.sam31.product_review_queue_item.v1',
        required_source_provenance_fields: expect.arrayContaining([
          'source_openclaw_sam31_extrapolation_evidence_id',
          'source_openclaw_sam31_vector_model_artifact_evidence_id',
          'source_halofire_sam31_sectioning_sprinkler_review_adapter_evidence_id',
        ]),
        claim_gate_effect: 'no_claims_cleared',
      }),
      expect.objectContaining({
        consumer: 'nameforge',
        artifact_type: 'openclaw.sam31.consumer_review_queue.nameforge.v1',
        required_payload_type: 'openclaw.sam31.product_review_queue_item.v1',
        required_source_provenance_fields: expect.arrayContaining([
          'source_openclaw_sam31_extrapolation_evidence_id',
          'source_openclaw_sam31_vector_model_artifact_evidence_id',
          'source_halofire_sam31_sectioning_sprinkler_review_adapter_evidence_id',
        ]),
        claim_gate_effect: 'no_claims_cleared',
      }),
    ]));
    expect(packet.blocked_claims).toEqual(expect.arrayContaining(['permit_ready', 'AHJ_approval', 'AutoSprink_parity', 'production_ready']));
    expect(packet.limitations.join(' ')).toMatch(/does not clear/i);
  });

  it('downloads catalog source evidence packets and keeps manufacturer claims blocked after evidence is recorded', async () => {
    removeStatusFile();
    const projectName = 'Home Depot - Rexburg ID';
    const familyRef = 'family:pipe_steel_sch40_2p0in';
    const packetUrl = `${BASE}/api/projects/${encodeURIComponent(projectName)}/resolver-packets/catalog-source/${encodeURIComponent(familyRef)}/review-packet`;

    const initialPacketRes = await fetch(packetUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(initialPacketRes.status).toBe(200);
    const initialPacket = await initialPacketRes.json();
    expect(initialPacket).toEqual(expect.objectContaining({
      artifact_type: 'halofire.catalog_source_evidence_packet.v1',
      status: 'ready_for_employee_review',
      project_name: projectName,
      family_ref: familyRef,
      component_key: 'pipe_sch40',
      source_evidence_type: 'catalog_source_acquisition',
      manufacturer_exact: false,
      claim_gate_effect: 'no_claims_cleared',
      claim_gate_effect_description: expect.stringMatching(/review artifact only/i),
      latest_catalog_source_acquisition: null,
    }));
    expect(initialPacket.download_name).toMatch(/catalog-source-evidence-packet/);
    expect(initialPacket.acceptable_evidence).toEqual(expect.arrayContaining([
      'manufacturer catalog page or vendor product page URL',
      'downloaded artifact hash tied to the exact component family',
    ]));
    expect(initialPacket.blocked_claims).toEqual(
      expect.arrayContaining(['manufacturer_exact', 'AutoSprink_parity', 'fabrication_ready', 'AHJ_approval', 'PE_review']),
    );
    expect(initialPacket.employee_decision_fields).toEqual(expect.arrayContaining([
      'reviewer_name',
      'verified_source_url',
      'downloaded_artifact_hash',
      'manufacturer_model_approval_ref',
      'review_decision',
    ]));

    const evidenceRes = await fetch(`${BASE}/api/projects/${encodeURIComponent(projectName)}/evidence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        evidence_type: 'catalog_source_acquisition',
        status: 'present',
        source_ref: familyRef,
        source_file: 'pipe_sch40',
        notes: JSON.stringify({
          kind: 'sourceAcquisitionLedger',
          schema: 'halofire.catalog_source_acquisition_ledger_row.v1',
          family_ref: familyRef,
          component_key: 'pipe_sch40',
          nominal_size_in: 2,
          source_url: 'https://vendor.example/catalog/pipe-sch40-2in',
          license: 'internal-alpha review placeholder',
          downloaded_artifact_hash: 'sha256:placeholder-pipe-sch40-2in',
          status_tier: 'candidate_vendor_source',
          manufacturer_exact: false,
          blocked_claims: ['manufacturer_exact', 'AutoSprink_parity', 'fabrication_ready', 'permit_ready', 'AHJ_approval', 'PE_review'],
          claim_gate_effect: 'no_claims_cleared',
          no_claim_gates_cleared: true,
        }),
      }),
    });
    expect(evidenceRes.status).toBe(201);
    const created = await evidenceRes.json();

    const recordedPacketRes = await fetch(packetUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(recordedPacketRes.status).toBe(200);
    const recordedPacket = await recordedPacketRes.json();
    expect(recordedPacket).toEqual(expect.objectContaining({
      artifact_type: 'halofire.catalog_source_evidence_packet.v1',
      family_ref: familyRef,
      manufacturer_exact: false,
      claim_gate_effect: 'no_claims_cleared',
      latest_catalog_source_acquisition: expect.objectContaining({
        evidence_id: created.id,
        evidence_status: 'present',
        source_ref: familyRef,
        source_url: 'https://vendor.example/catalog/pipe-sch40-2in',
        claim_gate_effect: 'no_claims_cleared',
      }),
    }));
    expect(recordedPacket.source_refs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        evidence_id: created.id,
        evidence_type: 'catalog_source_acquisition',
        status: 'present',
      }),
    ]));

    const gatesRes = await fetch(`${BASE}/api/projects/${encodeURIComponent(projectName)}/claim-gates`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(gatesRes.status).toBe(200);
    const gates = await gatesRes.json();
    expect(gates.find((gate) => gate.code === 'MANUFACTURER_MODEL_APPROVAL_MISSING')).toEqual(
      expect.objectContaining({ status: 'blocked' }),
    );
  });

  it('validates catalog packet approval refs only with signed gate-specific evidence', async () => {
    removeStatusFile();
    const projectName = 'Home Depot - Rexburg ID';
    const familyRef = 'family:pipe_steel_sch40_2p0in';
    const validationUrl = `${BASE}/api/projects/${encodeURIComponent(projectName)}/resolver-packets/catalog-source/${encodeURIComponent(familyRef)}/approval-validation`;

    const catalogEvidenceRes = await fetch(`${BASE}/api/projects/${encodeURIComponent(projectName)}/evidence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        evidence_type: 'catalog_source_acquisition',
        status: 'present',
        source_ref: familyRef,
        source_file: 'pipe_sch40',
        notes: JSON.stringify({
          family_ref: familyRef,
          component_key: 'pipe_sch40',
          claim_gate_effect: 'no_claims_cleared',
        }),
      }),
    });
    expect(catalogEvidenceRes.status).toBe(201);
    const catalogEvidence = await catalogEvidenceRes.json();

    const directResolveRes = await fetch(`${BASE}/api/projects/${encodeURIComponent(projectName)}/claim-gates/MANUFACTURER_MODEL_APPROVAL_MISSING/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ evidence_id: catalogEvidence.id }),
    });
    expect(directResolveRes.status).toBe(400);

    const unsignedValidationRes = await fetch(validationUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        approval_ref_field: 'manufacturer_model_approval_ref',
        source_ref: 'manufacturer://approval/MFG-PIPE-2IN',
      }),
    });
    expect(unsignedValidationRes.status).toBe(400);
    expect((await unsignedValidationRes.json()).error).toMatch(/signoff/i);

    const validations = [
      {
        approval_ref_field: 'manufacturer_model_approval_ref',
        target_gate_code: 'MANUFACTURER_MODEL_APPROVAL_MISSING',
        source_ref: 'manufacturer://approval/MFG-PIPE-2IN',
        expected_evidence_type: 'manufacturer_approval',
      },
      {
        approval_ref_field: 'professional_or_ahj_review_ref',
        target_gate_code: 'PROFESSIONAL_REVIEW_MISSING',
        source_ref: 'professional://review/PE-PIPE-2IN',
        expected_evidence_type: 'professional_review',
      },
      {
        approval_ref_field: 'professional_or_ahj_review_ref',
        target_gate_code: 'AHJ_APPROVAL_MISSING',
        source_ref: 'ahj://approval/AHJ-PIPE-2IN',
        expected_evidence_type: 'ahj_approval',
      },
      {
        approval_ref_field: 'autosprink_or_equivalent_export_ref',
        target_gate_code: 'AUTOSPRINK_EVIDENCE_MISSING',
        source_ref: 'autosprink://export/AS-PIPE-2IN',
        expected_evidence_type: 'autosprink_packet',
      },
    ];

    for (const [index, validation] of validations.entries()) {
      const res = await fetch(validationUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          ...validation,
          source_file: `catalog-approval-${index}.pdf`,
          notes: `Signed catalog approval validation ${index}`,
          signoff: {
            reviewer_name: `Catalog Reviewer ${index}`,
            reviewer_title: index === 1 ? 'Fire Protection Engineer' : 'HaloFire Approval Reviewer',
            signed_at: `2026-06-02T15:0${index}:00.000Z`,
            organization: 'Halo Fire',
            license_id: `HF-CAT-${index}`,
          },
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual(expect.objectContaining({
        cleared: true,
        code: validation.target_gate_code,
        approval_ref_field: validation.approval_ref_field,
        family_ref: familyRef,
        evidence: expect.objectContaining({
          evidence_type: validation.expected_evidence_type,
          status: 'present',
          source_ref: validation.source_ref,
        }),
      }));
      expect(body.evidence_notes).toEqual(expect.objectContaining({
        kind: 'catalog_source_approval_validation',
        family_ref: familyRef,
        approval_ref_field: validation.approval_ref_field,
        target_gate_code: validation.target_gate_code,
        claim_gate_effect: 'gate_cleared_after_explicit_signed_validation',
      }));
    }

    const gatesRes = await fetch(`${BASE}/api/projects/${encodeURIComponent(projectName)}/claim-gates`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(gatesRes.status).toBe(200);
    const gates = await gatesRes.json();
    for (const validation of validations) {
      expect(gates.find((gate) => gate.code === validation.target_gate_code)).toEqual(
        expect.objectContaining({
          status: 'cleared',
          resolved_evidence_ref: validation.source_ref,
        }),
      );
    }
  });

  it('downloads catalog approval resolver packets for professional/AHJ and AutoSprink evidence without clearing claims', async () => {
    removeStatusFile();
    const projectName = 'Home Depot - Rexburg ID';
    const familyRef = 'family:pipe_steel_sch40_2p0in';
    const packetUrl = `${BASE}/api/projects/${encodeURIComponent(projectName)}/resolver-packets/catalog-source/${encodeURIComponent(familyRef)}/approval-packet`;

    const professionalPacketRes = await fetch(`${packetUrl}?approval_ref_field=professional_or_ahj_review_ref&target_gate_code=PROFESSIONAL_REVIEW_MISSING`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(professionalPacketRes.status).toBe(200);
    const professionalPacket = await professionalPacketRes.json();
    expect(professionalPacket).toEqual(expect.objectContaining({
      artifact_type: 'halofire.catalog_approval_resolver_packet.v1',
      project_name: projectName,
      family_ref: familyRef,
      approval_ref_field: 'professional_or_ahj_review_ref',
      target_gate_code: 'PROFESSIONAL_REVIEW_MISSING',
      required_evidence_type: 'professional_review',
      claim_gate_effect: 'no_claims_cleared',
      use_for_claims: false,
      upload_route: `/api/projects/${encodeURIComponent(projectName)}/resolver-packets/catalog-source/${encodeURIComponent(familyRef)}/approval-validation`,
    }));
    expect(professionalPacket.download_name).toMatch(/catalog-approval-professional-review-packet/);
    expect(professionalPacket.required_signoff_fields).toEqual(expect.arrayContaining([
      'reviewer_name',
      'reviewer_title',
      'signed_at',
    ]));
    expect(professionalPacket.acceptable_evidence).toEqual(expect.arrayContaining([
      'signed licensed professional review package',
      'reviewer license or authority reference when available',
    ]));
    expect(professionalPacket.blocked_claims).toEqual(expect.arrayContaining([
      'permit_ready',
      'engineering_grade',
      'professionally_approved',
    ]));

    const ahjPacketRes = await fetch(`${packetUrl}?approval_ref_field=professional_or_ahj_review_ref&target_gate_code=AHJ_APPROVAL_MISSING`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(ahjPacketRes.status).toBe(200);
    const ahjPacket = await ahjPacketRes.json();
    expect(ahjPacket).toEqual(expect.objectContaining({
      artifact_type: 'halofire.catalog_approval_resolver_packet.v1',
      approval_ref_field: 'professional_or_ahj_review_ref',
      target_gate_code: 'AHJ_APPROVAL_MISSING',
      required_evidence_type: 'ahj_approval',
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(ahjPacket.download_name).toMatch(/catalog-approval-ahj-approval-packet/);
    expect(ahjPacket.acceptable_evidence).toEqual(expect.arrayContaining([
      'signed AHJ approval or review response',
      'AHJ jurisdiction/contact reference',
    ]));

    const autosprinkPacketRes = await fetch(`${packetUrl}?approval_ref_field=autosprink_or_equivalent_export_ref&target_gate_code=AUTOSPRINK_EVIDENCE_MISSING`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(autosprinkPacketRes.status).toBe(200);
    const autosprinkPacket = await autosprinkPacketRes.json();
    expect(autosprinkPacket).toEqual(expect.objectContaining({
      artifact_type: 'halofire.catalog_approval_resolver_packet.v1',
      approval_ref_field: 'autosprink_or_equivalent_export_ref',
      target_gate_code: 'AUTOSPRINK_EVIDENCE_MISSING',
      required_evidence_type: 'autosprink_packet',
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
    }));
    expect(autosprinkPacket.download_name).toMatch(/catalog-approval-autosprink-packet/);
    expect(autosprinkPacket.acceptable_evidence).toEqual(expect.arrayContaining([
      'AutoSprink or equivalent model export',
      'source-linked calculation/export packet',
    ]));
    expect(autosprinkPacket.limitations.join(' ')).toMatch(/does not clear/i);
  });

  it('adds official-flow intake resolver items with documented defaults or exact intake blockers', async () => {
    const homeDepotRes = await fetch(`${BASE}/api/projects/Home%20Depot%20-%20Rexburg%20ID/resolver-queue`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(homeDepotRes.status).toBe(200);
    const homeDepotBody = await homeDepotRes.json();
    const homeDepotItem = homeDepotBody.items.find((item) => item.kind === 'official_flow_intake');

    expect(homeDepotItem).toEqual(expect.objectContaining({
      status: 'official_flow_available',
      source_evidence_type: 'official_flow_intake',
      claim_gate_effect: 'no_claims_cleared',
      next_action: expect.stringMatching(/preliminary hydraulic replay|professional hydraulic/i),
      ai_fallback: expect.stringMatching(/preliminary hydraulic replay/i),
    }));
    expect(homeDepotItem.input_defaults).toEqual(expect.objectContaining({
      staticPsi: 76,
      residualPsi: 69,
      flowingGpm: 1226,
      source_status: 'documented_bid_package_values',
    }));
    expect(homeDepotItem.input_defaults.source_refs).toEqual(
      expect.arrayContaining(['Proposal- Home Depot - Rexburg ID.xlsx#Job Information!B3:B7']),
    );
    expect(homeDepotItem.acceptable_evidence).toEqual(expect.arrayContaining([
      'official flow test report or water supply data sheet',
      'licensed professional hydraulic calculation review',
    ]));
    expect(homeDepotItem.blocked_claims).toEqual(
      expect.arrayContaining(['permit_ready', 'AHJ_approval', 'PE_review', 'AutoSprink_parity', 'engineering_grade']),
    );
    expect(homeDepotBody.summary.official_flow_available).toBe(1);

    const coopRes = await fetch(`${BASE}/api/projects/The%20Cooperative%201881%20-%20Salt%20Lake%20City%20UT/resolver-queue`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(coopRes.status).toBe(200);
    const coopBody = await coopRes.json();
    const coopItem = coopBody.items.find((item) => item.kind === 'official_flow_intake');
    expect(coopItem).toEqual(expect.objectContaining({
      status: 'official_flow_needed',
      source_evidence_type: 'official_flow_intake',
      next_action: expect.stringMatching(/Attach official flow test|water supply/i),
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(coopItem.input_defaults).toEqual(expect.objectContaining({
      source_status: 'missing_official_flow_values',
      project_head_count: 1420,
    }));
    expect(coopBody.summary.official_flow_needed).toBe(1);
  });

  it('adds supplied document bid-truth rows from real workbooks without clearing claims', async () => {
    const res = await fetch(`${BASE}/api/projects/The%20Cooperative%201881%20-%20Salt%20Lake%20City%20UT/resolver-queue`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const item = body.items.find((row) => row.kind === 'supplied_document_bid_truth');

    expect(item).toEqual(expect.objectContaining({
      artifact_type: 'halofire.supplied_document_bid_truth_status.v1',
      status: 'employee_review_needed',
      source_evidence_type: 'supplied_document_bid_truth',
      temporary_value_policy: 'best_guess_until_employee_replaced',
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
      next_action: expect.stringMatching(/review.*supplied document/i),
    }));
    expect(item.input_defaults.project_truth).toEqual(expect.objectContaining({
      project_name: 'The Cooperative 1881 - Salt Lake City UT',
      source_file: 'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx',
      source_status: 'available_on_disk',
      customer: 'Kier Construction',
      project_address: '1881 West North Temple',
      city: 'Salt Lake City',
      state: 'Utah',
      square_feet: 170654,
      head_count: 1420,
      total_man_hours: 3301.5,
      construction_days: 108,
      flow_data_available: false,
    }));
    expect(item.input_defaults.cross_project_truth).toEqual(expect.arrayContaining([
      expect.objectContaining({
        project_name: 'Home Depot - Rexburg ID',
        source_file: 'Proposal- Home Depot - Rexburg ID.xlsx',
        source_status: 'available_on_disk',
        static_psi: 76,
        residual_psi: 69,
        flowing_gpm: 1226,
        flow_data_available: true,
      }),
    ]));
    expect(item.input_defaults.pricebook_sources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source_file: 'Halo FIre Pricebook ARGCO 2026.xlsx',
        source_status: 'available_on_disk',
        source_runtime: 'xlsx',
      }),
      expect.objectContaining({
        source_file: 'Halo Fire Pricebook FFF 2026.xlsx',
        source_status: 'available_on_disk',
      }),
      expect.objectContaining({
        source_file: 'Halo Fire Pricebook Victaulic 2026.xlsx',
        source_status: 'available_on_disk',
      }),
    ]));
    expect(item.acceptable_evidence).toEqual(expect.arrayContaining([
      'HaloFire employee reviewed supplied workbook values',
      'source workbook cell references for every accepted temporary value',
    ]));
    expect(item.blocked_claims).toEqual(expect.arrayContaining([
      'permit_ready',
      'AHJ_approval',
      'AutoSprink_parity',
      'engineering_grade',
      'fabrication_ready',
      'manufacturer_exact',
    ]));
    expect(body.summary.supplied_document_bid_truth_review_needed).toBe(1);
    expect(body.summary.supplied_document_bid_truth_claims_cleared).toBe(0);
  });

  it('downloads and records supplied document bid-truth employee replacements without clearing claims', async () => {
    const projectName = 'The Cooperative 1881 - Salt Lake City UT';
    const packetRes = await fetch(`${BASE}/api/projects/${encodeURIComponent(projectName)}/resolver-packets/supplied-document-bid-truth/review-packet`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(packetRes.status).toBe(200);
    const packet = await packetRes.json();
    expect(packet).toEqual(expect.objectContaining({
      artifact_type: 'halofire.supplied_document_bid_truth_review_packet.v1',
      status: 'ready_for_employee_review',
      project_name: projectName,
      source_evidence_type: 'supplied_document_bid_truth',
      temporary_value_policy: 'best_guess_until_employee_replaced',
      use_for_claims: false,
      no_claim_gates_cleared: true,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(packet.download_name).toMatch(/supplied-bid-truth-employee-review-packet/);
    expect(packet.employee_decision_fields).toEqual(expect.arrayContaining([
      'reviewer_name',
      'review_decision',
      'replacement_ref',
      'replacement_values',
      'source_refs',
      'notes',
    ]));
    expect(packet.project_truth).toEqual(expect.objectContaining({
      source_file: 'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx',
      square_feet: 170654,
      total_man_hours: 3301.5,
      flow_data_available: false,
    }));
    expect(packet.blocked_claims).toEqual(expect.arrayContaining([
      'permit_ready',
      'AHJ_approval',
      'AutoSprink_parity',
      'engineering_grade',
      'fabrication_ready',
      'manufacturer_exact',
    ]));

    const saveRes = await fetch(`${BASE}/api/projects/${encodeURIComponent(projectName)}/resolver-packets/supplied-document-bid-truth/replacements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        reviewer_name: 'HaloFire estimator',
        review_decision: 'replaced_temporary_values',
        replacement_ref: '1881://employee-bid-truth/review-001',
        source_file: 'employee-bid-truth-review.json',
        source_refs: [
          'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!G6',
          'employee://notes/1881-bid-truth',
        ],
        replacement_values: {
          square_feet: 170654,
          total_man_hours: 3301.5,
          construction_days: 108,
          flow_data_available: false,
          notes: 'Flow remains missing; do not clear hydraulic claims.',
        },
        notes: 'Employee reviewed bid-truth defaults for internal alpha only.',
      }),
    });
    expect(saveRes.status).toBe(201);
    const saved = await saveRes.json();
    expect(saved.evidence).toEqual(expect.objectContaining({
      evidence_type: 'supplied_document_bid_truth_replacement',
      status: 'best_effort',
      source_ref: '1881://employee-bid-truth/review-001',
    }));
    expect(saved.replacement).toEqual(expect.objectContaining({
      artifact_type: 'halofire.supplied_document_bid_truth_replacement.v1',
      review_decision: 'replaced_temporary_values',
      replacement_ref: '1881://employee-bid-truth/review-001',
      use_for_claims: false,
      no_claim_gates_cleared: true,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(saved.replacement.replaced_fields).toEqual(expect.arrayContaining([
      'square_feet',
      'total_man_hours',
      'construction_days',
      'flow_data_available',
    ]));
    expect(saved.replacement.blocked_claims).toEqual(expect.arrayContaining([
      'permit_ready',
      'AHJ_approval',
      'AutoSprink_parity',
    ]));

    const queueRes = await fetch(`${BASE}/api/projects/${encodeURIComponent(projectName)}/resolver-queue`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(queueRes.status).toBe(200);
    const queue = await queueRes.json();
    const item = queue.items.find((row) => row.kind === 'supplied_document_bid_truth');
    expect(item).toEqual(expect.objectContaining({
      status: 'employee_replacement_recorded',
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(item.latest_supplied_document_bid_truth_replacement).toEqual(expect.objectContaining({
      evidence_id: saved.evidence.id,
      replacement_ref: '1881://employee-bid-truth/review-001',
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(queue.summary.supplied_document_bid_truth_review_needed).toBe(0);
    expect(queue.summary.supplied_document_bid_truth_replacements_recorded).toBe(1);
    expect(queue.summary.supplied_document_bid_truth_claims_cleared).toBe(0);
  });

  it('feeds supplied document bid-truth replacements into downstream sprinkler-bid defaults without clearing claims', async () => {
    const projectName = 'The Cooperative 1881 - Salt Lake City UT';
    const replacementRes = await fetch(`${BASE}/api/projects/${encodeURIComponent(projectName)}/resolver-packets/supplied-document-bid-truth/replacements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        reviewer_name: 'HaloFire estimator',
        review_decision: 'replaced_temporary_values',
        replacement_ref: '1881://employee-bid-truth/downstream-defaults-001',
        source_file: 'employee-bid-truth-downstream-defaults.json',
        source_refs: [
          'employee://bid-truth/downstream-defaults-001',
          'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!G6',
        ],
        replacement_values: {
          square_feet: 90000,
          head_count: 777,
          total_man_hours: 1881.25,
          construction_days: 44,
          flow_data_available: false,
        },
        notes: 'Temporary downstream defaults for internal-alpha replay/pricing only.',
      }),
    });
    expect(replacementRes.status).toBe(201);
    const replacement = await replacementRes.json();

    const bidRes = await fetch(`${BASE}/api/projects/${encodeURIComponent(projectName)}/sprinkler-bid`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ markupPct: 25 }),
    });
    expect(bidRes.status).toBe(200);
    const body = await bidRes.json();

    expect(body.bid.totalAreaSqFt).toBe(90000);
    expect(body.floorPlan.source).toMatch(/supplied_document_bid_truth_replacement/);
    expect(body.suppliedDocumentBidTruth).toEqual(expect.objectContaining({
      artifact_type: 'halofire.supplied_document_bid_truth_downstream_defaults.v1',
      status: 'employee_replacement_applied',
      source_evidence_type: 'supplied_document_bid_truth_replacement',
      source_replacement_evidence_id: replacement.evidence.id,
      replacement_ref: '1881://employee-bid-truth/downstream-defaults-001',
      temporary_value_policy: 'best_guess_until_employee_replaced',
      use_for_claims: false,
      no_claim_gates_cleared: true,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(body.suppliedDocumentBidTruth.project_truth).toEqual(expect.objectContaining({
      square_feet: 90000,
      head_count: 777,
      total_man_hours: 1881.25,
      construction_days: 44,
      flow_data_available: false,
      source_status: 'employee_replacement_recorded',
    }));
    expect(body.suppliedDocumentBidTruth.replaced_fields).toEqual(expect.arrayContaining([
      'square_feet',
      'head_count',
      'total_man_hours',
      'construction_days',
      'flow_data_available',
    ]));
    expect(body.suppliedDocumentBidTruth.blocked_claims).toEqual(expect.arrayContaining([
      'permit_ready',
      'AHJ_approval',
      'AutoSprink_parity',
      'engineering_grade',
      'fabrication_ready',
      'manufacturer_exact',
    ]));

    const evidenceRows = await (await fetch(`${BASE}/api/projects/${encodeURIComponent(projectName)}/evidence`, {
      headers: { Authorization: `Bearer ${token}` },
    })).json();
    const layoutRow = evidenceRows.find((row) => (
      row.evidence_type === 'best_effort_ai_layout'
      && row.source_ref === `engine ${body.bid.generatedBy}`
    ));
    expect(layoutRow).toBeTruthy();
    expect(layoutRow.notes).toContain('supplied_document_bid_truth_replacement');
    expect(layoutRow.notes).toContain('downstream-defaults-001');
    expect(layoutRow.notes).toContain('no_claims_cleared');
  });

  it('downloads supplied document bid-truth downstream defaults packet after employee replacement', async () => {
    const projectName = 'The Cooperative 1881 - Salt Lake City UT';
    const replacementRes = await fetch(`${BASE}/api/projects/${encodeURIComponent(projectName)}/resolver-packets/supplied-document-bid-truth/replacements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        reviewer_name: 'HaloFire estimator',
        review_decision: 'replaced_temporary_values',
        replacement_ref: '1881://employee-bid-truth/downstream-packet-001',
        source_file: 'employee-bid-truth-downstream-packet.json',
        source_refs: [
          'employee://bid-truth/downstream-packet-001',
          'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!G6',
        ],
        replacement_values: {
          square_feet: 88000,
          head_count: 733,
          total_man_hours: 1775.5,
          construction_days: 41,
          flow_data_available: false,
        },
        notes: 'Download packet test for employee downstream defaults.',
      }),
    });
    expect(replacementRes.status).toBe(201);
    const replacement = await replacementRes.json();

    const packetRes = await fetch(`${BASE}/api/projects/${encodeURIComponent(projectName)}/resolver-packets/supplied-document-bid-truth/downstream-defaults-packet`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(packetRes.status).toBe(200);
    const packet = await packetRes.json();

    expect(packet).toEqual(expect.objectContaining({
      artifact_type: 'halofire.supplied_document_bid_truth_downstream_defaults_packet.v1',
      status: 'employee_replacement_applied',
      download_name: 'the-cooperative-1881-salt-lake-city-ut-supplied-bid-truth-downstream-defaults.json',
      source_evidence_type: 'supplied_document_bid_truth_replacement',
      source_replacement_evidence_id: replacement.evidence.id,
      source_supplied_document_bid_truth_replacement_evidence_id: replacement.evidence.id,
      replacement_ref: '1881://employee-bid-truth/downstream-packet-001',
      use_for_claims: false,
      no_claim_gates_cleared: true,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(packet.project_truth).toEqual(expect.objectContaining({
      square_feet: 88000,
      head_count: 733,
      total_man_hours: 1775.5,
      construction_days: 41,
      source_status: 'employee_replacement_recorded',
    }));
    expect(packet.downstream_application).toEqual(expect.objectContaining({
      endpoint: `/api/projects/${encodeURIComponent(projectName)}/sprinkler-bid`,
      applies_to: 'built_in_internal_alpha_floorplan_defaults',
      geometry_policy: 'scale_placeholder_footprint_area_only',
      head_count_policy: 'metadata_only_not_forced_into_layout_engine',
    }));
    expect(packet.blocked_claims).toEqual(expect.arrayContaining([
      'permit_ready',
      'AHJ_approval',
      'AutoSprink_parity',
      'engineering_grade',
      'fabrication_ready',
      'manufacturer_exact',
    ]));
  });

  it('records official-flow intake evidence and updates the resolver queue without clearing claims', async () => {
    const projectName = 'The Cooperative 1881 - Salt Lake City UT';
    const createRes = await fetch(`${BASE}/api/projects/${encodeURIComponent(projectName)}/resolver-packets/official-flow/intake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        staticPsi: 72,
        residualPsi: 61,
        flowingGpm: 980,
        flowDataDate: '2026-05-30',
        waterModelRequired: 'employee-entered placeholder until official water model is attached',
        source_file: 'field-flow-report.pdf',
        source_ref: 'field-flow-report.pdf#page=1',
        reviewer_name: 'HaloFire Estimator',
        notes: 'Temporary employee-entered values for internal-alpha hydraulic replay only.',
      }),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    expect(created.evidence.evidence_type).toBe('official_flow_intake');
    expect(created.evidence.status).toBe('present');
    expect(created.intake).toEqual(expect.objectContaining({
      staticPsi: 72,
      residualPsi: 61,
      flowingGpm: 980,
      source_ref: 'field-flow-report.pdf#page=1',
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(created.intake.blocked_claims).toEqual(
      expect.arrayContaining(['permit_ready', 'AHJ_approval', 'PE_review', 'AutoSprink_parity']),
    );

    const queueRes = await fetch(`${BASE}/api/projects/${encodeURIComponent(projectName)}/resolver-queue`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(queueRes.status).toBe(200);
    const queue = await queueRes.json();
    const item = queue.items.find((row) => row.kind === 'official_flow_intake');
    expect(item).toEqual(expect.objectContaining({
      status: 'official_flow_evidence_recorded',
      evidence_id: created.id,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(item.input_defaults).toEqual(expect.objectContaining({
      source_status: 'employee_recorded_official_flow_intake',
      staticPsi: 72,
      residualPsi: 61,
      flowingGpm: 980,
    }));
    expect(queue.summary.official_flow_evidence_recorded).toBe(1);

    const artifactRes = await fetch(`${BASE}/api/projects/${encodeURIComponent(projectName)}/resolver-packets/official-flow/${created.id}/replay-artifact`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(artifactRes.status).toBe(200);
    const artifact = await artifactRes.json();
    expect(artifact).toEqual(expect.objectContaining({
      artifact_type: 'official_flow_hydraulic_replay_artifact',
      status: 'best_effort_internal_alpha',
      source_evidence_id: created.id,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(artifact.official_flow_input).toEqual(expect.objectContaining({
      staticPsi: 72,
      residualPsi: 61,
      flowingGpm: 980,
      source_ref: 'field-flow-report.pdf#page=1',
    }));
    expect(artifact.hydraulic_summary).toEqual(expect.objectContaining({
      estimate: true,
      sourcePsiBasis: 'residualPsi',
    }));
    expect(typeof artifact.hydraulic_summary.requiredSourcePsi).toBe('number');
    expect(Array.isArray(artifact.issue_list)).toBe(true);
    expect(artifact.issue_list).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'PROFESSIONAL_HYDRAULIC_REVIEW_MISSING',
        severity: 'blocking',
      }),
    ]));
    expect(artifact.blocked_claims).toEqual(
      expect.arrayContaining(['permit_ready', 'AHJ_approval', 'PE_review', 'AutoSprink_parity']),
    );

    const persistRes = await fetch(`${BASE}/api/projects/${encodeURIComponent(projectName)}/resolver-packets/official-flow/${created.id}/replay-artifact`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(persistRes.status).toBe(201);
    const persisted = await persistRes.json();
    expect(persisted).toEqual(expect.objectContaining({
      message: expect.stringMatching(/claims still blocked/i),
      artifact: expect.objectContaining({
        artifact_type: 'official_flow_hydraulic_replay_artifact',
        source_evidence_id: created.id,
        claim_gate_effect: 'no_claims_cleared',
      }),
      evidence: expect.objectContaining({
        evidence_type: 'official_flow_hydraulic_replay_artifact',
        status: 'best_effort',
        source_ref: `official-flow:${created.id}:hydraulic-replay`,
      }),
    }));
    const notes = JSON.parse(persisted.evidence.notes);
    expect(notes).toEqual(expect.objectContaining({
      kind: 'official_flow_hydraulic_replay_artifact',
      source_evidence_id: created.id,
      artifact_type: 'official_flow_hydraulic_replay_artifact',
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(notes.blocked_claims).toEqual(
      expect.arrayContaining(['permit_ready', 'AHJ_approval', 'PE_review', 'AutoSprink_parity']),
    );

    const evidenceRes = await fetch(`${BASE}/api/projects/${encodeURIComponent(projectName)}/evidence`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(evidenceRes.status).toBe(200);
    const evidenceRows = await evidenceRes.json();
    expect(evidenceRows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: persisted.id,
        evidence_type: 'official_flow_hydraulic_replay_artifact',
        status: 'best_effort',
      }),
    ]));

    const persistedArtifactRes = await fetch(`${BASE}/api/projects/${encodeURIComponent(projectName)}/evidence/${persisted.id}/official-flow-hydraulic-replay-artifact`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(persistedArtifactRes.status).toBe(200);
    const persistedArtifact = await persistedArtifactRes.json();
    expect(persistedArtifact).toEqual(expect.objectContaining({
      artifact_type: 'official_flow_hydraulic_replay_artifact',
      status: 'best_effort_internal_alpha',
      evidence_id: persisted.id,
      source_evidence_id: created.id,
      claim_gate_effect: 'no_claims_cleared',
    }));

    const issueQueueRes = await fetch(`${BASE}/api/projects/${encodeURIComponent(projectName)}/resolver-queue`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(issueQueueRes.status).toBe(200);
    const issueQueue = await issueQueueRes.json();
    const replayItem = issueQueue.items.find((row) => row.kind === 'official_flow_hydraulic_replay_review');
    expect(replayItem).toEqual(expect.objectContaining({
      status: 'official_flow_replay_review_needed',
      evidence_id: persisted.id,
      source_evidence_type: 'official_flow_hydraulic_replay_artifact',
      claim_gate_effect: 'no_claims_cleared',
      next_action: expect.stringMatching(/professional hydraulic review|AHJ/i),
    }));
    expect(replayItem.input_defaults).toEqual(expect.objectContaining({
      source_evidence_id: created.id,
      issue_count: expect.any(Number),
      requiredSourcePsi: expect.any(Number),
      sourceMarginPsi: expect.any(Number),
    }));
    expect(replayItem.issue_actions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'PROFESSIONAL_HYDRAULIC_REVIEW_MISSING',
        evidence_lane: 'licensed_professional_hydraulic_review',
        blocked_claims: expect.arrayContaining(['permit_ready', 'PE_review', 'engineering_grade']),
      }),
      expect.objectContaining({
        code: 'AHJ_HYDRAULIC_APPROVAL_MISSING',
        evidence_lane: 'AHJ_reviewed_hydraulic_calculation_package',
        blocked_claims: expect.arrayContaining(['permit_ready', 'AHJ_approval']),
      }),
    ]));
    expect(replayItem.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'Download saved replay artifact',
        href: expect.stringContaining('/official-flow-hydraulic-replay-artifact'),
      }),
      expect.objectContaining({
        label: 'Open evidence workbench',
        href: expect.stringContaining('#official-flow-replay-review'),
      }),
    ]));
    expect(issueQueue.summary.official_flow_replay_review_needed).toBeGreaterThanOrEqual(1);

    const reviewPacketRes = await fetch(`${BASE}/api/projects/${encodeURIComponent(projectName)}/resolver-packets/official-flow-replay/${persisted.id}/review-packet`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(reviewPacketRes.status).toBe(200);
    const reviewPacket = await reviewPacketRes.json();
    expect(reviewPacket).toEqual(expect.objectContaining({
      artifact_type: 'official_flow_professional_ahj_review_packet',
      status: 'ready_for_employee_review',
      project_name: projectName,
      source_evidence_id: persisted.id,
      source_evidence_type: 'official_flow_hydraulic_replay_artifact',
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(reviewPacket.download_name).toMatch(/official-flow-professional-ahj-review-packet/);
    expect(reviewPacket.issue_actions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'PROFESSIONAL_HYDRAULIC_REVIEW_MISSING',
        evidence_lane: 'licensed_professional_hydraulic_review',
      }),
      expect.objectContaining({
        code: 'AHJ_HYDRAULIC_APPROVAL_MISSING',
        evidence_lane: 'AHJ_reviewed_hydraulic_calculation_package',
      }),
    ]));
    expect(reviewPacket.employee_decision_fields).toEqual(expect.arrayContaining([
      'reviewer_name',
      'professional_review_ref',
      'ahj_review_ref',
      'autosprink_export_ref',
      'official_flow_test_ref',
      'review_decision',
      'notes',
    ]));
    expect(reviewPacket.evidence_attachment_fields).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: 'professional_review_ref',
        acceptable_evidence_type: 'licensed_professional_hydraulic_review',
      }),
      expect.objectContaining({
        field: 'ahj_review_ref',
        acceptable_evidence_type: 'AHJ_reviewed_hydraulic_calculation_package',
      }),
    ]));
    expect(reviewPacket.source_refs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        evidence_id: persisted.id,
        evidence_type: 'official_flow_hydraulic_replay_artifact',
      }),
    ]));
    expect(reviewPacket.blocked_claims).toEqual(
      expect.arrayContaining(['permit_ready', 'AHJ_approval', 'PE_review', 'AutoSprink_parity']),
    );

    const decisionRes = await fetch(`${BASE}/api/projects/${encodeURIComponent(projectName)}/resolver-packets/official-flow-replay/${persisted.id}/review-decision`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        reviewer_name: 'HaloFire Employee',
        reviewer_title: 'Internal Alpha Reviewer',
        professional_review_ref: 'pe-review://pending-official-flow-review',
        ahj_review_ref: 'ahj://pending-official-flow-review',
        autosprink_export_ref: 'autosprink://pending-parity-export',
        official_flow_test_ref: 'field-flow-report.pdf#page=1',
        review_decision: 'recorded_evidence_refs_fail_closed',
        notes: 'Employee recorded available refs for downstream claim-gate evaluation; no claim gates cleared.',
      }),
    });
    expect(decisionRes.status).toBe(201);
    const decision = await decisionRes.json();
    expect(decision).toEqual(expect.objectContaining({
      artifact_type: 'halofire.official_flow_professional_ahj_review_decision.v1',
      source_replay_evidence_id: persisted.id,
      source_original_official_flow_evidence_id: created.id,
      source_attachment_intake_packet_evidence_id: null,
      review_decision: 'recorded_evidence_refs_fail_closed',
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
      claims_cleared_count: 0,
    }));
    expect(decision.evidence).toEqual(expect.objectContaining({
      evidence_type: 'official_flow_professional_ahj_review_decision',
      status: 'fail_closed_review_recorded',
      source_ref: `official-flow-replay:${persisted.id}:professional-ahj-review-decision`,
    }));
    expect(decision.source_refs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        evidence_id: persisted.id,
        evidence_type: 'official_flow_hydraulic_replay_artifact',
      }),
      expect.objectContaining({
        evidence_ref: 'pe-review://pending-official-flow-review',
        evidence_type: 'licensed_professional_hydraulic_review',
        status: 'employee_supplied_ref_unverified',
      }),
      expect.objectContaining({
        evidence_ref: 'ahj://pending-official-flow-review',
        evidence_type: 'AHJ_reviewed_hydraulic_calculation_package',
        status: 'employee_supplied_ref_unverified',
      }),
      expect.objectContaining({
        evidence_ref: 'autosprink://pending-parity-export',
        evidence_type: 'AutoSprink_or_equivalent_professional_model_export',
        status: 'employee_supplied_ref_unverified',
      }),
    ]));
    expect(decision.claim_gate_evaluation_audit_packet).toEqual(expect.objectContaining({
      artifact_type: 'halofire.official_flow_claim_gate_evaluation_audit_packet.v1',
      source_review_decision_evidence_id: decision.id,
      source_replay_evidence_id: persisted.id,
      status: 'fail_closed_review_recorded',
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
      claims_cleared_count: 0,
    }));
    expect(decision.claim_gate_evaluation_audit_packet.evaluation_rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        gate_code: 'PROFESSIONAL_REVIEW_MISSING',
        evidence_ref: 'pe-review://pending-official-flow-review',
        gate_status: 'blocked',
      }),
      expect.objectContaining({
        gate_code: 'AHJ_APPROVAL_MISSING',
        evidence_ref: 'ahj://pending-official-flow-review',
        gate_status: 'blocked',
      }),
      expect.objectContaining({
        gate_code: 'AUTOSPRINK_EVIDENCE_MISSING',
        evidence_ref: 'autosprink://pending-parity-export',
        gate_status: 'blocked',
      }),
      expect.objectContaining({
        gate_code: 'OFFICIAL_FLOW_TEST_REVIEW_MISSING',
        evidence_ref: 'field-flow-report.pdf#page=1',
        gate_status: 'blocked',
      }),
    ]));
    expect(decision.claim_gate_evaluation_audit_packet.blocked_claims).toEqual(
      expect.arrayContaining(['permit_ready', 'AHJ_approval', 'PE_review', 'AutoSprink_parity']),
    );

    const signedQueueRes = await fetch(`${BASE}/api/projects/${encodeURIComponent(projectName)}/resolver-queue`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(signedQueueRes.status).toBe(200);
    const signedQueue = await signedQueueRes.json();
    const signedReviewItem = signedQueue.items.find((item) => (
      item.kind === 'official_flow_signed_reviewer_validation'
      && item.source_review_decision_evidence_id === decision.id
    ));
    expect(signedReviewItem).toEqual(expect.objectContaining({
      artifact_type: 'halofire.official_flow_signed_reviewer_validation_queue_item.v1',
      status: 'signed_reviewer_validation_needed',
      evidence_id: decision.id,
      source_review_decision_evidence_id: decision.id,
      source_replay_evidence_id: persisted.id,
      source_original_official_flow_evidence_id: created.id,
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
      claims_cleared_count: 0,
    }));
    expect(signedReviewItem.validation_rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        target_gate_code: 'PROFESSIONAL_REVIEW_MISSING',
        required_evidence_type: 'professional_review',
        claim_gate_effect: 'no_claims_cleared',
        source_review_decision_evidence_id: decision.id,
        action: expect.objectContaining({
          label: 'Open professional signed reviewer workflow',
        }),
      }),
      expect.objectContaining({
        target_gate_code: 'AHJ_APPROVAL_MISSING',
        required_evidence_type: 'ahj_approval',
        claim_gate_effect: 'no_claims_cleared',
        source_review_decision_evidence_id: decision.id,
        action: expect.objectContaining({
          label: 'Open AHJ signed reviewer workflow',
        }),
      }),
      expect.objectContaining({
        target_gate_code: 'AUTOSPRINK_EVIDENCE_MISSING',
        required_evidence_type: 'autosprink_packet',
        claim_gate_effect: 'no_claims_cleared',
        source_review_decision_evidence_id: decision.id,
        action: expect.objectContaining({
          label: 'Open AutoSprink signed reviewer workflow',
        }),
      }),
    ]));
    for (const row of signedReviewItem.validation_rows) {
      expect(row.action.href).toContain('/settings.html?');
      expect(row.action.href).toContain(`gate=${encodeURIComponent(row.target_gate_code)}`);
      expect(row.action.href).toContain(`evidenceId=${decision.id}`);
      expect(row.action.href).toContain('#wizSignoff');
      expect(row.queue_action).toEqual(expect.objectContaining({
        label: expect.stringContaining('Open pending'),
        source_review_decision_evidence_id: decision.id,
        claim_gate_effect: 'no_claims_cleared',
        no_claim_gates_cleared: true,
      }));
      expect(row.queue_action.href).toContain(`/api/projects/${encodeURIComponent(projectName)}/resolver-queue?`);
      expect(row.queue_action.href).toContain(`officialFlowReviewDecisionEvidenceId=${decision.id}`);
      expect(row.queue_action.href).toContain(`targetGate=${encodeURIComponent(row.target_gate_code)}`);
      expect(row.queue_action.href).toContain(`evidenceType=${encodeURIComponent(row.required_evidence_type)}`);
      expect(row.signed_evidence_resolve_action).toEqual(expect.objectContaining({
        label: expect.stringContaining('Upload real signed evidence'),
        method: 'POST',
        source_review_decision_evidence_id: decision.id,
        target_gate_code: row.target_gate_code,
        required_evidence_type: row.required_evidence_type,
        claim_gate_effect: 'requires_real_signed_evidence',
        no_claim_gates_cleared: true,
        claims_cleared_count: 0,
      }));
      expect(row.signed_evidence_resolve_action.href).toContain('/settings.html?');
      expect(row.signed_evidence_resolve_action.href).toContain('action=resolve');
      expect(row.signed_evidence_resolve_action.href).toContain(`gate=${encodeURIComponent(row.target_gate_code)}`);
      expect(row.signed_evidence_resolve_action.href).toContain(`evidenceId=${decision.id}`);
      expect(row.signed_evidence_resolve_action.href).toContain('#wizSignoff');
      expect(row.signed_evidence_resolve_action.resolve_route).toContain(`/api/projects/${encodeURIComponent(projectName)}/claim-gates/${encodeURIComponent(row.target_gate_code)}/resolve`);
      expect(row.signed_evidence_resolve_action.after_success_queue_filter).toContain('claimGateAudit=cleared');
      expect(row.signed_evidence_resolve_action.after_success_queue_filter).toContain(`targetGate=${encodeURIComponent(row.target_gate_code)}`);
    }
    const scopedSignedQueueRes = await fetch(`${BASE}/api/projects/${encodeURIComponent(projectName)}/resolver-queue?officialFlowReviewDecisionEvidenceId=${decision.id}&targetGate=AHJ_APPROVAL_MISSING&evidenceType=ahj_approval`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(scopedSignedQueueRes.status).toBe(200);
    const scopedSignedQueue = await scopedSignedQueueRes.json();
    expect(scopedSignedQueue.filters.officialFlowReviewDecisionEvidenceId).toBe(decision.id);
    expect(scopedSignedQueue.items).toHaveLength(1);
    expect(scopedSignedQueue.items[0]).toEqual(expect.objectContaining({
      kind: 'official_flow_signed_reviewer_validation',
      source_review_decision_evidence_id: decision.id,
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
    }));
    expect(scopedSignedQueue.items[0].validation_rows).toEqual([
      expect.objectContaining({
        target_gate_code: 'AHJ_APPROVAL_MISSING',
        required_evidence_type: 'ahj_approval',
        source_review_decision_evidence_id: decision.id,
        claim_gate_effect: 'no_claims_cleared',
        no_claim_gates_cleared: true,
      }),
    ]);
    const laneSignedQueueRes = await fetch(`${BASE}/api/projects/${encodeURIComponent(projectName)}/resolver-queue?officialFlowSignedReviewer=pending&targetGate=AHJ_APPROVAL_MISSING&evidenceType=ahj_approval`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(laneSignedQueueRes.status).toBe(200);
    const laneSignedQueue = await laneSignedQueueRes.json();
    expect(laneSignedQueue.filters.officialFlowSignedReviewer).toBe('pending');
    expect(laneSignedQueue.items).toHaveLength(1);
    expect(laneSignedQueue.items[0]).toEqual(expect.objectContaining({
      kind: 'official_flow_signed_reviewer_validation',
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
    }));
    expect(laneSignedQueue.items[0].validation_rows).toEqual([
      expect.objectContaining({
        target_gate_code: 'AHJ_APPROVAL_MISSING',
        required_evidence_type: 'ahj_approval',
        claim_gate_effect: 'no_claims_cleared',
      }),
    ]);
    expect(signedQueue.summary.official_flow_signed_reviewer_validation_needed).toBeGreaterThanOrEqual(1);
    expect(signedQueue.summary.official_flow_signed_reviewer_professional_rows).toBeGreaterThanOrEqual(1);
    expect(signedQueue.summary.official_flow_signed_reviewer_ahj_rows).toBeGreaterThanOrEqual(1);
    expect(signedQueue.summary.official_flow_signed_reviewer_autosprink_rows).toBeGreaterThanOrEqual(1);
  }, 15000);

  it('persists official-flow replay artifacts for disposable projects with posted floorPlan overrides', async () => {
    const projectName = 'Codex Disposable Official Flow FloorPlan Override';
    const createRes = await fetch(`${BASE}/api/projects/${encodeURIComponent(projectName)}/resolver-packets/official-flow/intake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        staticPsi: 68,
        residualPsi: 58,
        flowingGpm: 820,
        flowDataDate: '2026-06-05',
        waterModelRequired: 'employee placeholder until real official-flow values are attached',
        source_file: 'disposable-official-flow.pdf',
        source_ref: 'disposable-official-flow.pdf#page=1',
        notes: 'Disposable floorPlan replay smoke; no regulated claims cleared.',
      }),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const persistRes = await fetch(`${BASE}/api/projects/${encodeURIComponent(projectName)}/resolver-packets/official-flow/${created.id}/replay-artifact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        floorPlan: {
          name: projectName,
          units: 'ft',
          rooms: [
            {
              id: 'disposable-room-1',
              name: 'Disposable Room 1',
              polygon: [[0, 0], [40, 0], [40, 30], [0, 30]],
              ceilingHeightFt: 12,
              hazard: 'ordinary',
            },
          ],
        },
        markupPct: 25,
      }),
    });
    expect(persistRes.status).toBe(201);
    const persisted = await persistRes.json();
    expect(persisted).toEqual(expect.objectContaining({
      message: expect.stringMatching(/claims still blocked/i),
      artifact: expect.objectContaining({
        artifact_type: 'official_flow_hydraulic_replay_artifact',
        project_name: projectName,
        source_evidence_id: created.id,
        claim_gate_effect: 'no_claims_cleared',
      }),
      evidence: expect.objectContaining({
        evidence_type: 'official_flow_hydraulic_replay_artifact',
        status: 'best_effort',
      }),
    }));
    expect(persisted.artifact.bid_summary).toEqual(expect.objectContaining({
      total_area_sqft: expect.any(Number),
      total_head_count: expect.any(Number),
    }));
    expect(persisted.artifact.blocked_claims).toEqual(
      expect.arrayContaining(['permit_ready', 'AHJ_approval', 'PE_review', 'AutoSprink_parity']),
    );
  });

  it('imports source-linked official-flow attachment intake records without clearing claims', async () => {
    const projectName = 'The Cooperative 1881 - Salt Lake City UT';
    const importRes = await fetch(`${BASE}/api/projects/${encodeURIComponent(projectName)}/resolver-packets/official-flow/attachment-intake-records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        artifact_type: 'official_flow_evidence_attachment_intake_records',
        source_ref: 'halo_forge/official_flow_evidence_attachment_preflight/official-flow-evidence-attachment-intake.json',
        rows: [
          {
            attachment_kind: 'source_document',
            accepted_for_inventory_rerun: true,
            source_file: '1881-official-flow.pdf',
            source_ref: '1881-official-flow.pdf#page=2',
            staticPsi: 71,
            residualPsi: 59,
            flowingGpm: 940,
            flowDataDate: '2026-06-01',
            reviewer_name: 'HaloFire Employee',
            waterModelRequired: 'Use for internal-alpha replay only until authority/professional evidence is attached.',
          },
          {
            attachment_kind: 'source_document',
            accepted_for_inventory_rerun: false,
            source_file: 'bad-flow-row.pdf',
            source_ref: 'bad-flow-row.pdf#page=1',
            rejection_reason: 'missing residual pressure',
          },
        ],
      }),
    });
    expect(importRes.status).toBe(201);
    const imported = await importRes.json();
    expect(imported).toEqual(expect.objectContaining({
      artifact_type: 'halofire.official_flow_attachment_intake_records.v1',
      row_count: 2,
      accepted_for_inventory_rerun_count: 1,
      official_flow_intake_evidence_count: 1,
      claims_cleared_count: 0,
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
    }));
    expect(imported.accepted_rows[0]).toEqual(expect.objectContaining({
      source_ref: '1881-official-flow.pdf#page=2',
      official_flow_intake_evidence_id: expect.any(Number),
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(imported.rejected_rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source_ref: 'bad-flow-row.pdf#page=1',
        rejection_reason: 'missing residual pressure',
      }),
    ]));
    expect(imported.blocked_claims).toEqual(
      expect.arrayContaining(['permit_ready', 'AHJ_approval', 'PE_review', 'AutoSprink_parity']),
    );

    const evidenceRes = await fetch(`${BASE}/api/projects/${encodeURIComponent(projectName)}/evidence`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(evidenceRes.status).toBe(200);
    const evidenceRows = await evidenceRes.json();
    expect(evidenceRows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: imported.packet_evidence_id,
        evidence_type: 'official_flow_attachment_intake_records',
        status: 'present',
      }),
      expect.objectContaining({
        id: imported.accepted_rows[0].official_flow_intake_evidence_id,
        evidence_type: 'official_flow_intake',
        status: 'present',
        source_ref: '1881-official-flow.pdf#page=2',
      }),
    ]));

    const queueRes = await fetch(`${BASE}/api/projects/${encodeURIComponent(projectName)}/resolver-queue`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(queueRes.status).toBe(200);
    const queue = await queueRes.json();
    const item = queue.items.find((row) => row.kind === 'official_flow_intake');
    expect(item).toEqual(expect.objectContaining({
      status: 'official_flow_evidence_recorded',
      evidence_id: imported.accepted_rows[0].official_flow_intake_evidence_id,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(item.input_defaults).toEqual(expect.objectContaining({
      source_status: 'employee_recorded_official_flow_intake',
      staticPsi: 71,
      residualPsi: 59,
      flowingGpm: 940,
    }));

    const replayRes = await fetch(`${BASE}/api/projects/${encodeURIComponent(projectName)}/resolver-packets/official-flow/${imported.accepted_rows[0].official_flow_intake_evidence_id}/replay-artifact`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(replayRes.status).toBe(201);
    const replay = await replayRes.json();
    expect(replay.artifact).toEqual(expect.objectContaining({
      source_evidence_id: imported.accepted_rows[0].official_flow_intake_evidence_id,
      source_attachment_intake_packet_evidence_id: imported.packet_evidence_id,
      source_attachment_intake_row_index: 0,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(replay.artifact.official_flow_input).toEqual(expect.objectContaining({
      source_ref: '1881-official-flow.pdf#page=2',
      source_attachment_intake_packet_evidence_id: imported.packet_evidence_id,
      source_attachment_intake_row_index: 0,
    }));
    const replayNotes = JSON.parse(replay.evidence.notes);
    expect(replayNotes).toEqual(expect.objectContaining({
      source_attachment_intake_packet_evidence_id: imported.packet_evidence_id,
      source_attachment_intake_row_index: 0,
      claim_gate_effect: 'no_claims_cleared',
    }));

    const reviewPacketRes = await fetch(`${BASE}/api/projects/${encodeURIComponent(projectName)}/resolver-packets/official-flow-replay/${replay.id}/review-packet`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(reviewPacketRes.status).toBe(200);
    const reviewPacket = await reviewPacketRes.json();
    expect(reviewPacket).toEqual(expect.objectContaining({
      source_attachment_intake_packet_evidence_id: imported.packet_evidence_id,
      source_attachment_intake_row_index: 0,
      claim_gate_effect: 'no_claims_cleared',
    }));
    expect(reviewPacket.source_refs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        evidence_id: imported.packet_evidence_id,
        evidence_type: 'official_flow_attachment_intake_records',
        source_ref: 'halo_forge/official_flow_evidence_attachment_preflight/official-flow-evidence-attachment-intake.json',
        status: 'referenced',
      }),
    ]));

    const decisionRes = await fetch(`${BASE}/api/projects/${encodeURIComponent(projectName)}/resolver-packets/official-flow-replay/${replay.id}/review-decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        reviewer_name: 'HaloFire Employee',
        reviewer_title: 'Internal Alpha Reviewer',
        professional_review_ref: 'pe-review://pending-source-linked-flow',
        ahj_review_ref: 'ahj://pending-source-linked-flow',
        autosprink_export_ref: 'autosprink://pending-source-linked-flow',
        official_flow_test_ref: '1881-official-flow.pdf#page=2',
        review_decision: 'recorded_evidence_refs_fail_closed',
        notes: 'Source-linked attachment intake row recorded for review handoff; no claim gates cleared.',
      }),
    });
    expect(decisionRes.status).toBe(201);
    const decision = await decisionRes.json();
    expect(decision).toEqual(expect.objectContaining({
      artifact_type: 'halofire.official_flow_professional_ahj_review_decision.v1',
      source_replay_evidence_id: replay.id,
      source_attachment_intake_packet_evidence_id: imported.packet_evidence_id,
      source_attachment_intake_row_index: 0,
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
      claims_cleared_count: 0,
    }));
    expect(decision.claim_gate_evaluation_audit_packet).toEqual(expect.objectContaining({
      source_review_decision_evidence_id: decision.id,
      source_replay_evidence_id: replay.id,
      source_attachment_intake_packet_evidence_id: imported.packet_evidence_id,
      source_attachment_intake_row_index: 0,
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
      claims_cleared_count: 0,
    }));

    const signedQueueRes = await fetch(`${BASE}/api/projects/${encodeURIComponent(projectName)}/resolver-queue?officialFlowReviewDecisionEvidenceId=${decision.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(signedQueueRes.status).toBe(200);
    const signedQueue = await signedQueueRes.json();
    expect(signedQueue.items).toHaveLength(1);
    expect(signedQueue.items[0]).toEqual(expect.objectContaining({
      kind: 'official_flow_signed_reviewer_validation',
      source_review_decision_evidence_id: decision.id,
      source_attachment_intake_packet_evidence_id: imported.packet_evidence_id,
      source_attachment_intake_row_index: 0,
      claim_gate_effect: 'no_claims_cleared',
    }));
    for (const row of signedQueue.items[0].validation_rows) {
      expect(row).toEqual(expect.objectContaining({
        source_attachment_intake_packet_evidence_id: imported.packet_evidence_id,
        source_attachment_intake_row_index: 0,
        claim_gate_effect: 'no_claims_cleared',
      }));
      expect(row.queue_action).toEqual(expect.objectContaining({
        source_attachment_intake_packet_evidence_id: imported.packet_evidence_id,
        source_attachment_intake_row_index: 0,
        claim_gate_effect: 'no_claims_cleared',
      }));
      expect(row.signed_evidence_resolve_action).toEqual(expect.objectContaining({
        source_attachment_intake_packet_evidence_id: imported.packet_evidence_id,
        source_attachment_intake_row_index: 0,
        claim_gate_effect: 'requires_real_signed_evidence',
      }));
    }
  }, 15000);

  it('builds and imports Cooperative 1881 default official-flow attachment intake without clearing claims', async () => {
    const projectName = 'The Cooperative 1881 - Salt Lake City UT';
    const packetRes = await fetch(`${BASE}/api/projects/${encodeURIComponent(projectName)}/resolver-packets/official-flow/default-attachment-intake-records`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(packetRes.status).toBe(200);
    const packet = await packetRes.json();
    expect(packet).toEqual(expect.objectContaining({
      artifact_type: 'halofire.official_flow_default_attachment_intake_records.v1',
      source_artifact_type: 'official_flow_evidence_attachment_intake_records',
      project_name: projectName,
      source_file: 'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx',
      source_status: 'temporary_best_guess_until_employee_updates',
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
    }));
    expect(packet.rows).toEqual([
      expect.objectContaining({
        accepted_for_inventory_rerun: true,
        source_file: 'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx',
        source_ref: expect.stringContaining('#Building (1)!'),
        staticPsi: 71,
        residualPsi: 59,
        flowingGpm: 940,
        source_status: 'temporary_best_guess_until_employee_updates',
      }),
    ]);
    expect(packet.source_refs).toEqual(expect.arrayContaining([
      expect.stringContaining('Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!G6'),
      expect.stringContaining('Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!B9'),
    ]));
    expect(packet.blocked_claims).toEqual(expect.arrayContaining(['permit_ready', 'AHJ_approval', 'PE_review', 'AutoSprink_parity']));

    const importRes = await fetch(`${BASE}/api/projects/${encodeURIComponent(projectName)}/resolver-packets/official-flow/default-attachment-intake-records/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
    expect(importRes.status).toBe(201);
    const imported = await importRes.json();
    expect(imported).toEqual(expect.objectContaining({
      artifact_type: 'halofire.official_flow_attachment_intake_records.v1',
      source_artifact_type: 'official_flow_evidence_attachment_intake_records',
      source_default_packet_artifact_type: 'halofire.official_flow_default_attachment_intake_records.v1',
      accepted_for_inventory_rerun_count: 1,
      official_flow_intake_evidence_count: 1,
      claims_cleared_count: 0,
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
    }));
    expect(imported.accepted_rows[0]).toEqual(expect.objectContaining({
      source_file: 'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx',
      source_ref: expect.stringContaining('#Building (1)!'),
      staticPsi: 71,
      residualPsi: 59,
      flowingGpm: 940,
      claim_gate_effect: 'no_claims_cleared',
    }));

    const gates = await fetch(`${BASE}/api/projects/${encodeURIComponent(projectName)}/claim-gates`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(gates.status).toBe(200);
    const gateRows = await gates.json();
    expect(gateRows.find((gate) => gate.code === 'PROFESSIONAL_REVIEW_MISSING')).toEqual(expect.objectContaining({ status: 'blocked' }));
    expect(gateRows.find((gate) => gate.code === 'AHJ_APPROVAL_MISSING')).toEqual(expect.objectContaining({ status: 'blocked' }));
    expect(gateRows.find((gate) => gate.code === 'AUTOSPRINK_EVIDENCE_MISSING')).toEqual(expect.objectContaining({ status: 'blocked' }));
  }, 15000);
});

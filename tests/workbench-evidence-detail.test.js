import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3214;
const BASE = `http://127.0.0.1:${PORT}`;
let server; let tempDir;

async function waitForHealth() {
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server not healthy');
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-workbench-detail-'));
  server = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: 'test',
      HALOFIRE_DB_PATH: path.join(tempDir, 'h.db'),
      JWT_SECRET: 'test-jwt-secret-with-more-than-32-characters',
      HALOFIRE_ADMIN_USER: 'admin',
      HALOFIRE_ADMIN_PASSWORD: 'workbench-detail-pw',
      HALOFIRE_ALLOW_DEV_DEFAULTS: '0',
      HALOFIRE_CORS_ORIGINS: 'http://allowed.test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
});

afterAll(async () => {
  if (server && !server.killed) {
    server.kill();
    await new Promise((r) => server.once('exit', r));
  }
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('workbench evidence detail rendering', () => {
  it('includes catalog approval validation evidence details for signed reviewer readback', async () => {
    const shell = await fetch(`${BASE}/workbench.html`, { headers: { Origin: BASE } });
    expect(shell.status).toBe(200);
    const html = await shell.text();
    expect(html).toContain("packet.kind === 'catalog_source_approval_validation'");
    expect(html).toContain('catalog approval validation');
    expect(html).toContain('approval_ref_field');
    expect(html).toContain('target_gate_code');
    expect(html).toContain('source_catalog_ref');
  });

  it('anchors saved PDF boundary evidence rows for resolver handoff readback', async () => {
    const shell = await fetch(`${BASE}/workbench.html`, { headers: { Origin: BASE } });
    expect(shell.status).toBe(200);
    const html = await shell.text();
    expect(html).toContain('id="evidence-${escapeHtml(e.id)}"');
    expect(html).toContain('source_ref');
    expect(html).toContain('employee_notes');
  });

  it('surfaces supplied bid-truth downstream defaults on sprinkler bid results without clearing claims', async () => {
    const shell = await fetch(`${BASE}/workbench.html`, { headers: { Origin: BASE } });
    expect(shell.status).toBe(200);
    const html = await shell.text();
    expect(html).toContain('renderSuppliedBidTruthDownstreamDefaults');
    expect(html).toContain('bidTruthDefaultsCard');
    expect(html).toContain('data-supplied-bid-truth-downstream-download');
    expect(html).toContain('/resolver-packets/supplied-document-bid-truth/downstream-defaults-packet');
    expect(html).toContain('source_supplied_document_bid_truth_replacement_evidence_id');
    expect(html).toContain('employee_replacement_applied');
    expect(html).toContain('supplied_document_bid_truth_replacement');
    expect(html).toContain('no_claims_cleared');
  });

  it('surfaces saved SAM31 sectioning contract review evidence details without clearing claims', async () => {
    const shell = await fetch(`${BASE}/workbench.html`, { headers: { Origin: BASE } });
    expect(shell.status).toBe(200);
    const html = await shell.text();
    expect(html).toContain("row.evidence_type === 'openclaw_sam31_sectioning_pipeline_contract_review'");
    expect(html).toContain('Saved SAM31 sectioning contract review evidence detail');
    expect(html).toContain('openclaw.sam31.sectioning_pipeline_contract_review.v1');
    expect(html).toContain('source_openclaw_sam31_extrapolation_evidence_id');
    expect(html).toContain('source_sectioning_pipeline_contract_artifact_type');
    expect(html).toContain('replacement_ref');
    expect(html).toContain('Replaced sectioning fields');
    expect(html).toContain('semantic_labels');
    expect(html).toContain('vector_overlays');
    expect(html).toContain('model_3d_candidates');
    expect(html).toContain('claim_gate_effect');
    expect(html).toContain('no_claims_cleared');
  });

  it('surfaces saved SAM31 consumer replacement summaries as employee actual-value work items', async () => {
    const shell = await fetch(`${BASE}/workbench.html`, { headers: { Origin: BASE } });
    expect(shell.status).toBe(200);
    const html = await shell.text();
    expect(html).toContain("row.evidence_type === 'openclaw_sam31_consumer_review'");
    expect(html).toContain('SAM31 consumer replacement summary');
    expect(html).toContain('semantic_label_count');
    expect(html).toContain('llm_observation_count');
    expect(html).toContain('llm_observation_ids');
    expect(html).toContain('source_llm_observation_ids');
    expect(html).toContain('object_hypothesis_count');
    expect(html).toContain('vector_overlay_count');
    expect(html).toContain('model_3d_candidate_count');
    expect(html).toContain('replacement_values_source_ref');
    expect(html).toContain('employee_actual_value_next_action');
    expect(html).toContain('acceptable_actual_evidence');
    expect(html).toContain('Replace SAM31 best guesses with actual HaloFire documentation values');
    expect(html).toContain('Download SAM31 actual-value work item');
    expect(html).toContain('downloadOpenClawSam31ActualValueWorkItemPacket');
    expect(html).toContain('data-sam31-consumer-actual-value-work-item-evidence-id');
    expect(html).toContain('openclaw.sam31.actual_value_work_item_packet.v1');
    expect(html).toContain('/openclaw/sam31/consumer-review/');
    expect(html).toContain('/actual-value-work-item');
    expect(html).toContain('1881 proposal workbook row or sheet reference');
    expect(html).toContain('reviewed vector overlay SVG or marked-up plan ref');
    expect(html).toContain('reviewed 3D model candidate ref or model note');
    expect(html).toContain('permit_ready');
    expect(html).toContain('fabrication_ready');
    expect(html).toContain('no_claims_cleared');
  });

  it('surfaces the SAM31 actual-value queue in the signed workbench portal', async () => {
    const shell = await fetch(`${BASE}/workbench.html`, { headers: { Origin: BASE } });
    expect(shell.status).toBe(200);
    const html = await shell.text();
    expect(html).toContain('SAM31 Actual-Value Queue');
    expect(html).toContain('id="sam31ActualValueQueue"');
    expect(html).toContain('/openclaw/sam31/actual-value-work-items');
    expect(html).toContain('/openclaw/sam31/actual-value-resolver-queue');
    expect(html).toContain('/api/openclaw/sam31/actual-value-resolver-queue?projectName=');
    expect(html).toContain('/api/openclaw/sam31/actual-value-replacements?projectName=');
    expect(html).toContain('openclaw.sam31.actual_value_replacement_readback.v1');
    expect(html).toContain('poll_actual_value_replacement_details');
    expect(html).toContain('data-sam31-actual-value-replacement-readback-consumer');
    expect(html).toContain('downloadSam31ActualValueReplacementReadback');
    expect(html).toContain('openclaw.sam31.actual_value_resolver_replay.v1');
    expect(html).toContain('actual_value_resolver_replay');
    expect(html).toContain('downloadSam31ActualValueResolverReplay');
    expect(html).toContain('lastSam31ActualValueResolverReplay');
    expect(html).toContain('data-sam31-actual-value-resolver-replay-download');
    expect(html).toContain('renderSam31ActualValueQueueSummary');
    expect(html).toContain('sam31ActualValueQueueSummary');
    expect(html).toContain('renderSam31ActualValueReplacementDetail');
    expect(html).toContain('latest_actual_value_replacement_evidence');
    expect(html).toContain('actual_value_evidence_recorded');
    expect(html).toContain('actual-value evidence');
    expect(html).toContain('actual_value_replacement_prefill');
    expect(html).toContain('halofire.sam31_actual_value_replacement_prefill.v1');
    expect(html).toContain('renderSam31ActualValueReplacementPrefill');
    expect(html).toContain('data-sam31-actual-value-prefill-source-ref');
    expect(html).toContain('data-sam31-actual-value-prefill-source-file');
    expect(html).toContain('sam31ActualValueSourceRef-');
    expect(html).toContain('sam31ActualValueSourceFile-');
    expect(html).toContain('sam31ActualValueReplacementValuesSourceRef-');
    expect(html).toContain('sam31ActualValueSourceRefs-');
    expect(html).toContain('source_refs');
    expect(html).toContain('evidence_status');
    expect(html).toContain('source_ref');
    expect(html).toContain('no_claim_gates_cleared');
    expect(html).toContain('openclaw.sam31.actual_value_resolver_queue.v1');
    expect(html).toContain('renderSam31ActualValueResolverExtrapolationContract');
    expect(html).toContain('sam31_llm_extrapolation_contract');
    expect(html).toContain('openclaw.sam31.actual_value_resolver_extrapolation_contract.v1');
    expect(html).toContain('/api/openclaw/sam31/actual-value-resolver-contract?projectName=');
    expect(html).toContain('openclaw.sam31.actual_value_resolver_contract_packet.v1');
    expect(html).toContain('downloadSam31ActualValueResolverContractPacket');
    expect(html).toContain('data-sam31-actual-value-resolver-contract-download');
    expect(html).toContain('/openclaw/sam31/actual-value-resolver-contract/evidence');
    expect(html).toContain('saveSam31ActualValueResolverContractEvidence');
    expect(html).toContain('data-sam31-actual-value-resolver-contract-save');
    expect(html).toContain('Saved openclaw_sam31_actual_value_resolver_contract evidence');
    expect(html).toContain('supports_object_identification');
    expect(html).toContain('supports_vector_overlays');
    expect(html).toContain('supports_model_3d_candidates');
    expect(html).toContain('object_identification');
    expect(html).toContain('model_3d_candidate');
    expect(html).toContain('actual_value_replacements_pending');
    expect(html).toContain('pending_count');
    expect(html).toContain('recorded_count');
    expect(html).toContain('poll_actual_value_resolver_queue');
    expect(html).toContain('data-sam31-actual-value-consumer-filter');
    expect(html).toContain('data-sam31-actual-value-clear-filter');
    expect(html).toContain('filterSam31ActualValueQueueByConsumer');
    expect(html).toContain('consumer=landscout');
    expect(html).toContain('consumer=nameforge');
    expect(html).toContain('refreshSam31ActualValueQueue');
    expect(html).toContain('renderSam31ActualValueQueueItem');
    expect(html).toContain('downloadSam31ActualValueQueuePacket');
    expect(html).toContain('recordSam31ActualValueQueueEvidence');
    expect(html).toContain('data-sam31-actual-value-queue-download-index');
    expect(html).toContain('data-sam31-actual-value-queue-record-index');
    expect(html).toContain("/openclaw/sam31/actual-value-replacements', {");
    expect(html).toContain('halofire.sam31_actual_value_replacement_intake.v1');
    expect(html).toContain('openclaw.sam31.actual_value_work_item_packet.v1');
    expect(html).toContain('halofire.sam31_actual_value_work_item_index.v1');
    expect(html).toContain('sam31_actual_value_replacement');
    expect(html).toContain('employee_actual_value_next_action');
    expect(html).toContain('acceptable_actual_evidence');
    expect(html).toContain('semantic_label_count');
    expect(html).toContain('llm_observation_count');
    expect(html).toContain('source_llm_observation_ids');
    expect(html).toContain('model_3d_candidate_count');
    expect(html).toContain('use_for_claims false');
    expect(html).toContain('claim_gate_effect no_claims_cleared');
    expect(html).toMatch(/Saved openclaw_sam31_consumer_review evidence[\s\S]*await refreshResolverQueue\(\);\s*await refreshSam31ActualValueQueue\(\);/);
    expect(html).toMatch(/openOpenClawSam31ProductOwnerReplacementIntake[\s\S]*await refreshResolverQueue\(\);\s*await refreshSam31ActualValueQueue\(\);[\s\S]*Opened product_owner_replacement_intake evidence/);
  });

  it('surfaces SAM31 sectioning downstream resolver rows and filter links in the workbench', async () => {
    const shell = await fetch(`${BASE}/workbench.html`, { headers: { Origin: BASE } });
    expect(shell.status).toBe(200);
    const html = await shell.text();
    expect(html).toContain('renderHalofireSam31SectioningDownstreamResolverQueue');
    expect(html).toContain('SAM31 sectioning downstream resolver queue');
    expect(html).toContain('sam31_sectioning_downstream_resolver_queue_items');
    expect(html).toContain('halofire.sam31_sectioning_downstream_resolver_queue_item.v1');
    expect(html).toContain('sam31SectioningReview=ready&lane=obstruction_or_clash_review');
    expect(html).toContain('source_openclaw_sam31_sectioning_pipeline_contract_review_evidence_id');
    expect(html).toContain('Download room-boundary replay input');
    expect(html).toContain('Download SAM31 vector/model artifact packet');
    expect(html).toContain('Download SAM31 sectioning downstream resolver packet');
    expect(html).toContain('Save SAM31 sectioning downstream resolver packet');
    expect(html).toContain('sectioning-downstream-resolvers');
    expect(html).toContain('downloadHalofireSam31SectioningDownstreamResolverPacket');
    expect(html).toContain('persistHalofireSam31SectioningDownstreamResolverPacket');
    expect(html).toContain('data-sam31-sectioning-downstream-resolver-evidence-id');
    expect(html).toContain('data-sam31-sectioning-downstream-resolver-save-evidence-id');
    expect(html).toContain('latest_halofire_sam31_sectioning_downstream_resolver_packet');
    expect(html).toContain('latest_halofire_sam31_sectioning_sprinkler_review_adapter');
    expect(html).toContain('Download SAM31 sectioning sprinkler review adapter');
    expect(html).toContain('Save SAM31 sectioning sprinkler review adapter');
    expect(html).toContain('halofire_sam31_sectioning_sprinkler_review_adapter');
    expect(html).toContain('data-sam31-sectioning-sprinkler-review-adapter-evidence-id');
    expect(html).toContain('data-sam31-sectioning-sprinkler-review-adapter-save-evidence-id');
    expect(html).toContain('downloadHalofireSam31SectioningSprinklerReviewAdapter');
    expect(html).toContain('persistHalofireSam31SectioningSprinklerReviewAdapter');
    expect(html).toContain('adapter_source');
    expect(html).toContain('halofire.sam31_sectioning_downstream_resolver_packet.v1');
    expect(html).toContain('no_claims_cleared');
  });

  it('exposes a quick filter for employee room-boundary correction rows', async () => {
    const shell = await fetch(`${BASE}/workbench.html`, { headers: { Origin: BASE } });
    expect(shell.status).toBe(200);
    const html = await shell.text();
    expect(html).toContain('roomBoundarySource=employee_review&roomBoundaryState=correction_ready');
    expect(html).toContain('Employee correction rows');
    expect(html).toContain('employee correction ready');
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3197;
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
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-static-origin-'));
  server = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: 'test',
      HALOFIRE_DB_PATH: path.join(tempDir, 'h.db'),
      JWT_SECRET: 'test-jwt-secret-with-more-than-32-characters',
      HALOFIRE_ADMIN_USER: 'admin',
      HALOFIRE_ADMIN_PASSWORD: 'static-origin-pw',
      HALOFIRE_ALLOW_DEV_DEFAULTS: '0',
      HALOFIRE_CORS_ORIGINS: 'http://allowed.test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
});

afterAll(async () => {
  if (server && !server.killed) { server.kill(); await new Promise((r) => server.once('exit', r)); }
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('studio static origin handling', () => {
  it('allows same-origin studio shell + module requests even when cross-origin allowlist is narrow', async () => {
    const headers = { Origin: BASE };

    const shell = await fetch(`${BASE}/autosprink.html`, { headers });
    expect(shell.status).toBe(200);

    const module = await fetch(`${BASE}/src/ui/export-proof.js`, { headers });
    expect(module.status).toBe(200);
  });

  it('still blocks unrelated origins', async () => {
    const shell = await fetch(`${BASE}/autosprink.html`, { headers: { Origin: 'http://evil.test' } });
    expect(shell.status).toBe(403);
  });

  it('surfaces PDF extraction-mode controls for the employee correction workflow', async () => {
    const shell = await fetch(`${BASE}/autosprink.html`, { headers: { Origin: BASE } });
    expect(shell.status).toBe(200);
    const html = await shell.text();
    expect(html).toContain('id="pdfExtract"');
    expect(html).toContain('value="outline"');
    expect(html).toContain('value="wallLayer"');
    expect(html).toContain('body.pdfExtract');
  });

  it('surfaces PDF page-inspection controls for employee sheet selection', async () => {
    const shell = await fetch(`${BASE}/autosprink.html`, { headers: { Origin: BASE } });
    expect(shell.status).toBe(200);
    const html = await shell.text();
    expect(html).toContain('id="pdfInspectBtn"');
    expect(html).toContain('id="pdfPageList"');
    expect(html).toContain('id="pdfPreview"');
    expect(html).toContain("api('/pdf/inspect'");
    expect(html).toContain('setPdfPageFromInspection');
  });

  it('surfaces PDF boundary-candidate review controls for selected pages', async () => {
    const shell = await fetch(`${BASE}/autosprink.html`, { headers: { Origin: BASE } });
    expect(shell.status).toBe(200);
    const html = await shell.text();
    expect(html).toContain('id="pdfCandidateBtn"');
    expect(html).toContain('id="pdfBoundaryCandidates"');
    expect(html).toContain("api('/pdf/boundary-candidates'");
    expect(html).toContain('applyPdfBoundaryCandidate');
  });

  it('surfaces PDF boundary-decision persistence controls for employee correction evidence', async () => {
    const shell = await fetch(`${BASE}/autosprink.html`, { headers: { Origin: BASE } });
    expect(shell.status).toBe(200);
    const html = await shell.text();
    expect(html).toContain('id="pdfDecisionBtn"');
    expect(html).toContain('id="pdfDecisionStatus"');
    expect(html).toContain('/pdf-boundary-decision');
    expect(html).toContain('savePdfBoundaryDecision');
  });

  it('lets the studio target the Cooperative 1881 project instead of only Home Depot', async () => {
    const shell = await fetch(`${BASE}/autosprink.html`, { headers: { Origin: BASE } });
    expect(shell.status).toBe(200);
    const html = await shell.text();
    expect(html).toContain('id="projectTarget"');
    expect(html).toContain('The Cooperative 1881 - Salt Lake City UT');
    expect(html).toContain('currentProjectName');
    expect(html).toContain("encodeURIComponent(currentProjectName())");
  });

  it('surfaces present roof coordination sources without claiming registration or approval', async () => {
    const shell = await fetch(`${BASE}/autosprink.html`, { headers: { Origin: BASE } });
    expect(shell.status).toBe(200);
    const html = await shell.text();
    expect(html).toContain('M109/P109 are present');
    expect(html).toContain('complete feature registration, clearances, and the Level 8 ceiling/attic protection basis remain unresolved');
    expect(html).toContain('not a code-compliance or approval claim');
    expect(html).toContain('currentProjectName() !== model.projectName');
    expect(html).toContain('Select the matching project before loading roof evidence');
  });

  it('surfaces the authenticated actual-DWG floor-by-floor model without expanding its claim', async () => {
    const shell = await fetch(`${BASE}/autosprink.html`, { headers: { Origin: BASE } });
    expect(shell.status).toBe(200);
    const html = await shell.text();
    expect(html).toContain('/api/projects/Dillon%20Residence/floor-by-floor-model');
    expect(html).toContain('/api/projects/LDS%20Temple%20-%20Nashville%20TN/floor-by-floor-model');
    expect(html).toContain('/api/projects/LDS%20Meeting%20House%20-%20Winter%20Garden%20FL/source-building-model');
    expect(html).toContain('/api/projects/LDS%20Meeting%20House%20-%20Winter%20Garden%20FL/source-space-registry');
    expect(html).toContain('/api/projects/LDS%20Meeting%20House%20-%20Winter%20Garden%20FL/source-space-topology');
    expect(html).toContain('hfWinterGardenSourceTopologyReceipt');
    expect(html).toContain('/api/projects/LDS%20Meeting%20House%20-%20Winter%20Garden%20FL/source-sprinkler-candidates');
    expect(html).toContain('hfWinterGardenSourceCandidateReceipt');
    expect(html).toContain('/api/projects/LDS%20Meeting%20House%20-%20Winter%20Garden%20FL/source-sprinkler-candidate-proof.png');
    expect(html).toContain('hfOperationalBrainReceipt');
    expect(html).toContain('display:grid;grid-auto-rows:max-content;gap:12px;color:#e5e7eb;overflow:auto;overscroll-behavior:contain');
    expect(html).toContain('Dillon actual-drawing building model');
    expect(html).toContain('Nashville actual-drawing building model');
    expect(html).toContain('A110 gray wall-poche shell was selected by PDF paint semantics before');
    expect(html).toContain('A301 controls Level 01 100.000 ft');
    expect(html).toContain('Interactive Dillon source-DWG floor-by-floor extrusion');
    expect(html).toContain('new THREE.ExtrudeGeometry');
    expect(html).toContain('Structural roof evidence');
    expect(html).toContain('the registered main/upper speckled contours are 2D roof evidence only');
    expect(html).toContain('No unresolved contour is flattened or promoted into the structural 3D model');
    expect(html).toContain('NOT CODE APPROVAL');
    expect(html).toContain('function initScaleBar() { updateScaleBar(); }');
  });

  it('lets the workbench target the Cooperative 1881 project instead of only Home Depot', async () => {
    const shell = await fetch(`${BASE}/official-flow.html`, { headers: { Origin: BASE } });
    expect(shell.status).toBe(200);
    const html = await shell.text();
    expect(html).toContain('id="projectTarget"');
    expect(html).toContain('The Cooperative 1881 - Salt Lake City UT');
    expect(html).toContain('currentProjectName');
    expect(html).toContain("encodeURIComponent(currentProjectName())");
  });

  it('surfaces resolver queue rows in the workbench', async () => {
    const shell = await fetch(`${BASE}/official-flow.html`, { headers: { Origin: BASE } });
    expect(shell.status).toBe(200);
    const html = await shell.text();
    expect(html).toContain('id="resolverQueue"');
    expect(html).toContain('/resolver-queue');
    expect(html).toContain('refreshResolverQueue');
    expect(html).toContain('room_boundary_visual_audit');
    expect(html).toContain('catalog_vendor_acquisition');
    expect(html).toContain('supplied_document_bid_truth');
    expect(html).toContain('halofire.supplied_document_bid_truth_status.v1');
    expect(html).toContain('supplied_document_bid_truth_review_needed');
    expect(html).toContain('Supplied document bid truth');
    expect(html).toContain('best_guess_until_employee_replaced');
    expect(html).toContain('/resolver-packets/supplied-document-bid-truth/review-packet');
    expect(html).toContain('/resolver-packets/supplied-document-bid-truth/replacements');
    expect(html).toContain('downloadSuppliedDocumentBidTruthReviewPacket');
    expect(html).toContain('saveSuppliedDocumentBidTruthReplacement');
    expect(html).toContain('data-supplied-document-bid-truth-packet');
    expect(html).toContain('data-supplied-document-bid-truth-save');
    expect(html).toContain('supplied_document_bid_truth_replacements_recorded');
    expect(html).toContain('latest_supplied_document_bid_truth_replacement');
    expect(html).toContain('replacement_values');
  });

  it('surfaces catalog source-acquisition ledger rows in the workbench with settings handoff actions', async () => {
    const shell = await fetch(`${BASE}/official-flow.html`, { headers: { Origin: BASE } });
    expect(shell.status).toBe(200);
    const html = await shell.text();
    expect(html).toContain('id="catalogSourceAcquisition"');
    expect(html).toContain('/auto-source/status');
    expect(html).toContain('refreshCatalogSourceAcquisition');
    expect(html).toContain('sourceAcquisitionLedger');
    expect(html).toContain('openCatalogEvidenceAction');
    expect(html).toContain('family:pipe_steel_sch40_2p0in');
    expect(html).toContain('family:fitting_tee_2p0in');
    expect(html).toContain('family:valve_check_2p5in');
    expect(html).toContain('claim_gate_effect');
    expect(html).toContain('manufacturer_exact');
    expect(html).toContain('Attach catalog evidence');
    expect(html).toContain('Download catalog source packet');
    expect(html).toContain('downloadCatalogSourceEvidencePacket');
    expect(html).toContain('/resolver-packets/catalog-source/');
    expect(html).toContain('data-catalog-source-packet-family-ref');
    expect(html).toContain('Validate catalog approval refs');
    expect(html).toContain('validateCatalogSourceApproval');
    expect(html).toContain('/approval-validation');
    expect(html).toContain('manufacturer_model_approval_ref');
    expect(html).toContain('professional_or_ahj_review_ref');
    expect(html).toContain('autosprink_or_equivalent_export_ref');
    expect(html).toContain('syncCatalogApprovalGateOptions');
    expect(html).toContain('data-approval-ref-field="manufacturer_model_approval_ref"');
    expect(html).toContain('data-approval-ref-field="professional_or_ahj_review_ref"');
    expect(html).toContain('data-approval-ref-field="autosprink_or_equivalent_export_ref"');
    expect(html).toContain('data-evidence-type="manufacturer_approval"');
    expect(html).toContain('data-evidence-type="professional_review"');
    expect(html).toContain('data-evidence-type="ahj_approval"');
    expect(html).toContain('data-evidence-type="autosprink_packet"');
    expect(html).toContain('Upload signed manufacturer model approval');
    expect(html).toContain('Upload signed professional review');
    expect(html).toContain('Upload signed AHJ approval');
    expect(html).toContain('Upload signed AutoSprink/equivalent export');
    expect(html).toContain('catalogApprovalNextAction');
    expect(html).toContain('downloadCatalogApprovalResolverPacket');
    expect(html).toContain('/approval-packet');
    expect(html).toContain('data-catalog-source-approval-packet-family-ref');
    expect(html).toContain('Download selected approval packet');
    expect(html).toContain('catalog_approval_packet_rows');
    expect(html).toContain('catalog_approval_packet_ready');
    expect(html).toContain('catalogApproval=ready');
    expect(html).toContain('evidenceType=ahj_approval');
    expect(html).toContain('AHJ approval packets');
    expect(html).toContain('catalogApprovalQuickFilter');
    expect(html).toContain('renderCatalogApprovalPacketRows');
    expect(html).toContain('Ready approval packets');
    expect(html).toContain('ready_for_signed_evidence_upload');
    expect(html).toContain('no claim gates cleared');
    expect(html).toContain('data-catalog-source-approval-family-ref');
    expect(html).toContain('catalogApprovalReviewerName');
    expect(html).toContain('catalogApprovalSignedAt');
    expect(html).toContain('Record catalog source evidence');
    expect(html).toContain('recordCatalogSourceEvidenceFromWorkbench');
    expect(html).toContain('data-catalog-source-record-family-ref');
    expect(html).toContain('halofire.catalog_source_acquisition_ledger_row.v1');
    const catalogResolverBranch = html.match(/if \(item\.kind === 'catalog_vendor_acquisition'\) \{([\s\S]*?)if \(item\.kind === 'official_flow_hydraulic_replay_review'\) \{/);
    expect(catalogResolverBranch?.[1]).toBeDefined();
    expect(catalogResolverBranch?.[1]).not.toContain('data-official-flow-replay-artifact-evidence-id');
  });

  it('lets Settings receive a catalog source-acquisition handoff for part override evidence', async () => {
    const shell = await fetch(`${BASE}/settings.html`, { headers: { Origin: BASE } });
    expect(shell.status).toBe(200);
    const html = await shell.text();
    expect(html).toContain('id="attachCatalogPart"');
    expect(html).toContain('prefillCatalogPartFromUrl');
    expect(html).toContain('URLSearchParams');
    expect(html).toContain('component');
    expect(html).toContain('catalogUrl');
  });

  it('surfaces catalog source-acquisition ledger rows in Settings beside the attach form', async () => {
    const shell = await fetch(`${BASE}/settings.html`, { headers: { Origin: BASE } });
    expect(shell.status).toBe(200);
    const html = await shell.text();
    expect(html).toContain('id="settingsCatalogSourceAcquisition"');
    expect(html).toContain('/auto-source/status');
    expect(html).toContain('loadSettingsCatalogSourceAcquisition');
    expect(html).toContain('sourceAcquisitionLedger');
    expect(html).toContain('prefillCatalogEvidenceFromLedger');
    expect(html).toContain('recordCatalogLedgerEvidence');
    expect(html).toContain('catalog_source_acquisition');
    expect(html).toContain('/projects/');
    expect(html).toContain('/evidence');
    expect(html).toContain('family:pipe_steel_sch40_2p0in');
    expect(html).toContain('family:fitting_tee_2p0in');
    expect(html).toContain('family:valve_check_2p5in');
    expect(html).toContain('acceptable_evidence');
    expect(html).toContain('blocked_claims');
    expect(html).toContain('no claim gates cleared');
  });

  it('lets the workbench download room-boundary review packets from resolver rows', async () => {
    const shell = await fetch(`${BASE}/official-flow.html`, { headers: { Origin: BASE } });
    expect(shell.status).toBe(200);
    const html = await shell.text();
    expect(html).toContain('downloadResolverPacket');
    expect(html).toContain('/resolver-packets/pdf-boundary/');
    expect(html).toContain('Download review packet');
    expect(html).toContain('downloadSam31VisualAuditPacket');
    expect(html).toContain('/sam31-visual-audit');
    expect(html).toContain('Download SAM 3.1 visual audit packet');
    expect(html).toContain('data-sam31-visual-audit-evidence-id');
    expect(html).toContain('saveSam31VisualAuditResult');
    expect(html).toContain('/sam31-visual-audit/results');
    expect(html).toContain('Record SAM 3.1 visual audit result');
    expect(html).toContain('sam31_result_ref');
    expect(html).toContain('data-sam31-visual-audit-save-evidence-id');
    expect(html).toContain('openclaw-sam31-smoke-artifact:');
    expect(html).toContain('source_openclaw_sam31_bridge_smoke_evidence_id');
    expect(html).toContain('data-sam31-bridge-smoke-source-evidence-id');
    expect(html).toContain('renderOpenClawSam31ExtrapolationAction');
    expect(html).toContain('openclaw_sam31_extrapolation_action');
    expect(html).toContain('Run OpenClaw SAM31 extrapolation artifact');
    expect(html).toContain('data-sam31-extrapolation-evidence-id');
    expect(html).toContain('runOpenClawSam31ExtrapolationArtifact');
    expect(html).toContain('/openclaw/sam31/extrapolation-artifact');
    expect(html).toContain('latest_openclaw_sam31_extrapolation_artifact');
    expect(html).toContain('latest_openclaw_sam31_extrapolation_review');
    expect(html).toContain('saveOpenClawSam31ExtrapolationReview');
    expect(html).toContain('/openclaw/sam31/extrapolation-review');
    expect(html).toContain('source_openclaw_sam31_extrapolation_evidence_id');
    expect(html).toContain('data-sam31-extrapolation-review-save-evidence-id');
    expect(html).toContain('Save employee SAM31 extrapolation review');
    expect(html).toContain('object_hypotheses');
    expect(html).toContain('vector_overlays');
    expect(html).toContain('model_3d_candidates');
    expect(html).toContain('downloadOpenClawSam31ExtrapolationReviewPacket');
    expect(html).toContain('/openclaw/sam31/extrapolation-review-packet');
    expect(html).toContain('Download SAM31 product review packet');
    expect(html).toContain('data-sam31-extrapolation-review-packet-evidence-id');
    expect(html).toContain('openclaw.sam31_extrapolation_product_review_packet');
    expect(html).toContain('downloadOpenClawSam31ProductReviewQueueItem');
    expect(html).toContain('/openclaw/sam31/product-review-queue-item');
    expect(html).toContain('Download SAM31 queue item');
    expect(html).toContain('data-sam31-product-review-queue-item-evidence-id');
    expect(html).toContain('openclaw.sam31.product_review_queue_item.v1 - extrapolation_index');
    expect(html).toContain('/openclaw/sam31/consumer-smoke');
    expect(html).toContain('/openclaw/sam31/consumer-smoke-packet');
    expect(html).toContain('Run LandScout/NameForge SAM31 queue smoke');
    expect(html).toContain('data-sam31-consumer-smoke-evidence-id');
    expect(html).toContain('data-sam31-consumer-smoke-packet-evidence-id');
    expect(html).toContain('runOpenClawSam31ConsumerSmoke');
    expect(html).toContain('downloadOpenClawSam31ConsumerSmokePacket');
    expect(html).toContain('latest_openclaw_sam31_consumer_smoke_artifact');
    expect(html).toContain('openclaw.sam31.consumer_smoke_artifact.v1');
    expect(html).toContain('Consumer smoke evidence:');
    expect(html).toContain('consumer_result');
    expect(html).toContain('accepted_queue_id');
    expect(html).toContain('persisted_review_packet_ref');
    expect(html).toContain('consumer_review_tasks');
    expect(html).toContain('openclaw.sam31.consumer_review_task.v1');
    expect(html).toContain('openclaw.sam31.consumer_review_task_decision.v1');
    expect(html).toContain('openclaw_sam31_consumer_review');
    expect(html).toContain('requires_product_review');
    expect(html).toContain('acceptable_evidence');
    expect(html).toContain('renderSam31RequiredSourceProvenanceFields');
    expect(html).toContain('required_source_provenance_fields');
    expect(html).toContain('source_openclaw_sam31_vector_model_artifact_evidence_id');
    expect(html).toContain('source_halofire_sam31_sectioning_sprinkler_review_adapter_evidence_id');
    expect(html).toContain('renderSam31ConsumerReviewReplacementSummary');
    expect(html).toContain('replacement_summary');
    expect(html).toContain('replacement_values_source_ref');
    expect(html).toContain('product owner review note tied to accepted queue id');
    expect(html).toContain('Save SAM31 consumer review decision');
    expect(html).toContain('saveOpenClawSam31ConsumerReview');
    expect(html).toContain('/openclaw/sam31/consumer-review');
    expect(html).toContain('Open product-owner replacement intake');
    expect(html).toContain('openOpenClawSam31ProductOwnerReplacementIntake');
    expect(html).toContain('data-sam31-product-owner-replacement-intake-evidence-id');
    expect(html).toContain('data-sam31-product-owner-replacement-intake-consumer');
    expect(html).toContain('Download SAM31 consumer review decision');
    expect(html).toContain('downloadOpenClawSam31ConsumerReviewPacket');
    expect(html).toContain('data-sam31-consumer-review-packet-evidence-id');
    expect(html).toContain('openclaw.sam31.consumer_review_decision_packet.v1');
    expect(html).toContain('sam31-consumer-review-decision');
    expect(html).toContain('official_flow_signed_reviewer_validation');
    expect(html).toContain('halofire.official_flow_signed_reviewer_validation_queue_item.v1');
    expect(html).toContain('Open professional signed reviewer workflow');
    expect(html).toContain('Open AHJ signed reviewer workflow');
    expect(html).toContain('Open manufacturer signed reviewer workflow');
    expect(html).toContain('Open AutoSprink signed reviewer workflow');
    expect(html).toContain('data-signed-reviewer-workflow-evidence-id');
    expect(html).toContain('PROFESSIONAL_REVIEW_MISSING');
    expect(html).toContain('AHJ_APPROVAL_MISSING');
    expect(html).toContain('MANUFACTURER_MODEL_APPROVAL_MISSING');
    expect(html).toContain('AUTOSPRINK_EVIDENCE_MISSING');
    expect(html).toContain('Download SAM31 actual-value work item');
    expect(html).toContain('downloadOpenClawSam31ActualValueWorkItemPacket');
    expect(html).toContain('data-sam31-consumer-actual-value-work-item-evidence-id');
    expect(html).toContain('openclaw.sam31.actual_value_work_item_packet.v1');
    expect(html).toContain('/actual-value-work-item');
    expect(html).toContain('Download replay SAM31 actual-value handoff');
    expect(html).toContain('downloadReplaySam31ActualValueHandoff');
    expect(html).toContain('data-replay-sam31-actual-value-handoff-evidence-id');
    expect(html).toContain('openclaw.sam31.actual_value_handoff_packet.v1');
    expect(html).toContain('/openclaw/sam31/actual-value-handoff');
    expect(html).toContain('Save replay SAM31 actual-value replacement');
    expect(html).toContain('saveReplaySam31ActualValueReplacement');
    expect(html).toContain('data-replay-sam31-actual-value-replacement-evidence-id');
    expect(html).toContain('halofire.sam31_replay_actual_value_replacement_intake.v1');
    expect(html).toContain('/openclaw/sam31/actual-value-handoff/replacements');
    expect(html).toContain('sam31_unresolved_consumer_reviews');
    expect(html).toContain('sam31ConsumerReview=unresolved');
    expect(html).toContain('openclaw.sam31.product_owner_replacement_intake.v1');
    expect(html).toContain('product_owner_replacement_intake');
    expect(html).toContain('/openclaw/sam31/product-owner-replacements');
    expect(html).toContain('Download SAM31 sprinkler review adapter');
    expect(html).toContain('downloadOpenClawSam31SprinklerReviewAdapter');
    expect(html).toContain('data-sam31-sprinkler-review-adapter-evidence-id');
    expect(html).toContain('/openclaw/sam31/sprinkler-review-adapter/');
    expect(html).toContain('openclaw.sam31_to_sprinkler_review_adapter.v1');
    expect(html).toContain('halofire.sam31_sprinkler_review_packet.v1');
    expect(html).toContain('supported_sprinkler_review_lanes');
    expect(html).toContain('halofire.sam31_sprinkler_review_queue_item.v1');
    expect(html).toContain('sam31_sprinkler_review_queue_items');
    expect(html).toContain('SAM31 sprinkler review queue');
    expect(html).toContain('supported_sprinkler_review_lane');
    expect(html).toContain('sam31SprinklerReview=queued');
    expect(html).toContain('Save SAM31 sprinkler review decision');
    expect(html).toContain('saveHalofireSam31SprinklerReviewDecision');
    expect(html).toContain('/openclaw/sam31/sprinkler-review/');
    expect(html).toContain('Download SAM31 sprinkler review decision packet');
    expect(html).toContain('downloadHalofireSam31SprinklerReviewDecisionPacket');
    expect(html).toContain('data-sam31-sprinkler-review-packet-evidence-id');
    expect(html).toContain('/decision/');
    expect(html).toContain('halofire.sam31_sprinkler_review_decision_packet.v1');
    expect(html).toContain('halofire.sam31_sprinkler_review_preliminary_replay_inputs.v1');
    expect(html).toContain('preliminary_replay_inputs');
    expect(html).toContain('renderSam31SectioningAdapterSourceSummary');
    expect(html).toContain('SAM31 sectioning adapter source evidence');
    expect(html).toContain('source_halofire_sam31_sectioning_sprinkler_review_adapter_evidence_id');
    expect(html).toContain('halofire_sam31_sectioning_sprinkler_review_adapter');
    expect(html).toContain('source_halofire_sam31_sectioning_downstream_resolver_packet_evidence_id');
    expect(html).toContain('source_openclaw_sam31_sectioning_pipeline_contract_review_evidence_id');
    expect(html).toContain('source_openclaw_sam31_extrapolation_evidence_id');
    expect(html).toContain('SAM31 sprinkler preliminary replay queue');
    expect(html).toContain('halofire.sam31_sprinkler_preliminary_replay_queue_item.v1');
    expect(html).toContain('Run SAM31 sprinkler preliminary replay');
    expect(html).toContain('runHalofireSam31SprinklerPreliminaryReplay');
    expect(html).toContain('data-sam31-sprinkler-preliminary-replay-evidence-id');
    expect(html).toContain('/preliminary-replay');
    expect(html).toContain('sam31SprinklerReplay=ready');
    expect(html).toContain('halofire.sam31_sprinkler_preliminary_replay_artifact.v1');
    expect(html).toContain('halofire.sam31_sprinkler_preliminary_replay_followup_decision.v1');
    expect(html).toContain('halofire.sam31_obstruction_clash_packet_queue_item.v1');
    expect(html).toContain('halofire.sam31_sleeve_firestop_packet_queue_item.v1');
    expect(html).toContain('halofire.sam31_obstruction_clash_packet.v1');
    expect(html).toContain('halofire.sam31_sleeve_firestop_packet.v1');
    expect(html).toContain('Download SAM31 follow-up packet');
    expect(html).toContain('downloadHalofireSam31SprinklerReplayFollowupPacket');
    expect(html).toContain('data-sam31-sprinkler-replay-followup-packet-evidence-id');
    expect(html).toContain('halofire.sam31_sprinkler_followup_packet_review_decision.v1');
    expect(html).toContain('Save SAM31 follow-up packet review');
    expect(html).toContain('saveHalofireSam31SprinklerReplayFollowupPacketReview');
    expect(html).toContain('data-sam31-sprinkler-replay-followup-packet-review-evidence-id');
    expect(html).toContain('latest_packet_review_decision');
    expect(html).toContain('approval_upload_resolver_rows');
    expect(html).toContain('halofire.sam31_approval_upload_resolver_row.v1');
    expect(html).toContain('HALOFIRE_SAM31_PROFESSIONAL_APPROVAL_UPLOAD_MISSING');
    expect(html).toContain('HALOFIRE_SAM31_AHJ_APPROVAL_UPLOAD_MISSING');
    expect(html).toContain('HALOFIRE_SAM31_MANUFACTURER_EVIDENCE_UPLOAD_MISSING');
    expect(html).toContain('halofire.sam31_approval_upload_intake.v1');
    expect(html).toContain('Save SAM31 approval upload');
    expect(html).toContain('saveHalofireSam31ApprovalUpload');
    expect(html).toContain('data-sam31-approval-upload-code');
    expect(html).toContain('/approval-upload');
    expect(html).toContain('Resolve validated SAM31 approval gate');
    expect(html).toContain('Gate resolve blocked until real_signed_evidence_validated validation decision');
    expect(html).toContain('resolveHalofireSam31ApprovalUploadGate');
    expect(html).toContain('data-sam31-approval-upload-resolve-gate-code');
    expect(html).toContain('/claim-gates/');
    expect(html).toContain('/preliminary-replay/followup/');
    expect(html).toContain('/packet/');
    expect(html).toContain('/review');
    expect(html).toContain('Save SAM31 preliminary replay follow-up');
    expect(html).toContain('saveHalofireSam31SprinklerPreliminaryReplayFollowup');
    expect(html).toContain('data-sam31-sprinkler-preliminary-replay-followup-evidence-id');
    expect(html).toContain('/preliminary-replay/followup');
    expect(html).toContain('halofire.sam31_sprinkler_review_decision.v1');
    expect(html).toContain('latest_sam31_sprinkler_review_decision');
    expect(html).toContain('supported_applications');
    expect(html).toContain('latest_openclaw_sam31_consumer_reviews');
    expect(html).toContain('consumer_queue_statuses');
    expect(html).toContain('OPENCLAW_SAM31_LANDSCOUT_QUEUE_URL');
    expect(html).toContain('OPENCLAW_SAM31_NAMEFORGE_QUEUE_URL');
    expect(html).toContain('OPENCLAW_SAM31_LANDSCOUT_QUEUE_UNAVAILABLE');
    expect(html).toContain('OPENCLAW_SAM31_NAMEFORGE_QUEUE_UNAVAILABLE');
    expect(html).toContain('extrapolation_index_count');
    expect(html).toContain('SAM31 1881 bid truth');
    expect(html).toContain('head_count');
    expect(html).toContain('bid_total');
    expect(html).toContain('SAM31 missing evidence rows');
    expect(html).toContain('HALOFIRE_1881_ROOM_BOUNDARY_EMPLOYEE_REVIEW_MISSING');
    expect(html).toContain('HALOFIRE_1881_PROFESSIONAL_AHJ_APPROVAL_MISSING');
  });

  it('lets the workbench save employee room-boundary review decisions', async () => {
    const shell = await fetch(`${BASE}/official-flow.html`, { headers: { Origin: BASE } });
    expect(shell.status).toBe(200);
    const html = await shell.text();
    expect(html).toContain('saveResolverPacketReview');
    expect(html).toContain('downloadResolverReplayInput');
    expect(html).toContain('runResolverReplayBid');
    expect(html).toContain('/resolver-packets/pdf-boundary/');
    expect(html).toContain('/replay-input');
    expect(html).toContain('/reviews');
    expect(html).toContain('/sprinkler-bid');
    expect(html).toContain('Record review decision');
    expect(html).toContain('Download replay input');
    expect(html).toContain('Run replay bid');
    expect(html).toContain('room_boundary_replay_bid_artifact');
    expect(html).toContain('Replay evidence:');
    expect(html).toContain('Replay employee_decision');
    expect(html).toContain('Replay source_refs');
    expect(html).toContain('downloadReplayBidEvidenceArtifact');
    expect(html).toContain('data-replay-bid-artifact-evidence-id');
    expect(html).toContain('best_effort_ai_layout_replay');
    expect(html).toContain('/replay-bid-artifact');
    expect(html).toContain('data-resolver-replay-bid-evidence-id');
    expect(html).toContain('marked_up_plan_ref');
    expect(html).toContain('latest_review');
    expect(html).toContain('employee_decision');
    expect(html).toContain('selected_sheet_ref');
    expect(html).toContain('selected_scale_ref');
    expect(html).toContain('selected_boundary_candidate_ref');
    expect(html).toContain('latest_sam31_visual_audit');
    expect(html).toContain('review_source');
    expect(html).toContain('source_sam31_evidence_id');
    expect(html).toContain('openclaw_sam31_perception_packet');
    expect(html).toContain('openclaw_sam31_extrapolation_product_review_packet');
    expect(html).toContain('sam31_downstream_review_metadata');
    expect(html).toContain('product_review_queue_item');
    expect(html).toContain('openclaw.sam31.product_review_queue_item.v1');
    expect(html).toContain('use_for_claims');
    expect(html).toContain('SAM31 downstream product review');
    expect(html).toContain('object_hypothesis_count');
    expect(html).toContain('vector_overlay_count');
    expect(html).toContain('source_openclaw_sam31_extrapolation_review_evidence_id');
    expect(html).toContain('renderSam31PerceptionSummary');
    expect(html).toContain('SAM31 perception summary');
    expect(html).toContain('renderOpenClawSam31BridgeStatus');
    expect(html).toContain('openclaw_sam31_bridge_status');
    expect(html).toContain('OpenClaw SAM31 bridge');
    expect(html).toContain('Canonical OpenClaw SAM31 tool');
    expect(html).toContain('canonical_tool_descriptor');
    expect(html).toContain('openclaw.sam31_llm_extrapolation_tool');
    expect(html).toContain('downloadOpenClawSam31ToolContract');
    expect(html).toContain('/resolver-packets/openclaw/sam31/tool-contract');
    expect(html).toContain('Download SAM31 tool contract');
    expect(html).toContain('data-sam31-tool-contract');
    expect(html).toContain('renderOpenClawSam31SectioningPipelineContractAction');
    expect(html).toContain('downloadOpenClawSam31SectioningPipelineContract');
    expect(html).toContain('/openclaw/sam31/sectioning-pipeline-contract');
    expect(html).toContain('Download SAM31 sectioning pipeline contract');
    expect(html).toContain('data-sam31-sectioning-contract-evidence-id');
    expect(html).toContain('openclaw.sam31.sectioning_pipeline_contract_packet.v1');
    expect(html).toContain('renderOpenClawSam31SectioningPipelineContractReview');
    expect(html).toContain('saveOpenClawSam31SectioningPipelineContractReview');
    expect(html).toContain('/openclaw/sam31/sectioning-pipeline-contract-review');
    expect(html).toContain('Save SAM31 sectioning contract review');
    expect(html).toContain('data-sam31-sectioning-contract-review-save-evidence-id');
    expect(html).toContain('latest_openclaw_sam31_sectioning_pipeline_contract_review');
    expect(html).toContain('openclaw.sam31.sectioning_pipeline_contract_review.v1');
    expect(html).toContain('renderOpenClawSam31VectorModelArtifactAction');
    expect(html).toContain('downloadOpenClawSam31VectorModelArtifactPacket');
    expect(html).toContain('persistOpenClawSam31VectorModelArtifactPacket');
    expect(html).toContain('/openclaw/sam31/vector-model-artifacts');
    expect(html).toContain('Download SAM31 vector/model artifact packet');
    expect(html).toContain('Record SAM31 vector/model artifacts');
    expect(html).toContain('Saved SAM31 vector/model evidence detail');
    expect(html).toContain('data-sam31-vector-model-artifact-evidence-id');
    expect(html).toContain('data-sam31-vector-model-artifact-save-evidence-id');
    expect(html).toContain('openclaw.sam31_vector_model_artifact_packet.v1');
    expect(html).toContain('openclaw.sam31_vector_model_operator_audit_summary.v1');
    expect(html).toContain('source_sam31_visual_audit_evidence_id');
    expect(html).toContain('latest_openclaw_sam31_vector_model_artifact');
    expect(html).toContain('sam31_vector_model_artifacts_recorded');
    expect(html).toContain('halofire-api-local-contract');
    expect(html).toContain('openclaw.sam31.product_review_queue_contract.v1');
    expect(html).toContain('LandScout queue');
    expect(html).toContain('NameForge queue');
    expect(html).toContain('pdfExtract:sam');
    expect(html).toContain('object_hypothesis_count');
    expect(html).toContain('llm_observation_count');
    expect(html).toContain('llm_observation_ids');
    expect(html).toContain('source_llm_observation_ids');
    expect(html).toContain('model_3d_candidate_count');
    expect(html).toContain('Download full SAM31 packet');
    expect(html).toContain('Review:');
  });

  it('surfaces signed reviewer evidence summaries in the workbench evidence lane', async () => {
    const shell = await fetch(`${BASE}/official-flow.html`, { headers: { Origin: BASE } });
    expect(shell.status).toBe(200);
    const html = await shell.text();
    expect(html).toContain('signed reviewer evidence');
    expect(html).toContain('review metadata recorded only; no claim gates cleared');
    expect(html).toContain('claim_gate_effect');
    expect(html).toContain('SAM31 consumer replacement summary');
    expect(html).toContain('employee_actual_value_next_action');
    expect(html).toContain('acceptable_actual_evidence');
  });

  it('lets Settings resolve a gate from recorded matching evidence rows', async () => {
    const shell = await fetch(`${BASE}/settings.html`, { headers: { Origin: BASE } });
    expect(shell.status).toBe(200);
    const html = await shell.text();
    expect(html).toContain('Use recorded evidence');
    expect(html).toContain('id="wizExistingEvidence"');
    expect(html).toContain('resolveWizardWithExistingEvidence');
    expect(html).toContain('evidence_id');
    expect(html).toContain('matching_evidence');
  });

  it('surfaces SAM31 actual-value work items in Settings for employee evidence follow-up', async () => {
    const shell = await fetch(`${BASE}/settings.html`, { headers: { Origin: BASE } });
    expect(shell.status).toBe(200);
    const html = await shell.text();
    expect(html).toContain('SAM31 Actual-Value Work Items');
    expect(html).toContain('settingsSam31ActualValueWorkItems');
    expect(html).toContain('/openclaw/sam31/actual-value-work-items');
    expect(html).toContain('loadSettingsSam31ActualValueWorkItems');
    expect(html).toContain('Download actual-value packet');
    expect(html).toContain('Download replacement readback');
    expect(html).toContain('/openclaw/sam31/actual-value-replacements');
    expect(html).toContain('openclaw.sam31.actual_value_replacement_readback.v1');
    expect(html).toContain('downloadSettingsSam31ActualValueReplacementReadback');
    expect(html).toContain('openclaw.sam31.actual_value_resolver_replay.v1');
    expect(html).toContain('actual_value_resolver_replay');
    expect(html).toContain('downloadSettingsSam31ActualValueResolverReplay');
    expect(html).toContain('lastSettingsSam31ActualValueResolverReplay');
    expect(html).toContain('data-settings-sam31-actual-value-resolver-replay-download');
    expect(html).toContain('data-sam31-actual-value-replacement-readback-index');
    expect(html).toContain('Record SAM31 actual-value evidence note');
    expect(html).toContain('data-sam31-actual-value-work-item-download-index');
    expect(html).toContain('data-sam31-actual-value-work-item-record-index');
    expect(html).toContain('sam31_actual_value_replacement');
    expect(html).toContain('replay_replacement_count');
    expect(html).toContain('replay_replacement_details');
    expect(html).toContain('renderSam31ReplayActualValueReplacementItems');
    expect(html).toContain('openclaw.sam31.replay_actual_value_replacement_queue_item.v1');
    expect(html).toContain('openclaw.sam31.replay_actual_value_replacement_detail.v1');
    expect(html).toContain('employee_actual_value_next_action');
    expect(html).toContain('settingsSam31ActualValueSourceRef-');
    expect(html).toContain('settingsSam31ActualValueSourceFile-');
    expect(html).toContain('settingsSam31ActualValueReplacementValuesSourceRef-');
    expect(html).toContain('settingsSam31ActualValueSourceRefs-');
    expect(html).toContain('settingsSam31ActualValueFieldValue');
    expect(html).toContain('settings.sam31_actual_value_queue');
    expect(html).toContain('llm_observation_count');
    expect(html).toContain('source_llm_observation_ids');
    expect(html).toContain('acceptable_actual_evidence');
    expect(html).toContain('claim_gate_effect no_claims_cleared');
  });

  it('surfaces SAM31 section-to-artifacts replacement packets in the Workbench', async () => {
    const shell = await fetch(`${BASE}/official-flow.html`, { headers: { Origin: BASE } });
    expect(shell.status).toBe(200);
    const html = await shell.text();
    expect(html).toContain('renderSam31ActualValueSectionToArtifactsSummary');
    expect(html).toContain('openclaw_sam31_section_to_artifacts_summary');
    expect(html).toContain('openclaw.sam31.section_to_artifacts_contract.v1');
    expect(html).toContain('source_openclaw_sam31_section_to_artifacts_ref');
    expect(html).toContain('section_to_artifacts_consumer_handoff');
    expect(html).toContain('data-sam31-actual-value-section-artifacts-download');
    expect(html).toContain('downloadSam31ActualValueSectionArtifactsFromReplacement');
    expect(html).toContain('Download SAM31 section-to-artifacts packet');
    expect(html).toContain('openclaw.sam31_llm_extrapolation_artifact');
  });

  it('lets the workbench download official-flow hydraulic replay artifacts', async () => {
    const shell = await fetch(`${BASE}/official-flow.html`, { headers: { Origin: BASE } });
    expect(shell.status).toBe(200);
    const html = await shell.text();
    expect(html).toContain('downloadOfficialFlowHydraulicReplay');
    expect(html).toContain('/resolver-packets/official-flow/');
    expect(html).toContain('/replay-artifact');
    expect(html).toContain('Download hydraulic replay artifact');
    expect(html).toContain('data-official-flow-replay-evidence-id');
    expect(html).toContain('persistOfficialFlowHydraulicReplay');
    expect(html).toContain('data-official-flow-persist-evidence-id');
    expect(html).toContain('downloadOfficialFlowReplayEvidenceArtifact');
    expect(html).toContain('/official-flow-hydraulic-replay-artifact');
    expect(html).toContain('official_flow_hydraulic_replay_artifact');
    expect(html).toContain('official_flow_hydraulic_replay_review');
    expect(html).toContain('official-flow-replay-review');
    expect(html).toContain('issue_actions');
    expect(html).toContain('downloadOfficialFlowReplayReviewPacket');
    expect(html).toContain('/resolver-packets/official-flow-replay/');
    expect(html).toContain('/review-packet');
    expect(html).toContain('Download professional/AHJ review packet');
    expect(html).toContain('data-official-flow-replay-review-packet-evidence-id');
    expect(html).toContain('officialFlowAttachmentIntakeJson');
    expect(html).toContain('importOfficialFlowAttachmentIntakeRecords');
    expect(html).toContain('/resolver-packets/official-flow/attachment-intake-records');
    expect(html).toContain('Import attachment intake records');
    expect(html).toContain('official_flow_attachment_intake_records');
    expect(html).toContain('persistOfficialFlowHydraulicReplayAndDownloadReviewPacket');
    expect(html).toContain('data-official-flow-persist-review-packet-evidence-id');
    expect(html).toContain('Save replay evidence + download review packet');
    expect(html).toContain('source_attachment_intake_packet_evidence_id');
    expect(html).toContain('saveOfficialFlowReviewDecision');
    expect(html).toContain('/review-decision');
    expect(html).toContain('Save official-flow review decision');
    expect(html).toContain('data-official-flow-review-decision-evidence-id');
    expect(html).toContain('officialFlowProfessionalReviewRef');
    expect(html).toContain('officialFlowAhjReviewRef');
    expect(html).toContain('officialFlowAutosprinkExportRef');
    expect(html).toContain('halofire.official_flow_claim_gate_evaluation_audit_packet.v1');
  });

  it('lets the studio load the latest saved PDF boundary decision as import defaults', async () => {
    const shell = await fetch(`${BASE}/autosprink.html`, { headers: { Origin: BASE } });
    expect(shell.status).toBe(200);
    const html = await shell.text();
    expect(html).toContain('id="pdfDecisionLoadBtn"');
    expect(html).toContain('loadPdfBoundaryDecision');
    expect(html).toContain('/pdf-boundary-decision');
    expect(html).toContain('employee_decision');
    expect(html).toContain('source_refs');
  });

  it('shows employees the completed Dillon FP-1 plus FP-2 schedule closure without clearing regulated gates', async () => {
    const shell = await fetch(`${BASE}/autosprink.html`, { headers: { Origin: BASE } });
    expect(shell.status).toBe(200);
    const html = await shell.text();
    expect(html).toContain('one FP-1 head remains unresolved');
    expect(html).toContain('FP-2 is a separate 25-head upper-level schedule and cannot close FP-1');
    expect(html).toContain('/api/projects/Dillon%20Residence/completed-bid-geometry');
    expect(html).toContain('no cross-sheet substitution');
    expect(html).toContain('/api/projects/Dillon%20Residence/vertical-registration');
    expect(html).toContain('/api/projects/Dillon%20Residence/structural-roof-surfaces');
    expect(html).toContain('no default flat-roof height');
    expect(html).toContain('verticalGeometry.model3d.heads.forEach');
    expect(html).toContain('verticalGeometry.model3d.pipes.forEach');
    expect(html).toContain('protected-head node identity, compliance, and approval remain fail-closed');
    expect(html).toContain('Cooperative 1881 + Dillon + Dallas + Tallahassee');
    expect(html).toContain('Pitched-roof cross-project evidence validation failed');
    expect(html).toContain('Pitched-roof fabrication spatial mapping: PROMOTED');
    expect(html).toContain('pitched_roof_fabrication_spatial_mapping');
    expect(html).toContain('35 fabricated dry-feed pieces across two plan runs and four pitched-attic transitions');
    expect(html).toContain('Full-network Z, exact field deflector elevation, fabrication release, and code approval remain fail-closed');
    expect(html).toContain('Hydraulic-network vertical geometry: PROMOTED');
    expect(html).toContain('hydraulic_network_vertical_geometry');
    expect(html).toContain('Completed hydraulic-network vertical geometry cross-project gate failed');
    expect(html).toContain('active-head join below is exact');
    expect(html).toContain('Active hydraulic sprinkler plan registration: PROMOTED');
    expect(html).toContain('active_hydraulic_sprinkler_plan_registration');
    expect(html).toContain('Active hydraulic sprinkler plan registration cross-project gate failed');
    expect(html).toContain('Inactive junction coordinates, whole-building network Z, exact field deflector elevations, fabrication release, and code compliance remain fail-closed');
    expect(html).toContain('dallasPitchMeanInPer12');
    expect(html).toContain("'roof-planes.automatic-roof-planes': () => hfShowSubmittedCalibrationViews()");
  });
});

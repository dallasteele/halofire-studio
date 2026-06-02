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

  it('lets the workbench target the Cooperative 1881 project instead of only Home Depot', async () => {
    const shell = await fetch(`${BASE}/workbench.html`, { headers: { Origin: BASE } });
    expect(shell.status).toBe(200);
    const html = await shell.text();
    expect(html).toContain('id="projectTarget"');
    expect(html).toContain('The Cooperative 1881 - Salt Lake City UT');
    expect(html).toContain('currentProjectName');
    expect(html).toContain("encodeURIComponent(currentProjectName())");
  });

  it('surfaces resolver queue rows in the workbench', async () => {
    const shell = await fetch(`${BASE}/workbench.html`, { headers: { Origin: BASE } });
    expect(shell.status).toBe(200);
    const html = await shell.text();
    expect(html).toContain('id="resolverQueue"');
    expect(html).toContain('/resolver-queue');
    expect(html).toContain('refreshResolverQueue');
    expect(html).toContain('room_boundary_visual_audit');
    expect(html).toContain('catalog_vendor_acquisition');
  });

  it('surfaces catalog source-acquisition ledger rows in the workbench with settings handoff actions', async () => {
    const shell = await fetch(`${BASE}/workbench.html`, { headers: { Origin: BASE } });
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
    const shell = await fetch(`${BASE}/workbench.html`, { headers: { Origin: BASE } });
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
    expect(html).toContain('Run LandScout/NameForge SAM31 queue smoke');
    expect(html).toContain('data-sam31-consumer-smoke-evidence-id');
    expect(html).toContain('runOpenClawSam31ConsumerSmoke');
    expect(html).toContain('latest_openclaw_sam31_consumer_smoke_artifact');
    expect(html).toContain('openclaw.sam31.consumer_smoke_artifact.v1');
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
    const shell = await fetch(`${BASE}/workbench.html`, { headers: { Origin: BASE } });
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
    expect(html).toContain('downloadReplayBidEvidenceArtifact');
    expect(html).toContain('data-replay-bid-artifact-evidence-id');
    expect(html).toContain('best_effort_ai_layout_replay');
    expect(html).toContain('/replay-bid-artifact');
    expect(html).toContain('data-resolver-replay-bid-evidence-id');
    expect(html).toContain('marked_up_plan_ref');
    expect(html).toContain('latest_review');
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
    expect(html).toContain('openclaw.sam31.product_review_queue_contract.v1');
    expect(html).toContain('LandScout queue');
    expect(html).toContain('NameForge queue');
    expect(html).toContain('pdfExtract:sam');
    expect(html).toContain('object_hypothesis_count');
    expect(html).toContain('model_3d_candidate_count');
    expect(html).toContain('Download full SAM31 packet');
    expect(html).toContain('Review:');
  });

  it('surfaces signed reviewer evidence summaries in the workbench evidence lane', async () => {
    const shell = await fetch(`${BASE}/workbench.html`, { headers: { Origin: BASE } });
    expect(shell.status).toBe(200);
    const html = await shell.text();
    expect(html).toContain('signed reviewer evidence');
    expect(html).toContain('review metadata recorded only; no claim gates cleared');
    expect(html).toContain('claim_gate_effect');
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

  it('lets the workbench download official-flow hydraulic replay artifacts', async () => {
    const shell = await fetch(`${BASE}/workbench.html`, { headers: { Origin: BASE } });
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
  });

  it('lets the studio load the latest saved PDF boundary decision as import defaults', async () => {
    const shell = await fetch(`${BASE}/autosprink.html`, { headers: { Origin: BASE } });
    expect(shell.status).toBe(200);
    const html = await shell.text();
    expect(html).toContain('id="pdfDecisionLoadBtn"');
    expect(html).toContain('loadPdfBoundaryDecision');
    expect(html).toContain('/pdf-boundary-decision');
  });
});

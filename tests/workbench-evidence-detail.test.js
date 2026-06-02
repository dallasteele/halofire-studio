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
    expect(html).toContain('sectioning-downstream-resolvers');
    expect(html).toContain('downloadHalofireSam31SectioningDownstreamResolverPacket');
    expect(html).toContain('data-sam31-sectioning-downstream-resolver-evidence-id');
    expect(html).toContain('no_claims_cleared');
  });

});

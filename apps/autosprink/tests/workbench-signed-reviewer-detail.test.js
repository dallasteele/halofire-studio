import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3217;
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
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-workbench-signed-reviewer-'));
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

describe('workbench signed reviewer evidence detail rendering', () => {
  it('includes gate packet context for evidence-only signed reviewer rows', async () => {
    const shell = await fetch(`${BASE}/workbench.html`, { headers: { Origin: BASE } });
    expect(shell.status).toBe(200);
    const html = await shell.text();
    expect(html).toContain('signed reviewer evidence');
    expect(html).toContain('target_gate_code');
    expect(html).toContain('required_evidence_type');
    expect(html).toContain('review_packet_href');
    expect(html).toContain('review_packet_artifact_type');
    expect(html).toContain('settings_prefill_href');
    expect(html).toContain('resolve_audit_packet_href');
    expect(html).toContain('resolve_audit_packet_artifact_type');
    expect(html).toContain('Download resolve audit packet');
    expect(html).toContain('data-signed-reviewer-resolve-audit-href');
    expect(html).toContain('signedReviewerResolveAuditStatus-');
    expect(html).toContain('Downloading resolve audit packet...');
    expect(html).toContain('Downloaded resolve audit packet');
    expect(html).toContain('Resolve audit packet unavailable until explicit gate resolution.');
    expect(html).toContain('downloadSignedReviewerResolveAuditPacket');
    expect(html).toContain('Open signed reviewer workflow');
    expect(html).toContain('Open Settings packet prefill');
    expect(html).toContain('openSignedReviewerWorkflow');
    expect(html).toContain('data-signed-reviewer-workflow-href');
    expect(html).toContain('Open pending signed-reviewer queue');
    expect(html).toContain('openOfficialFlowSignedReviewerValidationQueue');
    expect(html).toContain('officialFlowReviewDecisionEvidenceId');
    expect(html).toContain('officialFlowSignedReviewerQueueStatus-');
    expect(html).toContain('no claims cleared by this queue readback');
    expect(html).toContain('Upload real signed evidence & resolve gate');
    expect(html).toContain('data-official-flow-signed-reviewer-resolve-workflow');
    expect(html).toContain('signed_evidence_resolve_action');
    expect(html).toContain('action=resolve');
    expect(html).toContain('requires real signed evidence');
    expect(html).toContain('Save default SAM31 approval upload + validation packet');
    expect(html).toContain('data-official-flow-default-sam31-approval-upload');
    expect(html).toContain('saveOfficialFlowDefaultSam31ApprovalUpload');
    expect(html).toContain('default/internal-alpha placeholder');
    expect(html).toContain('latest_sam31_approval_upload_intake');
    expect(html).toContain('Open saved SAM31 approval validation queue');
    expect(html).toContain('data-official-flow-sam31-approval-validation-queue');
    expect(html).toContain('data-sam31-approval-upload-default-validation-packet');
    expect(html).toContain('data-sam31-approval-upload-validation-decision-save-evidence-id');
    expect(html).toContain('data-source-official-flow-review-decision-evidence-id');
    expect(html).toContain('Replace placeholder with real signed evidence');
    expect(html).toContain('data-official-flow-sam31-approval-upload-placeholder-replacement-workflow');
    expect(html).toContain('data-source-halofire-sam31-approval-upload-evidence-id');
    expect(html).toContain('sam31ApprovalValidation=pending');
    expect(html).toContain('halofireUiBasePath');
    expect(html).toContain('halofireUiHref');
    expect(html).toContain("if (base && value.startsWith('/settings.html')) return base + value;");
    expect(html).not.toContain('data-signed-reviewer-workflow-action="inspect" onclick=');
    expect(html).toContain('evidenceId');
  });

  it('surfaces a blocked-claim-gate signed reviewer launch action in the workbench shell', async () => {
    const shell = await fetch(`${BASE}/workbench.html`, { headers: { Origin: BASE } });
    expect(shell.status).toBe(200);
    const html = await shell.text();
    expect(html).toContain('Open signed reviewer workflow from blocked gate');
    expect(html).toContain('renderClaimGateWorkflowActions');
    expect(html).toContain('data-claim-gate-signed-reviewer-workflow');
    expect(html).toContain('data-claim-gate-signed-reviewer-workflow-project');
    expect(html).toContain('review_packet_href');
    expect(html).toContain('requires_signoff_for');
  });
});

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
    expect(html).toContain('resolve_audit_packet_href');
    expect(html).toContain('resolve_audit_packet_artifact_type');
    expect(html).toContain('Download resolve audit packet');
    expect(html).toContain('data-signed-reviewer-resolve-audit-href');
    expect(html).toContain('downloadSignedReviewerResolveAuditPacket');
    expect(html).toContain('Open signed reviewer workflow');
    expect(html).toContain('openSignedReviewerWorkflow');
    expect(html).toContain('evidenceId');
  });

  it('surfaces a blocked-claim-gate signed reviewer launch action in the workbench shell', async () => {
    const shell = await fetch(`${BASE}/workbench.html`, { headers: { Origin: BASE } });
    expect(shell.status).toBe(200);
    const html = await shell.text();
    expect(html).toContain('Open signed reviewer workflow from blocked gate');
    expect(html).toContain('renderClaimGateWorkflowActions');
    expect(html).toContain('review_packet_href');
    expect(html).toContain('requires_signoff_for');
  });
});

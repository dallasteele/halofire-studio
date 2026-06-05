import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3229;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'settings-browser-smoke-pw';
const PROJECT_NAME = 'Home Depot - Rexburg ID';
const PROJECT_PATH = `/api/projects/${encodeURIComponent(PROJECT_NAME)}`;

let server;
let tempDir;
let browser;

async function waitForHealth() {
  const started = Date.now();
  while (Date.now() - started < 8000) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('server not healthy');
}

async function api(pathname, token, options = {}) {
  const response = await fetch(`${BASE}${pathname}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${pathname} failed ${response.status}: ${text}`);
  return body;
}

async function adminToken() {
  const body = await api('/api/auth/login', null, {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: PASSWORD }),
  });
  return body.token;
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-settings-browser-smoke-'));
  server = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: 'test',
      HALOFIRE_DB_PATH: path.join(tempDir, 'h.db'),
      JWT_SECRET: 'settings-browser-smoke-jwt-secret-more-than-32-chars',
      HALOFIRE_ADMIN_USER: 'admin',
      HALOFIRE_ADMIN_PASSWORD: PASSWORD,
      HALOFIRE_ALLOW_DEV_DEFAULTS: '0',
      HALOFIRE_CORS_ORIGINS: 'http://allowed.test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  if (browser) await browser.close();
  if (server && !server.killed) {
    server.kill();
    await new Promise((resolve) => server.once('exit', resolve));
  }
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('Settings signed reviewer browser smoke', () => {
  it('opens the blocked claim-gate workflow from Workbench and keeps resolve-audit fail-closed', async () => {
    const token = await adminToken();
    const page = await browser.newPage();
    page.setDefaultTimeout(8000);
    await page.addInitScript((authToken) => {
      localStorage.setItem('halofire_token', authToken);
    }, token);
    try {
      await page.goto(`${BASE}/workbench.html`, { waitUntil: 'domcontentloaded' });
      const blockedGateButton = page.locator('[data-claim-gate-signed-reviewer-workflow="PROFESSIONAL_REVIEW_MISSING"]').first();
      await blockedGateButton.waitFor();
      await blockedGateButton.click();
      await page.waitForURL(/settings\.html\?/);
      await page.locator('#wizGate').waitFor();
      await page.waitForFunction(
        (gateCode) => document.getElementById('wizGate')?.value === gateCode,
        'PROFESSIONAL_REVIEW_MISSING',
      );
      expect(await page.locator('#wizGate').inputValue()).toBe('PROFESSIONAL_REVIEW_MISSING');
      expect(await page.locator('#wizExistingEvidence').inputValue()).toBe('');
      await page.waitForFunction(() => {
        const text = document.getElementById('wizPacketStatus')?.textContent || '';
        return text.includes('available after explicit gate resolve');
      });
      expect(await page.locator('#wizPacketStatus').innerText()).toContain('available after explicit gate resolve');
      expect(await page.locator('#wizResolveAudit').isDisabled()).toBe(true);

      await page.locator('#wizReviewPacket').click();
      await page.waitForFunction(() => {
        const text = document.getElementById('wizPacketStatus')?.textContent || '';
        return text.includes('Downloaded halofire.claim_gate_review_packet.v1');
      });
      expect(await page.locator('#wizPacketStatus').innerText()).toContain('claim_gate_effect no_claims_cleared');
      expect(await page.locator('#wizResolveAudit').isDisabled()).toBe(true);
    } finally {
      await page.close();
    }
  }, 30_000);

  it('opens from Workbench and proves prefilled packet downloads stay source-linked', async () => {
    const token = await adminToken();
    const recorded = await api(`${PROJECT_PATH}/evidence`, token, {
      method: 'POST',
      body: JSON.stringify({
        evidence_type: 'professional_review',
        target_gate_code: 'PROFESSIONAL_REVIEW_MISSING',
        source_ref: 'Signed reviewer packet browser-smoke PR-1881-100',
        source_file: 'browser-smoke-professional-review.pdf',
        status: 'present',
        notes: 'Browser smoke signed reviewer packet.',
        signoff: {
          reviewer_name: 'Casey Morgan',
          reviewer_title: 'Fire Protection Engineer',
          signed_at: '2026-06-03T21:00:00.000Z',
          organization: 'Halo Fire',
          license_id: 'PE-BROWSER-100',
        },
      }),
    });
    await api(`${PROJECT_PATH}/claim-gates/PROFESSIONAL_REVIEW_MISSING/resolve`, token, {
      method: 'POST',
      body: JSON.stringify({ evidence_id: recorded.id }),
    });

    const page = await browser.newPage();
    page.setDefaultTimeout(8000);
    await page.addInitScript((authToken) => {
      localStorage.setItem('halofire_token', authToken);
    }, token);
    try {
      await page.goto(`${BASE}/workbench.html`, { waitUntil: 'domcontentloaded' });
      await page.getByText('Signed reviewer packet browser-smoke PR-1881-100').waitFor();
      await page.locator(`[data-signed-reviewer-workflow-evidence-id="${recorded.id}"]`).click();
      await page.waitForURL(/settings\.html\?/);
      await page.locator('#wizExistingEvidence').waitFor();
      await page.waitForFunction(
        (evidenceId) => document.getElementById('wizExistingEvidence')?.value === evidenceId,
        String(recorded.id),
      );
      expect(await page.locator('#wizExistingEvidence').inputValue()).toBe(String(recorded.id));
      expect(await page.locator('#wizPacketStatus').innerText()).toContain(`Prefilled from Workbench for evidence #${recorded.id}`);
      expect(await page.locator('#wizPacketStatus').getAttribute('data-signed-reviewer-prefill-evidence-id')).toBe(String(recorded.id));
      expect(await page.locator('#wizPacketStatus').getAttribute('data-signed-reviewer-prefill-gate')).toBe('PROFESSIONAL_REVIEW_MISSING');
      expect(await page.locator('#wizPacketStatus').getAttribute('data-signed-reviewer-review-packet-href')).toBe(
        `${PROJECT_PATH}/claim-gates/PROFESSIONAL_REVIEW_MISSING/review-packet`,
      );
      expect(await page.locator('#wizPacketStatus').getAttribute('data-signed-reviewer-resolve-audit-href')).toBe(
        `${PROJECT_PATH}/claim-gates/PROFESSIONAL_REVIEW_MISSING/resolve-audit-packet`,
      );

      await page.locator('#wizReviewPacket').click();
      await page.waitForFunction(() => document.getElementById('wizPacketStatus')?.textContent?.includes('Downloaded halofire.claim_gate_review_packet.v1'));
      expect(await page.locator('#wizPacketStatus').innerText()).toContain('claim_gate_effect no_claims_cleared');

      await page.locator('#wizResolveAudit').click();
      await page.waitForFunction(() => document.getElementById('wizPacketStatus')?.textContent?.includes('Downloaded halofire.claim_gate_resolve_audit_packet.v1'));
      expect(await page.locator('#wizPacketStatus').innerText()).toContain('gate_cleared_after_explicit_signed_validation');
    } finally {
      await page.close();
    }
  }, 30_000);

  it('prefills record-only signed evidence from official-flow review decision context', async () => {
    const token = await adminToken();
    const targetGateCode = 'AUTOSPRINK_EVIDENCE_MISSING';
    const targetEvidenceType = 'autosprink_packet';
    const targetSourceRef = 'autosprink://settings-browser-smoke/pending';
    const contextNotes = {
      kind: 'official_flow_professional_ahj_review_decision',
      artifact_type: 'halofire.official_flow_professional_ahj_review_decision.v1',
      source_replay_evidence_id: 4900,
      professional_review_ref: 'pe-review://settings-browser-smoke/pending',
      ahj_review_ref: 'ahj://settings-browser-smoke/pending',
      autosprink_export_ref: 'autosprink://settings-browser-smoke/pending',
      source_refs: [
        {
          evidence_type: 'official_flow_hydraulic_replay_artifact',
          evidence_id: 4900,
          source_ref: 'official-flow-replay:settings-browser-smoke',
        },
      ],
      decision: {
        source_replay_evidence_id: 4900,
        professional_review_ref: 'pe-review://settings-browser-smoke/pending',
        ahj_review_ref: 'ahj://settings-browser-smoke/pending',
        autosprink_export_ref: 'autosprink://settings-browser-smoke/pending',
        claim_gate_effect: 'no_claims_cleared',
      },
      claim_gate_effect: 'no_claims_cleared',
      no_claim_gates_cleared: true,
      claims_cleared_count: 0,
    };
    const context = await api(`${PROJECT_PATH}/evidence`, token, {
      method: 'POST',
      body: JSON.stringify({
        evidence_type: 'official_flow_professional_ahj_review_decision',
        source_ref: 'official-flow-review-decision:settings-browser-smoke',
        source_file: 'settings-browser-smoke-official-flow-review.json',
        status: 'fail_closed_review_recorded',
        notes: JSON.stringify(contextNotes),
      }),
    });

    const page = await browser.newPage();
    page.setDefaultTimeout(8000);
    await page.addInitScript((authToken) => {
      localStorage.setItem('halofire_token', authToken);
    }, token);

    try {
      await page.goto(
        `${BASE}/settings.html?project=${encodeURIComponent(PROJECT_NAME)}&gate=${targetGateCode}&evidenceId=${context.id}#wizSignoff`,
        { waitUntil: 'domcontentloaded' },
      );
      await page.locator('#wizGate').waitFor();
      await page.waitForFunction(
        (evidenceId) => document.getElementById('wizPacketStatus')?.dataset.officialFlowContextEvidenceId === evidenceId,
        String(context.id),
      );

      expect(await page.locator('#wizGate').inputValue()).toBe(targetGateCode);
      expect(await page.locator('#wizType').inputValue()).toBe(targetEvidenceType);
      expect(await page.locator('#wizExistingEvidence').inputValue()).toBe('');
      expect(await page.locator('#wizAction').inputValue()).toBe('record');
      expect(await page.locator('#wizSourceRef').inputValue()).toBe(targetSourceRef);
      expect(await page.locator('#wizPacketStatus').innerText()).toContain(
        `Prefilled from official-flow review decision evidence #${context.id}`,
      );
      expect(await page.locator('#wizPacketStatus').innerText()).toContain('no claims cleared');
      expect(await page.locator('#wizPacketStatus').getAttribute('data-official-flow-context-evidence-id')).toBe(String(context.id));
      expect(await page.locator('#wizNotes').inputValue()).toContain(`source_official_flow_review_decision_evidence_id ${context.id}`);
      expect(await page.locator('#wizNotes').inputValue()).toContain('source_replay_evidence_id 4900');
      expect(await page.locator('#wizNotes').inputValue()).toContain('claim_gate_effect no_claims_cleared');
      expect(await page.locator('#wizResolveAudit').isDisabled()).toBe(true);

      await page.locator('#wizReviewerName').fill('Codex Settings Smoke');
      await page.locator('#wizReviewerTitle').fill('Fire Protection Engineer');
      await page.locator('#wizSignedAt').fill('2026-06-04T20:30');
      await page.locator('#wizOrganization').fill('Halo Fire');
      await page.locator('#wizLicenseId').fill('PE-CODEX-SETTING-SMOKE');
      await page.locator('#wizSubmit').click();
      await page.waitForFunction(() => document.getElementById('wizMsg')?.textContent?.includes('evidence recorded only'));

      const evidenceRows = await api(`${PROJECT_PATH}/evidence`, token);
      const saved = evidenceRows.find((row) => row.evidence_type === targetEvidenceType
        && row.source_ref === targetSourceRef);
      expect(saved).toBeTruthy();
      const savedNotes = JSON.parse(saved.notes);
      expect(savedNotes.kind).toBe('signed_reviewer_evidence');
      expect(savedNotes.target_gate_code).toBe(targetGateCode);
      expect(savedNotes.required_evidence_type).toBe(targetEvidenceType);
      expect(savedNotes.claim_gate_effect).toBe('no_claims_cleared');
      expect(savedNotes.user_notes).toContain(`source_official_flow_review_decision_evidence_id ${context.id}`);
      expect(savedNotes.signoff).toEqual(expect.objectContaining({
        reviewer_name: 'Codex Settings Smoke',
        reviewer_title: 'Fire Protection Engineer',
        license_id: 'PE-CODEX-SETTING-SMOKE',
      }));

      const gates = await api(`${PROJECT_PATH}/claim-gates`, token);
      const targetGate = gates.find((gate) => gate.code === targetGateCode);
      expect(targetGate.status).toBe('blocked');
    } finally {
      await page.close();
    }
  }, 30_000);

  it('renders resolved signed-reviewer gates in Settings and downloads the resolved-gate audit packet', async () => {
    const token = await adminToken();
    const recorded = await api(`${PROJECT_PATH}/evidence`, token, {
      method: 'POST',
      body: JSON.stringify({
        evidence_type: 'ahj_approval',
        target_gate_code: 'AHJ_APPROVAL_MISSING',
        source_ref: 'Resolved signed reviewer packet AHJ-1881-900',
        source_file: 'resolved-signed-reviewer-ahj.pdf',
        status: 'present',
        notes: 'Resolved signed reviewer browser smoke packet.',
        signoff: {
          reviewer_name: 'Jordan Lee',
          reviewer_title: 'Fire Marshal',
          signed_at: '2026-06-03T22:10:00.000Z',
          organization: 'Salt Lake City',
        },
      }),
    });
    await api(`${PROJECT_PATH}/claim-gates/AHJ_APPROVAL_MISSING/resolve`, token, {
      method: 'POST',
      body: JSON.stringify({ evidence_id: recorded.id }),
    });

    const page = await browser.newPage();
    page.setDefaultTimeout(8000);
    await page.addInitScript((authToken) => {
      localStorage.setItem('halofire_token', authToken);
    }, token);

    try {
      await page.goto(`${BASE}/settings.html`, { waitUntil: 'domcontentloaded' });
      const gateRow = page.locator('[data-settings-resolved-gate-code="AHJ_APPROVAL_MISSING"]').first();
      await gateRow.waitFor();
      const gateRowText = await gateRow.innerText();
      expect(gateRowText).toContain('Resolved signed reviewer packet AHJ-1881-900');
      expect(gateRowText).toContain('gate_cleared_after_explicit_signed_validation');
      expect(gateRowText).toContain('no_unrelated_claims_cleared true');
      expect(gateRowText).toContain('halofire.claim_gate_resolve_audit_packet.v1');
      expect(await gateRow.getAttribute('data-settings-resolved-gate-audit-href')).toBe(
        `${PROJECT_PATH}/claim-gates/AHJ_APPROVAL_MISSING/resolve-audit-packet`,
      );

      await gateRow.locator('[data-settings-resolved-gate-audit-download]').click();
      await page.waitForFunction(() => {
        const text = document.getElementById('settingsResolvedSignedReviewerGatesMsg')?.textContent || '';
        return text.includes('downloaded halofire.claim_gate_resolve_audit_packet.v1');
      });
      expect(await page.locator('#settingsResolvedSignedReviewerGatesMsg').innerText()).toContain(
        'claim_gate_effect gate_cleared_after_explicit_signed_validation',
      );
    } finally {
      await page.close();
    }
  }, 30_000);

  it('renders room-boundary override actions in Settings and downloads the override packet', async () => {
    const token = await adminToken();
    const boundary = await api(`${PROJECT_PATH}/pdf-boundary-decision`, token, {
      method: 'POST',
      body: JSON.stringify({
        pdfPageIndex: 7,
        pdfScale: 0.0833,
        pdfExtract: 'outline',
        candidate: {
          id: 'candidate:settings-1881-sheet-7-outline',
          mode: 'outline',
          bbox: { minX: 0, minY: 0, maxX: 120, maxY: 85, widthFt: 120, heightFt: 85, areaSqft: 10200 },
          blockedClaims: ['geometry_accuracy', 'AutoSprink_parity'],
        },
        source_file: 'Proposal- Home Depot - Rexburg ID.xlsx',
        source_ref: 'Home Depot settings browser-smoke boundary decision for floor-plan override',
        selected_sheet_ref: 'home-depot://sheet-7',
        selected_scale_ref: 'home-depot://operator-scale/sheet-7/0.0833',
        selected_boundary_candidate_ref: 'candidate:settings-1881-sheet-7-outline',
        source_refs: [
          'home-depot://sheet-7',
          'home-depot://operator-scale/sheet-7/0.0833',
          'candidate:settings-1881-sheet-7-outline',
        ],
        notes: 'Settings browser-smoke boundary decision for floor-plan override.',
      }),
    });
    const review = await api(`${PROJECT_PATH}/resolver-packets/pdf-boundary/${boundary.evidence.id}/reviews`, token, {
      method: 'POST',
      body: JSON.stringify({
        review_decision: 'corrected',
        reviewer_name: 'Settings Boundary Browser Smoke Reviewer',
        marked_up_plan_ref: 'home-depot://markup/settings-sheet-7-room-boundary-correction',
        corrected_room_polygons: [
          {
            id: 'room:settings-1881-lobby',
            label: 'Lobby',
            polygon: [[0, 0], [28, 0], [28, 18], [0, 18]],
            source_refs: ['home-depot://markup/settings-sheet-7-room-boundary-correction'],
          },
        ],
        issue_list: [
          {
            issue_type: 'room_boundary_mismatch',
            severity: 'blocking',
            source_ref: 'home-depot://sheet-7',
            observed: 'Original outline overcaptured the corridor wall band.',
            expected: 'Replay should use the corrected employee-reviewed room polygon only.',
            required_action: 'Use the corrected room polygon for internal-alpha replay only.',
          },
        ],
        notes: 'Corrected settings browser-smoke room-boundary review packet for override download.',
      }),
    });

    const projectPath = PROJECT_PATH;
    const page = await browser.newPage({ acceptDownloads: true });
    page.setDefaultTimeout(8000);
    await page.addInitScript((authToken) => {
      localStorage.setItem('halofire_token', authToken);
    }, token);

    try {
      await page.goto(`${BASE}/settings.html`, { waitUntil: 'domcontentloaded' });
      const overrideNote = page.locator('#settingsRoomBoundaryFloorPlanOverrides .note')
        .filter({ hasText: `source_review_evidence_id ${review.id}` })
        .first();
      await overrideNote.waitFor();
      const overrideRow = overrideNote.locator('[data-room-boundary-floor-plan-override-action-index]').first();
      await page.evaluate(() => {
        const originalCreateObjectURL = URL.createObjectURL.bind(URL);
        const originalRevokeObjectURL = URL.revokeObjectURL.bind(URL);
        window.__lastRoomBoundaryOverrideBlobText = null;
        URL.createObjectURL = (blob) => {
          blob.text().then((text) => {
            window.__lastRoomBoundaryOverrideBlobText = text;
          });
          return originalCreateObjectURL(blob);
        };
        URL.revokeObjectURL = (href) => originalRevokeObjectURL(href);
      });

      await overrideRow.click();
      await page.waitForTimeout(1000);
      const statusText = await page.locator('#roomBoundaryFloorPlanOverrideMsg').innerText();
      expect(statusText).toContain('downloaded halofire.room_boundary_floor_plan_override_action_packet.v1');
      const packet = JSON.parse(await page.evaluate(async () => {
        const started = Date.now();
        while (!window.__lastRoomBoundaryOverrideBlobText) {
          if (Date.now() - started > 5000) throw new Error('override blob text not captured');
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return window.__lastRoomBoundaryOverrideBlobText;
      }));

      expect(packet.artifact_type).toBe('halofire.room_boundary_floor_plan_override_action_packet.v1');
      expect(packet.source_evidence_id).toBe(boundary.evidence.id);
      expect(packet.source_review_evidence_id).toBe(review.id);
      expect(packet.floor_plan_override_source).toBe('latest_employee_review_packet');
      expect(packet.request_body).toEqual(expect.objectContaining({
        room_boundary_source: 'latest_employee_review_packet',
        source_evidence_id: boundary.evidence.id,
        source_review_evidence_id: review.id,
      }));
      expect(statusText).toContain('claim gates remain blocked');
      expect(packet.floor_plan_override).toEqual(expect.objectContaining({
        source_evidence_id: boundary.evidence.id,
        source_review_evidence_id: review.id,
        corrected_room_polygon_count: 1,
      }));
      expect(packet.action_href).toBe(`${projectPath}/sprinkler-bid`);
    } finally {
      await page.close();
    }
  }, 30_000);
});

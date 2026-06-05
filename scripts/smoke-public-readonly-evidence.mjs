import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'output', 'playwright');
const DEFAULT_BASE_URL = 'https://portal.rankempire.io/halo-fire';
const DEFAULT_EXPECTED_SETTINGS_PATH = '/halo-fire/settings.html';
const BASE_URL = (process.env.HALOFIRE_PUBLIC_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
const ADMIN_USER = process.env.HALOFIRE_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.HALOFIRE_ADMIN_PASSWORD || '';
const PROJECT_NAME = process.env.HALOFIRE_PUBLIC_SMOKE_PROJECT || 'Codex Live Readonly Signed Evidence 1780656183123';
const OFFICIAL_FLOW_DECISION_EVIDENCE_ID = String(process.env.HALOFIRE_PUBLIC_SMOKE_DECISION_EVIDENCE_ID || '111');
const RESOLVED_EVIDENCE_ID = String(process.env.HALOFIRE_PUBLIC_SMOKE_RESOLVED_EVIDENCE_ID || '112');
const TARGET_GATE = process.env.HALOFIRE_PUBLIC_SMOKE_TARGET_GATE || 'MANUFACTURER_MODEL_APPROVAL_MISSING';
const EVIDENCE_TYPE = process.env.HALOFIRE_PUBLIC_SMOKE_EVIDENCE_TYPE || 'manufacturer_approval';
const EXPECTED_CLAIM_GATE_EFFECT = 'gate_cleared_after_explicit_signed_validation';
const INSPECT_SELECTOR = '[data-signed-reviewer-workflow-action="inspect"]';

function fail(message, details = {}) {
  const error = new Error(message);
  error.details = details;
  throw error;
}

function log(message) {
  process.stdout.write(`[public-readonly-evidence-smoke] ${message}\n`);
}

function expectedSettingsPath() {
  const basePath = new URL(BASE_URL).pathname.replace(/\/+$/, '');
  return `${basePath}/settings.html`;
}

function writeArtifact(payload) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, 'public-readonly-evidence-smoke.json');
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
  return file;
}

async function jsonResponse(response, label) {
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!response.ok()) {
    fail(`${label} failed ${response.status()}`, { body });
  }
  return body;
}

function collectResolverItems(body) {
  const roots = Array.isArray(body) ? body : [
    ...(Array.isArray(body?.items) ? body.items : []),
    ...(Array.isArray(body?.resolver_queue) ? body.resolver_queue : []),
    ...(Array.isArray(body?.queue) ? body.queue : []),
    ...(body ? [body] : []),
  ];
  return roots.flatMap((item) => [item, ...(Array.isArray(item?.validation_rows) ? item.validation_rows : [])]);
}

async function assertResolverSettingsHref(context, token) {
  const params = new URLSearchParams({
    officialFlowReviewDecisionEvidenceId: OFFICIAL_FLOW_DECISION_EVIDENCE_ID,
    targetGate: TARGET_GATE,
    evidenceType: EVIDENCE_TYPE,
  });
  const resolverUrl = `${BASE_URL}/api/projects/${encodeURIComponent(PROJECT_NAME)}/resolver-queue?${params.toString()}`;
  const response = await context.request.get(resolverUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await jsonResponse(response, 'resolver queue preflight');
  const item = collectResolverItems(body).find((candidate) => {
    const resolvedId = candidate?.resolved_evidence_id ?? candidate?.resolvedEvidenceId ?? candidate?.evidence_id ?? candidate?.id;
    return String(resolvedId || '') === RESOLVED_EVIDENCE_ID;
  });
  const href = item?.resolved_evidence_settings_href ?? item?.resolvedEvidenceSettingsHref ?? body?.resolved_evidence_settings_href;
  if (!href || !String(href).includes('/settings.html')) {
    fail('resolver queue did not expose resolved_evidence_settings_href', { resolverUrl, body });
  }
  return { resolverUrl, href };
}

async function main() {
  if (!ADMIN_PASSWORD) {
    fail('HALOFIRE_ADMIN_PASSWORD is required for the public smoke');
  }

  const expectedPath = expectedSettingsPath();
  if (BASE_URL === DEFAULT_BASE_URL && expectedPath !== DEFAULT_EXPECTED_SETTINGS_PATH) {
    fail('default HaloFire mount path drifted', { expectedPath, DEFAULT_EXPECTED_SETTINGS_PATH });
  }

  log(`smoking ${BASE_URL} project=${PROJECT_NAME}`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400 && !response.url().includes('/favicon')) {
      browserErrors.push(`${response.status()} ${response.url()}`);
    }
  });

  try {
    const loginResponse = await context.request.post(`${BASE_URL}/api/auth/login`, {
      data: { username: ADMIN_USER, password: ADMIN_PASSWORD },
      headers: { 'content-type': 'application/json' },
    });
    const loginBody = await jsonResponse(loginResponse, '/api/auth/login');
    const token = loginBody?.token;
    if (!token) fail('login response did not include token', { loginBody });

    const resolverPreflight = await assertResolverSettingsHref(context, token);
    await page.addInitScript(({ authToken, user }) => {
      localStorage.setItem('halofire_token', authToken);
      if (user) localStorage.setItem('halofire_user', JSON.stringify(user));
    }, { authToken: token, user: loginBody.user || null });

    await page.goto(`${BASE_URL}/workbench.html?project=${encodeURIComponent(PROJECT_NAME)}&entry=public-readonly-evidence-smoke#resolverQueue`, {
      waitUntil: 'networkidle',
    });
    await page.waitForFunction(() => document.querySelectorAll('[data-resolver-queue-filter]').length > 0);

    const filterSelector = `[data-resolver-queue-filter="officialFlowSignedReviewer=pending&targetGate=${TARGET_GATE}&evidenceType=${EVIDENCE_TYPE}"]`;
    await page.click(filterSelector);
    await page.waitForFunction(({ selector, evidenceId }) => {
      const button = document.querySelector(selector);
      return button && button.getAttribute('data-signed-reviewer-workflow-evidence-id') === evidenceId;
    }, { selector: INSPECT_SELECTOR, evidenceId: RESOLVED_EVIDENCE_ID });

    const hrefBeforeClick = await page.$eval(INSPECT_SELECTOR, (button) => button.getAttribute('data-signed-reviewer-workflow-href') || '');
    if (!hrefBeforeClick.startsWith('/settings.html')) {
      fail('expected root-relative Settings href before Workbench mount normalization', { hrefBeforeClick });
    }

    await page.click(INSPECT_SELECTOR);
    await page.waitForFunction(({ evidenceId }) => {
      const status = document.querySelector('#wizPacketStatus');
      return status?.dataset?.signedReviewerReadonlyEvidenceId === evidenceId;
    }, { evidenceId: RESOLVED_EVIDENCE_ID });

    const result = await page.evaluate(() => ({
      url: location.href,
      pathname: location.pathname,
      packetStatus: document.querySelector('#wizPacketStatus')?.textContent?.trim() || '',
      signedReviewerReadonlyEvidenceId: document.querySelector('#wizPacketStatus')?.dataset?.signedReviewerReadonlyEvidenceId || '',
      claimGateEffect: document.querySelector('[data-signed-reviewer-claim-gate-effect]')?.dataset?.signedReviewerClaimGateEffect || '',
      submitDisabled: document.querySelector('#wizSubmit')?.disabled || false,
      hasUploadPacketHref: location.href.includes('uploadPacketHref'),
    }));

    if (result.pathname !== expectedPath) fail('Settings path escaped HaloFire mount', { expectedPath, result });
    if (result.signedReviewerReadonlyEvidenceId !== RESOLVED_EVIDENCE_ID) fail('read-only evidence id mismatch', result);
    if (result.claimGateEffect !== EXPECTED_CLAIM_GATE_EFFECT) fail('claim gate effect mismatch', result);
    if (!result.submitDisabled) fail('read-only Settings submit button was enabled', result);
    if (result.hasUploadPacketHref) fail('read-only Settings URL carried uploadPacketHref', result);
    if (browserErrors.length) fail('browser/API errors during smoke', { browserErrors, result });

    const artifact = writeArtifact({
      ok: true,
      base_url: BASE_URL,
      project_name: PROJECT_NAME,
      target_gate: TARGET_GATE,
      evidence_type: EVIDENCE_TYPE,
      official_flow_review_decision_evidence_id: OFFICIAL_FLOW_DECISION_EVIDENCE_ID,
      resolved_evidence_id: RESOLVED_EVIDENCE_ID,
      resolved_evidence_settings_href: resolverPreflight.href,
      href_before_click: hrefBeforeClick,
      result,
    });
    log(`ok artifact=${artifact}`);
    process.stdout.write(`${JSON.stringify({ ok: true, artifact, result }, null, 2)}\n`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  if (error.details) process.stderr.write(`${JSON.stringify(error.details, null, 2)}\n`);
  process.exit(1);
});

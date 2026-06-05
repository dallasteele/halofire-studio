# HaloFire Internal Alpha Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the current HaloFire folder from a static/fake demo into a usable internal-alpha bid platform backed by the provided Home Depot Rexburg package, real bid-log/pricebook ingestion, truthful evidence gates, and a backend-driven UI.

**Architecture:** Use `C:/Users/dalla/OneDrive/Documents/HaloFire` as the delivery target, with GX10 `hal-brain` MCP preflight/postflight for every coding session and agent handoff. Keep the app intentionally internal-alpha: it may produce best-effort bid, estimate, evidence, and correction workflows, but it must visibly block permit-ready, AHJ-approved, professional-approved, fabrication-ready, AutoSprink-parity, and engineering-grade claims until actual employee/professional/AHJ evidence exists.

**Tech Stack:** Node 22, Express 4, SQLite via `better-sqlite3`, `xlsx`, vanilla `app.html`, `vitest`, Playwright smoke tests, Codex automations, GX10 brain MCP.

---

## Current Truth From Code Review

The project is not ready to deliver yet. The review agents found these blockers:

- `app.html` is a static fake-data dashboard. It hardcodes bids, projects, pricebook, compliance, and revenue arrays and does not call the API.
- `index.html` and `app.html` are disconnected products. The landing page login does not route into the management UI.
- Client-side credentials are exposed in both HTML files.
- `src/api/server.js` has hardcoded JWT/default admin behavior, no role authorization, unsafe dynamic SQL update column names, open CORS, and no rate limiting.
- The seed now has one real Home Depot Rexburg row, but still surrounds it with synthetic bids/projects/compliance rows.
- Pricebooks are still represented by 25 handwritten sample rows despite real ARGCO, FFF, and Victaulic workbooks being present.
- Evidence/claim gates are not first-class database/API/UI surfaces.
- AutoSprink/design export evidence is not present in this folder, so the app must fail closed on those claims.
- There is no git repository in `C:/Users/dalla/OneDrive/Documents/HaloFire`, so scoped commits are impossible until source control is initialized or the app is moved into an existing repo.

Known real Home Depot Rexburg values already verified by tests:

- Project: `Home Depot - Rexburg ID`
- Bid log row: `238`
- Contractor: `ESI`
- Proposal contact: `Paden Moore`
- Address: `329 Teton River Temple st, Rexburg ID 83440`
- Submitted date: `2026-03-04`
- Due date: `2026-03-05`
- Bid amount: `792543.84`
- Proposal base total: `767543.8391569464`
- Proposal total with options: `792543.8391569464`
- Proposal sqft: `121500`
- Bid log sqft: `135000`
- Head count: `858`
- Water: static `76 PSI`, residual `69 PSI`, flow `1226 GPM`, flow date `2025-06-23`

---

## Agent And Automation Operating Rules

- **Controller:** Codex owns task sequencing. Every session starts with `mcp__brain__.brain_recall` and closes with `mcp__brain__.brain_remember`.
- **Worker agents:** Use subagents only for disjoint scopes. Workers may edit files only when assigned a write set. Explorers are read-only.
- **Review agents:** After each task, run a spec-compliance review and a code-quality/security review before moving on.
- **Automation:** Replace the old broad Halo Forge heartbeat with a narrow HaloFire OneDrive Delivery Owner automation. It must choose one task from this plan, use TDD, run focused verification only, write GX10 brain postflight, and stop on dirty-file conflicts.
- **No fake green:** Missing AutoSprink, AHJ, PE, manufacturer, or employee approvals are product evidence rows and blocked claims, not reasons to stop building and not reasons to pretend readiness.
- **Verification throttle:** Use explicit tests only, never broad/bare test suites. Always run `C:/Python312/python.exe E:/ClaudeBot/scripts/verify_agentic_rules.py` before closeout.

---

## Task 0: Put The Project Under Source Control

**Files:**
- Create: `C:/Users/dalla/OneDrive/Documents/HaloFire/.gitignore`
- Create or initialize: `C:/Users/dalla/OneDrive/Documents/HaloFire/.git`
- No app behavior changes.

- [ ] **Step 1: Create `.gitignore`**

Create:

```gitignore
node_modules/
data/halofire.db
data/halofire.db-*
data/logs/
data/locks/
.env
.env.*
!.env.example
dist/
coverage/
*.log
```

- [ ] **Step 2: Initialize git**

Run:

```powershell
git init
git add .gitignore package.json src tests docs config app.html index.html
git status --short
git commit -m "chore: establish halofire source control"
```

Expected: the project has a baseline commit, and future work can be scoped and reviewed.

- [ ] **Step 3: Add source-control status to GX10 brain**

Use `mcp__brain__.brain_remember` with tags `halofire`, `delivery`, `source-control`, `session-2026-05-28`.

---

## Task 1: Harden API Secrets, Auth, And Unsafe Updates

**Files:**
- Modify: `C:/Users/dalla/OneDrive/Documents/HaloFire/src/api/server.js`
- Modify: `C:/Users/dalla/OneDrive/Documents/HaloFire/config/default.json`
- Create: `C:/Users/dalla/OneDrive/Documents/HaloFire/.env.example`
- Create: `C:/Users/dalla/OneDrive/Documents/HaloFire/tests/api-security.test.js`

- [ ] **Step 1: Write failing security tests**

Create `tests/api-security.test.js` with tests that launch the app against a temp DB and assert:

```js
expect(loginWithDefaultDevPasswordWithoutBootstrap).toReturn401();
expect(updateBidWithUnknownColumn).toReturn400();
expect(updateBidWithCreatedByField).toReturn400();
expect(nonAdminDeleteBid).toReturn403();
expect(apiCorsFromUntrustedOrigin).toBeRejected();
```

Run:

```powershell
npx vitest run tests/api-security.test.js
```

Expected: fail because current server accepts hardcoded defaults and unsafe update keys.

- [ ] **Step 2: Replace hardcoded secrets with config/env**

Implementation requirements:

- `JWT_SECRET` must come from env outside `NODE_ENV=development`.
- Bootstrap admin username/password must come from `HALOFIRE_ADMIN_USER` and `HALOFIRE_ADMIN_PASSWORD`.
- Keep a local dev fallback only if `HALOFIRE_ALLOW_DEV_DEFAULTS=1`.
- Remove visible default password from config docs.

Add `.env.example`:

```dotenv
PORT=3001
NODE_ENV=development
JWT_SECRET=replace-with-long-random-secret
HALOFIRE_ADMIN_USER=admin
HALOFIRE_ADMIN_PASSWORD=replace-before-use
HALOFIRE_ALLOW_DEV_DEFAULTS=0
HALOFIRE_CORS_ORIGINS=http://localhost:3001,http://localhost:5173
```

- [ ] **Step 3: Add role middleware and update allowlists**

Implementation requirements:

- Normalize admin role to `admin`.
- Add `requireRole('admin')` for destructive routes.
- Add helper:

```js
function buildAllowedUpdate(body, allowedFields) {
  const entries = Object.entries(body).filter(([key]) => key !== 'id');
  const rejected = entries.filter(([key]) => !allowedFields.has(key)).map(([key]) => key);
  if (rejected.length) return { error: `Unsupported fields: ${rejected.join(', ')}` };
  if (!entries.length) return { error: 'No fields to update' };
  return {
    sets: entries.map(([key]) => `${key} = ?`).join(', '),
    values: entries.map(([, value]) => value),
  };
}
```

Use allowlists for bids, projects, compliance.

- [ ] **Step 4: Add rate limits and CORS config**

Implementation requirements:

- Install `express-rate-limit`.
- Apply stricter limiter to `/api/auth/login`.
- Restrict CORS to configured origins.

- [ ] **Step 5: Verify and commit**

Run:

```powershell
npx vitest run tests/api-security.test.js
C:/Python312/python.exe E:/ClaudeBot/scripts/verify_agentic_rules.py
git add src/api/server.js config/default.json .env.example tests/api-security.test.js package.json package-lock.json
git commit -m "security: harden halofire api auth and updates"
```

---

## Task 2: Replace Synthetic Bid Seeds With Real Bid Log Import

**Files:**
- Modify: `C:/Users/dalla/OneDrive/Documents/HaloFire/src/data/home-depot-bid-package.js`
- Create: `C:/Users/dalla/OneDrive/Documents/HaloFire/src/data/bid-log-importer.js`
- Modify: `C:/Users/dalla/OneDrive/Documents/HaloFire/src/db/seed.js`
- Create: `C:/Users/dalla/OneDrive/Documents/HaloFire/tests/bid-log-importer.test.js`

- [ ] **Step 1: Write failing bid-log tests**

Create tests proving:

```js
const rows = readBidLogRows(ROOT);
expect(rows.find(r => r.project === 'Home Depot - Rexburg ID').worksheetRow).toBe(238);
expect(rows.find(r => r.project === 'Home Depot - Rexburg ID').value).toBe(792543.84);
expect(rows.find(r => r.project === 'Home Depot - Rexburg ID').sourceRefs).toContain('01-Bid Log.xlsx#Bid Log row 238');
expect(rows.every(r => r.source === 'actual_bid_log')).toBe(true);
```

Run:

```powershell
npx vitest run tests/bid-log-importer.test.js
```

Expected: fail because importer does not exist.

- [ ] **Step 2: Implement `readBidLogRows(rootDir)`**

Rules:

- Read `01-Bid Log.xlsx#Bid Log`.
- Normalize `NEGOTIATED` suffix from job names.
- Preserve `worksheetRow`, `source_file`, `sheet`, `due_date`, `submitted_date`, `project`, `value`, `status`, `prospect_rank`, `estimator`, `job_type`, `sqft`, `contractor`.
- Skip blank rows.
- Mark rows with amount missing as `needs_amount_review`.

- [ ] **Step 3: Seed only sourced bid-log rows**

Remove hardcoded bid arrays from `seed.js`.

For Home Depot, merge proposal package data into the bid-log row and add issue:

```json
{
  "code": "BID_LOG_SQFT_DIFFERS_FROM_PROPOSAL",
  "bidLogSqft": 135000,
  "proposalSqft": 121500,
  "severity": "warning"
}
```

- [ ] **Step 4: Verify and commit**

Run:

```powershell
npx vitest run tests/bid-package.test.js tests/bid-log-importer.test.js
node src/db/seed.js
C:/Python312/python.exe E:/ClaudeBot/scripts/verify_agentic_rules.py
git add src/data/home-depot-bid-package.js src/data/bid-log-importer.js src/db/seed.js tests/bid-package.test.js tests/bid-log-importer.test.js
git commit -m "data: import sourced bid log rows"
```

---

## Task 3: Import Real ARGCO, FFF, And Victaulic Pricebooks

**Files:**
- Create: `C:/Users/dalla/OneDrive/Documents/HaloFire/src/data/pricebook-importer.js`
- Modify: `C:/Users/dalla/OneDrive/Documents/HaloFire/src/db/seed.js`
- Modify: `C:/Users/dalla/OneDrive/Documents/HaloFire/src/api/server.js`
- Create: `C:/Users/dalla/OneDrive/Documents/HaloFire/tests/pricebook-importer.test.js`

- [ ] **Step 1: Write failing pricebook tests**

Tests:

```js
const items = readPricebooks(ROOT);
expect(items.filter(i => i.supplier === 'ARGCO').length).toBeGreaterThan(3000);
expect(items.filter(i => i.supplier === 'Victaulic').length).toBeGreaterThan(1500);
expect(items.some(i => i.sku === '7010802' && i.supplier === 'ARGCO')).toBe(true);
expect(items.some(i => i.sku === 'L02009NPE0' && i.supplier === 'Victaulic')).toBe(true);
expect(items.every(i => i.source_file && i.source_sheet && i.source_row)).toBe(true);
```

Run:

```powershell
npx vitest run tests/pricebook-importer.test.js
```

- [ ] **Step 2: Add schema columns and unique index**

Update `pricebook` schema:

```sql
source_file TEXT,
source_sheet TEXT,
source_row INTEGER,
confidence REAL DEFAULT 1,
status TEXT DEFAULT 'vendor_pricebook',
UNIQUE(supplier, sku, source_file)
```

- [ ] **Step 3: Implement supplier normalizers**

Rules:

- ARGCO: sheet `ARGCOPricebookTravisResults`, columns `Item Number`, `Name`, `Price`.
- Victaulic: sheet `Data`, columns `Part Code`, `Type`, `Type 2`, `style`, `size`, `2025A`.
- FFF: scan all sheets with `PART CODE`, `DESCRIPTION`, `LIST`, `NET`; prefer `NET`, fall back to `LIST`.
- Preserve source metadata and skip rows without sku/description/price.

- [ ] **Step 4: Verify and commit**

Run:

```powershell
npx vitest run tests/pricebook-importer.test.js
node src/db/seed.js
C:/Python312/python.exe E:/ClaudeBot/scripts/verify_agentic_rules.py
git add src/data/pricebook-importer.js src/db/seed.js src/api/server.js tests/pricebook-importer.test.js
git commit -m "data: import real supplier pricebooks"
```

---

## Task 4: Add Evidence And Claim Gate Tables/API

**Files:**
- Modify: `C:/Users/dalla/OneDrive/Documents/HaloFire/src/api/server.js`
- Modify: `C:/Users/dalla/OneDrive/Documents/HaloFire/src/db/seed.js`
- Create: `C:/Users/dalla/OneDrive/Documents/HaloFire/src/data/evidence-gates.js`
- Create: `C:/Users/dalla/OneDrive/Documents/HaloFire/tests/evidence-gates.test.js`

- [ ] **Step 1: Write failing evidence tests**

Tests:

```js
expect(homeDepotGates).toContainGate('AUTOSPRINK_EVIDENCE_MISSING');
expect(homeDepotGates).toContainGate('AHJ_APPROVAL_MISSING');
expect(homeDepotGates).toContainGate('PROFESSIONAL_REVIEW_MISSING');
expect(homeDepotGates).toContainGate('MANUFACTURER_MODEL_APPROVAL_MISSING');
expect(homeDepotGates.find(g => g.code === 'AUTOSPRINK_EVIDENCE_MISSING').blockedClaims).toContain('AutoSprink parity');
```

- [ ] **Step 2: Create schema**

Add:

```sql
CREATE TABLE IF NOT EXISTS project_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_name TEXT NOT NULL,
  evidence_type TEXT NOT NULL,
  source_file TEXT,
  source_ref TEXT,
  status TEXT NOT NULL,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS claim_gates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_name TEXT NOT NULL,
  code TEXT NOT NULL,
  severity TEXT NOT NULL,
  missing_artifact TEXT NOT NULL,
  acceptable_evidence TEXT NOT NULL,
  blocked_claims TEXT NOT NULL,
  next_action TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_name, code)
);
```

- [ ] **Step 3: Seed Home Depot evidence/gates**

Seed present evidence:

- Proposal workbook
- Bid log row 238
- ARGCO pricebook workbook
- FFF pricebook workbook
- Victaulic pricebook workbook

Seed blocking gates:

- `AUTOSPRINK_EVIDENCE_MISSING`
- `AHJ_APPROVAL_MISSING`
- `PROFESSIONAL_REVIEW_MISSING`
- `MANUFACTURER_MODEL_APPROVAL_MISSING`
- `BID_LOG_SQFT_DIFFERS_FROM_PROPOSAL`

- [ ] **Step 4: Add API routes**

Routes:

- `GET /api/projects/:name/evidence`
- `GET /api/projects/:name/claim-gates`
- `POST /api/projects/:name/evidence`

All require auth. Writes require admin role.

- [ ] **Step 5: Verify and commit**

Run:

```powershell
npx vitest run tests/evidence-gates.test.js
node src/db/seed.js
C:/Python312/python.exe E:/ClaudeBot/scripts/verify_agentic_rules.py
git add src/api/server.js src/db/seed.js src/data/evidence-gates.js tests/evidence-gates.test.js
git commit -m "evidence: add project claim gates"
```

---

## Task 5: Make `app.html` Backend-Driven

**Files:**
- Modify: `C:/Users/dalla/OneDrive/Documents/HaloFire/app.html`
- Modify: `C:/Users/dalla/OneDrive/Documents/HaloFire/index.html`
- Create: `C:/Users/dalla/OneDrive/Documents/HaloFire/tests/ui-smoke.spec.js`

- [ ] **Step 1: Write failing UI smoke**

Playwright test:

```js
test('landing reaches backend-driven Home Depot bid', async ({ page }) => {
  await page.goto('http://127.0.0.1:3001/');
  await page.getByRole('button', { name: /enter platform/i }).click();
  await page.fill('#user', process.env.HALOFIRE_ADMIN_USER);
  await page.fill('#pass', process.env.HALOFIRE_ADMIN_PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByText('Home Depot - Rexburg ID')).toBeVisible();
  await expect(page.getByText('$792,544')).toBeVisible();
  await expect(page.getByText('Evidence Required')).toBeVisible();
  await expect(page.getByText('AutoSprink')).toBeVisible();
});
```

Expected: fail because UI is static and disconnected.

- [ ] **Step 2: Add API client helpers in `app.html`**

Implement:

```js
var API = {
  token: localStorage.getItem('halofire_token'),
  async request(path, options) {
    var headers = Object.assign({'Content-Type':'application/json'}, options && options.headers || {});
    if (API.token) headers.Authorization = 'Bearer ' + API.token;
    var res = await fetch('/api' + path, Object.assign({}, options, {headers}));
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }
};
```

Replace static arrays by `loadData()`:

- `/api/bids`
- `/api/projects`
- `/api/pricebook`
- `/api/compliance`
- `/api/projects/Home%20Depot%20-%20Rexburg%20ID/claim-gates`

- [ ] **Step 3: Connect landing to app**

Make `index.html` `Enter Platform` navigate to `/app.html` or serve `app.html` after login. Remove visible dev credential hints.

- [ ] **Step 4: Add evidence panel**

For Home Depot and selected project views, show:

- Source files
- Last verified timestamp
- Blocking gates
- Blocked claims
- Next action
- AI fallback label: `best-effort internal alpha`

- [ ] **Step 5: Add responsive CSS**

Add breakpoints:

```css
@media (max-width: 900px) {
  .main-grid, .dashboard-grid, .project-grid { grid-template-columns: 1fr !important; }
  .sidebar { position: fixed; transform: translateX(-100%); }
  .sidebar.open { transform: translateX(0); }
}
```

- [ ] **Step 6: Verify and commit**

Run:

```powershell
npx vitest run tests/bid-package.test.js tests/evidence-gates.test.js
npx playwright test tests/ui-smoke.spec.js
C:/Python312/python.exe E:/ClaudeBot/scripts/verify_agentic_rules.py
git add app.html index.html tests/ui-smoke.spec.js
git commit -m "ui: connect halofire app to backend data"
```

---

## Task 6: Delivery Smoke And Review Packet

**Files:**
- Create: `C:/Users/dalla/OneDrive/Documents/HaloFire/docs/reviews/YYYY-MM-DD-internal-alpha-review.md`
- Create: `C:/Users/dalla/OneDrive/Documents/HaloFire/scripts/verify-internal-alpha.ps1`

- [ ] **Step 1: Create one-command verifier**

Create `scripts/verify-internal-alpha.ps1`:

```powershell
$ErrorActionPreference = "Stop"
npm install
npm rebuild better-sqlite3
node src/db/seed.js
npx vitest run tests/bid-package.test.js tests/bid-log-importer.test.js tests/pricebook-importer.test.js tests/evidence-gates.test.js tests/api-security.test.js
Start-Process -FilePath node -ArgumentList "src/api/server.js" -WorkingDirectory $PWD -WindowStyle Hidden -PassThru | Tee-Object -Variable proc
try {
  Start-Sleep -Seconds 2
  npx playwright test tests/ui-smoke.spec.js
} finally {
  Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
}
```

- [ ] **Step 2: Run final review agents**

Dispatch:

- API/security reviewer
- Data/evidence reviewer
- UI/product reviewer

Each reviewer must report Critical/Important/Minor findings and exact files.

- [ ] **Step 3: Write internal-alpha review**

The review must include:

- What works
- What is still blocked
- Why each claim is blocked
- Exact evidence rows
- Verification command output
- How Halo Fire employees update actual values/evidence

- [ ] **Step 4: Final smoke**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-internal-alpha.ps1
C:/Python312/python.exe E:/ClaudeBot/scripts/verify_agentic_rules.py
```

- [ ] **Step 5: Commit and brain postflight**

```powershell
git add docs/reviews scripts/verify-internal-alpha.ps1
git commit -m "docs: add halofire internal alpha review packet"
```

Write GX10 brain postflight with final status and exact remaining gates.

---

## Automation Plan

Create a new automation named `HaloFire OneDrive Delivery Owner`.

Recommended schedule: hourly while building, paused after internal-alpha review is delivered.

Prompt:

```text
Act as the scoped HaloFire OneDrive delivery owner. Work in C:/Users/dalla/OneDrive/Documents/HaloFire. This is not the retired broad Halo Forge loop. Every run must use GX10 brain MCP preflight and postflight, read docs/plans/2026-05-28-halofire-delivery-plan.md, inspect dirty files, choose exactly one unchecked task step that is safe, use TDD for behavior changes, run focused verification only, and commit scoped files if this folder is a git repo. If no git repo exists, stop after source-control Task 0. Never overwrite unrelated dirty work. Never claim permit-ready, AHJ-ready, engineering-grade, AutoSprink parity, fabrication-ready, professionally approved, or manufacturer-approved without explicit evidence rows. Report changed files, verification, commit, and next unchecked task.
```

Do not reuse `halo-forge-live-build-loop`; it is too broad and caused drift.

---

## Definition Of Delivered Internal Alpha

The project is deliverable when all of this is true:

- Source control exists and scoped commits are present.
- Home Depot Rexburg and bid-log data are sourced from actual workbooks.
- ARGCO, FFF, and Victaulic pricebooks import from actual workbooks with source metadata.
- API auth/secrets/update paths are hardened enough for internal alpha.
- UI reads backend data and persists changes through API.
- Evidence and claim gates are visible in the UI and API.
- AutoSprink/design/AHJ/professional/manufacturer claims fail closed with exact next actions.
- `scripts/verify-internal-alpha.ps1` passes on a clean local run.
- A final review packet states what works, what is blocked, and why.

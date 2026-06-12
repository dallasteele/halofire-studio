# HaloFire Employee Invite Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build secure email-as-username employee onboarding, password creation, password recovery, and a client-facing invite email for Wade.

**Architecture:** Add one-time auth token records on the existing API, keep email as canonical username, and let the login page switch between sign-in, create-password, and recovery modes from URL parameters. The real client link must point at the HTTPS backend/static host, not a Vite-only preview.

**Tech Stack:** Express, SQLite, bcryptjs, jsonwebtoken, static HTML/JS, Vitest, Gmail connector for final draft/send approval.

---

### Task 1: API Invite And Password Setup

**Files:**
- Modify: `apps/autosprink/src/api/server.js`
- Test: `apps/autosprink/tests/api-security.test.js`

- [ ] **Step 1: Write failing tests**

Add tests that create an admin token, call `POST /api/auth/invite`, verify non-admin users cannot invite, verify the invite creates/uses `username === email`, verify `POST /api/auth/setup-password` consumes the token and logs the user in, and verify token reuse fails.

- [ ] **Step 2: Run red test**

Run: `npm exec vitest -- run tests/api-security.test.js`
Expected: fail because invite/setup routes do not exist.

- [ ] **Step 3: Implement minimal API**

Add `auth_tokens` table, token hashing helpers, invite route, setup verify route, setup-password route, and password recovery request route.

- [ ] **Step 4: Run green test**

Run: `npm exec vitest -- run tests/api-security.test.js`
Expected: pass.

### Task 2: Login Page Modes

**Files:**
- Modify: `apps/autosprink/index.html`
- Test: `apps/autosprink/tests/client-login-static.test.js`

- [ ] **Step 1: Write failing static tests**

Assert the page supports `?username=`, `?setup=`, `autocomplete="new-password"`, setup password confirmation, `POST /api/auth/setup-password`, and `POST /api/auth/password-recovery/request`.

- [ ] **Step 2: Run red test**

Run: `npm exec vitest -- run tests/client-login-static.test.js`
Expected: fail until setup/recovery UI is added.

- [ ] **Step 3: Implement page modes**

Switch copy/form behavior based on URL parameters while keeping the existing black-glass design, safe redirect, and remember-me behavior.

- [ ] **Step 4: Run green test**

Run: `npm exec vitest -- run tests/client-login-static.test.js`
Expected: pass.

### Task 3: Preview And Email Draft

**Files:**
- No source file required for Gmail draft.

- [ ] **Step 1: Verify build and API tests**

Run: `npm run build`, `npm exec vitest -- run tests/api-security.test.js tests/client-login-static.test.js`, and `C:/Python312/python.exe scripts/verify_agentic_rules.py`.

- [ ] **Step 2: Confirm HTTPS login URL**

Use deployment environment or infra config without exposing secrets. The invite link must target the real HTTPS HaloFire login host.

- [ ] **Step 3: Prepare Gmail draft**

Draft a polished email to `wade@halofireus.com` explaining the invite, using Wade's email as username, and linking to the invite URL. Do not send until user confirms.

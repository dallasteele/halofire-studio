# HaloFire Dev Login Smoke Handoff

Date: 2026-06-12
Owner: Codex
Live URL: https://halofire.rankempire.io/
VPS app path: `/opt/openclaw/halofire-studio/apps/autosprink`

## Search Terms

Use these terms if semantic recall cannot fetch an episode by id:

- HaloFire dev login smoke handoff
- HaloFire secure login dev account
- dev@halofireus.com
- HaloFire Dev Reviewer admin
- halofire_session cookie auth
- workbench.html authenticated route
- autosprink.html Sprinkler CAD studio
- client-login-webgpu-hero-20260612

## Current Auth State

- Dev username/email: `dev@halofireus.com`
- Display name: `HaloFire Dev Reviewer`
- Role: `admin`
- Password: not stored in this file or the brain. Dallas has the current dev password in the Codex chat. If Claude/OpenClaw cannot access it, reset the dev password using the safe script below.
- Session model: `POST /api/auth/login` sets an HttpOnly `halofire_session` cookie.
- Current authenticated entry route: `/workbench.html`
- Actual CAD/studio route: `/autosprink.html`

## Verified By Codex

Codex verified the live account and app path in the in-app preview window:

1. `GET https://halofire.rankempire.io/api/health`
   - Returned status `ok`, version `1.0.0`.
2. `POST https://halofire.rankempire.io/api/auth/login`
   - Username `dev@halofireus.com`.
   - Returned `200`.
   - Set `halofire_session`.
   - Returned user role `admin`.
3. `GET https://halofire.rankempire.io/api/auth/me`
   - Returned `id=3`, username `dev@halofireus.com`, name `HaloFire Dev Reviewer`, role `admin`.
4. Browser preview login
   - Opened the live login page.
   - Verified `#user`, `#pass`, and `#submitButton` were unique.
   - Submitted the dev login.
   - Landed on `/workbench.html`.
   - `#whoami` displayed `HaloFire Dev Reviewer - admin`.
5. Browser preview Studio route
   - Clicked `Sprinkler Studio ->` from Workbench.
   - Landed on `/autosprink.html`.
   - Page title was `HaloFire Studio - Sprinkler CAD (Internal Alpha)`.
   - A CAD canvas was present.
   - Workbench and Settings nav links were present.
   - No browser console warnings/errors.
6. Reload persistence
   - Reloaded `/autosprink.html`.
   - Stayed on Studio, with canvas present and no login fields.

## Claude/OpenClaw Smoke Procedure

Run this exact chain before claiming login or studio access works:

1. API health:

```powershell
curl.exe -fsS https://halofire.rankempire.io/api/health
```

2. API login and cookie-backed `/auth/me` check:

```powershell
$password = Read-Host -AsSecureString "HaloFire dev password"
$plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($password))
$body = @{ username='dev@halofireus.com'; password=$plain; remember=$true } | ConvertTo-Json
$login = Invoke-WebRequest -UseBasicParsing -Method Post -Uri https://halofire.rankempire.io/api/auth/login -ContentType 'application/json' -Body $body -SessionVariable hf
$me = Invoke-WebRequest -UseBasicParsing -Uri https://halofire.rankempire.io/api/auth/me -WebSession $hf
"login_status=$($login.StatusCode)"
$me.Content
```

3. Preview/browser path:

- Open `https://halofire.rankempire.io/`.
- Fill `#user` with `dev@halofireus.com`.
- Fill `#pass` with the dev password.
- Click `#submitButton`.
- Verify URL becomes `/workbench.html`.
- Verify `#whoami` contains `HaloFire Dev Reviewer - admin`.
- Click `a[href="/autosprink.html"]` / `Sprinkler Studio ->`.
- Verify URL becomes `/autosprink.html`.
- Verify title contains `HaloFire Studio - Sprinkler CAD`.
- Verify a `canvas` exists.
- Reload `/autosprink.html` and verify it does not bounce back to login.

## Password Reset Script

Use this only if Claude/OpenClaw cannot access the current chat-only dev password.
Do not write the cleartext password to the brain or commit it.

```bash
cd /opt/openclaw/halofire-studio/apps/autosprink
HALOFIRE_DEV_PASSWORD='replace-with-temporary-password' node --input-type=module <<'NODE'
import 'dotenv/config';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';

const dbPath = process.env.HALOFIRE_DB_PATH
  ? path.resolve(process.env.HALOFIRE_DB_PATH)
  : path.resolve(process.cwd(), 'data/halofire.db');
const username = 'dev@halofireus.com';
const password = process.env.HALOFIRE_DEV_PASSWORD;
if (!password || password.length < 16) {
  throw new Error('HALOFIRE_DEV_PASSWORD must be set and at least 16 characters.');
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
const hash = bcrypt.hashSync(password, 12);
const existing = db.prepare('SELECT id FROM users WHERE lower(username)=lower(?) OR lower(email)=lower(?)').get(username, username);
if (existing) {
  db.prepare('UPDATE users SET password_hash=?, name=?, role=?, email=? WHERE id=?')
    .run(hash, 'HaloFire Dev Reviewer', 'admin', username, existing.id);
  console.log(JSON.stringify({ ok: true, action: 'updated', username, role: 'admin', dbPath }));
} else {
  const info = db.prepare('INSERT INTO users (username,password_hash,name,role,email) VALUES (?,?,?,?,?)')
    .run(username, hash, 'HaloFire Dev Reviewer', 'admin', username);
  console.log(JSON.stringify({ ok: true, action: 'created', id: info.lastInsertRowid, username, role: 'admin', dbPath }));
}
db.close();
NODE
```

## Notes

- Do not create another Wade invite unless the existing one is expired or consumed.
- Employee usernames should be emails.
- Password confirmation is only required during initial password setup, not normal login.
- If WebGL/Three.js fails on VPS, check static vendored Three assets and console logs separately from auth. Auth is already verified independently.

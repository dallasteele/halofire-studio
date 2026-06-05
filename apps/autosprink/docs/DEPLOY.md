# HaloFire — Deploy / Run (internal alpha)

This is the exact local run path for the internal-alpha bid/CAD/evidence
workbench. It is best-effort and fail-closed; see
`docs/reviews/2026-06-01-halofire-current-review.md` for the truthful status of
what works and what is NOT claimed.

Repo root: `C:/Users/dalla/OneDrive/Documents/HaloFire`.

## Required environment variables

The API server (`src/api/server.js`) fail-closes without secrets unless dev
defaults are explicitly allowed.

| Var | Purpose | Notes |
|---|---|---|
| `JWT_SECRET` | Signs login JWTs | Required (unless `HALOFIRE_ALLOW_DEV_DEFAULTS=1`) |
| `HALOFIRE_ADMIN_USER` | Bootstrap admin username | Required (unless dev defaults) |
| `HALOFIRE_ADMIN_PASSWORD` | Bootstrap admin password | Required (unless dev defaults) |
| `HALOFIRE_DB_PATH` | SQLite DB file path | Optional; defaults to the repo's `data/` DB |
| `PORT` | API/UI port | Optional; defaults to `3001` |
| `HALOFIRE_ALLOW_DEV_DEFAULTS` | If `1`, allows local dev defaults | Do NOT set in any shared/deployed env |

Never commit secrets. Provide them via the shell environment at launch.

## One-time setup

```
npm install
```

## Seed the database

Imports real bid log + pricebooks from the source `.xlsx` files and seeds
evidence + claim gates. Provide secrets in the environment first.

PowerShell:

```powershell
$env:JWT_SECRET = "<a-long-random-secret>"
$env:HALOFIRE_ADMIN_USER = "admin"
$env:HALOFIRE_ADMIN_PASSWORD = "<a-strong-password>"
node src/db/seed.js
```

To seed/run against a throwaway DB without touching the live `data/` DB, also
set `$env:HALOFIRE_DB_PATH` to a temp path before seeding.

## Run the server

```powershell
node src/api/server.js
```

Then open in a browser:

1. `/` (or `index.html`) — log in with the bootstrap admin credentials above
   (the login calls the real API and stores a JWT).
2. `workbench.html` — real project / gates / evidence, run the auto-bid engine,
   view the BOM + pricing + Three.js 3D building and sprinkler layout.
3. `/autosprink.html` — the OpenGeometry CAD studio (3D render + DXF/STEP/IFC/STL
   export).

Default port is `3001` (override with `PORT`). Note: a separate preview server
may already be running on port `3201` — do not collide with it.

## One-command verifier

```
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-internal-alpha.ps1
```

This seeds a temp DB, verifies seeded gates/evidence, runs the **full**
`npx vitest run` suite (no file list, so it can never drift from the real test
count), and runs the workspace agentic-rules check. It cleans up its temp DB and
does not touch the live `data/` DB.

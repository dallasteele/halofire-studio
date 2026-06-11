# HaloFire deploy workflow — VPS is canonical (user 2026-06-11)

**No more localhost as the reference.** The live VPS site is what the client and
the team look at. Local runs exist ONLY to verify before going live.

## The live site
- URL: **http://halofire.rankempire.io**  (⚠ HTTP only — see SSL gap below)
- VPS: `root@187.124.234.28` · service `halofire.service`
- Runs: `/opt/openclaw/halofire-studio/apps/autosprink/src/api/server.js` on :3301
- nginx vhost `halofire.rankempire.io` → 127.0.0.1:3301
- Tracks `github.com/dallasteele/halofire-studio` branch `main`

## Going live — ALWAYS via the verified pipeline
```
bash scripts/deploy-vps.sh          # full gates + deploy + health + rollback
bash scripts/deploy-vps.sh --skip-cad   # autosprink-only changes
```
The script: runs local gates (red = abort) → confirms origin/main is pushed →
snapshots the live commit → pulls + installs + restarts on the VPS →
health-checks :3301 → **auto-rolls back to the snapshot if the site is
unhealthy** so the client never sees a broken site → confirms the public edge.

**Never** rely on the old blind hourly `git pull` cron to update the client
site — it has no gate, no health check, no rollback. The pipeline replaces it.

## Verify against the live URL (not localhost)
After deploy, verification is against `http://halofire.rankempire.io` (curl the
health/route, or open it in a browser). The Claude preview pane should point at
the live URL, not a local dev server.

## Open gap — SSL before client logins (flagged, not blocking the demo)
The vhost is `listen 80` (HTTP). Before real client passwords flow (Wade's
portal login), enable HTTPS: `certbot --nginx -d halofire.rankempire.io`. Until
then the site is viewable but logins must wait for TLS. Tracked in PRIORITIES.

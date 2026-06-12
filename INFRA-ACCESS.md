# Unattended infra access — Cloudflare + Hostinger (Claude + OpenClaw)

Goal: Claude and OpenClaw manage DNS / VPS infra **without per-action human
interaction**. Mechanism = **scoped API tokens** (the only way OpenClaw on GX10,
which has no browser, can reach these providers).

## The one-time step that stays YOURS (security boundary)
The AI never creates or handles raw API tokens — your Cloudflare account
controls 17 client domains, so token creation/placement is yours. It's ~5
clicks, once.

### 1. Cloudflare token (minimal scope)
dash.cloudflare.com → **My Profile → API Tokens → Create Token** →
template **"Edit zone DNS"** → **Zone Resources → Include → Specific zone →
rankempire.io** → Create → copy.

### 2. Hostinger token
hpanel.hostinger.com → account/VPS **API tokens** → create (VPS/DNS scope).

### 3. Place them (never committed)
On GX10 (so OpenClaw + cron read them):
```
sudo install -m 600 /dev/null /opt/hal9000/config/infra-secrets.env
# paste the two lines from scripts/infra-secrets.env.example with real values
```
`.gitignore` already excludes `infra-secrets.env`, so the values never reach git.

## After that — fully unattended
Both Claude and OpenClaw source the secret file and run:
```
source /opt/hal9000/config/infra-secrets.env
bash scripts/cf-dns.sh rankempire.io halofire A 187.124.234.28 true
```
`cf-dns.sh` is idempotent (create-or-update) and reads `$CLOUDFLARE_API_TOKEN`
from env — no secret is ever hardcoded. The same token drives all future DNS
work (new client subdomains, etc.) with zero interaction.

## What goes live the moment the Cloudflare token is placed
1. `cf-dns.sh` adds the proxied `halofire` A record → Cloudflare serves
   **https://halofire.rankempire.io** at its edge automatically (TLS, no certbot
   needed on origin).
2. The client portal login can then go live securely.

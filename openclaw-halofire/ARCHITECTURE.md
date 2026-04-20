# OpenClaw-HaloFire Architecture

## Module ABI

Every module the runtime can start is described by `module.toml` at
`modules/<name>/module.toml`. The ABI is intentionally small —
adding a new module should not require changes to the runtime.

### Required keys

```toml
[module]
name         = "halofire-xyz"    # unique id (slug)
version      = "0.1.0"           # semver
description  = "one-line pitch"

[runtime]
type         = "service" | "cron" | "oneshot"
command      = ["python", "-m", "pkg.entry"]   # argv — absolute or resolvable on PATH
working_dir  = "../services/halofire-xyz"      # relative to openclaw-halofire/
env          = {}                              # optional env-var table
```

### Optional keys

```toml
[runtime]
restart_policy = "on_failure"    # "always" | "on_failure" | "never"
restart_delay_s = 5
kill_signal     = "SIGTERM"      # Linux only; Windows always uses CTRL-BREAK
stdout_log      = "logs/halofire-xyz.out"
stderr_log      = "logs/halofire-xyz.err"

[schedule]                       # only for type = "cron"
cron            = "0 2 * * 1"    # Mon 02:00 — same grammar as crontab
timezone        = "America/Denver"

[health]
http            = "http://localhost:18080/health"
timeout_s       = 5
expect_status   = 200

[deps]
services        = ["halofire-cad"]      # hard deps — wait for health
models          = ["gemma3:4b"]         # Ollama tags to pre-pull

[ui]                              # optional — surfaces in Halo's dashboard
title           = "Studio"
icon            = "cube"
route           = "http://localhost:3002/"
```

## Tier semantics

### Tier 0 — deterministic auto-fix

Implemented inline in `openclaw/loop.py::_tier_0`. Pattern-matches
on a small number of known symptoms:

| symptom | fix |
|---|---|
| module process exited with non-zero | restart up to `restart_policy` allowance |
| `/health` endpoint returned 5xx for 3 checks in a row | restart once |
| `prices` table older than 7 days on cron module | trigger sync now (if source doc present) |
| DuckDB WAL file > 1 GB | `CHECKPOINT` and truncate |

Tier 0 runs every 60 seconds. No LLM, no cloud, no cost.

### Tier 1 — local Gemma diagnosis

When Tier 0 can't resolve a symptom within 3 cycles, `openclaw/loop.py`
packages the recent logs + health state into a prompt and sends it
to `gemma3:4b` via Ollama. The model emits JSON:

```json
{
  "diagnosis": "stdout log ends with 'duckdb lock timeout'; likely dangling writer",
  "confidence": 0.82,
  "actions": [
    {"kind": "restart", "target": "halofire-cad"},
    {"kind": "run", "cmd": ["python", "-m", "pricing.tools.checkpoint"]}
  ],
  "escalate": false
}
```

Accepted actions (whitelist):

- `restart` — supervisor restarts the named module
- `run` — execute an argv from the module's tools/ directory
- `note` — write an entry to `logs/tier1.md`

`confidence < 0.7` or `escalate: true` → Tier 2.

### Tier 2 — human escalation

Opt-in per install (`install/tier2.toml`):

- Jira ticket, Slack webhook, email — whichever Halo chooses
- The runtime pauses auto-fix for the affected module (so Gemma
  doesn't keep thrashing while the human is looking)

No cloud LLM, no cost, unless Halo explicitly wires one up later.

## Config precedence (highest → lowest)

1. CLI flag (`openclaw --model gemma3:12b …`)
2. Environment (`HALOFIRE_SYNC_MODEL=gemma3:12b`)
3. `install/local.toml` (Halo's deployment-specific overrides)
4. `modules/<name>/module.toml`
5. Built-in defaults in `openclaw/defaults.py`

## Logging + observability

- Every module's stdout/stderr goes to `logs/<module>.{out,err}`
  with daily rotation.
- Runtime events (starts, restarts, tier-1 prompts, tier-1 actions,
  tier-2 escalations) go to `logs/runtime.jsonl`.
- `openclaw status` prints a single-screen summary.
- `openclaw tail <module>` streams live logs.
- No outbound telemetry. Halo's data stays on Halo's machines.

## Versioning

- `openclaw-halofire/VERSION` is the runtime version.
- Each module declares its own `version` in `module.toml`.
- `openclaw upgrade` runs `git pull` in the parent repo, validates
  every module still loads, then restarts — atomic, never
  half-upgraded.

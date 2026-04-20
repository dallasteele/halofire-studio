# OpenClaw — HaloFire edition

Halo's own autonomous runtime. A trimmed clone of the HAL / OpenClaw
architecture (used in the ClaudeBot monorepo to run trading, Brain,
and VPS agents) stripped down to **only the modules Halo needs** for
fire-sprinkler bidding.

This directory is what ships on Halo's hardware. One install, one
systemd / Windows service, one LLM (Gemma, local, free).

## What it runs

| module | what it does | source |
|---|---|---|
| `halofire-studio` | Next.js studio / editor UI | `../apps/editor` |
| `halofire-cad` | FastAPI gateway + Auto-Design agent pipeline | `../services/halopenclaw-gateway` |
| `halofire-pricing` | DuckDB pricing DB + scheduled Gemma sync | `../services/halofire-cad/pricing` |
| *(more later)* | Halo-specific modules added by dropping a module.toml in `modules/` | — |

## What it deliberately does NOT run

Everything that is not HaloFire:

- No trading (Kalshi, Kraken, Monad)
- No prediction-markets loop
- No Brain / LightRAG — too heavy for a client install; if Halo
  eventually wants shared memory, add a HaloFire-scoped Brain as
  its own module
- No VPS deployer, no GitHub auto-fix, no oracle action parser for
  HAL-specific escalations

The goal is a single, explainable stack Halo IT can reason about.

## Model policy

**Gemma only.** Default `gemma3:4b` via Ollama at `localhost:11434`.
Enforced in code by `openclaw.llm._require_gemma` — same guard as
the pricing sync agent. No Qwen, Llama, Mistral, or Phi will run on
a HaloFire install.

## Architecture (three tiers, lifted from HAL.md)

```
  ┌───────────────────────────────────────────────────────────┐
  │ Tier 0 — deterministic auto-fix (Python only, FREE)       │
  │   health_check → restart_crashed_module → reseed_db       │
  └───────────────────────────────────────────────────────────┘
                       │ unresolved
                       ▼
  ┌───────────────────────────────────────────────────────────┐
  │ Tier 1 — local Gemma diagnosis (Ollama, FREE)             │
  │   parse error → propose fix → append to action queue      │
  └───────────────────────────────────────────────────────────┘
                       │ confidence < 0.7 OR action == escalate
                       ▼
  ┌───────────────────────────────────────────────────────────┐
  │ Tier 2 — cloud escalation (COSTS MONEY)                   │
  │   open ticket in Halo's Jira/Slack, halt auto-fix,        │
  │   wait for human input. Opt-in per install.               │
  └───────────────────────────────────────────────────────────┘
```

## File layout

```
openclaw-halofire/
├── README.md             ← this file
├── ARCHITECTURE.md       ← module ABI + tier semantics
├── openclaw/             ← the runtime (Python 3.12+)
│   ├── registry.py
│   ├── supervisor.py
│   ├── scheduler.py
│   ├── loop.py
│   ├── llm.py
│   ├── health.py
│   └── api.py
├── modules/              ← per-module descriptors
│   ├── halofire-studio/module.toml
│   ├── halofire-cad/module.toml
│   └── halofire-pricing/module.toml
├── bin/
│   └── openclaw          ← CLI entry point
├── install/
│   ├── install.ps1       ← Windows installer
│   └── install.sh        ← Linux installer
└── tests/
    └── test_runtime.py
```

## Install (Windows, at Halo)

```powershell
# Pre-reqs: Python 3.12, Node 22, bun, Ollama
ollama pull gemma3:4b
cd openclaw-halofire
./install/install.ps1
# Starts: openclaw daemon, studio, cad gateway, weekly pricing sync
```

## Adding a new module

Drop a `modules/<name>/module.toml`:

```toml
[module]
name = "halofire-rfi-responder"
version = "0.1.0"
description = "Auto-drafts GC RFI replies using past Halo responses"

[runtime]
type = "service"                 # or "cron" or "oneshot"
command = ["python", "-m", "halofire_rfi.server"]
working_dir = "../services/halofire-rfi"
env.PORT = "18081"

[health]
http = "http://localhost:18081/health"
timeout_s = 5

[deps]
services = ["halofire-cad"]      # won't start until cad is healthy
```

Reload: `openclaw reload`. No runtime code changes required.

## Tests

```
pytest openclaw-halofire/tests/ -q
```

Smoke: registry discovers modules, scheduler fires cron jobs,
supervisor restarts a crashed child, Tier 0 auto-fix runs before
Gemma is called.

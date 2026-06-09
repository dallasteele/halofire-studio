# HaloFire Agent Loop (GX10)

Autonomous build loop that drives the AutoSprink tool-parity backlog with the
LOCAL model (`qwen3:30b-a3b` via Ollama) — **zero cloud tokens**. Claude/Codex
are escalation targets only, never called from here.

## How it works

```
backlog.json ──▶ loop.py picks next pending task
                  │  prompt = task spec + bounded context files
                  ▼
          Ollama qwen3:30b-a3b  (num_ctx 12288, JSON-forced, temp 0.2)
                  │  {"files":[{path, content}...]}
                  ▼
          write files (confined to task write_roots, traversal rejected)
                  ▼
          GATE 1: task-scoped  `tsc -b && vitest run test/<module>.test.ts`
          GATE 2: full         `vitest run` (regression)
            ├─ green ─▶ commit + push to `agent/qwen-loop`, mark done, brain_remember
            └─ red   ─▶ feed error tail back, retry (max 3) ─▶ mark blocked + revert
```

- **Deterministic-first:** no commit without both gates green. Blocked tasks keep
  their error tail in `backlog.json` for operator/Claude escalation.
- **Honesty:** a `done` task means *that module + tests pass*. It is never an
  AutoSprink-parity / AHJ / PE claim. Specs carry their own citations; the model
  is instructed not to invent constants.
- **Branch policy:** the loop only pushes `agent/qwen-loop`. Merging to `main`
  stays human/Claude-reviewed.

## Backlog tasks

Sourced from `docs/research/autosprink-tool-parity-plan.md` (transcribed from the
real mepcad.com AutoSprink 2018 docs). Loop tasks are deliberately **pure modules
+ tests** (the shape a local model lands reliably); store/UI integration of landed
modules happens in separate reviewed passes.

## Install on GX10

```bash
cd /opt/hal9000/apps
git clone https://github.com/dallasteele/halofire-studio.git
cd halofire-studio && git checkout agent/qwen-loop
( crontab -l 2>/dev/null; echo '*/30 * * * * /opt/hal9000/apps/halofire-studio/agent-loop/run.sh >> /opt/hal9000/logs/halofire-agent-loop.log 2>&1' ) | crontab -
```

Manual run: `MAX_TASKS=1 agent-loop/run.sh`

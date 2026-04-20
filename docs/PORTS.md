# Canonical ports — HaloFire stack

Single source of truth so reviewers and Halo IT don't hit a stale
process on a drifted port.

## Development (this repo, local)

| service | port | what |
|---|---:|---|
| **Studio (Next.js dev)** | 3002 | `cd apps/editor && bun run dev` |
| **halopenclaw gateway** | **18080** | `cd services/halopenclaw-gateway && python -m main` |
| Brain / HAL API | 9000 | parent ClaudeBot project (`core/hal`) |
| Ollama (Gemma host) | 11434 | `ollama serve`; pre-pull `gemma3:4b` |
| Claude Preview MCP | (dynamic) | spawns browser tied to the Studio port |

The editor defaults to `http://localhost:18080` for the gateway
(`apps/editor/.env.development`).

## VPS (portal.rankempire.io demo)

| service | port | exposure |
|---|---:|---|
| halopenclaw gateway | 18790 | **behind nginx**, not direct |
| nginx | 80/443 | `/halofire/*` → gateway `18790` |
| Studio | — | statically deployed (no Next server on VPS) |

> **Note:** The VPS historically bound `18790` and some dev boxes
> cached that port. If you're running locally and anything reports
> port `18790`, restart from the current tree — the dev target is
> `18080`.

## Stale-process recovery

If a dev box has both `18080` and `18790` listening:

```powershell
# Windows
Get-NetTCPConnection -LocalPort 18790 -State Listen | ForEach-Object {
  Stop-Process -Id $_.OwningProcess -Force
}
```

```bash
# Linux / macOS / WSL
fuser -k 18790/tcp || true
```

Then restart the canonical gateway:

```bash
cd services/halopenclaw-gateway && C:/Python312/python.exe -m main
```

Verify with:

```bash
curl -sI http://localhost:18080/health
# Expect HTTP 200 with a tools list matching the current tree.
```

## Health-check contract

- `GET /health` — returns `{ok: true, service, version, tools: [...]}`
- Used by the StatusBar (15 s poll) to render the green/red dot.
- Empty or non-200 response = red dot + "gateway down" text.

# @halofire/ai-bridge

Unified Claude + Codex client layer. Halofire Studio's only place where
AI calls happen; every feature that needs AI goes through this package.

## Backends

- **Claude** via `@anthropic-ai/sdk` — primary; tool use + vision + reasoning
- **Codex CLI** — shell out for multi-step code/file edits (server-side) or
  via halopenclaw gateway proxy (browser-side)
- **Local / LLM Gateway** :8787 — future; add a client here when needed

## Usage

```ts
import { routeRequest } from '@halofire/ai-bridge'

const response = await routeRequest({
  messages: [{ role: 'user', content: 'Classify this room as NFPA 13 hazard.' }],
  // Let the router pick Claude or Codex
})
console.log(response.text)
```

## Model selection

- **Opus 4.6**: default for reasoning + tool use + vision
- **Haiku 4.5**: short lookups + classification
- **Codex**: large multi-step refactors when request says "apply to codebase"

## Per user instruction

> "this app will need to have connections to claude, codex and a halopenclaw solution"

This package is that bridge. The halopenclaw connection flows the other way
(the gateway calls OUR tools), so it lives in `packages/halofire-halopenclaw-client/`
not here.

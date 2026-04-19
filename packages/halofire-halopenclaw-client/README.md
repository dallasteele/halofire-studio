# @halofire/halopenclaw-client

Typed JSON-RPC client for the halopenclaw gateway. Used by Halofire
Studio's browser side + by `@halofire/ai-bridge` when Claude/Codex call
tools on behalf of a user.

## Usage

```ts
import {
  createHalopenclawClient,
  serializePascalScene,
} from '@halofire/halopenclaw-client'

const client = createHalopenclawClient({
  // baseUrl: 'https://gateway.rankempire.io/halofire',   // prod override
})

const scene = serializePascalScene(pascalStore.getState().roots)

const result = await client.validate('shell', scene, { toleranceCm: 2.0 })
console.log(result)
```

## Methods

- `listTools()` — enumerate tools the gateway currently exposes
- `health()` — GET /health
- `call<T>(tool, args)` — generic escape hatch for any tool
- `validate(mode, scene, opts)` — typed wrapper

More typed wrappers (ingest/place_head/route_pipe/calc/export) will be
added as the corresponding gateway tools get real implementations in
M1-M4.

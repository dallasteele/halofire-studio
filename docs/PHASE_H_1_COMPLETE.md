# Phase H.1 — HAL V3 LLM client adapter (complete)

**Status:** landed, 13/13 tests green, gateway suite 60 passed / 1 skipped.

Provides `services/halopenclaw-gateway/hal_client.py` — the LLM
abstraction layer halofire's server-side agents will use for Gemma
local / Claude cloud routing. Dev routes through the HAL V3 hub at
`http://127.0.0.1:9000`; production swaps in a bundled OpenClaw
sidecar with no caller change.

## Factory rules

`make_llm_client()` picks a backend from env, in this precedence:

| Env var             | Result                                                        |
| ------------------- | ------------------------------------------------------------- |
| `OPENCLAW_BASE_URL` | `OpenClawDirectClient(base_url=$OPENCLAW_BASE_URL)`           |
| `HAL_BASE_URL`      | `HALV3Client(base_url=$HAL_BASE_URL)`                         |
| *(neither set)*     | `HALV3Client(base_url="http://127.0.0.1:9000")` — dev default |

`get_llm_client()` caches the first result process-wide so agents
share a pooled `httpx.AsyncClient`. `reset_llm_client_cache()` exists
for tests that need to re-read env vars.

## Example call site

```python
# single_ops.py
async def llm_classify(prompt: str, system: str) -> str:
    client = get_llm_client()
    if not client.available:
        return ""              # graceful degrade — caller uses
                               # deterministic fallback
    return await client.chat(prompt, system=system, max_tokens=256)
```

Phase H.3 agents (grounding_agent, escalation_agent) will consume
this helper. Nothing else in the repo calls it yet — this phase is
just the contract.

## V3 stream event kinds handled

Verified against `E:/ClaudeBot/hal/runtime/turn_engine.py`. The
engine emits 8 kinds; the client handles each:

| Kind                | Payload shape                          | Client behaviour                              |
| ------------------- | -------------------------------------- | --------------------------------------------- |
| `advisor_start`     | `{"advisor": "gemma-local" \| ...}`    | ignored (metadata)                            |
| `text_delta`        | `{"text": "..."}`                      | appended to response string                   |
| `advisor_end`       | `{"advisor": ...}`                     | ignored (metadata)                            |
| `tool_call_start`   | `{"id","tool","args"}`                 | forwarded to `on_tool_call` callback if given |
| `tool_result`       | `{"id","tool","kind","value"}`         | pass-through (consumers use `chat_stream`)    |
| `approval_required` | `{"id","tool","args","reason"}`        | raises `LLMApprovalRequired(tool_call_id, tool, tool_args)` |
| `error`             | `{"message": "..."}`                   | raises `LLMError(message)`                    |
| `done`              | `{}`                                   | terminates the stream                         |

Note — the plan doc mentioned `.content` for `text_delta`, but the
V3 source emits `.text`. The client accepts either key so future
advisor parsers that change the convention don't break us.

## What happens when the hub is offline

1. `HALV3Client(base_url=...)` constructs without probing — no
   import-time network calls.
2. `available: bool` starts `True` (optimistic).
3. First network failure — connection refused, 5xx from `/health`,
   HTTP error during stream — flips `available = False` and returns
   `'{"error": "llm_unavailable"}'` from `chat()` / `vision()`.
4. Subsequent calls short-circuit to the sentinel with no retry, so
   one missing hub doesn't wedge every agent with repeated timeouts.
5. `GET /health/llm` on the gateway surfaces `{available, backend,
   detail}` so `hal-desktop`'s service banner can show the LLM-layer
   state alongside the core services.

Agents read `client.available` and fall back to deterministic
behaviour (SCAD crude renders, rule-based classifiers) where
possible — the LLM layer is an *accelerator*, not a dependency.

## Files landed

- `services/halopenclaw-gateway/hal_client.py` — `LLMClient`
  Protocol, `HALV3Client`, `OpenClawDirectClient`, factory +
  cached accessor, typed exceptions (`LLMError`,
  `LLMApprovalRequired`, `LLMUnavailable`).
- `services/halopenclaw-gateway/tests/test_hal_client.py` — 13
  tests: SSE accumulation, error/approval raises, tool-call
  callback, hub-down degrade (both probe + mid-stream), factory
  env-var precedence, cache, vision bytes → base64, vision URL
  pass-through, sentinel-without-crash.
- `services/halopenclaw-gateway/single_ops.py` — added
  `llm_classify()` helper (not used yet; H.3 agents will consume).
- `services/halopenclaw-gateway/main.py` — added `GET /health/llm`
  endpoint.

## Verification evidence

```
$ C:/Python312/python.exe -m pytest tests/test_hal_client.py -q
13 passed in 2.68s

$ C:/Python312/python.exe -m pytest tests/ -q --ignore=tests/test_hydraulic_report_pdf.py
60 passed, 1 skipped in 5.74s
```

Lane scope respected — no changes to `apps/editor/**`,
`packages/halofire-catalog/**`, or `services/halofire-cad/agents/**`.

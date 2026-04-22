"""LLM client abstraction for halofire-studio's server-side agents.

Phase H.1 — routes LLM calls through the HAL V3 hub in dev, with a
drop-in swap to a bundled OpenClaw sidecar in production.

The V3 hub lives at ``http://127.0.0.1:9000`` (env ``HAL_BASE_URL``) and
speaks SSE on ``POST /runtime/chat/stream``. This module subscribes to
that stream, accumulates ``text_delta`` chunks into a single string,
and surfaces tool calls / approvals / errors as typed signals.

V3 stream event contract (verified against ``hal/runtime/turn_engine.py``):

* ``advisor_start``     — metadata, ignored
* ``text_delta``        — ``{"text": "..."}`` accumulated
* ``advisor_end``       — metadata, ignored
* ``tool_call_start``   — ``{"id","tool","args"}`` surfaced via callback
* ``tool_result``       — ``{"id","tool","kind","value"}`` pass-through
* ``approval_required`` — raises :class:`LLMApprovalRequired`
* ``error``             — ``{"message": "..."}`` raises :class:`LLMError`
* ``done``              — terminates the stream

Design choices:

* ``chat()`` returns a plain ``str`` so existing agent call sites don't
  need restructuring.
* Graceful degrade — if the hub is unreachable at construction time,
  the client is created anyway with ``available=False``; ``chat()``
  returns a JSON sentinel and downstream agents can fall back to
  deterministic paths without crashing.
* ``make_llm_client()`` is the only thing callers should construct.
  ``get_llm_client()`` memoises the factory so every agent shares one
  pooled HTTP session.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
from typing import Any, AsyncIterator, Awaitable, Callable, Protocol

import httpx


__all__ = [
    "LLMClient",
    "HALV3Client",
    "OpenClawDirectClient",
    "LLMError",
    "LLMApprovalRequired",
    "LLMUnavailable",
    "make_llm_client",
    "get_llm_client",
]


log = logging.getLogger("halofire.hal_client")


# ── Exceptions ──────────────────────────────────────────────────────


class LLMError(RuntimeError):
    """Raised when the hub surfaces an ``error`` event mid-stream."""


class LLMApprovalRequired(RuntimeError):
    """Raised when the hub emits ``approval_required`` — the caller must
    approve/deny via the permission endpoints before re-issuing the turn.
    """

    def __init__(self, tool_call_id: str, tool: str, args: dict[str, Any]):
        super().__init__(f"approval required for tool {tool!r} (id={tool_call_id})")
        self.tool_call_id = tool_call_id
        self.tool = tool
        # Stored as ``tool_args`` to avoid clobbering ``BaseException.args``
        # (which is a tuple). ``args`` mirrors it for convenience.
        self.tool_args = args


class LLMUnavailable(RuntimeError):
    """Raised by callers that opt-into strict mode when the client is
    marked ``available=False``. Default behaviour is a sentinel response."""


ToolCallHandler = Callable[[dict[str, Any]], Awaitable[None] | None]


# ── Protocol ────────────────────────────────────────────────────────


class LLMClient(Protocol):
    """Minimal async LLM interface used by halofire's server agents."""

    available: bool

    async def chat(
        self,
        prompt: str,
        *,
        system: str | None = None,
        model: str = "auto",
        max_tokens: int = 2048,
        temperature: float = 0.0,
        tools: list[dict[str, Any]] | None = None,
        on_tool_call: ToolCallHandler | None = None,
    ) -> str: ...

    async def chat_stream(
        self,
        prompt: str,
        *,
        system: str | None = None,
        model: str = "auto",
        max_tokens: int = 2048,
        temperature: float = 0.0,
        tools: list[dict[str, Any]] | None = None,
    ) -> AsyncIterator[str]: ...

    async def vision(
        self,
        prompt: str,
        *,
        images: list[bytes | str],
        model: str = "auto",
        max_tokens: int = 2048,
    ) -> str: ...

    async def health(self) -> dict[str, Any]: ...


_SENTINEL_UNAVAILABLE = json.dumps({"error": "llm_unavailable"})


# ── SSE parser ──────────────────────────────────────────────────────


def _iter_sse_frames(chunk_iter: AsyncIterator[str]) -> AsyncIterator[tuple[str, dict[str, Any]]]:
    """Parse an SSE byte stream into ``(event_name, data_dict)`` tuples.

    Returns an async generator. Buffers across chunk boundaries.
    """

    async def _gen():
        buffer = ""
        async for raw in chunk_iter:
            buffer += raw
            while "\n\n" in buffer:
                frame, buffer = buffer.split("\n\n", 1)
                event = "message"
                data_lines: list[str] = []
                for line in frame.splitlines():
                    if line.startswith(":"):
                        continue  # keepalive
                    if line.startswith("event:"):
                        event = line[len("event:"):].strip()
                    elif line.startswith("data:"):
                        data_lines.append(line[len("data:"):].lstrip())
                if not data_lines:
                    continue
                data_raw = "\n".join(data_lines)
                try:
                    data = json.loads(data_raw)
                except json.JSONDecodeError:
                    data = {"raw": data_raw}
                yield event, data

    return _gen()


# ── HAL V3 client ───────────────────────────────────────────────────


class HALV3Client:
    """Routes LLM calls through HAL V3's ``/runtime/chat/stream`` endpoint.

    Parameters
    ----------
    base_url
        Root URL for the hub. Defaults to ``http://127.0.0.1:9000``.
    session_id
        Identifier passed to the hub so permission decisions are scoped
        to this client. Each factory instance gets a stable UUID-ish id.
    workspace_root
        Path the hub uses to resolve tool-call permissions. For halofire
        we send the studio root so fs_read/fs_write stay sandboxed.
    timeout
        Per-request timeout in seconds. Streams ignore read timeouts.
    """

    def __init__(
        self,
        *,
        base_url: str = "http://127.0.0.1:9000",
        session_id: str = "halofire-studio",
        workspace_root: str | None = None,
        permission_mode: str = "bypass",
        timeout: float = 30.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.session_id = session_id
        self.workspace_root = workspace_root or os.getcwd()
        self.permission_mode = permission_mode
        self._client = httpx.AsyncClient(timeout=timeout)
        self.available: bool = True  # optimistic; `probe()` may flip it

    async def aclose(self) -> None:
        await self._client.aclose()

    # ── health ──
    async def health(self) -> dict[str, Any]:
        try:
            r = await self._client.get(f"{self.base_url}/health")
            if r.status_code // 100 != 2:
                self.available = False
                return {"ok": False, "status": r.status_code}
            self.available = True
            return r.json()
        except httpx.HTTPError as exc:
            self.available = False
            return {"ok": False, "error": str(exc)}

    async def probe(self) -> bool:
        """Hit /health once; flip `available` accordingly. Safe to skip —
        callers can also let the first chat() fail soft."""
        await self.health()
        return self.available

    # ── chat ──
    async def chat(
        self,
        prompt: str,
        *,
        system: str | None = None,
        model: str = "auto",
        max_tokens: int = 2048,
        temperature: float = 0.0,
        tools: list[dict[str, Any]] | None = None,
        on_tool_call: ToolCallHandler | None = None,
    ) -> str:
        if not self.available:
            return _SENTINEL_UNAVAILABLE
        # ``model`` / ``temperature`` / ``tools`` are accepted for the
        # Protocol but V3 routes advisors by name; we map model="auto"
        # to advisor="auto" and let the hub pick gemma-local vs claude.
        advisor = "auto" if model in ("auto", "", None) else model
        messages: list[dict[str, Any]] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})
        body = {
            "session_id": self.session_id,
            "workspace_root": self.workspace_root,
            "permission_mode": self.permission_mode,
            "messages": messages,
            "advisor": advisor,
            "max_tokens": max_tokens,
        }
        collected: list[str] = []
        try:
            async with self._client.stream(
                "POST",
                f"{self.base_url}/runtime/chat/stream",
                json=body,
                timeout=httpx.Timeout(connect=5.0, read=None, write=30.0, pool=5.0),
            ) as resp:
                if resp.status_code // 100 != 2:
                    raise LLMError(
                        f"hub returned {resp.status_code}: {await resp.aread()!r}"
                    )
                async for kind, payload in _iter_sse_frames(resp.aiter_text()):
                    handled = await self._dispatch_event(
                        kind, payload, collected, on_tool_call,
                    )
                    if handled == "done":
                        break
        except httpx.HTTPError as exc:
            self.available = False
            log.warning("HAL V3 hub unreachable: %s", exc)
            return _SENTINEL_UNAVAILABLE
        return "".join(collected)

    async def _dispatch_event(
        self,
        kind: str,
        payload: dict[str, Any],
        collected: list[str],
        on_tool_call: ToolCallHandler | None,
    ) -> str | None:
        if kind == "text_delta":
            # V3 emits {"text": "..."}. Tolerate {"content": "..."} just
            # in case a future advisor parser uses that key.
            collected.append(
                str(payload.get("text") or payload.get("content") or "")
            )
            return None
        if kind == "tool_call_start":
            if on_tool_call is not None:
                result = on_tool_call(payload)
                if asyncio.iscoroutine(result):
                    await result
            return None
        if kind == "tool_result":
            # Pass-through — nothing to accumulate. UIs that need these
            # should use chat_stream() instead.
            return None
        if kind == "approval_required":
            raise LLMApprovalRequired(
                tool_call_id=str(payload.get("id") or ""),
                tool=str(payload.get("tool") or ""),
                args=dict(payload.get("args") or {}),
            )
        if kind == "error":
            raise LLMError(str(payload.get("message") or "unknown hub error"))
        if kind == "done":
            return "done"
        # advisor_start, advisor_end, unknown future kinds — ignore.
        return None

    # ── chat_stream ──
    async def chat_stream(
        self,
        prompt: str,
        *,
        system: str | None = None,
        model: str = "auto",
        max_tokens: int = 2048,
        temperature: float = 0.0,
        tools: list[dict[str, Any]] | None = None,
    ) -> AsyncIterator[str]:
        """Async iterator yielding raw ``text_delta`` chunks.

        Non-text events (tool calls, errors) still raise — callers that
        need more structure should use ``chat()`` + ``on_tool_call``.
        """
        if not self.available:
            async def _empty():
                if False:  # pragma: no cover
                    yield ""
            return _empty()
        advisor = "auto" if model in ("auto", "", None) else model
        messages: list[dict[str, Any]] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})
        body = {
            "session_id": self.session_id,
            "workspace_root": self.workspace_root,
            "permission_mode": self.permission_mode,
            "messages": messages,
            "advisor": advisor,
            "max_tokens": max_tokens,
        }

        async def _gen():
            async with self._client.stream(
                "POST",
                f"{self.base_url}/runtime/chat/stream",
                json=body,
                timeout=httpx.Timeout(connect=5.0, read=None, write=30.0, pool=5.0),
            ) as resp:
                if resp.status_code // 100 != 2:
                    raise LLMError(f"hub returned {resp.status_code}")
                async for kind, payload in _iter_sse_frames(resp.aiter_text()):
                    if kind == "text_delta":
                        yield str(payload.get("text") or payload.get("content") or "")
                    elif kind == "error":
                        raise LLMError(str(payload.get("message") or "hub error"))
                    elif kind == "approval_required":
                        raise LLMApprovalRequired(
                            tool_call_id=str(payload.get("id") or ""),
                            tool=str(payload.get("tool") or ""),
                            args=dict(payload.get("args") or {}),
                        )
                    elif kind == "done":
                        return

        return _gen()

    # ── vision ──
    async def vision(
        self,
        prompt: str,
        *,
        images: list[bytes | str],
        model: str = "auto",
        max_tokens: int = 2048,
    ) -> str:
        """Route a vision call through V3.

        V3 message content follows the Anthropic/OpenAI "content parts"
        shape — a list of typed parts where ``{"type": "image", ...}``
        carries the image. Bytes are base64-encoded and wrapped as a
        ``data:`` URL; strings are passed through (assumed to be URLs
        or pre-encoded data URLs).
        """
        if not self.available:
            return _SENTINEL_UNAVAILABLE
        advisor = "auto" if model in ("auto", "", None) else model
        parts: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
        for img in images:
            parts.append({"type": "image", "source": _encode_image(img)})
        body = {
            "session_id": self.session_id,
            "workspace_root": self.workspace_root,
            "permission_mode": self.permission_mode,
            "messages": [{"role": "user", "content": parts}],
            "advisor": advisor,
            "max_tokens": max_tokens,
        }
        collected: list[str] = []
        try:
            async with self._client.stream(
                "POST",
                f"{self.base_url}/runtime/chat/stream",
                json=body,
                timeout=httpx.Timeout(connect=5.0, read=None, write=30.0, pool=5.0),
            ) as resp:
                if resp.status_code // 100 != 2:
                    raise LLMError(f"hub returned {resp.status_code}")
                async for kind, payload in _iter_sse_frames(resp.aiter_text()):
                    handled = await self._dispatch_event(
                        kind, payload, collected, None,
                    )
                    if handled == "done":
                        break
        except httpx.HTTPError as exc:
            self.available = False
            log.warning("HAL V3 hub unreachable (vision): %s", exc)
            return _SENTINEL_UNAVAILABLE
        return "".join(collected)


def _encode_image(img: bytes | str) -> dict[str, Any]:
    if isinstance(img, (bytes, bytearray)):
        b64 = base64.b64encode(bytes(img)).decode("ascii")
        return {"type": "base64", "media_type": "image/png", "data": b64}
    # String — could be a URL, path, or pre-encoded data URL. Pass URL
    # through, let the hub resolve.
    return {"type": "url", "url": img}


# ── OpenClaw direct client (production) ─────────────────────────────


class OpenClawDirectClient:
    """Direct client for a bundled OpenClaw sidecar on port 18789.

    Used when halofire ships its own embedded OpenClaw (Tauri desktop
    release). Speaks ``POST /v1/chat/completions`` with bearer auth.
    Same ``LLMClient`` surface as :class:`HALV3Client` so the factory
    swap is purely env-driven.
    """

    def __init__(
        self,
        *,
        base_url: str = "http://127.0.0.1:18789",
        api_key: str = "hal-local-canvas",
        timeout: float = 60.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self._client = httpx.AsyncClient(
            timeout=timeout,
            headers={"Authorization": f"Bearer {api_key}"},
        )
        self.available: bool = True

    async def aclose(self) -> None:
        await self._client.aclose()

    async def health(self) -> dict[str, Any]:
        try:
            r = await self._client.get(f"{self.base_url}/healthz")
            if r.status_code // 100 != 2:
                self.available = False
                return {"ok": False, "status": r.status_code}
            self.available = True
            return {"ok": True, **(r.json() if r.content else {})}
        except httpx.HTTPError as exc:
            self.available = False
            return {"ok": False, "error": str(exc)}

    async def chat(
        self,
        prompt: str,
        *,
        system: str | None = None,
        model: str = "auto",
        max_tokens: int = 2048,
        temperature: float = 0.0,
        tools: list[dict[str, Any]] | None = None,
        on_tool_call: ToolCallHandler | None = None,
    ) -> str:
        if not self.available:
            return _SENTINEL_UNAVAILABLE
        messages: list[dict[str, Any]] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})
        body: dict[str, Any] = {
            "model": model if model != "auto" else "claude-sonnet-4-5",
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
        }
        if tools:
            body["tools"] = tools
        try:
            r = await self._client.post(
                f"{self.base_url}/v1/chat/completions", json=body,
            )
            if r.status_code // 100 != 2:
                raise LLMError(f"openclaw returned {r.status_code}: {r.text}")
            data = r.json()
            # OpenAI-compatible shape
            choice = (data.get("choices") or [{}])[0]
            return str(
                (choice.get("message") or {}).get("content") or ""
            )
        except httpx.HTTPError as exc:
            self.available = False
            log.warning("OpenClaw sidecar unreachable: %s", exc)
            return _SENTINEL_UNAVAILABLE

    async def chat_stream(self, *args, **kwargs) -> AsyncIterator[str]:
        # Streaming through the sidecar's OpenAI-compatible SSE is a
        # Phase H.3+ concern. Return the full response as one chunk.
        text = await self.chat(*args, **kwargs)

        async def _one():
            yield text
        return _one()

    async def vision(
        self,
        prompt: str,
        *,
        images: list[bytes | str],
        model: str = "auto",
        max_tokens: int = 2048,
    ) -> str:
        if not self.available:
            return _SENTINEL_UNAVAILABLE
        parts: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
        for img in images:
            parts.append({"type": "image_url", "image_url": _encode_image_openai(img)})
        body = {
            "model": model if model != "auto" else "claude-sonnet-4-5",
            "messages": [{"role": "user", "content": parts}],
            "max_tokens": max_tokens,
        }
        try:
            r = await self._client.post(
                f"{self.base_url}/v1/chat/completions", json=body,
            )
            if r.status_code // 100 != 2:
                raise LLMError(f"openclaw returned {r.status_code}")
            data = r.json()
            choice = (data.get("choices") or [{}])[0]
            return str((choice.get("message") or {}).get("content") or "")
        except httpx.HTTPError as exc:
            self.available = False
            return _SENTINEL_UNAVAILABLE


def _encode_image_openai(img: bytes | str) -> dict[str, Any]:
    if isinstance(img, (bytes, bytearray)):
        b64 = base64.b64encode(bytes(img)).decode("ascii")
        return {"url": f"data:image/png;base64,{b64}"}
    return {"url": img}


# ── Factory ─────────────────────────────────────────────────────────


def make_llm_client() -> LLMClient:
    """Pick a client based on env vars.

    Precedence:
      1. ``OPENCLAW_BASE_URL`` → :class:`OpenClawDirectClient`
      2. ``HAL_BASE_URL``      → :class:`HALV3Client`
      3. default               → :class:`HALV3Client` @ 127.0.0.1:9000

    The client is returned with ``available=True`` optimistically; if
    the hub is down, the first ``chat()`` / ``health()`` call flips the
    flag and subsequent calls return the sentinel without retrying.
    """
    openclaw_url = os.environ.get("OPENCLAW_BASE_URL", "").strip()
    if openclaw_url:
        log.info("halofire LLM client → OpenClaw sidecar at %s", openclaw_url)
        return OpenClawDirectClient(base_url=openclaw_url)
    hal_url = os.environ.get("HAL_BASE_URL", "").strip() or "http://127.0.0.1:9000"
    log.info("halofire LLM client → HAL V3 hub at %s", hal_url)
    return HALV3Client(base_url=hal_url)


_CACHED: LLMClient | None = None


def get_llm_client() -> LLMClient:
    """Module-level cached factory so agents share a pooled HTTP session."""
    global _CACHED
    if _CACHED is None:
        _CACHED = make_llm_client()
    return _CACHED


def reset_llm_client_cache() -> None:
    """Test/utility hook — drops the cached client so the next
    ``get_llm_client()`` re-reads env vars."""
    global _CACHED
    _CACHED = None

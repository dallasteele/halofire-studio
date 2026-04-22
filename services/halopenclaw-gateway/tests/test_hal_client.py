"""Phase H.1 — tests for the HAL V3 LLM client abstraction.

Verifies:
  * SSE frame parser accumulates ``text_delta`` events into chat output
  * ``error`` event raises :class:`LLMError`
  * ``approval_required`` raises :class:`LLMApprovalRequired`
  * Hub-down at startup flips ``available`` to False, chat returns sentinel
  * Env-var factory precedence (OPENCLAW_BASE_URL > HAL_BASE_URL > default)
  * Vision encodes bytes as base64 content parts
  * Tool-call events invoke the ``on_tool_call`` callback
"""
from __future__ import annotations

import asyncio
import base64
import json
from typing import Any

import httpx
import pytest

import hal_client
from hal_client import (
    HALV3Client,
    LLMApprovalRequired,
    LLMError,
    OpenClawDirectClient,
    get_llm_client,
    make_llm_client,
    reset_llm_client_cache,
)


# ── helpers ─────────────────────────────────────────────────────────


def _sse(events: list[tuple[str, dict]]) -> bytes:
    """Encode a list of (event_name, data_dict) into an SSE byte stream."""
    out: list[str] = []
    for name, data in events:
        out.append(f"event: {name}\ndata: {json.dumps(data)}\n\n")
    return "".join(out).encode("utf-8")


def _make_mock_transport(
    stream_body: bytes | None = None,
    *,
    health_status: int = 200,
    stream_status: int = 200,
) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/health":
            if health_status == 200:
                return httpx.Response(200, json={
                    "status": "ok", "service": "hal-api",
                })
            return httpx.Response(health_status, text="down")
        if request.url.path == "/runtime/chat/stream":
            if stream_status != 200:
                return httpx.Response(stream_status, text="nope")
            return httpx.Response(
                200,
                content=stream_body or b"",
                headers={"content-type": "text/event-stream"},
            )
        return httpx.Response(404)
    return httpx.MockTransport(handler)


def _inject_transport(client: HALV3Client, transport: httpx.MockTransport) -> None:
    """Swap the client's async http client for one backed by MockTransport."""
    asyncio.get_event_loop_policy()  # ensure loop policy accessible
    # Close the existing one synchronously is fine — it never opened.
    client._client = httpx.AsyncClient(transport=transport, timeout=5.0)


# ── chat() accumulates text_delta ───────────────────────────────────


@pytest.mark.asyncio
async def test_chat_accumulates_text_delta():
    body = _sse([
        ("advisor_start", {"advisor": "gemma-local"}),
        ("text_delta", {"text": "Hello"}),
        ("text_delta", {"text": ", "}),
        ("text_delta", {"text": "world."}),
        ("advisor_end", {"advisor": "gemma-local"}),
        ("done", {}),
    ])
    client = HALV3Client(base_url="http://fake")
    _inject_transport(client, _make_mock_transport(body))
    try:
        out = await client.chat("say hi")
        assert out == "Hello, world."
    finally:
        await client.aclose()


# ── error event raises LLMError ─────────────────────────────────────


@pytest.mark.asyncio
async def test_error_event_raises():
    body = _sse([
        ("advisor_start", {"advisor": "claude"}),
        ("error", {"message": "model unavailable"}),
        ("done", {}),
    ])
    client = HALV3Client(base_url="http://fake")
    _inject_transport(client, _make_mock_transport(body))
    try:
        with pytest.raises(LLMError, match="model unavailable"):
            await client.chat("anything")
    finally:
        await client.aclose()


# ── approval_required event raises typed exception ─────────────────


@pytest.mark.asyncio
async def test_approval_required_raises():
    body = _sse([
        ("advisor_start", {"advisor": "claude"}),
        ("tool_call_start", {"id": "tc_1", "tool": "fs_write", "args": {"path": "/tmp/x"}}),
        ("approval_required", {
            "id": "tc_1", "tool": "fs_write", "args": {"path": "/tmp/x"},
            "reason": "tier=high",
        }),
    ])
    client = HALV3Client(base_url="http://fake")
    _inject_transport(client, _make_mock_transport(body))
    try:
        with pytest.raises(LLMApprovalRequired) as info:
            await client.chat("write file")
        assert info.value.tool_call_id == "tc_1"
        assert info.value.tool == "fs_write"
        assert info.value.tool_args == {"path": "/tmp/x"}
    finally:
        await client.aclose()


# ── tool_call_start invokes callback ────────────────────────────────


@pytest.mark.asyncio
async def test_tool_call_callback_invoked():
    body = _sse([
        ("tool_call_start", {"id": "tc_9", "tool": "grep", "args": {"q": "x"}}),
        ("tool_result", {"id": "tc_9", "kind": "result", "value": "found"}),
        ("text_delta", {"text": "done"}),
        ("done", {}),
    ])
    client = HALV3Client(base_url="http://fake")
    _inject_transport(client, _make_mock_transport(body))
    seen: list[dict[str, Any]] = []

    async def cb(payload: dict[str, Any]) -> None:
        seen.append(payload)

    try:
        out = await client.chat("search", on_tool_call=cb)
        assert out == "done"
        assert seen and seen[0]["tool"] == "grep"
    finally:
        await client.aclose()


# ── hub-down → available=False, sentinel from chat() ────────────────


@pytest.mark.asyncio
async def test_hub_down_probe_flips_available():
    client = HALV3Client(base_url="http://fake")
    _inject_transport(client, _make_mock_transport(health_status=503))
    try:
        ok = await client.probe()
        assert ok is False
        assert client.available is False
        out = await client.chat("ignored")
        assert json.loads(out) == {"error": "llm_unavailable"}
    finally:
        await client.aclose()


@pytest.mark.asyncio
async def test_hub_network_error_returns_sentinel():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    client = HALV3Client(base_url="http://fake")
    client._client = httpx.AsyncClient(
        transport=httpx.MockTransport(handler), timeout=2.0,
    )
    try:
        out = await client.chat("hi")
        assert json.loads(out) == {"error": "llm_unavailable"}
        assert client.available is False
    finally:
        await client.aclose()


# ── factory env-var precedence ──────────────────────────────────────


def test_factory_default_is_halv3(monkeypatch):
    monkeypatch.delenv("OPENCLAW_BASE_URL", raising=False)
    monkeypatch.delenv("HAL_BASE_URL", raising=False)
    reset_llm_client_cache()
    c = make_llm_client()
    assert isinstance(c, HALV3Client)
    assert c.base_url == "http://127.0.0.1:9000"


def test_factory_hal_base_url(monkeypatch):
    monkeypatch.delenv("OPENCLAW_BASE_URL", raising=False)
    monkeypatch.setenv("HAL_BASE_URL", "http://alt-hub:9100")
    reset_llm_client_cache()
    c = make_llm_client()
    assert isinstance(c, HALV3Client)
    assert c.base_url == "http://alt-hub:9100"


def test_factory_openclaw_wins(monkeypatch):
    monkeypatch.setenv("HAL_BASE_URL", "http://hub:9000")
    monkeypatch.setenv("OPENCLAW_BASE_URL", "http://openclaw:18789")
    reset_llm_client_cache()
    c = make_llm_client()
    assert isinstance(c, OpenClawDirectClient)
    assert c.base_url == "http://openclaw:18789"


def test_get_llm_client_caches(monkeypatch):
    monkeypatch.delenv("OPENCLAW_BASE_URL", raising=False)
    monkeypatch.delenv("HAL_BASE_URL", raising=False)
    reset_llm_client_cache()
    a = get_llm_client()
    b = get_llm_client()
    assert a is b


# ── vision: bytes encoded as base64 content parts ──────────────────


@pytest.mark.asyncio
async def test_vision_encodes_bytes_as_base64():
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content.decode())
        body = _sse([
            ("text_delta", {"text": "a cat"}),
            ("done", {}),
        ])
        return httpx.Response(
            200, content=body, headers={"content-type": "text/event-stream"},
        )

    client = HALV3Client(base_url="http://fake")
    client._client = httpx.AsyncClient(
        transport=httpx.MockTransport(handler), timeout=5.0,
    )
    img_bytes = b"\x89PNG\r\n\x1a\nfakepng"
    try:
        out = await client.vision("describe", images=[img_bytes])
        assert out == "a cat"
    finally:
        await client.aclose()

    parts = captured["body"]["messages"][0]["content"]
    assert parts[0] == {"type": "text", "text": "describe"}
    img_part = parts[1]
    assert img_part["type"] == "image"
    src = img_part["source"]
    assert src["type"] == "base64"
    assert src["media_type"] == "image/png"
    assert base64.b64decode(src["data"]) == img_bytes


@pytest.mark.asyncio
async def test_vision_url_pass_through():
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content.decode())
        body = _sse([("text_delta", {"text": "ok"}), ("done", {})])
        return httpx.Response(
            200, content=body, headers={"content-type": "text/event-stream"},
        )

    client = HALV3Client(base_url="http://fake")
    client._client = httpx.AsyncClient(
        transport=httpx.MockTransport(handler), timeout=5.0,
    )
    try:
        await client.vision("describe", images=["https://example.com/cat.png"])
    finally:
        await client.aclose()
    parts = captured["body"]["messages"][0]["content"]
    assert parts[1]["source"] == {
        "type": "url", "url": "https://example.com/cat.png",
    }


# ── unavailable client returns sentinel without crashing ───────────


@pytest.mark.asyncio
async def test_unavailable_client_chat_returns_sentinel():
    client = HALV3Client(base_url="http://fake")
    client.available = False
    out = await client.chat("ignored")
    assert json.loads(out) == {"error": "llm_unavailable"}
    await client.aclose()

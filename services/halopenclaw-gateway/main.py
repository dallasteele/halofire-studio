"""Halopenclaw Gateway — Halofire Studio's tool-calling service.

JSON-RPC 2.0 endpoint at POST /mcp that exposes Halofire design primitives
as tools. Called by:
  - Claude (via Agent SDK tool-use loop)
  - Codex CLI (via the /codex/run proxy)
  - Halofire Studio browser (direct REST for non-tool calls)

Port 18790 (dev). Production: behind nginx at gateway.rankempire.io/halofire.

Run:
    uvicorn main:app --reload --port 18790

Healthcheck:
    curl http://localhost:18790/health
"""
from __future__ import annotations

import uuid
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from tools import registry

app = FastAPI(
    title="Halopenclaw Gateway",
    description="Halofire Studio tool dispatcher — JSON-RPC 2.0 + REST",
    version="0.0.1",
)

# Allow the Halofire Studio dev server + production URL
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3002",
        "https://studio.rankempire.io",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Health ───────────────────────────────────────────────────────────────────


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "service": "halopenclaw-gateway",
        "version": "0.0.1",
        "tools": list(registry.TOOLS.keys()),
    }


# ── JSON-RPC 2.0 MCP-compatible endpoint ────────────────────────────────────


class JsonRpcRequest(BaseModel):
    jsonrpc: str = "2.0"
    id: int | str | None = None
    method: str
    params: dict[str, Any] | None = None


@app.post("/mcp")
async def mcp(body: JsonRpcRequest) -> dict[str, Any]:
    if body.jsonrpc != "2.0":
        raise HTTPException(400, "only jsonrpc 2.0 supported")

    if body.method == "tools/list":
        return {
            "jsonrpc": "2.0",
            "id": body.id,
            "result": {
                "tools": [
                    {
                        "name": name,
                        "description": tool.description,
                        "inputSchema": tool.input_schema,
                    }
                    for name, tool in registry.TOOLS.items()
                ],
            },
        }

    if body.method == "tools/call":
        params = body.params or {}
        name = params.get("name")
        args = params.get("arguments", {})
        if not name or name not in registry.TOOLS:
            return {
                "jsonrpc": "2.0",
                "id": body.id,
                "error": {"code": -32601, "message": f"unknown tool: {name}"},
            }
        tool = registry.TOOLS[name]
        try:
            result = await tool.invoke(args)
            return {
                "jsonrpc": "2.0",
                "id": body.id,
                "result": {
                    "content": [{"type": "text", "text": result}],
                    "isError": False,
                },
            }
        except (RuntimeError, ValueError, KeyError) as e:
            return {
                "jsonrpc": "2.0",
                "id": body.id,
                "result": {
                    "content": [{"type": "text", "text": f"error: {e}"}],
                    "isError": True,
                },
            }

    return {
        "jsonrpc": "2.0",
        "id": body.id,
        "error": {"code": -32601, "message": f"unknown method: {body.method}"},
    }


# ── REST endpoints for browser-side use (non-tool ops) ──────────────────────


@app.post("/takeoff/upload")
async def takeoff_upload(request: Request) -> dict[str, Any]:
    """Upload a PDF, kick off the 4-layer takeoff pipeline, return job ID."""
    # TODO M2 week 7: accept multipart, stream bytes to disk, enqueue job
    job_id = str(uuid.uuid4())
    return {"jobId": job_id, "status": "queued"}


@app.get("/takeoff/status/{job_id}")
async def takeoff_status(job_id: str) -> dict[str, Any]:
    # TODO M2: read job state from Redis or in-memory dict
    return {"jobId": job_id, "status": "queued", "percent": 0}


@app.post("/codex/run")
async def codex_run(body: dict[str, Any]) -> dict[str, Any]:
    """Browser-side codex proxy. Forwards to local codex CLI on the server."""
    # TODO M1 week 6: subprocess-based codex invocation with proper sanitization
    _ = body
    return {
        "backend": "codex",
        "text": "codex bridge not yet wired — M1 week 6",
    }


# ── Entrypoint for uvicorn ──────────────────────────────────────────────────


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=18790, reload=True)

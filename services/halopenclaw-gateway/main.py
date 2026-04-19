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

import asyncio
import importlib.util
import json
import os
import sys
import uuid
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from tools import registry

# Load the halofire-cad orchestrator once at startup so the in-process
# pipeline can be kicked off from REST endpoints without shelling out.
_HFCAD = Path(__file__).resolve().parents[1] / "halofire-cad"
if _HFCAD.exists() and str(_HFCAD) not in sys.path:
    sys.path.insert(0, str(_HFCAD))
_ORCH = None


def _orchestrator():
    global _ORCH
    if _ORCH is None:
        spec = importlib.util.spec_from_file_location(
            "hf_orchestrator", _HFCAD / "orchestrator.py",
        )
        if spec and spec.loader:
            m = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(m)
            _ORCH = m
    return _ORCH

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


# ── Input pipeline: upload + run the full CAD pipeline ─────────────

# Job registry (in-memory for dev; production uses Redis)
_JOBS: dict[str, dict[str, Any]] = {}

# Upload + deliverables storage
_DATA_ROOT = Path(os.environ.get(
    "HALOFIRE_DATA", str(Path(__file__).resolve().parent / "data"),
))
_DATA_ROOT.mkdir(parents=True, exist_ok=True)


@app.post("/intake/upload")
async def intake_upload(
    file: UploadFile = File(...),
    project_id: str = "demo",
    mode: str = "pipeline",  # "pipeline" | "quickbid" | "intake-only"
) -> dict[str, Any]:
    """Accept an architect's PDF/IFC/DWG. Start the CAD pipeline async.
    Returns a job_id the client polls via /intake/status/{id}.
    """
    if not file.filename:
        raise HTTPException(400, "no file provided")
    proj_dir = _DATA_ROOT / project_id
    uploads = proj_dir / "uploads"
    uploads.mkdir(parents=True, exist_ok=True)
    dest = uploads / file.filename
    content = await file.read()
    dest.write_bytes(content)

    job_id = str(uuid.uuid4())
    _JOBS[job_id] = {
        "job_id": job_id,
        "project_id": project_id,
        "file": str(dest),
        "bytes": len(content),
        "status": "queued",
        "percent": 0,
        "steps_complete": [],
        "error": None,
        "summary": None,
    }

    # Fire and forget — ensure we don't block the HTTP response
    asyncio.create_task(_run_job(job_id, str(dest), project_id, mode))
    return {
        "job_id": job_id,
        "project_id": project_id,
        "file": file.filename,
        "bytes": len(content),
        "mode": mode,
        "status": "queued",
        "poll_url": f"/intake/status/{job_id}",
    }


async def _run_job(job_id: str, pdf_path: str, project_id: str, mode: str) -> None:
    """Background job runner. Pushes progress into _JOBS[job_id]."""
    job = _JOBS[job_id]
    job["status"] = "running"
    try:
        orch = _orchestrator()
        if not orch:
            raise RuntimeError("orchestrator not available")
        out_dir = _DATA_ROOT / project_id / "deliverables"
        if mode == "quickbid":
            # Quickbid path — fake stats pending real extraction
            result = orch.run_quickbid(
                total_sqft=170000, project_id=project_id,
                level_count=6, standpipe_count=2, dry_systems=2,
            )
            job["summary"] = result
            job["percent"] = 100
            job["status"] = "completed"
            return
        # Full pipeline — run_pipeline is synchronous Python; run in
        # executor so we don't block the event loop.
        loop = asyncio.get_running_loop()
        def _run():
            return orch.run_pipeline(
                pdf_path, project_id=project_id, out_dir=out_dir,
            )
        summary = await loop.run_in_executor(None, _run)
        job["summary"] = summary
        job["percent"] = 100
        job["steps_complete"] = [s.get("step") for s in summary.get("steps", [])]
        job["status"] = "completed"
    except Exception as e:
        job["status"] = "failed"
        job["error"] = str(e)


@app.get("/intake/status/{job_id}")
async def intake_status(job_id: str) -> dict[str, Any]:
    if job_id not in _JOBS:
        raise HTTPException(404, "no such job")
    return _JOBS[job_id]


@app.get("/projects/{project_id}/proposal.json")
async def get_proposal_json(project_id: str) -> JSONResponse:
    p = _DATA_ROOT / project_id / "deliverables" / "proposal.json"
    if not p.exists():
        raise HTTPException(404, "proposal not generated yet")
    return JSONResponse(json.loads(p.read_text(encoding="utf-8")))


@app.get("/projects/{project_id}/deliverable/{name}")
async def get_deliverable(project_id: str, name: str):
    p = _DATA_ROOT / project_id / "deliverables" / name
    if not p.exists() or ".." in name:
        raise HTTPException(404, "deliverable not found")
    return FileResponse(p)


# ── Quick bid ────────────────────────────────────────────────────────

@app.post("/quickbid")
async def quickbid(body: dict[str, Any]) -> dict[str, Any]:
    """60-second quick-bid estimator."""
    orch = _orchestrator()
    if not orch:
        raise HTTPException(500, "orchestrator not loaded")
    return orch.run_quickbid(
        total_sqft=float(body.get("total_sqft", 100000)),
        project_id=str(body.get("project_id", "demo")),
        level_count=int(body.get("level_count", 1)),
        standpipe_count=int(body.get("standpipe_count", 0)),
        dry_systems=int(body.get("dry_systems", 0)),
        hazard_mix=body.get("hazard_mix"),
    )


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

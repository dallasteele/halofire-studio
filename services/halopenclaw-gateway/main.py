"""Halopenclaw Gateway — Halofire Studio's tool-calling service.

JSON-RPC 2.0 endpoint at POST /mcp that exposes Halofire design primitives
as tools. Called by:
  - Claude (via Agent SDK tool-use loop)
  - Codex CLI (via the /codex/run proxy)
  - Halofire Studio browser (direct REST for non-tool calls)

Port 18080 for local Studio dev. Production may bind 18790 behind nginx
at gateway.rankempire.io/halofire via the systemd unit.

Run:
    uvicorn main:app --reload --port 18080

Healthcheck:
    curl http://localhost:18080/health
"""
from __future__ import annotations

import asyncio
import importlib.util
import json
import os
import re
import sys
import uuid
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException

from tools import registry

# V2 step 4 — real OpenSCAD runtime. Lazy-instantiated at first use so
# the gateway starts even when OpenSCAD isn't installed; it'll fall
# back to the Trimesh pre-bake in that case.
_SCAD_MOD_PATH = Path(__file__).resolve().parent / "openscad_runtime.py"
_scad_spec = importlib.util.spec_from_file_location(
    "halofire_openscad_runtime", _SCAD_MOD_PATH,
)
if _scad_spec is not None and _scad_spec.loader is not None:
    openscad_runtime = importlib.util.module_from_spec(_scad_spec)
    _scad_spec.loader.exec_module(openscad_runtime)
else:
    openscad_runtime = None  # type: ignore[assignment]

_scad_runtime_instance: Any | None = None


def _get_scad():
    """Return a process-wide OpenScadRuntime, creating it on first use."""
    global _scad_runtime_instance
    if _scad_runtime_instance is None and openscad_runtime is not None:
        _scad_runtime_instance = openscad_runtime.OpenScadRuntime()
    return _scad_runtime_instance


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

# Allow the Halofire Studio dev server + production URL.
# In dev (when HALOFIRE_AUTH_REQUIRED is unset) we use allow_origin_regex
# so any localhost port works — the user's dev server might pick 3003
# or 3004 if 3002 is taken, and "Failed to fetch" from CORS was
# the root cause of the reported Auto-Design silent failure.
_DEV_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:3002",
    "http://localhost:3003",
    "http://localhost:3004",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
    "http://127.0.0.1:3002",
    "http://127.0.0.1:3003",
    "http://127.0.0.1:3004",
    "https://studio.rankempire.io",
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_DEV_ORIGINS,
    allow_origin_regex=(
        r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$"
    ),
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=False,
    expose_headers=["Content-Length", "Content-Type"],
)


@app.exception_handler(StarletteHTTPException)
async def _http_error(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
    detail = exc.detail if isinstance(exc.detail, str) else "request failed"
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {
                "code": detail.upper().replace(" ", "_")[:80],
                "message": detail,
            },
        },
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
_PROJECT_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$")
_MAX_UPLOAD_BYTES = int(os.environ.get("HALOFIRE_MAX_UPLOAD_BYTES", str(200 * 1024 * 1024)))
_API_KEY = os.environ.get("HALOFIRE_API_KEY")


def _require_api_key(request: Request) -> None:
    if not _API_KEY:
        return
    direct = request.headers.get("x-halofire-api-key")
    auth = request.headers.get("authorization", "")
    bearer = auth[7:] if auth.lower().startswith("bearer ") else None
    if direct == _API_KEY or bearer == _API_KEY:
        return
    raise HTTPException(401, "missing or invalid HALOFIRE_API_KEY")


def _safe_project_id(project_id: str) -> str:
    if not _PROJECT_ID_RE.fullmatch(project_id):
        raise HTTPException(400, "project_id must be 1-80 chars: letters, numbers, dot, dash, underscore")
    return project_id


def _safe_project_dir(project_id: str) -> Path:
    safe_id = _safe_project_id(project_id)
    root = _DATA_ROOT.resolve()
    path = (_DATA_ROOT / safe_id).resolve()
    if root not in path.parents and path != root:
        raise HTTPException(400, "invalid project path")
    return path


@app.post("/intake/upload")
async def intake_upload(
    request: Request,
    file: UploadFile = File(...),
    project_id: str = "demo",
    mode: str = "pipeline",  # "pipeline" | "quickbid" | "intake-only"
) -> dict[str, Any]:
    """Accept an architect's PDF/IFC/DWG. Start the CAD pipeline async.
    Returns a job_id the client polls via /intake/status/{id}.
    """
    _require_api_key(request)
    if not file.filename:
        raise HTTPException(400, "no file provided")
    proj_dir = _safe_project_dir(project_id)
    uploads = proj_dir / "uploads"
    uploads.mkdir(parents=True, exist_ok=True)
    filename = Path(file.filename).name
    if not filename:
        raise HTTPException(400, "invalid file name")
    dest = uploads / filename
    content = await file.read(_MAX_UPLOAD_BYTES + 1)
    if len(content) > _MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"upload too large; max {_MAX_UPLOAD_BYTES} bytes")
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
    """Background job runner. Pushes progress into _JOBS[job_id].

    V2 step 5 — also appends per-stage events to the job's
    ``events`` list + wakes any SSE listeners on ``event_condition``
    so ``/intake/stream/{job_id}`` can drip progress out as it lands.
    """
    job = _JOBS[job_id]
    job["status"] = "running"
    job.setdefault("events", [])
    job.setdefault("event_condition", asyncio.Condition())
    loop = asyncio.get_running_loop()

    def _on_progress(event: dict[str, Any]) -> None:
        # Called from the pipeline worker thread — schedule the
        # condition wake on the event loop.
        async def _push() -> None:
            async with job["event_condition"]:
                job["events"].append(event)
                job["event_condition"].notify_all()
        try:
            asyncio.run_coroutine_threadsafe(_push(), loop)
        except RuntimeError:
            job["events"].append(event)

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
                progress_callback=_on_progress,
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
    # Drop non-JSON-serializable internals (Condition) from the
    # response payload.
    job = _JOBS[job_id]
    return {k: v for k, v in job.items() if k != "event_condition"}


@app.get("/intake/stream/{job_id}")
async def intake_stream(job_id: str):
    """V2 step 5 — SSE stream of pipeline stage events.

    Emits one ``data: <json>`` line per stage completion (intake,
    classify, place, route, hydraulic, rulecheck, bom, labor,
    proposal, submittal). Closes when the job reaches
    status='completed' or 'failed'.

    Editor consumers can use EventSource to spawn Pascal nodes into
    the viewport as each stage lands — walls first, then rooms, then
    heads, then pipes.
    """
    if job_id not in _JOBS:
        raise HTTPException(404, "no such job")
    from fastapi.responses import StreamingResponse  # local import ok

    async def _gen():
        job = _JOBS[job_id]
        job.setdefault("events", [])
        job.setdefault("event_condition", asyncio.Condition())
        cursor = 0
        yield f"event: hello\ndata: {json.dumps({'job_id': job_id})}\n\n"
        while True:
            # Emit any events we haven't emitted yet.
            while cursor < len(job["events"]):
                ev = job["events"][cursor]
                cursor += 1
                yield f"data: {json.dumps(ev)}\n\n"
            status = job.get("status")
            if status in ("completed", "failed"):
                # Drain one more time in case a final event landed
                # between the loop check and the condition notify.
                while cursor < len(job["events"]):
                    ev = job["events"][cursor]
                    cursor += 1
                    yield f"data: {json.dumps(ev)}\n\n"
                yield f"event: end\ndata: {json.dumps({'status': status})}\n\n"
                return
            # Wait for another event or a status change (5 s keepalive).
            try:
                async with job["event_condition"]:
                    await asyncio.wait_for(
                        job["event_condition"].wait(), timeout=5,
                    )
            except asyncio.TimeoutError:
                yield ": keepalive\n\n"

    return StreamingResponse(
        _gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # disable nginx buffering
        },
    )


@app.get("/projects/{project_id}/proposal.json")
async def get_proposal_json(project_id: str) -> JSONResponse:
    p = _safe_project_dir(project_id) / "deliverables" / "proposal.json"
    if not p.exists():
        raise HTTPException(404, "proposal not generated yet")
    return JSONResponse(json.loads(p.read_text(encoding="utf-8")))


@app.get("/projects/{project_id}/design.json")
async def get_design_json(project_id: str) -> JSONResponse:
    p = _safe_project_dir(project_id) / "deliverables" / "design.json"
    if not p.exists():
        raise HTTPException(404, "design not generated yet")
    return JSONResponse(json.loads(p.read_text(encoding="utf-8")))


@app.get("/projects/{project_id}/manifest.json")
async def get_manifest_json(project_id: str) -> JSONResponse:
    p = _safe_project_dir(project_id) / "deliverables" / "manifest.json"
    if not p.exists():
        raise HTTPException(404, "manifest not generated yet")
    return JSONResponse(json.loads(p.read_text(encoding="utf-8")))


def _design_file(project_id: str) -> Path:
    return _safe_project_dir(project_id) / "deliverables" / "design.json"


def _load_design(project_id: str):
    p = _design_file(project_id)
    if not p.exists():
        raise HTTPException(404, "design not generated yet")
    orch = _orchestrator()
    if not orch:
        raise HTTPException(500, "orchestrator not loaded")
    return orch.Design.model_validate(json.loads(p.read_text(encoding="utf-8")))


def _write_design(project_id: str, design: Any) -> None:
    p = _design_file(project_id)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(
        json.dumps(design.model_dump(), indent=2, default=str),
        encoding="utf-8",
    )


@app.post("/projects/{project_id}/validate")
async def validate_design(project_id: str, request: Request) -> dict[str, Any]:
    _require_api_key(request)
    design = _load_design(project_id)
    orch = _orchestrator()
    if not orch:
        raise HTTPException(500, "orchestrator not loaded")
    violations = orch.RULECHECK.check_design(design)
    out = _safe_project_dir(project_id) / "deliverables" / "violations.json"
    out.write_text(
        json.dumps([v.model_dump() for v in violations], indent=2),
        encoding="utf-8",
    )
    return {
        "project_id": project_id,
        "issues": [i.model_dump() for i in design.issues],
        "violations": [v.model_dump() for v in violations],
        "blocking": any(i.severity == "blocking" for i in design.issues),
    }


@app.post("/projects/{project_id}/calculate")
async def calculate_design(
    project_id: str,
    request: Request,
    body: dict[str, Any] | None = None,
) -> dict[str, Any]:
    _require_api_key(request)
    design = _load_design(project_id)
    orch = _orchestrator()
    if not orch:
        raise HTTPException(500, "orchestrator not loaded")
    body = body or {}
    supply = orch.FlowTestData.model_validate(body.get("supply")) if body.get("supply") else orch._default_supply()
    design.calculation = {
        "systems": [],
        "unsupported": [{
            "code": "LOOP_GRID_UNSUPPORTED",
            "severity": "warning",
            "message": (
                "Loop/grid hydraulic solving is not supported in Internal Alpha; "
                "tree systems only."
            ),
        }],
    }
    for system in design.systems:
        hazard = str(body.get("hazard") or orch._system_hazard(design.building, system))
        system.hydraulic = orch.HYDRAULIC.calc_system(system, supply, hazard)
        design.calculation["systems"].append({
            "id": system.id,
            "hazard": hazard,
            "hydraulic": system.hydraulic.model_dump(),
        })
    report = {
        "project_id": project_id,
        "calculation": design.calculation,
    }
    out = _safe_project_dir(project_id) / "deliverables" / "hydraulic_report.json"
    out.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
    design.deliverables.files["hydraulic_report"] = str(out)
    _write_design(project_id, design)
    return report


@app.get("/projects/{project_id}/deliverable/{name}")
async def get_deliverable(project_id: str, name: str):
    if Path(name).name != name:
        raise HTTPException(404, "deliverable not found")
    deliverables = (_safe_project_dir(project_id) / "deliverables").resolve()
    p = (deliverables / name).resolve()
    if deliverables not in p.parents or not p.exists():
        raise HTTPException(404, "deliverable not found")
    return FileResponse(p)


# ── OpenSCAD runtime — real parametric catalog renders ────────────────

@app.get("/catalog/openscad/status")
async def catalog_openscad_status() -> dict[str, Any]:
    """Report whether the OpenSCAD binary was located + cache stats."""
    rt = _get_scad()
    if rt is None:
        return {"available": False, "binary": None, "cache_dir": None}
    cache_dir = rt._cache_dir  # type: ignore[attr-defined]
    hits = list(cache_dir.glob("*.glb")) if cache_dir.is_dir() else []
    return {
        "available": rt.available,
        "binary": rt._bin,  # type: ignore[attr-defined]
        "cache_dir": str(cache_dir),
        "cache_entries": len(hits),
    }


@app.post("/catalog/openscad/render")
async def catalog_openscad_render(body: dict[str, Any]) -> dict[str, Any]:
    """Render a SCAD file with the given parameters.

    Body::
        {"scad": "valve_globe", "params": {"size_in": 4}}

    Returns the cache-relative URL of the rendered GLB.
    """
    rt = _get_scad()
    if rt is None:
        raise HTTPException(500, "openscad runtime unavailable")
    name = str(body.get("scad", "")).strip()
    if not name or "/" in name or "\\" in name or ".." in name:
        raise HTTPException(400, "invalid scad name")
    if not name.endswith(".scad"):
        name = f"{name}.scad"
    scad_dir = (
        Path(__file__).resolve().parents[1]
        / "halofire-catalog" / "authoring" / "scad"
    )
    # Fall back to packages/ tree (where authored SCAD actually live).
    if not (scad_dir / name).is_file():
        scad_dir = (
            Path(__file__).resolve().parents[2]
            / "packages" / "halofire-catalog" / "authoring" / "scad"
        )
    scad_path = scad_dir / name
    if not scad_path.is_file():
        raise HTTPException(404, f"scad file not found: {name}")
    params = body.get("params") or {}
    if not isinstance(params, dict):
        raise HTTPException(400, "params must be an object")
    result = rt.render(scad_path, params=params)
    return {
        "engine": result.engine,
        "cache_hit": result.cache_hit,
        "cache_key": Path(result.path).stem,
        "path": str(result.path),
        "url": f"/catalog/openscad/glb/{Path(result.path).name}",
    }


@app.get("/catalog/openscad/glb/{name}")
async def catalog_openscad_glb(name: str):
    """Serve a cached OpenSCAD-rendered GLB by name."""
    rt = _get_scad()
    if rt is None:
        raise HTTPException(500, "openscad runtime unavailable")
    if Path(name).name != name:
        raise HTTPException(404, "not found")
    cache_dir = rt._cache_dir  # type: ignore[attr-defined]
    p = (cache_dir / name).resolve()
    if cache_dir.resolve() not in p.parents or not p.is_file():
        # Pre-baked fallback lookup.
        fallback = (
            Path(__file__).resolve().parents[2]
            / "packages" / "halofire-catalog" / "assets" / "glb" / name
        )
        if fallback.is_file():
            return FileResponse(fallback)
        raise HTTPException(404, "not found")
    return FileResponse(p)


# ── Quick bid ────────────────────────────────────────────────────────

@app.post("/quickbid")
async def quickbid(body: dict[str, Any], request: Request) -> dict[str, Any]:
    """60-second quick-bid estimator."""
    _require_api_key(request)
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


@app.post("/intake/dispatch")
async def intake_dispatch(
    body: dict[str, Any], request: Request,
) -> dict[str, Any]:
    """Dispatch the pipeline against a file ALREADY on this server.

    This is a dev-local path that lets the Studio's AutoDesignPanel
    point at `E:/ClaudeBot/HaloFireBidDocs/...` without streaming
    173 MB through a browser upload. Production swaps for a
    signed-URL-with-scoped-access pattern.
    """
    _require_api_key(request)
    project_id = _safe_project_id(str(body.get("project_id", "demo")))
    server_path = str(body.get("server_path") or "")
    if not server_path:
        raise HTTPException(400, "server_path required")
    path = Path(server_path)
    if not path.exists() or not path.is_file():
        raise HTTPException(404, f"file not found: {server_path}")

    # Honest dev-local allowlist — only project bid-docs tree today.
    # Production must enforce strict per-project path scoping.
    allow_roots = [
        Path(r"E:/ClaudeBot/HaloFireBidDocs").resolve(),
        _DATA_ROOT.resolve(),
    ]
    resolved = path.resolve()
    if not any(
        str(resolved).startswith(str(root)) for root in allow_roots
    ):
        raise HTTPException(
            403, f"path outside allowlist: {resolved}",
        )

    # Kick off the same async job the /intake/upload path uses.
    job_id = str(uuid.uuid4())
    _JOBS[job_id] = {
        "job_id": job_id,
        "project_id": project_id,
        "file": str(path),
        "bytes": path.stat().st_size,
        "status": "queued",
        "percent": 0,
        "steps_complete": [],
        "error": None,
        "summary": None,
    }
    asyncio.create_task(
        _run_job(job_id, str(path), project_id, "pipeline"),
    )
    return {
        "job_id": job_id,
        "project_id": project_id,
        "file": path.name,
        "bytes": path.stat().st_size,
        "mode": "pipeline",
        "status": "queued",
        "poll_url": f"/intake/status/{job_id}",
    }


@app.post("/building/generate")
async def generate_building(
    body: dict[str, Any], request: Request,
) -> dict[str, Any]:
    """Phase J — procedurally generate a Building + GLB shell.

    The viewport polls /projects/{id}/building_shell.glb afterwards
    to render the synthetic building. Honest per §13: output is
    always marked synthesized=True.
    """
    _require_api_key(request)
    project_id = _safe_project_id(str(body.get("project_id", "demo")))
    proj_dir = _safe_project_dir(project_id) / "deliverables"
    # Import the typed generator
    cad_root = Path(__file__).resolve().parents[1] / "halofire-cad"
    if str(cad_root) not in sys.path:
        sys.path.insert(0, str(cad_root))
    import importlib.util

    def _load(name: str, rel: str):
        spec = importlib.util.spec_from_file_location(name, cad_root / rel)
        if spec is None or spec.loader is None:
            raise HTTPException(500, f"cannot load {rel}")
        m = importlib.util.module_from_spec(spec)
        sys.modules[name] = m
        spec.loader.exec_module(m)
        return m

    bg = _load("hf_bg_rest", "agents/14-building-gen/agent.py")
    glb = _load("hf_bg_glb_rest", "agents/14-building-gen/glb.py")

    try:
        spec = bg._default_residential_spec(
            total_sqft=float(body.get("total_sqft_target", 100000)),
            stories=int(body.get("stories", 4)),
            garage_levels=int(body.get("garage_levels", 2)),
        )
        spec.project_id = project_id
        spec.aspect_ratio = float(body.get("aspect_ratio", 1.5))
        bldg = bg.generate_building(spec)
    except Exception as e:
        raise HTTPException(400, f"generate failed: {e}")

    proj_dir.mkdir(parents=True, exist_ok=True)
    bldg_path = proj_dir / "building_synthetic.json"
    bldg_path.write_text(
        bldg.model_dump_json(indent=2), encoding="utf-8",
    )
    glb_path = proj_dir / "building_shell.glb"
    try:
        # Studio users want the pretty render (doors + windows cut
        # out). Slow but the request is user-initiated, not per-test.
        glb.building_to_glb(bldg, glb_path, with_openings=True)
    except Exception as e:
        glb_path_str = ""
        glb_error = str(e)
    else:
        glb_path_str = f"/projects/{project_id}/building_shell.glb"
        glb_error = None

    return {
        "project_id": project_id,
        "levels": len(bldg.levels),
        "total_sqft": bldg.total_sqft,
        "footprint_m": bldg.metadata.get("footprint_m", {}),
        "synthesized": True,
        "building_json": f"/projects/{project_id}/building_synthetic.json",
        "glb_url": glb_path_str,
        "glb_error": glb_error,
    }


@app.get("/projects/{project_id}/building_shell.glb")
async def get_building_shell(project_id: str, request: Request):
    _require_api_key(request)
    project_id = _safe_project_id(project_id)
    proj_dir = _safe_project_dir(project_id) / "deliverables"
    path = proj_dir / "building_shell.glb"
    if not path.exists():
        raise HTTPException(404, "building shell not generated yet")
    return FileResponse(path, media_type="model/gltf-binary")


@app.get("/projects/{project_id}/building_synthetic.json")
async def get_building_synthetic(project_id: str, request: Request):
    _require_api_key(request)
    project_id = _safe_project_id(project_id)
    proj_dir = _safe_project_dir(project_id) / "deliverables"
    path = proj_dir / "building_synthetic.json"
    if not path.exists():
        raise HTTPException(404, "synthetic building not generated yet")
    return JSONResponse(json.loads(path.read_text(encoding="utf-8")))


@app.post("/codex/run")
async def codex_run(body: dict[str, Any], request: Request) -> dict[str, Any]:
    """Browser-side codex proxy. Forwards to local codex CLI on the server."""
    _require_api_key(request)
    # TODO M1 week 6: subprocess-based codex invocation with proper sanitization
    _ = body
    return {
        "backend": "codex",
        "text": "codex bridge not yet wired — M1 week 6",
    }


# ── Entrypoint for uvicorn ──────────────────────────────────────────────────


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("HALOPENCLAW_PORT", "18080"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)

# Phase H — SAM 3.1 + Per-Part Agent Profiler (LandScout pattern)

**Goal:** every SKU in `catalog.json` has a real, validated 3D mesh
derived from its actual manufacturer cut sheet / product photo,
not a crude parametric OpenSCAD approximation. Each mesh is
produced by an autonomous agent pipeline that runs once per SKU
and writes its provenance.

**Runtime:** dev routes LLM calls through HAL V3 hub at
`http://127.0.0.1:9000`. Production ships its own OpenClaw sidecar.
Architecture abstract via a `LLMClient` protocol so the swap is a
config change.

## Why this matters

Current state: 192 GLBs rendered from my parametric SCAD files.
Many are crude cylinders + deflector disks that look nothing like
the actual manufacturer part. For a pro CAD tool that goes into a
signed bid submittal, that's not acceptable.

SAM 3.1 lets us start from the real product photo (already on disk
in 10 of the cut sheets; the rest extract from the cut_sheet_url)
and produce geometry that matches. LandScout's pattern shows how to
orchestrate that reliably.

## Agent pipeline (LandScout pattern, per-SKU)

```
┌────────────────────────────────────────────────────────────────┐
│  catalog_enrichment.py (orchestrator — resumable, idempotent) │
│  watches catalog.json for SKUs needing enrichment              │
└─┬──────────────────────────────────────────────────────────────┘
  │
  ▼ per SKU
  ┌──────────────────────────────────────────────────────────┐
  │ 1. intake_agent                                          │
  │    - read cut_sheet PDF (local or fetch from URL)        │
  │    - extract product photos via pdfplumber / PyMuPDF     │
  │    - extract spec table text                             │
  │    - OUTPUT: raw_profile.json                            │
  └──────────────────────────────────────────────────────────┘
  ┌──────────────────────────────────────────────────────────┐
  │ 2. grounding_agent (LLM: Gemma via HAL)                  │
  │    - prompt: "Given this spec (kind=pendent_head,        │
  │      K=5.6, body_dia=0.95in), where in the photo is the  │
  │      part? Return bbox [x0,y0,x1,y1] normalized."        │
  │    - OUTPUT: grounding_bbox.json + confidence            │
  └──────────────────────────────────────────────────────────┘
  ┌──────────────────────────────────────────────────────────┐
  │ 3. sam_segment_agent (HTTP → SAM sidecar)                │
  │    - POST {image, bbox} → /segment                       │
  │    - OUTPUT: masks.png + masks.json (one or more)        │
  │    - respects landscout SAM rules: NEVER auto-mode;      │
  │      always grounded; reject wash-frame masks            │
  └──────────────────────────────────────────────────────────┘
  ┌──────────────────────────────────────────────────────────┐
  │ 4. mask_validator_agent (deterministic, no LLM)          │
  │    - check mask fits grounded bbox                       │
  │    - check mask aspect ratio vs spec dims                │
  │    - check mask area ≥ threshold (not noise)             │
  │    - check mask isn't implausibly larger than expected   │
  │    - OUTPUT: validation_result {ok|reject, reasons[]}    │
  └──────────────────────────────────────────────────────────┘
  ┌──────────────────────────────────────────────────────────┐
  │ 5. geometry_agent (deterministic)                        │
  │    - for symmetric parts (heads, valves, couplings):     │
  │      trace mask silhouette → axis → axisymmetric revolve │
  │    - for non-symmetric (tees, elbows, valves w/ handles):│
  │      require 2+ views; merge via voxel carving OR        │
  │      escalate to Claude for shape-reasoning              │
  │    - OUTPUT: mesh.obj                                    │
  └──────────────────────────────────────────────────────────┘
  ┌──────────────────────────────────────────────────────────┐
  │ 6. glb_exporter_agent                                    │
  │    - trimesh load OBJ → export GLB                       │
  │    - writes packages/halofire-catalog/assets/glb/{sku}.glb│
  │    - version-stamps filename (sku.v{n}.glb) so failed    │
  │      attempts are preserved for review                   │
  └──────────────────────────────────────────────────────────┘
  ┌──────────────────────────────────────────────────────────┐
  │ 7. profile_enricher_agent                                │
  │    - aggregate outputs 1-6 into enrichment record        │
  │    - write packages/halofire-catalog/enriched.json (one  │
  │      entry per SKU, with provenance per field)           │
  │    - status: validated | rejected | needs_review         │
  └──────────────────────────────────────────────────────────┘
  ┌──────────────────────────────────────────────────────────┐
  │ If ANY step fails or validation rejects:                 │
  │ 8. escalation_agent (LLM: Claude via HAL)                │
  │    - prompt includes all intermediate outputs            │
  │    - Claude decides: retry with different settings, use  │
  │      crude SCAD fallback, or flag for human review       │
  │    - result written back into enriched.json              │
  └──────────────────────────────────────────────────────────┘
```

## HAL V3 client (the "LLM abstraction layer")

New file: `services/halopenclaw-gateway/hal_client.py`

```python
class LLMClient(Protocol):
    async def chat(self, prompt: str, system: str | None,
                   model: str = "auto", max_tokens: int = 2048) -> str:
        ...

class HALV3Client(LLMClient):
    """Routes to HAL V3 hub at env HAL_BASE_URL (default :9000)."""
    # POST /runtime/chat/stream (SSE)
    # model="auto" → hub routes gemma-local vs claude-cloud

class OpenClawDirectClient(LLMClient):
    """Direct to OpenClaw :18789 (future, when halofire ships its own)."""
    # POST /v1/chat/completions with Bearer hal-local-canvas
```

Env-driven factory picks one. Dev: `HAL_BASE_URL=http://127.0.0.1:9000`.
Prod (later): `OPENCLAW_BASE_URL=http://127.0.0.1:18789` bundled
with the Tauri desktop.

## SAM 3.1 sidecar

New service: `services/halofire-sam/`

- FastAPI on `:18081` (adjacent to halopenclaw-gateway :18080)
- Wraps Meta SAM 2.1 / SAM 3.1 via Hugging Face (`facebook/sam2-hiera-large`)
- GPU inference on user's RTX 4090 (CLAUDE.md confirms available) via
  `mcp__huggingface-skills__huggingface-gradio` pattern OR direct torch
- Endpoints:
  - `POST /segment` — `{image_b64, bbox?, prompt?}` → `{masks: [{png_b64, iou, area, bbox}]}`
  - `GET /health`
  - `POST /warmup` — preload weights
- Respects landscout-guided-sam-review rules:
  - Always requires grounding; no open-ended auto mode unless explicit flag
  - Returns mask metadata for the validator agent
- Hugging Face weights cached locally; first run downloads, subsequent
  runs warm in <5s

## Orchestrator

`services/halopenclaw-gateway/catalog_enrichment.py`

- Entrypoint: `python -m gateway.catalog_enrichment --mode=full|incremental|sku=<id>`
- Scans `catalog.json` + compares to `enriched.json`
- Per-SKU status file `data/enrichment_jobs/{sku}.json` for idempotency
  (restart resumes at last successful agent step)
- Dispatches steps 1-7; on failure routes to 8
- Rate-limits parallelism to avoid SAM sidecar thrashing
  (SAM inference is ~2-5s/image on 4090)
- Writes audit log `data/enrichment_audit.jsonl` — one line per agent call

## UI surface (after Phase G lands)

**Catalog panel** extensions:
- Per-SKU thumbnail from new real GLB
- Badge: `validated` (green), `needs_review` (amber), `rejected` (red),
  `not_yet_run` (grey)
- Click → side panel with: source photo, SAM mask overlay, enrichment
  log, "re-run" button
- Rejected SKUs show the crude SCAD render as fallback with a visible
  "accuracy: low" stamp

## Tests

- Unit: each agent's pure-function steps
- Integration: per-kind golden — for 1 known head + 1 fitting + 1 valve,
  full pipeline produces a mesh whose bounding box matches manifest
  dims within 10%
- Regression: `scripts/render_catalog_glbs.py` still works (enrichment
  does NOT replace the crude fallback — both coexist, enriched wins
  when validated)

## Dependencies

- `pdfplumber` or `pymupdf` — already likely in repo (for title-block OCR)
- `segment-anything-2` / `sam2` via HF — new; big weights (~2.5GB)
- `torch` with CUDA — user has 4090, confirm CUDA version
- `trimesh` — already added (D.5)
- `opencv-python` — for silhouette tracing

## Phase split

- **H.1 — HAL V3 client adapter** (2-3 hours agent time)
- **H.2 — SAM 3.1 sidecar** (4-6 hours; model download + wrap + test)
- **H.3 — Per-part agent pipeline** (8-12 hours; 7 agents + orchestrator)
- **H.4 — UI surface** (4-6 hours; extends Catalog panel; depends on Phase G)

H.1 + H.2 can run in parallel. H.3 depends on both. H.4 depends on
H.3 + Phase G.

## Non-goals

- Multi-view photogrammetry for arbitrary geometry (too much scope;
  axisymmetric + voxel-carve-from-2-views covers 80% of fire-
  protection parts)
- Texture/material transfer (geometry first; PBR materials later)
- Live edit of generated meshes in the viewport (user triggers
  re-run, doesn't sculpt)

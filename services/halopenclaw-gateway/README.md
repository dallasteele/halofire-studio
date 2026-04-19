# halopenclaw-gateway

Halofire Studio's tool-calling service. Exposes design primitives as
JSON-RPC 2.0 tools to any AI agent (Claude, Codex, future Gemini) and
REST endpoints to the browser-side studio.

## Ports

- **Dev:** `18790`
- **Prod:** behind nginx at `gateway.rankempire.io/halofire/*`

## Run (dev)

```bash
cd services/halopenclaw-gateway
python -m venv .venv
source .venv/bin/activate   # or .venv\Scripts\activate on Windows
pip install -r requirements.txt
uvicorn main:app --reload --port 18790
```

Healthcheck:
```bash
curl http://localhost:18790/health
```

List tools:
```bash
curl -X POST http://localhost:18790/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Call a tool:
```bash
curl -X POST http://localhost:18790/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"halofire_validate",
                 "arguments":{"mode":"shell","scene":{}}}}'
```

## Tools (M1 stubs, expanding through M2-M4)

| Tool | Modes | Status |
|---|---|---|
| `halofire_validate` | nfpa13, shell, hydraulic, completeness | stub |
| `halofire_ingest` | pdf, ifc, dwg | stub (M2 wires 4-layer PDF pipeline) |
| `halofire_place_head` | manual, auto_grid, at_coords | stub |
| `halofire_route_pipe` | manual_segment, auto_tree, auto_loop, auto_grid | stub |
| `halofire_calc` | hazen_williams, density_area, remote_area, supply_check | stub |
| `halofire_export` | pdf_plan, dxf, ifc, cut_sheets, proposal, sheet_set | stub |

## PDF takeoff pipeline (M2)

Four layers, server-side:

1. **`pdf_pipeline/vector.py`** — pdfplumber vector extraction (free)
2. **`pdf_pipeline/raster.py`** — opencv Hough + template match (free)
3. **`pdf_pipeline/cubicasa.py`** — CubiCasa5k pretrained segmentation (free, self-hosted)
4. **`pdf_pipeline/claude_vision.py`** — Claude Vision semantic labeling (OAuth, ~$1-5/bid)

## Architecture

```
Halofire Studio (browser)
  └─→ /mcp  (JSON-RPC 2.0)       → tools dispatcher → tool implementations
  └─→ /takeoff/*   (REST)         → PDF pipeline + job queue
  └─→ /codex/run   (REST)         → codex CLI proxy (server-side)

Claude (tool-use loop)
  └─→ /mcp  (JSON-RPC 2.0)       → same tools

Codex CLI (server-side)
  └─→ /mcp                       → same tools (via halopenclaw-client)
```

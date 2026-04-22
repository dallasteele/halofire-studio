# halofire-sam

Segment Anything sidecar for halofire-studio. FastAPI on `:18081`.
Phase H.2 of `docs/PHASE_H_PLAN.md`.

Called by the H.3 per-part agent pipeline (`sam_segment_agent`) to
segment product photos from manufacturer cut sheets. Enforces the
rules from `skills/landscout-guided-sam-review/SKILL.md`:
grounded-only by default, wash-frame rejection, no silent auto-retry
on failure.

## Setup

```bash
cd services/halofire-sam
C:/Python312/python.exe -m venv .venv
.venv/Scripts/pip install -r requirements.txt
```

If `torch` isn't already CUDA-enabled on your box:

```bash
.venv/Scripts/pip install torch --index-url https://download.pytorch.org/whl/cu126
```

Copy `.env.example` to `.env` if you want to override defaults
(model, device, cache dir).

## Run

```bash
.venv/Scripts/python -m uvicorn main:app --port 18081
```

First `/warmup` (or first `/segment`) downloads SAM 2.1 weights
(~2.5 GB) into `.cache/`. Subsequent boots warm in ~5s.

Quick smoke:

```bash
curl http://127.0.0.1:18081/health
curl -X POST http://127.0.0.1:18081/warmup
```

## API

### `POST /segment`
```json
{
  "image_b64": "iVBORw0K...",
  "bbox": [0.30, 0.30, 0.70, 0.75],
  "points": [[0.5, 0.5, 1]],
  "multimask": true,
  "require_grounded": true
}
```
Either `bbox` or `points` is required unless `require_grounded=false`
(discouraged — violates the landscout rules).

Response:
```json
{
  "masks": [
    {
      "png_b64": "...",
      "iou": 0.948,
      "area_px": 15169,
      "bbox": [161, 180, 353, 366],
      "aspect": 1.03
    }
  ],
  "model": "facebook/sam2.1-hiera-large",
  "inference_ms": 368,
  "rejected": []
}
```

Masks sorted by predicted IoU desc. Masks >90% of frame or <100px
are dropped and reported under `rejected` (never returned).

### `POST /warmup`
Preloads weights. Returns `{model, device, load_ms}`.

### `GET /health`
```json
{
  "ok": true,
  "model_loaded": true,
  "model": "facebook/sam2.1-hiera-large",
  "device": "cuda",
  "gpu_mem_free_mb": 22331
}
```

## Model cascade

Tried in order; first success wins:
1. `facebook/sam2.1-hiera-large` — SAM 2.1 (preferred)
2. `facebook/sam2-hiera-large` — SAM 2.0 fallback
3. `facebook/sam-vit-huge` — original SAM last-resort

SAM 3.1 is not yet on the HF Hub (as of 2026-04-22). When it ships,
bump `MODEL_ID` in `.env` — the runner already detects the family.

## Audit log

Every `/segment` call appends one JSON line to
`data/sam_requests.jsonl` at repo root:

```json
{"ts":1713822311.2,"img_hash":"a1b2c3...","img_size":[512,512],
 "bbox":[0.3,0.3,0.7,0.75],"points":null,"require_grounded":true,
 "model":"facebook/sam2.1-hiera-large","device":"cuda",
 "inference_ms":368,"masks_returned":3,"masks_rejected":[],
 "top_iou":0.948}
```

Matches LandScout's "verify against source" discipline — the
mask_validator_agent (H.3) can replay any decision from this log.

## Tests

```bash
# Offline (no weights required) — validates 422/400 paths
C:/Python312/python.exe -m pytest tests/ -v

# Full, including real SAM inference on the fixture
RUN_SAM=1 C:/Python312/python.exe -m pytest tests/ -v
```

Fixture `tests/fixtures/pendent_head.jpg` is a synthetic sprinkler
head image (512x512). On CUDA the full test completes in ~13s
including model load.

## Known limits

* SAM 2.1 `Sam2Processor.post_process_masks` does not accept
  `reshaped_input_sizes` (differs from SAM 1). Runner handles the
  split internally; don't pass that arg.
* GPU memory: SAM 2.1 large uses ~3 GB. Fits comfortably on a 4090.
* First boot downloads ~2.5 GB into `.cache/` — gitignored.

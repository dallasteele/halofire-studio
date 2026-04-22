# Phase H.2 — SAM Sidecar (halofire-sam)

**Status:** landed 2026-04-22. 6/6 tests green (5 offline + 1 full
inference with `RUN_SAM=1`). Running on CUDA via user's RTX 4090.

## Model chosen

`facebook/sam2.1-hiera-large` via Hugging Face `transformers` 5.2.

### Why

* **SAM 2.1 is the latest open-weight SAM on the Hub** as of
  2026-04-22. "SAM 3.1" is not a published checkpoint yet — the
  original spec hedged on naming, so we treat `MODEL_ID` in `.env`
  as the swap point.
* **Transformers-only path** avoids the `sam2` pip package, which
  pins torch/CUDA versions that fight our installed torch 2.11+cu126.
* **Automatic cascade:** runner tries SAM 2.1 → SAM 2.0 → SAM 1
  (vit-huge) so a transformers regression doesn't brick the service.

### Measured on this box
* Device: `cuda` (RTX 4090)
* First-boot load: 21.6s (weights already cached after this)
* Inference on 512×512 fixture + bbox prompt: **368 ms**
* Top-candidate IoU on the sprinkler-head fixture: **0.948**

## Install path

```bash
cd services/halofire-sam
C:/Python312/python.exe -m venv .venv
.venv/Scripts/pip install -r requirements.txt   # ~2 minutes
.venv/Scripts/python -m uvicorn main:app --port 18081
```

First `/warmup` or `/segment` triggers a ~2.5 GB weight download
into `services/halofire-sam/.cache/` (gitignored). A
progress-visible log line (`Loading SAM weights repo=...`) fires
before the download so the caller sees activity.

Torch is pre-installed on this workstation. Contributors without
CUDA should install:
```bash
pip install torch --index-url https://download.pytorch.org/whl/cu126
```
The service degrades gracefully to CPU if CUDA isn't available
(inference moves from ~400ms to ~15-30s on CPU).

## API surface (shipped)

| Method | Path | Purpose |
|---|---|---|
| POST | `/segment` | grounded segmentation; returns ranked masks |
| POST | `/warmup` | preload weights for quick first inference |
| GET  | `/health` | liveness + model/device/GPU-free-memory |

### Example (curl with a small PNG)
```bash
B64=$(base64 -w0 tests/fixtures/pendent_head.jpg)
curl -s -X POST http://127.0.0.1:18081/segment \
  -H 'Content-Type: application/json' \
  -d "{\"image_b64\":\"$B64\",\"bbox\":[0.30,0.30,0.70,0.75]}" | jq '.masks[0] | {iou, area_px, bbox}'
```

Sample response:
```json
{"iou": 0.948, "area_px": 15169, "bbox": [161, 180, 353, 366]}
```

## LandScout rules enforced

From `skills/landscout-guided-sam-review/SKILL.md`:

1. **Grounded-only by default.** Request without `bbox` or `points`
   (and `require_grounded=true` default) returns HTTP 422 —
   **no open-ended auto mode**.
2. **Wash-frame rejection.** Any candidate covering ≥90% of the
   image is dropped and reported under `response.rejected`.
3. **Noise rejection.** Any candidate <100 px is dropped.
4. **IoU-sorted output.** Highest-predicted-IoU mask first.
5. **Audit trail.** Every request (success or failure) appends one
   JSON line to `data/sam_requests.jsonl` including image hash,
   bbox, model, inference time, and rejection diagnostics.
6. **No silent retry on SAM failure.** 500 responses surface the
   error for the caller (the H.3 `escalation_agent`) to decide —
   they do not retry internally or fall back to auto mode.

## Known issues / gotchas

* `Sam2Processor.post_process_masks` in transformers 5.2 requires an
  explicit `mask_threshold` (defaults to `None` and then errors with
  `TypeError: '>' not supported between Tensor and NoneType`). Fixed
  in `sam_runner.py` by passing `mask_threshold=0.0`.
* `Sam2Processor.post_process_masks` does **not** accept
  `reshaped_input_sizes`; the runner splits SAM1 vs SAM2 paths.
* SAM 2 warns `"using a model of type sam2_video to instantiate a
  model of type sam2"` on load. This is expected — checkpoint shares
  the static-image subset of the SAM2-video architecture, and
  segmentation output is correct.
* HF emits an `HF_TOKEN` unauthenticated-rate-limit warning. Harmless
  for read-only public weights; set `HF_TOKEN` if you hit 429.

## Files landed

```
services/halofire-sam/
├── main.py                         FastAPI on :18081
├── sam_runner.py                   SAM loader + inference wrapper
├── requirements.txt
├── README.md
├── .env.example
├── .gitignore                      (.cache/, fixture binaries)
└── tests/
    ├── __init__.py
    ├── test_segment.py             6 tests, 1 gated on RUN_SAM=1
    └── fixtures/
        └── pendent_head.jpg        512x512 synthetic sprinkler head
```

## Next (H.3)

The per-part agent pipeline (`catalog_enrichment.py` +
`sam_segment_agent`) will POST real cut-sheet photos to this service.
H.3 will:
1. Add the grounding agent that produces the `bbox` this service
   requires (Gemma via HAL V3).
2. Add the `mask_validator_agent` that consumes `data/sam_requests.jsonl`
   + the candidate masks and validates against the expected spec dims.
3. Gate promotion of a new mesh on validator approval.

Nothing in H.3 needs to change this sidecar's API — the contract is
frozen.

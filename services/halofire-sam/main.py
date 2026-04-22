"""halofire-sam — Segment Anything sidecar for halofire-studio.

FastAPI service on :18081. Called by the H.3 per-part agent pipeline
(`sam_segment_agent`) to segment product photos from manufacturer
cut sheets.

Follows the landscout-guided-sam-review skill's rules:
  * Grounded-only by default — bbox or points required
  * Reject wash-frame masks (>90% of image)
  * Reject noise masks (<100 px)
  * Masks returned sorted by predicted IoU
  * Every request logged to data/sam_requests.jsonl

Run:
    cd services/halofire-sam
    C:/Python312/python.exe -m uvicorn main:app --port 18081
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from pydantic import BaseModel, Field

from sam_runner import SamRunner, encode_mask_png_b64

# ---- config --------------------------------------------------------------
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("halofire_sam")

SERVICE_DIR = Path(__file__).resolve().parent
# Repo root = services/halofire-sam/../..
REPO_ROOT = SERVICE_DIR.parent.parent

MODEL_ID = os.getenv("MODEL_ID") or None
DEVICE = os.getenv("DEVICE", "auto")
WEIGHT_CACHE_DIR = Path(os.getenv("WEIGHT_CACHE_DIR") or (SERVICE_DIR / ".cache"))
WEIGHT_CACHE_DIR = WEIGHT_CACHE_DIR if WEIGHT_CACHE_DIR.is_absolute() else (SERVICE_DIR / WEIGHT_CACHE_DIR)
AUDIT_LOG = Path(os.getenv("AUDIT_LOG", "data/sam_requests.jsonl"))
AUDIT_LOG = AUDIT_LOG if AUDIT_LOG.is_absolute() else (REPO_ROOT / AUDIT_LOG)
AUDIT_LOG.parent.mkdir(parents=True, exist_ok=True)

MAX_IMAGE_PIXELS = int(os.getenv("MAX_IMAGE_PIXELS", "33177600"))

# Mask rejection thresholds (landscout rules)
WASH_FRAME_FRACTION = float(os.getenv("WASH_FRAME_FRACTION", "0.90"))
MIN_MASK_AREA_PX = int(os.getenv("MIN_MASK_AREA_PX", "100"))

# ---- runner singleton ----------------------------------------------------
_runner: Optional[SamRunner] = None


def get_runner() -> SamRunner:
    global _runner
    if _runner is None:
        _runner = SamRunner(model_id=MODEL_ID, device=DEVICE, cache_dir=WEIGHT_CACHE_DIR)
    return _runner


# ---- Pydantic schemas ----------------------------------------------------
class SegmentRequest(BaseModel):
    image_b64: str = Field(..., description="Base64-encoded PNG/JPG. Data URL prefix tolerated.")
    bbox: Optional[list[float]] = Field(
        None,
        description="[x0,y0,x1,y1] in normalized [0..1] image coords.",
    )
    points: Optional[list[list[float]]] = Field(
        None,
        description="List of [x,y,label] points. label=1 foreground, 0 background.",
    )
    multimask: bool = True
    require_grounded: bool = True


class MaskPayload(BaseModel):
    png_b64: str
    iou: float
    area_px: int
    bbox: list[int]
    aspect: float


class SegmentResponse(BaseModel):
    masks: list[MaskPayload]
    model: str
    inference_ms: int
    rejected: list[dict]  # diagnostics for dropped masks (landscout audit)


class HealthResponse(BaseModel):
    ok: bool
    model_loaded: bool
    model: Optional[str]
    device: str
    gpu_mem_free_mb: Optional[int]


# ---- app -----------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("halofire-sam starting. cache_dir=%s audit=%s", WEIGHT_CACHE_DIR, AUDIT_LOG)
    yield
    log.info("halofire-sam stopping.")


app = FastAPI(title="halofire-sam", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---- helpers -------------------------------------------------------------
def _decode_image(image_b64: str) -> Image.Image:
    if image_b64.startswith("data:"):
        # strip data URL header
        image_b64 = image_b64.split(",", 1)[-1]
    try:
        raw = base64.b64decode(image_b64, validate=False)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"invalid base64: {e}")
    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"could not decode image: {e}")
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGB")
    elif img.mode == "RGBA":
        img = img.convert("RGB")
    W, H = img.size
    if W * H > MAX_IMAGE_PIXELS:
        raise HTTPException(
            status_code=413,
            detail=f"image too large: {W}x{H} > {MAX_IMAGE_PIXELS} px cap",
        )
    return img


def _sha256_prefix(data: bytes, n: int = 16) -> str:
    return hashlib.sha256(data).hexdigest()[:n]


def _audit(record: dict) -> None:
    try:
        with AUDIT_LOG.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, separators=(",", ":")) + "\n")
    except Exception as e:  # noqa: BLE001
        log.warning("audit write failed: %s", e)


def _validate_prompts(req: SegmentRequest) -> None:
    has_bbox = req.bbox is not None and len(req.bbox) == 4
    has_points = bool(req.points)
    if req.require_grounded and not (has_bbox or has_points):
        raise HTTPException(
            status_code=422,
            detail=(
                "grounded prompt required: supply `bbox` or `points`. "
                "To opt out (discouraged), set require_grounded=false."
            ),
        )
    if has_bbox:
        x0, y0, x1, y1 = req.bbox  # type: ignore[misc]
        if not (0.0 <= x0 < x1 <= 1.0 and 0.0 <= y0 < y1 <= 1.0):
            raise HTTPException(
                status_code=422,
                detail=f"bbox must be normalized [x0,y0,x1,y1] with 0<=x0<x1<=1; got {req.bbox}",
            )


# ---- endpoints -----------------------------------------------------------
@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    r = get_runner()
    return HealthResponse(
        ok=True,
        model_loaded=r.model is not None,
        model=r.loaded_model_id,
        device=r.device,
        gpu_mem_free_mb=r.gpu_mem_free_mb(),
    )


@app.post("/warmup")
def warmup() -> dict:
    r = get_runner()
    t0 = time.time()
    r.load()
    return {
        "ok": True,
        "model": r.loaded_model_id,
        "device": r.device,
        "load_ms": int((time.time() - t0) * 1000),
    }


@app.post("/segment", response_model=SegmentResponse)
def segment(req: SegmentRequest) -> SegmentResponse:
    _validate_prompts(req)

    img = _decode_image(req.image_b64)
    W, H = img.size
    img_bytes_for_hash = img.tobytes()
    img_hash = _sha256_prefix(img_bytes_for_hash)

    runner = get_runner()
    t0 = time.time()
    try:
        results = runner.segment(
            img,
            bbox_norm=req.bbox,
            points_norm=req.points,
            multimask=req.multimask,
        )
    except Exception as e:  # noqa: BLE001
        _audit({
            "ts": time.time(),
            "img_hash": img_hash,
            "bbox": req.bbox,
            "points": req.points,
            "error": str(e),
        })
        # Landscout rule: on SAM failure, escalate — do NOT broadly retry.
        raise HTTPException(status_code=500, detail=f"SAM inference failed: {e}")

    inference_ms = int((time.time() - t0) * 1000)

    # Apply landscout rejection rules.
    img_area = W * H
    kept: list[tuple] = []
    rejected: list[dict] = []
    for r in results:
        frac = r.area_px / img_area if img_area else 0.0
        if frac >= WASH_FRAME_FRACTION:
            rejected.append({"reason": "wash_frame", "area_fraction": round(frac, 3), "iou": r.iou})
            continue
        if r.area_px < MIN_MASK_AREA_PX:
            rejected.append({"reason": "too_small", "area_px": r.area_px, "iou": r.iou})
            continue
        kept.append(r)

    payloads = [
        MaskPayload(
            png_b64=encode_mask_png_b64(r.mask),
            iou=r.iou,
            area_px=r.area_px,
            bbox=list(r.bbox),
            aspect=r.aspect,
        )
        for r in kept
    ]

    _audit({
        "ts": time.time(),
        "img_hash": img_hash,
        "img_size": [W, H],
        "bbox": req.bbox,
        "points": req.points,
        "require_grounded": req.require_grounded,
        "model": runner.loaded_model_id,
        "device": runner.device,
        "inference_ms": inference_ms,
        "masks_returned": len(payloads),
        "masks_rejected": rejected,
        "top_iou": payloads[0].iou if payloads else None,
    })

    return SegmentResponse(
        masks=payloads,
        model=runner.loaded_model_id or "unknown",
        inference_ms=inference_ms,
        rejected=rejected,
    )

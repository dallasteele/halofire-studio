"""Phase A1 — L3 CubiCasa5k wall segmentation.

Replaces L1's over-reading of dimension/annotation linework as "walls"
with a CNN that semantically identifies walls per-pixel.

Credit: CubiCasa5k — Kalervo et al., ECCV 2019
  Paper:  https://arxiv.org/abs/1904.01920v1
  Repo:   https://github.com/CubiCasa/CubiCasa5k
  Weights: 209 MB torch state-dict, downloaded via gdown

Vendored under services/halofire-cad/vendor/CubiCasa5k/ (git clone +
weights download). The weights file is .gitignored; it downloads on
first use via `ensure_weights()`.

Class map (from samples.ipynb):
  Room channel argmax (21 + [0..11]):
    0=Background  1=Outdoor  2=Wall  3=Kitchen  4=Living Room
    5=Bed Room    6=Bath     7=Entry  8=Railing  9=Storage
    10=Garage    11=Undefined
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from cad.logging import get_logger, warn_swallowed  # noqa: E402
from cad.exceptions import IngestError  # noqa: E402

log = get_logger("intake.l3_cubicasa")


VENDOR_DIR = (
    Path(__file__).resolve().parents[2]
    / "vendor" / "CubiCasa5k"
)
WEIGHTS_PATH = VENDOR_DIR / "model_best_val_loss_var.pkl"
WEIGHTS_GDRIVE_ID = "1gRB7ez1e4H7a9Y09lLqRuna0luZO5VRK"

# Per eval.py split: 21 heatmap channels + 12 room classes + 11 icons
ROOM_SPLIT_START = 21
ROOM_SPLIT_END = 33  # exclusive
WALL_ROOM_CLASS = 2  # index within the 12-room split


class CubiCasaNotAvailable(IngestError):
    code = "L3_CUBICASA_UNAVAILABLE"


_MODEL_CACHE: Any = None


def ensure_weights() -> bool:
    """Ensure the weights file exists on disk. Returns True if ready."""
    if WEIGHTS_PATH.exists() and WEIGHTS_PATH.stat().st_size > 100_000_000:
        return True
    try:
        import gdown  # type: ignore
    except ImportError:
        log.warning(
            "hf.l3.gdown_missing",
            extra={"hint": "pip install gdown"},
        )
        return False
    try:
        gdown.download(
            f"https://drive.google.com/uc?id={WEIGHTS_GDRIVE_ID}",
            str(WEIGHTS_PATH), quiet=True,
        )
    except Exception as e:
        warn_swallowed(log, code="L3_WEIGHTS_DOWNLOAD_FAIL", err=e)
        return False
    return WEIGHTS_PATH.exists()


def _load_model():
    """Lazy-load the CubiCasa5k model. Returns None if unavailable."""
    global _MODEL_CACHE
    if _MODEL_CACHE is not None:
        return _MODEL_CACHE

    if not VENDOR_DIR.exists():
        log.warning("hf.l3.vendor_missing",
                    extra={"path": str(VENDOR_DIR)})
        return None
    if not ensure_weights():
        log.warning("hf.l3.weights_missing",
                    extra={"path": str(WEIGHTS_PATH)})
        return None

    try:
        import torch  # type: ignore
    except ImportError:
        log.warning("hf.l3.torch_missing")
        return None

    if str(VENDOR_DIR) not in sys.path:
        sys.path.insert(0, str(VENDOR_DIR))

    try:
        from floortrans.models import get_model  # type: ignore
    except ImportError as e:
        warn_swallowed(log, code="L3_VENDOR_IMPORT_FAIL", err=e)
        return None

    # get_model loads an ImageNet-pretrained backbone via RELATIVE
    # path "floortrans/models/model_1427.pth". chdir into the vendor
    # dir during construction so that relative path resolves.
    import os
    prev_cwd = os.getcwd()
    os.chdir(str(VENDOR_DIR))
    try:
        model = get_model("hg_furukawa_original", 51)
        # Adjust final layer to 44 classes (per eval.py convention)
        model.conv4_ = torch.nn.Conv2d(
            256, 44, bias=True, kernel_size=1,
        )
        model.upsample = torch.nn.ConvTranspose2d(
            44, 44, kernel_size=4, stride=4,
        )
        state = torch.load(
            str(WEIGHTS_PATH), map_location="cpu", weights_only=False,
        )
        model.load_state_dict(state["model_state"], strict=False)
        # Put model in inference mode (no dropout, no BN updates)
        model.train(False)
        _MODEL_CACHE = model
        log.info("hf.l3.model_loaded",
                 extra={"weights": str(WEIGHTS_PATH)})
        return model
    except Exception as e:
        warn_swallowed(log, code="L3_MODEL_LOAD_FAIL", err=e)
        return None
    finally:
        os.chdir(prev_cwd)


def _rasterize_pdf_page(
    pdf_path: str, page_index: int, target_size: int = 512,
) -> np.ndarray | None:
    """Rasterize one PDF page to a target_size×target_size RGB array."""
    try:
        import fitz  # type: ignore
    except ImportError:
        log.warning("hf.l3.pymupdf_missing")
        return None
    try:
        doc = fitz.open(pdf_path)
        if page_index >= doc.page_count:
            doc.close()
            return None
        page = doc.load_page(page_index)
        mat = fitz.Matrix(
            target_size / page.rect.width,
            target_size / page.rect.height,
        )
        pix = page.get_pixmap(matrix=mat, alpha=False)
        arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(
            pix.height, pix.width, 3,
        ).copy()  # writable copy for torch
        doc.close()
        return arr
    except Exception as e:
        warn_swallowed(log, code="L3_RASTERIZE_FAIL", err=e,
                       pdf_path=pdf_path, page_index=page_index)
        return None


def predict_wall_mask(
    pdf_path: str, page_index: int, target_size: int = 512,
) -> np.ndarray | None:
    """Return a binary (target_size×target_size) mask where True = wall.

    Returns None if the model isn't available. Caller falls back to L1.
    """
    model = _load_model()
    if model is None:
        return None

    raster = _rasterize_pdf_page(pdf_path, page_index, target_size)
    if raster is None:
        return None

    try:
        import torch  # type: ignore
    except ImportError:
        return None

    # Normalize to [-1, 1] (typical CubiCasa convention)
    t = torch.from_numpy(raster).permute(2, 0, 1).float().unsqueeze(0)
    t = t / 255.0 * 2.0 - 1.0
    with torch.no_grad():
        y = model(t)
    # y: [1, 44, H, W]. Argmax within the 12-class room split.
    room_logits = y[0, ROOM_SPLIT_START:ROOM_SPLIT_END]  # [12, H, W]
    room_cls = room_logits.argmax(dim=0).numpy()  # [H, W]
    wall_mask = (room_cls == WALL_ROOM_CLASS)
    return wall_mask


def mask_to_wall_polylines(
    mask: np.ndarray, page_w_pt: float, page_h_pt: float,
) -> list[dict[str, float]]:
    """Convert a binary wall mask into line segments in PDF-point space.

    Strategy (deterministic, no extra deps):
      1. Thin the mask to centerlines (cv2.ximgproc.thinning if available)
      2. Hough line detection on the thinned mask
      3. Rescale mask-pixel coords back to PDF points (y-axis flipped
         since PDF origin is bottom-left, raster origin is top-left)
    """
    try:
        import cv2  # type: ignore
    except ImportError:
        log.warning("hf.l3.cv2_missing")
        return []

    h_mask, w_mask = mask.shape
    mask_u8 = (mask.astype(np.uint8)) * 255

    try:
        import cv2.ximgproc as ximgproc  # type: ignore
        thinned = ximgproc.thinning(mask_u8)
    except (ImportError, AttributeError):
        thinned = mask_u8

    lines = cv2.HoughLinesP(
        thinned, 1, np.pi / 180,
        threshold=30,
        minLineLength=max(15, w_mask // 30),
        maxLineGap=5,
    )
    if lines is None:
        return []

    sx = page_w_pt / w_mask
    sy = page_h_pt / h_mask
    walls: list[dict[str, float]] = []
    for seg in lines:
        x0, y0, x1, y1 = seg[0]
        walls.append({
            "x0": float(x0) * sx,
            "y0": page_h_pt - float(y0) * sy,
            "x1": float(x1) * sx,
            "y1": page_h_pt - float(y1) * sy,
        })
    return walls


def predict_room_polygons(
    pdf_path: str, page_index: int, target_size: int = 512,
    min_area_px: int = 400,
) -> list[dict[str, Any]] | None:
    """Return room polygons (list of {polygon_pt, area_pt2, class_name})
    by extracting contours of each non-wall room class in the CubiCasa
    segmentation.

    This bypasses the fragile "polygonize Hough segments into rooms"
    path — CubiCasa already has per-pixel room labels; we just
    contour them.
    """
    model = _load_model()
    if model is None:
        return None

    raster = _rasterize_pdf_page(pdf_path, page_index, target_size)
    if raster is None:
        return None

    try:
        import torch  # type: ignore
        import cv2  # type: ignore
        import fitz  # type: ignore
    except ImportError:
        return None

    t = torch.from_numpy(raster).permute(2, 0, 1).float().unsqueeze(0)
    t = t / 255.0 * 2.0 - 1.0
    with torch.no_grad():
        y = model(t)
    room_logits = y[0, ROOM_SPLIT_START:ROOM_SPLIT_END]
    room_cls = room_logits.argmax(dim=0).numpy().astype(np.uint8)

    # Get PDF page dims for coordinate mapping
    try:
        doc = fitz.open(pdf_path)
        page = doc.load_page(page_index)
        page_w_pt = float(page.rect.width)
        page_h_pt = float(page.rect.height)
        doc.close()
    except Exception:
        return None

    sx = page_w_pt / room_cls.shape[1]
    sy = page_h_pt / room_cls.shape[0]

    # CubiCasa room classes:
    # 0=Background  1=Outdoor  2=Wall  3=Kitchen  4=Living Room
    # 5=Bed Room    6=Bath     7=Entry  8=Railing  9=Storage
    # 10=Garage    11=Undefined
    # We want rooms only: 3–11 (skip Background, Outdoor, Wall)
    ROOM_CLASS_NAMES = {
        3: "kitchen_residential", 4: "living_room", 5: "bedroom",
        6: "bathroom", 7: "vestibule", 8: "corridor",
        9: "storage", 10: "parking_garage", 11: "unknown",
    }
    out: list[dict[str, Any]] = []
    for cls_idx, cls_name in ROOM_CLASS_NAMES.items():
        cls_mask = (room_cls == cls_idx).astype(np.uint8) * 255
        if cls_mask.sum() == 0:
            continue
        contours, _ = cv2.findContours(
            cls_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE,
        )
        for contour in contours:
            area_px = cv2.contourArea(contour)
            if area_px < min_area_px:
                continue
            # Simplify polygon (Douglas-Peucker) to reduce point count
            eps = 0.01 * cv2.arcLength(contour, True)
            simple = cv2.approxPolyDP(contour, eps, True)
            if len(simple) < 3:
                continue
            poly_pt = [
                (float(p[0][0]) * sx, page_h_pt - float(p[0][1]) * sy)
                for p in simple
            ]
            # Close the polygon
            if poly_pt[0] != poly_pt[-1]:
                poly_pt.append(poly_pt[0])
            # area in PDF-pt²
            area_pt2 = float(area_px) * sx * sy
            out.append({
                "polygon_pt": poly_pt,
                "area_pt2": area_pt2,
                "class_name": cls_name,
            })
    return out


def is_available() -> bool:
    """Quick check whether vendor + weights are present.

    Doesn't load the model — just confirms prerequisites.
    """
    return (
        VENDOR_DIR.exists()
        and WEIGHTS_PATH.exists()
        and WEIGHTS_PATH.stat().st_size > 100_000_000
    )

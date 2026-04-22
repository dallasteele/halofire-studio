"""SAM model wrapper for halofire-sam sidecar.

Loads a Segment Anything variant from Hugging Face and exposes a single
`segment()` entry point that takes a PIL image plus grounding prompts
(bbox and/or points) and returns a list of candidate masks with
metadata.

Model selection cascade (first import that succeeds wins):
  1. facebook/sam2.1-hiera-large   (SAM 2.1)
  2. facebook/sam2-hiera-large     (SAM 2.0)
  3. facebook/sam-vit-huge         (original SAM)

Rationale: SAM 2.1 is Meta's latest open-weight release; "SAM 3.1" is
not a published checkpoint on the Hub as of 2026-04-22. If/when it
ships we bump MODEL_ID in `.env`. If the SAM 2 Transformers classes
aren't available (older transformers), we degrade to SAM 1 and log it.
"""
from __future__ import annotations

import io
import logging
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Sequence

import numpy as np
from PIL import Image

log = logging.getLogger("halofire_sam.runner")


# ---- preferred load order ------------------------------------------------
_MODEL_CANDIDATES: tuple[tuple[str, str], ...] = (
    # (hf_repo_id, family)  — family drives which processor/model class to use
    ("facebook/sam2.1-hiera-large", "sam2"),
    ("facebook/sam2-hiera-large",   "sam2"),
    ("facebook/sam-vit-huge",       "sam1"),
)


@dataclass
class MaskResult:
    mask: np.ndarray  # uint8 {0,255}, HxW
    iou: float
    area_px: int
    bbox: tuple[int, int, int, int]
    aspect: float


class SamRunner:
    """Lazy-loading SAM wrapper. Safe to instantiate without GPU (cpu fallback)."""

    def __init__(
        self,
        model_id: Optional[str] = None,
        device: str = "auto",
        cache_dir: Optional[Path] = None,
    ) -> None:
        self.requested_model_id = model_id
        self.device = self._resolve_device(device)
        self.cache_dir = Path(cache_dir) if cache_dir else Path(__file__).parent / ".cache"
        self.cache_dir.mkdir(parents=True, exist_ok=True)

        self.model = None
        self.processor = None
        self.loaded_model_id: Optional[str] = None
        self.family: Optional[str] = None  # "sam2" | "sam1"
        self._load_error: Optional[str] = None

    # ---- device helpers --------------------------------------------------
    @staticmethod
    def _resolve_device(device: str) -> str:
        if device == "auto":
            try:
                import torch

                return "cuda" if torch.cuda.is_available() else "cpu"
            except Exception:
                return "cpu"
        return device

    def gpu_mem_free_mb(self) -> Optional[int]:
        if self.device != "cuda":
            return None
        try:
            import torch

            free, _total = torch.cuda.mem_get_info()
            return int(free / (1024 * 1024))
        except Exception:
            return None

    # ---- loading ---------------------------------------------------------
    def load(self) -> None:
        """Load weights. Idempotent."""
        if self.model is not None:
            return

        os.environ.setdefault("HF_HOME", str(self.cache_dir))
        os.environ.setdefault("TRANSFORMERS_CACHE", str(self.cache_dir))

        # If the caller specified MODEL_ID, try that first with auto-detected family.
        candidates: list[tuple[str, str]] = []
        if self.requested_model_id:
            fam = "sam2" if "sam2" in self.requested_model_id.lower() else "sam1"
            candidates.append((self.requested_model_id, fam))
        for cand in _MODEL_CANDIDATES:
            if cand not in candidates:
                candidates.append(cand)

        last_err: Optional[Exception] = None
        for repo_id, family in candidates:
            try:
                log.info("Loading SAM weights repo=%s family=%s device=%s", repo_id, family, self.device)
                t0 = time.time()
                if family == "sam2":
                    from transformers import Sam2Model, Sam2Processor  # type: ignore

                    self.processor = Sam2Processor.from_pretrained(repo_id, cache_dir=str(self.cache_dir))
                    self.model = Sam2Model.from_pretrained(repo_id, cache_dir=str(self.cache_dir))
                else:
                    from transformers import SamModel, SamProcessor  # type: ignore

                    self.processor = SamProcessor.from_pretrained(repo_id, cache_dir=str(self.cache_dir))
                    self.model = SamModel.from_pretrained(repo_id, cache_dir=str(self.cache_dir))

                self.model.to(self.device)
                # Put the network in inference-only mode (disables dropout / batchnorm updates).
                self.model.train(mode=False)
                self.loaded_model_id = repo_id
                self.family = family
                log.info("SAM loaded in %.1fs: %s", time.time() - t0, repo_id)
                return
            except Exception as e:  # noqa: BLE001
                log.warning("Failed to load %s (%s): %s", repo_id, family, e)
                last_err = e
                continue

        self._load_error = f"all SAM candidates failed; last error: {last_err}"
        raise RuntimeError(self._load_error)

    # ---- inference -------------------------------------------------------
    def segment(
        self,
        image: Image.Image,
        bbox_norm: Optional[Sequence[float]] = None,
        points_norm: Optional[Sequence[Sequence[float]]] = None,
        multimask: bool = True,
    ) -> list[MaskResult]:
        """Run SAM with grounded prompts. Returns mask candidates sorted by IoU desc."""
        if self.model is None:
            self.load()
        assert self.model is not None and self.processor is not None

        import torch  # local import; keeps module importable without torch

        W, H = image.size

        # Convert normalized prompts to pixel coords.
        input_boxes = None
        input_points = None
        input_labels = None
        if bbox_norm is not None:
            x0, y0, x1, y1 = bbox_norm
            input_boxes = [[[float(x0) * W, float(y0) * H, float(x1) * W, float(y1) * H]]]
        if points_norm:
            pts = []
            lbls = []
            for p in points_norm:
                px, py, lbl = float(p[0]) * W, float(p[1]) * H, int(p[2])
                pts.append([px, py])
                lbls.append(lbl)
            input_points = [[pts]]
            input_labels = [[lbls]]

        proc_kwargs = dict(images=image, return_tensors="pt")
        if input_boxes is not None:
            proc_kwargs["input_boxes"] = input_boxes
        if input_points is not None:
            proc_kwargs["input_points"] = input_points
            proc_kwargs["input_labels"] = input_labels

        inputs = self.processor(**proc_kwargs).to(self.device)

        with torch.inference_mode():
            outputs = self.model(**inputs, multimask_output=multimask)

        # Post-process to masks at original image size.
        # Transformers processors for SAM and SAM2 both expose post_process_masks.
        original_sizes = inputs.get("original_sizes")
        reshaped_input_sizes = inputs.get("reshaped_input_sizes")
        pp_kwargs = dict(mask_threshold=0.0)
        if self.family == "sam2":
            # SAM2's fast image processor doesn't consume reshaped_input_sizes.
            masks = self.processor.post_process_masks(
                outputs.pred_masks.cpu(),
                original_sizes.cpu() if hasattr(original_sizes, "cpu") else original_sizes,
                **pp_kwargs,
            )
        else:
            masks = self.processor.post_process_masks(
                outputs.pred_masks.cpu(),
                original_sizes.cpu() if hasattr(original_sizes, "cpu") else original_sizes,
                reshaped_input_sizes.cpu() if hasattr(reshaped_input_sizes, "cpu") else reshaped_input_sizes,
                **pp_kwargs,
            )
        # masks is a list (batch) of tensors shape [num_prompts, num_masks, H, W]
        scores = outputs.iou_scores.detach().cpu().numpy()  # [batch, num_prompts, num_masks]

        batch_masks = masks[0]  # tensor [num_prompts, num_masks, H, W]
        if hasattr(batch_masks, "numpy"):
            batch_masks = batch_masks.numpy()
        # Collapse first prompt dim (we only ever send one).
        prompt_masks = batch_masks[0]            # [num_masks, H, W]
        prompt_scores = scores[0][0]             # [num_masks]

        results: list[MaskResult] = []
        for i in range(prompt_masks.shape[0]):
            m = prompt_masks[i]
            if m.dtype != np.bool_:
                m = m > 0.5
            area = int(m.sum())
            if area == 0:
                continue
            ys, xs = np.where(m)
            x0, y0 = int(xs.min()), int(ys.min())
            x1, y1 = int(xs.max()) + 1, int(ys.max()) + 1
            w, h = max(1, x1 - x0), max(1, y1 - y0)
            results.append(
                MaskResult(
                    mask=(m.astype(np.uint8) * 255),
                    iou=float(prompt_scores[i]),
                    area_px=area,
                    bbox=(x0, y0, x1, y1),
                    aspect=float(w) / float(h),
                )
            )

        # Highest IoU first.
        results.sort(key=lambda r: r.iou, reverse=True)
        return results


def encode_mask_png_b64(mask: np.ndarray) -> str:
    """Encode a HxW uint8 mask as a PNG base64 string."""
    import base64

    img = Image.fromarray(mask, mode="L")
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return base64.b64encode(buf.getvalue()).decode("ascii")

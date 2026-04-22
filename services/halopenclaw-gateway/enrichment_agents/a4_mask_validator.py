"""Agent 4 — Mask validator.

Deterministic geometry checks over the candidate masks SAM returned.
No LLM. We reject:

* noise masks (< 500 px area)
* masks whose aspect ratio clashes with the manifest dimensions
  (|actual - expected| / expected > 0.5)
* masks whose center sits > 30% outside the grounding bbox center

Whatever survives is sorted by reported IoU; the best mask wins.
"""
from __future__ import annotations

import base64
import io
import logging
from typing import Any

from ._protocol import AgentStep, EnrichmentContext, StepResult

log = logging.getLogger("halofire.enrichment.a4_validator")

_MIN_AREA_PX = 500
_ASPECT_TOLERANCE = 0.5
_CENTER_OFFSET_FRAC = 0.3


class MaskValidatorAgent:
    name = "a4_mask_validator"

    async def run(self, ctx: EnrichmentContext) -> StepResult:
        masks = ctx.artifacts.get("masks") or []
        if not masks:
            return StepResult(ok=False, reason="no-masks-to-validate")

        expected_aspect = _expected_aspect(ctx.catalog_entry)
        grounding = ctx.artifacts.get("grounding") or {}
        photo = (ctx.artifacts.get("photos") or [{}])[0]
        img_w = int(photo.get("width") or 0)
        img_h = int(photo.get("height") or 0)

        surviving: list[dict[str, Any]] = []
        rejected: list[dict[str, Any]] = []

        for idx, mask in enumerate(masks):
            reason = _why_reject(
                mask,
                expected_aspect=expected_aspect,
                grounding_bbox=grounding.get("bbox"),
                image_wh=(img_w, img_h),
            )
            if reason is None:
                surviving.append(mask)
            else:
                rejected.append({"idx": idx, "reason": reason, "iou": mask.get("iou")})

        if not surviving:
            return StepResult(
                ok=False,
                reason="all-masks-invalid",
                artifacts={"mask_rejections": rejected},
            )

        surviving.sort(key=lambda m: float(m.get("iou", 0.0) or 0.0), reverse=True)
        best = surviving[0]

        return StepResult(
            ok=True,
            confidence=float(best.get("iou", 0.7) or 0.7),
            artifacts={
                "validated_mask": best,
                "mask_rejections": rejected,
            },
        )


# ── pure helpers (unit-testable) ────────────────────────────────────


def _expected_aspect(catalog_entry: dict) -> float | None:
    """Return expected height/width aspect from catalog params.

    Sprinkler heads are roughly axisymmetric tall pieces — default to
    ~1.5 when we have no better hint. Fittings/couplings are wider
    than tall so we use stored length/body_dia when present.
    """
    params = catalog_entry.get("params") or {}

    def _num(key: str) -> float | None:
        p = params.get(key)
        if isinstance(p, dict) and isinstance(p.get("default"), (int, float)):
            return float(p["default"])
        if isinstance(p, (int, float)):
            return float(p)
        return None

    length = _num("length_in") or _num("face_to_face_in")
    body_dia = _num("body_dia_in") or _num("outside_dia_in") or _num("size_in")

    if length and body_dia and body_dia > 0:
        return length / body_dia

    kind = catalog_entry.get("kind") or ""
    if kind == "sprinkler_head":
        return 1.5  # heads are typically ~1.5x taller than wide
    if kind == "fitting":
        return 1.0  # square-ish in the photo
    if kind == "valve":
        return 1.2
    return None


def _why_reject(
    mask: dict[str, Any],
    *,
    expected_aspect: float | None,
    grounding_bbox: list[float] | None,
    image_wh: tuple[int, int],
) -> str | None:
    area = mask.get("area_px")
    if area is None:
        area = _area_from_bbox(mask.get("bbox"))
    if area is None or area < _MIN_AREA_PX:
        return f"area<{_MIN_AREA_PX}"

    bbox = mask.get("bbox")
    if bbox and len(bbox) == 4:
        x0, y0, x1, y1 = bbox
        w = max(1.0, float(x1 - x0))
        h = max(1.0, float(y1 - y0))
        if expected_aspect is not None and expected_aspect > 0:
            actual = h / w
            # Some parts present sideways in cut sheets — accept inverse too.
            dev = min(
                abs(actual - expected_aspect) / expected_aspect,
                abs((1.0 / actual) - expected_aspect) / expected_aspect,
            )
            if dev > _ASPECT_TOLERANCE:
                return f"aspect-mismatch: actual={actual:.2f} expected={expected_aspect:.2f}"

        if grounding_bbox and image_wh[0] and image_wh[1]:
            gw, gh = image_wh
            gx0, gy0, gx1, gy1 = (float(c) for c in grounding_bbox)
            ground_cx_px = ((gx0 + gx1) / 2.0) * gw
            ground_cy_px = ((gy0 + gy1) / 2.0) * gh
            mask_cx = (x0 + x1) / 2.0
            mask_cy = (y0 + y1) / 2.0
            dx = abs(mask_cx - ground_cx_px) / max(1.0, (gx1 - gx0) * gw)
            dy = abs(mask_cy - ground_cy_px) / max(1.0, (gy1 - gy0) * gh)
            if dx > _CENTER_OFFSET_FRAC or dy > _CENTER_OFFSET_FRAC:
                return f"center-offset dx={dx:.2f} dy={dy:.2f}"

    return None


def _area_from_bbox(bbox: Any) -> float | None:
    if not bbox or len(bbox) != 4:
        return None
    x0, y0, x1, y1 = bbox
    return max(0.0, float(x1 - x0)) * max(0.0, float(y1 - y0))


def _decode_png_b64(data: str | None) -> bytes | None:  # pragma: no cover - helper
    if not data:
        return None
    try:
        return base64.b64decode(data)
    except Exception:
        return None

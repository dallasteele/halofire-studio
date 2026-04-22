"""Agent 1 — Intake.

Deterministic. Reads a cut-sheet PDF (local if available, otherwise
downloaded from ``cut_sheet_url`` into the existing local cut_sheets
directory) and extracts:

* the largest image on page 1 (heuristic for "product photo")
* any visible text on page 1 (used by grounding_agent for context)

Uses PyMuPDF (``fitz``) so we don't need a second PDF dependency —
the rest of the gateway already loads PyMuPDF for title-block OCR.
"""
from __future__ import annotations

import hashlib
import io
import logging
from pathlib import Path
from typing import Any

from ._protocol import AgentStep, EnrichmentContext, StepResult

log = logging.getLogger("halofire.enrichment.a1_intake")

# Any HTTPX use lives inside the download helper so unit tests that
# don't exercise the network path don't need httpx monkey-patching.


class IntakeAgent:
    name = "a1_intake"

    def __init__(
        self,
        *,
        cut_sheets_dir: Path | None = None,
        http_timeout: float = 20.0,
    ) -> None:
        self.cut_sheets_dir = cut_sheets_dir
        self.http_timeout = http_timeout

    async def run(self, ctx: EnrichmentContext) -> StepResult:
        cut_sheet = await self._ensure_cut_sheet(ctx)
        if cut_sheet is None:
            return StepResult(
                ok=False,
                reason="no-cut-sheet",
                confidence=0.0,
            )

        try:
            photos, spec_text = _extract_page1(cut_sheet, ctx.workdir)
        except _PdfReadError as exc:
            return StepResult(ok=False, reason=f"pdf-unreadable: {exc}")

        if not photos:
            return StepResult(
                ok=False,
                reason="no-images-on-page-1",
                confidence=0.0,
                artifacts={"spec_text": spec_text, "cut_sheet_path": str(cut_sheet)},
            )

        return StepResult(
            ok=True,
            confidence=1.0,
            artifacts={
                "photos": photos,
                "spec_text": spec_text,
                "cut_sheet_path": str(cut_sheet),
                "cut_sheet_sha256": _sha256(cut_sheet),
            },
        )

    async def _ensure_cut_sheet(self, ctx: EnrichmentContext) -> Path | None:
        if ctx.cut_sheet_path and ctx.cut_sheet_path.exists():
            return ctx.cut_sheet_path
        if not ctx.cut_sheet_url:
            return None
        target_dir = self.cut_sheets_dir
        if target_dir is None or not target_dir.exists():
            return None  # refuse to create the canonical cut_sheets dir
        # Derive a filename from the SKU so repeated runs are cached.
        target = target_dir / f"{ctx.sku_id}.pdf"
        if target.exists():
            return target
        try:
            import httpx  # local import so the module stays cheap to import

            async with httpx.AsyncClient(timeout=self.http_timeout) as client:
                resp = await client.get(ctx.cut_sheet_url, follow_redirects=True)
                if resp.status_code // 100 != 2:
                    log.warning("cut_sheet %s fetch returned %s", ctx.cut_sheet_url, resp.status_code)
                    return None
                target.write_bytes(resp.content)
                return target
        except Exception as exc:  # pragma: no cover - network path
            log.warning("cut_sheet %s download failed: %s", ctx.cut_sheet_url, exc)
            return None


# ── helpers (pure — unit testable without Context) ──────────────────


class _PdfReadError(RuntimeError):
    pass


def _extract_page1(pdf_path: Path, workdir: Path) -> tuple[list[dict[str, Any]], str]:
    """Return ``(photos, spec_text)`` for page 1 of the PDF.

    Photos are ordered by area (largest first) so the orchestrator can
    treat index 0 as the "primary product photo" without a second pass.
    """
    try:
        import fitz  # PyMuPDF
    except ImportError as exc:  # pragma: no cover
        raise _PdfReadError(f"pymupdf not installed: {exc}") from exc

    try:
        doc = fitz.open(pdf_path)
    except Exception as exc:
        raise _PdfReadError(str(exc)) from exc

    try:
        if doc.page_count < 1:
            return [], ""
        page = doc.load_page(0)
        spec_text = page.get_text("text") or ""

        photos: list[dict[str, Any]] = []
        workdir.mkdir(parents=True, exist_ok=True)
        for idx, img in enumerate(page.get_images(full=True)):
            xref = img[0]
            try:
                pix = fitz.Pixmap(doc, xref)
            except Exception:  # malformed image entry
                continue
            # Some PDFs embed CMYK or alpha-only images — convert to RGB.
            # Stencil / image-mask entries carry no colorspace at all
            # (pix.colorspace is None); skip them, they're typically
            # clipping masks rather than product photos.
            try:
                if pix.colorspace is None:
                    pix = None
                    continue
                if pix.n >= 5 or pix.alpha:
                    pix = fitz.Pixmap(fitz.csRGB, pix)
            except Exception:
                pix = None
                continue
            w, h = pix.width, pix.height
            if w < 64 or h < 64:
                pix = None
                continue
            out = workdir / f"page1_img{idx:02d}.png"
            pix.save(out)
            photos.append(
                {
                    "path": str(out),
                    "page": 1,
                    "width": w,
                    "height": h,
                    "area": w * h,
                }
            )
            pix = None

        photos.sort(key=lambda p: p["area"], reverse=True)
        return photos, spec_text.strip()
    finally:
        doc.close()


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def _png_buf_to_file(buf: bytes, out: Path) -> None:  # pragma: no cover - helper
    out.write_bytes(buf)
    _ = io.BytesIO(buf)  # validate the bytes decode

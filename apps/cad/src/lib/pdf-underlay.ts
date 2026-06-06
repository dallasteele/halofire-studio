// HaloFire CAD — PDF raster underlay (the only browser-impure import path). Renders
// ONE page of a PDF to an offscreen canvas / ImageBitmap for use as a konva underlay
// image, so the operator can hand-trace walls + rooms over a real architectural sheet
// and set the scale from the sheet's own dimensions. A raster PDF carries NO reliable
// point->feet factor, so we render it for VISUAL tracing only — the scale comes from
// the operator's two-point set-scale, never from the PDF.
//
// pdfjs worker: pdfjs-dist v6 ships an ESM worker (pdf.worker.min.mjs). Under Vite we
// resolve it with `new URL(..., import.meta.url)` so the bundler fingerprints and
// serves it; this is the worker form that loads cleanly under Vite dev + build.
//
// HONESTY: this module renders pixels only. It derives no scale and no geometry from
// the PDF — those come from the operator's trace + set-scale tools.

// pdfjs is imported DYNAMICALLY (inside loadPdfPage) rather than at module top: the
// pdfjs main build touches browser-only globals (DOMMatrix, etc.) at eval time, which
// would crash a jsdom unit-test run merely by importing this file. Deferring the
// import keeps the module load clean everywhere; the worker URL is resolved the same
// way (a Vite `?url` import) only when a PDF is actually rendered.
type PdfjsModule = typeof import('pdfjs-dist');

let pdfjsPromise: Promise<PdfjsModule> | null = null;

/** Load pdfjs + point it at the Vite-bundled worker exactly once. */
async function getPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjsLib = await import('pdfjs-dist');
      // Vite resolves this `?url` import to the fingerprinted worker asset.
      const workerUrl = (
        await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
      ).default;
      pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjsLib;
    })();
  }
  return pdfjsPromise;
}

/** Ensure pdfjs + its Vite worker are configured (idempotent). */
export async function configurePdfWorker(): Promise<void> {
  await getPdfjs();
}

/** A rendered PDF page ready to drop into a konva Image. */
export interface RenderedPdfPage {
  /** The rendered raster (konva accepts an HTMLCanvasElement as an image). */
  canvas: HTMLCanvasElement;
  /** Page width in CSS pixels at the chosen render scale. */
  widthPx: number;
  /** Page height in CSS pixels at the chosen render scale. */
  heightPx: number;
  /** Page width in PDF points (72/in) at scale 1 — for the operator's reference. */
  widthPt: number;
  /** Page height in PDF points at scale 1. */
  heightPt: number;
  /** 1-based page number rendered. */
  pageNumber: number;
  /** Total pages in the document. */
  numPages: number;
}

/** Options for loadPdfPage. */
export interface LoadPdfPageOpts {
  /** 1-based page number to render. Default 1. */
  pageNumber?: number;
  /**
   * Render scale (pdfjs viewport scale). Higher = sharper but heavier. Default 2,
   * capped so a huge sheet does not blow past the browser canvas size limit.
   */
  scale?: number;
  /** Max rendered canvas dimension (px) before scale is reduced. Default 4096. */
  maxDim?: number;
}

/** Accepts a File, ArrayBuffer, or typed array of PDF bytes. */
export type PdfInput = File | Blob | ArrayBuffer | Uint8Array;

async function toUint8(input: PdfInput): Promise<Uint8Array> {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  // File / Blob
  const buf = await input.arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * IMPURE. Render ONE PDF page to a canvas for use as a konva underlay. Configures the
 * Vite worker on first use. The render scale auto-reduces so the canvas stays within
 * `maxDim` — large bid sheets (e.g. ARCH-E) would otherwise exceed the canvas limit.
 *
 * Throws on a genuinely unreadable PDF or an out-of-range page; callers surface that
 * as an honest error state rather than a blank underlay.
 */
export async function loadPdfPage(
  input: PdfInput,
  opts: LoadPdfPageOpts = {},
): Promise<RenderedPdfPage> {
  const pdfjsLib = await getPdfjs();

  const data = await toUint8(input);
  const loadingTask = pdfjsLib.getDocument({
    data,
    disableFontFace: true,
  });
  const doc = await loadingTask.promise;
  const numPages = doc.numPages;

  const pageNumber = Math.min(
    Math.max(1, Math.floor(opts.pageNumber ?? 1)),
    numPages,
  );
  const page = await doc.getPage(pageNumber);

  const base = page.getViewport({ scale: 1 });
  const widthPt = base.width;
  const heightPt = base.height;

  const maxDim = Number.isFinite(opts.maxDim) ? Number(opts.maxDim) : 4096;
  let scale = Number.isFinite(opts.scale) ? Number(opts.scale) : 2;
  const longest = Math.max(widthPt, heightPt) * scale;
  if (longest > maxDim) scale = maxDim / Math.max(widthPt, heightPt);

  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('loadPdfPage: 2D canvas context unavailable');

  await page.render({ canvas, canvasContext: ctx, viewport }).promise;

  return {
    canvas,
    widthPx: canvas.width,
    heightPx: canvas.height,
    widthPt,
    heightPt,
    pageNumber,
    numPages,
  };
}

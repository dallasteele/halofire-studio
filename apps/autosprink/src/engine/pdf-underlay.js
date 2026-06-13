/**
 * Stream B — render a REAL plan-PDF sheet to a three.js CanvasTexture underlay.
 *
 * Standalone engine module: NOT wired into autosprink.html yet (Phase-2
 * integrator does that). Dependency-injected:
 *   - pdfjsLib: the pdf.js API namespace. In the browser, dynamic-import
 *     '/vendor/pdfjs/pdf.mjs' (vendored locally — no CDN) and set
 *     GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.mjs'
 *     (loadPdfjs() below does exactly that). In node smoke tests, pass
 *     pdfjs-dist/legacy/build/pdf.mjs (renders via @napi-rs/canvas).
 *   - THREE: the three.js namespace (the unbundled page already imports
 *     /vendor/three; tests can pass a stub).
 *
 * ORIENTATION CONTRACT (fixes the prior placeholder that rendered facing -Z /
 * mirrored): the underlay plane lies FLAT at a level's floor elevation, normal
 * +Y, with the sheet's top edge toward world -Z, so in plan view (camera
 * looking straight down -Y) the drawing text reads NORMALLY — never mirrored.
 * Implementation: THREE.PlaneGeometry (faces +Z, texture upright) rotated
 * rotation.x = -PI/2. CanvasTexture default flipY=true is required and kept.
 *
 * TRUE SCALE: 1 world unit = 1 ft. The transform fits the rendered page into
 * the project's known footprint (contain-fit, aspect preserved) — this is a
 * BEST-EFFORT visual scale, NOT a title-block-verified plot scale, so every
 * mesh carries userData.needsVerification = true.
 */

/** Browser-only convenience: load the locally vendored pdf.js (no CDN). */
export async function loadPdfjs({ baseUrl = '/vendor/pdfjs' } = {}) {
  const lib = await import(/* @vite-ignore */ `${baseUrl}/pdf.mjs`);
  if (lib.GlobalWorkerOptions) {
    lib.GlobalWorkerOptions.workerSrc = `${baseUrl}/pdf.worker.mjs`;
  }
  return lib;
}

/**
 * Pure: compute the world transform for a rendered sheet.
 * Contain-fits pageWidthPt x pageHeightPt into targetWidthFt x targetDepthFt
 * (aspect preserved), centered at (centerXFt, centerZFt), lying flat at
 * elevationFt (+ a small lift to avoid z-fighting with the slab).
 */
export function computeUnderlayTransform({
  pageWidthPt,
  pageHeightPt,
  targetWidthFt,
  targetDepthFt,
  elevationFt = 0,
  centerXFt = 0,
  centerZFt = 0,
  liftFt = 0.05,
}) {
  const wPt = Number(pageWidthPt);
  const hPt = Number(pageHeightPt);
  const wFt = Number(targetWidthFt);
  const dFt = Number(targetDepthFt);
  if (!(wPt > 0) || !(hPt > 0)) throw new Error('computeUnderlayTransform: page size must be positive');
  if (!(wFt > 0) || !(dFt > 0)) throw new Error('computeUnderlayTransform: target footprint must be positive');
  const fit = Math.min(wFt / wPt, dFt / hPt); // ft per PDF point, contain-fit
  return {
    widthFt: wPt * fit,
    depthFt: hPt * fit,
    feetPerPdfPoint: fit,
    position: { x: Number(centerXFt), y: Number(elevationFt) + Number(liftFt), z: Number(centerZFt) },
    // Plane faces +Y, sheet top edge toward -Z, text readable from above.
    rotation: { x: -Math.PI / 2, y: 0, z: 0 },
    scaleSource: 'contain-fit to project footprint — NOT a verified plot scale',
    needsVerification: true,
  };
}

/**
 * Render one page of a PDF to a canvas. Works in browser (DOM canvas) and in
 * node (pdfjs legacy build creates @napi-rs/canvas internally when given no
 * canvas/context — we create one explicitly via doc-level canvasFactory).
 * Returns { canvas, widthPt, heightPt, widthPx, heightPx }.
 */
export async function renderSheetToCanvas(pdfjsLib, {
  url,
  data = null,
  page = 1,
  targetPx = 3000, // longest edge in pixels
  background = '#ffffff',
  standardFontDataUrl = '/vendor/pdfjs/standard_fonts/', // vendored locally
}) {
  if (!pdfjsLib || typeof pdfjsLib.getDocument !== 'function') {
    throw new Error('renderSheetToCanvas: pdfjsLib with getDocument is required');
  }
  const params = data ? { data } : { url };
  params.isEvalSupported = false;
  if (typeof document !== 'undefined' && standardFontDataUrl) {
    params.standardFontDataUrl = standardFontDataUrl;
  }
  const task = pdfjsLib.getDocument(params);
  const doc = await task.promise;
  try {
    const pageNum = Math.min(Math.max(1, Number(page) || 1), doc.numPages);
    const pdfPage = await doc.getPage(pageNum);
    const base = pdfPage.getViewport({ scale: 1 });
    const scale = Math.max(0.1, Number(targetPx) / Math.max(base.width, base.height));
    const viewport = pdfPage.getViewport({ scale });
    const widthPx = Math.ceil(viewport.width);
    const heightPx = Math.ceil(viewport.height);

    let canvas;
    if (typeof document !== 'undefined' && document.createElement) {
      canvas = document.createElement('canvas');
      canvas.width = widthPx;
      canvas.height = heightPx;
    } else {
      // node path: pdfjs legacy ships a NodeCanvasFactory backed by @napi-rs/canvas
      const factory = doc.canvasFactory || task.canvasFactory;
      if (factory && typeof factory.create === 'function') {
        canvas = factory.create(widthPx, heightPx).canvas;
      } else {
        const { createCanvas } = await import('@napi-rs/canvas');
        canvas = createCanvas(widthPx, heightPx);
      }
    }
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, widthPx, heightPx);
    await pdfPage.render({ canvasContext: ctx, viewport }).promise;
    pdfPage.cleanup();
    return { canvas, widthPt: base.width, heightPt: base.height, widthPx, heightPx };
  } finally {
    try { await task.destroy(); } catch { /* doc already torn down */ }
  }
}

/**
 * Build the flat, correctly-oriented underlay mesh for a rendered sheet.
 * THREE is injected. Returns the mesh; caller adds it to a level group.
 */
export function createUnderlayMesh(THREE, {
  canvas,
  transform,
  name = 'plan-underlay',
  opacity = 1,
  sheetMeta = null,
  // RECORE orientation contract: the underlay plane is rotated rotation.x = -PI/2 so its
  // textured face normal points +Y (UP), toward the top-down plan camera — text reads
  // FORWARD, never mirrored (a +PI/2 plane shows its BACK to that camera = backwards text).
  // Orientation (empirically re-verified 2026-06-13 via a 4-way (U,V) flip sweep on the live
  // registered underlay at top+iso — evidence out/halofire-wallpipe/flipdiag/): with -PI/2 and
  // NO flip, sheet text reads FORWARD at BOTH top AND iso for both the contain-fit and the
  // registered-geometry (building-from-plan.computePlanUnderlayTransform) paths. flipTextureV:true
  // MIRRORS the sheet top<->bottom (upside-down) and is therefore NOT used; the registered underlay
  // is already correctly oriented at the default. Default-off; live-QA mirror knob only.
  flipTextureV = false,
  // flipTextureU mirrors the texture's U (left<->right) axis. Inert default-off live-QA option for
  // re-checking a left<->right mirror at oblique/iso; the verified default needs neither flip.
  flipTextureU = false,
}) {
  if (!THREE) throw new Error('createUnderlayMesh: THREE namespace is required');
  if (!canvas) throw new Error('createUnderlayMesh: rendered canvas is required');
  if (!transform) throw new Error('createUnderlayMesh: transform from computeUnderlayTransform is required');
  const texture = new THREE.CanvasTexture(canvas);
  // flipY default (true) keeps the texture upright; the readable-from-above contract is now
  // carried by rotation.x = -PI/2 (face up). flipTextureV/U mirror the V/U axis so the sheet
  // registers AND reads forward for the plan-Y->world-Z registered path (see header).
  if ('colorSpace' in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
  if (flipTextureV || flipTextureU) {
    if (texture.center && texture.repeat && texture.wrapT !== undefined) {
      // Mirror about the texture center so the image flips in place along the chosen axis/axes.
      texture.center.set(0.5, 0.5);
      texture.repeat.set(flipTextureU ? -1 : 1, flipTextureV ? -1 : 1);
      if (THREE.RepeatWrapping) {
        texture.wrapT = THREE.RepeatWrapping;
        if (texture.wrapS !== undefined) texture.wrapS = THREE.RepeatWrapping;
      }
    } else {
      if (flipTextureV) texture.flipY = !texture.flipY; // stub-THREE / minimal texture fallback
    }
  }
  texture.anisotropy = 8;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: opacity < 1,
    opacity,
    side: THREE.DoubleSide,
    toneMapped: false,
    depthWrite: false,
    // RECORE clipping fix: the underlay sits just above an also-transparent footprint slab
    // (renderOrder -10, depthWrite false). With NO polygon offset and a tiny lift it z-fights /
    // cuts through geometry at grazing camera angles. Push it back in depth so it always resolves
    // BEHIND the model linework regardless of view angle, without disabling depthTest.
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const geometry = new THREE.PlaneGeometry(transform.widthFt, transform.depthFt);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.set(transform.rotation.x, transform.rotation.y, transform.rotation.z);
  mesh.position.set(transform.position.x, transform.position.y, transform.position.z);
  mesh.renderOrder = -10; // draw under model linework
  mesh.name = name;
  mesh.userData = {
    kind: 'pdf-plan-underlay',
    needsVerification: true,
    scaleSource: transform.scaleSource,
    sheet: sheetMeta,
    flipTextureV: !!flipTextureV,
    flipTextureU: !!flipTextureU,
  };
  return mesh;
}

/**
 * One-call helper: render a manifest sheet and build its mesh at a level.
 * `sheet` is an entry from plan-manifest.js; `footprint` {widthFt, depthFt}.
 */
export async function buildSheetUnderlay({ pdfjsLib, THREE, sheet, footprint, elevationFt = 0, targetPx = 3000, opacity = 1 }) {
  const rendered = await renderSheetToCanvas(pdfjsLib, { url: sheet.url, page: sheet.page, targetPx });
  const transform = computeUnderlayTransform({
    pageWidthPt: rendered.widthPt,
    pageHeightPt: rendered.heightPt,
    targetWidthFt: footprint.widthFt,
    targetDepthFt: footprint.depthFt,
    elevationFt,
  });
  const mesh = createUnderlayMesh(THREE, {
    canvas: rendered.canvas,
    transform,
    opacity,
    name: `underlay:${sheet.sheet || sheet.file}:p${sheet.page}`,
    sheetMeta: sheet,
  });
  return { mesh, rendered, transform };
}

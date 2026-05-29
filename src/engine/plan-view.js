/**
 * Plan-view camera fit (V1).
 *
 * planOrthoFrustum computes the orthographic frustum half-extents that fit a
 * plan bounding box to a viewport of a given aspect ratio, centered at the plan
 * center, with a margin. Pure + deterministic so the top-down "plan drawing"
 * always frames the whole floor plan regardless of building size or window
 * shape. Browser-free; no geometry kernel calls.
 */

/**
 * @param {{minX:number,maxX:number,minY:number,maxY:number}} bbox  plan extents
 *        (minY/maxY are the SECOND plan axis — in the studio that is world Z).
 * @param {number} aspect  viewport width / height (> 0).
 * @param {number} [margin=0.08]  fractional padding around the plan (0.08 = 8%).
 * @returns {{left:number,right:number,top:number,bottom:number}}  frustum
 *          half-extents relative to the plan center (left = -right, bottom = -top),
 *          sized so the ENTIRE bbox fits with margin and (right-left)/(top-bottom)
 *          equals the viewport aspect.
 */
export function planOrthoFrustum(bbox, aspect, margin = 0.08) {
  const a = aspect > 0 ? aspect : 1;
  const m = margin >= 0 ? margin : 0;
  const w = Math.max(1e-6, (bbox.maxX - bbox.minX)) * (1 + m);
  const h = Math.max(1e-6, (bbox.maxY - bbox.minY)) * (1 + m);
  const halfW = w / 2;
  const halfH = h / 2;
  let left;
  let top;
  if (halfW / halfH > a) {
    // Width-limited: fit the width exactly, expand the height to the aspect.
    left = -halfW;
    top = halfW / a;
  } else {
    // Height-limited: fit the height exactly, expand the width to the aspect.
    top = halfH;
    left = halfH * a * -1;
  }
  return { left, right: -left, top, bottom: -top };
}

/** Plan center (x, second-axis) of a bbox. */
export function planCenter(bbox) {
  return { x: (bbox.minX + bbox.maxX) / 2, y: (bbox.minY + bbox.maxY) / 2 };
}

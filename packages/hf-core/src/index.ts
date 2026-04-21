export * from './catalog/part.js'
export * from './scad/parse-params.js'
// Subpath exports (`@halofire/core/scene/...`) are the canonical entry
// points for scene translators. Both modules export a `NodeCreateOp`
// type, so we namespace the barrel re-exports to avoid collisions.
export * as sceneSpawn from './scene/spawn-from-design.js'
export * as sceneSlice from './scene/translate-slice.js'
export * as sheetsDefault from './sheets/generate-default-set.js'
export * as sheetsRiser from './sheets/riser-diagram.js'
export * as sheetsFloorPlan from './sheets/floor-plan-layout.js'
export {
  NODE_TYPE_TO_DXF_LAYER,
  LAYER_ACI_COLOR,
  pipeLayerForRole,
  filterByLayerVisibility,
} from './sheets/layer-mapping.js'
export {
  type DimPrimitive,
  dimensionToSvgPrimitives,
  formatDimensionText,
} from './drawing/dimension.js'
export {
  type AutoDimOptions,
  autoDimensionPipeRun,
  type SystemRef,
} from './drawing/auto-dim-pipe-runs.js'

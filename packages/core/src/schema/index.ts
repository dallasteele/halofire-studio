// Base
export { BaseNode, generateId, Material, nodeType, objectId } from './base'
// Camera
export { CameraSchema } from './camera'
// Collections
export { type Collection, type CollectionId, generateCollectionId } from './collections'
// Material
export {
  DEFAULT_MATERIALS,
  MaterialMapPropertiesSchema,
  MaterialMapsSchema,
  MaterialPreset,
  MaterialPresetPayloadSchema,
  MaterialProperties,
  MaterialSchema,
  MaterialTarget,
  TextureWrapMode,
  resolveMaterial,
} from './material'
export type {
  MaterialMapProperties,
  MaterialMaps,
  MaterialPresetPayload,
  MaterialTarget as MaterialTargetValue,
  TextureWrapMode as TextureWrapModeValue,
} from './material'
export { BuildingNode } from './nodes/building'
export { CeilingNode } from './nodes/ceiling'
export { DoorNode, DoorSegment } from './nodes/door'
export { FenceBaseStyle, FenceNode, FenceStyle } from './nodes/fence'
export { GuideNode } from './nodes/guide'
export type {
  AnimationEffect,
  Asset,
  AssetInput,
  Control,
  Effect,
  Interactive,
  LightEffect,
  SliderControl,
  TemperatureControl,
  ToggleControl,
} from './nodes/item'
export { getScaledDimensions, ItemNode } from './nodes/item'
export { LevelNode } from './nodes/level'
export { RoofNode } from './nodes/roof'
export { RoofSegmentNode, RoofType } from './nodes/roof-segment'
export { ScanNode } from './nodes/scan'
// Nodes
export { SiteNode } from './nodes/site'
export { SlabNode } from './nodes/slab'
// Fire-protection nodes (HaloFire Studio fork additions).
export {
  deflectorHeightM,
  flowAtPressure,
  SprinklerHeadNode,
  SprinklerOrientation,
  SprinklerResponse,
  SprinklerTemperatureRating,
} from './nodes/sprinkler-head'
export {
  hazenWilliamsC,
  pipeIdMm,
  pipeLengthM,
  pipeOdMm,
  PipeNode,
  PipeRole,
  PipeSchedule,
} from './nodes/pipe'
export {
  DENSITY_AREA_DEFAULTS,
  HazardClass,
  HOSE_ALLOWANCE_GPM,
  SystemKind,
  SystemNode,
  withHazardDefaults,
} from './nodes/system'
export { FittingNode } from './nodes/fitting'
export { ValveNode } from './nodes/valve'
export { HangerNode } from './nodes/hanger'
export { DeviceNode } from './nodes/device'
export { FDCNode } from './nodes/fdc'
export { RiserAssemblyNode } from './nodes/riser-assembly'
export { RemoteAreaNode } from './nodes/remote-area'
export { ObstructionNode } from './nodes/obstruction'
export {
  Annotation,
  Dimension,
  Hatch,
  RevisionCloud,
  SheetNode,
  Viewport,
} from './nodes/sheet'
export {
  StairNode,
  StairRailingMode,
  StairSlabOpeningMode,
  StairTopLandingMode,
  StairType,
} from './nodes/stair'
export { AttachmentSide, StairSegmentNode, StairSegmentType } from './nodes/stair-segment'
export { SurfaceHoleMetadata } from './nodes/surface-hole-metadata'
export { WallNode } from './nodes/wall'
export { WindowNode } from './nodes/window'
export { ZoneNode } from './nodes/zone'
export type { AnyNodeId, AnyNodeType } from './types'
// Union types
export { AnyNode } from './types'

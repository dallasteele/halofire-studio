/**
 * @halofire/schema — zod schemas for the `.hfproj` project bundle.
 *
 * See docs/blueprints/01_DATA_MODEL.md for the full contract.
 */

export { ProjectManifest } from './project'
export {
  Correction,
  WallDeleteCorrection,
  WallMoveCorrection,
  HeadMoveCorrection,
  HeadAddCorrection,
  HeadRemoveCorrection,
  PipeResizeCorrection,
  HazardSetCorrection,
} from './correction'
export { Comment, CommentReply } from './comment'
export { AuditEntry } from './audit'
export { CatalogLock, CatalogLockPart } from './catalog-lock'
export {
  Design,
  DesignProjectRef,
  DesignBuilding,
  DesignSystem,
  DesignRemoteArea,
  DesignSource,
  DesignIssue,
  DesignConfidence,
  DeliverableManifest,
  NfpaHazard,
  DesignSystemType,
  Point2D,
  Point3D,
} from './design'

import { ModuleContract } from './spine'

export const AutoBidModuleContract = ModuleContract.parse({
  module_id: 'autobid', entities_read: ['Job', 'Customer', 'Site', 'Document', 'ReviewItem'],
  tables_owned: ['intake_bids', 'ready_bids', 'bid_summary', 'bid_lines'], review_kinds: ['bid-readiness', 'source-evidence'],
  roles: ['estimator', 'preconstruction-manager', 'admin'], nav_path: '/autobid',
})
export const DesignCadModuleContract = ModuleContract.parse({
  module_id: 'design-cad', entities_read: ['Job', 'Site', 'Document', 'ReviewItem'],
  tables_owned: ['spatial_overlay_artifacts', 'spatial_overlay_reviews'], review_kinds: ['spatial-evidence', 'geometry-hold'],
  roles: ['designer', 'estimator', 'admin'], nav_path: '/design-cad',
})

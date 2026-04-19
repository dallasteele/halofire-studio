/**
 * IFC import option + result types.
 */

export interface IfcImportOptions {
  /** File buffer to parse (from <input type="file"> or fetch) */
  file: ArrayBuffer
  /** Optional filename for logging + diagnostics */
  filename?: string
  /**
   * Coordinate-system flip. IFC is Z-up-right-handed; Pascal uses
   * Y-up-right-handed by default. Flip swaps axes on import.
   */
  coordinateSystemFlip?: 'ifc_to_pascal' | 'none'
  /**
   * Whether to preserve IFC GUIDs as node metadata. Required for
   * round-trip + architect-revision-merge workflows.
   */
  preserveGuids?: boolean
}

export interface IfcImportResult {
  /** Total IFC entities processed */
  entitiesProcessed: number
  /** Entities mapped to Pascal nodes */
  nodesCreated: number
  /** Entities that could NOT be mapped (logged for review) */
  skippedEntities: {
    ifcType: string
    guid: string
    reason: string
  }[]
  /** Warnings (geometry errors, missing properties, etc.) */
  warnings: string[]
  /** Top-level site IDs created in the Pascal node tree */
  rootNodeIds: string[]
  /** Processing time in ms */
  durationMs: number
}

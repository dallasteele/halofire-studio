/**
 * IFC import entry point.
 *
 * BLOCKING ISSUE (2026-04-18): `@thatopen/components` 2.4.x + fragments +
 * three have incompatible peer-deps against Pascal's pinned three@0.184.
 * components@2.4.11 wants `AlignmentObject` from fragments 2.4.0 which
 * doesn't export it; components@3.4.2 wants `instancedArray` from three
 * 0.178+ which Pascal doesn't carry.
 *
 * To keep the Halofire Studio page loading, this module intentionally
 * does NOT import @thatopen/components until the peer-dep conflict is
 * resolved. The function signature is stable; real parsing lands once:
 *   a) Pascal bumps three to 0.184 consistently (already in its root
 *      package.json but transitively @thatopen/core is dragging 0.170)
 *   b) OR we vendor a fragments build that exports both Alignment +
 *      AlignmentObject
 *   c) OR we switch to web-ifc directly (without @thatopen wrapper)
 *
 * For now: the uploader reads the file, reports basic byte-count + name,
 * and returns a clear "not yet parsing" warning. Users see their upload
 * was received and know what's coming.
 */

import type { IfcImportOptions, IfcImportResult } from './types.js'
import { mapIfcToNodeTree } from './mapper.js'

export async function importIfcFile(
  options: IfcImportOptions,
): Promise<IfcImportResult> {
  const start =
    typeof performance !== 'undefined' ? performance.now() : Date.now()

  const mapping = await mapIfcToNodeTree(null, options)

  return {
    entitiesProcessed: 0,
    nodesCreated: mapping.nodesCreated,
    skippedEntities: [],
    warnings: [
      `Received ${options.filename ?? 'file'} (${(options.file.byteLength / 1024).toFixed(1)} KB).`,
      'IFC parsing is currently disabled pending @thatopen/components peer-dep',
      'resolution against Pascal\'s three.js version. Tracked in BUILD_LOG entry 16.',
      'Real parse lands once the version conflict is resolved (next iteration).',
    ],
    rootNodeIds: mapping.rootNodeIds,
    durationMs:
      (typeof performance !== 'undefined' ? performance.now() : Date.now()) - start,
  }
}

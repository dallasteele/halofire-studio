'use client'

import { useScene } from '@pascal-app/core'
import { InstancedCatalogRenderer } from '../../renderers/instanced-catalog-renderer'
import { NodeRenderer } from './node-renderer'

// R3.1 feature flag. Default ON; set to "false"/"0" to force the
// legacy per-node rendering path for the entire scene.
const INSTANCING_ENABLED = (() => {
  const raw = process.env.NEXT_PUBLIC_HF_INSTANCING
  if (raw === undefined) return true
  return raw !== 'false' && raw !== '0'
})()

export const SceneRenderer = () => {
  const rootNodes = useScene((state) => state.rootNodeIds)

  return (
    <group name="scene-renderer">
      {rootNodes.map((nodeId) => (
        <NodeRenderer key={nodeId} nodeId={nodeId} />
      ))}
      {INSTANCING_ENABLED && <InstancedCatalogRenderer />}
    </group>
  )
}

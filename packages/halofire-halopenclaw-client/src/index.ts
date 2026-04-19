/**
 * @halofire/halopenclaw-client — typed client for the halopenclaw gateway.
 *
 * One-call-per-tool wrappers over the JSON-RPC 2.0 tools/call endpoint,
 * plus a generic `call<T>(tool, args)` escape hatch.
 *
 * Also exports `serializePascalScene(scene)` that turns a Pascal node
 * tree into the `{nodes: [{id, type, folder, bbox_world, metadata}]}`
 * shape the gateway validate/place/route tools expect. This eliminates
 * the "hardcoded demo scene" limitation in FireProtectionPanel.
 */

export type { HalopenclawClient, ToolName, ValidateMode } from './types.js'
export { createHalopenclawClient } from './client.js'
export { serializePascalScene } from './serialize.js'
export { serializeLiveScene } from './serialize-live.js'
export type { SceneRegistryLike, SerializeLiveOptions } from './serialize-live.js'

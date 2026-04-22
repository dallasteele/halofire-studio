/**
 * Phase B — tool barrel. Importing this module registers every
 * shipped tool into the ToolRegistry via side effects.
 */

import './sprinkler-tool'
import './pipe-tool'
import './fitting-tool'
import './hanger-tool'
import './sway-brace-tool'
import './remote-area-tool'
import './move-tool'
import './resize-tool'
import './measure-tool'
import './section-tool'

export { ToolManagerProvider, useActiveTool, useToolManager } from './ToolManager'
export { getTool, listTools, registerTool } from './ToolRegistry'
export type { Tool, ToolContext, ToolPointerEvent, ToolKeyEvent } from './Tool'

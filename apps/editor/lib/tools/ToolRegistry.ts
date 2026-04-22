/**
 * Phase B — Tool registry.
 *
 * Simple id → Tool map. Populated at module-load time by each tool's
 * module importing `registerTool`. No hierarchy, no side-effects
 * beyond the map insert.
 */

import type { Tool } from './Tool'

const registry = new Map<string, Tool>()

export function registerTool(tool: Tool): void {
  registry.set(tool.id, tool)
}

export function getTool(id: string): Tool | undefined {
  return registry.get(id)
}

export function listTools(): Tool[] {
  return Array.from(registry.values())
}

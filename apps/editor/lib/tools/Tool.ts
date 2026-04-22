/**
 * Phase B — Tool interface.
 *
 * A Tool is the state machine behind a ribbon button. When active it
 * receives pointer / key events from the ToolManager, calls one of
 * the Phase A gateway endpoints via the scene store, and either
 * stays active (multi-click tools like Pipe) or auto-deactivates
 * (one-shot tools like Measure after two clicks).
 */

export interface ToolPointerEvent {
  /** Canvas-relative x,y in CSS pixels. */
  x: number
  y: number
  /** World-space xyz in meters, best-effort. null when raycast failed. */
  world: { x: number; y: number; z: number } | null
  /** Snap-adjusted world xyz. Equal to `world` when snap is off. */
  snapped: { x: number; y: number; z: number } | null
  /** Which mouse button (0=primary, 2=context). */
  button: number
  shiftKey: boolean
  ctrlKey: boolean
  altKey: boolean
  metaKey: boolean
  /** Original DOM event, for rare escape hatches. */
  raw: PointerEvent | MouseEvent
}

export interface ToolKeyEvent {
  key: string
  shiftKey: boolean
  ctrlKey: boolean
  altKey: boolean
  metaKey: boolean
  raw: KeyboardEvent
}

export interface ToolContext {
  projectId: string
  /** Notify the status bar with a short message. */
  status(message: string, level?: 'info' | 'warn' | 'error'): void
  /** Deactivate self (e.g. after a completed gesture). */
  deactivate(): void
  /** Toast helper for user-facing errors. */
  toast(message: string, level?: 'info' | 'warn' | 'error'): void
}

export interface Tool {
  id: string
  /** Short label shown in status bar. */
  label: string
  /** CSS cursor to apply while active ("crosshair", "pointer", etc). */
  cursor?: string
  onActivate?(ctx: ToolContext): void | Promise<void>
  onDeactivate?(ctx: ToolContext): void | Promise<void>
  onPointerDown?(e: ToolPointerEvent, ctx: ToolContext): void | Promise<void>
  onPointerMove?(e: ToolPointerEvent, ctx: ToolContext): void | Promise<void>
  onPointerUp?(e: ToolPointerEvent, ctx: ToolContext): void | Promise<void>
  onKeyDown?(e: ToolKeyEvent, ctx: ToolContext): void | Promise<void>
}

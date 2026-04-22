'use client'

/**
 * AutosaveManager — R5.3
 *
 * Drives `autosaveProject` on a dual cadence:
 *   1. Steady-state: every `intervalMs` (default 90s).
 *   2. Idle-after-edit: `idleMs` (default 10s) after the last
 *      `halofire:scene-changed` event.
 *
 * Also handles crash recovery: on mount, calls
 * `checkAutosaveRecovery(projectPath)`. If a newer autosave is found,
 * opens a modal offering Restore / Discard / Show Diff.
 *
 * Displays a pulsing status-bar indicator ("Autosaved") for 5s after
 * every successful save.
 *
 * IMPORTANT — this commit does NOT mount AutosaveManager from
 * app/page.tsx. Integration with the project-loading flow lands in a
 * later commit, per R5.3 in docs/IMPLEMENTATION_PLAN.md.
 */

import { useEffect, useRef, useState } from 'react'
import {
  autosaveProject,
  checkAutosaveRecovery,
  type LoadedProject,
} from '../../lib/project-io'

export interface AutosaveManagerProps {
  project: LoadedProject | null
  onRestoreAutosave?: (path: string) => void
  onDiscardAutosave?: () => void
  /** Steady-state autosave interval, ms. Default 90_000. */
  intervalMs?: number
  /** Idle-after-edit debounce, ms. Default 10_000. */
  idleMs?: number
  /** Indicator fade-out, ms. Default 5_000. */
  indicatorMs?: number
}

// ── Pure controller (testable without DOM) ────────────────────────
//
// The React component is a thin wrapper around this controller — all
// cadence logic lives here so e2e tests can drive it with explicit
// clock tick helpers instead of real sleeps.

export interface AutosaveController {
  /** Call after construction — starts the steady-state interval. */
  start(): void
  /** Call when a scene-changed event fires. Resets idle timer. */
  onSceneChanged(): void
  /** Force-flush an autosave immediately. */
  flushNow(): Promise<void>
  /** Tear down all timers. */
  stop(): void
  /** How many autosaves have completed since start(). */
  readonly saveCount: number
}

export interface AutosaveControllerOptions {
  project: LoadedProject
  intervalMs: number
  idleMs: number
  /** Injected for testability; defaults to real `autosaveProject`. */
  autosave?: (p: LoadedProject) => Promise<void>
  /** Injected for testability; defaults to real `setTimeout`. */
  setTimeoutFn?: typeof setTimeout
  /** Injected for testability; defaults to real `clearTimeout`. */
  clearTimeoutFn?: typeof clearTimeout
  /** Injected for testability; defaults to real `setInterval`. */
  setIntervalFn?: typeof setInterval
  /** Injected for testability; defaults to real `clearInterval`. */
  clearIntervalFn?: typeof clearInterval
  /** Called after each successful save (for indicator UI). */
  onSaved?: () => void
}

export function createAutosaveController(
  opts: AutosaveControllerOptions,
): AutosaveController {
  const save = opts.autosave ?? autosaveProject
  const sT = opts.setTimeoutFn ?? setTimeout
  const cT = opts.clearTimeoutFn ?? clearTimeout
  const sI = opts.setIntervalFn ?? setInterval
  const cI = opts.clearIntervalFn ?? clearInterval

  let intervalHandle: ReturnType<typeof setInterval> | null = null
  let idleHandle: ReturnType<typeof setTimeout> | null = null
  let saveCount = 0

  const flush = async () => {
    await save(opts.project)
    saveCount += 1
    opts.onSaved?.()
  }

  return {
    start() {
      intervalHandle = sI(() => {
        void flush()
      }, opts.intervalMs)
    },
    onSceneChanged() {
      if (idleHandle !== null) cT(idleHandle)
      idleHandle = sT(() => {
        idleHandle = null
        void flush()
      }, opts.idleMs)
    },
    async flushNow() {
      await flush()
    },
    stop() {
      if (intervalHandle !== null) cI(intervalHandle)
      if (idleHandle !== null) cT(idleHandle)
      intervalHandle = null
      idleHandle = null
    },
    get saveCount() {
      return saveCount
    },
  }
}

// ── Recovery modal ────────────────────────────────────────────────

export interface AutosaveRecoveryModalProps {
  autosavePath: string
  currentTs?: string
  autosaveTs?: string
  onRestore: () => void
  onDiscard: () => void
}

/**
 * Build the modal's action-button spec table. Pure — exported for
 * tests that want to verify onRestore/onDiscard are wired without
 * spinning up a React renderer.
 */
export function buildRecoveryButtonSpecs(opts: {
  onRestore: () => void
  onDiscard: () => void
  onToggleDiff: () => void
}): Array<{ testid: string; label: string; onClick: () => void }> {
  return [
    { testid: 'autosave-show-diff', label: 'Show diff', onClick: opts.onToggleDiff },
    { testid: 'autosave-discard', label: 'Discard', onClick: opts.onDiscard },
    { testid: 'autosave-restore', label: 'Restore', onClick: opts.onRestore },
  ]
}

export function AutosaveRecoveryModal({
  autosavePath,
  currentTs,
  autosaveTs,
  onRestore,
  onDiscard,
}: AutosaveRecoveryModalProps) {
  const [showDiff, setShowDiff] = useState(false)
  const specs = buildRecoveryButtonSpecs({
    onRestore,
    onDiscard,
    onToggleDiff: () => setShowDiff((s) => !s),
  })
  return (
    <div
      data-testid="autosave-recovery-modal"
      role="dialog"
      aria-label="Unsaved changes found"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: '#111',
          color: '#eee',
          padding: 24,
          fontFamily: 'IBM Plex Mono, monospace',
          minWidth: 420,
          border: '1px solid #333',
        }}
      >
        <h2 style={{ margin: 0, fontSize: 16 }}>
          We found unsaved changes from {autosaveTs ?? autosavePath}.
        </h2>
        <p style={{ fontSize: 12, opacity: 0.7 }}>
          HaloFire auto-saved your work after an edit. Restore it, or
          discard and keep the last saved project.
        </p>

        {showDiff && (
          <div
            data-testid="autosave-diff-panel"
            style={{
              background: '#090909',
              padding: 12,
              fontSize: 12,
              marginBottom: 12,
              border: '1px solid #222',
            }}
          >
            <div>current.json mtime: {currentTs ?? 'unknown'}</div>
            <div>autosave mtime: {autosaveTs ?? 'unknown'}</div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {specs.map((s) => (
            <button
              key={s.testid}
              data-testid={s.testid}
              type="button"
              onClick={s.onClick}
              style={
                s.testid === 'autosave-restore'
                  ? { background: '#ff3333', color: '#fff' }
                  : undefined
              }
            >
              {s.testid === 'autosave-show-diff' && showDiff
                ? 'Hide diff'
                : s.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Indicator ─────────────────────────────────────────────────────

export function AutosaveIndicator({ visible }: { visible: boolean }) {
  if (!visible) return null
  return (
    <div
      data-testid="autosave-indicator"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontFamily: 'IBM Plex Mono, monospace',
        fontSize: 11,
        color: '#4af626',
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          background: '#4af626',
          display: 'inline-block',
          animation: 'hf-pulse 1.2s ease-in-out infinite',
        }}
      />
      Autosaved
    </div>
  )
}

// ── React component ───────────────────────────────────────────────

export default function AutosaveManager({
  project,
  onRestoreAutosave,
  onDiscardAutosave,
  intervalMs = 90_000,
  idleMs = 10_000,
  indicatorMs = 5_000,
}: AutosaveManagerProps) {
  const [recoveryPath, setRecoveryPath] = useState<string | null>(null)
  const [indicatorVisible, setIndicatorVisible] = useState(false)
  const controllerRef = useRef<AutosaveController | null>(null)
  const indicatorTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const projectDir = project?.projectDir ?? null

  // Crash-recovery check: runs once per projectDir.
  useEffect(() => {
    if (!projectDir) {
      setRecoveryPath(null)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const path = await checkAutosaveRecovery(projectDir)
        if (!cancelled) setRecoveryPath(path)
      } catch {
        if (!cancelled) setRecoveryPath(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectDir])

  // Autosave controller lifecycle.
  useEffect(() => {
    if (!project) return
    const controller = createAutosaveController({
      project,
      intervalMs,
      idleMs,
      onSaved: () => {
        setIndicatorVisible(true)
        if (indicatorTimer.current !== null) {
          clearTimeout(indicatorTimer.current)
        }
        indicatorTimer.current = setTimeout(() => {
          setIndicatorVisible(false)
        }, indicatorMs)
      },
    })
    controllerRef.current = controller
    controller.start()

    const onScene = () => controller.onSceneChanged()
    if (typeof window !== 'undefined') {
      window.addEventListener('halofire:scene-changed', onScene)
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('halofire:scene-changed', onScene)
      }
      controller.stop()
      controllerRef.current = null
      if (indicatorTimer.current !== null) {
        clearTimeout(indicatorTimer.current)
        indicatorTimer.current = null
      }
    }
  }, [project, intervalMs, idleMs, indicatorMs])

  if (!project) return null

  return (
    <>
      <AutosaveIndicator visible={indicatorVisible} />
      {recoveryPath && (
        <AutosaveRecoveryModal
          autosavePath={recoveryPath}
          onRestore={() => {
            onRestoreAutosave?.(recoveryPath)
            setRecoveryPath(null)
          }}
          onDiscard={() => {
            onDiscardAutosave?.()
            setRecoveryPath(null)
          }}
        />
      )}
    </>
  )
}

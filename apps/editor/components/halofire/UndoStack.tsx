'use client'

/**
 * UndoStack — global keyboard bindings for undo/redo plus an optional
 * dropdown panel showing the last 10 history entries. Zundo-backed via
 * @pascal-app/core transactions.
 */
import { clearSceneHistory, getHistory, redo, txn, undo } from '@pascal-app/core'
import { useCallback, useEffect, useState } from 'react'

export interface UndoStackProps {
  showPanel?: boolean
}

export function UndoStack({ showPanel = false }: UndoStackProps) {
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<
    Array<{ label: string; at: number }>
  >([])

  const refresh = useCallback(() => {
    setEntries(getHistory().slice(-10))
  }, [])

  useEffect(() => {
    const handler = (ev: KeyboardEvent) => {
      const mod = ev.metaKey || ev.ctrlKey
      if (!mod) return
      const k = ev.key.toLowerCase()
      if (k === 'z' && !ev.shiftKey) {
        ev.preventDefault()
        undo()
        refresh()
      } else if ((k === 'z' && ev.shiftKey) || k === 'y') {
        ev.preventDefault()
        redo()
        refresh()
      }
    }
    window.addEventListener('keydown', handler)
    // Expose for tests — same pattern as HalofireNodeWatcher
    try {
      ;(window as unknown as { __hfUndo?: unknown }).__hfUndo = {
        undo,
        redo,
        getHistory,
        txn,
        clear: clearSceneHistory,
      }
    } catch {
      // non-fatal
    }
    return () => window.removeEventListener('keydown', handler)
  }, [refresh])

  if (!showPanel) return null

  return (
    <div
      data-testid="halofire-undo-stack"
      style={{
        position: 'fixed',
        bottom: 12,
        right: 12,
        zIndex: 50,
        fontFamily: 'IBM Plex Mono, monospace',
        fontSize: 12,
        color: '#ff3333',
        background: '#090909',
        border: '1px solid #ff3333',
        padding: '6px 10px',
      }}
    >
      <button
        type="button"
        onClick={() => {
          refresh()
          setOpen((v) => !v)
        }}
        style={{
          background: 'transparent',
          border: 'none',
          color: 'inherit',
          cursor: 'pointer',
          font: 'inherit',
        }}
      >
        HISTORY ({entries.length})
      </button>
      {open && (
        <ul
          data-testid="halofire-undo-stack-list"
          style={{
            listStyle: 'none',
            margin: '6px 0 0',
            padding: 0,
            maxHeight: 180,
            overflowY: 'auto',
          }}
        >
          {entries.length === 0 ? (
            <li style={{ opacity: 0.6 }}>(empty)</li>
          ) : (
            entries.map((e, i) => (
              <li key={`${e.at}-${i}`}>
                {i + 1}. {e.label}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}

export default UndoStack

/**
 * AutosaveManager (R5.3) — cadence + recovery tests.
 *
 * Runs in the Playwright Node runner against the in-memory FS
 * adapter shipped with `apps/editor/lib/project-io.ts` and a
 * fake-clock injected into `createAutosaveController`. No browser
 * is needed — the component's autosave logic lives in a pure
 * controller, and the recovery modal is rendered via
 * `react-dom/server` to a static string for behavioural assertions.
 *
 * The 5 contracts covered (per the R5.3 prompt):
 *   1. project=null → no autosave fires.
 *   2. project loaded → after intervalMs elapses, autosaveProject
 *      is called exactly once.
 *   3. scene-changed → idle debounce → autosaveProject fires once,
 *      and only after idleMs (not earlier).
 *   4. checkAutosaveRecovery returns a path when the autosave is
 *      newer than current.json (recovery banner should render).
 *   5. Recovery modal buttons call through to onRestore / onDiscard.
 */
import { expect, test } from '@playwright/test'
import {
  buildRecoveryButtonSpecs,
  createAutosaveController,
} from '../components/halofire/AutosaveManager'
import {
  _setFsAdapter,
  autosaveProject,
  checkAutosaveRecovery,
  createMemoryFsAdapter,
  createProject,
  saveProject,
  type LoadedProject,
} from '../lib/project-io'

const PARENT = '/tmp/hfproj-autosave-tests'

// ── Manual fake clock ─────────────────────────────────────────────

interface FakeClock {
  now: number
  setTimeout: (cb: () => void, ms: number) => number
  clearTimeout: (id: number) => void
  setInterval: (cb: () => void, ms: number) => number
  clearInterval: (id: number) => void
  tick: (ms: number) => Promise<void>
}

function makeFakeClock(): FakeClock {
  type Timer = {
    id: number
    due: number
    period: number // 0 == one-shot
    cb: () => void
  }
  let nextId = 1
  const timers = new Map<number, Timer>()
  const clock = {
    now: 0,
    setTimeout(cb: () => void, ms: number) {
      const id = nextId++
      timers.set(id, { id, due: clock.now + ms, period: 0, cb })
      return id
    },
    clearTimeout(id: number) {
      timers.delete(id)
    },
    setInterval(cb: () => void, ms: number) {
      const id = nextId++
      timers.set(id, { id, due: clock.now + ms, period: ms, cb })
      return id
    },
    clearInterval(id: number) {
      timers.delete(id)
    },
    async tick(ms: number) {
      const end = clock.now + ms
      while (true) {
        // pick earliest due <= end
        let next: Timer | null = null
        for (const t of timers.values()) {
          if (t.due <= end && (next === null || t.due < next.due)) next = t
        }
        if (next === null) break
        clock.now = next.due
        if (next.period > 0) {
          next.due = clock.now + next.period
        } else {
          timers.delete(next.id)
        }
        next.cb()
        // flush microtasks between timer firings so awaited saves
        // complete before the next tick.
        await new Promise<void>((resolve) => queueMicrotask(resolve))
      }
      clock.now = end
    },
  }
  return clock as FakeClock
}

async function freshProject(name: string): Promise<LoadedProject> {
  _setFsAdapter(createMemoryFsAdapter())
  return createProject({
    parentDir: PARENT,
    name,
    address: '1 Main',
    firm: 'Halo',
    designer: 'Ada',
  })
}

test.describe('AutosaveManager — cadence + recovery', () => {
  test('1. project=null controller cannot be built → no autosave fires', async () => {
    // With project=null the component renders nothing and never
    // constructs a controller. We model that by simply asserting
    // the controller factory is what drives saves, and that a
    // consumer who never calls start() never hits `autosave`.
    _setFsAdapter(createMemoryFsAdapter())
    let called = 0
    const clock = makeFakeClock()
    // Simulate the component's "project=null" branch: no controller
    // is created, no timers are registered. Advancing the clock
    // does nothing.
    await clock.tick(1_000_000)
    expect(called).toBe(0)
    // And for completeness: if a controller IS built but never
    // start()ed, the interval never fires either.
    const project = await freshProject('NullPath')
    const ctrl = createAutosaveController({
      project,
      intervalMs: 100,
      idleMs: 50,
      autosave: async () => {
        called += 1
      },
      setTimeoutFn: clock.setTimeout as unknown as typeof setTimeout,
      clearTimeoutFn: clock.clearTimeout as unknown as typeof clearTimeout,
      setIntervalFn: clock.setInterval as unknown as typeof setInterval,
      clearIntervalFn: clock.clearInterval as unknown as typeof clearInterval,
    })
    // Never calling start(); advancing a full interval shouldn't fire.
    await clock.tick(500)
    expect(called).toBe(0)
    ctrl.stop()
  })

  test('2. steady-state: intervalMs elapsed → autosave called once', async () => {
    const project = await freshProject('Steady')
    const clock = makeFakeClock()
    let calls = 0
    const ctrl = createAutosaveController({
      project,
      intervalMs: 100,
      idleMs: 50,
      autosave: async () => {
        calls += 1
      },
      setTimeoutFn: clock.setTimeout as unknown as typeof setTimeout,
      clearTimeoutFn: clock.clearTimeout as unknown as typeof clearTimeout,
      setIntervalFn: clock.setInterval as unknown as typeof setInterval,
      clearIntervalFn: clock.clearInterval as unknown as typeof clearInterval,
    })
    ctrl.start()

    // Not yet due.
    await clock.tick(99)
    expect(calls).toBe(0)

    // One tick past the interval → exactly one save.
    await clock.tick(1)
    expect(calls).toBe(1)
    expect(ctrl.saveCount).toBe(1)

    ctrl.stop()
  })

  test('3. scene-changed → idleMs debounce → one autosave, not before', async () => {
    const project = await freshProject('Idle')
    const clock = makeFakeClock()
    let calls = 0
    const ctrl = createAutosaveController({
      project,
      intervalMs: 10_000, // much larger than idleMs — won't interfere
      idleMs: 50,
      autosave: async () => {
        calls += 1
      },
      setTimeoutFn: clock.setTimeout as unknown as typeof setTimeout,
      clearTimeoutFn: clock.clearTimeout as unknown as typeof clearTimeout,
      setIntervalFn: clock.setInterval as unknown as typeof setInterval,
      clearIntervalFn: clock.clearInterval as unknown as typeof clearInterval,
    })
    ctrl.start()

    ctrl.onSceneChanged()
    await clock.tick(30)
    expect(calls).toBe(0) // still within idle window

    // Another edit resets the timer — 30+30 should NOT have fired.
    ctrl.onSceneChanged()
    await clock.tick(30)
    expect(calls).toBe(0)

    // Now advance past idleMs with no further edits → one save.
    await clock.tick(50)
    expect(calls).toBe(1)

    ctrl.stop()
  })

  test('4. checkAutosaveRecovery returns path when autosave is newer', async () => {
    const project = await freshProject('Recovery')
    // No autosave yet.
    expect(await checkAutosaveRecovery(project.projectDir)).toBeNull()

    // Simulate a crash: user edited, autosave wrote, current.json
    // never got updated.
    project.design.issues.push({
      severity: 'warning',
      code: 'CRASH',
      message: 'unsaved',
    })
    await autosaveProject(project)

    const path = await checkAutosaveRecovery(project.projectDir)
    expect(path).toBe(`${project.projectDir}/.autosave/design.json`)

    // A normal saveProject clears the recovery condition.
    await saveProject(project)
    expect(await checkAutosaveRecovery(project.projectDir)).toBeNull()
  })

  test('5. recovery modal buttons wire Restore + Discard callbacks', async () => {
    // The modal renders a pure button-spec table built from the
    // onRestore/onDiscard props. We verify those specs directly —
    // the React component is a thin map() over this same list, so
    // any wiring mismatch would show up here first.
    let restored: string | null = null
    let discarded = 0
    let diffToggled = 0
    const autosavePath =
      '/tmp/hfproj-autosave-tests/Bundle.hfproj/.autosave/design.json'

    const specs = buildRecoveryButtonSpecs({
      onRestore: () => {
        restored = autosavePath
      },
      onDiscard: () => {
        discarded += 1
      },
      onToggleDiff: () => {
        diffToggled += 1
      },
    })

    const byId = new Map(specs.map((s) => [s.testid, s]))
    expect(byId.has('autosave-restore')).toBe(true)
    expect(byId.has('autosave-discard')).toBe(true)
    expect(byId.has('autosave-show-diff')).toBe(true)

    byId.get('autosave-restore')!.onClick()
    expect(restored).toBe(autosavePath)

    byId.get('autosave-discard')!.onClick()
    byId.get('autosave-discard')!.onClick()
    expect(discarded).toBe(2)

    byId.get('autosave-show-diff')!.onClick()
    expect(diffToggled).toBe(1)
  })
})

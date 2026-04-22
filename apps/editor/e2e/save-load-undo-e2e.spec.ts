/**
 * R5.6 — save/load/undo e2e (full round-trip).
 *
 * Proves the end-to-end story the DoD gate calls out:
 *   Create → mutate → save → close → reopen → state identical
 *   + Undo across a pipeline-stage boundary.
 *
 * Six tests:
 *   1. Round-trip baseline — create, populate (1 Building + 1 Level
 *      + 1 System + 3 heads), save, load, deep-equal on manifest + design.
 *   2. Autosave recovery flow — save, mutate in memory, autosave,
 *      simulate crash (no saveProject), `checkAutosaveRecovery` returns
 *      the autosave path, restoring brings pre-crash state back.
 *   3. Undo past a pipeline-stage boundary — wrap an intake-equivalent
 *      mutation (spawns 1 building + 3 levels) in `txn('pipeline:intake',
 *      ...)` then a second `txn('place heads', ...)` that adds heads;
 *      one undo removes the heads only; redo brings them back.
 *   4. Corrections round-trip — `appendCorrection` then reload and
 *      verify corrections.jsonl contains the entry.
 *   5. Audit entries — 3 saves append 3 `action:'save'` lines to
 *      audit.jsonl (plus the initial create).
 *   6. Version mismatch — manifest.schema_version = 99 → loadProject
 *      throws `ProjectLoadError({code:'too-new'})`.
 *
 * Tests 1, 2, 4, 5, 6 are pure Node (in-memory FsAdapter). Test 3 is
 * the only one that needs a browser page because zundo + useScene live
 * on `window.__hfScene` / `window.__hfUndo` (see R5.4 / R5.5 hooks).
 */
import { expect, test } from '@playwright/test'
import {
  _getFsAdapter,
  _setFsAdapter,
  appendCorrection,
  autosaveProject,
  checkAutosaveRecovery,
  createMemoryFsAdapter,
  createProject,
  loadProject,
  ProjectLoadError,
  saveProject,
} from '../lib/project-io'

const PARENT = '/tmp/hfproj-r56'

// ── Helpers ───────────────────────────────────────────────────────

function populateDesign(
  project: Awaited<ReturnType<typeof createProject>>,
  extraHeads = 0,
): void {
  // The Design schema stores building contents / systems as `z.json()`
  // arrays — good enough to prove round-trip equality. We attach an
  // opaque payload per entity with stable ids so deep-equal works.
  const building = project.design.building
  building.levels.push({
    id: 'lvl_1',
    name: 'Level 1',
    elevation: 0,
  } as unknown as never)
  ;(building as unknown as { walls: unknown[] }).walls.push({
    id: 'wall_1',
    start: [0, 0],
    end: [10, 0],
  })
  project.design.systems.push({
    id: 'sys_1',
    type: 'wet',
    hazard: 'ordinary_i',
    heads: [
      { id: 'h_1', sku: 'TY3251', pos: [1, 1, 2.7] },
      { id: 'h_2', sku: 'TY3251', pos: [3, 1, 2.7] },
      { id: 'h_3', sku: 'TY3251', pos: [5, 1, 2.7] },
    ],
    pipes: [],
    fittings: [],
  } as unknown as never)
  for (let i = 0; i < extraHeads; i += 1) {
    const heads = (
      project.design.systems[0] as unknown as { heads: unknown[] }
    ).heads
    heads.push({
      id: `h_extra_${i}`,
      sku: 'TY3251',
      pos: [7 + i, 1, 2.7],
    })
  }
}

// ── Tests ─────────────────────────────────────────────────────────

test.describe('R5.6 — save/load/undo full e2e', () => {
  test.beforeEach(() => {
    _setFsAdapter(createMemoryFsAdapter())
  })

  test('1. round-trip baseline: create → populate → save → load → deep-equal', async () => {
    const created = await createProject({
      parentDir: PARENT,
      name: 'RoundTrip',
      address: '100 Main',
      firm: 'Halo',
      designer: 'Wade',
    })
    populateDesign(created, 0)
    await saveProject(created)

    const loaded = await loadProject(created.projectDir)
    expect(loaded.manifest.project_id).toBe(created.manifest.project_id)
    expect(loaded.manifest.name).toBe('RoundTrip')
    // manifest round-trips (modulo modified_at, which save bumps).
    expect(loaded.manifest.schema_version).toBe(created.manifest.schema_version)
    expect(loaded.manifest.firm).toBe(created.manifest.firm)
    expect(loaded.manifest.designer).toBe(created.manifest.designer)

    // design deep-equals the in-memory authoritative structure.
    expect(loaded.design).toEqual(created.design)
    expect(loaded.design.systems).toHaveLength(1)
    expect(
      (loaded.design.systems[0] as unknown as { heads: unknown[] }).heads,
    ).toHaveLength(3)
    expect(loaded.design.building.levels).toHaveLength(1)
  })

  test('2. autosave recovery: save → mutate → autosave → crash → recovery path restores', async () => {
    const project = await createProject({
      parentDir: PARENT,
      name: 'Recovery',
      address: '200 Main',
      firm: 'Halo',
      designer: 'Wade',
    })
    populateDesign(project, 0)
    await saveProject(project)
    const savedDesign = JSON.parse(JSON.stringify(project.design))

    // Mutate further and autosave (but deliberately never saveProject).
    populateDesign(project, 2) // adds 2 more heads into system sys_1
    void savedDesign // kept for debugging
    await autosaveProject(project)

    // Simulate crash: discard the in-memory LoadedProject; reopen the
    // bundle from disk. Reopen sees the OLD saved design (5 heads not
    // yet persisted) but an autosave file that's newer.
    const reopened = await loadProject(project.projectDir)
    const preCrashHeads = (
      reopened.design.systems[0] as unknown as { heads: unknown[] }
    ).heads.length
    expect(preCrashHeads).toBe(3) // design/current.json was never updated

    const recoveryPath = await checkAutosaveRecovery(project.projectDir)
    expect(recoveryPath).not.toBeNull()
    expect(recoveryPath).toBe(`${project.projectDir}/.autosave/design.json`)

    // Apply the recovery: read the autosave file, swap into the loaded
    // project's design, and verify it matches the pre-crash state
    // (3 original + 2 extra = 5 heads).
    const fs = _getFsAdapter()
    const autosaved = JSON.parse(await fs.readText(recoveryPath as string))
    reopened.design = autosaved
    const restoredHeads = (
      reopened.design.systems[0] as unknown as { heads: unknown[] }
    ).heads.length
    expect(restoredHeads).toBe(5)
  })

  test('3. undo past pipeline stage: intake txn + heads txn → undo removes heads only', async ({
    page,
  }) => {
    await page.goto('/')
    await page.waitForFunction(
      () => !!(window as any).__hfScene && !!(window as any).__hfUndo,
      null,
      { timeout: 10_000 },
    )
    // Let SceneBootstrap seed the default site / building / level.
    await page.waitForTimeout(500)

    const result = await page.evaluate(() => {
      const hf = (window as any).__hfScene
      const hu = (window as any).__hfUndo

      const level = Object.values(hf.getState().nodes).find(
        (n: any) => n.type === 'level',
      ) as any
      if (!level) return { err: 'no level' }

      hu.clear()
      const baseHistory = hu.getHistory().length

      const mkHead = (id: string, x: number) => ({
        id,
        type: 'item',
        position: [x, 1, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        children: [],
        parentId: level.id,
        asset: {
          id: 'rt',
          category: 'sprinkler_head_pendant',
          name: 'rt',
          thumbnail: '',
          dimensions: [0.4, 0.4, 0.4],
          src: '',
          attachTo: 'ceiling',
          offset: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          tags: ['halofire'],
        },
        metadata: { tags: ['halofire'] },
      })

      // Stage 1: a pipeline:intake-like txn that creates a building
      // marker node. We use a real scene-store mutation (createNode
      // against the default level) rather than wiring up
      // translateDesignToScene — the txn/undo contract is the same.
      const bldgId = `r56_bldg_${Date.now()}`
      hu.txn('pipeline:intake', () => {
        hf.createNode(
          {
            ...mkHead(bldgId, 0),
            // re-tag as a "building marker" via metadata so we can
            // assert it's still present after undoing the heads stage.
            metadata: { tags: ['halofire', 'r56-bldg'] },
          },
          level.id,
        )
      })
      const afterIntakeHistory = hu.getHistory().length

      // Stage 2: a place-heads txn adding 3 heads.
      const headIds = [
        `r56_h_${Date.now()}_a`,
        `r56_h_${Date.now()}_b`,
        `r56_h_${Date.now()}_c`,
      ]
      hu.txn('place heads', () => {
        for (let i = 0; i < headIds.length; i += 1) {
          hf.createNode(mkHead(headIds[i], 2 + i * 2), level.id)
        }
      })
      const afterHeadsHistory = hu.getHistory().length

      const allPresent =
        bldgId in hf.getState().nodes &&
        headIds.every((id) => id in hf.getState().nodes)

      // Undo — should revert the heads txn only.
      hu.undo()
      const bldgStillPresent = bldgId in hf.getState().nodes
      const headsStillPresent = headIds.some(
        (id) => id in hf.getState().nodes,
      )

      // Redo — heads come back.
      hu.redo()
      const allPresentAfterRedo =
        bldgId in hf.getState().nodes &&
        headIds.every((id) => id in hf.getState().nodes)

      // Cleanup
      hf.deleteNode(bldgId)
      for (const id of headIds) {
        if (id in hf.getState().nodes) hf.deleteNode(id)
      }

      return {
        intakeDelta: afterIntakeHistory - baseHistory,
        headsDelta: afterHeadsHistory - afterIntakeHistory,
        allPresent,
        bldgStillPresent,
        headsStillPresent,
        allPresentAfterRedo,
      }
    })

    expect(result.err).toBeUndefined()
    // Each txn is exactly one history frame.
    expect(result.intakeDelta).toBe(1)
    expect(result.headsDelta).toBe(1)
    expect(result.allPresent).toBe(true)
    // One undo reverts only the place-heads stage.
    expect(result.bldgStillPresent).toBe(true)
    expect(result.headsStillPresent).toBe(false)
    // Redo reapplies the heads stage.
    expect(result.allPresentAfterRedo).toBe(true)
  })

  test('4. corrections round-trip: appendCorrection → save → load → jsonl has entry', async () => {
    const project = await createProject({
      parentDir: PARENT,
      name: 'Corrections',
      address: '400 Main',
      firm: 'Halo',
      designer: 'Wade',
    })
    await appendCorrection(project, {
      type: 'wall.delete',
      wall_id: 'xxx',
      at: '2026-04-21T00:00:00Z',
    })
    await saveProject(project)

    // Reopen and verify the corrections.jsonl line is present.
    const reopened = await loadProject(project.projectDir)
    const fs = _getFsAdapter()
    const raw = await fs.readText(reopened.correctionsPath)
    const lines = raw.trim().split('\n').filter(Boolean)
    expect(lines).toHaveLength(1)
    const entry = JSON.parse(lines[0]!)
    expect(entry.type).toBe('wall.delete')
    expect(entry.wall_id).toBe('xxx')
    expect(entry.at).toBe('2026-04-21T00:00:00Z')
  })

  test('5. audit entries: 3 saveProject calls append 3 save entries', async () => {
    const project = await createProject({
      parentDir: PARENT,
      name: 'AuditLog',
      address: '500 Main',
      firm: 'Halo',
      designer: 'Wade',
    })
    await saveProject(project)
    await saveProject(project)
    await saveProject(project)

    const fs = _getFsAdapter()
    const raw = await fs.readText(`${project.projectDir}/audit.jsonl`)
    const lines = raw.trim().split('\n').filter(Boolean)
    const actions = lines.map((l) => JSON.parse(l).action as string)
    const saveCount = actions.filter((a) => a === 'save').length
    expect(saveCount).toBe(3)
    // createProject also writes a 'create' entry.
    expect(actions.filter((a) => a === 'create').length).toBe(1)
  })

  test('6. version mismatch: schema_version 99 → ProjectLoadError({code:"too-new"})', async () => {
    const project = await createProject({
      parentDir: PARENT,
      name: 'Future',
      address: '600 Main',
      firm: 'Halo',
      designer: 'Wade',
    })
    const fs = _getFsAdapter()
    const mPath = `${project.projectDir}/manifest.json`
    const raw = JSON.parse(await fs.readText(mPath))
    raw.schema_version = 99
    await fs.writeTextAtomic(mPath, JSON.stringify(raw))

    let caught: ProjectLoadError | null = null
    try {
      await loadProject(project.projectDir)
    } catch (err) {
      caught = err as ProjectLoadError
    }
    expect(caught).not.toBeNull()
    expect(caught).toBeInstanceOf(ProjectLoadError)
    expect(caught?.code).toBe('too-new')
  })
})

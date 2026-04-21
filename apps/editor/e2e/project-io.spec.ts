/**
 * project-io (R5.2) — create/load/save/autosave/audit tests.
 *
 * These run in the Playwright Node runner against the in-memory FS
 * adapter shipped with `apps/editor/lib/project-io.ts`. The browser
 * is not needed: all I/O flows through the adapter, so we can import
 * and exercise the module directly.
 *
 * A real Tauri FS adapter lands in R10.3/R10.4; these tests will be
 * re-run against it then.
 *
 * The 8 contracts covered (per the R5.2 prompt):
 *   1. createProject writes a manifest with schema_version: 1.
 *   2. loadProject round-trips a created project.
 *   3. saveProject is atomic — an interrupted rename leaves the
 *      previous on-disk state intact.
 *   4. autosaveProject writes to .autosave/design.json, not
 *      design/current.json.
 *   5. checkAutosaveRecovery returns the autosave path when it is
 *      newer than current.json.
 *   6. loadProject throws ProjectLoadError code='too-new' for a
 *      manifest with schema_version: 99.
 *   7. appendCorrection atomic-appends a JSONL line.
 *   8. appendAudit records the correct ts/actor/action triple.
 */
import { expect, test } from '@playwright/test'
import {
  _getFsAdapter,
  _setFsAdapter,
  appendAudit,
  appendCorrection,
  autosaveProject,
  checkAutosaveRecovery,
  createMemoryFsAdapter,
  createProject,
  loadProject,
  ProjectLoadError,
  saveProject,
  type FsAdapter,
} from '../lib/project-io'

const PARENT = '/tmp/hfproj-tests'

test.describe('project-io — .hfproj lifecycle', () => {
  test.beforeEach(() => {
    // Fresh in-memory fs per test so state never leaks across.
    _setFsAdapter(createMemoryFsAdapter())
  })

  test('1. createProject writes manifest with schema_version: 1', async () => {
    const project = await createProject({
      parentDir: PARENT,
      name: 'Warehouse B',
      address: '100 Industrial Way',
      firm: 'Halo Fire Protection',
      designer: 'W. Steele',
    })
    expect(project.manifest.schema_version).toBe(1)
    expect(project.manifest.name).toBe('Warehouse B')
    expect(project.manifest.project_id).toMatch(/^hfp_/)
    expect(project.projectDir).toContain('Warehouse_B.hfproj')

    const fs = _getFsAdapter()
    const raw = await fs.readText(`${project.projectDir}/manifest.json`)
    const parsed = JSON.parse(raw)
    expect(parsed.schema_version).toBe(1)
    expect(parsed.units).toBe('imperial')
    expect(parsed.code_edition).toBe('NFPA 13 2022')
  })

  test('2. loadProject round-trips a created project', async () => {
    const created = await createProject({
      parentDir: PARENT,
      name: 'Round Trip',
      address: '1 Main',
      firm: 'Halo',
      designer: 'Ada',
    })
    const loaded = await loadProject(created.projectDir)
    expect(loaded.manifest.project_id).toBe(created.manifest.project_id)
    expect(loaded.manifest.name).toBe('Round Trip')
    expect(loaded.design.project.id).toBe(created.manifest.project_id)
    expect(loaded.design.systems).toEqual([])
    expect(loaded.correctionsPath).toBe(
      `${created.projectDir}/corrections.jsonl`,
    )
  })

  test('3. saveProject is atomic — interrupted rename leaves prior state', async () => {
    const project = await createProject({
      parentDir: PARENT,
      name: 'Atomic',
      address: '2 Main',
      firm: 'Halo',
      designer: 'Ada',
    })
    const fs = _getFsAdapter() as FsAdapter
    const designPath = `${project.projectDir}/design/current.json`
    const before = await fs.readText(designPath)

    // Mutate in memory, then arrange a rename-time crash. A proper
    // atomic write must leave `current.json` untouched — the tmp
    // file may remain, but the visible state must be the prior one.
    project.design.issues.push({
      severity: 'warning',
      code: 'TEST',
      message: 'should not land',
    })

    fs._setRenameHook?.((from, _to) => {
      // Simulate a mid-rename power loss ONLY for current.json.
      if (from.endsWith('design/current.json.tmp')) {
        throw new Error('simulated crash during rename')
      }
    })

    let crashed = false
    try {
      await saveProject(project)
    } catch {
      crashed = true
    }
    expect(crashed).toBe(true)

    fs._setRenameHook?.(null)
    const after = await fs.readText(designPath)
    expect(after).toBe(before)
  })

  test('4. autosaveProject writes to .autosave/design.json only', async () => {
    const project = await createProject({
      parentDir: PARENT,
      name: 'Auto',
      address: '3 Main',
      firm: 'Halo',
      designer: 'Ada',
    })
    const fs = _getFsAdapter()
    const currentBefore = await fs.readText(
      `${project.projectDir}/design/current.json`,
    )
    const manifestBefore = await fs.readText(
      `${project.projectDir}/manifest.json`,
    )

    project.design.issues.push({
      severity: 'info',
      code: 'AUTO',
      message: 'live edit',
    })
    await autosaveProject(project)

    expect(await fs.exists(`${project.projectDir}/.autosave/design.json`)).toBe(
      true,
    )
    // current.json and manifest.json must not move during autosave.
    expect(
      await fs.readText(`${project.projectDir}/design/current.json`),
    ).toBe(currentBefore)
    expect(await fs.readText(`${project.projectDir}/manifest.json`)).toBe(
      manifestBefore,
    )

    const autosaveRaw = await fs.readText(
      `${project.projectDir}/.autosave/design.json`,
    )
    const autosave = JSON.parse(autosaveRaw)
    expect(autosave.issues).toHaveLength(1)
    expect(autosave.issues[0].code).toBe('AUTO')
  })

  test('5. checkAutosaveRecovery returns path when autosave is newer', async () => {
    const project = await createProject({
      parentDir: PARENT,
      name: 'Recover',
      address: '4 Main',
      firm: 'Halo',
      designer: 'Ada',
    })
    // Fresh project: no autosave yet → null.
    expect(await checkAutosaveRecovery(project.projectDir)).toBeNull()

    await autosaveProject(project)
    const path = await checkAutosaveRecovery(project.projectDir)
    expect(path).toBe(`${project.projectDir}/.autosave/design.json`)

    // After a full save, current.json is newer → recovery not needed.
    await saveProject(project)
    expect(await checkAutosaveRecovery(project.projectDir)).toBeNull()
  })

  test('6. loadProject throws too-new for schema_version 99', async () => {
    const project = await createProject({
      parentDir: PARENT,
      name: 'FromFuture',
      address: '5 Main',
      firm: 'Halo',
      designer: 'Ada',
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

  test('7. appendCorrection atomic-appends to corrections.jsonl', async () => {
    const project = await createProject({
      parentDir: PARENT,
      name: 'Corrections',
      address: '6 Main',
      firm: 'Halo',
      designer: 'Ada',
    })
    await appendCorrection(project, {
      type: 'wall.delete',
      wall_id: 'w_01',
      at: '2026-04-21T00:00:00Z',
      by: 'Ada',
    })
    await appendCorrection(project, {
      type: 'head.add',
      sku: 'TY3151',
      pos: [1, 2, 3],
      at: '2026-04-21T00:01:00Z',
      by: 'Ada',
    })

    const fs = _getFsAdapter()
    const raw = await fs.readText(project.correctionsPath)
    const lines = raw.trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0]!).type).toBe('wall.delete')
    expect(JSON.parse(lines[1]!).type).toBe('head.add')
    expect(JSON.parse(lines[1]!).pos).toEqual([1, 2, 3])
  })

  test('8. appendAudit records correct ts + actor + action', async () => {
    const project = await createProject({
      parentDir: PARENT,
      name: 'Audit',
      address: '7 Main',
      firm: 'Halo',
      designer: 'Ada',
    })
    const ts = '2026-04-21T12:34:56Z'
    await appendAudit(project, {
      ts,
      actor: 'Ada',
      action: 'stamp',
      target: project.manifest.project_id,
      reason: 'PE sign-off',
    })

    const fs = _getFsAdapter()
    const raw = await fs.readText(`${project.projectDir}/audit.jsonl`)
    const lines = raw.trim().split('\n')
    // createProject already wrote a 'create' entry; the new one is last.
    const last = JSON.parse(lines[lines.length - 1]!)
    expect(last.ts).toBe(ts)
    expect(last.actor).toBe('Ada')
    expect(last.action).toBe('stamp')
    expect(last.reason).toBe('PE sign-off')
  })
})

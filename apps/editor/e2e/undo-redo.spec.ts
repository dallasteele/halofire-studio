/**
 * R5.4 + R5.5 — transactions.txn / undo / redo + UndoStack keyboard.
 *
 * Covers:
 *  1. txn('Add head', fn) produces exactly ONE history entry.
 *  2. undo() after the txn reverts the createNode (node not in scene).
 *  3. redo() reapplies it.
 *  4. Nested txn collapses to one entry.
 *  5. Ctrl-Z global keydown triggers undo (via UndoStack component).
 */
import { expect, test } from '@playwright/test'

const primeScene = async (page: import('@playwright/test').Page) => {
  await page.goto('/')
  await page.waitForFunction(
    () => !!(window as any).__hfScene && !!(window as any).__hfUndo,
    null,
    { timeout: 10_000 },
  )
  // Let SceneBootstrap seed the default building / site / level.
  await page.waitForTimeout(500)
}

test.describe('R5.4 + R5.5 — txn / undo / redo', () => {
  test('1. txn produces exactly one history entry', async ({ page }) => {
    await primeScene(page)
    const result = await page.evaluate(() => {
      const hf = (window as any).__hfScene
      const hu = (window as any).__hfUndo
      const level = Object.values(hf.getState().nodes).find(
        (n: any) => n.type === 'level',
      ) as any
      if (!level) return { err: 'no level' }
      hu.clear()
      const before = hu.getHistory().length
      const id = 'txn_one_' + Date.now()
      hu.txn('Add head', () => {
        hf.createNode(
          {
            id,
            type: 'item',
            position: [0, 1, 0],
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
          },
          level.id,
        )
      })
      const after = hu.getHistory().length
      const exists = id in hf.getState().nodes
      // cleanup
      if (exists) hf.deleteNode(id)
      return { before, after, exists }
    })
    expect(result.err).toBeUndefined()
    expect(result.exists).toBe(true)
    expect(result.after - result.before).toBe(1)
  })

  test('2. undo after txn reverts createNode', async ({ page }) => {
    await primeScene(page)
    const result = await page.evaluate(() => {
      const hf = (window as any).__hfScene
      const hu = (window as any).__hfUndo
      const level = Object.values(hf.getState().nodes).find(
        (n: any) => n.type === 'level',
      ) as any
      const id = 'txn_undo_' + Date.now()
      hu.txn('Add head', () => {
        hf.createNode(
          {
            id,
            type: 'item',
            position: [0, 1, 0],
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
          },
          level.id,
        )
      })
      const beforeUndo = id in hf.getState().nodes
      hu.undo()
      const afterUndo = id in hf.getState().nodes
      return { beforeUndo, afterUndo }
    })
    expect(result.beforeUndo).toBe(true)
    expect(result.afterUndo).toBe(false)
  })

  test('3. redo reapplies', async ({ page }) => {
    await primeScene(page)
    const result = await page.evaluate(() => {
      const hf = (window as any).__hfScene
      const hu = (window as any).__hfUndo
      const level = Object.values(hf.getState().nodes).find(
        (n: any) => n.type === 'level',
      ) as any
      const id = 'txn_redo_' + Date.now()
      hu.txn('Add head', () => {
        hf.createNode(
          {
            id,
            type: 'item',
            position: [0, 1, 0],
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
          },
          level.id,
        )
      })
      hu.undo()
      const afterUndo = id in hf.getState().nodes
      hu.redo()
      const afterRedo = id in hf.getState().nodes
      // cleanup
      if (afterRedo) hf.deleteNode(id)
      return { afterUndo, afterRedo }
    })
    expect(result.afterUndo).toBe(false)
    expect(result.afterRedo).toBe(true)
  })

  test('4. nested txn collapses to one history entry', async ({ page }) => {
    await primeScene(page)
    const result = await page.evaluate(() => {
      const hf = (window as any).__hfScene
      const hu = (window as any).__hfUndo
      const level = Object.values(hf.getState().nodes).find(
        (n: any) => n.type === 'level',
      ) as any
      hu.clear()
      const before = hu.getHistory().length
      const idA = 'nested_a_' + Date.now()
      const idB = 'nested_b_' + Date.now()
      const mk = (id: string) => ({
        id,
        type: 'item',
        position: [0, 1, 0],
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
      hu.txn('Outer', () => {
        hf.createNode(mk(idA), level.id)
        hu.txn('Inner', () => {
          hf.createNode(mk(idB), level.id)
        })
      })
      const after = hu.getHistory().length
      const bothExist =
        idA in hf.getState().nodes && idB in hf.getState().nodes
      // One undo should remove both
      hu.undo()
      const neitherExists =
        !(idA in hf.getState().nodes) && !(idB in hf.getState().nodes)
      return { delta: after - before, bothExist, neitherExists }
    })
    expect(result.bothExist).toBe(true)
    expect(result.delta).toBe(1)
    expect(result.neitherExists).toBe(true)
  })

  test('5. Ctrl-Z global keydown triggers undo', async ({ page }) => {
    await primeScene(page)
    // Create node inside a txn, then simulate Ctrl-Z.
    const id = await page.evaluate(() => {
      const hf = (window as any).__hfScene
      const hu = (window as any).__hfUndo
      const level = Object.values(hf.getState().nodes).find(
        (n: any) => n.type === 'level',
      ) as any
      const id = 'kbd_undo_' + Date.now()
      hu.txn('Add head', () => {
        hf.createNode(
          {
            id,
            type: 'item',
            position: [0, 1, 0],
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
          },
          level.id,
        )
      })
      return id
    })
    const beforeKbd = await page.evaluate(
      (nid) => nid in (window as any).__hfScene.getState().nodes,
      id,
    )
    expect(beforeKbd).toBe(true)
    // Simulate Ctrl-Z on the page body (not focused inputs)
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(100)
    const afterKbd = await page.evaluate(
      (nid) => nid in (window as any).__hfScene.getState().nodes,
      id,
    )
    expect(afterKbd).toBe(false)
  })
})

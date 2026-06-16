import assert from 'node:assert/strict'
import test from 'node:test'

import { submittalSheetData } from './submittalData.mjs'

test('submittalSheetData returns cloned submittal fields and nested hydraulic report', () => {
  const project = { name: 'Test' }
  const bom = [{ id: 'valve1' }]
  const hydraulics = { demandGpm: 10, demandPsi: 20, safetyMarginPct: 10 }

  const result = submittalSheetData({ project, bom, hydraulics })

  assert.deepStrictEqual(result, {
    project: { name: 'Test' },
    bom: [{ id: 'valve1' }],
    hydraulics: {
      demandGpm: 10,
      demandPsi: 20,
      safetyMarginPct: 10,
      report: {
        demandGpm: 10,
        demandPsi: 20,
        safetyMarginPct: 10,
        requiredPressurePsi: 22,
        totalPressurePsi: 42,
        flowRateGpm: 10,
        pressureDropPsi: 20,
      },
    },
  })

  assert.notStrictEqual(result.project, project)
  assert.notStrictEqual(result.bom, bom)
  assert.notStrictEqual(result.bom[0], bom[0])
  assert.notStrictEqual(result.hydraulics, hydraulics)
})

test('submittalSheetData does not retain references to nested project or bom entries', () => {
  const input = {
    project: { name: 'Test', metadata: { revision: 1 } },
    bom: [{ id: 'valve1', tags: ['trim'] }],
    hydraulics: { demandGpm: 10, demandPsi: 20, safetyMarginPct: 10 },
  }

  const result = submittalSheetData(input)

  input.project.metadata.revision = 2
  input.bom[0].tags.push('field')
  input.hydraulics.demandGpm = 99

  assert.deepStrictEqual(result.project, {
    name: 'Test',
    metadata: { revision: 1 },
  })
  assert.deepStrictEqual(result.bom, [{ id: 'valve1', tags: ['trim'] }])
  assert.deepStrictEqual(result.hydraulics.report, {
    demandGpm: 10,
    demandPsi: 20,
    safetyMarginPct: 10,
    requiredPressurePsi: 22,
    totalPressurePsi: 42,
    flowRateGpm: 10,
    pressureDropPsi: 20,
  })
})

import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { evaluateNewHopeNativeHangerSchedule } from '../src/engine/new-hope-native-hanger-schedule.js'

const read = (name) =>
  JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'))
const inputs = {
  schedule: read('new-hope-native-fab-hanger-schedule.json'),
  purchasedSupportComponents: read('new-hope-purchased-support-components.json'),
}

describe('New Hope native hanger schedule', () => {
  it('crosswalks all 212 native hangers to exact purchased Fig. 69 size variants', () => {
    const result = evaluateNewHopeNativeHangerSchedule(inputs)
    expect(result.status).toBe('schedule-crosswalk-passed-installed-geometry-blocked')
    expect(result.issues).toEqual([])
    expect(result.metrics).toEqual({
      scheduleRowCount: 76,
      nativeHangerQuantity: 212,
      lineCount: 57,
      nominalSizeCount: 5,
      purchaseBoundProductCount: 5,
      assignmentRowCount: 76,
    })
    expect(result.assignments.filter((entry) => entry.lineName === 'CMI')).toHaveLength(4)
    expect(
      result.assignments
        .filter((entry) => entry.lineName === 'CMI')
        .reduce((sum, entry) => sum + entry.quantity, 0),
    ).toBe(28)
    expect(result.nativeHangerScheduleReady).toBe(true)
    expect(result.perLineNominalPipeSizeAssignmentReady).toBe(true)
    expect(result.purchaseBoundCatalogDimensionAssignmentReady).toBe(true)
    expect(result.exactInstalledPlacementReady).toBe(false)
    expect(result.manufacturerPartSolidReady).toBe(false)
    expect(result.exactThreadGeometryReady).toBe(false)
    expect(result.matingAssemblyReady).toBe(false)
    expect(result.supportModelReleaseReady).toBe(false)
  })

  it.each([
    [
      'source hash',
      (copy) => {
        copy.schedule.source.memberSha256 = 'BAD'
      },
      'NH_NATIVE_HANGER_SOURCE_INVALID',
    ],
    [
      'native quantity',
      (copy) => {
        copy.schedule.records[0].quantity += 1
      },
      'NH_NATIVE_HANGER_SIZE_QUANTITY_INVALID',
    ],
    [
      'native size code',
      (copy) => {
        copy.schedule.records[0].sizeCode = 999
      },
      'NH_NATIVE_HANGER_RECORD_INVALID',
    ],
    [
      'purchased product',
      (copy) => {
        copy.purchasedSupportComponents.components.find(
          (entry) => entry.family === 'ring-hanger',
        ).productNumber = 'BAD'
      },
      'NH_NATIVE_HANGER_CATALOG_CROSSWALK_INVALID',
    ],
    [
      'false thread promotion',
      (copy) => {
        copy.schedule.claims.exactThreadGeometryReady = true
      },
      'NH_NATIVE_HANGER_FALSE_READINESS_PROMOTION',
    ],
  ])('fails closed on %s drift', (_name, mutate, expectedCode) => {
    const copy = structuredClone(inputs)
    mutate(copy)
    const result = evaluateNewHopeNativeHangerSchedule(copy)
    expect(result.status).toBe('blocked')
    expect(result.blockerCodes).toContain(expectedCode)
    expect(result.nativeHangerScheduleReady).toBe(false)
    expect(result.supportModelReleaseReady).toBe(false)
  })
})

import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (name) => JSON.parse(
  fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'),
)
const evidence = read('new-hope-asbuilt-riser-station-evidence.json')
const registration = read('new-hope-asbuilt-source-feed-riser-registration.json')

describe('New Hope as-built cross-sheet riser station extraction', () => {
  it('reproduces one identical FP1.0/FP2.0 primitive and exact shared endpoint', () => {
    expect(evidence).toMatchObject({
      artifactType: 'halofire.new-hope-asbuilt-riser-station-evidence.v1',
      projectId: 'new-hope-crisis-center-brigham-city-ut',
      source: {
        sha256: 'ED00E9530C02217BC50EAD2FC3391938E731253949B728B31ED1336F8000F34B',
        pageBoxPdfPt: { width: 3024, height: 2160 },
      },
      primitive: {
        normalizedSha256: 'DD2882F7742CFAA5FF5E557C8ACFDED8AD257A7A552743A1FE8B93D1B6D93D7D',
        itemCount: 24,
        rectPdfPt: [660.474854, 1116.084595, 660.674561, 1120.94043],
        planStationPdfPt: [660.674561, 1118.512451],
        crossSheetCoordinateResidualPt: 0,
      },
      claims: {
        identicalCrossSheetRiserPrimitiveReady: true,
        exactRiserPlanStationReady: true,
        installedGradeReady: false,
        fabricationReady: false,
        fieldReleaseReady: false,
      },
    })
    expect(evidence.primitive.sheets).toEqual([
      expect.objectContaining({ physicalPage: 3, sheet: 'FP1.0', drawingIndex: 53184 }),
      expect.objectContaining({ physicalPage: 4, sheet: 'FP2.0', drawingIndex: 3511 }),
    ])
    expect(new Set(evidence.primitive.sheets.map((entry) => entry.normalizedSha256)).size).toBe(1)
  })

  it('matches the runtime registration consumed by the layout evaluator', () => {
    const registered = registration.fp10RiserEvidence.crossSheetRiserPrimitive
    expect(registered.normalizedSha256).toBe(evidence.primitive.normalizedSha256)
    expect(registered.itemCount).toBe(evidence.primitive.itemCount)
    expect(Object.values(registered.rectPdfPt)).toEqual(evidence.primitive.rectPdfPt)
    expect(Object.values(registered.planStationPdfPt)).toEqual(evidence.primitive.planStationPdfPt)
    expect(registered.crossSheetCoordinateResidualPt).toBe(evidence.primitive.crossSheetCoordinateResidualPt)
  })
})

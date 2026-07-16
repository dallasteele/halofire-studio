import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { evaluateNewHopeFabricationEndSchedule } from '../src/engine/new-hope-fabrication-end-schedule.js'

const schedule = JSON.parse(
  fs.readFileSync(new URL('../src/data/new-hope-fabrication-end-schedule.json', import.meta.url), 'utf8'),
)

describe('New Hope complete listed pipe-end schedule', () => {
  it('binds every listed pipe definition, end, and exact threaded size without promoting installed geometry', () => {
    const result = evaluateNewHopeFabricationEndSchedule(schedule)
    expect(result.status).toBe('passed')
    expect(result.coverage).toMatchObject({
      weldedPieceDefinitionCount: 158,
      weldedFabricatedUnitCount: 164,
      threadedPieceDefinitionCount: 99,
      threadedFabricatedUnitCount: 100,
      totalListedPipePieceDefinitionCount: 257,
      totalFabricatedPipeUnitCount: 264,
      threadedEndPreparationCounts: { 'T-G': 1, 'T-T': 98 },
      threadedFittingSizeCounts: { '1': 61, '1 x \u00bd': 16, '1 x \u00be': 20, none: 2 },
    })
    expect(result.allListedPieceEndPreparationsReady).toBe(true)
    expect(result.allWeldedEndFittingFamiliesReady).toBe(true)
    expect(result.allThreadedEndFittingFamiliesReady).toBe(true)
    expect(result.exactThreadedFittingSizesReady).toBe(true)
    expect(result.interPieceFittingTopologyReady).toBe(false)
    expect(result.verticalOffsetScheduleReady).toBe(false)
    expect(result.completeFittingScheduleReady).toBe(false)
    expect(result.fabricationReady).toBe(false)
    expect(result.fieldReleaseReady).toBe(false)
  })

  const mutations = [
    ['source hash', (copy) => { copy.source.sha256 = '0'.repeat(64) }, 'NH_FAB_END_SOURCE_INVALID'],
    ['welded identity', (copy) => { copy.weldedPieces[0].pieceId = 'BL01.99' }, 'NH_FAB_END_WELDED_SCHEDULE_INVALID'],
    ['welded end prep', (copy) => { copy.weldedPieces[0].endPreparation = ['T', 'G'] }, 'NH_FAB_END_WELDED_SCHEDULE_INVALID'],
    ['threaded fitting family', (copy) => { copy.threadedPieces[0].endFittingFamily = 'no-fitting' }, 'NH_FAB_END_THREADED_SCHEDULE_INVALID'],
    ['threaded quantity', (copy) => { copy.threadedPieces[0].quantity = 2 }, 'NH_FAB_END_THREADED_SCHEDULE_INVALID'],
    ['half-inch fraction drift', (copy) => { const piece = copy.threadedPieces.find((entry) => entry.fittingSizeText === '1 x \u00bd'); piece.fittingSizeText = '1 x \u00be' }, 'NH_FAB_END_THREADED_SIZES_INVALID'],
    ['three-quarter port drift', (copy) => { const piece = copy.threadedPieces.find((entry) => entry.fittingSizeText === '1 x \u00be'); piece.nominalPortSizesIn = [1, 0.5] }, 'NH_FAB_END_THREADED_SIZES_INVALID'],
    ['tee port cardinality', (copy) => { const piece = copy.threadedPieces.find((entry) => entry.endFittingFamily === 'threaded-straight-tee'); piece.nominalPortSizesIn = [1, 1] }, 'NH_FAB_END_THREADED_SIZES_INVALID'],
    ['size coverage drift', (copy) => { copy.coverage.threadedFittingSizeCounts['1 x \u00bd'] = 15 }, 'NH_FAB_END_THREADED_SIZES_INVALID'],
    ['fraction boundary', (copy) => { copy.extractionBoundary.embeddedFractionGlyphsLossless = false }, 'NH_FAB_END_THREADED_SIZES_INVALID'],
    ['false fitting size demotion', (copy) => { copy.claims.exactThreadedFittingSizesReady = false }, 'NH_FAB_END_FALSE_READINESS_PROMOTION'],
    ['false vertical offsets', (copy) => { copy.claims.verticalOffsetScheduleReady = true }, 'NH_FAB_END_FALSE_READINESS_PROMOTION'],
    ['false release', (copy) => { copy.claims.fieldReleaseReady = true }, 'NH_FAB_END_FALSE_READINESS_PROMOTION'],
  ]
  it.each(mutations)('rejects %s drift', (_name, mutate, code) => {
    const copy = structuredClone(schedule)
    mutate(copy)
    const result = evaluateNewHopeFabricationEndSchedule(copy)
    expect(result.status).toBe('blocked')
    expect(result.blockerCodes).toContain(code)
    expect(result.allListedPieceEndPreparationsReady).toBe(false)
  })
})

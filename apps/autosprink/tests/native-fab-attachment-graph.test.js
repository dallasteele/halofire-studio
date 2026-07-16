import { describe, expect, it } from 'vitest'
import fs from 'node:fs'

import { evaluateNativeFabAttachmentGraph } from '../src/engine/native-fab-attachment-graph.js'

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'))
const inputs = {
  graph: read('new-hope-native-fab-attachment-graph.json'),
  fabricationSchedule: read('new-hope-fabrication-end-schedule.json'),
  parserControl: read('new-hope-native-fab-topology.json'),
}

describe('native FAB attachment graph', () => {
  it('binds every native parent edge and all 97 fitting identities to the approved listing', () => {
    const result = evaluateNativeFabAttachmentGraph(inputs)
    expect(result.status).toBe('passed')
    expect(result.metrics).toEqual({
      lines: 66,
      pipes: 272,
      outlets: 293,
      fittings: 97,
      lineToPipeEdges: 272,
      pipeToOutletEdges: 293,
      pipeToFittingEdges: 97,
      listedFittingIdentityCount: 97,
      familyCounts: {
        'threaded-reducer': 30,
        'threaded-straight-tee': 4,
        'threaded-90-reducing-elbow': 6,
        'threaded-90-elbow': 57,
      },
    })
    expect(result.fittingAttachments).toHaveLength(97)
    expect(result.nativeAttachmentGraphReady).toBe(true)
    expect(result.listedFittingIdentityCoverageReady).toBe(true)
    expect(result.interPieceAdjacencyReady).toBe(false)
    expect(result.exactFittingTakeoutReady).toBe(false)
    expect(result.properPipeLayoutReady).toBe(false)
  })

  it.each([
    ['pipe parent', (copy) => { copy.graph.records.pipes[0].parentId = 9999 }, 'NATIVE_FAB_GRAPH_LINE_PIPE_PARENT_UNRESOLVED'],
    ['fitting edge', (copy) => { copy.graph.edges.pipeToFitting[0].fromPipeUniqueId = 9999 }, 'NATIVE_FAB_GRAPH_PIPE_FITTING_EDGE_DRIFT'],
    ['listing identity', (copy) => { copy.fabricationSchedule.threadedPieces.find((piece) => piece.endFittingFamily !== 'no-fitting').endFittingFamily = 'no-fitting' }, 'NATIVE_FAB_GRAPH_LISTING_IDENTITY_UNRESOLVED'],
    ['cross-project visual control', (copy) => { copy.parserControl.crossProjectListingControl.fittingIdentities[0].itemCode = 9999 }, 'NATIVE_FAB_GRAPH_CROSS_PROJECT_CONTROL_INVALID'],
    ['false inter-piece promotion', (copy) => { copy.graph.claims.interPieceAdjacencyReady = true }, 'NATIVE_FAB_GRAPH_FALSE_READINESS_PROMOTION'],
    ['false takeout promotion', (copy) => { copy.graph.claims.exactFittingTakeoutReady = true }, 'NATIVE_FAB_GRAPH_FALSE_READINESS_PROMOTION'],
  ])('fails closed on %s drift', (_name, mutate, expectedCode) => {
    const copy = structuredClone(inputs)
    mutate(copy)
    const result = evaluateNativeFabAttachmentGraph(copy)
    expect(result.status).toBe('blocked')
    expect(result.blockerCodes).toContain(expectedCode)
    expect(result.nativeAttachmentGraphReady).toBe(false)
    expect(result.properPipeLayoutReady).toBe(false)
  })
})

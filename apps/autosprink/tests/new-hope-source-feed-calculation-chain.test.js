import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { canonicalizeApprovedFp20Topology } from '../src/engine/approved-fp20-canonical-topology.js'
import { evaluateApprovedFp20GovernedSkeleton } from '../src/engine/approved-fp20-governed-skeleton.js'
import { evaluateNewHopeSourceFeedCalculationChain } from '../src/engine/new-hope-source-feed-calculation-chain.js'
import { evaluateNewHopeSourceFeedFabrication } from '../src/engine/new-hope-source-feed-fabrication.js'

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'))
const pipeVectors = read('new-hope-approved-fp20-pipe-vectors.json')
const planGraph = read('new-hope-approved-fp20-plan-graph.json')
const operationalAnnotations = read('new-hope-approved-fp20-operational-annotations.json')
const nativeFabTopology = read('new-hope-native-fab-topology.json')
const hydraulicRoutes = ['2-1', '2-2', '2-3'].map((id) => read(`new-hope-approved-fp20-hydraulic-route-${id}.json`))
const canonicalTopology = canonicalizeApprovedFp20Topology(planGraph)
const governedSkeleton = evaluateApprovedFp20GovernedSkeleton(pipeVectors, planGraph, operationalAnnotations)
const sourceFeedFabrication = evaluateNewHopeSourceFeedFabrication({ canonicalTopology, governedSkeleton, operationalAnnotations, hydraulicRoutes, nativeFabTopology })
const inputs = { hydraulicRoutes, sourceFeedFabrication }

describe('New Hope source-feed approved calculation/device chain', () => {
  it('binds the repeated node-118 to BOR, butterfly-valve, and backflow chain without inventing installed XY or grade', () => {
    const result = evaluateNewHopeSourceFeedCalculationChain(inputs)
    expect(result.status).toBe('passed')
    expect(result.calculationPorts).toHaveLength(4)
    expect(result.calculationLegs).toHaveLength(3)
    expect(result.sourceOutletToBaseOfRiserDeltaZFt).toBe(6.041667)
    expect(result.sourceOutletToBaseOfRiserPhysicalLengthFt).toBe(8.416667)
    expect(result.calculationChainReady).toBe(true)
    expect(result.baseOfRiserEndpointZReady).toBe(true)
    expect(result.dryPipeValveIdentityReady).toBe(true)
    expect(result.downstreamValveBackflowElevationChainReady).toBe(true)
    expect(result.exactCalculationElevationPortCount).toBe(4)
    expect(result.exactPlanBoundCalculationPortCount).toBe(1)
    expect(result.exactExternalCalculationPortCount).toBe(3)
    expect(result.concealedPlanXyReady).toBe(false)
    expect(result.fabricationPieceToCalculationLegDecompositionReady).toBe(false)
    expect(result.installedGradeReady).toBe(false)
    expect(result.sourceFeed3dPathReady).toBe(false)
  })

  it.each([
    ['source hash', (copy) => { copy.hydraulicRoutes[0].sourceBindings.hydraulicCalculation.sha256 = 'BAD' }, 'NH_SOURCE_CHAIN_CALCULATION_SOURCE_INVALID'],
    ['remote area repetition', (copy) => { copy.hydraulicRoutes.pop() }, 'NH_SOURCE_CHAIN_REMOTE_AREA_SET_INVALID'],
    ['external device node', (copy) => { copy.hydraulicRoutes[1].externalNodeIds[0] = '415' }, 'NH_SOURCE_CHAIN_DIRECTION_OR_NODE_SET_INVALID'],
    ['node 118 elevation', (copy) => { copy.hydraulicRoutes[2].pipeTableLegs.find((leg) => leg.node1 === '118').elevation1Ft = 12 }, 'NH_SOURCE_CHAIN_LEG_INVALID'],
    ['BOR elevation', (copy) => { copy.hydraulicRoutes[0].pipeTableLegs.find((leg) => leg.node2 === '414').elevation2Ft = 6 }, 'NH_SOURCE_CHAIN_LEG_INVALID'],
    ['physical length', (copy) => { copy.hydraulicRoutes[1].pipeTableLegs.find((leg) => leg.node1 === '118').lengthFt = 35.5 / 12 }, 'NH_SOURCE_CHAIN_LEG_INVALID'],
    ['device note', (copy) => { copy.hydraulicRoutes[2].pipeTableLegs.find((leg) => leg.node1 === '560').notes = 'BFP' }, 'NH_SOURCE_CHAIN_LEG_INVALID'],
    ['C factor', (copy) => { copy.hydraulicRoutes[0].pipeTableLegs.find((leg) => leg.node1 === '560').cFactor = 100 }, 'NH_SOURCE_CHAIN_LEG_INVALID'],
  ])('fails closed on %s drift', (_name, mutate, code) => {
    const copy = structuredClone(inputs)
    mutate(copy)
    const result = evaluateNewHopeSourceFeedCalculationChain(copy)
    expect(result.status).toBe('blocked')
    expect(result.blockerCodes).toContain(code)
    expect(result.calculationChainReady).toBe(false)
    expect(result.sourceFeed3dPathReady).toBe(false)
  })
})

import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { evaluateNewHopeElevationDatum } from '../src/engine/new-hope-elevation-datum.js'

const read = (name) =>
  JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'))
const datum = read('new-hope-approved-elevation-datum.json')
const routes = ['2-1', '2-2', '2-3'].map((id) =>
  read(`new-hope-approved-fp20-hydraulic-route-${id}.json`),
)

describe('New Hope approved calculation-to-architectural datum', () => {
  it('registers all exact calculation ports to the 100-foot finished-floor datum', () => {
    const result = evaluateNewHopeElevationDatum(datum, routes)
    expect(result.status).toBe('passed')
    expect(result.finishedFloorDatumReady).toBe(true)
    expect(result.calculationToArchitecturalDatumRegistrationReady).toBe(true)
    expect(result.metrics).toEqual({
      roofRegionCount: 6,
      distinctRoofRidgeElevationCount: 6,
      registeredPortCount: 32,
      registeredCanonicalNodeCount: 31,
      minimumArchitecturalProjectElevationFt: 111.5,
      maximumArchitecturalProjectElevationFt: 121.5,
    })
    expect(result.registeredPorts.find((port) => port.calculationNodeId === '118')).toMatchObject({
      autosprinkLocalElevationFt: 11.5,
      architecturalProjectElevationFt: 111.5,
    })
  })

  it('keeps coincident plan ports separate and never promotes complete centerline Z', () => {
    const result = evaluateNewHopeElevationDatum(datum, routes)
    expect(
      result.registeredPorts
        .filter((port) => port.canonicalNodeId === 'canonical-node-142')
        .map((port) => [port.calculationNodeId, port.architecturalProjectElevationFt]),
    ).toEqual([
      ['50', 120.5],
      ['718', 121.5],
    ])
    expect(result.unboundNodeElevationPropagationAllowed).toBe(false)
    expect(result.exactPipeCenterlineZReady).toBe(false)
    expect(result.fabricationReady).toBe(false)
  })

  it('rejects a global roof plane or loss of one roof region', () => {
    const global = structuredClone(datum)
    global.modelingRules.globalRoofPlaneAllowed = true
    expect(evaluateNewHopeElevationDatum(global, routes).blockerCodes).toContain(
      'NH_DATUM_FAIL_CLOSED_RULE_INVALID',
    )

    const missing = structuredClone(datum)
    missing.roofRegions.pop()
    expect(evaluateNewHopeElevationDatum(missing, routes).blockerCodes).toContain(
      'NH_DATUM_ROOF_REGION_INVENTORY_INVALID',
    )
  })

  it('rejects source drift, route omission, and cross-route elevation conflict', () => {
    const sourceDrift = structuredClone(datum)
    sourceDrift.sourceBindings.ceilingDatumPlan.sha256 = 'wrong'
    expect(evaluateNewHopeElevationDatum(sourceDrift, routes).blockerCodes).toContain(
      'NH_DATUM_SOURCE_IDENTITY_INVALID',
    )

    expect(evaluateNewHopeElevationDatum(datum, routes.slice(0, 2)).blockerCodes).toContain(
      'NH_DATUM_REMOTE_AREA_SET_INVALID',
    )

    const conflict = structuredClone(routes)
    const leg = conflict[1].pipeTableLegs.find((entry) => entry.node1 === '67')
    leg.elevation1Ft = 99
    expect(evaluateNewHopeElevationDatum(datum, conflict).blockerCodes).toContain(
      'NH_DATUM_CALCULATION_ELEVATION_CONFLICT',
    )
  })
})

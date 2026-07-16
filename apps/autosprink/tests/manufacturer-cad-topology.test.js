import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { auditIgesTopology, verifyIgesTopologyAudit } from '../src/components/manufacturer-cad-topology.js'

const record = (payload, section, sequence) =>
  `${payload.padEnd(72)}${section}${String(sequence).padStart(7)}`

function directoryLine(fields, sequence) {
  return record(fields.map((value) => String(value).padStart(8)).join(''), 'D', sequence)
}

function parameterLine(payload, directoryPointer, sequence) {
  return `${payload.padEnd(64)}${String(directoryPointer).padStart(8)}P${String(sequence).padStart(7)}`
}

function oneEntityIges(entityType, parameterPayload) {
  return [
    record('', 'S', 1),
    record('line art and application drawings SWDR.dxf,,2HIN,', 'G', 1),
    directoryLine([entityType, 1, 0, 0, 1, 0, 0, 0, '00000000'], 1),
    directoryLine([entityType, 0, 0, 1, 0, 0, 0, '', 0], 2),
    parameterLine(parameterPayload, 1, 1),
    record('S      1G      1D      2P      1', 'T', 1),
  ].join('\n')
}

describe('manufacturer IGES topology audit', () => {
  it('classifies a planar line-art file as ineligible for exact part geometry', async () => {
    const packet = await auditIgesTopology(oneEntityIges(110, '110,0,0,0,1,1,0;'), {
      fileName: 'SWDR.igs',
      fileSha256: 'A'.repeat(64),
    })
    expect(packet.entityTypeCounts).toEqual({ 110: 1 })
    expect(packet.curveEntityCount).toBe(1)
    expect(packet.surfaceEntityCount).toBe(0)
    expect(packet.maximumAbsoluteZIn).toBe(0)
    expect(packet.solidPrimitiveEntityCount).toBe(0)
    expect(packet.solidTopologyEntityCount).toBe(0)
    expect(packet.classification).toBe('curve-dominant-planar-drawing-without-solid-topology')
    expect(packet.closedWatertightSolidTopologyReady).toBe(false)
    expect(packet.threadBearingSolidReady).toBe(false)
    expect(packet.exactPartGeometryEligible).toBe(false)
    expect((await verifyIgesTopologyAudit(packet)).status).toBe('passed')
  })

  it('detects solid topology and refuses to verify it as the sealed SWDR line-art boundary', async () => {
    const packet = await auditIgesTopology(oneEntityIges(186, '186;'), {
      fileName: 'unexpected-solid.igs',
      fileSha256: 'B'.repeat(64),
    })
    expect(packet.solidTopologyEntityCount).toBe(1)
    expect(packet.classification).toBe('solid-capable-entities-present-needs-kernel-verification')
    expect((await verifyIgesTopologyAudit(packet)).issues).toContain('IGES_SOLID_ENTITY_COUNT_CHANGED')
  })

  it('verifies the hash-bound actual SWDR audit and blocks any promotion mutation', async () => {
    const packet = JSON.parse(fs.readFileSync(
      new URL('../src/data/new-hope-swdr-iges-topology-audit.json', import.meta.url),
      'utf8',
    ))
    expect(packet.sourceFileSha256).toBe('EF67A6869314B08220F0C2F831B95D5951110E139D36CC8D41FF54BB3EBEF7BA')
    expect(packet.entityCount).toBe(294)
    expect(packet.entityTypeCounts).toEqual({ 100: 18, 110: 256, 124: 3, 128: 2, 212: 6, 308: 2, 406: 5, 408: 2 })
    expect(packet.curveEntityCount).toBe(274)
    expect(packet.surfaceEntityCount).toBe(2)
    expect(packet.sampledGeometryZValueCount).toBe(540)
    expect(packet.maximumAbsoluteZIn).toBe(0)
    expect((await verifyIgesTopologyAudit(packet)).status).toBe('passed')

    const promoted = structuredClone(packet)
    promoted.threadBearingSolidReady = true
    const result = await verifyIgesTopologyAudit(promoted)
    expect(result.status).toBe('blocked')
    expect(result.issues).toContain('IGES_TOPOLOGY_RECEIPT_MISMATCH')
    expect(result.issues).toContain('IGES_FALSE_SOLID_PROMOTION')
  })
})

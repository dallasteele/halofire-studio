import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  evaluateUnifiedThreadKernelReceipt,
  evaluateUnifiedThreadLimitPacket,
} from '../src/components/unified-thread-standard.js'

const packet = JSON.parse(fs.readFileSync(
  new URL('../src/data/unified-thread-375-16-unc.json', import.meta.url),
  'utf8',
))

const actualKernelReceipt = JSON.parse(fs.readFileSync(
  new URL('../../../data/agent-loops/unified-thread-standard-specimen-20260716/kernel-receipt.json', import.meta.url),
  'utf8',
))

const kernelReceipt = () => ({
  artifactType: 'halofire.opencascade-unified-thread-specimen-receipt.v1',
  scope: 'standards-specimen-only',
  source: {
    pdfSha256: packet.source.pdfSha256,
    physicalPdfPage: 61,
    printedPage: '2.27',
    table: '2.21',
  },
  kernel: {
    name: 'OpenCascade via FreeCAD',
    freecadVersion: ['1', '1', '1'],
    modelUnits: 'millimeter',
    inputUnits: 'inch',
  },
  thread: {
    designation: '.375-16 UNC 2A/2B',
    tpi: 16,
    pitchIn: 0.0625,
    leadIn: 0.0625,
    hand: 'right',
    limits: {
      external2A: {
        majorDiameterMaxIn: 0.3737,
        pitchDiameterMaxIn: 0.3331,
        minorDiameterIn: 0.297,
      },
      internal2B: {
        minorDiameterMinIn: 0.307,
        pitchDiameterMinIn: 0.3344,
        majorDiameterMinIn: 0.375,
      },
    },
    minimumPitchDiameterClearanceIn: 0.0013,
    minimumPitchRadiusClearanceIn: 0.00065,
    modeledHelicalSolid: true,
  },
  topology: {
    maleSolidCount: 1,
    femaleSolidCount: 1,
    maleShellCount: 1,
    femaleShellCount: 1,
    maleVolumeMm3: 977.89,
    femaleVolumeMm3: 1907.23,
    assembledCommonVolumeMm3: 0,
    assembledInterferenceToleranceMm3: 1e-5,
    assembledInterferenceFree: true,
  },
  placement: {
    femaleOffsetIn: 0.125,
    femaleOffsetPitchCount: 2,
    helicalPhasePreserved: true,
  },
  outputs: [
    'specimen.FCStd',
    'specimen-male.step',
    'specimen-female.step',
    'specimen-assembly.step',
    'specimen-male.stl',
    'specimen-female.stl',
  ].map((file, index) => ({ file, byteLength: index + 1, sha256: String(index).repeat(64) })),
  releasePolicy: {
    manufacturerPartEligible: false,
    projectAssemblyEligible: false,
    newHopePartEligible: false,
  },
})

describe('source-bound .375-16 UNC thread limits', () => {
  it('accepts the hash-bound NIST H28 table and independently recomputes fit allowance', () => {
    const result = evaluateUnifiedThreadLimitPacket(packet)
    expect(result.status).toBe('passed')
    expect(result.issues).toEqual([])
    expect(result.metrics.pitchIn).toBeCloseTo(0.0625, 12)
    expect(result.metrics.minimumPitchDiameterClearanceIn).toBeCloseTo(0.0013, 12)
    expect(result.metrics.minimumPitchRadiusClearanceIn).toBeCloseTo(0.00065, 12)
    expect(result.standardsSpecimenReady).toBe(true)
    expect(result.manufacturerPartEligible).toBe(false)
    expect(result.projectAssemblyEligible).toBe(false)
  })

  it.each([
    ['source hash', (draft) => { draft.source.pdfSha256 = '0'.repeat(64) }, 'UNIFIED_THREAD_SOURCE_UNTRUSTED'],
    ['table page', (draft) => { draft.source.physicalPdfPage = 60 }, 'UNIFIED_THREAD_SOURCE_UNTRUSTED'],
    ['TPI', (draft) => { draft.thread.tpi = 18 }, 'UNIFIED_THREAD_TABLE_LIMITS_INVALID'],
    ['external pitch maximum', (draft) => { draft.thread.external2A.pitchDiameterMaxIn = 0.3344 }, 'UNIFIED_THREAD_TABLE_LIMITS_INVALID'],
    ['internal pitch minimum', (draft) => { draft.thread.internal2B.pitchDiameterMinIn = 0.3331 }, 'UNIFIED_THREAD_TABLE_LIMITS_INVALID'],
    ['derived clearance', (draft) => { draft.derived.minimumPitchDiameterClearanceIn = 0 }, 'UNIFIED_THREAD_DERIVATION_INVALID'],
  ])('rejects adversarial drift in %s', (_label, mutate, expectedIssue) => {
    const draft = structuredClone(packet)
    mutate(draft)
    const result = evaluateUnifiedThreadLimitPacket(draft)
    expect(result.status).toBe('blocked')
    expect(result.issues).toContain(expectedIssue)
  })

  it('rejects any attempt to promote the standard specimen into a manufacturer or project part', () => {
    const draft = structuredClone(packet)
    draft.releasePolicy.manufacturerPartNumber = 'A240AB200N'
    draft.releasePolicy.manufacturerPartEligible = true
    draft.releasePolicy.projectAssemblyEligible = true
    draft.releasePolicy.newHopePartEligible = true
    const result = evaluateUnifiedThreadLimitPacket(draft)
    expect(result.status).toBe('blocked')
    expect(result.issues).toContain('UNIFIED_THREAD_FALSE_PRODUCT_PROMOTION')
    expect(result.manufacturerPartEligible).toBe(false)
    expect(result.projectAssemblyEligible).toBe(false)
  })

  it('accepts a one-solid-per-side OpenCascade receipt with zero installed interference', () => {
    const result = evaluateUnifiedThreadKernelReceipt(kernelReceipt())
    expect(result.status).toBe('passed')
    expect(result.issues).toEqual([])
    expect(result.helicalBrepReady).toBe(true)
    expect(result.interferenceFreeAtAuditedPlacement).toBe(true)
    expect(result.manufacturerPartEligible).toBe(false)
  })

  it('verifies the checked-in receipt emitted by the real FreeCAD/OpenCascade run', () => {
    const result = evaluateUnifiedThreadKernelReceipt(actualKernelReceipt)
    expect(result.status).toBe('passed')
    expect(result.helicalBrepReady).toBe(true)
    expect(result.interferenceFreeAtAuditedPlacement).toBe(true)
    expect(actualKernelReceipt.topology.assembledCommonVolumeMm3).toBe(0)
    expect(actualKernelReceipt.outputs).toHaveLength(6)
  })

  it.each([
    ['smooth thread', (draft) => { draft.thread.modeledHelicalSolid = false }, 'UNIFIED_THREAD_KERNEL_THREAD_INVALID'],
    ['extra solid', (draft) => { draft.topology.maleSolidCount = 2 }, 'UNIFIED_THREAD_KERNEL_TOPOLOGY_INVALID'],
    ['interference', (draft) => { draft.topology.assembledCommonVolumeMm3 = 0.01 }, 'UNIFIED_THREAD_KERNEL_TOPOLOGY_INVALID'],
    ['phase drift', (draft) => { draft.placement.femaleOffsetPitchCount = 2.1 }, 'UNIFIED_THREAD_KERNEL_PLACEMENT_INVALID'],
    ['missing STEP', (draft) => { draft.outputs = draft.outputs.filter((output) => !output.file.endsWith('-assembly.step')) }, 'UNIFIED_THREAD_KERNEL_OUTPUT_MANIFEST_INVALID'],
    ['product promotion', (draft) => { draft.releasePolicy.manufacturerPartEligible = true }, 'UNIFIED_THREAD_KERNEL_FALSE_PRODUCT_PROMOTION'],
  ])('rejects an adversarial kernel receipt with %s', (_label, mutate, expectedIssue) => {
    const draft = kernelReceipt()
    mutate(draft)
    const result = evaluateUnifiedThreadKernelReceipt(draft)
    expect(result.status).toBe('blocked')
    expect(result.issues).toContain(expectedIssue)
  })
})

import { describe, expect, it } from 'vitest'
import { evaluateExactPartAssembly } from '../src/components/exact-assembly-fit.js'

const sha = (char) => char.repeat(64)

function source(productNumber, char) {
  return {
    classification: 'manufacturer-part-specific-solid',
    manufacturerPartNumber: productNumber,
    fileSha256: sha(char),
    geometrySha256: sha(char.toUpperCase()),
    format: 'STEP',
    units: 'inch',
    unitScaleVerified: true,
    watertightSolidVerified: true,
    partNumberBound: true,
  }
}

function thread(gender) {
  return {
    standard: 'UNC',
    nominalDesignation: '3/8-16',
    tpi: 16,
    gender,
    hand: 'right',
    taperDiameterPerIn: 0,
    majorDiameterIn: 0.375,
    pitchDiameterIn: 0.3344,
    minorDiameterIn: 0.297,
    threadedLengthIn: 0.75,
    modeledHelicalSolid: true,
  }
}

function port(id, interfaceKind, interfaceDiameterIn, extra = {}) {
  return {
    id,
    interfaceKind,
    originIn: [0, 0, 0],
    axis: [0, 0, 1],
    interfaceDiameterIn,
    geometryVerified: true,
    ...extra,
  }
}

function part(productNumber, char, model, assemblyPort) {
  return {
    productNumber,
    manufacturer: 'TEST FIXTURE - NOT PRODUCTION DATA',
    model,
    requiredQuantity: 1,
    source: source(productNumber, char),
    ports: [assemblyPort],
  }
}

function instance(instanceId, productNumber, char, supportRole = 'none') {
  return {
    instanceId,
    productNumber,
    geometrySha256: sha(char.toUpperCase()),
    originIn: [0, 0, 0],
    rotationMatrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    installedCoordinatesVerified: true,
    supportRole,
  }
}

function validFixture() {
  const products = [
    'TEST-ROD',
    'TEST-ANCHOR',
    'TEST-BRACE-PIPE',
    'TEST-BRACE-JAW',
    'TEST-SERVICE-PIPE',
    'TEST-PIPE-CLAMP',
    'TEST-BOLT',
    'TEST-BOLT-HOLE',
  ]
  return {
    artifactType: 'halofire.exact-part-assembly.v1',
    assemblyId: 'test-only-all-interface-kinds',
    coordinateUnits: 'inch',
    sourceDigestSha256: sha('f'),
    requirements: {
      productNumbers: products,
      requiredInstalledUnitCount: 8,
      connectionKinds: ['threaded', 'brace-insertion', 'clamp', 'bolted'],
    },
    partDefinitions: [
      part('TEST-ROD', 'a', '3/8 rod', port('thread', 'threaded', 0.375, { thread: thread('male') })),
      part('TEST-ANCHOR', 'b', '3/8 anchor', port('thread', 'threaded', 0.375, { thread: thread('female') })),
      part('TEST-BRACE-PIPE', 'c', 'brace pipe', port('end', 'brace-member', 1.315)),
      part('TEST-BRACE-JAW', 'd', 'brace jaw', port('jaw', 'brace-jaw', 1.335)),
      part('TEST-SERVICE-PIPE', 'e', 'service pipe', port('bearing', 'service-pipe-bearing', 3.5)),
      part('TEST-PIPE-CLAMP', '6', 'pipe clamp', port('clamp', 'pipe-clamp', 3.53)),
      part('TEST-BOLT', '7', 'mounting bolt', port('shank', 'bolt-shank', 0.5)),
      part('TEST-BOLT-HOLE', '8', 'mounting hole', port('hole', 'bolt-hole', 0.56)),
    ],
    instances: [
      instance('rod-1', 'TEST-ROD', 'a'),
      instance('anchor-1', 'TEST-ANCHOR', 'b'),
      instance('brace-pipe-1', 'TEST-BRACE-PIPE', 'c'),
      instance('brace-jaw-1', 'TEST-BRACE-JAW', 'd', 'seismic-structure-attachment'),
      instance('service-pipe-1', 'TEST-SERVICE-PIPE', 'e'),
      instance('pipe-clamp-1', 'TEST-PIPE-CLAMP', '6'),
      instance('bolt-1', 'TEST-BOLT', '7'),
      instance('bolt-hole-1', 'TEST-BOLT-HOLE', '8'),
    ],
    connections: [
      {
        id: 'thread-fit',
        kind: 'threaded',
        from: { instanceId: 'rod-1', portId: 'thread' },
        to: { instanceId: 'anchor-1', portId: 'thread' },
        geometryVerified: true,
        fit: {
          minimumEngagementIn: 0.3,
          maximumEngagementIn: 0.6,
          actualEngagementIn: 0.45,
          radialClearanceIn: 0.001,
          maximumRadialClearanceIn: 0.005,
          axialAlignmentErrorIn: 0.0002,
          maximumAxialAlignmentErrorIn: 0.001,
          angularAlignmentErrorDeg: 0.01,
          maximumAngularAlignmentErrorDeg: 0.1,
        },
      },
      {
        id: 'brace-insertion-fit',
        kind: 'brace-insertion',
        from: { instanceId: 'brace-pipe-1', portId: 'end' },
        to: { instanceId: 'brace-jaw-1', portId: 'jaw' },
        geometryVerified: true,
        fit: {
          minimumInsertionIn: 1,
          actualInsertionIn: 1.25,
          diametricClearanceIn: 0.02,
          maximumDiametricClearanceIn: 0.03,
          bottomOutRequired: true,
          bottomedOut: true,
        },
      },
      {
        id: 'service-pipe-clamp-fit',
        kind: 'clamp',
        from: { instanceId: 'service-pipe-1', portId: 'bearing' },
        to: { instanceId: 'pipe-clamp-1', portId: 'clamp' },
        geometryVerified: true,
        fit: {
          servicePipeOutsideDiameterIn: 3.5,
          clampInsideDiameterIn: 3.53,
          minimumDiametricClearanceIn: 0.01,
          maximumDiametricClearanceIn: 0.05,
          closedAndTorquedVerified: true,
        },
      },
      {
        id: 'structure-bolt-fit',
        kind: 'bolted',
        from: { instanceId: 'bolt-1', portId: 'shank' },
        to: { instanceId: 'bolt-hole-1', portId: 'hole' },
        geometryVerified: true,
        fit: {
          boltDiameterIn: 0.5,
          holeDiameterIn: 0.56,
          minimumDiametricClearanceIn: 0.01,
          maximumDiametricClearanceIn: 0.1,
          minimumThreadEngagementIn: 0.4,
          actualThreadEngagementIn: 0.5,
          torqueRequirementVerified: true,
        },
      },
    ],
    supports: [
      {
        id: 'structure-support-1',
        supportInstanceId: 'brace-jaw-1',
        structureElementId: 'test-structure-1',
        structureSourceSha256: sha('9'),
        substrate: 'test-steel',
        sourceCoordinatesVerified: true,
        substrateCompatibilityVerified: true,
        structureAttachmentVerified: true,
        appliedLoadLb: 100,
        listedCapacityLb: 300,
        braceAngleDeg: 45,
        minimumListedBraceAngleDeg: 30,
        maximumListedBraceAngleDeg: 90,
        connectionIds: ['brace-insertion-fit', 'structure-bolt-fit'],
      },
    ],
    receipts: [
      {
        kind: 'solid-kernel-fit',
        receiptSha256: sha('1'),
        inputAssemblyDigestSha256: sha('f'),
        kernel: 'OpenCascade',
        kernelVersion: 'test',
        geometryMode: 'exact-brep',
        unitsVerified: true,
        absoluteToleranceIn: 0.0001,
        watertightPartCountVerified: true,
        connectionFitChecksComplete: true,
        threadInterferenceChecksComplete: true,
        unresolvedInterferenceCount: 0,
      },
      {
        kind: 'scene-placement-collision',
        receiptSha256: sha('2'),
        inputAssemblyDigestSha256: sha('f'),
        kernel: 'Blender',
        kernelVersion: 'test',
        units: 'inch',
        installedCoordinatesVerified: true,
        structureCollisionsChecked: true,
        nonMatingPartCollisionsChecked: true,
        unresolvedCollisionCount: 0,
      },
    ],
  }
}

const trustedReceipts = [sha('1'), sha('2')]

describe('exact part assembly fit verifier', () => {
  it('accepts only a fully source-bound, fit-checked, collision-checked assembly', () => {
    const result = evaluateExactPartAssembly(validFixture(), {
      trustedReceiptDigests: trustedReceipts,
    })
    expect(result.status).toBe('verified')
    expect(result.issues).toEqual([])
    expect(result.metrics).toEqual({
      requiredPartDefinitionCount: 8,
      partDefinitionCount: 8,
      exactPartDefinitionCount: 8,
      requiredInstalledUnitCount: 8,
      installedInstanceCount: 8,
      connectionCount: 4,
      supportAttachmentCount: 1,
      trustedReceiptCount: 2,
    })
    expect(result.exactSourceGeometryReady).toBe(true)
    expect(result.threadSolidsReady).toBe(true)
    expect(result.installedInstanceCoverageReady).toBe(true)
    expect(result.connectionFitReady).toBe(true)
    expect(result.structureAttachmentReady).toBe(true)
    expect(result.solidKernelReceiptReady).toBe(true)
    expect(result.sceneCollisionReceiptReady).toBe(true)
    expect(result.assemblyReleaseReady).toBe(true)
  })

  it('rejects generated geometry, false threads, bad engagement, bad insertion, bad clamp fit, and bad bolts', () => {
    const generated = validFixture()
    generated.partDefinitions[0].source.classification = 'generated-openscad'
    expect(evaluateExactPartAssembly(generated, { trustedReceiptDigests: trustedReceipts }).blockerCodes)
      .toContain('EXACT_ASSEMBLY_PART_GEOMETRY_UNVERIFIED')

    const smoothThread = validFixture()
    smoothThread.partDefinitions[0].ports[0].thread.modeledHelicalSolid = false
    expect(evaluateExactPartAssembly(smoothThread, { trustedReceiptDigests: trustedReceipts }).blockerCodes)
      .toContain('EXACT_ASSEMBLY_CONNECTION_FIT_UNVERIFIED')

    const sameGender = validFixture()
    sameGender.partDefinitions[1].ports[0].thread.gender = 'male'
    expect(evaluateExactPartAssembly(sameGender, { trustedReceiptDigests: trustedReceipts }).blockerCodes)
      .toContain('EXACT_ASSEMBLY_CONNECTION_FIT_UNVERIFIED')

    const badEngagement = validFixture()
    badEngagement.connections[0].fit.actualEngagementIn = 0.1
    expect(evaluateExactPartAssembly(badEngagement, { trustedReceiptDigests: trustedReceipts }).blockerCodes)
      .toContain('EXACT_ASSEMBLY_CONNECTION_FIT_UNVERIFIED')

    const notBottomed = validFixture()
    notBottomed.connections[1].fit.bottomedOut = false
    expect(evaluateExactPartAssembly(notBottomed, { trustedReceiptDigests: trustedReceipts }).blockerCodes)
      .toContain('EXACT_ASSEMBLY_CONNECTION_FIT_UNVERIFIED')

    const oversizedClamp = validFixture()
    oversizedClamp.connections[2].fit.clampInsideDiameterIn = 3.7
    expect(evaluateExactPartAssembly(oversizedClamp, { trustedReceiptDigests: trustedReceipts }).blockerCodes)
      .toContain('EXACT_ASSEMBLY_CONNECTION_FIT_UNVERIFIED')

    const oversizedBolt = validFixture()
    oversizedBolt.connections[3].fit.boltDiameterIn = 0.625
    expect(evaluateExactPartAssembly(oversizedBolt, { trustedReceiptDigests: trustedReceipts }).blockerCodes)
      .toContain('EXACT_ASSEMBLY_CONNECTION_FIT_UNVERIFIED')
  })

  it('rejects untrusted receipts, source drift, missing placements, structure failures, and collisions', () => {
    const untrusted = evaluateExactPartAssembly(validFixture())
    expect(untrusted.blockerCodes).toContain('EXACT_ASSEMBLY_SOLID_KERNEL_RECEIPT_MISSING')
    expect(untrusted.blockerCodes).toContain('EXACT_ASSEMBLY_SCENE_COLLISION_RECEIPT_MISSING')

    const wrongDigest = validFixture()
    wrongDigest.receipts[0].inputAssemblyDigestSha256 = sha('e')
    expect(evaluateExactPartAssembly(wrongDigest, { trustedReceiptDigests: trustedReceipts }).blockerCodes)
      .toContain('EXACT_ASSEMBLY_SOLID_KERNEL_RECEIPT_MISSING')

    const missingPlacement = validFixture()
    missingPlacement.instances.pop()
    expect(evaluateExactPartAssembly(missingPlacement, { trustedReceiptDigests: trustedReceipts }).blockerCodes)
      .toContain('EXACT_ASSEMBLY_INSTANCE_COVERAGE_INCOMPLETE')

    const wrongProductMix = validFixture()
    wrongProductMix.instances[7].productNumber = 'TEST-BOLT'
    wrongProductMix.instances[7].geometrySha256 = sha('7')
    expect(evaluateExactPartAssembly(wrongProductMix, { trustedReceiptDigests: trustedReceipts }).blockerCodes)
      .toContain('EXACT_ASSEMBLY_INSTANCE_COVERAGE_INCOMPLETE')

    const wrongGeometry = validFixture()
    wrongGeometry.instances[0].geometrySha256 = sha('9')
    expect(evaluateExactPartAssembly(wrongGeometry, { trustedReceiptDigests: trustedReceipts }).blockerCodes)
      .toContain('EXACT_ASSEMBLY_INSTANCE_COVERAGE_INCOMPLETE')

    const skewedPlacement = validFixture()
    skewedPlacement.instances[0].rotationMatrix = [1, 0.1, 0, 0, 1, 0, 0, 0, 1]
    expect(evaluateExactPartAssembly(skewedPlacement, { trustedReceiptDigests: trustedReceipts }).blockerCodes)
      .toContain('EXACT_ASSEMBLY_INSTANCE_COVERAGE_INCOMPLETE')

    const detached = validFixture()
    detached.supports[0].structureAttachmentVerified = false
    expect(evaluateExactPartAssembly(detached, { trustedReceiptDigests: trustedReceipts }).blockerCodes)
      .toContain('EXACT_ASSEMBLY_STRUCTURE_ATTACHMENT_UNVERIFIED')

    const overloaded = validFixture()
    overloaded.supports[0].appliedLoadLb = 301
    expect(evaluateExactPartAssembly(overloaded, { trustedReceiptDigests: trustedReceipts }).blockerCodes)
      .toContain('EXACT_ASSEMBLY_STRUCTURE_ATTACHMENT_UNVERIFIED')

    const collision = validFixture()
    collision.receipts[1].unresolvedCollisionCount = 1
    expect(evaluateExactPartAssembly(collision, { trustedReceiptDigests: trustedReceipts }).blockerCodes)
      .toContain('EXACT_ASSEMBLY_SCENE_COLLISION_RECEIPT_MISSING')
  })
})

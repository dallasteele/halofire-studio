/**
 * Gate-grade exact-part assembly verifier.
 *
 * This module does not create geometry and never treats a catalog image,
 * nominal envelope, generated proxy, or untrusted caller flag as proof that
 * parts fit. It consumes evidence produced by solid-CAD and installed-scene
 * kernels and checks the boundary conditions needed before an assembly can be
 * released: part-number-specific solids, units, port geometry, real thread
 * form, compatible interfaces, engagement, support-to-structure attachment,
 * and collision receipts.
 *
 * Receipt trust is injected by the caller. A syntactically valid receipt is
 * non-gating unless its digest is present in `trustedReceiptDigests`.
 */

const SHA256_RE = /^[A-F0-9]{64}$/i
const ALLOWED_UNITS = new Set(['inch', 'millimeter'])
const ALLOWED_GENDERS = new Set(['male', 'female'])
const ALLOWED_HANDS = new Set(['right', 'left'])
const REQUIRED_RECEIPT_KINDS = Object.freeze([
  'solid-kernel-fit',
  'scene-placement-collision',
])

const issue = (code, message, entityId = null) => ({
  severity: 'blocking',
  code,
  message,
  entityId,
})

const finite = (value) => Number.isFinite(value)
const positive = (value) => finite(value) && value > 0
const nonNegative = (value) => finite(value) && value >= 0
const sha256 = (value) => typeof value === 'string' && SHA256_RE.test(value)

function vector3(value, { nonZero = false } = {}) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(finite)) return false
  return !nonZero || value.some((entry) => Math.abs(entry) > 1e-12)
}

function rigidRotationMatrix(value) {
  if (!Array.isArray(value) || value.length !== 9 || !value.every(finite)) return false
  const rows = [value.slice(0, 3), value.slice(3, 6), value.slice(6, 9)]
  const dot = (a, b) => a.reduce((sum, entry, index) => sum + entry * b[index], 0)
  const close = (a, b) => Math.abs(a - b) <= 1e-8
  if (!rows.every((row) => close(dot(row, row), 1))) return false
  if (!close(dot(rows[0], rows[1]), 0) || !close(dot(rows[0], rows[2]), 0) || !close(dot(rows[1], rows[2]), 0)) return false
  const determinant = (
    value[0] * (value[4] * value[8] - value[5] * value[7]) -
    value[1] * (value[3] * value[8] - value[5] * value[6]) +
    value[2] * (value[3] * value[7] - value[4] * value[6])
  )
  return close(determinant, 1)
}

function endpointKey(endpoint = {}) {
  return `${endpoint.instanceId || ''}:${endpoint.portId || ''}`
}

function complementaryGender(a, b) {
  return ALLOWED_GENDERS.has(a) && ALLOWED_GENDERS.has(b) && a !== b
}

function validateThread(thread = {}) {
  return (
    typeof thread.standard === 'string' &&
    thread.standard.length > 0 &&
    typeof thread.nominalDesignation === 'string' &&
    thread.nominalDesignation.length > 0 &&
    positive(thread.tpi) &&
    ALLOWED_GENDERS.has(thread.gender) &&
    ALLOWED_HANDS.has(thread.hand) &&
    nonNegative(thread.taperDiameterPerIn) &&
    positive(thread.majorDiameterIn) &&
    positive(thread.pitchDiameterIn) &&
    positive(thread.minorDiameterIn) &&
    thread.majorDiameterIn > thread.pitchDiameterIn &&
    thread.pitchDiameterIn > thread.minorDiameterIn &&
    positive(thread.threadedLengthIn) &&
    thread.modeledHelicalSolid === true
  )
}

function validateSource(source = {}, productNumber) {
  return (
    source.classification === 'manufacturer-part-specific-solid' &&
    source.manufacturerPartNumber === productNumber &&
    sha256(source.fileSha256) &&
    sha256(source.geometrySha256) &&
    typeof source.format === 'string' &&
    source.format.length > 0 &&
    ALLOWED_UNITS.has(source.units) &&
    source.unitScaleVerified === true &&
    source.watertightSolidVerified === true &&
    source.partNumberBound === true
  )
}

function validatePort(port = {}) {
  if (
    typeof port.id !== 'string' ||
    port.id.length === 0 ||
    typeof port.interfaceKind !== 'string' ||
    port.interfaceKind.length === 0 ||
    !vector3(port.originIn) ||
    !vector3(port.axis, { nonZero: true }) ||
    !positive(port.interfaceDiameterIn) ||
    port.geometryVerified !== true
  ) return false
  return port.interfaceKind !== 'threaded' || validateThread(port.thread)
}

function validatePartDefinition(part = {}) {
  if (
    typeof part.productNumber !== 'string' ||
    part.productNumber.length === 0 ||
    typeof part.manufacturer !== 'string' ||
    part.manufacturer.length === 0 ||
    typeof part.model !== 'string' ||
    part.model.length === 0 ||
    !Number.isInteger(part.requiredQuantity) ||
    part.requiredQuantity <= 0 ||
    !validateSource(part.source, part.productNumber) ||
    !Array.isArray(part.ports) ||
    part.ports.length === 0
  ) return false
  const ids = part.ports.map((port) => port?.id)
  return new Set(ids).size === ids.length && part.ports.every(validatePort)
}

function receiptTrusted(receipt, trustedReceiptDigests) {
  return sha256(receipt?.receiptSha256) && trustedReceiptDigests.has(receipt.receiptSha256)
}

function validateSolidKernelReceipt(receipt, sourceDigestSha256) {
  return (
    receipt?.kind === 'solid-kernel-fit' &&
    receipt.inputAssemblyDigestSha256 === sourceDigestSha256 &&
    typeof receipt.kernel === 'string' &&
    receipt.kernel.length > 0 &&
    typeof receipt.kernelVersion === 'string' &&
    receipt.kernelVersion.length > 0 &&
    receipt.geometryMode === 'exact-brep' &&
    receipt.unitsVerified === true &&
    positive(receipt.absoluteToleranceIn) &&
    receipt.absoluteToleranceIn <= 0.001 &&
    receipt.watertightPartCountVerified === true &&
    receipt.connectionFitChecksComplete === true &&
    receipt.threadInterferenceChecksComplete === true &&
    receipt.unresolvedInterferenceCount === 0
  )
}

function validateSceneReceipt(receipt, sourceDigestSha256) {
  return (
    receipt?.kind === 'scene-placement-collision' &&
    receipt.inputAssemblyDigestSha256 === sourceDigestSha256 &&
    typeof receipt.kernel === 'string' &&
    receipt.kernel.length > 0 &&
    typeof receipt.kernelVersion === 'string' &&
    receipt.kernelVersion.length > 0 &&
    ALLOWED_UNITS.has(receipt.units) &&
    receipt.installedCoordinatesVerified === true &&
    receipt.structureCollisionsChecked === true &&
    receipt.nonMatingPartCollisionsChecked === true &&
    receipt.unresolvedCollisionCount === 0
  )
}

function validateThreadedConnection(connection, fromPort, toPort) {
  const a = fromPort.thread || {}
  const b = toPort.thread || {}
  const fit = connection.fit || {}
  return (
    fromPort.interfaceKind === 'threaded' &&
    toPort.interfaceKind === 'threaded' &&
    validateThread(a) &&
    validateThread(b) &&
    complementaryGender(a.gender, b.gender) &&
    a.standard === b.standard &&
    a.nominalDesignation === b.nominalDesignation &&
    a.tpi === b.tpi &&
    a.hand === b.hand &&
    a.taperDiameterPerIn === b.taperDiameterPerIn &&
    positive(fit.minimumEngagementIn) &&
    positive(fit.maximumEngagementIn) &&
    fit.maximumEngagementIn >= fit.minimumEngagementIn &&
    finite(fit.actualEngagementIn) &&
    fit.actualEngagementIn >= fit.minimumEngagementIn &&
    fit.actualEngagementIn <= fit.maximumEngagementIn &&
    nonNegative(fit.radialClearanceIn) &&
    nonNegative(fit.maximumRadialClearanceIn) &&
    fit.radialClearanceIn <= fit.maximumRadialClearanceIn &&
    nonNegative(fit.axialAlignmentErrorIn) &&
    nonNegative(fit.maximumAxialAlignmentErrorIn) &&
    fit.axialAlignmentErrorIn <= fit.maximumAxialAlignmentErrorIn &&
    nonNegative(fit.angularAlignmentErrorDeg) &&
    nonNegative(fit.maximumAngularAlignmentErrorDeg) &&
    fit.angularAlignmentErrorDeg <= fit.maximumAngularAlignmentErrorDeg
  )
}

function validateInsertionConnection(connection, fromPort, toPort) {
  const kinds = new Set([fromPort.interfaceKind, toPort.interfaceKind])
  const fit = connection.fit || {}
  return (
    kinds.has('brace-member') &&
    kinds.has('brace-jaw') &&
    positive(fit.minimumInsertionIn) &&
    finite(fit.actualInsertionIn) &&
    fit.actualInsertionIn >= fit.minimumInsertionIn &&
    nonNegative(fit.diametricClearanceIn) &&
    nonNegative(fit.maximumDiametricClearanceIn) &&
    fit.diametricClearanceIn <= fit.maximumDiametricClearanceIn &&
    (fit.bottomOutRequired !== true || fit.bottomedOut === true)
  )
}

function validateClampConnection(connection, fromPort, toPort) {
  const kinds = new Set([fromPort.interfaceKind, toPort.interfaceKind])
  const fit = connection.fit || {}
  return (
    kinds.has('service-pipe-bearing') &&
    kinds.has('pipe-clamp') &&
    positive(fit.servicePipeOutsideDiameterIn) &&
    positive(fit.clampInsideDiameterIn) &&
    nonNegative(fit.minimumDiametricClearanceIn) &&
    nonNegative(fit.maximumDiametricClearanceIn) &&
    fit.maximumDiametricClearanceIn >= fit.minimumDiametricClearanceIn &&
    (fit.clampInsideDiameterIn - fit.servicePipeOutsideDiameterIn) >= fit.minimumDiametricClearanceIn &&
    (fit.clampInsideDiameterIn - fit.servicePipeOutsideDiameterIn) <= fit.maximumDiametricClearanceIn &&
    fit.closedAndTorquedVerified === true
  )
}

function validateBoltedConnection(connection, fromPort, toPort) {
  const kinds = new Set([fromPort.interfaceKind, toPort.interfaceKind])
  const fit = connection.fit || {}
  return (
    kinds.has('bolt-shank') &&
    kinds.has('bolt-hole') &&
    positive(fit.boltDiameterIn) &&
    positive(fit.holeDiameterIn) &&
    fit.holeDiameterIn >= fit.boltDiameterIn &&
    nonNegative(fit.minimumDiametricClearanceIn) &&
    nonNegative(fit.maximumDiametricClearanceIn) &&
    (fit.holeDiameterIn - fit.boltDiameterIn) >= fit.minimumDiametricClearanceIn &&
    (fit.holeDiameterIn - fit.boltDiameterIn) <= fit.maximumDiametricClearanceIn &&
    positive(fit.minimumThreadEngagementIn) &&
    finite(fit.actualThreadEngagementIn) &&
    fit.actualThreadEngagementIn >= fit.minimumThreadEngagementIn &&
    fit.torqueRequirementVerified === true
  )
}

function validateConnection(connection, portByEndpoint) {
  const fromPort = portByEndpoint.get(endpointKey(connection?.from))
  const toPort = portByEndpoint.get(endpointKey(connection?.to))
  if (
    typeof connection?.id !== 'string' ||
    connection.id.length === 0 ||
    !fromPort ||
    !toPort ||
    endpointKey(connection.from) === endpointKey(connection.to) ||
    connection.geometryVerified !== true
  ) return false
  if (connection.kind === 'threaded') return validateThreadedConnection(connection, fromPort, toPort)
  if (connection.kind === 'brace-insertion') return validateInsertionConnection(connection, fromPort, toPort)
  if (connection.kind === 'clamp') return validateClampConnection(connection, fromPort, toPort)
  if (connection.kind === 'bolted') return validateBoltedConnection(connection, fromPort, toPort)
  return false
}

function validateSupport(support, instancesById, connectionIds) {
  return (
    typeof support?.id === 'string' &&
    support.id.length > 0 &&
    instancesById.has(support.supportInstanceId) &&
    typeof support.structureElementId === 'string' &&
    support.structureElementId.length > 0 &&
    sha256(support.structureSourceSha256) &&
    typeof support.substrate === 'string' &&
    support.substrate.length > 0 &&
    support.sourceCoordinatesVerified === true &&
    support.substrateCompatibilityVerified === true &&
    support.structureAttachmentVerified === true &&
    positive(support.appliedLoadLb) &&
    positive(support.listedCapacityLb) &&
    support.listedCapacityLb >= support.appliedLoadLb &&
    finite(support.braceAngleDeg) &&
    finite(support.minimumListedBraceAngleDeg) &&
    finite(support.maximumListedBraceAngleDeg) &&
    support.braceAngleDeg >= support.minimumListedBraceAngleDeg &&
    support.braceAngleDeg <= support.maximumListedBraceAngleDeg &&
    Array.isArray(support.connectionIds) &&
    support.connectionIds.length > 0 &&
    support.connectionIds.every((id) => connectionIds.has(id))
  )
}

/**
 * @param {object} source
 * @param {{trustedReceiptDigests?:Iterable<string>}} [options]
 */
export function evaluateExactPartAssembly(source = {}, options = {}) {
  const issues = []
  const trustedReceiptDigests = new Set(options.trustedReceiptDigests || [])
  const requirements = source.requirements || {}
  const partDefinitions = Array.isArray(source.partDefinitions) ? source.partDefinitions : []
  const instances = Array.isArray(source.instances) ? source.instances : []
  const connections = Array.isArray(source.connections) ? source.connections : []
  const supports = Array.isArray(source.supports) ? source.supports : []
  const receipts = Array.isArray(source.receipts) ? source.receipts : []

  if (
    source.artifactType !== 'halofire.exact-part-assembly.v1' ||
    typeof source.assemblyId !== 'string' ||
    source.assemblyId.length === 0 ||
    !ALLOWED_UNITS.has(source.coordinateUnits) ||
    !sha256(source.sourceDigestSha256)
  ) {
    issues.push(issue('EXACT_ASSEMBLY_IDENTITY_INVALID', 'Assembly identity, units, and source digest must be exact.'))
  }

  const productNumbers = partDefinitions.map((part) => part?.productNumber)
  const requiredProducts = Array.isArray(requirements.productNumbers) ? requirements.productNumbers : []
  if (
    partDefinitions.length === 0 ||
    new Set(productNumbers).size !== productNumbers.length ||
    requiredProducts.length === 0 ||
    new Set(requiredProducts).size !== requiredProducts.length ||
    requiredProducts.some((productNumber) => !productNumbers.includes(productNumber)) ||
    productNumbers.some((productNumber) => !requiredProducts.includes(productNumber))
  ) {
    issues.push(issue('EXACT_ASSEMBLY_PART_SET_INCOMPLETE', 'Every required product definition must exist exactly once.'))
  }

  const exactParts = new Set()
  const portByProduct = new Map()
  for (const part of partDefinitions) {
    if (validatePartDefinition(part)) exactParts.add(part.productNumber)
    else issues.push(issue('EXACT_ASSEMBLY_PART_GEOMETRY_UNVERIFIED', 'Part-number-specific watertight solid, units, and verified ports are required.', part?.productNumber || null))
    const ports = new Map()
    for (const port of part?.ports || []) ports.set(port.id, port)
    portByProduct.set(part?.productNumber, ports)
  }

  const instanceIds = instances.map((entry) => entry?.instanceId)
  const instancesById = new Map(instances.map((entry) => [entry?.instanceId, entry]))
  const partByProduct = new Map(partDefinitions.map((part) => [part?.productNumber, part]))
  const installedQuantityByProduct = new Map()
  for (const entry of instances) {
    installedQuantityByProduct.set(
      entry?.productNumber,
      (installedQuantityByProduct.get(entry?.productNumber) || 0) + 1,
    )
  }
  const requiredUnitCount = requirements.requiredInstalledUnitCount
  const instanceSetReady = (
    Number.isInteger(requiredUnitCount) &&
    requiredUnitCount > 0 &&
    instances.length === requiredUnitCount &&
    new Set(instanceIds).size === instanceIds.length &&
    partDefinitions.every((part) =>
      installedQuantityByProduct.get(part.productNumber) === part.requiredQuantity,
    ) &&
    instances.every((entry) =>
      typeof entry?.instanceId === 'string' &&
      exactParts.has(entry.productNumber) &&
      entry.geometrySha256 === partByProduct.get(entry.productNumber)?.source?.geometrySha256 &&
      vector3(entry.originIn) &&
      rigidRotationMatrix(entry.rotationMatrix) &&
      entry.installedCoordinatesVerified === true,
    )
  )
  if (!instanceSetReady) {
    issues.push(issue('EXACT_ASSEMBLY_INSTANCE_COVERAGE_INCOMPLETE', 'Every required installed unit needs a unique, source-bound placement.'))
  }

  const portByEndpoint = new Map()
  for (const instance of instances) {
    const ports = portByProduct.get(instance?.productNumber) || new Map()
    for (const [portId, port] of ports) {
      portByEndpoint.set(`${instance.instanceId}:${portId}`, port)
    }
  }

  const connectionIds = connections.map((entry) => entry?.id)
  const requiredConnectionKinds = Array.isArray(requirements.connectionKinds)
    ? requirements.connectionKinds
    : []
  const connectionSetReady = (
    connections.length > 0 &&
    new Set(connectionIds).size === connectionIds.length &&
    connections.every((entry) => validateConnection(entry, portByEndpoint)) &&
    requiredConnectionKinds.length > 0 &&
    requiredConnectionKinds.every((kind) => connections.some((entry) => entry.kind === kind))
  )
  if (!connectionSetReady) {
    issues.push(issue('EXACT_ASSEMBLY_CONNECTION_FIT_UNVERIFIED', 'Every required threaded, insertion, clamp, and bolted connection must pass dimensional fit checks.'))
  }

  const supportRoles = new Set(
    instances
      .filter((entry) => entry?.supportRole && entry.supportRole !== 'none')
      .map((entry) => entry.instanceId),
  )
  const supportedInstances = new Set(supports.map((entry) => entry?.supportInstanceId))
  const connectionIdSet = new Set(connectionIds)
  const supportSetReady = (
    supportRoles.size > 0 &&
    [...supportRoles].every((instanceId) => supportedInstances.has(instanceId)) &&
    supports.every((entry) => validateSupport(entry, instancesById, connectionIdSet))
  )
  if (!supportSetReady) {
    issues.push(issue('EXACT_ASSEMBLY_STRUCTURE_ATTACHMENT_UNVERIFIED', 'Every hanger or brace must be bound to source structure, compatible substrate, listed capacity, and verified connections.'))
  }

  const trustedReceipts = receipts.filter((receipt) => receiptTrusted(receipt, trustedReceiptDigests))
  const solidReceiptReady = trustedReceipts.some((receipt) =>
    validateSolidKernelReceipt(receipt, source.sourceDigestSha256),
  )
  const sceneReceiptReady = trustedReceipts.some((receipt) =>
    validateSceneReceipt(receipt, source.sourceDigestSha256),
  )
  if (!solidReceiptReady) {
    issues.push(issue('EXACT_ASSEMBLY_SOLID_KERNEL_RECEIPT_MISSING', 'A trusted exact-BREP fit and thread-interference receipt is required.'))
  }
  if (!sceneReceiptReady) {
    issues.push(issue('EXACT_ASSEMBLY_SCENE_COLLISION_RECEIPT_MISSING', 'A trusted installed-placement and structure-collision receipt is required.'))
  }

  const blockerCodes = [...new Set(issues.map((entry) => entry.code))]
  const exactSourceGeometryReady = partDefinitions.length > 0 && exactParts.size === partDefinitions.length
  const threadedPorts = partDefinitions
    .flatMap((part) => part.ports || [])
    .filter((port) => port.interfaceKind === 'threaded')
  const threadSolidsReady = (
    exactSourceGeometryReady &&
    (!requiredConnectionKinds.includes('threaded') || (
      threadedPorts.length >= 2 && threadedPorts.every((port) => validateThread(port.thread))
    ))
  )
  const assemblyReleaseReady = (
    issues.length === 0 &&
    exactSourceGeometryReady &&
    threadSolidsReady &&
    instanceSetReady &&
    connectionSetReady &&
    supportSetReady &&
    solidReceiptReady &&
    sceneReceiptReady
  )

  return {
    artifactType: 'halofire.exact-part-assembly-result.v1',
    assemblyId: source.assemblyId || null,
    status: assemblyReleaseReady ? 'verified' : 'blocked',
    issues,
    blockerCodes,
    metrics: {
      requiredPartDefinitionCount: requiredProducts.length,
      partDefinitionCount: partDefinitions.length,
      exactPartDefinitionCount: exactParts.size,
      requiredInstalledUnitCount: Number.isInteger(requiredUnitCount) ? requiredUnitCount : 0,
      installedInstanceCount: instances.length,
      connectionCount: connections.length,
      supportAttachmentCount: supports.length,
      trustedReceiptCount: trustedReceipts.length,
    },
    exactSourceGeometryReady,
    threadSolidsReady,
    installedInstanceCoverageReady: instanceSetReady,
    connectionFitReady: connectionSetReady,
    structureAttachmentReady: supportSetReady,
    solidKernelReceiptReady: solidReceiptReady,
    sceneCollisionReceiptReady: sceneReceiptReady,
    requiredReceiptKinds: [...REQUIRED_RECEIPT_KINDS],
    assemblyReleaseReady,
  }
}

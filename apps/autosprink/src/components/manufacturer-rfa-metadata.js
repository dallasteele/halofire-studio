import { sha256Hex } from '../engine/elevation-datums.js'

const CFB_SIGNATURE = 'd0cf11e0a1b11ae1'
const FREE_SECTOR = 0xffffffff
const END_OF_CHAIN = 0xfffffffe

const asBuffer = (bytes) => Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
const hex = (bytes) => asBuffer(bytes).toString('hex')

function readSector(buffer, sectorSize, sectorId) {
  const offset = (sectorId + 1) * sectorSize
  if (!Number.isInteger(sectorId) || sectorId < 0 || offset + sectorSize > buffer.length) {
    throw new Error(`CFB sector ${sectorId} is outside the file`)
  }
  return buffer.subarray(offset, offset + sectorSize)
}

function chain(start, allocation, maximumEntries) {
  if (start === END_OF_CHAIN || start === FREE_SECTOR) return []
  const result = []
  const visited = new Set()
  let sectorId = start
  while (sectorId !== END_OF_CHAIN) {
    if (!Number.isInteger(sectorId) || sectorId < 0 || sectorId >= allocation.length) {
      throw new Error(`CFB allocation chain points outside the table: ${sectorId}`)
    }
    if (visited.has(sectorId)) throw new Error(`CFB allocation chain loops at ${sectorId}`)
    if (result.length >= maximumEntries) throw new Error('CFB allocation chain exceeds its safe bound')
    visited.add(sectorId)
    result.push(sectorId)
    sectorId = allocation[sectorId]
  }
  return result
}

function uint32Table(bytes) {
  const result = []
  for (let offset = 0; offset + 4 <= bytes.length; offset += 4) {
    result.push(bytes.readUInt32LE(offset))
  }
  return result
}

function parseDirectory(bytes) {
  const entries = []
  for (let offset = 0; offset + 128 <= bytes.length; offset += 128) {
    const entry = bytes.subarray(offset, offset + 128)
    const nameByteLength = entry.readUInt16LE(64)
    const objectType = entry[66]
    if (nameByteLength < 2 || nameByteLength > 64 || objectType === 0) continue
    const name = entry.subarray(0, nameByteLength - 2).toString('utf16le')
    const sizeLow = entry.readUInt32LE(120)
    const sizeHigh = entry.readUInt32LE(124)
    const streamSize = sizeHigh * 0x100000000 + sizeLow
    if (!Number.isSafeInteger(streamSize)) throw new Error(`CFB stream ${name} is too large`)
    entries.push({
      name,
      objectType,
      startSector: entry.readUInt32LE(116),
      streamSize,
    })
  }
  return entries
}

export function extractCfbStreams(bytes) {
  const buffer = asBuffer(bytes)
  if (hex(buffer.subarray(0, 8)) !== CFB_SIGNATURE) throw new Error('RFA is not a CFB compound document')
  const sectorSize = 2 ** buffer.readUInt16LE(30)
  const miniSectorSize = 2 ** buffer.readUInt16LE(32)
  if (![512, 4096].includes(sectorSize) || miniSectorSize !== 64) {
    throw new Error(`Unsupported CFB sector sizes ${sectorSize}/${miniSectorSize}`)
  }

  const fatSectorCount = buffer.readUInt32LE(44)
  const firstDirectorySector = buffer.readUInt32LE(48)
  const miniStreamCutoff = buffer.readUInt32LE(56)
  const firstMiniFatSector = buffer.readUInt32LE(60)
  const miniFatSectorCount = buffer.readUInt32LE(64)
  const firstDifatSector = buffer.readUInt32LE(68)
  const difatSectorCount = buffer.readUInt32LE(72)
  const fatSectorIds = []
  for (let offset = 76; offset < 512; offset += 4) {
    const sectorId = buffer.readUInt32LE(offset)
    if (sectorId !== FREE_SECTOR) fatSectorIds.push(sectorId)
  }
  let difatSectorId = firstDifatSector
  for (let count = 0; count < difatSectorCount; count += 1) {
    const sector = readSector(buffer, sectorSize, difatSectorId)
    const values = uint32Table(sector)
    for (const sectorId of values.slice(0, -1)) {
      if (sectorId !== FREE_SECTOR) fatSectorIds.push(sectorId)
    }
    difatSectorId = values.at(-1)
  }
  if (fatSectorIds.length < fatSectorCount) throw new Error('CFB FAT sector list is incomplete')
  const fat = fatSectorIds.slice(0, fatSectorCount).flatMap((sectorId) =>
    uint32Table(readSector(buffer, sectorSize, sectorId)),
  )
  const fileSectorBound = Math.ceil(buffer.length / sectorSize)
  const readFatChain = (start) => Buffer.concat(
    chain(start, fat, fileSectorBound).map((sectorId) => readSector(buffer, sectorSize, sectorId)),
  )
  const directoryBytes = readFatChain(firstDirectorySector)
  const directory = parseDirectory(directoryBytes)
  const root = directory.find((entry) => entry.objectType === 5)
  if (!root) throw new Error('CFB root entry is missing')
  const miniStream = root.streamSize > 0
    ? readFatChain(root.startSector).subarray(0, root.streamSize)
    : Buffer.alloc(0)
  const miniFat = miniFatSectorCount > 0
    ? uint32Table(readFatChain(firstMiniFatSector).subarray(0, miniFatSectorCount * sectorSize))
    : []
  const streams = new Map()
  for (const entry of directory.filter((candidate) => candidate.objectType === 2)) {
    let stream
    if (entry.streamSize < miniStreamCutoff) {
      const miniSectorIds = chain(entry.startSector, miniFat, Math.ceil(miniStream.length / miniSectorSize) + 1)
      stream = Buffer.concat(miniSectorIds.map((sectorId) => {
        const offset = sectorId * miniSectorSize
        return miniStream.subarray(offset, offset + miniSectorSize)
      }))
    } else {
      stream = readFatChain(entry.startSector)
    }
    streams.set(entry.name, stream.subarray(0, entry.streamSize))
  }
  return { sectorSize, miniSectorSize, directory, streams }
}

function xmlValue(xml, tag) {
  const match = String(xml).match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return match?.[1]?.replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim() || null
}

function partAtomSummary(bytes) {
  const xml = bytes.toString('utf8').replace(/^\uFEFF/, '')
  const parameterNames = [...xml.matchAll(/<([A-Za-z][A-Za-z0-9_]*)(?:\s[^>]*)?\s+typeOfParameter=/g)]
    .map((match) => match[1])
  const uniqueParameters = [...new Set(parameterNames)].sort()
  const threadParameterNames = uniqueParameters.filter((name) =>
    /thread|pitch|tpi|crest|root|flank|lead/i.test(name),
  )
  const assemblyParameterNames = uniqueParameters.filter((name) =>
    /bracket|flex|hose|bend|reducer|grid|extension|connector/i.test(name),
  )
  return {
    byteLength: bytes.length,
    completeXml: /<entry\b/i.test(xml) && /<\/entry>\s*$/i.test(xml.trim()),
    familyTitle: xmlValue(xml, 'title'),
    updated: xmlValue(xml, 'updated'),
    productVersion: xmlValue(xml, 'A:product-version'),
    declaredVariationCount: Number(xmlValue(xml, 'A:variationCount')) || 0,
    parsedPartCount: (xml.match(/<A:part\b/gi) || []).length,
    uniqueParameterCount: uniqueParameters.length,
    lengthParameterCount: (xml.match(/typeOfParameter="(?:Length|Pipe Size)"/gi) || []).length,
    nptDescriptionCount: (xml.match(/\bNPT\b/gi) || []).length,
    threadParameterNames,
    hasThreadGeometryParameters: threadParameterNames.length > 0,
    assemblyParameterNames,
  }
}

function basicFileInfoSummary(bytes) {
  const text = bytes.toString('utf16le').replace(/\0/g, '')
  const value = (label) => text.match(new RegExp(`${label}:\\s*([^\\r\\n]+)`, 'i'))?.[1]?.trim() || null
  const lastSavePath = value('Last Save Path')
  return {
    revitBuild: value('Revit Build'),
    lastSaveFileName: lastSavePath?.split(/[\\/]/).at(-1) || null,
    localeWhenSaved: value('Locale when saved'),
    worksharing: value('Worksharing'),
    uniqueDocumentGuid: value('Unique Document GUID'),
    uniqueDocumentIncrements: Number(value('Unique Document Increments')) || null,
  }
}

export async function auditRfaMetadata(bytes, source = {}) {
  const buffer = asBuffer(bytes)
  const firstText = buffer.subarray(0, Math.min(buffer.length, 4096)).toString('utf8')
  const sourceBase = {
    role: source.role || null,
    relativePath: source.relativePath || null,
    sourceFileName: source.fileName || null,
    sourceFileSha256: source.fileSha256 || null,
    sourceByteLength: buffer.length,
  }
  let audit
  if (/<!doctype\s+html|<html\b/i.test(firstText)) {
    audit = {
      artifactType: 'halofire.rfa-metadata-audit.v1',
      ...sourceBase,
      sourceClassification: 'html-response-mislabeled-as-rfa',
      validRevitFamilyContainer: false,
      compoundDocumentStreamNames: [],
      basicFileInfo: null,
      partAtom: null,
      manufacturerAuthoredFamilyMetadataReady: false,
      dimensionMetadataReady: false,
      geometryKernelInspectionVerified: false,
      closedWatertightSolidTopologyReady: false,
      threadBearingSolidReady: false,
      matingFitVerified: false,
      exactPartGeometryEligible: false,
    }
  } else {
    const compound = extractCfbStreams(buffer)
    const partAtomBytes = compound.streams.get('PartAtom')
    const basicFileInfoBytes = compound.streams.get('BasicFileInfo')
    if (!partAtomBytes) throw new Error('RFA PartAtom stream is missing')
    const partAtom = partAtomSummary(partAtomBytes)
    audit = {
      artifactType: 'halofire.rfa-metadata-audit.v1',
      ...sourceBase,
      sourceClassification: 'revit-family-with-partatom-metadata',
      validRevitFamilyContainer: true,
      compoundDocumentSectorSize: compound.sectorSize,
      compoundDocumentStreamNames: [...compound.streams.keys()].sort(),
      basicFileInfo: basicFileInfoBytes
        ? basicFileInfoSummary(basicFileInfoBytes)
        : null,
      partAtom,
      quoteBoundProductNumber: source.quoteBoundProductNumber || null,
      quoteBoundProductNumberOccurrences: source.quoteBoundProductNumber
        ? (partAtomBytes.toString('utf8').match(new RegExp(source.quoteBoundProductNumber, 'gi')) || []).length
        : 0,
      manufacturerAuthoredFamilyMetadataReady: partAtom.completeXml,
      dimensionMetadataReady: partAtom.completeXml && partAtom.lengthParameterCount > 0,
      geometryKernelInspectionVerified: false,
      closedWatertightSolidTopologyReady: false,
      threadBearingSolidReady: false,
      matingFitVerified: false,
      exactPartGeometryEligible: false,
    }
  }
  return { ...audit, receiptSha256: await sha256Hex(audit) }
}

export async function verifyRfaMetadataAudit(packet = {}) {
  const draft = structuredClone(packet)
  const receiptSha256 = draft.receiptSha256
  delete draft.receiptSha256
  const expected = await sha256Hex(draft)
  const issues = []
  if (receiptSha256 !== expected) issues.push('RFA_METADATA_RECEIPT_MISMATCH')
  if (
    draft.geometryKernelInspectionVerified !== false ||
    draft.closedWatertightSolidTopologyReady !== false ||
    draft.threadBearingSolidReady !== false ||
    draft.matingFitVerified !== false ||
    draft.exactPartGeometryEligible !== false
  ) issues.push('RFA_METADATA_FALSE_GEOMETRY_PROMOTION')
  if (draft.sourceClassification === 'html-response-mislabeled-as-rfa') {
    if (draft.validRevitFamilyContainer !== false || draft.manufacturerAuthoredFamilyMetadataReady !== false) {
      issues.push('RFA_HTML_RESPONSE_PROMOTED')
    }
  } else if (
    draft.sourceClassification !== 'revit-family-with-partatom-metadata' ||
    draft.validRevitFamilyContainer !== true ||
    draft.partAtom?.completeXml !== true ||
    draft.partAtom?.declaredVariationCount !== draft.partAtom?.parsedPartCount
  ) {
    issues.push('RFA_METADATA_CONTAINER_INVALID')
  }
  return { status: issues.length ? 'blocked' : 'passed', issues, receiptSha256: expected }
}

export async function verifyManufacturerRfaMetadataAudit(packet = {}) {
  const draft = structuredClone(packet)
  const receiptSha256 = draft.receiptSha256
  delete draft.receiptSha256
  const expected = await sha256Hex(draft)
  const issues = []
  if (receiptSha256 !== expected) issues.push('MANUFACTURER_RFA_AUDIT_RECEIPT_MISMATCH')
  const sourceResults = await Promise.all(
    (draft.sources || []).map((source) => verifyRfaMetadataAudit(source)),
  )
  if (sourceResults.some((result) => result.status !== 'passed')) {
    issues.push('MANUFACTURER_RFA_SOURCE_RECEIPT_INVALID')
  }
  const validCount = (draft.sources || []).filter((source) => source.validRevitFamilyContainer).length
  const htmlCount = (draft.sources || []).filter(
    (source) => source.sourceClassification === 'html-response-mislabeled-as-rfa',
  ).length
  if (
    draft.artifactType !== 'halofire.manufacturer-rfa-metadata-audit.v1' ||
    draft.sources?.length !== 3 ||
    draft.validRevitFamilyCount !== validCount ||
    draft.mislabeledHtmlResponseCount !== htmlCount ||
    draft.geometryKernelInspectionVerifiedCount !== 0 ||
    draft.threadBearingSolidReadyCount !== 0 ||
    draft.exactPartGeometryEligibleCount !== 0
  ) issues.push('MANUFACTURER_RFA_AUDIT_SUMMARY_INVALID')
  return { status: issues.length ? 'blocked' : 'passed', issues, receiptSha256: expected }
}

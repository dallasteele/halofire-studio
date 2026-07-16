import { sha256Hex } from '../engine/elevation-datums.js'

const SOLID_PRIMITIVE_TYPES = new Set([150, 152, 154, 156, 158, 160, 162, 164, 168])
const SOLID_TOPOLOGY_TYPES = new Set([180, 184, 186, 502, 504, 508, 510, 514])
const SURFACE_TYPES = new Set([108, 114, 118, 120, 122, 128, 140, 142, 143, 144])
const CURVE_TYPES = new Set([100, 102, 104, 106, 110, 112, 116, 126, 130, 132])

const number = (value) => Number(String(value).trim().replace(/D/gi, 'E'))
const finite = (value) => Number.isFinite(value)
const field = (line, index) => line.slice(index * 8, (index + 1) * 8).trim()

function splitRecords(text) {
  const lines = String(text).split(/\r?\n/).filter((line) => line.length > 0)
  const sections = {}
  for (const line of lines) {
    const section = line.length >= 73 ? line[72] : null
    if (section) sections[section] = (sections[section] || 0) + 1
  }
  return { lines, sections }
}

function parseDirectory(lines) {
  const directory = lines.filter((line) => line.length >= 73 && line[72] === 'D')
  if (directory.length === 0 || directory.length % 2 !== 0) {
    throw new Error('IGES directory section must contain complete two-line entries')
  }
  const entries = []
  for (let index = 0; index < directory.length; index += 2) {
    const first = directory[index]
    const second = directory[index + 1]
    const directoryPointer = number(first.slice(73))
    const entityType = number(field(first, 0))
    if (!Number.isInteger(directoryPointer) || !Number.isInteger(entityType)) {
      throw new Error('IGES directory entry identity is invalid')
    }
    entries.push({
      directoryPointer,
      entityType,
      parameterPointer: number(field(first, 1)),
      transformationPointer: number(field(first, 6)) || 0,
      status: field(first, 8),
      parameterLineCount: number(field(second, 3)),
      formNumber: number(field(second, 4)) || 0,
      label: field(second, 7),
    })
  }
  return entries
}

function parameterDataByDirectoryPointer(lines) {
  const result = new Map()
  for (const line of lines.filter((entry) => entry.length >= 73 && entry[72] === 'P')) {
    const pointer = number(line.slice(64, 72))
    if (!Number.isInteger(pointer)) throw new Error('IGES parameter-to-directory pointer is invalid')
    result.set(pointer, `${result.get(pointer) || ''}${line.slice(0, 64)}`)
  }
  return result
}

function parameters(value) {
  return String(value || '')
    .replace(/;\s*$/, '')
    .split(',')
    .map((entry) => entry.trim())
}

function geometryZValues(entry, parameterText) {
  const values = parameters(parameterText)
  if (number(values[0]) !== entry.entityType) return []
  if (entry.entityType === 110) return [number(values[3]), number(values[6])]
  if (entry.entityType === 100) return [number(values[1])]
  if (entry.entityType === 116) return [number(values[3])]
  if (entry.entityType === 408) return [number(values[4])]
  if (entry.entityType !== 128) return []

  const k1 = number(values[1])
  const k2 = number(values[2])
  const m1 = number(values[3])
  const m2 = number(values[4])
  if (![k1, k2, m1, m2].every(Number.isInteger)) return []
  const controlPointCount = (k1 + 1) * (k2 + 1)
  const controlStart = 10 + (k1 + m1 + 2) + (k2 + m2 + 2) + controlPointCount
  return Array.from({ length: controlPointCount }, (_, index) =>
    number(values[controlStart + index * 3 + 2]),
  )
}

function headerSummary(lines) {
  const global = lines
    .filter((line) => line.length >= 73 && line[72] === 'G')
    .map((line) => line.slice(0, 72))
    .join('')
  return {
    declaresLineArtSource: /line art and application drawings/i.test(global),
    declaresDxfSource: /SWDR\.dxf/i.test(global),
    declaresInchUnits: /,2HIN,/.test(global),
    translator: global.match(/Autodesk IGES Translator[^,;]*/i)?.[0] || null,
  }
}

export async function auditIgesTopology(text, source = {}) {
  const { lines, sections } = splitRecords(text)
  if (!sections.S || !sections.G || !sections.D || !sections.P || !sections.T) {
    throw new Error('IGES start, global, directory, parameter, and terminate sections are required')
  }
  const entries = parseDirectory(lines)
  const parameterMap = parameterDataByDirectoryPointer(lines)
  const entityTypeCounts = {}
  for (const entry of entries) {
    entityTypeCounts[entry.entityType] = (entityTypeCounts[entry.entityType] || 0) + 1
  }
  const zValues = entries.flatMap((entry) =>
    geometryZValues(entry, parameterMap.get(entry.directoryPointer)),
  ).filter(finite)
  const maximumAbsoluteZIn = zValues.length
    ? Math.max(...zValues.map((value) => Math.abs(value)))
    : null
  const curveEntityCount = entries.filter((entry) => CURVE_TYPES.has(entry.entityType)).length
  const surfaceEntityCount = entries.filter((entry) => SURFACE_TYPES.has(entry.entityType)).length
  const solidPrimitiveEntityCount = entries.filter((entry) => SOLID_PRIMITIVE_TYPES.has(entry.entityType)).length
  const solidTopologyEntityCount = entries.filter((entry) => SOLID_TOPOLOGY_TYPES.has(entry.entityType)).length
  const header = headerSummary(lines)
  const topology = {
    artifactType: 'halofire.iges-topology-audit.v1',
    sourceFileName: source.fileName || null,
    sourceFileSha256: source.fileSha256 || null,
    sections,
    entityCount: entries.length,
    entityTypeCounts,
    curveEntityCount,
    surfaceEntityCount,
    solidPrimitiveEntityCount,
    solidTopologyEntityCount,
    sampledGeometryZValueCount: zValues.length,
    maximumAbsoluteZIn,
    allSampledGeometryPlanar: maximumAbsoluteZIn === 0,
    header,
    closedWatertightSolidTopologyReady: solidTopologyEntityCount > 0,
    threadBearingSolidReady: false,
    classification: solidPrimitiveEntityCount === 0 && solidTopologyEntityCount === 0
      ? 'curve-dominant-planar-drawing-without-solid-topology'
      : 'solid-capable-entities-present-needs-kernel-verification',
    exactPartGeometryEligible: false,
  }
  return { ...topology, receiptSha256: await sha256Hex(topology) }
}

export async function verifyIgesTopologyAudit(packet = {}) {
  const draft = structuredClone(packet)
  const receiptSha256 = draft.receiptSha256
  delete draft.receiptSha256
  const expected = await sha256Hex(draft)
  const issues = []
  if (receiptSha256 !== expected) issues.push('IGES_TOPOLOGY_RECEIPT_MISMATCH')
  if (draft.closedWatertightSolidTopologyReady !== false || draft.threadBearingSolidReady !== false || draft.exactPartGeometryEligible !== false) issues.push('IGES_FALSE_SOLID_PROMOTION')
  if (draft.solidPrimitiveEntityCount !== 0 || draft.solidTopologyEntityCount !== 0) issues.push('IGES_SOLID_ENTITY_COUNT_CHANGED')
  if (draft.header?.declaresLineArtSource !== true || draft.header?.declaresDxfSource !== true) issues.push('IGES_HEADER_SOURCE_CLASSIFICATION_CHANGED')
  return { status: issues.length ? 'blocked' : 'passed', issues, receiptSha256: expected }
}

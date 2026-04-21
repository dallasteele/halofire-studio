/**
 * SCAD annotation parser — reads `// @tag ...` lines from a .scad
 * file and produces a structured ParsedScad. Invalid / malformed
 * annotations become warnings; the parser never throws on bad
 * annotations (IO errors from fs.readFileSync still propagate).
 *
 * Grammar reference: docs/blueprints/03_CATALOG_ENGINE.md §1.
 */

import { readFileSync } from 'node:fs'
import { basename, extname } from 'node:path'
import type {
  ConnectionPort,
  ConnectionStyle,
  PartCategory,
  PartKind,
  PartMeta,
  PortRole,
  ScadParam,
  ScadParamType,
} from '../catalog/part.js'

export interface ParsedScad {
  /** Path relative to cwd as passed in; full absolute path is fine. */
  source: string
  part: PartMeta
  params: Record<string, ScadParam>
  ports: ConnectionPort[]
  warnings: string[]
}

const KNOWN_KINDS: ReadonlySet<PartKind> = new Set<PartKind>([
  'sprinkler_head',
  'pipe_segment',
  'fitting',
  'valve',
  'hanger',
  'device',
  'fdc',
  'riser_assy',
  'compound',
  'structural',
  'unknown',
])

const KNOWN_STYLES: ReadonlySet<ConnectionStyle> = new Set<ConnectionStyle>([
  'NPT_threaded',
  'grooved',
  'flanged.150',
  'flanged.300',
  'solvent_welded',
  'soldered',
  'stortz',
  'none',
])

const KNOWN_ROLES: ReadonlySet<PortRole> = new Set<PortRole>([
  'run_a',
  'run_b',
  'branch',
  'drop',
])

export function parseScad(filepath: string): ParsedScad {
  const text = readFileSync(filepath, 'utf-8')
  return parseScadText(text, filepath)
}

/** Testable core — accepts raw SCAD source text. */
export function parseScadText(text: string, source = '<memory>'): ParsedScad {
  const warnings: string[] = []
  const params: Record<string, ScadParam> = {}
  const ports: ConnectionPort[] = []
  const stem = basename(source, extname(source))

  const meta: PartMeta = {
    slug: '',
    kind: 'unknown',
    category: '',
    displayName: '',
  }

  const lines = text.split(/\r?\n/)
  for (let idx = 0; idx < lines.length; idx++) {
    const raw = lines[idx]
    if (raw === undefined) continue
    const line = raw.trim()
    if (!line.startsWith('//')) continue
    const body = line.slice(2).trim()
    if (!body.startsWith('@')) continue

    const spaceAt = body.indexOf(' ')
    const tag = spaceAt === -1 ? body : body.slice(0, spaceAt)
    const rest = spaceAt === -1 ? '' : body.slice(spaceAt + 1).trim()

    switch (tag) {
      case '@part':
        meta.slug = rest
        break
      case '@kind':
        if (KNOWN_KINDS.has(rest as PartKind)) {
          meta.kind = rest as PartKind
        } else {
          warnings.push(`unknown @kind "${rest}" at line ${idx + 1}`)
        }
        break
      case '@category':
        if (!/^[a-z0-9]+(\.[a-z0-9]+)+$/i.test(rest)) {
          warnings.push(`malformed @category "${rest}" at line ${idx + 1}`)
        }
        meta.category = rest as PartCategory
        break
      case '@display-name':
        meta.displayName = stripQuotes(rest)
        break
      case '@mfg':
        meta.manufacturer = rest
        break
      case '@mfg-pn':
        meta.mfgPartNumber = rest
        break
      case '@listing':
        meta.listing = rest
        break
      case '@hazard-classes':
        meta.hazardClasses = rest.split(/\s+/).filter(Boolean)
        break
      case '@price-usd': {
        const n = Number(rest)
        if (Number.isFinite(n)) meta.priceUsd = n
        else warnings.push(`bad @price-usd "${rest}" at line ${idx + 1}`)
        break
      }
      case '@install-minutes': {
        const n = Number(rest)
        if (Number.isFinite(n)) meta.installMinutes = n
        else warnings.push(`bad @install-minutes "${rest}" at line ${idx + 1}`)
        break
      }
      case '@crew':
        if (
          rest === 'foreman' ||
          rest === 'journeyman' ||
          rest === 'apprentice' ||
          rest === 'mixed'
        ) {
          meta.crewRole = rest
        } else {
          warnings.push(`unknown @crew "${rest}" at line ${idx + 1}`)
        }
        break
      case '@weight-kg': {
        const n = Number(rest)
        if (Number.isFinite(n)) meta.weightKg = n
        break
      }
      case '@k-factor': {
        const n = Number(rest)
        if (Number.isFinite(n)) meta.kFactor = n
        break
      }
      case '@orientation':
        if (
          rest === 'pendant' ||
          rest === 'upright' ||
          rest === 'sidewall' ||
          rest === 'concealed'
        ) {
          meta.orientation = rest
        }
        break
      case '@response':
        if (rest === 'standard' || rest === 'quick' || rest === 'esfr') {
          meta.response = rest
        }
        break
      case '@temperature':
        meta.temperature = rest
        break
      case '@thumbnail':
        meta.thumbnail = rest
        break
      case '@tags':
        meta.tags = rest.split(/\s+/).filter(Boolean)
        break
      case '@param': {
        const parsed = parseParamLine(rest)
        if (!parsed) {
          warnings.push(`bad @param at line ${idx + 1}: "${rest}"`)
        } else {
          params[parsed.name] = parsed
        }
        break
      }
      case '@port': {
        const parsed = parsePortLine(rest)
        if (!parsed) {
          warnings.push(`bad @port at line ${idx + 1}: "${rest}"`)
        } else {
          if (!KNOWN_STYLES.has(parsed.style)) {
            warnings.push(
              `unknown port style "${parsed.style}" at line ${idx + 1}`,
            )
          }
          if (!KNOWN_ROLES.has(parsed.role)) {
            warnings.push(
              `unknown port role "${parsed.role}" at line ${idx + 1}`,
            )
          }
          ports.push(parsed)
        }
        break
      }
      default:
        // Tolerate unknown @tags for forward-compat; no warning.
        break
    }
  }

  if (!meta.slug) {
    warnings.push('missing required @part annotation')
    meta.slug = stem
  } else if (meta.slug !== stem) {
    warnings.push(`@part slug "${meta.slug}" does not match filename "${stem}"`)
  }
  if (meta.kind === 'unknown') {
    warnings.push('missing required @kind annotation')
  }
  if (!meta.category) {
    warnings.push('missing required @category annotation')
  }
  if (!meta.displayName) {
    warnings.push('missing required @display-name annotation')
  }
  if (ports.length === 0 && meta.kind !== 'structural') {
    warnings.push('part has no @port annotations')
  }

  return { source, part: meta, params, ports, warnings }
}

// --- line-level sub-parsers --------------------------------------

function stripQuotes(s: string): string {
  const t = s.trim()
  if (
    t.length >= 2 &&
    ((t.startsWith('"') && t.endsWith('"')) ||
      (t.startsWith("'") && t.endsWith("'")))
  ) {
    return t.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'")
  }
  return t
}

/** `size_in enum[2,4] default=4 label="Size" unit="in"` */
export function parseParamLine(src: string): ScadParam | null {
  const s = src.trim()
  if (!s) return null
  // split on first whitespace → name
  const m = s.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+(.*)$/)
  if (!m) return null
  const name = m[1] as string
  const rhs = m[2] as string
  const type = parseParamType(rhs)
  if (!type) return null

  const param: ScadParam = { name, type }

  const def = extractKv(rhs, 'default')
  if (def !== undefined) {
    param.default = coerceParamValue(def, type)
  }
  const label = extractKv(rhs, 'label')
  if (label !== undefined) param.label = stripQuotes(label)
  const unit = extractKv(rhs, 'unit')
  if (unit !== undefined) param.unit = stripQuotes(unit)

  return param
}

function parseParamType(rhs: string): ScadParamType | null {
  // enum[...]
  const enumM = rhs.match(/^enum\[([^\]]*)\]/)
  if (enumM) {
    const raw = (enumM[1] as string)
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
    const values: Array<number | string> = raw.map((v) => {
      const n = Number(v)
      return Number.isFinite(n) && /^-?[0-9]/.test(v) ? n : stripQuotes(v)
    })
    return { kind: 'enum', values }
  }
  // number[min,max]
  const numRangeM = rhs.match(/^number\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]/)
  if (numRangeM) {
    return {
      kind: 'number',
      min: Number(numRangeM[1]),
      max: Number(numRangeM[2]),
    }
  }
  if (/^number\b/.test(rhs)) return { kind: 'number' }
  if (/^string\b/.test(rhs)) return { kind: 'string' }
  if (/^bool\b/.test(rhs)) return { kind: 'bool' }
  return null
}

function coerceParamValue(
  raw: string,
  type: ScadParamType,
): number | string | boolean {
  const v = stripQuotes(raw)
  if (type.kind === 'bool') return v === 'true'
  if (type.kind === 'number') {
    const n = Number(v)
    return Number.isFinite(n) ? n : v
  }
  if (type.kind === 'enum') {
    const n = Number(v)
    if (Number.isFinite(n) && /^-?[0-9]/.test(v)) return n
    return v
  }
  return v
}

/**
 * `in position=[-0.152,0,0] direction=[-1,0,0] style=grooved size_in=4 role=run_a`
 */
export function parsePortLine(src: string): ConnectionPort | null {
  const s = src.trim()
  if (!s) return null
  const nameM = s.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+(.*)$/)
  if (!nameM) return null
  const name = nameM[1] as string
  const rhs = nameM[2] as string

  const pos = extractVec3(rhs, 'position')
  const dir = extractVec3(rhs, 'direction')
  const style = extractKv(rhs, 'style')
  const sizeRaw = extractKv(rhs, 'size_in')
  const role = extractKv(rhs, 'role')
  if (!pos || !dir || !style || !sizeRaw || !role) return null
  const size_in = Number(sizeRaw)
  if (!Number.isFinite(size_in)) return null

  return {
    name,
    position_m: pos,
    direction: dir,
    style: style as ConnectionStyle,
    size_in,
    role: role as PortRole,
  }
}

/** Extract `key=value` where value is not bracketed. Quoted strings allowed. */
function extractKv(src: string, key: string): string | undefined {
  // match key="..." | key='...' | key=<non-space>
  const re = new RegExp(
    `\\b${key}=(?:"([^"]*)"|'([^']*)'|([^\\s]+))`,
  )
  const m = src.match(re)
  if (!m) return undefined
  return (m[1] ?? m[2] ?? m[3]) as string
}

function extractVec3(src: string, key: string): [number, number, number] | null {
  const re = new RegExp(`\\b${key}=\\[\\s*([^\\]]+)\\]`)
  const m = src.match(re)
  if (!m) return null
  const parts = (m[1] as string).split(',').map((v) => Number(v.trim()))
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null
  return [parts[0] as number, parts[1] as number, parts[2] as number]
}

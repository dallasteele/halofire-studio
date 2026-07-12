import { z } from 'zod';

const SHA256_RE = /^[0-9a-f]{64}$/;

export const SourceBindingSchema = z.object({
  sourcePdfSha256: z.string().toLowerCase().regex(SHA256_RE),
  physicalPageNumber: z.number().int().positive(),
  pageIndex: z.number().int().nonnegative(),
  renderedPageSha256: z.string().toLowerCase().regex(SHA256_RE),
  sheetId: z.string().trim().min(1),
  coordinateSpace: z.enum(['pdf-points', 'sheet-feet', 'plan-feet']),
  renderProfile: z.object({
    renderer: z.string().trim().min(1),
    rendererVersion: z.string().trim().min(1),
    matrixScale: z.number().positive(),
    colorspace: z.enum(['rgb', 'gray', 'cmyk']),
    alpha: z.boolean(),
  }).strict().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.physicalPageNumber !== value.pageIndex + 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'physicalPageNumber must equal pageIndex + 1',
      path: ['physicalPageNumber'],
    });
  }
});

export const ElevationObservationSchema = z.object({
  id: z.string().trim().min(1),
  kind: z.enum(['floor', 'eave', 'ridge', 'valley', 'section-point', 'roof-point']),
  label: z.string().trim().min(1),
  elevationText: z.string().trim().min(1).optional(),
  elevationFt: z.number().finite().optional(),
  planPointFt: z.tuple([z.number().finite(), z.number().finite()]).optional(),
  sectionPositionFt: z.number().finite().optional(),
  sourceBinding: SourceBindingSchema,
}).strict().superRefine((value, ctx) => {
  if (value.elevationText == null && value.elevationFt == null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'elevationText or elevationFt is required' });
  }
});

export const ElevationDatumPacketDraftSchema = z.object({
  artifactType: z.literal('halofire.elevation-datum-packet.v1'),
  sourceDocumentId: z.string().trim().min(1),
  sourceBinding: SourceBindingSchema,
  observations: z.array(ElevationObservationSchema).min(1),
}).strict();

export const ElevationDatumPacketSchema = ElevationDatumPacketDraftSchema.extend({
  receiptSha256: z.string().toLowerCase().regex(SHA256_RE),
}).strict();

function issue(code, message, refs = []) {
  return { severity: 'blocking', code, refs, message };
}
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(typeof value === 'string' ? value : canonicalJson(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function sourceBindingKey(binding) {
  return canonicalJson(SourceBindingSchema.parse(binding));
}

/** Parse an exact architectural elevation token such as +89'-6 3/4" or +10'-0". */
export function parseArchitecturalElevation(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/\u00b1/g, '+').replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"');
  if (/^[+-]?0(?:\.0+)?\s*(?:'|ft)?$/i.test(text)) return 0;
  const decimal = text.match(/^([+-]?\d+(?:\.\d+)?)\s*(?:ft|')$/i);
  if (decimal) return Number(decimal[1]);
  const match = text.match(/^([+-]?)(\d+)\s*'\s*(?:-\s*)?(\d+)?(?:\s+(\d+)\s*\/\s*(\d+))?\s*(?:"|in)?$/i);
  if (!match) return null;
  const sign = match[1] === '-' ? -1 : 1;
  const feet = Number(match[2]);
  const inches = match[3] == null ? 0 : Number(match[3]);
  const numerator = match[4] == null ? 0 : Number(match[4]);
  const denominator = match[5] == null ? 1 : Number(match[5]);
  if (![feet, inches, numerator, denominator].every(Number.isFinite)
    || inches >= 12 || numerator < 0 || denominator <= 0 || numerator >= denominator) return null;
  return sign * (feet + (inches + numerator / denominator) / 12);
}

export async function sealElevationDatumPacket(draft) {
  const parsed = ElevationDatumPacketDraftSchema.parse(draft);
  return { ...parsed, receiptSha256: await sha256Hex(parsed) };
}

/**
 * Validate and extract source-bound vertical datums. The packet receipt binds every
 * observation, coordinate, source hash, rendered page, and physical page number.
 */
export async function extractElevationDatums(packetInput, opts = {}) {
  const parsed = ElevationDatumPacketSchema.safeParse(packetInput);
  if (!parsed.success) {
    return {
      status: 'blocked', datums: [], complianceReady: false,
      issues: [issue('ELEVATION_PACKET_SCHEMA_INVALID', parsed.error.issues.map((entry) => entry.message).join('; '))],
    };
  }
  const packet = parsed.data;
  const { receiptSha256, ...draft } = packet;
  const actualReceipt = await sha256Hex(draft);
  if (actualReceipt !== receiptSha256) {
    return {
      status: 'blocked', datums: [], complianceReady: false,
      issues: [issue('ELEVATION_PACKET_RECEIPT_MISMATCH', 'Datum packet content does not match its immutable SHA-256 receipt.', [receiptSha256])],
    };
  }
  if (opts.expectedSourcePdfSha256 && packet.sourceBinding.sourcePdfSha256 !== String(opts.expectedSourcePdfSha256).toLowerCase()) {
    return {
      status: 'blocked', datums: [], complianceReady: false,
      issues: [issue('ELEVATION_SOURCE_PDF_MISMATCH', 'Datum packet is bound to a different source PDF.', [packet.sourceBinding.sourcePdfSha256])],
    };
  }
  const rootBinding = sourceBindingKey(packet.sourceBinding);
  const issues = [];
  const datums = [];
  const ids = new Set();
  for (const observation of packet.observations) {
    if (ids.has(observation.id)) {
      issues.push(issue('ELEVATION_DATUM_ID_DUPLICATE', `Duplicate datum id: ${observation.id}`, [observation.id]));
      continue;
    }
    ids.add(observation.id);
    if (sourceBindingKey(observation.sourceBinding) !== rootBinding) {
      issues.push(issue('ELEVATION_DATUM_SOURCE_MISMATCH', `Datum ${observation.id} is not bound to the packet source page.`, [observation.id]));
      continue;
    }
    const elevationFt = observation.elevationFt == null
      ? parseArchitecturalElevation(observation.elevationText) : observation.elevationFt;
    if (!Number.isFinite(elevationFt)) {
      issues.push(issue('ELEVATION_TOKEN_UNPARSEABLE', `Datum ${observation.id} has an invalid architectural elevation token.`, [observation.id]));
      continue;
    }
    datums.push({
      id: observation.id,
      kind: observation.kind,
      label: observation.label,
      elevationFt,
      elevationText: observation.elevationText || null,
      planPointFt: observation.planPointFt || null,
      sectionPositionFt: observation.sectionPositionFt ?? null,
      sourceBinding: observation.sourceBinding,
      evidenceReceiptSha256: receiptSha256,
    });
  }
  const toleranceFt = Number.isFinite(Number(opts.conflictToleranceFt)) ? Math.abs(Number(opts.conflictToleranceFt)) : 1 / 96;
  const byLabel = new Map();
  for (const datum of datums) {
    const key = `${datum.kind}:${datum.label.trim().toLowerCase()}`;
    const prior = byLabel.get(key);
    if (prior && Math.abs(prior.elevationFt - datum.elevationFt) > toleranceFt) {
      issues.push(issue('ELEVATION_DATUM_CONFLICT', `Conflicting elevations for ${datum.label}.`, [prior.id, datum.id]));
    } else if (!prior) byLabel.set(key, datum);
  }
  return {
    status: issues.length ? 'blocked' : 'passed',
    artifactType: 'halofire.elevation-datum-set.v1',
    sourceDocumentId: packet.sourceDocumentId,
    sourceBinding: packet.sourceBinding,
    evidenceReceiptSha256: receiptSha256,
    datums: issues.length ? [] : datums,
    issues,
    verification: {
      schemaValidated: true,
      receiptValidated: true,
      perDatumSourceValidated: issues.every((entry) => entry.code !== 'ELEVATION_DATUM_SOURCE_MISMATCH'),
    },
    complianceReady: false,
    claimStatus: 'source-bound-geometry-input-only',
  };
}

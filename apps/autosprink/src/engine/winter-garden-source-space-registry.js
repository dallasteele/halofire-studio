import { sha256Hex } from './elevation-datums.js';
import { validateHaloFireOperationalKnowledgeReceipt } from './halofire-operational-knowledge.js';
import { pointInPolygon } from './sprinkler-layout.js';

const PROJECT = 'LDS Meeting House - Winter Garden FL';
const SHA = /^[0-9a-f]{64}$/;
const EXPECTED_SOURCES = Object.freeze({
  A101: '861626b3a6838ddd340d15e20c88c55d2d7896df7d8ef45276d518e4112040fb',
  A103: 'bca163d23e89b86332f670f6f234f5bc5319b1a1e461de28a3fb3124120c2f89',
  A151: '4a6c4b29eff18a8e964627ba41807f2f8119f8a2c8012d5900acf08e61ee8e43',
  A301: '719ae05138b3872c2ed8740fa4470ca457dcc0a9f8fec617cabf7969560ecc30',
});
const issue = (code, message) => ({ severity: 'blocking', code, message });
const round = (value, digits = 6) => Number(Number(value).toFixed(digits));

function fontHeight(item) {
  const transform = Array.isArray(item?.transform) ? item.transform : [];
  return Math.hypot(Number(transform[2]) || 0, Number(transform[3]) || 0);
}

function sourcePoint(item) {
  return [Number(item?.xPt ?? item?.transform?.[4]), Number(item?.yPt ?? item?.transform?.[5])];
}

function roomNameToken(value) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  if (!text || !/[A-Z]/i.test(text) || /\d/.test(text)) return null;
  if (/^(A|B|C|D|E|F|G|H|NORTH|SOUTH|EAST|WEST|TYP|SIM|NTS|SLOPED|FLAT)$/i.test(text)) return null;
  if (!/^[A-Z][A-Z'&. /-]*$/i.test(text)) return null;
  return text.toUpperCase();
}

/** Extract authoritative room number/name anchors from the A101 room-tag convention. */
export function extractWinterGardenRoomIdentityAnchors(textItems, registerPoint = (point) => point) {
  const items = (Array.isArray(textItems) ? textItems : [])
    .map((item) => ({ ...item, s: String(item?.s || '').trim(), point: sourcePoint(item), heightPt: fontHeight(item) }))
    .filter((item) => item.s && item.point.every(Number.isFinite));
  const numberItems = items.filter((item) => /^(10[1-9]|1[1-5][0-9])$/.test(item.s) && item.heightPt >= 8 && item.heightPt <= 11);
  const byNumber = new Map();
  for (const numberItem of numberItems) {
    const [x, y] = numberItem.point;
    const nameLines = items
      .map((item) => ({ item, token: roomNameToken(item.s), dx: Math.abs(item.point[0] - x), dy: item.point[1] - y }))
      .filter(({ item, token, dx, dy }) => token && dx <= 35 && dy >= 8 && dy <= 43 && Math.abs(item.heightPt - numberItem.heightPt) <= 0.75)
      .sort((left, right) => right.item.point[1] - left.item.point[1] || left.item.point[0] - right.item.point[0]);
    if (!nameLines.length) continue;
    const name = nameLines.map(({ token }) => token).join(' ').replace(/\s+/g, ' ').trim();
    const mapped = registerPoint(numberItem.point);
    if (!Array.isArray(mapped) || mapped.length < 2 || !mapped.every(Number.isFinite)) continue;
    const entry = {
      roomNumber: numberItem.s,
      roomName: name,
      sourcePointPt: numberItem.point.map((value) => round(value)),
      registeredPointFt: mapped.map((value) => round(value)),
      sourceSheet: 'A101',
      extractionMethod: 'room-number-with-stacked-name-lines',
    };
    const existing = byNumber.get(entry.roomNumber);
    if (!existing || entry.roomName.length > existing.roomName.length) byNumber.set(entry.roomNumber, entry);
  }
  return [...byNumber.values()].sort((left, right) => Number(left.roomNumber) - Number(right.roomNumber));
}

export function parseArchitecturalHeightFt(value) {
  const text = String(value || '').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
  const match = text.match(/^(\d+)\s*'\s*-?\s*(\d+)(?:\s+(\d+)\s*\/\s*(\d+))?\s*"$/);
  if (!match) return null;
  const feet = Number(match[1]);
  const inches = Number(match[2]);
  const numerator = Number(match[3] || 0);
  const denominator = Number(match[4] || 1);
  if (inches >= 12 || denominator <= 0 || numerator >= denominator) return null;
  return round(feet + (inches + numerator / denominator) / 12);
}

/** Extract A151 ceiling tags and pair only directly adjacent source height/slope controls. */
export function extractWinterGardenCeilingControls(registeredTextItems, boundsFt) {
  const items = (Array.isArray(registeredTextItems) ? registeredTextItems : [])
    .map((item) => ({ s: String(item?.s || '').trim(), xFt: Number(item?.xFt), yFt: Number(item?.yFt) }))
    .filter((item) => item.s && Number.isFinite(item.xFt) && Number.isFinite(item.yFt));
  const inside = (item) => !boundsFt || (item.xFt >= boundsFt.minX && item.xFt <= boundsFt.maxX && item.yFt >= boundsFt.minY && item.yFt <= boundsFt.maxY);
  const tags = items.filter((item) => /^C[1-9]$/.test(item.s) && inside(item));
  const heights = items.map((item) => ({ ...item, heightFt: parseArchitecturalHeightFt(item.s) })).filter((item) => item.heightFt != null && inside(item));
  const slopes = items.filter((item) => /^SLOPED$/i.test(item.s) && inside(item));
  return tags.map((tag, index) => {
    const nearest = (candidates, maxFt) => candidates
      .map((candidate) => ({ candidate, distanceFt: Math.hypot(candidate.xFt - tag.xFt, candidate.yFt - tag.yFt) }))
      .filter((entry) => entry.distanceFt <= maxFt)
      .sort((left, right) => left.distanceFt - right.distanceFt || left.candidate.xFt - right.candidate.xFt || left.candidate.yFt - right.candidate.yFt)[0] || null;
    // A151 stacks some sloped-ceiling type/slope/height callouts across three text rows.
    // Five feet is the measured maximum tag-stack search envelope, not a room-nearest guess.
    const height = nearest(heights, 5);
    const slope = nearest(slopes, 3.5);
    return {
      controlId: `a151-ceiling-${String(index + 1).padStart(3, '0')}`,
      ceilingType: tag.s,
      registeredPointFt: [round(tag.xFt), round(tag.yFt)],
      heightText: height?.candidate.s || null,
      heightFt: height?.candidate.heightFt ?? null,
      heightDistanceFt: height ? round(height.distanceFt) : null,
      sloped: Boolean(slope),
      slopeDistanceFt: slope ? round(slope.distanceFt) : null,
      sourceSheet: 'A151',
    };
  });
}

/** Bind source identities to geometric components without ever borrowing old model labels. */
export function buildWinterGardenSourceSpaceEntries({ identities, components, ceilingControls }) {
  const sourceIdentities = Array.isArray(identities) ? identities : [];
  const sourceComponents = Array.isArray(components) ? components : [];
  const controls = Array.isArray(ceilingControls) ? ceilingControls : [];
  const componentBindings = sourceComponents.map((component, componentIndex) => {
    const anchors = sourceIdentities.filter((identity) => pointInPolygon(identity.registeredPointFt, component.poly));
    return { component, componentIndex, anchors };
  });
  return sourceIdentities.map((identity) => {
    const bindings = componentBindings.filter((binding) => binding.anchors.some((anchor) => anchor.roomNumber === identity.roomNumber));
    const unique = bindings.length === 1 && bindings[0].anchors.length === 1 ? bindings[0] : null;
    const roomControls = unique ? controls.filter((control) => pointInPolygon(control.registeredPointFt, unique.component.poly)) : [];
    const heightResolved = roomControls.filter((control) => control.heightFt != null);
    const blockingReasons = [];
    if (!unique) blockingReasons.push(bindings.some((binding) => binding.anchors.length > 1) ? 'component-contains-multiple-room-anchors' : 'closed-source-room-component-not-found');
    if (unique) blockingReasons.push('source-room-boundary-completeness-not-yet-verified');
    if (!heightResolved.length) blockingReasons.push('source-ceiling-height-not-registered-to-room');
    return {
      roomNumber: identity.roomNumber,
      roomName: identity.roomName,
      sourceAnchorFt: identity.registeredPointFt,
      geometry: unique ? {
        status: 'source-anchor-component',
        boundaryCompleteness: 'unverified',
        componentIndex: unique.componentIndex,
        areaSqft: round(unique.component.areaSqft, 4),
        polygon: unique.component.poly,
      } : { status: 'blocked', componentIndex: null, areaSqft: null, polygon: null },
      ceilingControls: roomControls,
      ceiling: heightResolved.length ? {
        status: 'source-registered',
        minimumHeightFt: round(Math.min(...heightResolved.map((control) => control.heightFt))),
        maximumHeightFt: round(Math.max(...heightResolved.map((control) => control.heightFt))),
        sloped: roomControls.some((control) => control.sloped),
      } : { status: 'blocked', minimumHeightFt: null, maximumHeightFt: null, sloped: null },
      sprinklerCandidateReady: false,
      blockingReasons,
    };
  });
}

export async function sealWinterGardenSourceSpaceRegistry(draft) {
  const clean = structuredClone(draft);
  delete clean.receiptSha256;
  return { ...clean, receiptSha256: await sha256Hex(clean) };
}

export async function validateWinterGardenSourceSpaceRegistry(value) {
  const issues = [];
  if (!value || value.artifactType !== 'halofire.winter-garden-source-space-registry.v1' || value.projectName !== PROJECT) {
    return { status: 'blocked', issues: [issue('WG_SOURCE_SPACE_SCHEMA_INVALID', 'Winter Garden source-space registry identity is invalid.')], sprinklerCandidateReady: false };
  }
  const { receiptSha256, ...draft } = value;
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256) issues.push(issue('WG_SOURCE_SPACE_RECEIPT_MISMATCH', 'Source-space registry no longer matches its immutable receipt.'));
  const bindings = new Map((Array.isArray(value.sourceBindings) ? value.sourceBindings : []).map((entry) => [entry.sheet, entry.sha256]));
  if (bindings.size !== 4 || Object.entries(EXPECTED_SOURCES).some(([sheet, digest]) => bindings.get(sheet) !== digest)) issues.push(issue('WG_SOURCE_SPACE_SOURCE_DRIFT', 'A101/A103/A151/A301 source bindings are incomplete or changed.'));
  const operational = validateHaloFireOperationalKnowledgeReceipt(value.operationalKnowledge);
  if (operational.status !== 'passed') issues.push(issue('WG_SOURCE_SPACE_OPERATIONAL_KNOWLEDGE_MISSING', 'A passed Halo Fire full-lifecycle brain receipt must govern source registration.'));
  const entries = Array.isArray(value.spaces) ? value.spaces : [];
  const numbers = new Set(entries.map((entry) => entry.roomNumber));
  if (entries.length !== 54 || numbers.size !== 54 || entries.some((entry) => !entry.roomName || !/^1\d\d$/.test(entry.roomNumber))) issues.push(issue('WG_SOURCE_SPACE_IDENTITY_DRIFT', 'A101 must yield 54 unique numbered source room identities.'));
  const geometric = entries.filter((entry) => entry.geometry?.status === 'source-anchor-component');
  if (geometric.length !== 50 || geometric.some((entry) => !Array.isArray(entry.geometry?.polygon) || entry.geometry.polygon.length < 4)) issues.push(issue('WG_SOURCE_SPACE_GEOMETRY_DRIFT', 'Exactly 50 A101 room anchors currently replay to unique closed source components; unresolved rooms must remain blocked.'));
  if (entries.some((entry) => entry.sprinklerCandidateReady || (entry.geometry?.status === 'source-anchor-component' && entry.geometry?.boundaryCompleteness !== 'unverified'))) issues.push(issue('WG_SOURCE_SPACE_PREMATURE_LAYOUT_READINESS', 'Anchor components cannot become sprinkler candidates until whole-room boundary completeness is independently replayed inside the product.'));
  const ceiling = value.ceilingEvidence;
  if (ceiling?.controls !== 61 || ceiling?.heightResolved !== 57 || ceiling?.sourceSheet !== 'A151') issues.push(issue('WG_SOURCE_SPACE_CEILING_EVIDENCE_DRIFT', 'A151 must replay 61 ceiling controls, 57 with adjacent parseable source heights.'));
  if (value.generation?.answerKeyUsed !== false || value.generation?.oldRoomLabelsUsed !== false || value.generation?.registrationMethod !== 'labeled-piecewise-grid') issues.push(issue('WG_SOURCE_SPACE_ANSWER_KEY_LEAKAGE', 'Registration must be source-only, piecewise-grid registered, and must not reuse old room labels.'));
  if (value.internalVerification?.primary?.status !== 'passed' || value.internalVerification?.independent?.status !== 'passed' || value.internalVerification?.adversarial?.status !== 'passed'
    || value.internalVerification?.adversarial?.rejectedCases?.length < 7) issues.push(issue('WG_SOURCE_SPACE_INTERNAL_LOOPS_INCOMPLETE', 'Primary, independent, and adversarial product loops must all pass.'));
  if (value.wholeBuildingSpaceRegistryComplete !== false || value.wholeBuildingHeadLayoutReady !== false || value.complianceReady !== false || value.fabricationReady !== false || value.fieldReleaseReady !== false) issues.push(issue('WG_SOURCE_SPACE_FAIL_CLOSED_STATUS_DRIFT', 'Partial source registration cannot claim whole-building, compliance, fabrication, or field-release readiness.'));
  return {
    status: issues.length ? 'blocked' : 'passed',
    issues,
    packet: issues.length ? null : value,
    counts: value.counts || null,
    operationalKnowledgeGrounded: issues.length === 0,
    sprinklerCandidateReady: false,
    wholeBuildingHeadLayoutReady: false,
    complianceReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
  };
}

import { roofElevationAt } from './roof-geometry.js';

const EXACT_STATUSES = new Set(['standards-resolved-section', 'source-resolved-section']);
const BOUNDED_STATUSES = new Set(['source-bounded-dry-minimum-dressed-section']);

const round = (value, places = 6) => Number(Number(value).toFixed(places));

function issue(code, message, refs = []) {
  return { code, severity: 'blocking', message, refs };
}

function sectionDimensionsFt(section) {
  if (!section) return null;
  let widthIn; let depthIn;
  if (section.profile === 'rectangular-hss') {
    widthIn = section.outer_width_in; depthIn = section.outer_depth_in;
  } else if (section.profile === 'wide-flange') {
    widthIn = section.flange_width_in; depthIn = section.depth_in;
  } else if (section.profile === 'built-up-lvl-rectangular') {
    widthIn = section.overall_width_in; depthIn = section.depth_in;
  } else if (section.profile === 'sawn-wood-rectangular') {
    [widthIn, depthIn] = section.modeled_minimum_dressed_in || [];
  }
  if (![widthIn, depthIn].every((value) => Number.isFinite(Number(value)) && Number(value) > 0)) return null;
  return { widthFt: round(Number(widthIn) / 12), depthFt: round(Number(depthIn) / 12) };
}

function projectMember(member, roofModel, sampleStepFt) {
  const a = member.a_ft; const b = member.b_ft;
  if (![a, b].every((point) => Array.isArray(point) && point.length === 2
    && point.every((value) => Number.isFinite(Number(value))))) {
    return { issue: issue('FRAMING_MEMBER_ENDPOINT_INVALID', `Member ${member.id} has invalid plan endpoints.`, [member.id]) };
  }
  const lengthFt = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (!(lengthFt > 0)) return { issue: issue('FRAMING_MEMBER_ZERO_LENGTH', `Member ${member.id} has zero length.`, [member.id]) };
  const divisions = Math.max(1, Math.ceil(lengthFt / sampleStepFt));
  const samples = [];
  for (let index = 0; index <= divisions; index += 1) {
    const t = index / divisions;
    const point = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const roof = roofElevationAt(roofModel, point);
    if (roof.status !== 'passed') {
      const code = roof.issues?.[0]?.code || 'ROOF_POINT_BLOCKED';
      return { issue: issue(code, `Member ${member.id} cannot be continuously projected to a verified roof plane.`, [member.id, `sample:${index}/${divisions}`]) };
    }
    samples.push({ t: round(t), planPointFt: point.map((value) => round(value)), elevationFt: roof.elevationFt, planeId: roof.planeId });
  }
  return { lengthFt: round(lengthFt), samples };
}

/**
 * Account for every registered framing centerline without silently promoting bounded or
 * unresolved sections into physical solids. Exact sections become solids only when the entire
 * centerline continuously lies on verified roof geometry and the hash-bound S-190 condition
 * gate proves it is flush-framed.
 */
export function evaluateSourceBoundRoofFraming(input, opts = {}) {
  const roofModel = input?.roofModel;
  const candidates = input?.candidates;
  const members = [...(candidates?.beams || []), ...(candidates?.joists || [])];
  const rejectedMembers = [];
  const placedMembers = [];
  const boundedMembers = [];
  const gateIssues = [];
  const condition = candidates?.framing_condition_gate;
  const sourceHash = candidates?.source_structural_pdf_sha256;
  if (!roofModel || roofModel.status !== 'passed' || !roofModel.evidenceReceiptSha256) {
    gateIssues.push(issue('ROOF_MODEL_NOT_VERIFIED', 'A receipt-bound passed roof model is required.'));
  }
  if (!condition || condition.passed !== true || condition.condition !== 'flush-framed-unless-noted') {
    gateIssues.push(issue('FRAMING_VERTICAL_CONDITION_UNRESOLVED', 'The structural vertical-condition gate is not passed.'));
  }
  if (!sourceHash || condition?.source_pdf_sha256 !== sourceHash) {
    gateIssues.push(issue('FRAMING_CONDITION_SOURCE_HASH_MISMATCH', 'The framing condition is not bound to the structural source hash.'));
  }
  const memberPages = new Set(members.map((member) => `${member?.source?.page_index}:${member?.source?.sheet}`));
  const conditionPages = new Set((condition?.source_pages || []).map((source) => `${source?.page_index}:${source?.sheet}`));
  if (conditionPages.size !== memberPages.size || [...memberPages].some((value) => !conditionPages.has(value))
    || (condition?.source_pages || []).some((source) => source.pdf_sha256 !== sourceHash)) {
    gateIssues.push(issue('FRAMING_CONDITION_SOURCE_PAGE_MISMATCH', 'The framing condition pages do not match the registered member pages.'));
  }
  if (condition?.governing_text !== 'BEAMS SHOWN ON THIS SHEET OCCUR WITHIN THE ROOF FRAMING SHOWN (FLUSH-FRAMED), UNO.') {
    gateIssues.push(issue('FRAMING_CONDITION_TEXT_MISMATCH', 'The flush-framed governing text is missing or changed.'));
  }
  if (condition?.plan_specific_drop_markers?.length) {
    gateIssues.push(issue('FRAMING_DROP_ASSOCIATION_REQUIRED', 'Plan-specific DROP markers require member-level vertical association.', condition.plan_specific_drop_markers.map((marker) => marker.id)));
  }
  const sampleStepFt = Number.isFinite(Number(opts.sampleStepFt))
    ? Math.max(1 / 384, Math.min(1 / 12, Math.abs(Number(opts.sampleStepFt)))) : 1 / 96;
  for (const member of members) {
    let rejection = null;
    if (gateIssues.length) rejection = gateIssues[0];
    else if (member?.source?.pdf_sha256 !== sourceHash) {
      rejection = issue('FRAMING_MEMBER_SOURCE_HASH_MISMATCH', `Member ${member.id} is not bound to the structural source.`, [member.id]);
    }
    const section = member?.section;
    const dimensions = sectionDimensionsFt(section);
    if (!rejection && (!section || !dimensions)) {
      rejection = issue('FRAMING_SECTION_UNRESOLVED', `Member ${member.id} lacks a usable source-resolved section.`, [member.id]);
    }
    let projection = null;
    if (!rejection) {
      projection = projectMember(member, roofModel, sampleStepFt);
      rejection = projection.issue || null;
    }
    if (rejection) {
      rejectedMembers.push({ id: member?.id || null, member: member?.member || null, kind: member?.kind || null, reason: rejection });
      continue;
    }
    const first = projection.samples[0];
    const last = projection.samples[projection.samples.length - 1];
    const record = {
      id: member.id,
      member: member.member,
      kind: member.kind,
      section,
      dimensionsFt: dimensions,
      lengthFt: projection.lengthFt,
      topEndpointsFt: [
        [...first.planPointFt, first.elevationFt],
        [...last.planPointFt, last.elevationFt],
      ],
      centerlineEndpointsFt: [
        [...first.planPointFt, round(first.elevationFt - dimensions.depthFt / 2)],
        [...last.planPointFt, round(last.elevationFt - dimensions.depthFt / 2)],
      ],
      planeIds: [...new Set(projection.samples.map((sample) => sample.planeId))],
      verticalCondition: 'flush-framed',
      roofEvidenceReceiptSha256: roofModel.evidenceReceiptSha256,
      structuralSourcePdfSha256: sourceHash,
      source: member.source,
    };
    if (EXACT_STATUSES.has(section.status)) placedMembers.push(record);
    else if (BOUNDED_STATUSES.has(section.status)) boundedMembers.push({
      ...record,
      representation: 'non-physical-minimum-dressed-bound',
      promotionBlockedReason: 'PS 20-20 minimum dressed dimensions are not field measurements.',
    });
    else rejectedMembers.push({
      id: member.id, member: member.member, kind: member.kind,
      reason: issue('FRAMING_SECTION_STATUS_NOT_PROMOTABLE', `Member ${member.id} section status is not promotable.`, [member.id, section.status]),
    });
  }
  const accounted = placedMembers.length + boundedMembers.length + rejectedMembers.length;
  const physicalPlacementReady = placedMembers.length > 0 && gateIssues.length === 0;
  return {
    artifactType: 'halofire.source-bound-roof-framing-placement.v1',
    status: physicalPlacementReady ? 'passed' : 'blocked',
    evaluationComplete: accounted === members.length,
    physicalPlacementReady,
    fabricationReady: false,
    codeComplianceReady: false,
    sourceStructuralPdfSha256: sourceHash || null,
    roofEvidenceReceiptSha256: roofModel?.evidenceReceiptSha256 || null,
    counts: {
      candidates: members.length,
      exactPhysicalPlacements: placedMembers.length,
      boundedNonPhysicalRepresentations: boundedMembers.length,
      rejected: rejectedMembers.length,
      accounted,
      skipped: members.length - accounted,
    },
    placedMembers,
    boundedMembers,
    rejectedMembers,
    issues: [
      ...gateIssues,
      ...(physicalPlacementReady ? [] : [issue('NO_EXACT_ROOF_FRAMING_PLACEMENT', 'No exact-section member passed continuous roof projection; no physical framing solid was fabricated.')]),
    ],
  };
}

/**
 * Build a replayable top-down graph from the approved FP2.0 vector evidence.
 *
 * Inputs are already source-gated by approved-fp20-pipe-vectors.js. This
 * module preserves every visible source segment, splits it at sprinklers and
 * pipe contacts, and represents masked fitting gaps as explicit connector
 * edges. It does not assign fabrication sizes, roles, flow, grade, Z, or
 * fittings; those remain separate governed promotion stages.
 */

import { pdfPointToRegisteredPlanFt } from './approved-fp20-pipe-vectors.js';

const round = (value, digits = 6) => Number(value.toFixed(digits));
const point = (x, y) => ({ x, y });
const lerp = (a, b, t) => point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const clamp01 = (value) => Math.max(0, Math.min(1, value));

function projectPoint(target, segment) {
  const a = segment.fromPdfPt;
  const b = segment.toPdfPt;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const denominator = dx * dx + dy * dy;
  const t = denominator === 0 ? 0 : clamp01(((target.x - a.x) * dx + (target.y - a.y) * dy) / denominator);
  const projected = lerp(a, b, t);
  return { t, point: projected, distance: distance(target, projected) };
}

function closestSegmentContact(a, b) {
  const p = a.fromPdfPt;
  const r = point(a.toPdfPt.x - p.x, a.toPdfPt.y - p.y);
  const q = b.fromPdfPt;
  const s = point(b.toPdfPt.x - q.x, b.toPdfPt.y - q.y);
  const cross = (u, v) => u.x * v.y - u.y * v.x;
  const denominator = cross(r, s);
  if (Math.abs(denominator) > 1e-9) {
    const qMinusP = point(q.x - p.x, q.y - p.y);
    const t = cross(qMinusP, s) / denominator;
    const u = cross(qMinusP, r) / denominator;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
      const hit = lerp(p, a.toPdfPt, t);
      return { distance: 0, tA: t, tB: u, pointA: hit, pointB: hit };
    }
  }
  const candidates = [
    (() => { const hit = projectPoint(a.fromPdfPt, b); return { distance: hit.distance, tA: 0, tB: hit.t, pointA: a.fromPdfPt, pointB: hit.point }; })(),
    (() => { const hit = projectPoint(a.toPdfPt, b); return { distance: hit.distance, tA: 1, tB: hit.t, pointA: a.toPdfPt, pointB: hit.point }; })(),
    (() => { const hit = projectPoint(b.fromPdfPt, a); return { distance: hit.distance, tA: hit.t, tB: 0, pointA: hit.point, pointB: b.fromPdfPt }; })(),
    (() => { const hit = projectPoint(b.toPdfPt, a); return { distance: hit.distance, tA: hit.t, tB: 1, pointA: hit.point, pointB: b.toPdfPt }; })(),
  ];
  return candidates.sort((left, right) => left.distance - right.distance || left.tA - right.tA || left.tB - right.tB)[0];
}

function addAnchor(anchorMap, segmentId, t, data = {}) {
  if (!anchorMap.has(segmentId)) anchorMap.set(segmentId, []);
  const anchors = anchorMap.get(segmentId);
  const existing = anchors.find((anchor) => Math.abs(anchor.t - t) <= 0.00001);
  if (existing) {
    existing.headIds.push(...(data.headIds || []));
    existing.contactIds.push(...(data.contactIds || []));
    return existing;
  }
  const created = { t, headIds: [...(data.headIds || [])], contactIds: [...(data.contactIds || [])] };
  anchors.push(created);
  return created;
}

function components(nodes, edges) {
  const adjacency = new Map(nodes.map((node) => [node.id, new Set()]));
  for (const edge of edges) {
    adjacency.get(edge.fromNodeId)?.add(edge.toNodeId);
    adjacency.get(edge.toNodeId)?.add(edge.fromNodeId);
  }
  const unseen = new Set(adjacency.keys());
  const sizes = [];
  while (unseen.size) {
    const start = unseen.values().next().value;
    unseen.delete(start);
    const queue = [start];
    let size = 0;
    while (queue.length) {
      const current = queue.shift();
      size += 1;
      for (const next of adjacency.get(current) || []) if (unseen.delete(next)) queue.push(next);
    }
    sizes.push(size);
  }
  return sizes.sort((a, b) => b - a);
}

export function buildApprovedFp20PlanGraph(evidence) {
  const issues = [];
  const segments = evidence.pipeSegments;
  const segmentById = new Map(segments.map((segment) => [segment.id, segment]));
  const anchors = new Map();
  const contacts = [];
  if (evidence?.topologyClosure?.automaticJoinTolerancePdfPt !== 6) issues.push({ severity: 'blocking', code: 'FP20_PLAN_GRAPH_TOLERANCE_INVALID', message: 'Plan graph splitting requires the gated six-point source-contact tolerance.' });
  if (evidence?.topologyClosure?.explicitMaskedTurnLinks?.length !== 2) issues.push({ severity: 'blocking', code: 'FP20_PLAN_GRAPH_MASKED_TURNS_INVALID', message: 'Plan graph splitting requires the two gated central masked turns.' });
  for (const segment of segments) {
    addAnchor(anchors, segment.id, 0);
    addAnchor(anchors, segment.id, 1);
  }

  for (let i = 0; i < segments.length; i += 1) {
    for (let j = 0; j < i; j += 1) {
      const contact = closestSegmentContact(segments[i], segments[j]);
      if (contact.distance > evidence.topologyClosure.automaticJoinTolerancePdfPt) continue;
      const id = `contact-${String(contacts.length + 1).padStart(3, '0')}`;
      contacts.push({ id, kind: 'source-contact-gap', fromSegmentId: segments[i].id, toSegmentId: segments[j].id, ...contact });
      addAnchor(anchors, segments[i].id, contact.tA, { contactIds: [id] });
      addAnchor(anchors, segments[j].id, contact.tB, { contactIds: [id] });
    }
  }

  for (const link of evidence.topologyClosure.explicitMaskedTurnLinks) {
    const from = segmentById.get(link.fromSegmentId);
    const to = segmentById.get(link.toSegmentId);
    const contact = closestSegmentContact(from, to);
    contacts.push({ id: link.id, kind: 'explicit-masked-turn', fromSegmentId: from.id, toSegmentId: to.id, sourceRef: link.sourceRef, ...contact });
    addAnchor(anchors, from.id, contact.tA, { contactIds: [link.id] });
    addAnchor(anchors, to.id, contact.tB, { contactIds: [link.id] });
  }

  for (const head of evidence.sprinklers) {
    const segment = segmentById.get(head.nearestPipeSegmentId);
    const projection = projectPoint(head.centerPdfPt, segment);
    addAnchor(anchors, segment.id, projection.t, { headIds: [head.id] });
  }

  const nodes = [];
  const anchorNodeId = new Map();
  for (const segment of segments) {
    const sorted = anchors.get(segment.id).sort((a, b) => a.t - b.t);
    for (let index = 0; index < sorted.length; index += 1) {
      const anchor = sorted[index];
      const pdf = lerp(segment.fromPdfPt, segment.toPdfPt, anchor.t);
      const id = `${segment.id}-node-${String(index + 1).padStart(2, '0')}`;
      anchorNodeId.set(`${segment.id}:${round(anchor.t, 5)}`, id);
      nodes.push({
        id,
        kind: anchor.headIds.length ? 'sprinkler-junction' : anchor.contactIds.length ? 'pipe-contact' : 'source-segment-end',
        sourceSegmentId: segment.id,
        sourceParameter: round(anchor.t, 6),
        pdfPt: { x: round(pdf.x, 3), y: round(pdf.y, 3) },
        plan: pdfPointToRegisteredPlanFt(evidence, pdf),
        sprinklerIds: [...new Set(anchor.headIds)].sort(),
        contactIds: [...new Set(anchor.contactIds)].sort(),
        sourceRef: `FP2.0 drawing index ${segment.drawingIndex}`,
      });
    }
  }

  const edges = [];
  for (const segment of segments) {
    const sorted = anchors.get(segment.id).sort((a, b) => a.t - b.t);
    for (let index = 0; index < sorted.length - 1; index += 1) {
      const from = sorted[index];
      const to = sorted[index + 1];
      const fromNodeId = anchorNodeId.get(`${segment.id}:${round(from.t, 5)}`);
      const toNodeId = anchorNodeId.get(`${segment.id}:${round(to.t, 5)}`);
      const lengthPdfPt = distance(segment.fromPdfPt, segment.toPdfPt) * (to.t - from.t);
      if (lengthPdfPt <= 0.01) continue;
      edges.push({
        id: `source-edge-${String(edges.length + 1).padStart(3, '0')}`,
        kind: 'visible-source-pipe',
        fromNodeId,
        toNodeId,
        sourceSegmentId: segment.id,
        strokeClass: segment.strokeClass,
        lengthPdfPt: round(lengthPdfPt, 3),
        planLengthFt: round(lengthPdfPt / evidence.planRegistration.pdfPtPerFt, 6),
        sourceRef: `FP2.0 drawing index ${segment.drawingIndex}`,
      });
    }
  }

  for (const contact of contacts) {
    const fromNodeId = anchorNodeId.get(`${contact.fromSegmentId}:${round(contact.tA, 5)}`);
    const toNodeId = anchorNodeId.get(`${contact.toSegmentId}:${round(contact.tB, 5)}`);
    if (!fromNodeId || !toNodeId || fromNodeId === toNodeId) continue;
    edges.push({
      id: `connector-edge-${contact.id}`,
      kind: contact.kind,
      fromNodeId,
      toNodeId,
      lengthPdfPt: round(contact.distance, 3),
      planLengthFt: round(contact.distance / evidence.planRegistration.pdfPtPerFt, 6),
      sourceSegmentIds: [contact.fromSegmentId, contact.toSegmentId],
      sourceRef: contact.sourceRef || `FP2.0 <=6pt source contact ${contact.id}`,
    });
  }

  const componentSizes = components(nodes, edges);
  return {
    artifactType: 'halofire.approved-fp20-source-plan-graph.v1',
    projectId: evidence.projectId,
    source: evidence.source,
    issues,
    blockerCodes: [...new Set(issues.map((entry) => entry.code))],
    nodes,
    edges,
    metrics: {
      sourceSegmentCount: segments.length,
      sourceContactCount: contacts.filter((contact) => contact.kind === 'source-contact-gap').length,
      explicitMaskedTurnCount: contacts.filter((contact) => contact.kind === 'explicit-masked-turn').length,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      visibleSourceEdgeCount: edges.filter((edge) => edge.kind === 'visible-source-pipe').length,
      connectorEdgeCount: edges.filter((edge) => edge.kind !== 'visible-source-pipe').length,
      sprinklerNodeCount: nodes.filter((node) => node.sprinklerIds.length).length,
      boundSprinklerCount: nodes.reduce((sum, node) => sum + node.sprinklerIds.length, 0),
      connectedComponentCount: componentSizes.length,
      connectedNodeCount: componentSizes[0] || 0,
    },
    sourcePlanGraphReady: issues.length === 0 && componentSizes.length === 1 && nodes.reduce((sum, node) => sum + node.sprinklerIds.length, 0) === evidence.sprinklers.length,
    pipeSizeAssignmentReady: false,
    hydraulicFlowReady: false,
    gradeDirectionReady: false,
    elevationReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
  };
}

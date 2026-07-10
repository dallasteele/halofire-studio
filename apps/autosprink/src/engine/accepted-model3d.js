/**
 * Validate the AutoBid package's accepted vector model before handing it to the
 * Three.js plan builder.
 *
 * This is intentionally stricter than the renderer.  A package can contain a
 * useful massing model while its overlay review is pending; that model must not
 * silently become a reviewed 3D plate.  The returned levels are the exact
 * hash-bound Studio plans from the package, never a synthesized typical floor.
 */

function finitePoint(value) {
  return Array.isArray(value) && value.length === 2
    && value.every((coordinate) => Number.isFinite(Number(coordinate)));
}

function closedPolygon(value) {
  if (!Array.isArray(value) || value.length < 4 || !value.every(finitePoint)) return false;
  const first = value[0];
  const last = value[value.length - 1];
  if (Number(first[0]) !== Number(last[0]) || Number(first[1]) !== Number(last[1])) return false;
  return new Set(value.slice(0, -1).map((point) => `${Number(point[0])},${Number(point[1])}`)).size >= 3;
}

function validWallRuns(value) {
  return Array.isArray(value) && value.length > 0 && value.every((wall) => (
    wall && finitePoint(wall.a) && finitePoint(wall.b)
  ));
}

function validRooms(value) {
  return Array.isArray(value) && value.length > 0 && value.every((room) => (
    room && closedPolygon(room.poly)
  ));
}

function reject(reason) {
  return { levels: null, reason };
}

/**
 * PURE. Return accepted per-floor plans or an explicit rejection.
 *
 * Required evidence is deliberately redundant with the Python adapter:
 * geometry_grounded, grounding.passed/source, exact level set, closed footprint,
 * walls, rooms, overlay artifact, and physical-page acceptance evidence.  This
 * keeps a stale/partial package from entering the real 3D scene through a UI
 * route that otherwise has a legitimate massing fallback.
 */
export function acceptedModel3dToLevels(payload) {
  if (!payload || typeof payload !== 'object') return reject('package_payload_missing');
  const model = payload.model3d;
  if (!model || model.geometry_grounded !== true) return reject('accepted_model3d_not_grounded');
  const grounding = model.grounding;
  if (!grounding || grounding.passed !== true || grounding.source !== 'accepted-vector-overlay') {
    return reject('accepted_model3d_grounding_evidence_missing');
  }
  const studio = model.studio;
  const rawLevels = studio && Array.isArray(studio.levelPlans) ? studio.levelPlans : null;
  if (!rawLevels || rawLevels.length === 0) return reject('accepted_model3d_levels_missing');

  const levels = [];
  const seen = new Set();
  for (const levelEntry of rawLevels) {
    const level = Number(levelEntry && levelEntry.level);
    const plan = levelEntry && levelEntry.plan;
    if (!Number.isInteger(level) || level < 1 || seen.has(level)) return reject('accepted_model3d_level_mapping_invalid');
    seen.add(level);
    if (!Number.isFinite(Number(levelEntry.elevationFt))) return reject(`accepted_model3d_elevation_missing:${level}`);
    if (!plan || plan.geometryGrounded !== true) return reject(`accepted_model3d_plan_not_grounded:${level}`);
    if (!closedPolygon(plan.footprintFt)) return reject(`accepted_model3d_footprint_invalid:${level}`);
    if (!(Number(plan.scaleFtPerUnit) > 0)) return reject(`accepted_model3d_scale_missing:${level}`);
    if (!validWallRuns(plan.wallRuns)) return reject(`accepted_model3d_walls_missing:${level}`);
    if (!validRooms(plan.roomBoundaries)) return reject(`accepted_model3d_rooms_missing:${level}`);
    if (typeof plan.vectorOverlayArtifact !== 'string' || plan.vectorOverlayArtifact.trim() === '') {
      return reject(`accepted_model3d_overlay_missing:${level}`);
    }
    const evidence = plan.acceptanceEvidence;
    if (!evidence || !Number.isInteger(Number(evidence.pageIndex)) || Number(evidence.pageIndex) < 0
      || Number(evidence.physicalPageNumber) !== Number(evidence.pageIndex) + 1
      || typeof evidence.artifactId !== 'string' || evidence.artifactId.trim() === '') {
      return reject(`accepted_model3d_page_evidence_missing:${level}`);
    }
    levels.push({
      level,
      name: levelEntry.name,
      elevationFt: Number(levelEntry.elevationFt),
      elevationSource: levelEntry.elevationSource,
      plan,
    });
  }
  const expected = Array.isArray(grounding.levels) ? grounding.levels.map(Number).sort((a, b) => a - b) : [];
  const actual = [...seen].sort((a, b) => a - b);
  if (expected.length !== actual.length || expected.some((level, index) => level !== actual[index])) {
    return reject('accepted_model3d_grounding_level_set_mismatch');
  }
  levels.sort((a, b) => a.level - b.level);
  return {
    levels,
    source: 'accepted-vector-overlay',
    sourceDocumentId: payload.meta && payload.meta.document_id != null
      ? Number(payload.meta.document_id) : null,
  };
}

export default acceptedModel3dToLevels;

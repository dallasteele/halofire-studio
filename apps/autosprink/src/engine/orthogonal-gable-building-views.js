const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
const pointsAttr = (points) => points.map((point) => point.map((value) => Number(value).toFixed(2)).join(',')).join(' ');
const avg = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

function isoProjector(model, width, height) {
  const floor = model.floorElevationFt; const all = [];
  for (const surface of model.surfaces) for (const [x, y, z] of surface.vertices) all.push([x, y, z]);
  for (const [x, y] of model.footprintPlanFt) { all.push([x, y, floor]); all.push([x, y, model.wallTopElevationFt]); }
  for (const feature of (model.features || [])) {
    for (const [x, y] of feature.footprintPlanFt) { all.push([x, y, feature.baseElevationFt]); all.push([x, y, feature.beamElevationFt]); }
    const center = [avg(feature.footprintPlanFt.map((point) => point[0])), avg(feature.footprintPlanFt.map((point) => point[1]))];
    all.push([center[0], center[1], feature.topElevationFt]);
  }
  const raw = ([x, y, z]) => [(x - y) * 0.8660254, (x + y) * 0.5 - (z - floor) * 1.55];
  const projected = all.map(raw); const xs = projected.map((point) => point[0]); const ys = projected.map((point) => point[1]);
  const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const scale = Math.min((width - 100) / Math.max(1, maxX - minX), (height - 130) / Math.max(1, maxY - minY));
  return (point) => { const [x, y] = raw(point); return [50 + (x - minX) * scale, 70 + (y - minY) * scale]; };
}

export function renderOrthogonalGableBuildingViews(model) {
  if (!model || model.status !== 'passed' || !Array.isArray(model.surfaces) || !Array.isArray(model.footprintPlanFt)) {
    return { status: 'blocked', issues: [{ code: 'BUILDING_VIEW_MODEL_INVALID' }] };
  }
  const width = 1500; const height = 920; const project = isoProjector(model, width, height); const floor = model.floorElevationFt;
  const wallFaces = model.footprintPlanFt.map((point, index) => {
    const next = model.footprintPlanFt[(index + 1) % model.footprintPlanFt.length];
    const vertices = [[...point, floor], [...next, floor], [...next, model.wallTopElevationFt], [...point, model.wallTopElevationFt]];
    return { vertices, depth: avg(vertices.map(([x, y]) => x + y)), fill: index % 2 ? '#dbeafe' : '#bfdbfe' };
  }).sort((a, b) => a.depth - b.depth);
  const rooms = (model.rooms || []).map((room, index) => ({
    points: room.poly.map(([x, y]) => project([x, y, floor + 0.08])),
    fill: index % 2 ? '#99f6e4' : '#a5f3fc', label: room.label || room.kind || '',
  }));
  const roofFaces = model.surfaces.map((entry) => ({
    ...entry, points: entry.vertices.map(project), depth: avg(entry.vertices.map(([x, y, z]) => x + y + z * 0.4)),
    fill: entry.kind === 'pitched-roof' ? '#f59e0b' : (entry.kind === 'cross-gable-roof' ? '#fb7185' : '#64748b'),
  })).sort((a, b) => a.depth - b.depth);
  const featureFaces = (model.features || []).flatMap((feature) => {
    const center = [avg(feature.footprintPlanFt.map((point) => point[0])), avg(feature.footprintPlanFt.map((point) => point[1]))];
    const faces = feature.footprintPlanFt.map((point, index) => {
      const next = feature.footprintPlanFt[(index + 1) % feature.footprintPlanFt.length];
      return { kind: `${feature.kind}-wall`, points: [[...point, feature.baseElevationFt], [...next, feature.baseElevationFt], [...next, feature.beamElevationFt], [...point, feature.beamElevationFt]].map(project), fill: '#cbd5e1' };
    });
    return faces.concat(feature.footprintPlanFt.map((point, index) => {
      const next = feature.footprintPlanFt[(index + 1) % feature.footprintPlanFt.length];
      return { kind: `${feature.kind}-spire`, points: [[...point, feature.beamElevationFt], [...next, feature.beamElevationFt], [center[0], center[1], feature.topElevationFt]].map(project), fill: '#e2e8f0' };
    }));
  });
  const isoSvg = `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Source-grounded Winter Garden floor and pitched roof model"><rect width="100%" height="100%" fill="#07111f"/><text x="38" y="42" fill="#f8fafc" font-family="sans-serif" font-weight="700" font-size="27">PDF TO 3D · SOURCE FLOOR + PITCHED ROOF</text>${rooms.map((room) => `<polygon points="${pointsAttr(room.points)}" fill="${room.fill}" opacity=".54" stroke="#0f766e" stroke-width=".7"/>`).join('')}${wallFaces.map((face) => `<polygon points="${pointsAttr(face.vertices.map(project))}" fill="${face.fill}" opacity=".76" stroke="#60a5fa" stroke-width="1.3"/>`).join('')}${roofFaces.map((face) => `<polygon data-kind="${esc(face.kind)}" points="${pointsAttr(face.points)}" fill="${face.fill}" opacity=".88" stroke="#fff7ed" stroke-width="2"><title>${esc(face.id)}</title></polygon>`).join('')}${featureFaces.map((face) => `<polygon data-kind="${esc(face.kind)}" points="${pointsAttr(face.points)}" fill="${face.fill}" opacity=".96" stroke="#475569" stroke-width="2"/>`).join('')}<text x="38" y="885" fill="#a7f3d0" font-family="monospace" font-size="18">${model.rooms.length} traced rooms · ${model.walls.length} exterior edges · ${model.surfaces.length} pitched surfaces · ${(model.features || []).length} vertical feature · ${model.mainRoof.pitchRiseIn}:${model.mainRoof.pitchRunIn}</text></svg>`;

  const xs = model.footprintPlanFt.map((point) => point[0]); const ys = model.footprintPlanFt.map((point) => point[1]);
  const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const topMap = ([x, y]) => [50 + (x - minX) / (maxX - minX) * (width - 100), 70 + (maxY - y) / (maxY - minY) * (height - 130)];
  const topSvg = `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Source-grounded Winter Garden top view"><rect width="100%" height="100%" fill="#07111f"/><text x="38" y="42" fill="#f8fafc" font-family="sans-serif" font-weight="700" font-size="27">SOURCE PLAN REGISTRATION · TOP VIEW</text><polygon points="${pointsAttr(model.footprintPlanFt.map(topMap))}" fill="#0f172a" stroke="#a855f7" stroke-width="5"/>${rooms.map((room, index) => `<polygon points="${pointsAttr(model.rooms[index].poly.map(topMap))}" fill="${room.fill}" opacity=".48" stroke="#22d3ee" stroke-width="1"/>`).join('')}${model.surfaces.map((surface) => `<polygon points="${pointsAttr(surface.vertices.map(([x, y]) => topMap([x, y])))}" fill="none" stroke="${surface.kind === 'pitched-roof' ? '#f59e0b' : (surface.kind === 'cross-gable-roof' ? '#fb7185' : '#64748b')}" stroke-width="4"><title>${esc(surface.id)}</title></polygon>`).join('')}${(model.features || []).map((feature) => `<polygon points="${pointsAttr(feature.footprintPlanFt.map(topMap))}" fill="#e2e8f0" stroke="#475569" stroke-width="4"><title>${esc(feature.id)}</title></polygon>`).join('')}<text x="38" y="885" fill="#fbbf24" font-family="monospace" font-size="18">dimensions, rooms, ridges and valleys are source-derived · no completed sprinkler answer key</text></svg>`;
  return { status: 'passed', isometricSvg: isoSvg, topSvg, complianceReady: false, claimStatus: model.claimStatus };
}

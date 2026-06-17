function round(n) {
  return Math.round((Number(n) + Number.EPSILON) * 1e4) / 1e4;
}

function bboxFromPoly(poly) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pt of Array.isArray(poly) ? poly : []) {
    minX = Math.min(minX, Number(pt[0]));
    minY = Math.min(minY, Number(pt[1]));
    maxX = Math.max(maxX, Number(pt[0]));
    maxY = Math.max(maxY, Number(pt[1]));
  }
  if (!Number.isFinite(minX)) return null;
  return { minX: round(minX), minY: round(minY), maxX: round(maxX), maxY: round(maxY) };
}

function areaFromBbox(bbox) {
  if (!bbox) return 0;
  return round(Math.max(0, bbox.maxX - bbox.minX) * Math.max(0, bbox.maxY - bbox.minY));
}

export function classifyPlanZones(plan, opts = {}) {
  const rooms = Array.isArray(plan && plan.rooms) ? plan.rooms : [];
  const zones = [];
  const kindCounts = {};
  const minZoneAreaSqft = Number.isFinite(opts.minZoneAreaSqft) ? Number(opts.minZoneAreaSqft) : 8;

  for (let index = 0; index < rooms.length; index += 1) {
    const room = rooms[index];
    const polygon = Array.isArray(room && room.poly) ? room.poly : null;
    if (!polygon || polygon.length < 3) continue;
    const bbox = bboxFromPoly(polygon);
    const areaSqft = Number.isFinite(Number(room.areaSqft)) ? Number(room.areaSqft) : areaFromBbox(bbox);
    if (areaSqft < minZoneAreaSqft) continue;
    const kind = String(room.kind || 'unknown').toLowerCase();
    kindCounts[kind] = (kindCounts[kind] || 0) + 1;
    zones.push({
      id: `zone-${index + 1}`,
      kind,
      label: room.label || null,
      polygon: polygon.map(([x, y]) => [round(x), round(y)]),
      bbox,
      areaSqft: round(areaSqft),
      roomIndexes: [index],
      confidence: room.confidence || 'low',
      source: 'room-segmentation',
      needsVerification: true,
    });
  }

  return {
    zones,
    counts: kindCounts,
    note:
      'Zones are derived from the segmented plan rooms and keep the room classifier kinds ' +
      '(parking/lobby/unit/corridor/stair/mech/restroom/storage/unknown). Best-effort and ' +
      'needs-verification.',
  };
}

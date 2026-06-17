function round(n) {
  return Math.round((Number(n) + Number.EPSILON) * 1e4) / 1e4;
}

function polyBbox(poly = []) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pt of poly) {
    if (!Array.isArray(pt) || pt.length < 2) continue;
    minX = Math.min(minX, Number(pt[0]));
    minY = Math.min(minY, Number(pt[1]));
    maxX = Math.max(maxX, Number(pt[0]));
    maxY = Math.max(maxY, Number(pt[1]));
  }
  if (!Number.isFinite(minX)) return null;
  return { minX: round(minX), minY: round(minY), maxX: round(maxX), maxY: round(maxY) };
}

export function buildZoneClassifierInput(input = {}) {
  const rooms = Array.isArray(input.rooms) ? input.rooms : [];
  const zones = rooms.map((room, index) => ({
    id: `zone-${index + 1}`,
    kind: room.kind || 'unknown',
    confidence: room.confidence || 'low',
    label: room.label || null,
    poly: Array.isArray(room.poly) ? room.poly : [],
    bbox: polyBbox(room.poly),
    areaSqft: Number.isFinite(room.areaSqft) ? room.areaSqft : null,
    source: 'room-segmentation',
  }));
  return {
    zones,
    occupancyHint: input.occupancyHint || null,
    labels: Array.isArray(input.labels) ? input.labels : [],
    summary: {
      roomCount: rooms.length,
      parkingZones: zones.filter((zone) => zone.kind === 'parking').length,
      nonParkingZones: zones.filter((zone) => zone.kind !== 'parking').length,
    },
  };
}

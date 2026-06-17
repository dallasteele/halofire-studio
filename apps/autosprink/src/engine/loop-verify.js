function isPoint(pt) {
  return Array.isArray(pt) && pt.length >= 2 && Number.isFinite(Number(pt[0])) && Number.isFinite(Number(pt[1]));
}

function pointDistance(a, b) {
  return Math.hypot(Number(a[0]) - Number(b[0]), Number(a[1]) - Number(b[1]));
}

function wallEndpointGap(wall, walls, tolFt) {
  const pts = [wall.a, wall.b];
  return pts.every((pt) => walls.every((other) => {
    if (other === wall) return true;
    return pointDistance(pt, other.a) > tolFt && pointDistance(pt, other.b) > tolFt;
  }));
}

export function verifyPass(model, passName) {
  const diagnostics = [];
  const shellOutline = model?.shell?.outline;
  if (!Array.isArray(shellOutline) || shellOutline.length < 4) {
    diagnostics.push('shell outline missing or too small');
  }
  if (passName === 'pass3-walls') {
    const walls = Array.isArray(model?.walls) ? model.walls : [];
    if (walls.length === 0) diagnostics.push('no walls generated');
    const invalidWalls = walls.filter((wall) => !isPoint(wall.a) || !isPoint(wall.b));
    if (invalidWalls.length > 0) diagnostics.push(`invalid walls: ${invalidWalls.length}`);
    const orphanWalls = walls.filter((wall) => wallEndpointGap(wall, walls, 3));
    if (orphanWalls.length > 0) diagnostics.push(`orphan walls: ${orphanWalls.length}`);
  }
  if (passName === 'pass5-doors' && !Array.isArray(model?.doors)) {
    diagnostics.push('doors collection missing');
  }
  if (passName === 'pass7-rooms' && !Array.isArray(model?.rooms)) {
    diagnostics.push('rooms collection missing');
  }
  return { ok: diagnostics.length === 0, diagnostics };
}

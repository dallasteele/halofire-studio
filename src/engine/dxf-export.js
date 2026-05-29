/**
 * DXF (AutoCAD R12 ASCII) exporter for the HaloFire CAD model.
 *
 * Emits a layered 3D wireframe drawing that opens directly in AutoCAD (and any
 * DXF reader): building shell, sized piping centerlines (riser/main/branch/
 * drops), sprinkler-head symbols, and pipe-size text — the standard content of
 * a fire-sprinkler shop drawing. This is a real, parity-relevant CAD artifact;
 * it is NOT a hydraulically-calculated or AHJ-stamped sheet.
 *
 * R12 is intentionally minimal and dependency-free: just enough TABLES + LINE/
 * CIRCLE/TEXT entities, which every CAD package accepts.
 */

// AutoCAD Color Index per layer.
const LAYERS = {
  WALLS: 7, FLOOR: 8, ROOF: 9, MAIN: 1, BRANCH: 5, DROPS: 4, RISER: 2, HEADS: 3, LABELS: 7,
};

function pair(code, value) {
  return `${code}\n${value}\n`;
}

function line(layer, [x1, y1, z1], [x2, y2, z2]) {
  return pair(0, 'LINE') + pair(8, layer)
    + pair(10, x1) + pair(20, y1) + pair(30, z1 ?? 0)
    + pair(11, x2) + pair(21, y2) + pair(31, z2 ?? 0);
}

function circle(layer, [cx, cy, cz], r) {
  return pair(0, 'CIRCLE') + pair(8, layer)
    + pair(10, cx) + pair(20, cy) + pair(30, cz ?? 0) + pair(40, r);
}

function text(layer, [x, y, z], height, value) {
  return pair(0, 'TEXT') + pair(8, layer)
    + pair(10, x) + pair(20, y) + pair(30, z ?? 0) + pair(40, height) + pair(1, value);
}

/**
 * @param {object} cadModel  output of buildCadModel
 * @returns {string} DXF R12 text
 */
export function toDxf(cadModel) {
  if (!cadModel || !Array.isArray(cadModel.solids)) {
    throw new Error('toDxf requires a CAD model with a solids array');
  }
  let entities = '';

  for (const s of cadModel.solids) {
    if (s.kind === 'slab') {
      const layer = s.layer;
      for (let i = 0; i < s.polygon.length; i += 1) {
        const a = s.polygon[i];
        const b = s.polygon[(i + 1) % s.polygon.length];
        entities += line(layer, [a[0], a[1], s.z], [b[0], b[1], s.z]);
      }
    } else if (s.kind === 'wall') {
      const h = s.heightFt;
      // plan base, top, and two vertical posts -> 3D wall wireframe
      entities += line('WALLS', [s.a[0], s.a[1], 0], [s.b[0], s.b[1], 0]);
      entities += line('WALLS', [s.a[0], s.a[1], h], [s.b[0], s.b[1], h]);
      entities += line('WALLS', [s.a[0], s.a[1], 0], [s.a[0], s.a[1], h]);
      entities += line('WALLS', [s.b[0], s.b[1], 0], [s.b[0], s.b[1], h]);
    } else if (s.kind === 'pipe') {
      entities += line(s.layer, s.from, s.to);
      // Label branch + main pipe sizes at their midpoint (shop-drawing convention).
      if (s.role === 'branch' || s.role === 'main') {
        const mid = [(s.from[0] + s.to[0]) / 2, (s.from[1] + s.to[1]) / 2, s.from[2]];
        entities += text('LABELS', mid, 0.75, `${s.diameterIn}"`);
      }
    } else if (s.kind === 'head') {
      entities += circle('HEADS', s.position, 0.5);
      // small cross marker
      const [x, y, z] = s.position;
      entities += line('HEADS', [x - 0.5, y, z], [x + 0.5, y, z]);
      entities += line('HEADS', [x, y - 0.5, z], [x, y + 0.5, z]);
    }
  }

  let layerTable = pair(0, 'TABLE') + pair(2, 'LAYER') + pair(70, Object.keys(LAYERS).length);
  for (const [name, color] of Object.entries(LAYERS)) {
    layerTable += pair(0, 'LAYER') + pair(2, name) + pair(70, 0) + pair(62, color) + pair(6, 'CONTINUOUS');
  }
  layerTable += pair(0, 'ENDTAB');

  return pair(0, 'SECTION') + pair(2, 'HEADER')
      + pair(9, '$ACADVER') + pair(1, 'AC1009')
      + pair(0, 'ENDSEC')
    + pair(0, 'SECTION') + pair(2, 'TABLES') + layerTable + pair(0, 'ENDSEC')
    + pair(0, 'SECTION') + pair(2, 'ENTITIES') + entities + pair(0, 'ENDSEC')
    + pair(0, 'EOF');
}

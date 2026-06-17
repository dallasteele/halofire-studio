import { extractArcsFromOpList, detectDoors } from './plan-doors.js';

export function detectDoorsFromOpList(opList, walls = [], opts = {}) {
  const scale = Number.isFinite(opts.scaleFtPerUnit) ? Number(opts.scaleFtPerUnit) : Number(opts.scale) || 1;
  const { arcs } = extractArcsFromOpList(opList, { scale });
  return detectDoors(arcs, walls, opts);
}

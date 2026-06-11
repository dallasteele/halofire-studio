export interface Pt {
    x: number;
    y: number;
}

export interface GridLine {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    dir: 'x' | 'y';
}

export interface CeilingGrid {
    lines: GridLine[];
    cellW: number;
    cellH: number;
    originX: number;
    originY: number;
}

export function ceilingGridForBounds(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    opts?: {
        cellW?: number;
        cellH?: number;
        originX?: number;
        originY?: number;
    }
): CeilingGrid {
    const cellW = opts?.cellW ?? 4;
    const cellH = opts?.cellH ?? 2;
    const originX = opts?.originX ?? minX;
    const originY = opts?.originY ?? minY;

    if (!Number.isFinite(minX) || !Number.isFinite(minY) ||
        !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
        throw new Error('Non-finite bounds');
    }
    if (maxX <= minX || maxY <= minY) {
        throw new Error('Degenerate bounds');
    }
    if (cellW <= 0 || cellH <= 0) {
        throw new Error('Non-positive cell dimensions');
    }

    const vLines: GridLine[] = [];
    let x = originX + cellW;
    while (x < maxX) {
        if (x > minX) {
            vLines.push({
                x1: x,
                y1: minY,
                x2: x,
                y2: maxY,
                dir: 'y'
            });
        }
        x += cellW;
    }

    const hLines: GridLine[] = [];
    let y = originY + cellH;
    while (y < maxY) {
        if (y > minY) {
            hLines.push({
                x1: minX,
                y1: y,
                x2: maxX,
                y2: y,
                dir: 'x'
            });
        }
        y += cellH;
    }

    return {
        lines: [...vLines, ...hLines],
        cellW,
        cellH,
        originX,
        originY
    };
}

export function polygonBounds(poly: Pt[]): { minX: number; minY: number; maxX: number; maxY: number } {
    if (poly.length < 3) throw new Error('Polygon must have at least 3 points');
    let minX = poly[0].x;
    let minY = poly[0].y;
    let maxX = poly[0].x;
    let maxY = poly[0].y;

    for (const p of poly) {
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
            throw new Error('Non-finite point in polygon');
        }
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
    }

    return { minX, minY, maxX, maxY };
}

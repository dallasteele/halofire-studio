import { makeLine, makePolyline, makeArc, makeCircle, makeRectangle, makePoint, elementLengthFt, elementAreaFt2 } from '../src/lib/drawing-elements';
import { Pt } from '../src/lib/drawing-elements';

const pt = (x: number, y: number): Pt => ({ x, y });

describe('DrawingElement constructors', () => {
  it('makeLine validates distinct endpoints', () => {
    expect(() => makeLine('1', pt(0,0), pt(0,0))).toThrow('Line segment must have distinct endpoints');
  });

  it('makePolyline requires at least 2 points', () => {
    expect(() => makePolyline('2', [pt(0,0)])).toThrow('Polyline must have at least 2 points');
  });

  it('makeArc validates radius', () => {
    expect(() => makeArc('3', pt(0,0), 0, 0, 90)).toThrow('Radius must be a positive finite number');
  });

  it('makeRectangle validates dimensions', () => {
    expect(() => makeRectangle('4', pt(0,0), 0, 10)).toThrow('Dimensions must be positive finite numbers');
  });

  it('makePoint validates point', () => {
    expect(() => makePoint('5', pt(NaN, 0))).toThrow('Point coordinates must be finite numbers');
  });
});

describe('elementLengthFt', () => {
  it('line: 3-4-5 triangle', () => {
    const line = makeLine('6', pt(0,0), pt(3,4));
    expect(elementLengthFt(line)).toBe(5);
  });

  it('polyline: sum of segments', () => {
    const polyline = makePolyline('7', [pt(0,0), pt(3,0), pt(3,4)]);
    expect(elementLengthFt(polyline)).toBe(3 + 4);
  });

  it('arc: quarter circle (r=10, 0-90)', () => {
    const arc = makeArc('8', pt(0,0), 10, 0, 90);
    expect(elementLengthFt(arc)).toBeCloseTo(2 * Math.PI * 10 * 0.25);
  });

  it('circle: circumference', () => {
    const circle = makeCircle('9', pt(0,0), 10);
    expect(elementLengthFt(circle)).toBeCloseTo(2 * Math.PI * 10);
  });

  it('rectangle: perimeter', () => {
    const rect = makeRectangle('10', pt(0,0), 10, 5);
    expect(elementLengthFt(rect)).toBe(2 * (10 + 5));
  });

  it('point: 0', () => {
    const point = makePoint('11', pt(0,0));
    expect(elementLengthFt(point)).toBe(0);
  });
});

describe('elementAreaFt2', () => {
  it('circle: area', () => {
    const circle = makeCircle('12', pt(0,0), 10);
    expect(elementAreaFt2(circle)).toBeCloseTo(Math.PI * 10 * 10);
  });

  it('rectangle: area', () => {
    const rect = makeRectangle('13', pt(0,0), 10, 5);
    expect(elementAreaFt2(rect)).toBe(10 * 5);
  });

  it('closed polyline: shoelace', () => {
    const points = [pt(0,0), pt(10,0), pt(10,10), pt(0,10), pt(0,0)];
    const polyline = makePolyline('14', points);
    expect(elementAreaFt2(polyline)).toBeCloseTo(100);
  });

  it('open polyline: 0', () => {
    const points = [pt(0,0), pt(10,0), pt(10,10)];
    const polyline = makePolyline('15', points);
    expect(elementAreaFt2(polyline)).toBe(0);
  });
});

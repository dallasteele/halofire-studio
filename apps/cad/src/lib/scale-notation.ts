/**
 * Printed architectural scale notation parser (PDF-first import lane).
 *
 * Recognizes the scale callouts commonly printed on plan sheets and
 * converts them to feet-per-inch of paper, plus a helper that converts
 * to feet-per-PDF-point (PDF user space is 72 points per inch).
 *
 * Supported forms (case and whitespace tolerant):
 *   (a) fractional-inch = feet-inches, e.g.  1/8" = 1'-0"   3/32"=1'-0"   1/4 in = 1 ft
 *   (b) whole/decimal inch = feet (civil),  e.g.  1" = 40'
 *   (c) ratio,                              e.g.  1:96  ->  96 inches per inch = 8 ft/in
 *
 * Quote handling: both ASCII (" ') and typographic (” ’) marks
 * are accepted; unicode escapes are used here to keep the source free of
 * raw quote characters inside regexes.
 */

export interface ParsedScale {
    /** Real-world feet represented by one inch of paper. */
    ftPerInch: number;
    /** The matched substring, verbatim from the input text. */
    notation: string;
}

// Inch unit: " or unicode double-quote or "in"/"inch"/"inches" (optional dot).
const INCH_UNIT = '(?:\\u0022|\\u201D|in(?:ch(?:es)?)?\\.?)';
// Foot unit: ' or unicode apostrophe or "ft"/"foot"/"feet" (optional dot).
const FOOT_UNIT = '(?:\\u0027|\\u2019|ft\\.?|foot|feet)';
// A number: integer or decimal, optionally a fraction like 3/32.
const NUM = '\\d+(?:\\.\\d+)?';
const FRACTION_OR_NUM = `(${NUM})(?:\\s*\\/\\s*(${NUM}))?`;

// Form (a)+(b): <inches>[/<den>] <inch-unit> = <feet> <foot-unit> [- <inches> <inch-unit>]
const INCH_EQ_FEET_RE = new RegExp(
    `${FRACTION_OR_NUM}\\s*${INCH_UNIT}\\s*=\\s*(${NUM})\\s*${FOOT_UNIT}` +
    `(?:\\s*-\\s*(${NUM})\\s*${INCH_UNIT})?`,
    'i'
);

// Form (c): ratio like 1:96
const RATIO_RE = new RegExp(`(${NUM})\\s*:\\s*(${NUM})`);

interface Candidate {
    index: number;
    scale: ParsedScale;
}

function tryInchEqFeet(text: string): Candidate | null {
    const m = INCH_EQ_FEET_RE.exec(text);
    if (!m) return null;
    const numerator = parseFloat(m[1]);
    const denominator = m[2] !== undefined ? parseFloat(m[2]) : 1;
    const feet = parseFloat(m[3]);
    const extraInches = m[4] !== undefined ? parseFloat(m[4]) : 0;
    if (denominator === 0) return null;
    const paperInches = numerator / denominator;
    if (!Number.isFinite(paperInches) || paperInches <= 0) return null;
    const worldFeet = feet + extraInches / 12;
    const ftPerInch = worldFeet / paperInches;
    if (!Number.isFinite(ftPerInch) || ftPerInch <= 0) return null;
    return { index: m.index, scale: { ftPerInch, notation: m[0] } };
}

function tryRatio(text: string): Candidate | null {
    const m = RATIO_RE.exec(text);
    if (!m) return null;
    const paper = parseFloat(m[1]);
    const world = parseFloat(m[2]);
    if (paper === 0) return null;
    // world units per paper unit, in inches -> divide by 12 for feet per inch.
    const ftPerInch = world / paper / 12;
    if (!Number.isFinite(ftPerInch) || ftPerInch <= 0) return null;
    return { index: m.index, scale: { ftPerInch, notation: m[0] } };
}

/**
 * Parse the first scale notation found in `text`.
 * Returns null when no supported notation is present; never throws.
 * When multiple notations appear, the one earliest in the text wins.
 */
export function parseScaleNotation(text: string): ParsedScale | null {
    if (typeof text !== 'string' || text.length === 0) return null;

    const candidates: Candidate[] = [];
    const a = tryInchEqFeet(text);
    if (a) candidates.push(a);
    const c = tryRatio(text);
    if (c) candidates.push(c);

    if (candidates.length === 0) return null;
    candidates.sort((p, q) => p.index - q.index);
    return candidates[0].scale;
}

/**
 * Convert feet-per-paper-inch to feet-per-PDF-user-unit.
 * PDF user space is 72 points per inch, so ftPerUnit = ftPerInch / 72.
 * Throws on non-finite or non-positive input.
 */
export function ftPerUnitFromPdfPoints(ftPerInch: number): number {
    if (!Number.isFinite(ftPerInch) || ftPerInch <= 0) {
        throw new Error(`ftPerInch must be finite and positive, got ${ftPerInch}`);
    }
    return ftPerInch / 72;
}

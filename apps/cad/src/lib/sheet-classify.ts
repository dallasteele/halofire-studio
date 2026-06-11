/**
 * Plan-set sheet triage by extracted title text (PDF-first import lane).
 *
 * Classifies a page of extracted plan-set text into a SheetKind using
 * simple keyword signals, and extracts a floor number and sheet number
 * when present. Pure module: no I/O, no React.
 */

export type SheetKind =
    | 'floor-plan'
    | 'fire-protection'
    | 'detail'
    | 'schedule'
    | 'title'
    | 'other';

export interface SheetInfo {
    kind: SheetKind;
    score: number;
    floor: number | null;
    sheetNo: string | null;
}

// Signals in precedence order: when multiple match, the first listed wins.
const SIGNALS: ReadonlyArray<{ kind: SheetKind; score: number; re: RegExp }> = [
    { kind: 'fire-protection', score: 0.9, re: /\b(FP-?\d|FIRE (PROTECTION|SPRINKLER)|SPRINKLER PLAN)\b/i },
    { kind: 'floor-plan', score: 0.8, re: /\b(FLOOR PLAN|A-?1\d{2}|LEVEL \d+ PLAN)\b/i },
    { kind: 'schedule', score: 0.7, re: /\bSCHEDULE\b/i },
    { kind: 'detail', score: 0.6, re: /\b(DETAILS?|SECTIONS?)\b/i },
    { kind: 'title', score: 0.8, re: /\b(COVER|TITLE SHEET|SHEET INDEX|DRAWING INDEX)\b/i }
];

const DIGIT_FLOOR_RE = /\b(\d+)(?:ST|ND|RD|TH)? FLOOR\b/i;
const LEVEL_RE = /\bLEVEL (\d+)\b/i;
// Titles often spell ordinals out ("SECOND FLOOR PLAN"), so map word
// ordinals one through ten as well.
const WORD_FLOOR_RE =
    /\b(FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|SEVENTH|EIGHTH|NINTH|TENTH) FLOOR\b/i;
const ORDINAL_WORDS: Record<string, number> = {
    FIRST: 1, SECOND: 2, THIRD: 3, FOURTH: 4, FIFTH: 5,
    SIXTH: 6, SEVENTH: 7, EIGHTH: 8, NINTH: 9, TENTH: 10
};

// Sheet-number token: 1-2 letters, optional dash, 1-3 digits, optional
// decimal suffix (e.g. A-102, FP1, M-2.1).
const SHEET_TOKEN_RE = /\b([A-Z]{1,2}-?\d{1,3}(?:\.\d{1,2})?)\b/;
const SHEET_LINE_HINT_RE = /sheet|dwg|no\.?/i;

function parseFloor(text: string): number | null {
    const digit = DIGIT_FLOOR_RE.exec(text);
    if (digit) return parseInt(digit[1], 10);
    const word = WORD_FLOOR_RE.exec(text);
    if (word) return ORDINAL_WORDS[word[1].toUpperCase()];
    const level = LEVEL_RE.exec(text);
    if (level) return parseInt(level[1], 10);
    return null;
}

/**
 * Sheet-number heuristic (deliberately simple):
 *   1. First sheet-number token on a line that also mentions sheet/dwg/no.
 *   2. Otherwise, first sheet-number token within 40 characters of the
 *      word SHEET anywhere in the text.
 *   3. Otherwise null.
 */
function parseSheetNo(text: string): string | null {
    for (const line of text.split(/\r?\n/)) {
        if (!SHEET_LINE_HINT_RE.test(line)) continue;
        const m = SHEET_TOKEN_RE.exec(line);
        if (m) return m[1];
    }
    const sheetIdx = text.toUpperCase().indexOf('SHEET');
    if (sheetIdx >= 0) {
        const windowStart = Math.max(0, sheetIdx - 40);
        const windowText = text.slice(windowStart, sheetIdx + 45);
        const m = SHEET_TOKEN_RE.exec(windowText);
        if (m) return m[1];
    }
    return null;
}

/**
 * Classify a plan-set page from its extracted text.
 * Throws TypeError on non-string input.
 */
export function classifySheet(pageText: string): SheetInfo {
    if (typeof pageText !== 'string') {
        throw new TypeError(`pageText must be a string, got ${typeof pageText}`);
    }

    let kind: SheetKind = 'other';
    let score = 0;
    for (const signal of SIGNALS) {
        if (signal.re.test(pageText)) {
            kind = signal.kind;
            score = signal.score;
            break;
        }
    }

    return {
        kind,
        score,
        floor: parseFloor(pageText),
        sheetNo: parseSheetNo(pageText)
    };
}

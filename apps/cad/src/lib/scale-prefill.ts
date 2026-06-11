import { parseScaleNotation, ftPerUnitFromPdfPoints } from './scale-notation';

/**
 * Scans a list of page texts to find the first valid architectural scale notation.
 * 
 * @param pageTexts - An array of strings representing text content extracted from PDF pages.
 * @returns An object containing the converted ftPerUnit, the original matched text,
 * and the index of the page where it was found; or null if no match is found.
 */
export function prefillScaleFromText(pageTexts: string[]): { 
  ftPerUnit: number; 
  sourceText: string; 
  pageIndex: number 
} | null {
  for (let i = 0; i < pageTexts.length; i++) {
    const text = pageTexts[i];
    if (!text) continue;

    const parsed = parseScaleNotation(text);
    if (parsed) {
      return {
        ftPerUnit: ftPerUnitFromPdfPoints(parsed.ftPerInch),
        sourceText: parsed.notation,
        pageIndex: i,
      };
    }
  }

  return null;
}
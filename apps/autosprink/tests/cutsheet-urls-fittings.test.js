/**
 * Validates src/data/cutsheet-urls-fittings.json — manufacturer cut-sheet /
 * submittal-sheet URL research for pipe / fitting / grooved / valve-adjacent
 * components (TASK R1, FLAG-DON'T-GATE doctrine).
 *
 * HONESTY rules enforced here:
 *  - JSON must parse and be a non-empty array
 *  - every entry has a non-empty string `key` and a valid `confidence`
 *  - every non-null `url` is https
 *  - `url: null` is only allowed with confidence 'not-found' (never a guessed URL)
 *  - keys are unique and must exist in the component registry
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getComponent } from '../src/components/registry.js';

const DATA_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'data',
  'cutsheet-urls-fittings.json'
);

const CONFIDENCES = ['verified', 'probable', 'not-found'];

function loadEntries() {
  return JSON.parse(readFileSync(DATA_PATH, 'utf8'));
}

describe('cutsheet-urls-fittings.json', () => {
  it('parses as a non-empty array', () => {
    const entries = loadEntries();
    expect(Array.isArray(entries)).toBe(true);
    expect(entries.length).toBeGreaterThan(0);
  });

  it('every entry has a non-empty key and a valid confidence', () => {
    for (const e of loadEntries()) {
      expect(typeof e.key, JSON.stringify(e)).toBe('string');
      expect(e.key.length).toBeGreaterThan(0);
      expect(CONFIDENCES).toContain(e.confidence);
    }
  });

  it('every non-null url is https', () => {
    for (const e of loadEntries()) {
      if (e.url !== null) {
        expect(typeof e.url, `url for ${e.key}`).toBe('string');
        expect(e.url.startsWith('https://'), `non-https url for ${e.key}: ${e.url}`).toBe(true);
      }
    }
  });

  it('null url only with confidence not-found, and not-found always has null url', () => {
    for (const e of loadEntries()) {
      if (e.url === null) expect(e.confidence, `null url for ${e.key}`).toBe('not-found');
      if (e.confidence === 'not-found') expect(e.url, `not-found with url for ${e.key}`).toBeNull();
    }
  });

  it('entries carry name, category, manufacturer and an honest note', () => {
    for (const e of loadEntries()) {
      expect(typeof e.name, `name for ${e.key}`).toBe('string');
      expect(typeof e.category, `category for ${e.key}`).toBe('string');
      expect(typeof e.note, `note for ${e.key}`).toBe('string');
      expect(e.note.length).toBeGreaterThan(0);
      // manufacturer may legitimately be null only when nothing was found
      if (e.confidence !== 'not-found') {
        expect(typeof e.manufacturer, `manufacturer for ${e.key}`).toBe('string');
      }
    }
  });

  it('keys are unique and exist in the component registry', () => {
    const entries = loadEntries();
    const keys = entries.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const e of entries) {
      const component = getComponent(e.key);
      expect(component, `unknown registry key: ${e.key}`).toBeDefined();
      expect(e.name).toBe(component.name);
      expect(e.category).toBe(component.category);
    }
  });
});

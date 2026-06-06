import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  manufacturerVerifiedParts,
  type ManufacturerStepManifest,
} from '../src/lib/manufacturer-step';

const HERE = dirname(fileURLToPath(import.meta.url));

const KSB_SHA = 'E58B7EC32CB12D19CD0B6FA668D7BA732B3080F3481747DE11B0CA36601AA060';

describe('manufacturerVerifiedParts (T54 standalone verified parts)', () => {
  it('empty manifest -> no verified parts', () => {
    expect(manufacturerVerifiedParts({ entries: [] })).toEqual([]);
    expect(manufacturerVerifiedParts(null)).toEqual([]);
    expect(manufacturerVerifiedParts(undefined)).toEqual([]);
  });

  it('operator-verified entry -> manufacturer_verified / engineeringAccurate=true', () => {
    const manifest: ManufacturerStepManifest = {
      entries: [
        {
          key: 'ksb-pump',
          slug: 'ksb-pump',
          manufacturer: 'KSB SE & Co. KGaA',
          productCode: 'Etanorm FXE',
          modelName: 'Etanorm FXE',
          category: 'pump',
          stepUrl: '/parts/manufacturer-step/ksb-pump.stp',
          sha256: 'abc123',
          manufacturerExact: true,
          license: 'CADENAS 3Dfindit terms-of-use',
        },
      ],
    };
    const parts = manufacturerVerifiedParts(manifest);
    expect(parts).toHaveLength(1);
    const p = parts[0];
    expect(p.id).toBe('ksb-pump');
    expect(p.modelStatus).toBe('manufacturer_verified');
    expect(p.engineeringAccurate).toBe(true);
    expect(p.category).toBe('pump');
    expect(p.license).toBe('CADENAS 3Dfindit terms-of-use');
    expect(p.stepUrl).toBe('/parts/manufacturer-step/ksb-pump.stp');
  });

  it('DROPS an entry missing sha256 (fail-closed — no fabricated verified part)', () => {
    const manifest: ManufacturerStepManifest = {
      entries: [
        {
          key: 'x',
          slug: 'x',
          manufacturer: 'X',
          productCode: 'X-1',
          modelName: 'X',
          stepUrl: '/parts/manufacturer-step/x.stp',
          // no sha256
          manufacturerExact: true,
        },
      ],
    };
    expect(manufacturerVerifiedParts(manifest)).toEqual([]);
  });

  it('DROPS an entry missing stepUrl (fail-closed)', () => {
    const manifest: ManufacturerStepManifest = {
      entries: [
        {
          key: 'x',
          manufacturer: 'X',
          productCode: 'X-1',
          modelName: 'X',
          stepUrl: '',
          sha256: 'abc',
        },
      ],
    };
    expect(manufacturerVerifiedParts(manifest)).toEqual([]);
  });

  it('uses the entry key as id when no slug is present', () => {
    const parts = manufacturerVerifiedParts({
      entries: [
        {
          key: 'legacy-key',
          manufacturer: 'M',
          productCode: 'P',
          modelName: 'P',
          stepUrl: 'parts/p.step',
          sha256: 'sh',
        },
      ],
    });
    expect(parts).toHaveLength(1);
    expect(parts[0].id).toBe('legacy-key');
  });
});

describe('shipped manufacturer-step.json (KSB Etanorm pump)', () => {
  it('contains the KSB entry with the REAL sha256 + relative stepFile + manufacturerExact', () => {
    interface ShippedEntry {
      slug?: string;
      manufacturer: string;
      productCode: string;
      category?: string;
      stepUrl: string;
      stepFile?: string;
      sha256?: string;
      manufacturerExact?: boolean;
      license?: string;
    }
    const json = JSON.parse(
      readFileSync(resolve(HERE, '../public/parts/manufacturer-step.json'), 'utf8'),
    ) as { entries: ShippedEntry[] };
    const ksb = json.entries.find((e) => e.slug === 'ksb-etanorm-fxe-125-100-200-2a');
    expect(ksb).toBeDefined();
    expect(ksb!.manufacturer).toBe('KSB SE & Co. KGaA');
    expect(ksb!.productCode).toBe('Etanorm FXE 125-100-200-2a');
    expect(ksb!.category).toBe('pump');
    expect(ksb!.sha256).toBe(KSB_SHA);
    expect(ksb!.stepFile).toBe('/parts/manufacturer-step/ksb-etanorm-fxe-125-100-200-2a.stp');
    expect(ksb!.manufacturerExact).toBe(true);
    expect(ksb!.license).toBe('CADENAS 3Dfindit terms-of-use');
  });

  it('every shipped manufacturer-step entry resolves to a manufacturer_verified part, incl. the KSB anchor', () => {
    const json = JSON.parse(
      readFileSync(resolve(HERE, '../public/parts/manufacturer-step.json'), 'utf8'),
    ) as ManufacturerStepManifest;
    const parts = manufacturerVerifiedParts(json);
    // At least the anchor part is shipped; count grows as more real CAD is imported.
    expect(parts.length).toBeGreaterThanOrEqual(1);
    // EVERY shipped manufacturer part must be a real operator-verified part.
    for (const p of parts) {
      expect(p.modelStatus).toBe('manufacturer_verified');
      expect(p.engineeringAccurate).toBe(true);
      expect(typeof p.sha256).toBe('string');
      expect((p.sha256 ?? '').length).toBe(64);
    }
    // The KSB 125-100-200 anchor must be present with its known real sha256.
    const anchor = parts.find((p) => p.sha256 === KSB_SHA);
    expect(anchor).toBeDefined();
    expect(anchor!.modelStatus).toBe('manufacturer_verified');
  });
});

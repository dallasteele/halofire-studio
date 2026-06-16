import { maxProtectionAreaSqFt, maxSpacingFt } from './head-layout';
import type { HazardClass, PipeMaterial } from './model';
import { cFactorForMaterial } from './hydraulics';

export interface HazenWilliamsValue {
  material: PipeMaterial;
  value: number;
  citation: string;
}

export interface CoverageValue {
  hazard: HazardClass;
  value: string;
  citation: string;
}

export async function getHazenWilliams(
  material: PipeMaterial = 'STEEL_SCH40',
): Promise<HazenWilliamsValue> {
  const hazenWilliams = cFactorForMaterial(material);
  return {
    material,
    value: hazenWilliams.value,
    citation: hazenWilliams.citation,
  };
}

export async function getCoverage(
  hazard: HazardClass = 'LIGHT',
): Promise<CoverageValue> {
  const area = maxProtectionAreaSqFt(hazard);
  const spacing = maxSpacingFt(hazard);
  return {
    hazard,
    value: `${area.value} ft^2/head max, ${spacing.value} ft max spacing`,
    citation: `${area.citation} ${spacing.citation}`,
  };
}

const DEFAULT_TITLE = 'NFPA 13 Design Summary';
const DEFAULT_PROJECT_NAME = 'Unnamed Project';
const DEFAULT_HAZARD_CLASS = 'unspecified';
const DEFAULT_PRESSURE_UNITS = 'psi';

function toFiniteNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function roundToHundredths(value) {
  return Math.round(value * 100) / 100;
}

function normalizeNotes(notes) {
  if (!Array.isArray(notes)) {
    return [];
  }

  return notes.filter((note) => typeof note === 'string' && note.trim().length > 0);
}

export function createNfpaReport(input = {}) {
  const designAreaSqFt = toFiniteNumber(input.designAreaSqFt);
  const densityGpmPerSqFt = toFiniteNumber(input.densityGpmPerSqFt);
  const hoseAllowanceGpm = toFiniteNumber(input.hoseAllowanceGpm);
  const calculatedFlowGpm = roundToHundredths(
    Number.isFinite(input.totalFlowGpm)
      ? input.totalFlowGpm
      : designAreaSqFt * densityGpmPerSqFt,
  );

  return {
    title: input.title ?? DEFAULT_TITLE,
    projectName: input.projectName ?? DEFAULT_PROJECT_NAME,
    hazardClass: input.hazardClass ?? DEFAULT_HAZARD_CLASS,
    designAreaSqFt,
    densityGpmPerSqFt,
    sprinklerCount: toFiniteNumber(input.sprinklerCount),
    calculatedFlowGpm,
    hoseAllowanceGpm,
    demandGpm: roundToHundredths(calculatedFlowGpm + hoseAllowanceGpm),
    pressureUnits: input.pressureUnits ?? DEFAULT_PRESSURE_UNITS,
    notes: normalizeNotes(input.notes),
  };
}

export default createNfpaReport;

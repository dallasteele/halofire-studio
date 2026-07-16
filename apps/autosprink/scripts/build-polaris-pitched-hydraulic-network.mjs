import fs from 'node:fs';

import { extractPolarisFireLineSource } from './extract-polaris-fireline-source.mjs';
import { registerPolarisFireLineSource } from './register-polaris-fireline-source.mjs';
import { buildPolarisPitchedHydraulicNetwork } from '../src/engine/polaris-pitched-hydraulic-network.js';

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));

export async function buildFromSources({
  pipeCalibrationPath,
  atticReportPath,
  belowCeilingReportPath,
  fireLinePath,
  sitePlanPath,
  sourceCandidatePath,
  sourceContinuityPath,
  drainageCodeBasisPath,
  manufacturerDimensionSchedulePath,
}) {
  const [fireLineEvidence, fireLineRegistration] = await Promise.all([
    extractPolarisFireLineSource(fireLinePath),
    registerPolarisFireLineSource({ sitePlanPath, fireLinePath, sourceCandidatePath }),
  ]);
  return buildPolarisPitchedHydraulicNetwork({
    pipeCalibration: readJson(pipeCalibrationPath),
    atticReport: readJson(atticReportPath),
    belowCeilingReport: readJson(belowCeilingReportPath),
    fireLineEvidence,
    fireLineRegistration,
    sourceContinuityEvidence: readJson(sourceContinuityPath),
    drainageCodeBasis: readJson(drainageCodeBasisPath),
    manufacturerDimensionSchedule: readJson(manufacturerDimensionSchedulePath),
  });
}

if (import.meta.url === `file:///${process.argv[1]?.replaceAll('\\', '/')}`) {
  const [
    pipeCalibrationPath,
    atticReportPath,
    belowCeilingReportPath,
    fireLinePath,
    sitePlanPath,
    sourceCandidatePath,
    sourceContinuityPath,
    drainageCodeBasisPath,
    manufacturerDimensionSchedulePath,
    outputPath,
  ] = process.argv.slice(2);
  if (!outputPath) {
    throw new Error('USAGE: build-polaris-pitched-hydraulic-network.mjs <pipe-calibration.json> <attic-report.json> <below-ceiling-report.json> <fire-line.dwg> <site-plan.dwg> <source-candidate.json> <source-continuity.json> <drainage-code-basis.json> <manufacturer-dimensions.json> <output.json>');
  }
  const packet = await buildFromSources({
    pipeCalibrationPath,
    atticReportPath,
    belowCeilingReportPath,
    fireLinePath,
    sitePlanPath,
    sourceCandidatePath,
    sourceContinuityPath,
    drainageCodeBasisPath,
    manufacturerDimensionSchedulePath,
  });
  fs.writeFileSync(outputPath, `${JSON.stringify(packet, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ outputPath, receiptSha256: packet.receiptSha256, claims: packet.claims }, null, 2)}\n`);
}

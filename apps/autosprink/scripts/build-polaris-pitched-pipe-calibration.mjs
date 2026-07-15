import { createHash } from 'node:crypto';
import fs from 'node:fs';

import { extractAutosprinkDwgCalibration } from './extract-autosprink-dwg-calibration.mjs';
import { inspectNativeAutosprinkCad } from './inspect-autosprink-native-cad.mjs';

const PROJECT_ID = 'polaris-academy-mesa-az';
const DWG_SHA256 = '3B27B60D74C6058508789929AD0CA20DF490C28905828B5AC096183454154C2F';
const NATIVE_CAD_SHA256 = '1224C1268B19FD4390FEEB0E7A563852AEC6B9B82EADE8452B3686EDD405D3F4';
const APPROVED_FP2_SHA256 = '06C502687CE21D66AEE8D7C5212CB5FF2B5E31E17A7433BD22448DE12CA80DD1';
const AS_BUILT_SHA256 = '1442BE77DA8D08388084E6F56EE3DDFEA9565F08307022449267D065A504E81A';
const PIPE_GEOMETRY_SHA256 = '33CE1D1119D64BB349152C3AF83767313404C8ED3443F770A8BA123FBEAEA34A';
const XY_OFFSET_INCHES = [2089.742556327576, 545.357810486682];
const Z_DATUM_OFFSET_INCHES = 11.175011099624;
const SIZE_BY_RADIUS = new Map([
  ['0.551376', 1],
  ['0.689220', 1.25],
  ['0.827064', 1.5],
  ['1.102752', 2],
  ['1.378440', 2.5],
  ['1.654128', 3],
  ['2.205504', 4],
]);

const round = (value, precision = 9) => Number(value.toFixed(precision));
const sha256 = (value) => createHash('sha256').update(value).digest('hex').toUpperCase();
const projectPoint = (point) => ({
  x: round((point.x + XY_OFFSET_INCHES[0]) / 12),
  y: round((point.y + XY_OFFSET_INCHES[1]) / 12),
  z: round((point.z - Z_DATUM_OFFSET_INCHES) / 12),
});

function nominalSizeForRadius(radius) {
  const size = SIZE_BY_RADIUS.get(Number(radius).toFixed(6));
  if (!size) throw new Error(`POLARIS_PIPE_RADIUS_UNMAPPED:${radius}`);
  return size;
}

function planDirection(start, end, planLengthInches) {
  if (planLengthInches < 1) return 'vertical-transition';
  const dx = Math.abs(end.x - start.x);
  const dy = Math.abs(end.y - start.y);
  if (dx < 1e-6) return 'north-south';
  if (dy < 1e-6) return 'east-west';
  return 'diagonal';
}

function buildPipe(pipe) {
  const start = projectPoint(pipe.start);
  const end = projectPoint(pipe.end);
  const absDeltaZInches = Math.abs(pipe.deltaZ);
  const geometryKind = absDeltaZInches <= 1e-6
    ? 'level-run'
    : pipe.planLength < 1
      ? 'vertical-transition'
      : 'sloped-plan-run';
  return {
    id: pipe.id,
    sourceBlockName: pipe.blockName,
    nominalSizeInches: nominalSizeForRadius(pipe.maxSectionRadius),
    startFt: start,
    endFt: end,
    planLengthFt: round(pipe.planLength / 12),
    length3dFt: round(pipe.length3d / 12),
    deltaZInches: round(pipe.deltaZ),
    gradeInPer10Ft: geometryKind === 'sloped-plan-run' ? round(120 * absDeltaZInches / pipe.planLength, 6) : null,
    downhillDirection: absDeltaZInches <= 1e-6 ? 'level' : pipe.deltaZ < 0 ? 'start-to-end' : 'end-to-start',
    planDirection: planDirection(start, end, pipe.planLength),
    geometryKind,
    sourceAttributes: pipe.attributes,
  };
}

export async function buildPolarisPitchedPipeCalibration({ dwgPath, nativeCadPath, answerEvidencePath }) {
  const [dwg, nativeCad] = await Promise.all([
    extractAutosprinkDwgCalibration(dwgPath, DWG_SHA256),
    Promise.resolve(inspectNativeAutosprinkCad(nativeCadPath, NATIVE_CAD_SHA256)),
  ]);
  const answerEvidence = JSON.parse(fs.readFileSync(answerEvidencePath, 'utf8'));
  const pipes = dwg.pipes.map(buildPipe);
  const fittings = dwg.fittings.map((fitting) => ({
    id: fitting.id,
    sourceBlockName: fitting.blockName,
    family: fitting.blockName.startsWith('Flex Drop')
      ? 'Flex Drop'
      : fitting.blockName.match(/^Fitting(\d+)/)?.[0] ?? 'Fitting',
    pointFt: projectPoint(fitting.point),
    sourceAttributes: fitting.attributes,
  }));
  const sprinklers = dwg.sprinklers.map((sprinkler) => ({
    id: sprinkler.id,
    sourceBlockName: sprinkler.blockName,
    pointFt: projectPoint(sprinkler.point),
    sourceAttributes: sprinkler.attributes,
  }));
  const hydraulicNodeLabels = dwg.hydraulicNodeLabels.map((label) => ({
    nodeId: label.nodeId,
    labelPointFt: {
      x: round((label.labelPoint.x + XY_OFFSET_INCHES[0]) / 12),
      y: round((label.labelPoint.y + XY_OFFSET_INCHES[1]) / 12),
    },
    alignmentPointFt: {
      x: round((label.alignmentPoint.x + XY_OFFSET_INCHES[0]) / 12),
      y: round((label.alignmentPoint.y + XY_OFFSET_INCHES[1]) / 12),
    },
  }));
  const sourceNotes = dwg.sourceNotes.map((note) => ({
    text: note.text,
    labelPointFt: projectPoint(note.labelPoint),
    leaderTipFt: note.leaderTip ? projectPoint(note.leaderTip) : null,
    leaderSegmentCount: note.leaderSegmentCount,
  }));
  const headResiduals = dwg.sprinklers.map((sprinkler, index) => {
    const actual = projectPoint(sprinkler.point);
    const expected = answerEvidence.sprinklers[index]?.pointFt;
    if (!expected) throw new Error(`POLARIS_HEAD_BINDING_MISSING:${index}`);
    return {
      xyFt: Math.hypot(actual.x - expected[0], actual.y - expected[1]),
      zInches: Math.abs((actual.z - expected[2]) * 12),
    };
  });
  const countBy = (items, key) => Object.fromEntries([...items.reduce((counts, item) => {
    const value = String(item[key]);
    counts.set(value, (counts.get(value) ?? 0) + 1);
    return counts;
  }, new Map())].sort(([a], [b]) => Number(a) - Number(b)));
  const packet = {
    schema: 'halofire.polaris-pitched-pipe-xyz-calibration.v1',
    projectId: PROJECT_ID,
    sources: {
      nativeCad: {
        fileName: nativeCad.source.fileName,
        byteLength: nativeCad.source.byteLength,
        sha256: nativeCad.source.sha256,
        archiveEntryCount: nativeCad.archive.entryCount,
        typeCount: nativeCad.drawingSeidb.typeCount,
        nativeSpatialTypesReady: nativeCad.drawingSeidb.nativeSpatialTypesReady,
      },
      exportedDwg: {
        fileName: dwg.source.fileName,
        byteLength: dwg.source.byteLength,
        sha256: dwg.source.sha256,
        pipeGeometrySha256: PIPE_GEOMETRY_SHA256,
      },
      approvedFp2: {
        fileName: 'Polaris Academy - Mesa AZ_FP2.pdf',
        byteLength: answerEvidence.bindings.approvedFp2.bytes,
        sha256: APPROVED_FP2_SHA256,
      },
      asBuilt: {
        fileName: 'As Built.pdf',
        byteLength: answerEvidence.bindings.asBuiltSprinkler.bytes,
        sha256: AS_BUILT_SHA256,
      },
      approvedAndAsBuiltFp2RasterSha256: answerEvidence.bindings.approvedAndAsBuiltFp2RasterSha256.toUpperCase(),
    },
    registration: {
      sourceUnits: 'inches',
      projectUnits: 'feet',
      xyOffsetInches: XY_OFFSET_INCHES,
      zDatumOffsetInches: Z_DATUM_OFFSET_INCHES,
      architecturalOutlineVertices: answerEvidence.coordinateRegistration.matchedVertexCount,
      architecturalOutlineMaxResidualInches: answerEvidence.coordinateRegistration.maxResidualInches,
      headCount: headResiduals.length,
      headXyMaxResidualFt: round(Math.max(...headResiduals.map((item) => item.xyFt)), 9),
      headLabelZMaxResidualInches: round(Math.max(...headResiduals.map((item) => item.zInches)), 6),
    },
    summary: {
      pipeCount: pipes.length,
      headCount: dwg.sprinklers.length,
      fittingCount: fittings.length,
      nominalSizeCounts: countBy(pipes, 'nominalSizeInches'),
      geometryKindCounts: countBy(pipes, 'geometryKind'),
      planDirectionCounts: countBy(pipes, 'planDirection'),
      distinctEndpointElevations: new Set(pipes.flatMap((pipe) => [pipe.startFt.z, pipe.endFt.z])).size,
      endpointElevationRangeFt: [
        Math.min(...pipes.flatMap((pipe) => [pipe.startFt.z, pipe.endFt.z])),
        Math.max(...pipes.flatMap((pipe) => [pipe.startFt.z, pipe.endFt.z])),
      ],
      fittingFamilyCounts: countBy(fittings, 'family'),
      hydraulicNodeLabelCount: hydraulicNodeLabels.length,
      attributedPipeCount: pipes.filter((pipe) => Object.keys(pipe.sourceAttributes).length > 0).length,
      attributedFittingCount: fittings.filter((fitting) => Object.keys(fitting.sourceAttributes).length > 0).length,
      sourceNoteCount: sourceNotes.length,
    },
    pipes,
    sprinklers,
    fittings,
    hydraulicNodeLabels,
    sourceNotes,
    claims: {
      exactSourcePipeXyzReady: true,
      sourceUnitConversionReady: true,
      approvedAndAsBuiltRegistrationReady: true,
      planDirectionReady: true,
      roofRelativePipeGradeGeometryReady: true,
      hydraulicFlowDirectionReady: false,
      drainageGradeSemanticsReady: false,
      fullFittingIdentityReady: fittings.length > 0
        && fittings.every((fitting) => fitting.sourceAttributes['Sub Category']
          && fitting.sourceAttributes.Description
          && fitting.sourceAttributes.Size),
      drainDestinationReady: false,
      nativeElementGeometryRecordDecodeReady: false,
      newHopeExactPipeCenterlineZReady: false,
      properPipeLayoutReady: false,
      fabricationReady: false,
      fieldReleaseReady: false,
    },
  };
  packet.receiptSha256 = sha256(JSON.stringify(packet));
  return packet;
}

if (import.meta.url === `file:///${process.argv[1]?.replaceAll('\\', '/')}`) {
  const [dwgPath, nativeCadPath, outputPath] = process.argv.slice(2);
  if (!dwgPath || !nativeCadPath || !outputPath) {
    throw new Error('USAGE: build-polaris-pitched-pipe-calibration.mjs <export.dwg> <native.cad> <output.json>');
  }
  const answerEvidencePath = new URL('../src/data/polaris-answer-extracted-evidence.json', import.meta.url);
  const packet = await buildPolarisPitchedPipeCalibration({ dwgPath, nativeCadPath, answerEvidencePath });
  fs.writeFileSync(outputPath, `${JSON.stringify(packet, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ outputPath, receiptSha256: packet.receiptSha256, summary: packet.summary }, null, 2)}\n`);
}

import { evaluateNewHopeFabricationEndSchedule } from './new-hope-fabrication-end-schedule.js';
import { validateNewHopeWetLevel1NetworkEvidence } from './new-hope-wet-level1-network-evidence.js';

const PROJECT_ID = 'new-hope-crisis-center-brigham-city-ut';
const LISTING_SHA = '2E01CB3C2C39289846DF0A17A758E6D1DE4F5A682ED139556BD864BF6F8BD734';
const EXPECTED_PAGES = Object.freeze([7, 8, 9, 10, 11, 12, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 40, 41, 42]);
const EXPECTED_QUANTITY_GAPS = Object.freeze([
  Object.freeze({ pieceId: 'BL34.01', nativePipeRecordCount: 1, listingQuantity: 2, unexpandedUnitCount: 1 }),
  Object.freeze({ pieceId: 'BL35.01', nativePipeRecordCount: 1, listingQuantity: 2, unexpandedUnitCount: 1 }),
]);
const EXPECTED_CROSSWALK_FINGERPRINT = '7f335d44a9f6a356';

const issue = (code, path, message) => ({ severity: 'blocking', code, path, message });
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const clone = (value) => JSON.parse(JSON.stringify(value));

function fnv1a64(text) {
  let value = 14695981039346656037n;
  for (const byte of new TextEncoder().encode(text)) {
    value ^= BigInt(byte);
    value = BigInt.asUintN(64, value * 1099511628211n);
  }
  return value.toString(16).padStart(16, '0');
}

function countBy(values, select) {
  return Object.fromEntries([...values.reduce((counts, value) => {
    const key = select(value);
    counts.set(key, (counts.get(key) || 0) + 1);
    return counts;
  }, new Map())].sort(([left], [right]) => String(left).localeCompare(String(right))));
}

function listingDefinitionType(piece, threadedIds) {
  return threadedIds.has(piece.pieceId) ? 'threaded' : 'welded';
}

function crosswalkFingerprint(rows) {
  return fnv1a64(rows.map((row) => [
    row.nativePipeUniqueId,
    row.pieceId,
    row.listingDefinitionType,
    row.listingPhysicalPage,
    row.listingQuantity,
    row.nativeCutLengthFt.toFixed(6),
    row.listedCutLengthIn === null ? 'null' : row.listedCutLengthIn.toFixed(6),
    row.lengthReconciliationStatus,
  ].join(':')).join('|'));
}

/**
 * Reconciles the 167 wet-system Project.seidb pipe records to the exact
 * approved AutoSPRINK listing definition rows. This does not infer plan
 * placement, direction, grade, installed elevation, or quantity-expanded
 * physical units that the native record set does not enumerate separately.
 */
export function buildNewHopeWetListingCrosswalk({ wetLevel1NetworkEvidence, fabricationEndSchedule } = {}) {
  const issues = [];
  const wetValidation = validateNewHopeWetLevel1NetworkEvidence(wetLevel1NetworkEvidence);
  const listingValidation = evaluateNewHopeFabricationEndSchedule(fabricationEndSchedule);
  if (wetValidation.status !== 'passed') {
    issues.push(issue('NH_WET_LISTING_WET_EVIDENCE_INVALID', 'wetLevel1NetworkEvidence', 'The exact wet-network evidence must pass before listing reconciliation.'));
  }
  if (listingValidation.status !== 'passed' || fabricationEndSchedule?.source?.sha256 !== LISTING_SHA) {
    issues.push(issue('NH_WET_LISTING_SOURCE_INVALID', 'fabricationEndSchedule', 'The exact approved 42-page AutoSPRINK listing must pass before reconciliation.'));
  }

  const listedPieces = [
    ...(fabricationEndSchedule?.weldedPieces ?? []),
    ...(fabricationEndSchedule?.threadedPieces ?? []),
  ];
  const listingByPieceId = new Map(listedPieces.map((piece) => [piece.pieceId, piece]));
  const threadedIds = new Set((fabricationEndSchedule?.threadedPieces ?? []).map((piece) => piece.pieceId));
  const occurrenceByPieceId = new Map();
  const rows = (wetLevel1NetworkEvidence?.nativeFabricationLines ?? []).flatMap((line) =>
    (line.pieces ?? []).map((nativePiece) => {
      const pieceId = nativePiece.pieceName === 'T-1' ? 'T-1' : `${line.lineName}${nativePiece.pieceName}`;
      const listed = listingByPieceId.get(pieceId);
      const occurrence = (occurrenceByPieceId.get(pieceId) || 0) + 1;
      occurrenceByPieceId.set(pieceId, occurrence);
      const definitionType = listed ? listingDefinitionType(listed, threadedIds) : null;
      const listedCutLengthIn = definitionType === 'threaded' ? listed.cutLengthIn : null;
      const nativeCutLengthIn = Number((nativePiece.cutLengthFt * 12).toFixed(6));
      const threadedLengthExact = definitionType === 'threaded'
        && Math.abs(nativeCutLengthIn - Number(listedCutLengthIn)) <= 0.00001;
      return {
        nativePipeUniqueId: nativePiece.uniqueId,
        nativeLineUniqueId: line.lineUniqueId,
        nativeLineName: line.lineName,
        nativePieceName: nativePiece.pieceName,
        definitionOccurrence: occurrence,
        pieceId,
        nativeNominalDiameterIn: nativePiece.nominalDiameterIn,
        nativeCutLengthFt: nativePiece.cutLengthFt,
        nativeOutletCount: nativePiece.outletCount,
        nativeFittingRecordCount: nativePiece.fittingCount,
        listingDefinitionType: definitionType,
        listingLineName: listed?.lineName ?? null,
        listingPhysicalPage: listed?.physicalPage ?? null,
        listingQuantity: listed?.quantity ?? null,
        listingEndPreparation: clone(listed?.endPreparation ?? []),
        listingEndFitting: definitionType === 'threaded'
          ? listed?.endFittingText ?? null
          : clone(listed?.endFittingFamilies ?? []),
        listedCutLengthIn,
        lengthReconciliationStatus: definitionType === 'threaded'
          ? (threadedLengthExact ? 'native-and-listing-exact' : 'mismatch')
          : 'native-only-listing-end-schedule-omits-welded-cut-length',
      };
    }),
  );

  const rowCountsByPieceId = countBy(rows, (row) => row.pieceId);
  const uniqueDefinitionIds = [...new Set(rows.map((row) => row.pieceId))].sort((left, right) => left.localeCompare(right));
  const wetListingDefinitions = listedPieces.filter((piece) => uniqueDefinitionIds.includes(piece.pieceId));
  const quantityExpansionGaps = wetListingDefinitions
    .map((piece) => ({
      pieceId: piece.pieceId,
      nativePipeRecordCount: rowCountsByPieceId[piece.pieceId] || 0,
      listingQuantity: piece.quantity,
      unexpandedUnitCount: Math.max(0, piece.quantity - (rowCountsByPieceId[piece.pieceId] || 0)),
    }))
    .filter((entry) => entry.unexpandedUnitCount > 0);
  const threadedRows = rows.filter((row) => row.listingDefinitionType === 'threaded');
  const weldedRows = rows.filter((row) => row.listingDefinitionType === 'welded');
  const pages = [...new Set(rows.map((row) => row.listingPhysicalPage))].sort((left, right) => left - right);
  const fingerprint = crosswalkFingerprint(rows);

  if (
    rows.length !== 167
    || uniqueDefinitionIds.length !== 165
    || wetListingDefinitions.length !== 165
    || rows.some((row) => !row.listingDefinitionType || !row.listingPhysicalPage || !row.listingQuantity)
    || weldedRows.length !== 100
    || threadedRows.length !== 67
    || threadedRows.some((row) => row.lengthReconciliationStatus !== 'native-and-listing-exact')
    || !same(pages, EXPECTED_PAGES)
    || !same(quantityExpansionGaps, EXPECTED_QUANTITY_GAPS)
    || wetListingDefinitions.reduce((sum, piece) => sum + piece.quantity, 0) !== 169
    || rowCountsByPieceId['T-1'] !== 3
    || listingByPieceId.get('T-1')?.quantity !== 3
    || fingerprint !== EXPECTED_CROSSWALK_FINGERPRINT
  ) {
    issues.push(issue('NH_WET_LISTING_CROSSWALK_INVALID', 'crosswalkRows', 'All 167 native wet pipe records must reconcile to 165 exact approved listing definitions, including 67 exact threaded lengths and the two explicit quantity-expansion gaps.'));
  }

  const ready = issues.length === 0;
  return {
    artifactType: 'halofire.new-hope-wet-listing-crosswalk-result.v1',
    projectId: PROJECT_ID,
    status: ready ? 'passed' : 'blocked',
    issues,
    source: ready ? clone(fabricationEndSchedule.source) : null,
    metrics: {
      nativePipeRecordCount: rows.length,
      uniqueListingDefinitionCount: uniqueDefinitionIds.length,
      weldedNativeRecordCount: weldedRows.length,
      threadedNativeRecordCount: threadedRows.length,
      exactThreadedLengthMatchCount: threadedRows.filter((row) => row.lengthReconciliationStatus === 'native-and-listing-exact').length,
      listingFabricatedUnitCount: wetListingDefinitions.reduce((sum, piece) => sum + piece.quantity, 0),
      unexpandedListingUnitCount: quantityExpansionGaps.reduce((sum, entry) => sum + entry.unexpandedUnitCount, 0),
      listingPhysicalPages: pages,
      crosswalkFingerprintFnv1a64: fingerprint,
    },
    quantityExpansionGaps: ready ? clone(quantityExpansionGaps) : [],
    rows: ready ? rows : [],
    nativeRowToListingDefinitionReady: ready,
    threadedCutLengthCrossSourceReady: ready,
    weldedCutLengthCrossSourceReady: false,
    listingQuantityExpansionReady: false,
    pieceToPlanVectorMappingReady: false,
    pipeDirectionReady: false,
    pipeGradeReady: false,
    installedElevationReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
  };
}

export default { buildNewHopeWetListingCrosswalk };

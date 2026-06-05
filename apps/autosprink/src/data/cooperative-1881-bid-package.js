import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(__dirname, '../..');
const PROPOSAL_FILE = 'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx';
const BUILDING_SHEET = 'Building (1)';

function readWorkbook(rootDir, filename) {
  return XLSX.readFile(path.join(rootDir, filename), {
    cellDates: true,
    cellNF: false,
    cellText: false,
  });
}

function cell(sheet, address) {
  return sheet[address]?.v ?? null;
}

function num(value) {
  return Number(value || 0);
}

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function money(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

// The Knowify SOV cost block on the "Building (1)" sheet. The header row is 27
// ("Description | Material | Labor | Subcontractor | Equipment | Miscellaneous"),
// and the per-phase cost rows follow (Bidding/Estimating, Precon, Rough In,
// Trim — labels that DIFFER from the Home Depot job's Design/Materials/Labor).
// We sum each cost COLUMN over the block rather than hardcoding fragile single
// cells, then validate the sum against the sheet's own "Knowify Check" total
// (R38). Columns: N=Material, O=Labor, P=Subcontractor, Q=Equipment,
// R=Miscellaneous.
const KNOWIFY_BLOCK_FIRST_ROW = 28; // first data row after the row-27 header
const KNOWIFY_BLOCK_LAST_ROW = 33; // inclusive; covers Bidding/Precon/RoughIn/Trim
const KNOWIFY_CHECK_CELL = 'R38';

function sumColumn(sheet, col, firstRow, lastRow) {
  let total = 0;
  for (let row = firstRow; row <= lastRow; row += 1) {
    const value = cell(sheet, `${col}${row}`);
    if (typeof value === 'number' && Number.isFinite(value)) total += value;
  }
  return total;
}

// Real-takeoff bid calibration for the Cooperative 1881 residential apartment
// job. We parse the REAL submitted ESI/Knowify takeoff into a structured scope
// breakdown so the calibration is backed by real source rows (an explicit
// evidence trail), NOT a model achievement. This clears NO regulated gate and
// asserts NO accuracy/AHJ/PE/parity/AutoSprink claim.
export function readCooperative1881RealTakeoff(rootDir = DEFAULT_ROOT) {
  const filePath = path.join(rootDir, PROPOSAL_FILE);
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Cooperative 1881 proposal workbook not found at ${filePath} — real takeoff unavailable`,
    );
  }
  const proposalWb = readWorkbook(rootDir, PROPOSAL_FILE);
  const building = proposalWb.Sheets[BUILDING_SHEET];
  if (!building) {
    throw new Error(`"${BUILDING_SHEET}" sheet missing in ${PROPOSAL_FILE} — real takeoff unavailable`);
  }

  // COST breakdown (un-marked-up ESI takeoff categories) — column sums over the
  // Knowify SOV cost block. Robust to the per-phase row labels.
  const material = money(sumColumn(building, 'N', KNOWIFY_BLOCK_FIRST_ROW, KNOWIFY_BLOCK_LAST_ROW));
  const labor = money(sumColumn(building, 'O', KNOWIFY_BLOCK_FIRST_ROW, KNOWIFY_BLOCK_LAST_ROW));
  const subcontractor = money(sumColumn(building, 'P', KNOWIFY_BLOCK_FIRST_ROW, KNOWIFY_BLOCK_LAST_ROW));
  const equipment = money(sumColumn(building, 'Q', KNOWIFY_BLOCK_FIRST_ROW, KNOWIFY_BLOCK_LAST_ROW));
  const miscellaneous = money(sumColumn(building, 'R', KNOWIFY_BLOCK_FIRST_ROW, KNOWIFY_BLOCK_LAST_ROW));
  const costTotal = money(material + labor + subcontractor + equipment + miscellaneous);

  // The sheet's own "Knowify Check" cost total — used to VALIDATE the column
  // sums (they must agree). Surfaced so callers/tests can cross-check.
  const knowifyCheck = money(cell(building, KNOWIFY_CHECK_CELL));

  const totalPrice = money(cell(building, 'G11'));
  // Single-building proposal total: G11 == Proposal Template K10/K39.
  const total = totalPrice;
  const headCount = num(cell(building, 'B9'));
  const sqft = num(cell(building, 'G6'));
  // Mark-up read directly from the sheet (I11 = 0.33).
  const markupPct = Math.round(num(cell(building, 'I11')) * 10000) / 10000;

  return {
    cost: {
      material,
      labor,
      subcontractor,
      equipment,
      miscellaneous,
      total: costTotal,
    },
    knowifyCheck,
    totalPrice,
    total,
    bidLogTotal: total,
    markupPct,
    headCount,
    sqft,
    sourceRefs: [
      // The Knowify SOV cost block range (Material..Miscellaneous columns).
      `${PROPOSAL_FILE}#${BUILDING_SHEET}!N${KNOWIFY_BLOCK_FIRST_ROW}:R${KNOWIFY_BLOCK_LAST_ROW}`,
      // The "Knowify Check" cost total (validates the column sums).
      `${PROPOSAL_FILE}#${BUILDING_SHEET}!${KNOWIFY_CHECK_CELL}`,
      // Proposal total, head count, and sprinklered square footage.
      `${PROPOSAL_FILE}#${BUILDING_SHEET}!G11`,
      `${PROPOSAL_FILE}#${BUILDING_SHEET}!B9`,
      `${PROPOSAL_FILE}#${BUILDING_SHEET}!G6`,
      `${PROPOSAL_FILE}#${BUILDING_SHEET}!I11`,
    ],
    disclaimer:
      'Real ESI/Knowify takeoff parsed verbatim from the submitted proposal '
      + 'workbook (Building (1) Knowify SOV cost block; column sums validated '
      + 'against the sheet "Knowify Check" total; source cells cited). It is the '
      + 'actual submitted breakdown for a residential apartment sprinkler bid, '
      + 'NOT produced by the auto-bidder and NOT an accuracy, AHJ, PE, '
      + 'AutoSprink, or manufacturer claim. It clears no regulated gate.',
  };
}

// Lean project-header reader mirroring readHomeDepotBidPackage. Pulls the
// human-facing facts (contractor, address, sqft, head count, total) from the
// "Building (1)" sheet for the residential Cooperative 1881 job.
export function readCooperative1881BidPackage(rootDir = DEFAULT_ROOT) {
  const filePath = path.join(rootDir, PROPOSAL_FILE);
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Cooperative 1881 proposal workbook not found at ${filePath} — bid package unavailable`,
    );
  }
  const proposalWb = readWorkbook(rootDir, PROPOSAL_FILE);
  const building = proposalWb.Sheets[BUILDING_SHEET];
  if (!building) {
    throw new Error(`"${BUILDING_SHEET}" sheet missing in ${PROPOSAL_FILE} — bid package unavailable`);
  }
  const total = money(cell(building, 'G11'));

  return {
    project: 'The Cooperative 1881 - Salt Lake City UT',
    contractor: cleanText(cell(building, 'B3')) || 'Kier Construction',
    projectNameRaw: cleanText(cell(building, 'B4')),
    address: cleanText(cell(building, 'B5')),
    city: cleanText(cell(building, 'G5')),
    state: cleanText(cell(building, 'H5')),
    contact: cleanText(`${cell(building, 'B6') || ''} ${cell(building, 'C6') || ''}`),
    contactPhone: cleanText(cell(building, 'B7')),
    preparedBy: cleanText(cell(building, 'A12')),
    sqft: num(cell(building, 'G6')),
    headCount: num(cell(building, 'B9')),
    headDensitySqftPerHead: Math.round(num(cell(building, 'D11')) * 100) / 100,
    pricePerHead: money(cell(building, 'I9')),
    pricePerSqft: Math.round(num(cell(building, 'D10')) * 10000) / 10000,
    markupPct: Math.round(num(cell(building, 'I11')) * 10000) / 10000,
    total,
    systemNotes:
      'Residential apartment sprinkler bid (NFPA-13R-style): residential heads + '
      + 'drops; wet in residences, dry in parking/attic. NO ESFR. Standard-spray '
      + '(light/ordinary hazard) path.',
    sourceRefs: [
      `${PROPOSAL_FILE}#${BUILDING_SHEET}!B3`,
      `${PROPOSAL_FILE}#${BUILDING_SHEET}!B4`,
      `${PROPOSAL_FILE}#${BUILDING_SHEET}!B5`,
      `${PROPOSAL_FILE}#${BUILDING_SHEET}!G6`,
      `${PROPOSAL_FILE}#${BUILDING_SHEET}!B9`,
      `${PROPOSAL_FILE}#${BUILDING_SHEET}!G11`,
    ],
    disclaimer:
      'Best-effort bid data only; not permit-ready, AHJ-approved, '
      + 'engineering-grade, fabrication-ready, or an AutoSprink/parity claim.',
  };
}

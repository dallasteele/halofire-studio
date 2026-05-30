import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(__dirname, '../..');
const PROPOSAL_FILE = 'Proposal- Home Depot - Rexburg ID.xlsx';
const BID_LOG_FILE = '01-Bid Log.xlsx';

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

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function money(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function toIsoDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d)).toISOString().slice(0, 10);
  }
  return cleanText(value) || null;
}

function findHomeDepotBidLogRow(workbook) {
  const sheet = workbook.Sheets['Bid Log'];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    const jobName = cleanText(row[3]);
    if (/home depot/i.test(jobName) && /rexburg/i.test(jobName)) {
      return {
        worksheetRow: index + 1,
        dueDate: toIsoDate(row[0]),
        submittedDate: toIsoDate(row[2]),
        jobName,
        amount: money(row[4]),
        status: cleanText(row[5]) || 'Bidding',
        prospectRank: Number(row[7] || 0),
        estimator: cleanText(row[8]),
        jobType: cleanText(row[9]),
        estimatedSqft: Number(row[10] || 0),
        contractor: cleanText(row[11]),
      };
    }
  }
  throw new Error('Home Depot Rexburg row not found in bid log');
}

export function readHomeDepotBidPackage(rootDir = DEFAULT_ROOT) {
  const proposalWb = readWorkbook(rootDir, PROPOSAL_FILE);
  const bidLogWb = readWorkbook(rootDir, BID_LOG_FILE);
  const proposal = proposalWb.Sheets['Proposal Template - New'];
  const jobInfo = proposalWb.Sheets['Job Information'];
  const fieldSummary = proposalWb.Sheets['Field Summary Report'];
  const building = proposalWb.Sheets['Building 1'];
  const bidLog = findHomeDepotBidLogRow(bidLogWb);
  const project = 'Home Depot - Rexburg ID';
  const proposalBaseTotal = Number(cell(building, 'G11') || 0);
  const totalWithOptions = Number(cell(proposal, 'K39') || bidLog.amount || 0);

  return {
    project,
    contractor: bidLog.contractor || cleanText(cell(proposal, 'D5')),
    recipient: cleanText(cell(proposal, 'D4')),
    proposalDate: toIsoDate(cell(proposal, 'D3')),
    dueDate: bidLog.dueDate,
    submittedDate: bidLog.submittedDate,
    status: bidLog.status,
    address: cleanText(cell(fieldSummary, 'B3') || cell(building, 'B5')),
    city: cleanText(cell(fieldSummary, 'E1') || cell(building, 'G5')),
    state: cleanText(cell(fieldSummary, 'E2') || cell(building, 'H5')),
    sqft: Number(cell(building, 'G6') || cell(proposal, 'D6') || bidLog.estimatedSqft || 0),
    headCount: Number(cell(building, 'B9') || 0),
    proposalBaseTotal,
    totalWithOptions,
    bidLogAmount: bidLog.amount,
    optionAmount: money(totalWithOptions - proposalBaseTotal),
    pricePerSqft: Number(cell(building, 'D10') || 0),
    pricePerHead: Number(cell(building, 'I9') || 0),
    preparedBy: cleanText(cell(building, 'A12')),
    contactPhone: cleanText(cell(building, 'B7')),
    water: {
      staticPsi: Number(cell(jobInfo, 'B3') || 0),
      residualPsi: Number(cell(jobInfo, 'B4') || 0),
      flowingGpm: Number(cell(jobInfo, 'B5') || 0),
      flowDataDate: toIsoDate(cell(jobInfo, 'B6')),
      waterModelRequired: cleanText(cell(jobInfo, 'B7')),
    },
    sourceRefs: [
      `${PROPOSAL_FILE}#Building 1!G11`,
      `${PROPOSAL_FILE}#Proposal Template - New!K39`,
      `${PROPOSAL_FILE}#Job Information!B3:B7`,
      `${BID_LOG_FILE}#Bid Log row ${bidLog.worksheetRow}`,
    ],
  };
}

// T24 — Real-takeoff bid calibration. The REAL ESI takeoff (the actual submitted
// bid-line rows) lives in the "Building 1" sheet's Knowify SOV block. We parse the
// verified cells into a structured scope breakdown so the Home Depot calibration is
// backed by real source rows (an explicit evidence trail), NOT a model achievement.
// This clears NO regulated gate and asserts NO accuracy/AHJ/PE/parity claim.
const REAL_TAKEOFF_BID_LOG_TOTAL = 792543.84;

export function readHomeDepotRealTakeoff(rootDir = DEFAULT_ROOT) {
  const filePath = path.join(rootDir, PROPOSAL_FILE);
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Home Depot proposal workbook not found at ${filePath} — real takeoff unavailable`,
    );
  }
  const proposalWb = readWorkbook(rootDir, PROPOSAL_FILE);
  const building = proposalWb.Sheets['Building 1'];
  if (!building) {
    throw new Error(`"Building 1" sheet missing in ${PROPOSAL_FILE} — real takeoff unavailable`);
  }

  // COST breakdown (un-marked-up ESI takeoff categories).
  const material = money(cell(building, 'N31'));
  const labor = money(cell(building, 'O32'));
  const equipment = money(cell(building, 'Q32'));
  const subcontractor = money(cell(building, 'P30'));
  const miscellaneous = money(cell(building, 'R30'));
  const costTotal = money(material + labor + equipment + subcontractor + miscellaneous);

  // WITH-MARKUP submitted SOV line items.
  const materialsMarked = money(cell(building, 'U31'));
  const laborMarked = money(cell(building, 'U32')); // labor (+ equipment)
  const designMarked = money(cell(building, 'U30')); // design (sub + misc)
  const sovTotal = money(cell(building, 'U34'));

  const totalPrice = money(cell(building, 'G11'));
  const rawMaterial = Number(cell(building, 'N31') || 0);
  const rawMaterialMarked = Number(cell(building, 'U31') || 0);
  const markupPct = rawMaterial
    ? Math.round((rawMaterialMarked / rawMaterial - 1) * 10000) / 10000
    : 0;

  return {
    cost: {
      material,
      labor,
      equipment,
      subcontractor,
      miscellaneous,
      total: costTotal,
    },
    withMarkup: {
      materials: materialsMarked,
      labor: laborMarked,
      design: designMarked,
      sovTotal,
    },
    totalPrice,
    bidLogTotal: REAL_TAKEOFF_BID_LOG_TOTAL,
    markupPct,
    sourceRefs: [
      `${PROPOSAL_FILE}#Building 1!N31`,
      `${PROPOSAL_FILE}#Building 1!O32`,
      `${PROPOSAL_FILE}#Building 1!Q32`,
      `${PROPOSAL_FILE}#Building 1!P30`,
      `${PROPOSAL_FILE}#Building 1!R30`,
      `${PROPOSAL_FILE}#Building 1!U31`,
      `${PROPOSAL_FILE}#Building 1!U32`,
      `${PROPOSAL_FILE}#Building 1!U30`,
      `${PROPOSAL_FILE}#Building 1!U34`,
      `${PROPOSAL_FILE}#Building 1!G11`,
    ],
    disclaimer:
      'Real ESI takeoff parsed verbatim from the submitted proposal workbook '
      + '(Building 1 SOV block; source cells cited). It is the actual submitted '
      + 'breakdown, NOT produced by the auto-bidder and NOT an accuracy, AHJ, PE, '
      + 'AutoSprink, or manufacturer claim. It clears no regulated gate.',
  };
}

export function buildHomeDepotSeedRows(rootDir = DEFAULT_ROOT) {
  const pkg = readHomeDepotBidPackage(rootDir);
  const packageNotes = JSON.stringify({
    source: 'actual_bid_package',
    proposalBaseTotal: pkg.proposalBaseTotal,
    totalWithOptions: pkg.totalWithOptions,
    optionAmount: pkg.optionAmount,
    headCount: pkg.headCount,
    pricePerSqft: pkg.pricePerSqft,
    pricePerHead: pkg.pricePerHead,
    water: pkg.water,
    sourceRefs: pkg.sourceRefs,
    claimGate: 'Best-effort bid data only; not permit-ready, AHJ-approved, engineering-grade, or fabrication-ready.',
  });

  return {
    bid: {
      project: pkg.project,
      contractor: pkg.contractor,
      value: pkg.bidLogAmount,
      status: pkg.status,
      date: pkg.submittedDate || pkg.proposalDate,
      due_date: pkg.dueDate,
      sqft: pkg.sqft,
      system_type: 'Wet',
      contact: pkg.recipient,
      notes: packageNotes,
    },
    project: {
      name: pkg.project,
      phase: 'Bid Review',
      progress: 15,
      budget: pkg.bidLogAmount,
      spent: 0,
      manager: pkg.preparedBy || 'Max Steele',
      start_date: pkg.submittedDate || pkg.proposalDate,
      end_date: pkg.dueDate,
      status: pkg.status,
      notes: packageNotes,
    },
    compliance: {
      project_name: pkg.project,
      type: 'AHJ / professional review evidence',
      due_date: pkg.dueDate,
      status: 'Evidence Required',
      authority: 'Rexburg Fire Marshal',
      notes: packageNotes,
    },
  };
}

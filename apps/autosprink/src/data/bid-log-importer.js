import path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(__dirname, '../..');
const BID_LOG_FILE = '01-Bid Log.xlsx';
const BID_LOG_SHEET = 'Bid Log';

const HEADERS = {
  due_date: 'Due Date',
  submitted_date: 'Bid Submitted',
  project: 'Job Name',
  value: 'Bid Amount',
  status: 'Status',
  prospect_rank: 'Prospect Rank',
  estimator: 'Estimator',
  job_type: 'Job Type',
  sqft: 'Square Feet',
  contractor: 'Contractor',
};

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeProject(value) {
  return cleanText(value).replace(/\s+NEGOTIATED\s*$/i, '').trim();
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

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function money(value) {
  const number = toNumber(value);
  return number === null ? null : Math.round(number * 100) / 100;
}

function headerIndex(headerRow) {
  const names = new Map(headerRow.map((name, index) => [cleanText(name), index]));
  return Object.fromEntries(
    Object.entries(HEADERS).map(([field, header]) => [field, names.get(header)])
  );
}

function pick(row, indexes, field) {
  const index = indexes[field];
  return index === undefined ? null : row[index];
}

function isBlankBidRow(row, indexes) {
  return [
    'due_date',
    'submitted_date',
    'project',
    'value',
    'status',
    'prospect_rank',
    'estimator',
    'job_type',
    'sqft',
    'contractor',
  ].every((field) => cleanText(pick(row, indexes, field)) === '');
}

export function readBidLogRows(rootDir = DEFAULT_ROOT) {
  const workbook = XLSX.readFile(path.join(rootDir, BID_LOG_FILE), {
    cellDates: true,
    cellNF: false,
    cellText: false,
  });
  const sheet = workbook.Sheets[BID_LOG_SHEET];
  if (!sheet) {
    throw new Error(`${BID_LOG_FILE} is missing sheet ${BID_LOG_SHEET}`);
  }

  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
  const indexes = headerIndex(rows[0] ?? []);

  return rows.slice(1).flatMap((row, index) => {
    if (isBlankBidRow(row, indexes)) return [];

    const worksheetRow = index + 2;
    const value = money(pick(row, indexes, 'value'));
    const status = value === null
      ? 'needs_amount_review'
      : cleanText(pick(row, indexes, 'status')) || null;

    return [{
      source: 'actual_bid_log',
      worksheetRow,
      source_file: BID_LOG_FILE,
      sheet: BID_LOG_SHEET,
      due_date: toIsoDate(pick(row, indexes, 'due_date')),
      submitted_date: toIsoDate(pick(row, indexes, 'submitted_date')),
      project: normalizeProject(pick(row, indexes, 'project')),
      value,
      status,
      prospect_rank: toNumber(pick(row, indexes, 'prospect_rank')),
      estimator: cleanText(pick(row, indexes, 'estimator')) || null,
      job_type: cleanText(pick(row, indexes, 'job_type')) || null,
      sqft: toNumber(pick(row, indexes, 'sqft')),
      contractor: cleanText(pick(row, indexes, 'contractor')) || null,
      sourceRefs: [`${BID_LOG_FILE}#${BID_LOG_SHEET} row ${worksheetRow}`],
    }];
  });
}

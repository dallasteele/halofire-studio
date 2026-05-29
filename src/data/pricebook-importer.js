import path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(__dirname, '../..');

const ARGCO_FILE = 'Halo FIre Pricebook ARGCO 2026.xlsx';
const FFF_FILE = 'Halo Fire Pricebook FFF 2026.xlsx';
const VICTAULIC_FILE = 'Halo Fire Pricebook Victaulic 2026.xlsx';

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function headerKey(value) {
  return cleanText(value).toUpperCase();
}

function parsePrice(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value * 100) / 100;
  }
  const text = cleanText(value).replace(/[$,]/g, '');
  if (!text) return null;
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100) / 100;
}

function readWorkbook(rootDir, filename) {
  return XLSX.readFile(path.join(rootDir, filename), {
    cellDates: false,
    cellNF: false,
    cellText: false,
  });
}

function cellValue(sheet, rowIndex, colIndex) {
  return sheet[XLSX.utils.encode_cell({ r: rowIndex, c: colIndex })]?.v ?? null;
}

function findHeader(sheet, requiredHeaders) {
  const range = XLSX.utils.decode_range(sheet['!ref']);
  const required = new Set(requiredHeaders.map(headerKey));

  for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
    const columns = new Map();
    for (let colIndex = range.s.c; colIndex <= range.e.c; colIndex += 1) {
      const key = headerKey(cellValue(sheet, rowIndex, colIndex));
      if (key) columns.set(key, colIndex);
    }

    if ([...required].every((key) => columns.has(key))) {
      return { rowIndex, columns, range };
    }
  }

  return null;
}

function makeItem({ supplier, sku, description, price, source_file, source_sheet, source_row }) {
  const normalizedSku = cleanText(sku);
  const normalizedDescription = cleanText(description);
  const normalizedPrice = parsePrice(price);

  if (!normalizedSku || !normalizedDescription || normalizedPrice === null) {
    return null;
  }

  return {
    supplier,
    sku: normalizedSku,
    description: normalizedDescription,
    price: normalizedPrice,
    source_file,
    source_sheet,
    source_row,
  };
}

function readArgco(rootDir) {
  const workbook = readWorkbook(rootDir, ARGCO_FILE);
  const source_sheet = 'ARGCOPricebookTravisResults';
  const sheet = workbook.Sheets[source_sheet];
  const header = findHeader(sheet, ['Item Number', 'Name', 'Price']);
  if (!header) return [];

  const skuCol = header.columns.get('ITEM NUMBER');
  const descriptionCol = header.columns.get('NAME');
  const priceCol = header.columns.get('PRICE');
  const items = [];

  for (let rowIndex = header.rowIndex + 1; rowIndex <= header.range.e.r; rowIndex += 1) {
    const item = makeItem({
      supplier: 'ARGCO',
      sku: cellValue(sheet, rowIndex, skuCol),
      description: cellValue(sheet, rowIndex, descriptionCol),
      price: cellValue(sheet, rowIndex, priceCol),
      source_file: ARGCO_FILE,
      source_sheet,
      source_row: rowIndex + 1,
    });
    if (item) items.push(item);
  }

  return items;
}

function readVictaulic(rootDir) {
  const workbook = readWorkbook(rootDir, VICTAULIC_FILE);
  const source_sheet = 'Data';
  const sheet = workbook.Sheets[source_sheet];
  const header = findHeader(sheet, ['Part Code', 'Type', 'Type 2', 'style', 'size', '2025A']);
  if (!header) return [];

  const columns = {
    sku: header.columns.get('PART CODE'),
    type: header.columns.get('TYPE'),
    type2: header.columns.get('TYPE 2'),
    style: header.columns.get('STYLE'),
    size: header.columns.get('SIZE'),
    finish: header.columns.get('TYPE2'),
    price: header.columns.get('2025A'),
  };
  const items = [];

  for (let rowIndex = header.rowIndex + 1; rowIndex <= header.range.e.r; rowIndex += 1) {
    const description = [
      cellValue(sheet, rowIndex, columns.type),
      cellValue(sheet, rowIndex, columns.type2),
      cellValue(sheet, rowIndex, columns.style),
      cellValue(sheet, rowIndex, columns.size),
      cellValue(sheet, rowIndex, columns.finish),
    ]
      .map(cleanText)
      .filter(Boolean)
      .join(' ');
    const item = makeItem({
      supplier: 'Victaulic',
      sku: cellValue(sheet, rowIndex, columns.sku),
      description,
      price: cellValue(sheet, rowIndex, columns.price),
      source_file: VICTAULIC_FILE,
      source_sheet,
      source_row: rowIndex + 1,
    });
    if (item) items.push(item);
  }

  return items;
}

function readFff(rootDir) {
  const workbook = readWorkbook(rootDir, FFF_FILE);
  const items = [];

  for (const source_sheet of workbook.SheetNames) {
    const sheet = workbook.Sheets[source_sheet];
    if (!sheet?.['!ref']) continue;
    const header = findHeader(sheet, ['PART CODE', 'DESCRIPTION', 'LIST', 'NET']);
    if (!header) continue;

    const skuCol = header.columns.get('PART CODE');
    const descriptionCol = header.columns.get('DESCRIPTION');
    const listCol = header.columns.get('LIST');
    const netCol = header.columns.get('NET');

    for (let rowIndex = header.rowIndex + 1; rowIndex <= header.range.e.r; rowIndex += 1) {
      const netPrice = cellValue(sheet, rowIndex, netCol);
      const listPrice = cellValue(sheet, rowIndex, listCol);
      const item = makeItem({
        supplier: 'FFF',
        sku: cellValue(sheet, rowIndex, skuCol),
        description: cellValue(sheet, rowIndex, descriptionCol),
        price: parsePrice(netPrice) === null ? listPrice : netPrice,
        source_file: FFF_FILE,
        source_sheet,
        source_row: rowIndex + 1,
      });
      if (item) items.push(item);
    }
  }

  return items;
}

export function readPricebooks(rootDir = DEFAULT_ROOT) {
  return [...readArgco(rootDir), ...readVictaulic(rootDir), ...readFff(rootDir)];
}

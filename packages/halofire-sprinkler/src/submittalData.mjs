const DEFAULT_PROJECT_NAME = 'Unnamed Project';
const DEFAULT_REVISION = '0';

function normalizeString(value, fallback) {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function normalizeDocuments(documents) {
  if (!Array.isArray(documents)) {
    return [];
  }

  return documents
    .filter((document) => document && typeof document.name === 'string')
    .map((document) => ({
      name: document.name,
      included: document.included !== false,
      pages: Number.isFinite(document.pages) ? document.pages : 0,
    }));
}

export function createSubmittalData(input = {}) {
  const documents = normalizeDocuments(input.documents);
  const includedDocuments = documents.filter((document) => document.included);

  return {
    projectName: normalizeString(input.projectName, DEFAULT_PROJECT_NAME),
    contractorName: normalizeString(input.contractorName, ''),
    preparedFor: normalizeString(input.preparedFor, ''),
    revision: normalizeString(input.revision, DEFAULT_REVISION),
    documents,
    includedDocumentCount: includedDocuments.length,
    totalPages: includedDocuments.reduce((sum, document) => sum + document.pages, 0),
    includesHydraulicCalculations: includedDocuments.some(
      (document) => document.name.toLowerCase().includes('hydraulic'),
    ),
    includesMaterialList: includedDocuments.some(
      (document) => document.name.toLowerCase().includes('material'),
    ),
  };
}

export default createSubmittalData;

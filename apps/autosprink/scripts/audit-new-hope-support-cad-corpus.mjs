import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

const DEFAULT_DB = 'E:/ClaudeBot/halofire-autobid/db/halofire_bids.db'
const CAD_EXTENSIONS = Object.freeze([
  '.dwg',
  '.dxf',
  '.igs',
  '.iges',
  '.step',
  '.stp',
  '.sat',
  '.rfa',
  '.rvt',
  '.ifc',
  '.skp',
])
const SEARCH_TERMS = Object.freeze([
  'a240ab200n',
  '3/8x10p',
  '0500301692',
  '0500301742',
  '0500301759',
  '0500301767',
  '0500301775',
  'swdr1-1/2',
  '0502005710',
  '0502005708',
  '0502005712',
  '0502000410',
  '0502000408',
  '0502000414',
  '0500604541',
  '0502000830',
  'af730',
  'af035',
  'af076',
  'af779',
  'fig 69',
  'fig. 69',
  'victaulic ab2',
])

function parseArgs(argv) {
  const dbIndex = argv.indexOf('--db')
  return {
    dbPath: path.resolve(dbIndex >= 0 ? argv[dbIndex + 1] : DEFAULT_DB),
  }
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex').toUpperCase()))
  })
}

function canonicalReceiptPayload({ indexedFileCount, cadFileCounts, exactMatches, genericProxyCatalogRowCount }) {
  const cad = Object.entries(cadFileCounts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([extension, count]) => `${extension}|${count}`)
    .join(';')
  const exact = exactMatches
    .map((entry) => `${entry.documentId}|${entry.filename}|${entry.relPath}|${entry.locatorPath}`)
    .join(';')
  return `indexed=${indexedFileCount}\ncad=${cad}\nexact=${exact}\ngeneric=${genericProxyCatalogRowCount}`
}

export async function auditNewHopeSupportCadCorpus(dbPath) {
  const database = new Database(dbPath, { readonly: true, fileMustExist: true })
  try {
    const indexedFileCount = database.prepare('SELECT count(*) AS count FROM files_fts').get().count
    const cadRows = database.prepare(`
      SELECT lower(ext) AS extension, count(*) AS count
      FROM documents
      WHERE lower(ext) IN (${CAD_EXTENSIONS.map(() => '?').join(',')})
      GROUP BY lower(ext)
      ORDER BY lower(ext)
    `).all(...CAD_EXTENSIONS)
    const cadFileCounts = Object.fromEntries(cadRows.map((row) => [row.extension, row.count]))
    const exactWhere = SEARCH_TERMS.map(() => "lower(filename || ' ' || rel_path) LIKE ?").join(' OR ')
    const exactMatches = database.prepare(`
      SELECT document_id AS documentId, filename, rel_path AS relPath, locator_path AS locatorPath
      FROM files_fts
      WHERE ${exactWhere}
      ORDER BY document_id
    `).all(...SEARCH_TERMS.map((term) => `%${term}%`))
    const genericProxyCatalogRowCount = database.prepare(`
      SELECT count(*) AS count
      FROM catalog_parts
      WHERE family = 'hanger'
        AND subtype IN ('adjustable-swivel-ring', 'seismic-brace')
        AND model_path IS NOT NULL
    `).get().count
    const receiptPayload = canonicalReceiptPayload({
      indexedFileCount,
      cadFileCounts,
      exactMatches,
      genericProxyCatalogRowCount,
    })
    return {
      artifactType: 'halofire.indexed-support-cad-corpus-audit.v1',
      databasePath: dbPath.replaceAll('\\', '/'),
      databaseByteLength: database.prepare('PRAGMA page_count').pluck().get() *
        database.prepare('PRAGMA page_size').pluck().get(),
      databaseSha256: await hashFile(dbPath),
      indexedFileCount,
      cadFileCounts,
      exactTargetFilenameOrPathMatches: exactMatches,
      genericProxyCatalogRowCount,
      genericProxiesEligibleForExactGeometry: false,
      queryReceiptSha256: createHash('sha256').update(receiptPayload).digest('hex').toUpperCase(),
    }
  } finally {
    database.close()
  }
}

const { dbPath } = parseArgs(process.argv.slice(2))
console.log(JSON.stringify(await auditNewHopeSupportCadCorpus(dbPath), null, 2))

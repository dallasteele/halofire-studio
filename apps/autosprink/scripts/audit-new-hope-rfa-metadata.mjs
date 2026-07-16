import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { sha256Hex } from '../src/engine/elevation-datums.js'
import { auditRfaMetadata } from '../src/components/manufacturer-rfa-metadata.js'

const root = path.resolve(process.argv[2] || '.')
const outputPath = path.resolve(
  process.argv[3] || 'apps/autosprink/src/data/new-hope-manufacturer-rfa-metadata-audit.json',
)
const sources = [
  ['victaulic-ab2-concealed', 'tmp/victaulic-revit/Sprinkler-Victaulic-Conc_Pendent_VicFlex-AB2.rfa', 'A240AB200N'],
  ['victaulic-ab2-recessed', 'tmp/victaulic-revit/Sprinkler-Victaulic-Recessed_Pendent_VicFlex-AB2.rfa', 'A240AB200N'],
  ['asc-fig69-download-response', 'tmp/asc-exact-cad/Hanger-Swivel_Ring-Anvil-69_60.rfa', null],
]

const audits = []
for (const [role, relativePath, quoteBoundProductNumber] of sources) {
  const sourcePath = path.resolve(root, relativePath)
  const bytes = await fs.readFile(sourcePath)
  audits.push(await auditRfaMetadata(bytes, {
      role,
      relativePath: relativePath.replaceAll('\\', '/'),
      fileName: path.basename(sourcePath),
      fileSha256: createHash('sha256').update(bytes).digest('hex').toUpperCase(),
      quoteBoundProductNumber,
    }))
}
const packet = {
  artifactType: 'halofire.manufacturer-rfa-metadata-audit.v1',
  sources: audits,
  validRevitFamilyCount: audits.filter((entry) => entry.validRevitFamilyContainer).length,
  mislabeledHtmlResponseCount: audits.filter(
    (entry) => entry.sourceClassification === 'html-response-mislabeled-as-rfa',
  ).length,
  geometryKernelInspectionVerifiedCount: 0,
  threadBearingSolidReadyCount: 0,
  exactPartGeometryEligibleCount: 0,
}
packet.receiptSha256 = await sha256Hex(packet)
await fs.writeFile(outputPath, `${JSON.stringify(packet, null, 2)}\n`)
console.log(JSON.stringify({ outputPath, ...packet }, null, 2))

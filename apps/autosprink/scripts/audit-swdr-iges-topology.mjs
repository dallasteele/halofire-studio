import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { auditIgesTopology } from '../src/components/manufacturer-cad-topology.js'

const sourcePath = path.resolve(process.argv[2] || 'tmp/itw-exact-cad/igs/SWDR.igs')
const outputPath = path.resolve(process.argv[3] || 'apps/autosprink/src/data/new-hope-swdr-iges-topology-audit.json')
const bytes = await fs.readFile(sourcePath)
const packet = await auditIgesTopology(bytes.toString('utf8'), {
  fileName: path.basename(sourcePath),
  fileSha256: createHash('sha256').update(bytes).digest('hex').toUpperCase(),
})
await fs.writeFile(outputPath, `${JSON.stringify(packet, null, 2)}\n`)
console.log(JSON.stringify({ outputPath, ...packet }, null, 2))

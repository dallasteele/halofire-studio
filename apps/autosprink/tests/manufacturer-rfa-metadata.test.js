import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  auditRfaMetadata,
  verifyManufacturerRfaMetadataAudit,
  verifyRfaMetadataAudit,
} from '../src/components/manufacturer-rfa-metadata.js'

const packet = JSON.parse(fs.readFileSync(
  new URL('../src/data/new-hope-manufacturer-rfa-metadata-audit.json', import.meta.url),
  'utf8',
))

describe('manufacturer Revit-family metadata audit', () => {
  it('rejects an HTML response carrying an RFA filename', async () => {
    const audit = await auditRfaMetadata(Buffer.from(
      '<!DOCTYPE html><html><title>catalog login</title></html>',
    ), { fileName: 'not-a-family.rfa', fileSha256: 'A'.repeat(64) })
    expect(audit.sourceClassification).toBe('html-response-mislabeled-as-rfa')
    expect(audit.validRevitFamilyContainer).toBe(false)
    expect(audit.manufacturerAuthoredFamilyMetadataReady).toBe(false)
    expect(audit.exactPartGeometryEligible).toBe(false)
    expect((await verifyRfaMetadataAudit(audit)).status).toBe('passed')
  })

  it('binds two real AB2 family containers and exposes the invalid Fig. 69 download', async () => {
    expect(packet.validRevitFamilyCount).toBe(2)
    expect(packet.mislabeledHtmlResponseCount).toBe(1)
    expect(packet.geometryKernelInspectionVerifiedCount).toBe(0)
    expect(packet.threadBearingSolidReadyCount).toBe(0)
    expect(packet.exactPartGeometryEligibleCount).toBe(0)
    const [concealed, recessed, fig69] = packet.sources
    expect(concealed.sourceFileSha256).toBe('1B9A437132D846ADE3ED67B5BBEA2D43D1F01D4D9BCD693A64967F0F5E91178C')
    expect(recessed.sourceFileSha256).toBe('75F0AAC075483B6EF43F032F59E3A949B109A1759ED7B53CF0B6241D6C0AD27C')
    expect(concealed.partAtom.declaredVariationCount).toBe(concealed.partAtom.parsedPartCount)
    expect(recessed.partAtom.declaredVariationCount).toBe(recessed.partAtom.parsedPartCount)
    expect(concealed.partAtom.hasThreadGeometryParameters).toBe(false)
    expect(recessed.partAtom.hasThreadGeometryParameters).toBe(false)
    expect(concealed.quoteBoundProductNumber).toBe('A240AB200N')
    expect(concealed.quoteBoundProductNumberOccurrences).toBe(0)
    expect(recessed.quoteBoundProductNumberOccurrences).toBe(0)
    expect(fig69.sourceFileSha256).toBe('B079BA1D50E1F96279E96561208AAA25918472793F4029B261448A2B0D557F17')
    expect(fig69.sourceClassification).toBe('html-response-mislabeled-as-rfa')
    expect(fig69.validRevitFamilyContainer).toBe(false)
    for (const source of packet.sources) {
      expect((await verifyRfaMetadataAudit(source)).status).toBe('passed')
    }
    expect((await verifyManufacturerRfaMetadataAudit(packet)).status).toBe('passed')
  })

  it('blocks any metadata-only promotion to exact threads or fit', async () => {
    const promoted = structuredClone(packet.sources[0])
    promoted.threadBearingSolidReady = true
    promoted.matingFitVerified = true
    promoted.exactPartGeometryEligible = true
    const result = await verifyRfaMetadataAudit(promoted)
    expect(result.status).toBe('blocked')
    expect(result.issues).toContain('RFA_METADATA_RECEIPT_MISMATCH')
    expect(result.issues).toContain('RFA_METADATA_FALSE_GEOMETRY_PROMOTION')

    const promotedPacket = structuredClone(packet)
    promotedPacket.exactPartGeometryEligibleCount = 1
    const packetResult = await verifyManufacturerRfaMetadataAudit(promotedPacket)
    expect(packetResult.status).toBe('blocked')
    expect(packetResult.issues).toContain('MANUFACTURER_RFA_AUDIT_RECEIPT_MISMATCH')
    expect(packetResult.issues).toContain('MANUFACTURER_RFA_AUDIT_SUMMARY_INVALID')
  })
})

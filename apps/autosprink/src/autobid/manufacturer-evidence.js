/**
 * @fileoverview Assembles best-effort evidence for the MANUFACTURER_MODEL_APPROVAL_MISSING gate.
 * A follow-up cron uses OpenClaw scraper plus the GPU SAM service and cutsheet-to-model to fetch 
 * real cut sheets and generate the model ref fed here, iterating per part and recording lessons;
 * that scraper task is W16F.
 */

/**
 * @typedef {
 *   {string} sku - The unique identifier for the part.
 *   {string} manufacturer - The name of the manufacturer.
 *   {string} [cutSheetUrl] - Optional URL to a manufacturer cut sheet.
 *   {string} [generatedModelRef] - Optional reference to an OpenSCAD generated model.
 * }
 * @typedef {
 *   {string} evidence_type - Must be 'manufacturer_model_best_effort'.
 *   {string} source_ref - The cutSheetUrl or the generatedModelRef.
 *   {string} notes - JSON string containing verificationStatus and disclaimer.
 *   {string} claim_gate_effect - Must be 'no_claims_cleared'.
 * }
 * @typedef {
 *   {string} sku
 *   {string} manufacturer
 *   {string} [cutSheetUrl]
 *   {string} [generatedModelRef]
 * }
 */

/**
 * Assembles best-effort evidence for a part to advance the approval gate.
 * 
 * @param {Object} part - The part object containing SKU and manufacturer info.
 * @param {string} part.sku - Unique identifier for the part.
 * @param {string} part.manufacturer - Manufacturer name.
 * @param {string} [part.cutSheetUrl] - URL to a cut sheet.
 * @param {string} [part.generatedModelRef] - Reference to an auto-generated model.
 * @returns {Object} The evidence record.
 * @throws {TypeError} If sku is missing or not a string.
 */
export function buildManufacturerEvidence(part) {
  if (!part || typeof part.sku !== 'string') {
    throw new TypeError('Missing sku');
  }

  const sourceRef = part.cutSheetUrl || part.generatedModelRef || '';

  const notesObj = {
    verificationStatus: 'needs-verification',
    disclaimer: 'The model is dimensioned parametric not manufacturer-exact and needs manufacturer confirmation'
  };

  return {
    evidence_type: 'manufacturer_model_best_effort',
    source_ref: sourceRef,
    notes: JSON.stringify(notesObj),
    claim_gate_effect: 'no_claims_cleared'
  };
}

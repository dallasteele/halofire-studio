/**
 * @halofire/takeoff — client-side binding for the halopenclaw gateway's
 * PDF takeoff pipeline.
 *
 * The browser does NOT run pdfplumber / OpenCV / CubiCasa locally.
 * All PDF work happens in the Python gateway service (see
 * services/halopenclaw-gateway/pdf_pipeline). This package is the
 * TypeScript client that uploads the PDF, polls progress, and receives
 * the structured result.
 */

export type { TakeoffRequest, TakeoffResult, TakeoffProgress, LayerSource } from './types.js'
export { uploadPdfForTakeoff, pollTakeoffJob } from './client.js'

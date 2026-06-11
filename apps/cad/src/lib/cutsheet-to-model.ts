import { emitPipe, emitElbow90, emitTee, emitCoupling } from './scad-emitters';
import { Verification, machineGenerated } from './verification-flag';

export type PartType = 'pipe' | 'elbow' | 'tee' | 'coupling';

export interface CutSheetDims {
  partType: PartType;
  nominalIn: number;
  odIn: number;
  lengthIn?: number;
  centerToEndIn?: number;
  branchCenterToEndIn?: number;
  wallIn?: number;
  sourceUrl?: string;
}

/**
 * Generates a SCAD model and verification flag from cut-sheet dimensions.
 * 
 * @param dims - The dimensional data from the cut sheet.
 * @returns An object containing the scad source string and machine-generated verification metadata.
 * @throws RangeError if partType is unknown.
 */
export function modelFromCutSheet(dims: CutSheetDims): { scad: string; verification: Verification } {
  let scad = '';

  switch (dims.partType) {
    case 'pipe':
      scad = emitPipe({
        nominalIn: dims.nominalIn,
        odIn: dims.odIn,
        lengthIn: dims.lengthIn as number,
        wallIn: dims.wallIn as number,
      });
      break;
    case 'elbow':
      scad = emitElbow90({
        nominalIn: dims.nominalIn,
        odIn: dims.odIn,
        centerToEndIn: dims.centerToEndIn as number,
      });
      break;
    case 'tee':
      scad = emitTee({
        nominalIn: dims.nominalIn,
        odIn: dims.odIn,
        centerToEndIn: dims.centerToEndIn as number,
        branchCenterToEndIn: dims.branchCenterToEndIn as number,
      });
      break;
    case 'coupling':
      scad = emitCoupling({
        nominalIn: dims.nominalIn,
        odIn: dims.odIn,
        lengthIn: dims.lengthIn as number,
      });
      break;
    default:
      throw new RangeError(`Unknown partType: ${dims.partType}`);
  }

  const note = `${dims.partType} (Nominal: ${dims.nominalIn}, OD: ${dims.odIn})`;
  const source = dims.sourceUrl ?? 'cut-sheet-derived';

  return {
    scad,
    verification: machineGenerated(note, source),
  };
}

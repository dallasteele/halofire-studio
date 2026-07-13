import { describe, expect, it } from 'vitest';
import sourceSet from '../src/data/winter-garden-cross-project-source-set.json';
import { validateCrossProjectDesignSourceSet } from '../src/engine/cross-project-design-evidence.js';

describe('cross-project design evidence', () => {
  it('binds an independent completed project from source architecture through as-built sheets', () => {
    const result = validateCrossProjectDesignSourceSet(sourceSet);
    expect(result.status).toBe('passed');
    expect(result.projectId).toBe('winter-garden-fl-meetinghouse');
    expect(result.fileCount).toBe(12);
    expect(result.phases).toEqual(['as_built', 'city_approved', 'source_architecture', 'stamped_submittal']);
    expect(result.sourceViews).toEqual(['building_elevation', 'building_section', 'floor_plan', 'reflected_ceiling_plan', 'roof_plan']);
    expect(result.pairedSheets).toEqual(['A001', 'A002', 'A003']);
    expect(result.changedSheets).toEqual(['A001', 'A002', 'A003']);
  });

  it('fails closed when the calibration is not independent or a required view is missing', () => {
    const sameProject = structuredClone(sourceSet);
    sameProject.projectId = 'dillon-residence';
    expect(validateCrossProjectDesignSourceSet(sameProject).issues).toContain('independent_project_missing');
    const missingRoof = structuredClone(sourceSet);
    missingRoof.files = missingRoof.files.filter((file) => file.view !== 'roof_plan');
    expect(validateCrossProjectDesignSourceSet(missingRoof).issues).toContain('required_source_view_missing:roof_plan');
  });
});

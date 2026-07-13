import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import tallahasseeSourceSet from '../src/data/tallahassee-completed-project-source-set.json';
import nashvilleSourceSet from '../src/data/nashville-completed-project-source-set.json';
import dallasSourceSet from '../src/data/dallas-completed-project-source-set.json';
import winterGardenSourceSet from '../src/data/winter-garden-cross-project-source-set.json';
import {
  validateCompletedProjectEvidencePortfolio,
  validateCompletedProjectEvidenceSet,
  validateCrossProjectDesignSourceSet,
} from '../src/engine/cross-project-design-evidence.js';

describe('cross-project design evidence', () => {
  it('binds an independent completed project from source architecture through as-built sheets', () => {
    const result = validateCrossProjectDesignSourceSet(winterGardenSourceSet);
    expect(result.status).toBe('passed');
    expect(result.projectId).toBe('winter-garden-fl-meetinghouse');
    expect(result.fileCount).toBe(16);
    expect(result.phases).toEqual(['as_built', 'city_approved', 'fabrication', 'source_architecture', 'stamped_submittal']);
    expect(result.sourceViews).toEqual(['building_elevation', 'building_section', 'coordinated_building_section', 'floor_plan', 'reflected_ceiling_plan', 'roof_plan']);
    expect(result.pairedSheets).toEqual(['A001', 'A002', 'A003']);
    expect(result.fileChangedSheets).toEqual(['A001', 'A002', 'A003']);
    expect(result.geometryChangedSheets).toEqual([]);
    expect(result.annotationChangedSheets).toEqual(['A001', 'A002', 'A003']);
    expect(result.verifiedClaims).toEqual([
      'as_built_feedback_loop',
      'completed_output_to_fabrication',
      'manufacturer_family_trace',
      'pitched_roof_fabrication_spatial_mapping',
      'roof_structure_coordination',
      'source_to_completed_sprinkler_layout',
    ]);
  });

  it('fails closed when the calibration is not independent or a required view is missing', () => {
    const sameProject = structuredClone(winterGardenSourceSet);
    sameProject.projectId = 'dillon-residence';
    expect(validateCrossProjectDesignSourceSet(sameProject).issues).toContain('independent_project_missing');
    const missingRoof = structuredClone(winterGardenSourceSet);
    missingRoof.files = missingRoof.files.filter((file) => file.view !== 'roof_plan');
    expect(validateCrossProjectDesignSourceSet(missingRoof).issues).toContain('required_source_view_missing:roof_plan');
  });

  it('binds Tallahassee approved, field, as-built, roof, and three-level fabrication evidence', () => {
    const result = validateCompletedProjectEvidenceSet(tallahasseeSourceSet);
    expect(result.status).toBe('passed');
    expect(result.projectId).toBe('tallahassee-fl-temple');
    expect(result.fileCount).toBe(8);
    expect(result.excludedArtifactCount).toBe(1);
    expect(result.evidenceRoles).toEqual([
      'approved_output',
      'as_built_output',
      'design_coordination',
      'fabrication',
      'field_output',
      'source_coordination',
    ]);
    expect(result.fabricationLevels).toEqual(['basement', 'main', 'mezzanine']);
    expect(result.fabricationPipingRows).toBe(540);
    expect(result.fabricationOutletRows).toBe(313);
    expect(result.verifiedClaims).toEqual([
      'as_built_feedback_loop',
      'completed_output_to_fabrication',
      'manufacturer_family_trace',
      'multi_floor_completed_output',
      'roof_structure_coordination',
    ]);
  });

  it('binds Nashville source plans, RCPs, sections, permit-backed AHJ output, two completed levels, and consolidated fabrication', () => {
    const result = validateCompletedProjectEvidenceSet(nashvilleSourceSet);
    expect(result.status).toBe('passed');
    expect(result.projectId).toBe('nashville-tn-temple');
    expect(result.fileCount).toBe(12);
    expect(result.fabricationLevels).toEqual(['consolidated']);
    expect(result.fabricationPipingRows).toBe(453);
    expect(result.fabricationOutletRows).toBe(263);
    expect(result.verifiedClaims).toEqual([
      'as_built_feedback_loop',
      'completed_output_to_fabrication',
      'manufacturer_family_trace',
      'multi_floor_completed_output',
      'source_to_completed_sprinkler_layout',
    ]);
  });

  it('binds Dallas dry-feed fabrication to a completed pitched-attic plan without promoting code compliance', () => {
    const result = validateCompletedProjectEvidenceSet(dallasSourceSet);
    expect(result.status).toBe('passed');
    expect(result.projectId).toBe('dallas-tx-temple');
    expect(result.fileCount).toBe(8);
    expect(result.fabricationLevels).toEqual(['dry-feed']);
    expect(result.fabricationPipingRows).toBe(35);
    expect(result.fabricationOutletRows).toBe(1);
    expect(result.verifiedClaims).toEqual(['pitched_roof_fabrication_spatial_mapping']);
    expect(result.pitchedRoofFabricationSpatialMapping).toMatchObject({
      fabricatedPieceCount: 35,
      fabricatedLengthFt: 311.5,
      mappedPlanRunCount: 2,
      mappedTransitionEndpointCount: 4,
      completedHeadCount: 103,
      pitchRiseInPer12: 4,
    });
  });

  it('promotes only claims repeated across two independent completed projects', () => {
    const result = validateCompletedProjectEvidencePortfolio([winterGardenSourceSet, tallahasseeSourceSet, nashvilleSourceSet, dallasSourceSet]);
    expect(result.status).toBe('passed');
    expect(result.projectCount).toBe(4);
    expect(result.projectIds).toEqual(['dallas-tx-temple', 'nashville-tn-temple', 'tallahassee-fl-temple', 'winter-garden-fl-meetinghouse']);
    expect(result.featurePromotion.as_built_feedback_loop).toMatchObject({ ready: true, projectCount: 3 });
    expect(result.featurePromotion.completed_output_to_fabrication).toMatchObject({ ready: true, projectCount: 3 });
    expect(result.featurePromotion.manufacturer_family_trace).toMatchObject({ ready: true, projectCount: 3 });
    expect(result.featurePromotion.roof_structure_coordination).toMatchObject({ ready: true, projectCount: 2 });
    expect(result.featurePromotion.multi_floor_completed_output).toMatchObject({ ready: true, projectCount: 2 });
    expect(result.featurePromotion.source_to_completed_sprinkler_layout).toMatchObject({ ready: true, projectCount: 2 });
    expect(result.featurePromotion.pitched_roof_fabrication_spatial_mapping).toMatchObject({ ready: true, projectCount: 2, projects: ['winter-garden-fl-meetinghouse', 'dallas-tx-temple'] });
  });

  it('rejects archive substitution, missing fabrication, manufacturer drift, and duplicate projects', () => {
    const archiveSubstitution = structuredClone(tallahasseeSourceSet);
    const excluded = archiveSubstitution.excludedArtifacts[0];
    const asBuilt = archiveSubstitution.files.find((file) => file.evidenceRole === 'as_built_output');
    asBuilt.sha256 = excluded.sha256;
    expect(validateCompletedProjectEvidenceSet(archiveSubstitution).issues).toContain('excluded_artifact_reintroduced:FP1-FP6');

    const missingFabrication = structuredClone(tallahasseeSourceSet);
    missingFabrication.files = missingFabrication.files.filter((file) => file.levelId !== 'main');
    expect(validateCompletedProjectEvidenceSet(missingFabrication).issues).toContain('fabrication_inventory_file_missing:main');

    const weakenedContract = structuredClone(tallahasseeSourceSet);
    weakenedContract.requiredEvidenceRoles = ['fabrication'];
    expect(validateCompletedProjectEvidenceSet(weakenedContract).issues).toContain('required_evidence_contract_drift:as_built_output');

    const manufacturerDrift = structuredClone(tallahasseeSourceSet);
    for (const inventory of manufacturerDrift.fabricationInventories) {
      for (const family of inventory.sprinklerFamilies) family.manufacturer = 'Viking';
    }
    expect(validateCompletedProjectEvidenceSet(manufacturerDrift).issues).toContain('claim_evidence_missing:manufacturer_family_trace');

    const missingSectionProof = structuredClone(nashvilleSourceSet);
    const nashvilleAsBuilt = missingSectionProof.files.find((file) => file.evidenceRole === 'as_built_output');
    nashvilleAsBuilt.visualVerification.markers = nashvilleAsBuilt.visualVerification.markers.filter((marker) => !marker.includes('CROSS SECTION'));
    expect(validateCompletedProjectEvidenceSet(missingSectionProof).issues).toContain('claim_evidence_missing:multi_floor_completed_output');

    const missingPermit = structuredClone(nashvilleSourceSet);
    missingPermit.files = missingPermit.files.filter((file) => file.evidenceRole !== 'issued_permit');
    expect(validateCompletedProjectEvidenceSet(missingPermit).issues).toContain('required_evidence_role_missing:approval_basis');

    const resealedDallasGeometrySubstitution = structuredClone(dallasSourceSet);
    resealedDallasGeometrySubstitution.pitchedRoofFabricationSpatialMapping.mapping.mappedPlanRunCount = 3;
    const { receiptSha256: ignoredReceipt, ...resealedDraft } = resealedDallasGeometrySubstitution.pitchedRoofFabricationSpatialMapping;
    void ignoredReceipt;
    resealedDallasGeometrySubstitution.pitchedRoofFabricationSpatialMapping.receiptSha256 = createHash('sha256').update(JSON.stringify(resealedDraft)).digest('hex');
    expect(validateCompletedProjectEvidenceSet(resealedDallasGeometrySubstitution).issues).toContain('pitched_fabrication_mapping_geometry_drift:dallas-tx-temple');

    const flatRoofSubstitution = structuredClone(dallasSourceSet);
    flatRoofSubstitution.pitchedRoofFabricationSpatialMapping.pitch.riseIn = 0;
    expect(validateCompletedProjectEvidenceSet(flatRoofSubstitution).issues).toContain('pitched_fabrication_mapping_receipt_mismatch:dallas-tx-temple');

    const duplicateProject = structuredClone(tallahasseeSourceSet);
    duplicateProject.projectId = winterGardenSourceSet.projectId;
    const duplicatePortfolio = validateCompletedProjectEvidencePortfolio([winterGardenSourceSet, duplicateProject]);
    expect(duplicatePortfolio.issues).toContain('completed_project_ids_not_unique');
    expect(duplicatePortfolio.featurePromotion.completed_output_to_fabrication).toMatchObject({ ready: false, projectCount: 1 });
    expect(duplicatePortfolio.status).toBe('blocked');
  });
});

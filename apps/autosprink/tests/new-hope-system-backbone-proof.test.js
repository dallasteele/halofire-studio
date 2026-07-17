import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const proofRoot = new URL('../src/data/proofs/new-hope-system-backbone/', import.meta.url);
const sourceRoot = new URL('../src/data/proofs/new-hope-truss-clearance/', import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, proofRoot), 'utf8');

describe('New Hope system-backbone visual proof surface', () => {
  it('keeps the actual approved plan and as-built riser section beneath the proof', () => {
    const html = read('index.html');
    expect(html).toContain('../new-hope-truss-clearance/approved-fp20-full-underlay.png');
    expect(html).toContain('../new-hope-truss-clearance/asbuilt-fp10-riser-section.png');
    expect(fs.statSync(new URL('approved-fp20-full-underlay.png', sourceRoot)).size).toBeGreaterThan(2_000_000);
    expect(fs.statSync(new URL('asbuilt-fp10-riser-section.png', sourceRoot)).size).toBeGreaterThan(500_000);
    expect(fs.statSync(new URL('hydrant-flow-test-data.png', proofRoot)).size).toBeGreaterThan(200_000);
    expect(fs.statSync(new URL('approved-water-supply-table.png', proofRoot)).size).toBeGreaterThan(200_000);
    expect(fs.statSync(new URL('wet-level1-source-network.png', proofRoot)).size).toBeGreaterThan(1_000_000);
    expect(html).toContain('Complete Level 1 wet layout on the actual field drawing');
    expect(html).toContain('wet-level1-source-network.png');
  });

  it('loads every source-bound input through the project evaluator', () => {
    const script = read('proof.js');
    expect(script).toContain("buildNewHopeSystemBackboneEvidence");
    expect(script).toContain('../../new-hope-asbuilt-source-feed-riser-registration.json');
    expect(script).toContain('../../new-hope-approved-fp20-operational-annotations.json');
    expect(script).toContain('../../new-hope-approved-fp20-plan-graph.json');
    expect(script).toContain('../../new-hope-approved-fp20-hydraulic-route-2-1.json');
    expect(script).toContain('../../new-hope-approved-fp20-hydraulic-route-2-2.json');
    expect(script).toContain('../../new-hope-approved-fp20-hydraulic-route-2-3.json');
    expect(script).toContain('../../new-hope-approved-water-supply-wet-riser-evidence.json');
    expect(script).toContain('../../new-hope-wet-level1-network-evidence.json');
    expect(script).toContain('../../new-hope-fabrication-end-schedule.json');
  });

  it('surfaces release-state truth in the DOM and hides the unreleased 3D source leg', () => {
    const proofScript = read('proof.js');
    const viewer = read('viewer.js');
    expect(proofScript).toContain("root.pumpDecisionReady = String(result.pumpDecisionReady)");
    expect(proofScript).toContain("root.approvedDesignWaterSupplyReady = String(result.approvedDesignWaterSupplyReady)");
    expect(proofScript).toContain("root.wetRiserAndDrainEvidenceReady = String(result.wetRiserAndDrainEvidenceReady)");
    expect(proofScript).toContain("root.wetSystemNetwork2dReady = String(result.wetSystemNetwork2dReady)");
    expect(proofScript).toContain("root.sprinklerHeadPositions2dReady = String(result.sprinklerHeadPositions2dReady)");
    expect(proofScript).toContain("root.wetSystemHeadTypeAssignmentReady = String(result.wetSystemHeadTypeAssignmentReady)");
    expect(proofScript).toContain("root.nativeFabricationTakeoffReady = String(result.nativeFabricationTakeoffReady)");
    expect(proofScript).toContain("root.wetSystemListingDefinitionCrosswalkReady = String(result.wetSystemListingDefinitionCrosswalkReady)");
    expect(proofScript).toContain("root.wetSystemListingQuantityExpansionReady = String(result.wetSystemListingQuantityExpansionReady)");
    expect(proofScript).toContain("root.fieldDrainRoutesResolved = String(result.fieldDrainRoutesResolved)");
    expect(proofScript).toContain("root.quoteReady = String(result.quoteReady)");
    expect(viewer).toContain("sourceLeg.visible = false");
    expect(viewer).toContain("canvas.dataset.releasedRouteCount = String(result.model3d.releasedRoutes.length)");
    expect(viewer).toContain('0 released installation routes');
  });

  it('shows actual listing pages and the runtime native-to-listing crosswalk', () => {
    const html = read('index.html');
    const script = read('proof.js');
    expect(html).toContain('../new-hope-truss-clearance/listing-complete-welded-page20.png');
    expect(html).toContain('../new-hope-truss-clearance/listing-complete-threaded-page42.png');
    expect(html).toContain('Native records to approved AutoSPRINK listing');
    expect(fs.statSync(new URL('wet-listing-crosswalk-browser.png', proofRoot)).size).toBeGreaterThan(100_000);
    expect(script).toContain("document.querySelector('#crosswalk-rows')");
    expect(script).toContain('crosswalk.quantityExpansionGaps');
  });

  it('describes primary cross-source and adversarial loops without an independent human gate', () => {
    const html = read('index.html');
    expect(html).toContain('System-owned verification loops');
    expect(html).toContain('Primary');
    expect(html).toContain('Cross-source');
    expect(html).toContain('Adversarial');
    expect(html).not.toMatch(/independent review|human gate/i);
  });
});

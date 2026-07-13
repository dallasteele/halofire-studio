const REQUIRED_SOURCES = Object.freeze([
  'halofire-master/00_MASTER_MOC.md',
  'halofire-master/02-Estimating-Bidding/02_Estimating_Bidding.md',
  'halofire-master/03-Design-Engineering/03_Design_Engineering.md',
  'halofire-master/04-Procurement-Vendors/04_Procurement_Vendors.md',
  'halofire-master/05-Fabrication-Shop/05-06-fab-field.md',
  'halofire-master/07-08-itm-pm.md',
  'halofire-master/AI_AUTOMATION_OPPORTUNITIES.md',
  'halofire-autobid/system/autobid-index.md',
]);

const REQUIRED_GUARDRAILS = Object.freeze([
  'estimate-before-award-is-not-install-design',
  'source-scale-and-elevation-datums-must-be-proven',
  'commercial-hazard-and-density-come-from-project-spec-not-architectural-grid',
  'completed-bids-are-held-out-calibration-not-generation-inputs',
  'design-basis-requires-hazard-density-water-supply-and-field-condition-evidence',
  'no-approved-submittal-means-no-order-fabrication-or-field-release',
  'manufacturer-product-claims-require-approved-cut-sheets-and-responsibility-scope',
  'field-conflicts-become-rfis-not-untracked-field-guesses',
  'ahj-compliance-fabrication-and-manufacturer-claims-fail-closed',
  'primary-independent-and-adversarial-verification-loops-are-internal',
  'closeout-and-realized-job-cost-feed-the-next-estimating-loop',
]);

const REQUIRED_APPLICATIONS = Object.freeze([
  {
    id: 'lifecycle-stage-authority',
    domain: 'company-operations',
    source: 'halofire-master/00_MASTER_MOC.md',
    decision: 'bid-award-design-procure-fabricate-install-inspect-service-is-the-authoritative-lifecycle',
    control: 'every-artifact-declares-its-lifecycle-stage-and-cannot-inherit-downstream-authority',
  },
  {
    id: 'estimate-design-boundary',
    domain: 'estimating',
    source: 'halofire-master/02-Estimating-Bidding/02_Estimating_Bidding.md',
    decision: 'estimating-geometry-is-a-pricing-seed-not-an-approved-installation-design',
    control: 'source-building-and-layout-artifacts-keep-compliance-fabrication-and-field-release-false',
  },
  {
    id: 'commercial-spec-hazard-basis',
    domain: 'estimating-and-design',
    source: 'halofire-master/03-Design-Engineering/03_Design_Engineering.md',
    decision: 'commercial-hazard-density-and-remote-area-come-from-csi-division-21-before-layout',
    control: 'reject-default-hazard-or-density-when-the-project-spec-is-missing-unbound-or-contradicted',
  },
  {
    id: 'design-basis-and-hydraulics',
    domain: 'design-engineering',
    source: 'halofire-master/03-Design-Engineering/03_Design_Engineering.md',
    decision: 'field-conditions-hazard-density-water-supply-remote-area-and-obstructions-precede-afc-release',
    control: 'unresolved-room-ceiling-obstruction-or-water-evidence-keeps-design-and-compliance-fail-closed',
  },
  {
    id: 'approved-product-procurement',
    domain: 'procurement',
    source: 'halofire-master/04-Procurement-Vendors/04_Procurement_Vendors.md',
    decision: 'released-bom-approved-cut-sheets-responsibility-matrix-and-live-vendor-data-govern-the-buy',
    control: 'no-manufacturer-exact-product-or-procurement-claim-without-project-approved-source-evidence',
  },
  {
    id: 'afc-before-fabrication',
    domain: 'fabrication-shop',
    source: 'halofire-master/05-Fabrication-Shop/05-06-fab-field.md',
    decision: 'nothing-is-cut-kitted-or-shipped-before-approved-for-construction-drawings-and-bom',
    control: 'fabrication-ready-remains-false-until-afc-revision-bom-cut-list-and-product-approvals-join',
  },
  {
    id: 'approved-set-field-rfi',
    domain: 'field-operations',
    source: 'halofire-master/05-Fabrication-Shop/05-06-fab-field.md',
    decision: 'field-installs-the-approved-set-and-routes-conflicts-back-as-rfis',
    control: 'unresolved-coordination-never-becomes-an-invented-install-location-or-field-release',
  },
  {
    id: 'pm-change-closeout-learning',
    domain: 'project-management-and-itm',
    source: 'halofire-master/07-08-itm-pm.md',
    decision: 'changes-are-priced-before-work-and-closeout-requires-asbuilts-om-test-certs-warranty-and-turnover',
    control: 'revision-change-closeout-and-realized-cost-state-remain-explicit-and-feed-estimating-calibration',
  },
  {
    id: 'internal-verification-doctrine',
    domain: 'software-governance',
    source: 'halofire-master/AI_AUTOMATION_OPPORTUNITIES.md',
    decision: 'every-ai-feature-runs-multisignal-self-validation-and-correction-loops-inside-the-product',
    control: 'primary-independent-and-adversarial-results-are-machine-gated-with-no-independent-review-blocker',
  },
  {
    id: 'brain-db-loop-division',
    domain: 'autobid-platform',
    source: 'halofire-autobid/system/autobid-index.md',
    decision: 'the-bid-db-locates-source-files-the-brain-holds-recallable-knowledge-and-deterministic-engines-own-calculations',
    control: 'every-generated-decision-cites-source-locators-brain-provenance-and-deterministic-rule-output',
  },
]);

const issue = (code, message, refs = []) => ({ severity: 'blocking', code, message, refs });

export function buildHaloFireOperationalKnowledgeReceipt({ sessionId, recallEpisodeIds = [], preflightQuery, recalledWikiPages = [] } = {}) {
  return {
    artifactType: 'halofire.operational-knowledge-receipt.v2',
    source: 'gx10-hal-brain+obsidian-vault',
    canonicalVault: '/opt/hal9000/apps/claudebot/hal-vault',
    preflightStatus: 'passed',
    sessionId,
    preflightQuery,
    recallEpisodeIds: [...recallEpisodeIds],
    recalledWikiPages: [...recalledWikiPages],
    sources: [...REQUIRED_SOURCES],
    workflowGuardrails: [...REQUIRED_GUARDRAILS],
    applications: REQUIRED_APPLICATIONS.map((entry) => ({ ...entry })),
    coverage: {
      lifecycleStages: ['bid', 'award', 'design', 'procurement', 'fabrication', 'field-install', 'acceptance-itm', 'closeout-service'],
      crossCuttingDomains: ['project-management', 'finance-job-cost', 'licensing-safety', 'codes-ahj', 'catalog-products', 'internal-verification'],
      sourceCount: REQUIRED_SOURCES.length,
      appliedDecisionCount: REQUIRED_APPLICATIONS.length,
      status: 'passed',
    },
  };
}

export function validateHaloFireOperationalKnowledgeReceipt(value) {
  const issues = [];
  const sources = new Set(Array.isArray(value?.sources) ? value.sources : []);
  const guardrails = new Set(Array.isArray(value?.workflowGuardrails) ? value.workflowGuardrails : []);
  const applications = new Map((Array.isArray(value?.applications) ? value.applications : []).map((entry) => [entry?.id, entry]));
  const recallEpisodeIds = Array.isArray(value?.recallEpisodeIds) ? value.recallEpisodeIds : [];
  const recalledWikiPages = Array.isArray(value?.recalledWikiPages) ? value.recalledWikiPages : [];
  if (value?.artifactType !== 'halofire.operational-knowledge-receipt.v2'
    || value?.source !== 'gx10-hal-brain+obsidian-vault'
    || value?.canonicalVault !== '/opt/hal9000/apps/claudebot/hal-vault'
    || value?.preflightStatus !== 'passed'
    || typeof value?.sessionId !== 'string'
    || value.sessionId.length < 12
    || typeof value?.preflightQuery !== 'string'
    || !value.preflightQuery.includes('Halo Fire operations knowledge')
    || recallEpisodeIds.length < 4
    || recallEpisodeIds.some((episodeId) => !Number.isInteger(episodeId) || episodeId <= 0)
    || recalledWikiPages.length < 3
    || recalledWikiPages.some((page) => typeof page !== 'string' || !page.startsWith('decisions/'))) {
    issues.push(issue('HALOFIRE_OPERATIONAL_PREFLIGHT_INVALID', 'A passed GX10/Obsidian preflight with a durable session and recalled episodes is required.'));
  }
  for (const source of REQUIRED_SOURCES) {
    if (!sources.has(source)) issues.push(issue('HALOFIRE_OPERATIONAL_SOURCE_MISSING', `Required Halo Fire operations source is missing: ${source}`, [source]));
  }
  for (const guardrail of REQUIRED_GUARDRAILS) {
    if (!guardrails.has(guardrail)) issues.push(issue('HALOFIRE_OPERATIONAL_GUARDRAIL_MISSING', `Required operational guardrail is missing: ${guardrail}`, [guardrail]));
  }
  for (const required of REQUIRED_APPLICATIONS) {
    const actual = applications.get(required.id);
    if (!actual || actual.domain !== required.domain || actual.source !== required.source
      || actual.decision !== required.decision || actual.control !== required.control) {
      issues.push(issue('HALOFIRE_OPERATIONAL_APPLICATION_MISSING', `Operational knowledge is not executable for ${required.id}.`, [required.id, required.source]));
    }
  }
  const stages = new Set(Array.isArray(value?.coverage?.lifecycleStages) ? value.coverage.lifecycleStages : []);
  const requiredStages = ['bid', 'award', 'design', 'procurement', 'fabrication', 'field-install', 'acceptance-itm', 'closeout-service'];
  if (value?.coverage?.status !== 'passed'
    || value?.coverage?.sourceCount !== REQUIRED_SOURCES.length
    || value?.coverage?.appliedDecisionCount !== REQUIRED_APPLICATIONS.length
    || requiredStages.some((stage) => !stages.has(stage))) {
    issues.push(issue('HALOFIRE_OPERATIONAL_COVERAGE_INCOMPLETE', 'The brain receipt must cover the complete Halo Fire lifecycle and every required applied decision.'));
  }
  return {
    status: issues.length ? 'blocked' : 'passed',
    issues,
    knowledge: issues.length ? null : value,
    sourceCount: sources.size,
    appliedDecisionCount: applications.size,
    lifecycleStageCount: stages.size,
    operationalKnowledgeGrounded: issues.length === 0,
  };
}

export const HALOFIRE_OPERATIONAL_KNOWLEDGE_REQUIREMENTS = Object.freeze({
  sources: REQUIRED_SOURCES,
  guardrails: REQUIRED_GUARDRAILS,
  applications: REQUIRED_APPLICATIONS,
});

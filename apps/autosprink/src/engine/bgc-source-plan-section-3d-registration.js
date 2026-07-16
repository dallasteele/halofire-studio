import { sha256Hex } from './elevation-datums.js'

const PROJECT_ID = 'boys-girls-club-community-center-brigham-city-ut'
const SOURCES = Object.freeze({
  architectural: [
    'f220c7841dfd1ca7fc0b8eaf8f440d0b63a1541b8228c7c006e4c44a88180b20',
    18178437,
    'A301',
    15,
  ],
  ahjApproved: [
    '799fba69311eb3aa285d6b96cb346aed184b3093d73777737597d23df60a0a18',
    5313661,
    'FP 1.0',
    3,
  ],
  asBuilt: [
    '6f20b0ad824aaae6a8a71fac46e5faf89e5904eef0ad762cf98b8d0ed186b252',
    14918460,
    'FP 1.0',
    3,
  ],
  listingPlan: [
    '6f20b0ad824aaae6a8a71fac46e5faf89e5904eef0ad762cf98b8d0ed186b252',
    14918460,
    'FP 1.0',
    3,
  ],
  nativeFab: [
    '8968b6865194af5c5b64fed81c221958c9fa1c9974754c3e08dd91f0dfc22a52',
    16800,
    'Project.seidb',
    null,
  ],
  fabricationList: [
    '7fe066904709725abd407c786b28b87e2b34dbc3071dcf6462b66d11f7e7d141',
    862711,
    'Fabrication Report',
    [7, 8, 9, 10, 11, 18],
  ],
})
const SHA = /^[0-9a-f]{64}$/
const near = (actual, expected, tolerance = 1e-6) =>
  Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance
const issue = (code, message) => ({ severity: 'blocking', code, message })
const same = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)

function validateSources(packet, issues) {
  for (const [role, [sha256, bytes, sheet, physicalPage]] of Object.entries(SOURCES)) {
    const source = packet.sourceBindings?.[role]
    if (
      !source ||
      source.sha256 !== sha256 ||
      source.bytes !== bytes ||
      source.sheet !== sheet ||
      !same(source.physicalPage, physicalPage)
    ) {
      issues.push(issue('BGC_SOURCE_3D_SOURCE_DRIFT', `${role} source binding changed.`))
    }
  }
}

function validateDetectors(packet, issues) {
  const asBuilt = packet.detectors?.asBuilt
  if (
    asBuilt?.pageDrawingCount !== 21076 ||
    asBuilt?.guardedUprightCount !== 64 ||
    asBuilt?.signature?.rectWidthPt !== 9 ||
    asBuilt?.signature?.rectHeightPt !== 8.875 ||
    asBuilt?.signature?.itemCount !== 25 ||
    asBuilt?.signature?.itemKinds !== 'l'.repeat(25) ||
    asBuilt?.signature?.strokeWidthPt !== 0.4 ||
    !same(asBuilt?.signature?.color, [0, 0, 0])
  ) {
    issues.push(
      issue(
        'BGC_SOURCE_3D_ASBUILT_SIGNATURE_DRIFT',
        'As-built native guarded-upright signature or 64-count changed.',
      ),
    )
  }
  const approved = packet.detectors?.ahjApproved
  if (
    approved?.pageDrawingCount !== 87907 ||
    approved?.guardedUprightCount !== 64 ||
    approved?.signature?.itemCount !== 8 ||
    approved?.signature?.itemKinds !== 'llcllcll' ||
    !same(approved?.signature?.regionPdf, [1100, 1300, 1900, 2250])
  ) {
    issues.push(
      issue(
        'BGC_SOURCE_3D_APPROVED_SIGNATURE_DRIFT',
        'Approved-plan independent signature or 64-count changed.',
      ),
    )
  }
  if (
    packet.detectors?.approvedToAsBuiltParity?.status !== 'passed' ||
    packet.detectors?.approvedToAsBuiltParity?.headCountMatched !== true ||
    packet.detectors?.approvedToAsBuiltParity?.topologyFamilyMatched !== true ||
    packet.detectors?.approvedToAsBuiltParity?.coordinateParityClaimed !== false
  ) {
    issues.push(
      issue(
        'BGC_SOURCE_3D_CROSS_SOURCE_PARITY_DRIFT',
        'Approved-to-as-built topology parity changed or coordinate parity was falsely promoted.',
      ),
    )
  }
  const feed = packet.detectors?.branchFeedAxis
  if (
    feed?.segmentCount !== 16 ||
    feed?.branchFeedCount !== 8 ||
    !same(feed?.signature?.strokeColor, [1, 0.50197, 0]) ||
    !near(feed?.signature?.strokeWidthPt, 1.03383) ||
    !near(feed?.signature?.segmentLengthPt, 2.0625) ||
    !near(feed?.signature?.axisYPdfPt, 1488.839599609375)
  ) {
    issues.push(
      issue(
        'BGC_SOURCE_3D_FEED_SIGNATURE_DRIFT',
        'Native branch-feed half-offset stroke signature changed.',
      ),
    )
  }
  const main = packet.detectors?.crossMainPlan
  if (
    !same(main?.pieceLabelsObserved, ['#E.09', '#E.10', '#E.11', '#E.12', '#E.13', '#E.14']) ||
    main?.nativeBoundarySegmentCount !== 4 ||
    !same(
      main?.registeredGymSpanPdfPt,
      [792.5359497070312, 1488.861328125, 1632.535888671875, 1488.861328125],
    )
  ) {
    issues.push(
      issue(
        'BGC_SOURCE_3D_CROSS_MAIN_SIGNATURE_DRIFT',
        'Native BGC cross-main labels, boundary signature, or gym span changed.',
      ),
    )
  }
}

function validateRegistration(packet, issues) {
  const plan = packet.registration?.plan
  const envelope = packet.registration?.envelope
  const section = packet.registration?.section
  const expectedGrids = {
    2: 744.5359497070312,
    3: 978.5359497070312,
    4: 1212.5359497070312,
    5: 1446.5359497070312,
    6: 1680.5359497070312,
  }
  if (
    !same(plan?.gridXPdfPt, expectedGrids) ||
    plan?.grid2To6SpanPt !== 936 ||
    plan?.grid2To6SpanFt !== 104 ||
    plan?.pdfPointsPerFt !== 9 ||
    !near(plan?.ridgeYPdfPt, 1488.861328125)
  ) {
    issues.push(
      issue(
        'BGC_SOURCE_3D_PLAN_REGISTRATION_DRIFT',
        'Grid 2-6, scale, or ridge registration changed.',
      ),
    )
  }
  if (
    envelope?.lengthFt !== 104 ||
    envelope?.widthFt !== 89.5 ||
    envelope?.floorElevationFt !== 100 ||
    envelope?.eaveElevationFt !== 25 ||
    envelope?.ridgeElevationFt !== 32.458333 ||
    envelope?.pitchRiseInPer12 !== 2
  ) {
    issues.push(
      issue(
        'BGC_SOURCE_3D_ENVELOPE_DRIFT',
        'BGC architectural envelope or elevation datum changed.',
      ),
    )
  }
  if (
    !same(section?.leftEavePdfPoint, [82.08, 332.16]) ||
    !same(section?.ridgePdfPoint, [202.32, 312.12]) ||
    !same(section?.rightEavePdfPoint, [322.56, 332.16]) ||
    !near(section?.leftSlopeRisePerRun, 1 / 6) ||
    !near(section?.rightSlopeRisePerRun, 1 / 6) ||
    section?.nativeVectorPitchVerified !== true
  ) {
    issues.push(
      issue('BGC_SOURCE_3D_SECTION_VECTOR_DRIFT', 'Native A301 2:12 roof vectors changed.'),
    )
  }
  const offset = plan?.branchHalfOffset
  if (
    !Array.isArray(offset?.upperHalfXPt) ||
    offset.upperHalfXPt.length !== 8 ||
    !Array.isArray(offset?.lowerHalfXPt) ||
    offset.lowerHalfXPt.length !== 8 ||
    !Array.isArray(offset?.lowerMinusUpperOffsetsPt) ||
    offset.lowerMinusUpperOffsetsPt.length !== 8 ||
    !near(offset?.meanOffsetPt, 4.162476) ||
    offset?.maxOffsetResidualPt > 0.001
  ) {
    issues.push(
      issue(
        'BGC_SOURCE_3D_BRANCH_OFFSET_DRIFT',
        'Source-observed branch-half shift changed or was normalized away.',
      ),
    )
  }
  const main = plan?.crossMain
  if (
    !near(main?.planAxisYPdfPt, 1488.861328125) ||
    !near(main?.registeredGymSpanFt, 93.333327) ||
    main?.fullLinePieceOrderVerified !== false ||
    main?.pieceBoundaryCoordinatesVerified !== false
  ) {
    issues.push(
      issue(
        'BGC_SOURCE_3D_CROSS_MAIN_REGISTRATION_DRIFT',
        'Cross-main registered gym axis or its fail-closed piece boundary changed.',
      ),
    )
  }
}

function findPiece(group, name) {
  return group?.pieces?.find((piece) => piece.pieceName === name)
}

function validateFabrication(packet, issues) {
  const fab = packet.fabricationEvidence
  if (
    fab?.archiveSha256 !== SOURCES.nativeFab[0] ||
    fab?.projectSeidbSha256 !==
      '9f8a3b06597c94dfafb39aa2fc970a82073b04433420472e0845addf48a78ea9' ||
    fab?.projectSeidbBytes !== 44394 ||
    !same(fab?.recordCounts, { pipes: 121, lines: 20, outlets: 87, fittings: 50, hangers: 22 })
  ) {
    issues.push(
      issue(
        'BGC_SOURCE_3D_FAB_IDENTITY_DRIFT',
        'Native FAB archive, Project.seidb, or typed-row counts changed.',
      ),
    )
  }
  const groups = fab?.lineGroups || {}
  const groupShape = [
    ['#E', 1, 16],
    ['#05', 1, 11],
    ['#06', 8, 2],
    ['#10', 7, 4],
  ]
  for (const [name, quantity, pieceCount] of groupShape) {
    if (
      groups[name]?.lineName !== name ||
      groups[name]?.quantity !== quantity ||
      groups[name]?.pieces?.length !== pieceCount
    ) {
      issues.push(issue('BGC_SOURCE_3D_FAB_LINE_DRIFT', `${name} native fabrication line changed.`))
    }
  }
  const requiredPieces = [
    [groups['#E'], '.09', 25, 19.541666666666664],
    [groups['#E'], '.10', 25, 21],
    [groups['#E'], '.11', 25, 21],
    [groups['#E'], '.12', 25, 21],
    [groups['#E'], '.13', 25, 21],
    [groups['#E'], '.14', 25, 2.25],
    [groups['#06'], 'T-1', 15, 12.958333333333332],
    [groups['#06'], 'T-2', 15, 21],
    [groups['#10'], 'T-3', 15, 3.833333333333333],
    [groups['#10'], 'T-4', 15, 17.25],
    [groups['#10'], 'T-5', 15, 0.375],
  ]
  for (const [group, pieceName, sizeCode, lengthFt] of requiredPieces) {
    const piece = findPiece(group, pieceName)
    if (
      !piece ||
      piece.sizeCode !== sizeCode ||
      !near(piece.lengthFt, lengthFt) ||
      piece.endCode1 !== 3 ||
      piece.endCode2 !== 3
    ) {
      issues.push(
        issue(
          'BGC_SOURCE_3D_FAB_PIECE_DRIFT',
          `${group?.lineName || 'unknown'}.${pieceName} native size, length, or end prep changed.`,
        ),
      )
    }
  }
  if (
    !same(fab?.sizeCodeCrosswalk?.['15'], {
      nominalDiameterIn: 1.25,
      schedule: 10,
      source: 'BGC_LIST.PDF physical page 18',
    }) ||
    !same(fab?.sizeCodeCrosswalk?.['25'], {
      nominalDiameterIn: 3,
      schedule: 10,
      source: 'BGC_LIST.PDF physical pages 9-11',
    }) ||
    fab?.nativeAttachmentGraphVerified !== true
  ) {
    issues.push(
      issue(
        'BGC_SOURCE_3D_FAB_CROSSWALK_DRIFT',
        'Native size-code crosswalk or attachment graph changed.',
      ),
    )
  }
  if (
    fab?.interPieceAdjacencyVerified !== false ||
    fab?.exactFittingTakeoutVerified !== false ||
    fab?.manufacturerPartSolidVerified !== false ||
    fab?.exactBracketGeometryVerified !== false ||
    fab?.exactThreadGeometryVerified !== false ||
    fab?.threadEngagementAndToleranceVerified !== false ||
    fab?.matingFitVerified !== false
  ) {
    issues.push(
      issue(
        'BGC_SOURCE_3D_FAB_FALSE_PROMOTION',
        'Unproven FAB adjacency, fitting takeout, manufacturer solid, thread, or mating fit was promoted.',
      ),
    )
  }
}

function validateGraph(packet, issues) {
  const graph = packet.geometryGraph
  const nodes = graph?.nodes || []
  const edges = graph?.edges || []
  if (
    graph?.nodeCount !== 90 ||
    nodes.length !== 90 ||
    graph?.edgeCount !== 89 ||
    edges.length !== 89 ||
    !SHA.test(graph?.digestSha256 || '')
  ) {
    issues.push(
      issue('BGC_SOURCE_3D_GRAPH_SHAPE_DRIFT', 'Canonical 90-node/89-edge source graph changed.'),
    )
  }
  const ids = new Set(nodes.map((node) => node.id))
  if (ids.size !== 90)
    issues.push(
      issue('BGC_SOURCE_3D_NODE_ID_DUPLICATE', 'Canonical graph node identities are not unique.'),
    )
  for (const node of nodes) {
    const [pdfX, pdfY] = node.planPdfPoint || []
    const expectedAlong = (pdfX - 744.5359497070312) / 9
    const expectedAcross = (pdfY - 1488.861328125) / 9
    const expectedZ = 32.458333 - (Math.abs(expectedAcross) * 2) / 12
    if (
      !near(node.planPointFt?.[0], expectedAlong) ||
      !near(node.planPointFt?.[1], expectedAcross) ||
      !near(node.roofSurfaceTargetElevationFt, expectedZ) ||
      node.targetOnly !== true ||
      node.exactInstalledElevationVerified !== false
    ) {
      issues.push(
        issue(
          'BGC_SOURCE_3D_NODE_COORDINATE_DRIFT',
          `${node.id || 'unknown'} no longer closes to source plan/roof target geometry.`,
        ),
      )
    }
  }
  for (let branch = 1; branch <= 8; branch += 1) {
    const branchNodes = nodes
      .filter((node) => node.branchIndex === branch && node.id.startsWith('BGC-H-'))
      .sort((a, b) => a.acrossSlopePosition - b.acrossSlopePosition)
    if (
      branchNodes.length !== 8 ||
      branchNodes.some((node, index) => node.acrossSlopePosition !== index + 1)
    ) {
      issues.push(
        issue(
          'BGC_SOURCE_3D_BRANCH_MEMBERSHIP_DRIFT',
          `Branch ${branch} is not an eight-head source family.`,
        ),
      )
    }
    for (const start of [1, 2, 3, 5, 6, 7]) {
      const from = `BGC-H-${String(branch).padStart(2, '0')}-${String(start).padStart(2, '0')}`
      const to = `BGC-H-${String(branch).padStart(2, '0')}-${String(start + 1).padStart(2, '0')}`
      const edge = edges.find((candidate) => candidate.from === from && candidate.to === to)
      if (
        !edge ||
        edge.kind !== 'source-proven-branch-half' ||
        edge.sourceVectorCoverageVerified !== true ||
        edge.pipeSizeVerified !== true ||
        edge.nominalDiameterIn !== 1.25 ||
        edge.schedule !== 10 ||
        edge.endPreparation !== 'grooved' ||
        edge.pipeDirectionVerified !== false ||
        edge.pipeGradeVerified !== false ||
        edge.exactInstalledElevationVerified !== false
      ) {
        issues.push(
          issue(
            'BGC_SOURCE_3D_EDGE_TOPOLOGY_DRIFT',
            `${from} to ${to} is not a source-covered, sized, fail-closed branch edge.`,
          ),
        )
      }
    }
    const suffix = String(branch).padStart(2, '0')
    const requiredFeedPairs = [
      [`BGC-H-${suffix}-04`, `BGC-BF-${suffix}-N`],
      [`BGC-BF-${suffix}-N`, `BGC-CM-J${suffix}`],
      [`BGC-CM-J${suffix}`, `BGC-BF-${suffix}-S`],
      [`BGC-BF-${suffix}-S`, `BGC-H-${suffix}-05`],
    ]
    for (const [from, to] of requiredFeedPairs) {
      const edge = edges.find((candidate) => candidate.from === from && candidate.to === to)
      if (
        !edge?.kind.includes('branch-feed') ||
        edge.pipeSizeVerified !== true ||
        edge.nominalDiameterIn !== 1.25 ||
        edge.schedule !== 10 ||
        edge.exactFittingIdentityVerified !== false ||
        edge.pipeDirectionVerified !== false ||
        edge.pipeGradeVerified !== false ||
        edge.exactInstalledElevationVerified !== false
      ) {
        issues.push(
          issue(
            'BGC_SOURCE_3D_FEED_TOPOLOGY_DRIFT',
            `${from} to ${to} is not a source-bound fail-closed branch-feed edge.`,
          ),
        )
      }
    }
  }
  const mainChain = [
    'BGC-CM-W',
    ...Array.from({ length: 8 }, (_, index) => `BGC-CM-J${String(index + 1).padStart(2, '0')}`),
    'BGC-CM-E',
  ]
  for (let index = 0; index < mainChain.length - 1; index += 1) {
    const edge = edges.find(
      (candidate) => candidate.from === mainChain[index] && candidate.to === mainChain[index + 1],
    )
    if (
      !edge ||
      edge.kind !== 'source-registered-gym-cross-main-axis' ||
      edge.fabricationLineName !== '#E' ||
      edge.nominalDiameterIn !== 3 ||
      edge.schedule !== 10 ||
      edge.endPreparation !== 'grooved' ||
      edge.pipeSizeVerified !== true ||
      edge.pieceIdentityVerified !== false ||
      edge.pipeDirectionVerified !== false ||
      edge.pipeGradeVerified !== false ||
      edge.exactFittingIdentityVerified !== false ||
      edge.exactInstalledElevationVerified !== false
    ) {
      issues.push(
        issue(
          'BGC_SOURCE_3D_CROSS_MAIN_TOPOLOGY_DRIFT',
          `${mainChain[index]} to ${mainChain[index + 1]} cross-main edge changed.`,
        ),
      )
    }
  }
}

export async function validateBgcSourcePlanSection3dRegistration(packet) {
  const issues = []
  if (
    packet?.artifactType !== 'halofire.bgc-source-plan-section-3d-registration.v1' ||
    packet?.projectId !== PROJECT_ID
  ) {
    return {
      status: 'blocked',
      issues: [
        issue('BGC_SOURCE_3D_IDENTITY_INVALID', 'BGC source registration identity is invalid.'),
      ],
      sourcePlanCoordinatesVerified: false,
      complianceReady: false,
    }
  }
  const { receiptSha256, ...draft } = packet
  if (!SHA.test(receiptSha256 || '') || (await sha256Hex(draft)) !== receiptSha256)
    issues.push(issue('BGC_SOURCE_3D_RECEIPT_MISMATCH', 'Registration receipt changed.'))
  validateSources(packet, issues)
  validateDetectors(packet, issues)
  validateRegistration(packet, issues)
  validateFabrication(packet, issues)
  validateGraph(packet, issues)
  if (
    (await sha256Hex({
      nodes: packet.geometryGraph?.nodes,
      edges: packet.geometryGraph?.edges,
    })) !== packet.geometryGraph?.digestSha256
  )
    issues.push(issue('BGC_SOURCE_3D_GRAPH_DIGEST_DRIFT', 'Canonical source graph digest changed.'))
  const network = packet.networkRegistration
  if (
    network?.branchFeedCount !== 8 ||
    network?.crossMainJunctionCount !== 8 ||
    network?.crossMainGraphEdgeCount !== 9 ||
    network?.planTopologyVerified !== true ||
    network?.exactInterPieceFabricationAdjacencyVerified !== false ||
    network?.exactFittingIdentityVerified !== false ||
    network?.pipeDirectionVerified !== false ||
    network?.pipeGradeVerified !== false ||
    network?.exactInstalledElevationVerified !== false
  )
    issues.push(
      issue(
        'BGC_SOURCE_3D_NETWORK_REGISTRATION_DRIFT',
        'Network registration or its fail-closed boundary changed.',
      ),
    )
  const viewDigests = Object.values(packet.viewBindings || {}).map(
    (view) => view.geometryGraphSha256,
  )
  if (
    viewDigests.length !== 3 ||
    viewDigests.some((digest) => digest !== packet.geometryGraph?.digestSha256) ||
    packet.viewBindings?.topPlan?.source !== 'asBuilt' ||
    packet.viewBindings?.elevation?.source !== 'architectural' ||
    !packet.viewBindings?.model3d?.sourceTexture?.endsWith('bgc-plan-source.png')
  )
    issues.push(
      issue(
        'BGC_SOURCE_3D_VIEW_BINDING_DRIFT',
        'Top, elevation, and 3D views no longer share the canonical graph and real source underlays.',
      ),
    )
  if (
    packet.internalVerification?.primary?.status !== 'passed' ||
    packet.internalVerification?.crossSource?.status !== 'passed' ||
    packet.internalVerification?.adversarial?.status !== 'passed'
  )
    issues.push(
      issue(
        'BGC_SOURCE_3D_LOOPS_INCOMPLETE',
        'Primary, cross-source, and adversarial loops must pass.',
      ),
    )
  if (
    packet.sourcePlanCoordinatesVerified !== true ||
    packet.sourceBranchHalfAdjacencyVerified !== true ||
    packet.sourceBranchFeedTopologyVerified !== true ||
    packet.sourceCrossMainPlanAxisVerified !== true ||
    packet.pipeSizeVerified !== true ||
    packet.roofSurfaceTargetProjectionVerified !== true ||
    packet.exactInstalledSprinklerElevationVerified !== false ||
    packet.exactInstalledPipeElevationVerified !== false ||
    packet.exactCrossMainPieceOrderVerified !== false ||
    packet.exactFittingTakeoutVerified !== false ||
    packet.manufacturerPartSolidVerified !== false ||
    packet.exactBracketGeometryVerified !== false ||
    packet.exactThreadGeometryVerified !== false ||
    packet.threadEngagementAndToleranceVerified !== false ||
    packet.matingFitVerified !== false ||
    packet.pipeDirectionVerified !== false ||
    packet.pipeGradeVerified !== false ||
    packet.hydraulicCalculationReady !== false ||
    packet.complianceReady !== false ||
    packet.fabricationReady !== false ||
    packet.fieldReleaseReady !== false ||
    packet.vpsReleaseReady !== false
  ) {
    issues.push(
      issue(
        'BGC_SOURCE_3D_FALSE_PROMOTION',
        'Unproven piece order, takeout, part solid, thread, mating fit, installed Z, direction, grade, compliance, fabrication, field, or VPS claim changed.',
      ),
    )
  }
  const passed = issues.length === 0
  return {
    status: passed ? 'passed' : 'blocked',
    issues,
    sourcePlanCoordinatesVerified: passed,
    sourceBranchHalfAdjacencyVerified: passed,
    sourceBranchFeedTopologyVerified: passed,
    sourceCrossMainPlanAxisVerified: passed,
    pipeSizeVerified: passed,
    exactInstalledPipeElevationVerified: false,
    pipeDirectionVerified: false,
    pipeGradeVerified: false,
    complianceReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
    vpsReleaseReady: false,
  }
}

export async function verifyBgcSourcePlanSection3dAdversarialLoop(packet) {
  const cases = [
    [
      'asbuilt-hash',
      (value) => {
        value.sourceBindings.asBuilt.sha256 = '0'.repeat(64)
      },
    ],
    [
      'fab-hash',
      (value) => {
        value.sourceBindings.nativeFab.sha256 = '0'.repeat(64)
      },
    ],
    [
      'fab-member-hash',
      (value) => {
        value.fabricationEvidence.projectSeidbSha256 = '0'.repeat(64)
      },
    ],
    [
      'fab-count',
      (value) => {
        value.fabricationEvidence.recordCounts.pipes = 120
      },
    ],
    [
      'fab-piece-length',
      (value) => {
        value.fabricationEvidence.lineGroups['#E'].pieces.find(
          (piece) => piece.pieceName === '.09',
        ).lengthFt += 1
      },
    ],
    [
      'size-crosswalk',
      (value) => {
        value.fabricationEvidence.sizeCodeCrosswalk['25'].nominalDiameterIn = 2
      },
    ],
    [
      'feed-signature',
      (value) => {
        value.detectors.branchFeedAxis.segmentCount = 15
      },
    ],
    [
      'crossmain-label',
      (value) => {
        value.detectors.crossMainPlan.pieceLabelsObserved.pop()
      },
    ],
    [
      'branch-offset',
      (value) => {
        value.registration.plan.branchHalfOffset.meanOffsetPt = 0
      },
    ],
    [
      'pitch',
      (value) => {
        value.registration.envelope.pitchRiseInPer12 = 3
      },
    ],
    [
      'node-coordinate',
      (value) => {
        value.geometryGraph.nodes[0].planPointFt[0] += 1
      },
    ],
    [
      'edge-removal',
      (value) => {
        value.geometryGraph.edges.pop()
        value.geometryGraph.edgeCount -= 1
      },
    ],
    [
      'edge-size',
      (value) => {
        value.geometryGraph.edges[0].nominalDiameterIn = 2
      },
    ],
    [
      'main-piece-promotion',
      (value) => {
        value.exactCrossMainPieceOrderVerified = true
      },
    ],
    [
      'fitting-takeout-promotion',
      (value) => {
        value.exactFittingTakeoutVerified = true
      },
    ],
    [
      'part-solid-promotion',
      (value) => {
        value.manufacturerPartSolidVerified = true
      },
    ],
    [
      'bracket-geometry-promotion',
      (value) => {
        value.exactBracketGeometryVerified = true
      },
    ],
    [
      'thread-promotion',
      (value) => {
        value.exactThreadGeometryVerified = true
      },
    ],
    [
      'thread-engagement-tolerance-promotion',
      (value) => {
        value.threadEngagementAndToleranceVerified = true
      },
    ],
    [
      'mating-fit-promotion',
      (value) => {
        value.matingFitVerified = true
      },
    ],
    [
      'direction-promotion',
      (value) => {
        value.pipeDirectionVerified = true
      },
    ],
    [
      'grade-promotion',
      (value) => {
        value.pipeGradeVerified = true
      },
    ],
    [
      'installed-z-promotion',
      (value) => {
        value.exactInstalledPipeElevationVerified = true
      },
    ],
    [
      'fabrication-promotion',
      (value) => {
        value.fabricationReady = true
      },
    ],
    [
      'view-graph',
      (value) => {
        value.viewBindings.model3d.geometryGraphSha256 = '1'.repeat(64)
      },
    ],
    [
      'release-promotion',
      (value) => {
        value.vpsReleaseReady = true
      },
    ],
    [
      'receipt',
      (value) => {
        value.receiptSha256 = 'f'.repeat(64)
      },
    ],
  ]
  const rejectedCases = []
  for (const [id, mutate] of cases) {
    const value = structuredClone(packet)
    mutate(value)
    if ((await validateBgcSourcePlanSection3dRegistration(value)).status === 'blocked')
      rejectedCases.push(id)
  }
  return {
    status: rejectedCases.length === cases.length ? 'passed' : 'blocked',
    attemptedCases: cases.length,
    rejectedCases,
    sourcePlanCoordinatesVerified: rejectedCases.length === cases.length,
    sourceBranchFeedTopologyVerified: rejectedCases.length === cases.length,
    sourceCrossMainPlanAxisVerified: rejectedCases.length === cases.length,
    pipeSizeVerified: rejectedCases.length === cases.length,
    exactInstalledPipeElevationVerified: false,
    pipeDirectionVerified: false,
    pipeGradeVerified: false,
    complianceReady: false,
    vpsReleaseReady: false,
  }
}

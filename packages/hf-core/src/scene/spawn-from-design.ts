/**
 * translateDesignToScene — pure, stateless scene-spawn translator.
 *
 * Extracted from `apps/editor/components/halofire/AutoDesignPanel.tsx`
 * (R2.1 per docs/IMPLEMENTATION_PLAN.md). This module takes a
 * pipeline-produced `Design` (the parsed `design.json` emitted by
 * `services/halofire-cad/agents/`) and returns an ordered
 * `NodeCreateOp[]` — the sequence of typed Pascal nodes that
 * AutoDesignPanel would otherwise spawn one `createNode()` call at a
 * time.
 *
 * Contract:
 *   - Pure TypeScript. No `three.js`, no React, no Pascal store,
 *     no DOM.
 *   - Emits FIRST-CLASS Pascal node types — SprinklerHeadNode,
 *     PipeNode, FittingNode, HangerNode, DeviceNode, FDCNode,
 *     RiserAssemblyNode, RemoteAreaNode, ObstructionNode,
 *     SlabNode, CeilingNode, WallNode, LevelNode, BuildingNode,
 *     SiteNode, SystemNode — NOT tagged ItemNodes.
 *   - Blueprint 09 §3.1 / §7.1 ordering:
 *       Site → Building → Level(s) → Slab + Ceiling + Walls +
 *       Column Obstructions → System(s) → RiserAssembly → Pipes →
 *       Fittings → Hangers → SprinklerHeads → Devices → RemoteArea.
 *   - `max_heads` / `max_pipes` hard caps (default 150 each) trim
 *     overflow — viewport performance guard until R3 GPU
 *     instancing lands.
 *
 * The raw design-side shapes (levels, systems, heads, pipes) are
 * defined structurally here so `@halofire/core` stays free of the
 * `@pascal-app/core` runtime dependency. Consumers provide a
 * `Design` that quacks like `packages/core/.../design.json`.
 */

// ------------------------------------------------------------------
// Pascal node ID helper
// ------------------------------------------------------------------

// Lightweight unique-id generator. We don't need the cryptographic
// strength of `nanoid`; `Math.random` + counter is plenty — the ids
// only need to be unique within the returned op list. Consumers who
// care about cross-session stability (e.g. corrections round-trip)
// rewrite ids after merge.
let __seq = 0
function nid(prefix: string): string {
  __seq++
  // 10 base36 chars ≈ 52 bits of entropy per call, more than enough
  // to avoid collision inside one spawn batch.
  const rnd = Math.random().toString(36).slice(2, 12).padEnd(10, '0')
  return `${prefix}_${rnd}${__seq.toString(36)}`
}

// ------------------------------------------------------------------
// Design input shape (subset of the pipeline's design.json)
// ------------------------------------------------------------------

export type Vec2 = [number, number]
export type Vec3 = [number, number, number]

export interface DesignObstruction {
  id: string
  kind: 'column' | 'beam' | 'duct' | 'joist' | 'equipment' | 'light' | 'diffuser'
  polygon_m?: Vec2[]
  bbox_min?: Vec3
  bbox_max?: Vec3
  bottom_z_m?: number
  top_z_m?: number
}

export interface DesignWall {
  id: string
  start_m: Vec2
  end_m: Vec2
  thickness_m?: number
  height_m?: number
  is_exterior?: boolean
}

export interface DesignLevel {
  id: string
  name: string
  elevation_m: number
  height_m?: number
  use?: string
  polygon_m?: Vec2[]
  walls?: DesignWall[]
  obstructions?: DesignObstruction[]
}

export interface DesignBuilding {
  id?: string
  name?: string
  levels?: DesignLevel[]
}

export interface DesignHead {
  id: string
  position_m: Vec3
  sku?: string
  k_factor?: number
  orientation?:
    | 'pendant'
    | 'upright'
    | 'sidewall_horizontal'
    | 'sidewall_vertical'
    | 'concealed_pendant'
    | 'dry_pendant'
    | 'dry_upright'
    | 'in_rack'
  temperature?: string
  response?: 'standard' | 'quick' | 'esfr' | 'special'
  coverage_area_ft2?: number
  branchId?: string
}

export interface DesignPipe {
  id: string
  size_in: number
  start_m: Vec3
  end_m: Vec3
  role?:
    | 'feed_main'
    | 'cross_main'
    | 'branch'
    | 'drop'
    | 'sprig'
    | 'riser_nipple'
    | 'riser'
    | 'standpipe'
    | 'feed'
    | 'unknown'
  schedule?: 'SCH10' | 'SCH40' | 'CPVC_BlazeMaster' | 'copper_M' | 'dyna_flow' | 'dyna_thread'
}

export interface DesignFitting {
  id: string
  kind:
    | 'tee'
    | 'elbow_90'
    | 'elbow_45'
    | 'cross'
    | 'reducer_concentric'
    | 'reducer_eccentric'
    | 'cap'
    | 'flange'
    | 'union'
    | 'nipple'
    | 'coupling'
  sku?: string
  size_in: number
  size_branch_in?: number
  connection_style?:
    | 'NPT_threaded'
    | 'grooved'
    | 'flanged_150'
    | 'flanged_300'
    | 'solvent_welded'
    | 'soldered'
  position_m?: Vec3
}

export interface DesignHanger {
  id: string
  kind:
    | 'clevis'
    | 'split_ring'
    | 'trapeze'
    | 'roller'
    | 'seismic_sway_lateral'
    | 'seismic_sway_longitudinal'
    | 'c_clamp_beam'
    | 'c_clamp_deck'
    | 'strap'
  sku?: string
  size_in: number
  pipe_id: string
  position_m?: Vec3
}

export interface DesignRiserAssembly {
  id: string
  location_description?: string
  position_m?: Vec3
  children_ids?: string[]
}

export interface DesignSystem {
  id: string
  name?: string
  kind?: 'wet' | 'dry' | 'preaction' | 'deluge' | 'combo_standpipe' | 'antifreeze'
  hazard?:
    | 'light'
    | 'ordinary_group_1'
    | 'ordinary_group_2'
    | 'extra_group_1'
    | 'extra_group_2'
    | 'storage'
  heads?: DesignHead[]
  pipes?: DesignPipe[]
  fittings?: DesignFitting[]
  hangers?: DesignHanger[]
  riser_assembly?: DesignRiserAssembly
  supply?: {
    static_psi: number
    residual_psi: number
    flow_gpm: number
    elevation_ft?: number
  }
}

export interface DesignDevice {
  id: string
  kind:
    | 'flow_switch_paddle'
    | 'flow_switch_vane'
    | 'tamper_switch_osy'
    | 'tamper_switch_pivy'
    | 'pressure_switch'
    | 'pressure_gauge'
    | 'temperature_switch'
    | 'water_motor_gong'
    | 'test_and_drain'
  sku?: string
  position_m?: Vec3
  attaches_to?: 'pipe' | 'valve' | 'riser' | 'wall'
  attaches_to_id?: string
  supervised?: boolean
}

export interface DesignFDC {
  id: string
  class_kind?:
    | 'stortz_5in'
    | 'stortz_2_5in_single'
    | 'stortz_2_5in_twin'
    | 'threaded_2_5in'
  position_m?: Vec3
  distance_to_hydrant_ft?: number
  height_above_grade_m?: number
}

export interface DesignRemoteArea {
  id: string
  polygon_m: Vec2[]
  hazard_class?:
    | 'light'
    | 'ordinary_group_1'
    | 'ordinary_group_2'
    | 'extra_group_1'
    | 'extra_group_2'
  is_most_remote?: boolean
  design_density_gpm_ft2?: number
  computed_area_ft2?: number
}

export interface Design {
  site_id?: string
  building?: DesignBuilding
  systems?: DesignSystem[]
  devices?: DesignDevice[]
  fdcs?: DesignFDC[]
  remote_areas?: DesignRemoteArea[]
}

// ------------------------------------------------------------------
// Op + options
// ------------------------------------------------------------------

export interface NodeCreateOp {
  /** Pascal AnyNode-compatible payload. `type` is the discriminator. */
  node: any
  /** Parent node id — matches `node` that appeared earlier in the op list
   *  (topologically sorted). Omitted for the root Site. */
  parentId?: string
}

export interface SpawnOptions {
  /** Reuse an existing SiteNode id if the caller already spawned one;
   *  when omitted, translateDesignToScene emits a fresh SiteNode. */
  site_id?: string
  /** Reuse an existing BuildingNode id; same semantics as site_id. */
  building_id?: string
  /** Hard cap on spawned viewport heads for performance. Default 150
   *  until R3 GPU instancing ships. */
  max_heads?: number
  /** Hard cap on spawned pipes. Default 150. */
  max_pipes?: number
}

// ------------------------------------------------------------------
// Geometry helpers (pure)
// ------------------------------------------------------------------

function bboxOf(pts: Vec2[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of pts) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return { minX, minY, maxX, maxY }
}

/** Signed area (positive = CCW in plan, negative = CW). */
function signedArea(pts: Vec2[]): number {
  let s = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i] as Vec2
    const b = pts[(i + 1) % pts.length] as Vec2
    s += a[0] * b[1] - b[0] * a[1]
  }
  return s / 2
}

/** Orient polygon CCW so Pascal's slab extrudes with normals UP. */
function ccwOrient(pts: Vec2[]): Vec2[] {
  return signedArea(pts) >= 0 ? pts.slice() : pts.slice().reverse()
}

// ------------------------------------------------------------------
// translateDesignToScene
// ------------------------------------------------------------------

/**
 * Walk a `Design` and emit a fully-ordered `NodeCreateOp[]`.
 *
 * Ordering (blueprint 09 §3.1/§7.1):
 *   1. Site (if missing)
 *   2. Building (child of Site)
 *   3. Per level:
 *        Level → Slab → Ceiling → Walls (perimeter + interior
 *        partitions) → Column Obstructions
 *   4. Systems (each a child of Building)
 *   5. Per System:
 *        RiserAssembly → Pipes → Fittings → Hangers → Heads
 *   6. Devices (global, parented to Building)
 *   7. FDC(s)
 *   8. RemoteArea(s)
 *
 * Parenting rules:
 *   - Slab/Ceiling/Wall/Obstruction parent → level id
 *   - Pipe/Fitting/Hanger/Head parent      → system id
 *   - RiserAssembly parent                 → system id
 *   - System/Device/FDC/RemoteArea parent  → building id
 *   - Level parent                         → building id
 *   - Building parent                      → site id
 *
 * All geometry is pass-through: we do NOT apply per-level centroid
 * shifts the AutoDesignPanel does at render time. Those belong to
 * the viewport projection layer (R2.2) — this function is the pure
 * data-level translator the blueprint wants.
 */
export function translateDesignToScene(
  design: Design,
  opts: SpawnOptions = {},
): NodeCreateOp[] {
  const maxHeads = opts.max_heads ?? 150
  const maxPipes = opts.max_pipes ?? 150
  const ops: NodeCreateOp[] = []

  // ---- 1. Site ----------------------------------------------------
  let siteId = opts.site_id
  if (!siteId) {
    siteId = nid('site')
    ops.push({
      node: {
        object: 'node',
        id: siteId,
        type: 'site',
        name: 'Site',
        parentId: null,
        polygon: {
          type: 'polygon',
          points: [
            [-15, -15],
            [15, -15],
            [15, 15],
            [-15, 15],
          ],
        },
        children: [],
        metadata: { tags: ['halofire', 'auto_design'] },
      },
    })
  }

  // ---- 2. Building ------------------------------------------------
  let buildingId = opts.building_id
  if (!buildingId) {
    buildingId = nid('building')
    ops.push({
      node: {
        object: 'node',
        id: buildingId,
        type: 'building',
        name: design.building?.name ?? 'Building',
        parentId: siteId,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        children: [],
        metadata: { tags: ['halofire', 'auto_design'] },
      },
      parentId: siteId,
    })
  }

  // Site polygon size = bbox of first level's polygon + padding
  const levels = design.building?.levels ?? []
  if (!opts.site_id && levels.length > 0 && levels[0]?.polygon_m?.length) {
    const firstPts = levels[0].polygon_m as Vec2[]
    const bb = bboxOf(firstPts)
    const halfW = Math.max((bb.maxX - bb.minX) / 2, 10)
    const halfH = Math.max((bb.maxY - bb.minY) / 2, 10)
    const PAD = 5
    // Rewrite the Site polygon emit in-place so the viewport ground
    // grid wraps the building instead of the default 30×30.
    const siteOp = ops.find((o) => o.node.id === siteId)
    if (siteOp) {
      siteOp.node.polygon = {
        type: 'polygon',
        points: [
          [-halfW - PAD, -halfH - PAD],
          [halfW + PAD, -halfH - PAD],
          [halfW + PAD, halfH + PAD],
          [-halfW - PAD, halfH + PAD],
        ],
      }
    }
  }

  // ---- 3. Levels (+ slab, ceiling, walls, obstructions) -----------
  // Map arch-level id → pascal-level id for parenting downstream
  // nodes (heads/pipes). Previously AutoDesignPanel stacked every
  // level at level=0 because a competing default level collapsed
  // the tree — here we assign sequential `level: idx` so
  // LevelSystem stacks bottom-up cleanly.
  const levelIdByArch: Record<string, string> = {}
  levels.forEach((lvl, idx) => {
    if (!lvl.polygon_m || lvl.polygon_m.length < 3) return

    const levelId = nid('level')
    levelIdByArch[lvl.id] = levelId

    ops.push({
      node: {
        object: 'node',
        id: levelId,
        type: 'level',
        name: lvl.name,
        parentId: buildingId,
        level: idx,
        children: [],
        metadata: { tags: ['halofire', 'level', 'auto_design'] },
      },
      parentId: buildingId,
    })

    // Slab — polygon is [x, z] LEVEL-LOCAL coords. `elevation` here is
    // SLAB THICKNESS (default 0.2 m for real concrete), NOT world Y.
    // Pinning to 0.2 m — 30 m-thick slabs are the bug this extraction fixes.
    const slabPoly = ccwOrient(lvl.polygon_m)
    const slabId = nid('slab')
    ops.push({
      node: {
        object: 'node',
        id: slabId,
        type: 'slab',
        name: `${lvl.name} slab`,
        parentId: levelId,
        polygon: slabPoly,
        holes: [],
        holeMetadata: [],
        elevation: 0.2, // slab thickness, NOT elevation_m
        autoFromWalls: false,
        metadata: { tags: ['halofire', 'slab', 'auto_design'] },
      },
      parentId: levelId,
    })

    // Ceiling — drives level height via Pascal's LevelSystem
    // getLevelHeight().
    const ceilingId = nid('ceiling')
    ops.push({
      node: {
        object: 'node',
        id: ceilingId,
        type: 'ceiling',
        name: `${lvl.name} ceiling`,
        parentId: levelId,
        children: [],
        polygon: slabPoly,
        holes: [],
        holeMetadata: [],
        height: lvl.height_m ?? 3.0,
        autoFromWalls: false,
        metadata: { tags: ['halofire', 'ceiling', 'auto_design'] },
      },
      parentId: levelId,
    })

    // Perimeter walls — one per slab edge. Skip < 0.5 m stubs.
    for (let i = 0; i < slabPoly.length; i++) {
      const a = slabPoly[i] as Vec2
      const b = slabPoly[(i + 1) % slabPoly.length] as Vec2
      const dx = b[0] - a[0]
      const dy = b[1] - a[1]
      if (dx * dx + dy * dy < 0.25) continue
      ops.push({
        node: {
          object: 'node',
          id: nid('wall'),
          type: 'wall',
          parentId: levelId,
          children: [],
          start: a,
          end: b,
          thickness: 0.2,
          height: lvl.height_m ?? 3.0,
          frontSide: 'exterior',
          backSide: 'interior',
          metadata: { tags: ['halofire', 'wall', 'auto_design', 'perimeter'] },
        },
        parentId: levelId,
      })
    }

    // Column Obstructions — axis-aligned bbox from the intake polygon.
    for (const o of lvl.obstructions ?? []) {
      if (o.kind !== 'column') continue
      let bbMin: Vec3
      let bbMax: Vec3
      if (o.bbox_min && o.bbox_max) {
        bbMin = o.bbox_min
        bbMax = o.bbox_max
      } else if (o.polygon_m && o.polygon_m.length >= 3) {
        const xs = o.polygon_m.map((p) => p[0])
        const ys = o.polygon_m.map((p) => p[1])
        bbMin = [Math.min(...xs), o.bottom_z_m ?? 0, Math.min(...ys)]
        bbMax = [Math.max(...xs), o.top_z_m ?? 3.0, Math.max(...ys)]
      } else {
        continue
      }
      ops.push({
        node: {
          object: 'node',
          id: nid('obstruction'),
          type: 'obstruction',
          parentId: levelId,
          kind: 'column',
          bbox_min: bbMin,
          bbox_max: bbMax,
          source: 'intake',
          metadata: { tags: ['halofire', 'obstruction', 'column', 'auto_design'] },
        },
        parentId: levelId,
      })
    }
  })

  // ---- 4. Systems -------------------------------------------------
  const systems = design.systems ?? []

  // Pre-count heads and pipes so the caps are applied deterministically
  // by insertion order across systems (not per-system).
  let headsEmitted = 0
  let pipesEmitted = 0

  for (const sys of systems) {
    const systemId = nid('system')
    ops.push({
      node: {
        object: 'node',
        id: systemId,
        type: 'system',
        name: sys.name ?? 'System',
        parentId: buildingId,
        kind: sys.kind ?? 'wet',
        hazard: sys.hazard ?? 'light',
        supply: sys.supply,
        riserPipeId: undefined,
        pipeIds: [],
        headIds: [],
        metadata: { tags: ['halofire', 'system', 'auto_design'] },
      },
      parentId: buildingId,
    })

    // ---- 5a. RiserAssembly ---------------------------------------
    if (sys.riser_assembly) {
      ops.push({
        node: {
          object: 'node',
          id: nid('riser_assembly'),
          type: 'riser_assembly',
          parentId: systemId,
          position: sys.riser_assembly.position_m ?? [0, 0, 0],
          rotation: [0, 0, 0],
          systemId,
          children_ids: sys.riser_assembly.children_ids ?? [],
          location_description: sys.riser_assembly.location_description,
          metadata: { tags: ['halofire', 'riser_assembly', 'auto_design'] },
        },
        parentId: systemId,
      })
    }

    // ---- 5b. Pipes (capped) --------------------------------------
    for (const p of sys.pipes ?? []) {
      if (pipesEmitted >= maxPipes) break
      ops.push({
        node: {
          object: 'node',
          id: nid('pipe'),
          type: 'pipe',
          parentId: systemId,
          start_m: p.start_m,
          end_m: p.end_m,
          size_in: p.size_in,
          schedule: p.schedule ?? 'SCH10',
          role: p.role ?? 'unknown',
          systemId,
          metadata: {
            tags: ['halofire', 'pipe', 'auto_design', `role_${p.role ?? 'unknown'}`],
          },
        },
        parentId: systemId,
      })
      pipesEmitted++
    }

    // ---- 5c. Fittings --------------------------------------------
    for (const f of sys.fittings ?? []) {
      ops.push({
        node: {
          object: 'node',
          id: nid('fitting'),
          type: 'fitting',
          parentId: systemId,
          position: f.position_m ?? [0, 0, 0],
          rotation: [0, 0, 0],
          sku: f.sku ?? `${f.kind}_${f.size_in}in`,
          kind: f.kind,
          size_in: f.size_in,
          size_branch_in: f.size_branch_in,
          connection_style: f.connection_style ?? 'grooved',
          port_connections: [],
          systemId,
          metadata: { tags: ['halofire', 'fitting', f.kind, 'auto_design'] },
        },
        parentId: systemId,
      })
    }

    // ---- 5d. Hangers ---------------------------------------------
    for (const h of sys.hangers ?? []) {
      ops.push({
        node: {
          object: 'node',
          id: nid('hanger'),
          type: 'hanger',
          parentId: systemId,
          position: h.position_m ?? [0, 0, 0],
          rotation: [0, 0, 0],
          sku: h.sku ?? `${h.kind}_${h.size_in}in`,
          kind: h.kind,
          pipe_id: h.pipe_id,
          size_in: h.size_in,
          metadata: { tags: ['halofire', 'hanger', h.kind, 'auto_design'] },
        },
        parentId: systemId,
      })
    }

    // ---- 5e. SprinklerHeads (capped) -----------------------------
    for (const head of sys.heads ?? []) {
      if (headsEmitted >= maxHeads) break
      ops.push({
        node: {
          object: 'node',
          id: nid('sprinkler_head'),
          type: 'sprinkler_head',
          parentId: systemId,
          position: head.position_m,
          rotation: [0, 0, 0],
          k_factor: head.k_factor ?? 5.6,
          sku: head.sku ?? 'K5.6 pendant',
          manufacturer: 'other',
          orientation: head.orientation ?? 'pendant',
          response: head.response ?? 'standard',
          temperature: head.temperature ?? 'ordinary_155F',
          coverage: {
            area_ft2: head.coverage_area_ft2 ?? 130,
            max_spacing_ft: 15,
            max_distance_from_wall_ft: 7.5,
          },
          systemId,
          branchId: head.branchId,
          metadata: { tags: ['halofire', 'sprinkler_head', 'auto_design'] },
        },
        parentId: systemId,
      })
      headsEmitted++
    }
  }

  // ---- 6. Devices -------------------------------------------------
  for (const d of design.devices ?? []) {
    ops.push({
      node: {
        object: 'node',
        id: nid('device'),
        type: 'device',
        parentId: buildingId,
        position: d.position_m ?? [0, 0, 0],
        rotation: [0, 0, 0],
        sku: d.sku ?? d.kind,
        kind: d.kind,
        attaches_to: d.attaches_to ?? 'pipe',
        attaches_to_id: d.attaches_to_id,
        supervised: d.supervised ?? true,
        metadata: { tags: ['halofire', 'device', d.kind, 'auto_design'] },
      },
      parentId: buildingId,
    })
  }

  // ---- 7. FDCs ----------------------------------------------------
  for (const fdc of design.fdcs ?? []) {
    ops.push({
      node: {
        object: 'node',
        id: nid('fdc'),
        type: 'fdc',
        parentId: buildingId,
        position: fdc.position_m ?? [0, 0, 0],
        rotation: [0, 0, 0],
        class_kind: fdc.class_kind ?? 'stortz_5in',
        distance_to_hydrant_ft: fdc.distance_to_hydrant_ft ?? 0,
        height_above_grade_m: fdc.height_above_grade_m,
        metadata: { tags: ['halofire', 'fdc', 'auto_design'] },
      },
      parentId: buildingId,
    })
  }

  // ---- 8. RemoteAreas --------------------------------------------
  for (const ra of design.remote_areas ?? []) {
    ops.push({
      node: {
        object: 'node',
        id: nid('remote_area'),
        type: 'remote_area',
        parentId: buildingId,
        polygon_m: ra.polygon_m,
        hazard_class: ra.hazard_class ?? 'light',
        computed_area_ft2: ra.computed_area_ft2,
        is_most_remote: ra.is_most_remote ?? false,
        design_density_gpm_ft2: ra.design_density_gpm_ft2,
        metadata: { tags: ['halofire', 'remote_area', 'auto_design'] },
      },
      parentId: buildingId,
    })
  }

  return ops
}

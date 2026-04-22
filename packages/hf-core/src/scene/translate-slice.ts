/**
 * translate-slice — stateless per-stage slice → scene-ops translator
 * for the streaming AutoPilot consumer.
 *
 * Blueprint 09 §3. Takes one StageEvent emitted by the halofire-cad
 * orchestrator and the current scene-store snapshot, and returns the
 * incremental `NodeCreateOp` / `NodeUpdateOp` / delete list that the
 * AutoPilot should merge into the scene to reflect what the stage
 * just produced.
 *
 * Design goals:
 *
 * 1. PURE. Inputs in → ops out. No scene-store imports, no I/O, no
 *    random IDs. Every node id is derived from the slice payload so
 *    re-applying the same slice twice emits the same ops (possibly
 *    updates rather than creates, but never duplicate creates).
 *
 * 2. TYPE-SAFE. The returned nodes are fully-typed `AnyNode` values —
 *    ready to feed into Pascal's scene store, zod-validated upstream.
 *
 * 3. INCREMENTAL. Unlike R2.1's spawn-from-design (full `Design` →
 *    ops), this consumes one slice at a time and preserves whatever
 *    already exists on the scene so partial streams don't clobber
 *    earlier stages.
 *
 * Per-stage behavior:
 *
 *   intake    → Site + Building + LevelNodes + SlabNodes + CeilingNodes
 *               + WallNodes (full structural skeleton).
 *   classify  → updates LevelNode.level (use is metadata only; we
 *               stash `use` + room hazards in node metadata).
 *   place     → SprinklerHeadNodes.
 *   route     → SystemNodes + PipeNodes + FittingNodes + HangerNodes.
 *   hydraulic → updates SystemNode.demand (no new creates).
 *   rulecheck → annotate existing nodes' metadata.issues (no creates).
 *   bom/labor/proposal/submittal/done → no scene ops.
 */

import type { AnyNode } from '@pascal-app/core/schema'

// ─── Op types ─────────────────────────────────────────────────────────

export interface NodeCreateOp {
  node: AnyNode
  parentId?: string
}

export interface NodeUpdateOp {
  id: string
  patch: Partial<AnyNode>
}

export interface SliceTranslation {
  creates: NodeCreateOp[]
  updates: NodeUpdateOp[]
  deletes: string[]
}

export interface StageEvent {
  step:
    | 'intake'
    | 'classify'
    | 'place'
    | 'route'
    | 'hydraulic'
    | 'rulecheck'
    | 'bom'
    | 'labor'
    | 'proposal'
    | 'submittal'
    | 'done'
  done?: boolean
  slice?: Record<string, unknown>
  // Stage events also carry aggregate stats (head_count, line_items, …).
  [k: string]: unknown
}

// ─── Deterministic id helpers ─────────────────────────────────────────

/**
 * Normalize a Python-side id (e.g. `head_001`, `h_a_001`) to the Pascal
 * `{prefix}_{rest}` template-literal form. Re-normalization is a no-op:
 *   normId('sprinkler_head', 'head_001')        → 'sprinkler_head_head_001'
 *   normId('sprinkler_head', 'sprinkler_head_x')→ 'sprinkler_head_x' (already prefixed)
 */
function normId(prefix: string, raw: string | undefined | null, fallback: string): string {
  const src = typeof raw === 'string' && raw.length > 0 ? raw : fallback
  return src.startsWith(`${prefix}_`) ? src : `${prefix}_${src}`
}

// ─── Small type helpers ──────────────────────────────────────────────

type PyObj = Record<string, unknown>

const isObj = (v: unknown): v is PyObj =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const asArr = (v: unknown): PyObj[] =>
  Array.isArray(v) ? v.filter(isObj) : []

const asStr = (v: unknown): string | undefined =>
  typeof v === 'string' ? v : undefined

const asNum = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined

const asVec3 = (v: unknown): [number, number, number] | undefined => {
  if (!Array.isArray(v) || v.length < 3) return undefined
  const [a, b, c] = v
  if (typeof a !== 'number' || typeof b !== 'number' || typeof c !== 'number') {
    return undefined
  }
  return [a, b, c]
}

const asVec2 = (v: unknown): [number, number] | undefined => {
  if (!Array.isArray(v) || v.length < 2) return undefined
  const [a, b] = v
  if (typeof a !== 'number' || typeof b !== 'number') return undefined
  return [a, b]
}

const asVec2Array = (v: unknown): [number, number][] => {
  if (!Array.isArray(v)) return []
  const out: [number, number][] = []
  for (const pt of v) {
    const p = asVec2(pt)
    if (p) out.push(p)
  }
  return out
}

// ─── Enum mappers (Python → Pascal) ──────────────────────────────────

function mapSprinklerOrientation(py: unknown): 'pendant' | 'upright' | 'sidewall_horizontal' | 'concealed_pendant' {
  // Python vocabulary: pendent | upright | sidewall | concealed
  switch (py) {
    case 'upright':
      return 'upright'
    case 'sidewall':
      return 'sidewall_horizontal'
    case 'concealed':
      return 'concealed_pendant'
    default:
      return 'pendant'
  }
}

function mapPipeSchedule(
  py: unknown,
): 'SCH10' | 'SCH40' | 'CPVC_BlazeMaster' | 'copper_M' {
  switch (py) {
    case 'sch40':
    case 'SCH40':
      return 'SCH40'
    case 'cpvc':
    case 'CPVC_BlazeMaster':
      return 'CPVC_BlazeMaster'
    case 'copper':
    case 'copper_M':
      return 'copper_M'
    default:
      return 'SCH10'
  }
}

function mapPipeRole(
  py: unknown,
):
  | 'feed_main'
  | 'cross_main'
  | 'branch'
  | 'drop'
  | 'sprig'
  | 'riser_nipple'
  | 'riser'
  | 'standpipe'
  | 'feed'
  | 'unknown' {
  switch (py) {
    case 'drop':
    case 'branch':
    case 'cross_main':
    case 'riser_nipple':
      return py
    case 'main':
      return 'feed_main'
    default:
      return 'unknown'
  }
}

function mapFittingKind(
  py: unknown,
):
  | 'tee'
  | 'elbow_90'
  | 'elbow_45'
  | 'cross'
  | 'reducer_concentric'
  | 'cap'
  | 'flange'
  | 'union'
  | 'nipple'
  | 'coupling' {
  switch (py) {
    case 'tee_branch':
    case 'tee_run':
      return 'tee'
    case 'elbow_90':
      return 'elbow_90'
    case 'elbow_45':
      return 'elbow_45'
    case 'reducer':
      return 'reducer_concentric'
    case 'coupling':
      return 'coupling'
    // Valves aren't FittingNode.kind — fall back to coupling (we filter
    // them out earlier).
    default:
      return 'coupling'
  }
}

function mapSystemKind(
  py: unknown,
): 'wet' | 'dry' | 'preaction' | 'deluge' | 'combo_standpipe' | 'antifreeze' {
  switch (py) {
    case 'dry':
    case 'preaction':
    case 'deluge':
    case 'combo_standpipe':
      return py
    default:
      return 'wet'
  }
}

function mapHazard(
  py: unknown,
):
  | 'light'
  | 'ordinary_group_1'
  | 'ordinary_group_2'
  | 'extra_group_1'
  | 'extra_group_2'
  | 'storage' {
  switch (py) {
    case 'ordinary_i':
      return 'ordinary_group_1'
    case 'ordinary_ii':
      return 'ordinary_group_2'
    case 'extra_i':
      return 'extra_group_1'
    case 'extra_ii':
      return 'extra_group_2'
    default:
      return 'light'
  }
}

/** Snap a positive NPS number to the nearest valid Pascal catalog size. */
function snapNps(v: number): number {
  const valid: readonly number[] = [0.75, 1, 1.25, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 8, 10, 12]
  let best = 1
  let bestDelta = Number.POSITIVE_INFINITY
  for (const n of valid) {
    const d = Math.abs(v - n)
    if (d < bestDelta) {
      best = n
      bestDelta = d
    }
  }
  return best
}

// ─── Create-or-update helper ─────────────────────────────────────────

/**
 * Given a candidate node, emit a Create if it's new in `existing` or an
 * Update with only the changed-meaningful fields otherwise. The
 * resulting op list is what makes the translator idempotent.
 */
function emitOrUpdate(
  result: SliceTranslation,
  candidate: AnyNode,
  existing: Record<string, AnyNode>,
  parentId: string | undefined,
): void {
  const prior = existing[candidate.id]
  if (!prior) {
    result.creates.push({ node: candidate, parentId })
    return
  }
  // Update with the diff. Shallow field comparison is enough — the
  // scene store merges the patch over the existing node.
  const patch: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(candidate)) {
    if ((prior as Record<string, unknown>)[k] !== v) {
      patch[k] = v
    }
  }
  if (Object.keys(patch).length > 0) {
    result.updates.push({ id: candidate.id, patch: patch as Partial<AnyNode> })
  }
}

// ─── Stage translators ───────────────────────────────────────────────

function translateIntake(
  slice: PyObj,
  existing: Record<string, AnyNode>,
  result: SliceTranslation,
): void {
  const bldg = isObj(slice.building) ? slice.building : null
  if (!bldg) return

  const projectId = asStr(bldg.project_id) ?? 'project'
  const siteId = normId('site', `for_${projectId}`, 'default')
  const buildingId = normId('building', projectId, 'default')

  // 1. Site
  const siteNode = {
    object: 'node' as const,
    id: siteId,
    type: 'site' as const,
    parentId: null,
    visible: true,
    metadata: { project_id: projectId },
    polygon: {
      type: 'polygon' as const,
      points: [
        [-15, -15],
        [15, -15],
        [15, 15],
        [-15, 15],
      ] as [number, number][],
    },
    children: [],
  } as unknown as AnyNode
  emitOrUpdate(result, siteNode, existing, undefined)

  // 2. Building
  const levels = asArr(bldg.levels)
  const levelIds = levels.map((lvl, idx) =>
    normId('level', asStr(lvl.id), `lvl_${idx}`),
  )
  const buildingNode = {
    object: 'node' as const,
    id: buildingId,
    type: 'building' as const,
    parentId: siteId,
    visible: true,
    metadata: {
      project_id: projectId,
      construction_type: bldg.construction_type ?? null,
      total_sqft: bldg.total_sqft ?? null,
    },
    position: [0, 0, 0] as [number, number, number],
    rotation: [0, 0, 0] as [number, number, number],
    children: levelIds,
  } as unknown as AnyNode
  emitOrUpdate(result, buildingNode, existing, siteId)

  // 3. Levels + slabs + ceilings + walls
  levels.forEach((lvl, idx) => {
    const levelId = levelIds[idx]

    const slabId = normId('slab', `${asStr(lvl.id) ?? `lvl_${idx}`}_slab`, 'slab')
    const ceilingId = normId(
      'ceiling',
      `${asStr(lvl.id) ?? `lvl_${idx}`}_ceil`,
      'ceiling',
    )

    const wallIds: string[] = asArr(lvl.walls).map((w, wi) =>
      normId('wall', asStr(w.id), `lvl_${idx}_w_${wi}`),
    )

    const levelNode = {
      object: 'node' as const,
      id: levelId,
      type: 'level' as const,
      parentId: buildingId,
      visible: true,
      name: asStr(lvl.name) ?? `Level ${idx + 1}`,
      level: asNum(lvl.elevation_m) ?? idx,
      metadata: {
        elevation_m: asNum(lvl.elevation_m) ?? 0,
        height_m: asNum(lvl.height_m) ?? 3,
        use: lvl.use ?? 'other',
      },
      children: [slabId, ceilingId, ...wallIds],
    } as unknown as AnyNode
    emitOrUpdate(result, levelNode, existing, buildingId)

    // Slab — synthesized from level polygon (Python Level has no slab,
    // the floor IS the level polygon by convention).
    const levelPoly = asVec2Array(lvl.polygon_m)
    const slabNode = {
      object: 'node' as const,
      id: slabId,
      type: 'slab' as const,
      parentId: levelId,
      visible: true,
      polygon: levelPoly,
      holes: [],
      holeMetadata: [],
      elevation: asNum(lvl.elevation_m) ?? 0,
      autoFromWalls: levelPoly.length === 0,
    } as unknown as AnyNode
    emitOrUpdate(result, slabNode, existing, levelId)

    // Ceiling
    const ceil = isObj(lvl.ceiling) ? lvl.ceiling : {}
    const ceilingNode = {
      object: 'node' as const,
      id: ceilingId,
      type: 'ceiling' as const,
      parentId: levelId,
      visible: true,
      polygon: levelPoly,
      holes: [],
      holeMetadata: [],
      height: asNum(ceil.height_m) ?? 2.5,
      autoFromWalls: levelPoly.length === 0,
      children: [],
      metadata: {
        kind: ceil.kind ?? 'flat',
        slope_deg: asNum(ceil.slope_deg) ?? 0,
      },
    } as unknown as AnyNode
    emitOrUpdate(result, ceilingNode, existing, levelId)

    // Walls
    asArr(lvl.walls).forEach((w, wi) => {
      const wallId = wallIds[wi]
      const start = asVec2(w.start_m) ?? [0, 0]
      const end = asVec2(w.end_m) ?? [0, 0]
      const wallNode = {
        object: 'node' as const,
        id: wallId,
        type: 'wall' as const,
        parentId: levelId,
        visible: true,
        start,
        end,
        thickness: asNum(w.thickness_m) ?? 0.2,
        height: asNum(w.height_m) ?? 3,
        frontSide: 'unknown' as const,
        backSide: 'unknown' as const,
        children: [],
      } as unknown as AnyNode
      emitOrUpdate(result, wallNode, existing, levelId)
    })
  })
}

function translateClassify(
  slice: PyObj,
  existing: Record<string, AnyNode>,
  result: SliceTranslation,
): void {
  const levels = asArr(slice.levels)
  levels.forEach((lvl, idx) => {
    const levelId = normId('level', asStr(lvl.id), `lvl_${idx}`)
    if (!existing[levelId]) return // only update existing

    const rooms = asArr(lvl.rooms)
    const hazardByRoom: Record<string, unknown> = {}
    for (const r of rooms) {
      const rid = asStr(r.id)
      if (rid) hazardByRoom[rid] = r.hazard_class ?? null
    }

    result.updates.push({
      id: levelId,
      patch: {
        metadata: {
          use: lvl.use ?? 'other',
          hazard_by_room: hazardByRoom,
          elevation_m: asNum(lvl.elevation_m) ?? 0,
          height_m: asNum(lvl.height_m) ?? 3,
        },
      } as unknown as Partial<AnyNode>,
    })
  })
}

function translatePlace(
  slice: PyObj,
  existing: Record<string, AnyNode>,
  result: SliceTranslation,
): void {
  const heads = asArr(slice.sprinkler_heads)
  heads.forEach((h, idx) => {
    const id = normId('sprinkler_head', asStr(h.id), `h_${idx}`)
    const pos = asVec3(h.position_m) ?? [0, 0, 0]
    const parent = asStr(h.room_id)
      ? normId('level', undefined, asStr(h.room_id) ?? 'unknown')
      : undefined
    const node = {
      object: 'node' as const,
      id,
      type: 'sprinkler_head' as const,
      parentId: parent ?? null,
      visible: true,
      position: pos,
      rotation: [0, 0, 0] as [number, number, number],
      k_factor: asNum(h.k_factor) ?? 5.6,
      sku: asStr(h.sku) ?? 'unknown-sku',
      manufacturer: 'other' as const,
      orientation: mapSprinklerOrientation(h.orientation),
      response: 'standard' as const,
      temperature: 'ordinary_155F' as const,
      systemId: asStr(h.system_id),
    } as unknown as AnyNode
    emitOrUpdate(result, node, existing, parent)
  })
}

function translateRoute(
  slice: PyObj,
  existing: Record<string, AnyNode>,
  result: SliceTranslation,
): void {
  const systems = asArr(slice.systems)
  systems.forEach((s, sidx) => {
    const systemId = normId('system', asStr(s.id), `sys_${sidx}`)

    const pipes = asArr(s.pipes)
    const pipeIds = pipes.map((p, idx) =>
      normId('pipe', asStr(p.id), `${systemId}_p_${idx}`),
    )

    const heads = asArr(s.heads)
    const headIds = heads.map((h, idx) =>
      normId('sprinkler_head', asStr(h.id), `${systemId}_h_${idx}`),
    )

    // System node
    const sysNode = {
      object: 'node' as const,
      id: systemId,
      type: 'system' as const,
      parentId: null,
      visible: true,
      kind: mapSystemKind(s.type),
      hazard: 'light' as const,
      pipeIds,
      headIds,
    } as unknown as AnyNode
    emitOrUpdate(result, sysNode, existing, undefined)

    // Pipes
    pipes.forEach((p, idx) => {
      const id = pipeIds[idx]
      const start = asVec3(p.start_m) ?? [0, 0, 0]
      const end = asVec3(p.end_m) ?? [0, 0, 0]
      const rawSize = asNum(p.size_in) ?? 1
      const size_in = snapNps(rawSize)
      const node = {
        object: 'node' as const,
        id,
        type: 'pipe' as const,
        parentId: systemId,
        visible: true,
        start_m: start,
        end_m: end,
        size_in,
        schedule: mapPipeSchedule(p.schedule),
        role: mapPipeRole(p.role),
        metadata: {
          systemId,
          downstream_heads: asNum(p.downstream_heads) ?? 0,
        },
      } as unknown as AnyNode
      emitOrUpdate(result, node, existing, systemId)
    })

    // Fittings — skip valve kinds (gate_valve / check_valve) since
    // those are ValveNodes, not FittingNodes, in Pascal.
    asArr(s.fittings).forEach((f, idx) => {
      const kindRaw = asStr(f.kind)
      if (kindRaw === 'gate_valve' || kindRaw === 'check_valve') return
      const id = normId('fitting', asStr(f.id), `${systemId}_f_${idx}`)
      const pos = asVec3(f.position_m) ?? [0, 0, 0]
      const node = {
        object: 'node' as const,
        id,
        type: 'fitting' as const,
        parentId: systemId,
        visible: true,
        position: pos,
        rotation: [0, 0, 0] as [number, number, number],
        sku: `auto-${kindRaw ?? 'fitting'}`,
        kind: mapFittingKind(kindRaw),
        size_in: asNum(f.size_in) ?? 1,
        connection_style: 'grooved' as const,
        port_connections: [],
        systemId,
      } as unknown as AnyNode
      emitOrUpdate(result, node, existing, systemId)
    })

    // Hangers
    asArr(s.hangers).forEach((h, idx) => {
      const id = normId('hanger', asStr(h.id), `${systemId}_hgr_${idx}`)
      const pos = asVec3(h.position_m) ?? [0, 0, 0]
      const pipe_id = normId('pipe', asStr(h.pipe_id), `${systemId}_p_0`)
      const node = {
        object: 'node' as const,
        id,
        type: 'hanger' as const,
        parentId: systemId,
        visible: true,
        position: pos,
        rotation: [0, 0, 0] as [number, number, number],
        sku: 'auto-clevis',
        kind: 'clevis' as const,
        pipe_id,
        size_in: 1,
      } as unknown as AnyNode
      emitOrUpdate(result, node, existing, systemId)
    })
  })
}

function translateHydraulic(
  slice: PyObj,
  existing: Record<string, AnyNode>,
  result: SliceTranslation,
): void {
  const systems = asArr(slice.systems)
  systems.forEach((s, sidx) => {
    const systemId = normId('system', asStr(s.id), `sys_${sidx}`)
    const hy = isObj(s.hydraulic) ? s.hydraulic : null
    if (!hy) return

    const reqFlow = asNum(hy.required_flow_gpm) ?? 0
    const hose = asNum((hy as PyObj).supply_flow_gpm) ?? 0
    const patch: PyObj = {
      demand: {
        sprinkler_flow_gpm: Math.max(0, reqFlow - 0),
        hose_flow_gpm: 0,
        total_flow_gpm: Math.max(0, reqFlow),
        required_psi: Math.max(0, asNum(hy.required_pressure_psi) ?? 0),
        safety_margin_psi: asNum(hy.safety_margin_psi) ?? 0,
        passes: (asNum(hy.safety_margin_psi) ?? 0) >= 5,
        solved_at: Date.now(),
      },
    }
    // Suppress unused var lint — hose_flow stays 0 for now; pipeline
    // doesn't separate hose flow at this stage.
    void hose

    if (existing[systemId]) {
      result.updates.push({
        id: systemId,
        patch: patch as unknown as Partial<AnyNode>,
      })
    }
  })
}

function translateRulecheck(
  slice: PyObj,
  existing: Record<string, AnyNode>,
  result: SliceTranslation,
): void {
  // Group issues by ref id. Any node mentioned in `refs` gets a
  // metadata.issues annotation. No creates.
  const issues = asArr(slice.issues)
  const byRef: Record<string, PyObj[]> = {}
  for (const iss of issues) {
    const refs = Array.isArray(iss.refs) ? iss.refs : []
    for (const r of refs) {
      const key = typeof r === 'string' ? r : null
      if (!key) continue
      if (!byRef[key]) byRef[key] = []
      byRef[key].push(iss)
    }
  }
  for (const [rawId, bag] of Object.entries(byRef)) {
    // Try common prefix guesses.
    const candidates = [
      rawId,
      `system_${rawId}`,
      `pipe_${rawId}`,
      `sprinkler_head_${rawId}`,
      `wall_${rawId}`,
      `level_${rawId}`,
    ]
    const hit = candidates.find((c) => existing[c])
    if (!hit) continue
    result.updates.push({
      id: hit,
      patch: {
        metadata: { issues: bag },
      } as unknown as Partial<AnyNode>,
    })
  }
}

// ─── Entry point ─────────────────────────────────────────────────────

/**
 * Translate one stage event's slice payload into incremental scene ops.
 *
 * Idempotency strategy:
 *
 *   1. IDs are derived deterministically from the Python-side id or
 *      the slice index — never random.
 *   2. Every candidate node is matched against `existing[id]`. If the
 *      id is present, we emit an Update with only the changed fields;
 *      otherwise a Create. Re-applying the same slice twice therefore
 *      produces zero creates on the second pass.
 *
 * Contract on bad input: missing slice or missing required fields
 * produce an empty translation — the function never throws. Truly
 * malformed events (wrong step, slice not an object) yield an empty
 * translation too; the caller is free to log and continue.
 */
export function translateDesignSliceToNodes(
  event: StageEvent,
  existing: Record<string, AnyNode>,
): SliceTranslation {
  const result: SliceTranslation = { creates: [], updates: [], deletes: [] }
  if (!event || typeof event !== 'object') return result
  const slice: PyObj = isObj(event.slice) ? (event.slice as PyObj) : {}

  switch (event.step) {
    case 'intake':
      translateIntake(slice, existing, result)
      break
    case 'classify':
      translateClassify(slice, existing, result)
      break
    case 'place':
      translatePlace(slice, existing, result)
      break
    case 'route':
      translateRoute(slice, existing, result)
      break
    case 'hydraulic':
      translateHydraulic(slice, existing, result)
      break
    case 'rulecheck':
      translateRulecheck(slice, existing, result)
      break
    case 'bom':
    case 'labor':
    case 'proposal':
    case 'submittal':
    case 'done':
      // Intentional no-op: these stages have no scene-node payload.
      break
    default:
      // Unknown step — empty translation is the safe default.
      break
  }
  return result
}

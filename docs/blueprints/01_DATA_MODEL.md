# Blueprint 01 — Data Model

**Scope:** The `.hfproj` bundle, all persistent schemas, migration
strategy, file I/O contracts.

## 1. `.hfproj` bundle layout

A project is a **directory** (not a zip) so file watchers,
diff tools, and source control work naturally. Extension preserved
for file-manager affordances.

```
MyProject.hfproj/
├─ manifest.json           project metadata, app/schema versions
├─ design/
│  ├─ current.json         Active Design (nodes, systems, hazards)
│  └─ snapshots/           immutable revisions
│     ├─ v0.json           V0  = post-intake baseline
│     ├─ v1.json           V1  = first AHJ submittal
│     ├─ r1.json           R1  = first AHJ correction response
│     └─ …
├─ corrections.jsonl       append-only user edits over intake
├─ comments.jsonl          pinned notes per node
├─ audit.jsonl             who-did-what-when
├─ catalog-lock.json       frozen Part[] used by this bid
├─ underlays/              referenced drawings (PDF/DWG/IFC)
├─ exports/                generated artifacts (read-only)
│  ├─ proposal.pdf
│  ├─ submittal/
│  │  ├─ FP-001.pdf
│  │  └─ …
│  ├─ design.dxf
│  ├─ design.ifc
│  ├─ design.glb
│  ├─ supplier.hlf
│  └─ nfpa_report.json
└─ .autosave/              rolling snapshots — hidden from the user
```

## 2. Core schemas

All schemas authored as zod in `packages/halofire-schema/`.
Compiled to Python Pydantic via `scripts/zod-to-pydantic.ts`
(golden-fixture-tested on round-trip).

### 2.1 `manifest.json`

```typescript
export const ProjectManifest = z.object({
  schema_version: z.literal(1),
  project_id: z.string(),
  name: z.string(),
  address: z.string(),
  firm: z.string(),
  designer: z.string(),
  reviewer: z.string().optional(),
  stamped_by: z.string().optional(),       // PE name, if stamped
  units: z.enum(['imperial', 'metric']).default('imperial'),
  code_edition: z.string().default('NFPA 13 2022'),
  ahj: z.string().optional(),
  created_at: z.string(),                   // ISO 8601
  modified_at: z.string(),
  app_version: z.string(),                  // studio version that last saved
  capabilities: z.array(z.string()),        // features used (warns on open)
})
```

### 2.2 `design/current.json` (Design)

References:
- `packages/halofire-schema/src/design.ts` — authoritative
- Python mirror: `services/halofire-cad/cad/schema.py`

```typescript
export const Design = z.object({
  project: ProjectRef,
  building: Building,             // Levels, slabs, walls, ceilings
  systems: z.array(System),        // Fire-protection systems
  remote_areas: z.array(RemoteArea).default([]),
  sources: z.array(DesignSource),  // Intake provenance
  issues: z.array(DesignIssue),    // Violations + warnings
  confidence: DesignConfidence,
  deliverables: DeliverableManifest,
  metadata: z.json().optional(),
})
```

### 2.3 `corrections.jsonl`

Append-only. Each line = one user correction over intake. Lets the
pipeline re-run without overwriting manual fixes.

```typescript
export const Correction = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('wall.delete'),
    wall_id: z.string(),
    at: z.string(),       // ISO
    by: z.string().optional(),
  }),
  z.object({
    type: z.literal('wall.move'),
    wall_id: z.string(),
    from_start: z.tuple([z.number(), z.number()]),
    to_start: z.tuple([z.number(), z.number()]),
    from_end: z.tuple([z.number(), z.number()]),
    to_end: z.tuple([z.number(), z.number()]),
    at: z.string(),
    by: z.string().optional(),
  }),
  z.object({
    type: z.literal('head.move'),
    head_id: z.string(),
    from_pos: z.tuple([z.number(), z.number(), z.number()]),
    to_pos: z.tuple([z.number(), z.number(), z.number()]),
    at: z.string(),
    by: z.string().optional(),
  }),
  z.object({
    type: z.literal('head.add'),
    sku: z.string(),
    pos: z.tuple([z.number(), z.number(), z.number()]),
    at: z.string(),
    by: z.string().optional(),
  }),
  z.object({
    type: z.literal('head.remove'),
    head_id: z.string(),
    at: z.string(),
    by: z.string().optional(),
  }),
  z.object({
    type: z.literal('pipe.resize'),
    pipe_id: z.string(),
    from_size_in: z.number(),
    to_size_in: z.number(),
    at: z.string(),
    by: z.string().optional(),
  }),
  z.object({
    type: z.literal('hazard.set'),
    level_id: z.string(),
    room_id: z.string().optional(),
    hazard: z.string(),
    at: z.string(),
    by: z.string().optional(),
  }),
])
```

### 2.4 `comments.jsonl`

```typescript
export const Comment = z.object({
  id: z.string(),
  node_id: z.string().optional(),           // pinned to a node OR
  anchor: z.tuple([z.number(), z.number(), z.number()]).optional(), // world point
  author: z.string(),
  created_at: z.string(),
  text: z.string(),
  resolved: z.boolean().default(false),
  resolved_by: z.string().optional(),
  resolved_at: z.string().optional(),
  replies: z.array(z.object({
    author: z.string(),
    at: z.string(),
    text: z.string(),
  })).default([]),
})
```

### 2.5 `audit.jsonl`

Append-only. Required for licensed-PE workflows.

```typescript
export const AuditEntry = z.object({
  ts: z.string(),                           // ISO
  actor: z.string(),
  action: z.string(),                       // 'open' | 'save' | 'stamp' | 'export' | 'approve' | …
  target: z.string().optional(),            // node id or file path
  delta: z.json().optional(),               // structured change summary
  reason: z.string().optional(),
})
```

### 2.6 `catalog-lock.json`

Pins the catalog snapshot used by this bid. Prevents the BOM from
silently changing when the user updates the global catalog.

```typescript
export const CatalogLock = z.object({
  schema_version: z.literal(1),
  catalog_version: z.string(),              // semver of catalog.json
  catalog_hash: z.string(),                 // sha256 of catalog.json
  frozen_at: z.string(),
  parts: z.array(z.object({
    sku: z.string(),
    part_hash: z.string(),                  // sha256 of Part record
    unit_cost_usd: z.number(),
    price_source: z.string(),
  })),
})
```

## 3. Migration strategy

- `schema_version` on every root document.
- `packages/halofire-schema/src/migrations/v1_to_v2.ts` is a pure
  `(oldDoc) => newDoc` function; chained for multi-version jumps.
- On open: if `manifest.schema_version < CURRENT`, prompt user
  with a backup option before migrating in place.
- Migration writes a `v{old}.json` snapshot before overwriting.
- Forward-compat: if `manifest.schema_version > CURRENT`, open
  read-only and surface a banner "This project was saved with a
  newer version; upgrade Halo Fire Studio to edit."

## 4. File I/O contracts

### 4.1 Save

Atomic via tempfile + rename. Enforced by
`hf-core/io/atomic-write.ts` which is reused by Rust commands
(via ipc) and by the Python sidecar (via a mirror).

```typescript
// apps/editor/lib/project-io.ts
await saveProject(project, { strategy: 'atomic' })
```

Writes:
1. Temp file `design/current.json.tmp`.
2. fsync.
3. Rename over `design/current.json`.
4. Append `audit.jsonl` entry.
5. Touch `manifest.json.modified_at`.

### 4.2 Autosave

Every **90 seconds** AND on idle > **10 seconds** after any edit,
write to `.autosave/design.json`. The main `current.json` only
gets overwritten on explicit Save.

Crash recovery on open: if `.autosave/design.json` is newer than
`current.json`, prompt user to restore.

### 4.3 Load

```typescript
const project = await loadProject(pathToHfproj)
// throws ProjectLoadError { code: 'corrupt' | 'too-new' | 'missing-file', detail }
```

## 5. File-system watcher

- Pascal scene-store subscription writes to `current.json` on
  save (not on every edit — edits are in-memory until save).
- A filesystem watcher on `catalog-lock.json` + `underlays/*`
  forces re-render of dependent viewport bits if the file
  changes out-of-band (external app modified, source-control
  merge, etc).

## 6. Tests

- `packages/halofire-schema/tests/round-trip.spec.ts` — zod parse
  → JSON serialize → parse again; deep-equal.
- `packages/halofire-schema/tests/migration.spec.ts` — a v0
  fixture → migrate → validate against v1 schema.
- `services/halofire-cad/tests/test_schema_contracts.py` — Python
  pydantic models load the same JSON; must produce identical
  runtime objects (golden fixture).

## 7. Open questions

- Zip-on-the-wire for sharing: add a `.hfproj.zip` round-trip
  utility? P1.
- CRDT format for multi-user: post-1.0. Design for it now or
  defer? — defer; hooks in `comments.jsonl` + `corrections.jsonl`
  keep the option open.

## 8. Dependencies on other blueprints

- `02_FOUNDATION.md` — undo/redo uses this schema as the base
  for transactional edits.
- `04_PASCAL_NODES.md` — `Design.building` + `Design.systems`
  reference Pascal node types.
- `09_AGENT_PIPELINE.md` — agents write `design/current.json` +
  `sources/*` as they run.

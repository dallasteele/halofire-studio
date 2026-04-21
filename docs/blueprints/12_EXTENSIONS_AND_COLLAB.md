# Blueprint 12 — Extensions, Revisions, Collaboration, Audit

**Scope:** Firm-custom catalogs, comments, revisions (V0/V1/R1…),
multi-role workflow (designer/PE/PM/GC), audit trail, plugin
extension points.

## 1. Firm custom catalog

Per-firm parts library that extends the shared catalog.

### 1.1 Location

`<user-docs>/HaloFireStudio/firm-catalog/`

```
firm-catalog/
├─ manifest.json           firm metadata + enabled-by-default flag
├─ scad/                   firm-authored .scad files (same annotation grammar)
├─ thumbnails/             PNG thumbnails referenced by @thumbnail
├─ title-blocks/           SVG title-block templates
├─ dim-styles/             JSON DimStyle records
├─ pricing-overrides.json  sku → price (override shared catalog)
└─ signed/                 signature artifact (for shared firm installs)
```

### 1.2 Resolution order

Catalog lookup = firm first, shared second:

```typescript
function findSku(sku: string): Part | undefined {
  return firmCatalog.parts.find(p => p.sku === sku)
      ?? sharedCatalog.parts.find(p => p.sku === sku)
}
```

### 1.3 Sharing

A firm can package its catalog as `<firm>.hfcatalog.zip` and
share with branch offices. Import via UI: Settings → Catalog →
Import firm catalog.

## 2. Comments

Per-node pinned notes. See blueprint 01 §2.4 for schema.

### 2.1 UI

- Click a node → Properties panel has "Comments (N)" tab.
- Click tab → list of comments, newest first.
- "+ Add comment" inline composer.
- Comments persist in `.hfproj/comments.jsonl`.
- Unresolved comment count shown on node (small badge in the
  viewport, aura on hover).

### 2.2 Reply chains

Each comment supports a `replies[]` array. UI flattens to a
thread with indentation.

### 2.3 Resolve / reopen

Author (or anyone with edit access) can mark resolved.
Resolved comments hide by default; filter toggle shows them.

### 2.4 Mentions

`@designer` / `@pe` / specific user names. Plain text for v1.0;
@-autocomplete post-1.0.

## 3. Revisions

### 3.1 Revision entity

```typescript
export const Revision = z.object({
  id: z.string(),                           // 'V0' | 'V1' | 'R1' | 'R2' | …
  parent_id: z.string().optional(),
  label: z.string(),                        // 'Initial submittal'
  author: z.string(),
  created_at: z.string(),
  snapshot_path: z.string(),                // .hfproj/design/snapshots/v1.json
  description: z.string(),
  ahj_status: z.enum(['draft', 'submitted', 'approved', 'correction_required', 'rejected']).optional(),
  ahj_response: z.string().optional(),
  ahj_response_date: z.string().optional(),
  correction_cloud_ids: z.array(z.string()).default([]),
})
```

### 3.2 Workflow

- Designer finishes → saves as V0 (auto).
- PE reviews → stamps → V1 (AHJ submittal).
- AHJ returns corrections → user applies → R1 (correction
  response).
- Repeat as needed.

Each revision is an immutable snapshot under
`.hfproj/design/snapshots/`. Current working state is
`.hfproj/design/current.json`.

### 3.3 Diff viewer

`components/halofire/RevisionDiff.tsx`:

- Pick two revisions → side-by-side + overlay.
- List of node-level changes (added / removed / modified).
- Click a change → viewport pans to the affected node.
- Filter by category (heads changed, pipes resized, hazard
  reclassified).

### 3.4 Re-submittal

"Submit R1 to AHJ" → packages only the CHANGES (revision cloud
sheets + summary of corrections made) plus a full updated
design. Bundle shape same as AHJ submittal (blueprint 11 §2)
plus a `CORRECTIONS_LOG.pdf`.

## 4. Multi-role workflow

### 4.1 Role model

```typescript
export type Role =
  | 'designer'       // drafts, can save, can't stamp
  | 'pe'             // designs + stamps (licensed engineer)
  | 'project_manager'// approves bids before client send
  | 'reviewer'       // read + comment only
  | 'client'         // read-only view for GC (limited fields)
  | 'admin'          // firm admin
```

Stored per-user in `<app_data>/users.json`. v1.0 is
single-machine (OS user identity); v1.5 adds cloud auth.

### 4.2 Permissions matrix

| Action | designer | pe | pm | reviewer | client | admin |
|---|---|---|---|---|---|---|
| Create project | ✓ | ✓ |  |  |  | ✓ |
| Edit design | ✓ | ✓ |  |  |  | ✓ |
| Save | ✓ | ✓ | ✓ |  |  | ✓ |
| Comment | ✓ | ✓ | ✓ | ✓ |  | ✓ |
| Stamp (PE seal) |  | ✓ |  |  |  |  |
| Approve bid for client |  |  | ✓ |  |  |  |
| Export submittal |  | ✓ | ✓ |  |  | ✓ |
| Approve & submit to AHJ |  | ✓ |  |  |  |  |
| View BOM + pricing | ✓ | ✓ | ✓ | ✓ | (client-safe) | ✓ |
| Manage catalog |  |  |  |  |  | ✓ |

### 4.3 UI surfacing

- Login screen shows available roles (from OS identity +
  firm catalog).
- Current role in status bar + top-right avatar.
- Disabled actions show tooltip "Requires {role} role".

## 5. Audit trail

`audit.jsonl` (blueprint 01 §2.5). Every mutating action logs:

| Action | When logged |
|---|---|
| `open` | project loaded |
| `save` | user saves (not autosave) |
| `autosave` | background save (throttled: one log/5 min) |
| `edit.atomic` | any committed transaction (compact summary) |
| `export` | any export command |
| `stamp` | PE stamp applied |
| `stamp.revoke` | PE stamp removed |
| `approve` | bid approved for client |
| `submit.ahj` | submittal bundle sent |
| `revision.create` | new revision snapshot |
| `correction.apply` | AHJ correction applied |

Audit log is append-only; never truncated. Read via Project
management panel → Activity tab.

## 6. Plugin extension points

HaloFire Studio 1.0 is closed (no runtime plugins). 1.5 opens
these extension points:

- **Custom tools** — register new ToolRegistry entries via JSON.
- **Custom rule checks** — register Rule entries.
- **Custom exporters** — register ExportHandler entries.
- **Custom catalog processors** — post-process Part before it's
  presented (e.g., apply firm-specific markup).
- **Slack / Teams notifications** — webhook on submit / approve.

Plugins live in `<user-docs>/HaloFireStudio/plugins/<plugin-id>/`
with a `manifest.json` declaring which extension points they
implement.

## 7. Collaboration (v1.5+)

Out of scope for 1.0, but design now to avoid a rewrite:

- **Local file-lock** — `.hfproj/.lockfile` with
  `{hostname, pid, role, acquired_at}`. Second open → read-only
  with warning "{name} is editing".
- **Real-time multi-user** — Yjs CRDT over LAN (peer-to-peer
  via WebRTC) or via a Halo-hosted relay. Deferred to 2.0.

## 8. Tests

- `packages/hf-core/tests/revisions/diff.spec.ts` — two designs
  → diff → expected change list.
- `apps/editor/e2e/stamp-workflow.spec.ts` — Playwright:
  designer saves → switches role to PE → stamps → exports
  stamped PDF → verifies stamp metadata.
- `packages/halofire-catalog/tests/firm-override.spec.ts` —
  firm catalog shadowing + pricing override.

## 9. Open questions

- How to distribute firm catalogs in a multi-branch firm?
  Shared Dropbox/OneDrive folder for v1.0; cloud sync post-1.0.
- PE stamping across state lines — each state has different
  rules. UI needs per-state prompts. P1.
- Client role granularity — hide prices entirely vs show
  rolled-up totals. Configurable per-project.

# Manufacturer Integration Matrix & Connector Framework

> **Status:** Design + grounded research aid. **NOT code-certified.**
> This document designs the agentic per-manufacturer CONNECTOR FRAMEWORK for
> HaloFire Studio. Every availability claim in §1 is taken verbatim from the
> per-manufacturer research findings (cited inline by manufacturer). Where a
> finding was self-flagged `confidence: medium` or "inferred / not click-verified"
> that caveat is carried forward — we do **not** upgrade a medium finding to
> certain. See [§5 Honesty Contract](#5-honesty-contract) before wiring any
> connector to a live source.

It layers onto the lanes that already ship:

- **T44 manufacturer-STEP lane** — `apps/studio/src/lib/manufacturer-step.ts`.
  Top provenance tier (`manufacturer_verified`). An entry counts ONLY with a real
  `stepUrl` **and** real `sha256` (`isOperatorVerified`). The shipped
  `public/parts/manufacturer-step.json` is intentionally empty.
- **T54 import lane** — `apps/studio/scripts/import-manufacturer-step.mjs`. Scans
  `public/parts/manufacturer-incoming/<slug>/` for `*.stp`/`*.step`, copies to
  `public/parts/manufacturer-step/<slug>.stp`, computes real sha256, upserts the
  manifest. Manifest is committed; licensed binaries are gitignored, never
  redistributed.
- **T51 catalog lane** — `apps/studio/src/lib/manufacturer-catalog.ts` +
  `scripts/ingest-catalog/crawl.py`. Spec/metadata tier extracted from public PDFs
  (`public/catalog/manufacturer-catalog.json`). Spec records only — NOT geometry.

The connector framework is the **agentic front end** to those two lanes: per
manufacturer it discovers parts, ingests STEP/CAD into the T44/T54
`manufacturer_verified` lane, ingests spec metadata into the T51 catalog lane, and
keeps both fresh on a schedule. **It changes none of the honesty gates** — every
geometry upgrade still flows through `isOperatorVerified` (real stepUrl + sha256).

---

## 1. Availability Matrix

Each row is grounded in that manufacturer's research finding. "API key / link
Halo Fire must supply" lists the connector's required **input** — always a config
reference, never a hardcoded secret (§2.2). "Confidence" is the finding's own
self-reported confidence.

| Manufacturer | sourceType | Public API? | Direct download | CADENAS status | Aggregators (native vs link-only) | API key / link Halo Fire must supply | Recommended connector | Confidence |
|---|---|---|---|---|---|---|---|---|
| **Victaulic** | `direct_download` | No (no Victaulic-native API) | **Yes — ungated** (resource-software ZIPs) | link-only (redirects to victaulic.com) | TraceParts (native), MEPcontent, BIMobject, BIM&CO, 3Dfindit (link-only), CADdetails/3dmdb, GrabCAD | **Primary: none** — public ungated resource page `victaulic.com/resource-software/`. **Optional Tier 2:** TraceParts Bearer token (partnership-gated) for part-number CAD | Two-tier `direct_download`: poll/download ungated ZIP packages w/ hash diff (Tier 1); TraceParts API for granular per-part CAD (Tier 2). Skip 3Dfindit. | high |
| **Argco** | `manual_import` | No | No (PDF only) | not present | none | **none** — public ungated argco.com category/PDF URLs | PDF/HTML scraper of catalog tree → datasheet records keyed by Argco part #. No 3D; geometry modeled in-house from submittal dims. Weekly diff on PDF ETag/last-modified. | high |
| **Potter Roemer** (hardware: FDCs, valves, cabinets) | `bim_aggregator` | No | Yes — **gated** (ARCAT login) | n/a | ARCAT (BIM/RFA, IFC, SKP, DWG — login-gated) | **ARCAT account credentials** (`apiKeyRef` → env login pair); own-site PDFs ungated | Two-route: scrape ungated potterroemer.com PDF submittal library (zero creds, ship first) + pull BIM from ARCAT hub w/ stored login. | medium |
| **Potter Electric Signal** (devices: bells, horns/strobes, monitoring) | `cadenas` / `bim_aggregator` | No (own); TraceParts only IF mirrored | Yes — **gated** (free 3Dfindit account) | **native_downloadable** (100+ formats incl. Revit, STEP) | CADENAS 3Dfindit/PARTcommunity (native), BIMobject | **Free 3Dfindit account** OR TraceParts Bearer token (only if Potter mirrored there) | CADENAS/3Dfindit native pull (authenticated session) for device CAD; backstop w/ ungated pottersignal.com PDFs. | medium |
| **Watts** | `bim_aggregator` | **Yes — TraceParts** (not Watts-native) | Yes — **gated** (manufacturer site 403s bots; aggregator login) | unknown (Watts page exists; native-vs-link unconfirmed) | TraceParts (native, catalog `WATTS_983238924`), BIMobject, ARCAT, MEPcontent, bimstore, UNIFI | **TraceParts API Key + Tenant UID** (partner-gated; mints 24h bearer). Fallback: free BIMobject/MEPcontent login | TraceParts-API-backed pull: walk Watts catalog tree, fetch STEP per product via `cadFileUrl`/`cadRequest`, sha256 into T44 lane, weekly re-walk. Interim: authenticated BIMobject. | medium |
| **Reliable** | `bim_aggregator` (own FTP primary) | No | Yes — **soft-gated** (lead-gen form; underlying FTP ZIPs directly addressable) | native_downloadable | BIMobject (login-gated), CADENAS 3Dfindit (native) | **none required** — public catalog + FTP ZIP tree URLs; optional free BIMobject/3Dfindit account for cross-check | Scheduled scrape-and-mirror of Reliable's own BIM library FTP ZIP tree (16 libraries, Revit `.rfa` only — no STEP), per-ZIP sha256 diff. Aggregators as JS-rendered secondary. **Feeds BIM/Revit tier, NOT STEP tier.** | high |
| **Viking** | `bim_aggregator` | **Yes — TraceParts** (EMEA-scoped) | Yes — **gated** | **native_downloadable** | TraceParts (Viking EMEA native STEP/IGES/SW/Revit/DWG), CADENAS 3Dfindit (native), BIMobject (native `.rfa`) | **TraceParts API key (Bearer)** for EMEA line; **free BIMobject + 3Dfindit accounts** for US Viking Corp SKUs not in EMEA catalog | TraceParts API primary (enumerate `VIKING_EMEA`, confirm formats via `caddataavailability`, pull STEP/Revit, weekly diff); BIMobject + 3Dfindit scripted-auth gap-fillers for US line. vDesign portal = manual fallback. | high |
| **Wheatland Tube** | `bim_aggregator` (ARCAT) | No | No (own site PDF only) | not present | ARCAT (native BIM RFA/RVT + CAD DWG/IFC, **ungated**) | **none** — public ARCAT + wheatland.com URLs (no login, no key) | Hybrid scrape: ARCAT as geometry source (respect 429 rate-limit), wheatland.com submittal PDFs as spec/metadata source. | medium |
| **Bull Moose Tube** | `direct_download` / `manual_import` | No | No (ungated PDF only) | not present | ARCAT (stub/profile only — no hosted content) | **none** — public ungated PDF URLs under bullmoosetube.com/wp-content/uploads/ | PDF scraper: crawl Sprinkler Pipe + Documentation pages, hash/diff date-stamped PDFs, parse dimensional tables, synthesize parametric pipe geometry (no 3D exists). | high |

**Matrix-level reading:**

- **Zero true manufacturer-native CAD/BIM APIs** were verified for any of the 8.
  The only documented developer REST API in the entire set is **TraceParts**
  (`developers.traceparts.com`, Bearer-token, partner-gated) which *hosts* several
  of these manufacturers' catalogs (Victaulic, Watts, Viking-EMEA) — it is an
  aggregator API, not a manufacturer API.
- **CADENAS/3Dfindit** is native-downloadable for **Potter Electric Signal,
  Reliable, Viking** but **link-only (useless) for Victaulic**.
- **Fully ungated (no login, no key) today:** Victaulic (own ZIPs), Argco (PDF),
  Wheatland (ARCAT), Bull Moose (PDF), Reliable (own FTP ZIPs, soft lead-gen
  gate only).

---

## 2. Connector Framework Design

### 2.1 Typed connector registry — `manufacturer-connectors.json`

Committed at `apps/studio/public/connectors/manufacturer-connectors.json`. It is
the **config + status ledger** for every manufacturer connector. It contains **no
secrets** — only an `apiKeyRef` pointing at an env/config key name (§2.2). The
shipped file enables only the zero-credential connectors; everything gated ships
`status: "needs_config"`.

```ts
// apps/studio/src/lib/manufacturer-connectors.ts (typed loader, mirrors
// manufacturer-step.ts / manufacturer-catalog.ts fail-soft conventions)

export type ConnectorSourceType =
  | 'rest_api'        // documented REST API (only TraceParts today)
  | 'cadenas'         // CADENAS PARTcommunity / 3Dfindit native catalog
  | 'direct_download' // ungated/soft-gated manufacturer ZIP/file tree
  | 'bim_aggregator'  // ARCAT / BIMobject / MEPcontent etc. (scrape, often login)
  | 'manual_import';  // no automatable source; operator drops files (T54 lane)

export type ConnectorStatus =
  | 'enabled'       // automatable now; no missing config
  | 'needs_config'  // automatable BUT requires an operator-supplied key/login/link
  | 'manual'        // not automatable; operator uses the T54 import lane
  | 'disabled';     // operator turned it off

export interface ManufacturerConnector {
  id: string;                 // stable slug, e.g. "victaulic", "viking", "potter-electric"
  name: string;               // display name
  status: ConnectorStatus;
  sourceType: ConnectorSourceType;
  /** Primary catalog/resource URL the connector polls or walks. */
  catalogUrl: string | null;
  /**
   * Reference to a credential in env/secret config — NEVER a literal key.
   * e.g. "TRACEPARTS_API_KEY" / "TRACEPARTS_TENANT_UID" / "ARCAT_LOGIN".
   * null when the source is ungated. The sync agent resolves this at runtime
   * via process.env / a secret store; the registry only ever holds the NAME.
   */
  apiKeyRef: string | null;
  /** ISO timestamp of the last successful sync, or null if never synced. */
  lastSynced: string | null;
  /** Count of parts this connector has contributed (geometry + spec). */
  partCount: number;
  /** Honest operator-facing note: what this connector does and its limits. */
  notes: string;
  /** Which provenance lane this connector feeds. */
  ingestLane: 'manufacturer_step' | 'catalog_spec' | 'both';
  /** Optional second-tier enrichment source (e.g. Victaulic Tier 2 TraceParts). */
  secondaryApiKeyRef?: string | null;
}

export interface ConnectorRegistry {
  generatedAt: string | null;
  connectors: ManufacturerConnector[];
}
```

Shipped registry (abbreviated — `notes` trimmed for the doc):

```jsonc
{
  "generatedAt": null,
  "connectors": [
    { "id": "victaulic", "name": "Victaulic", "status": "enabled",
      "sourceType": "direct_download",
      "catalogUrl": "https://www.victaulic.com/resource-software/",
      "apiKeyRef": null, "secondaryApiKeyRef": "TRACEPARTS_API_KEY",
      "lastSynced": null, "partCount": 0, "ingestLane": "both",
      "notes": "Tier1 ungated ZIPs (no key). Tier2 TraceParts needs partner key." },

    { "id": "argco", "name": "Argco", "status": "manual",
      "sourceType": "manual_import",
      "catalogUrl": "https://argco.com/fire-sprinkler.html",
      "apiKeyRef": null, "lastSynced": null, "partCount": 0,
      "ingestLane": "catalog_spec",
      "notes": "PDF/HTML only. No 3D. Spec records + in-house parametric geometry." },

    { "id": "potter-roemer", "name": "Potter Roemer", "status": "needs_config",
      "sourceType": "bim_aggregator",
      "catalogUrl": "https://www.arcat.com/company/potter-roemer-34901",
      "apiKeyRef": "ARCAT_LOGIN", "lastSynced": null, "partCount": 0,
      "ingestLane": "both",
      "notes": "Ungated PDFs ship now; BIM needs ARCAT login. Confidence: medium." },

    { "id": "potter-electric", "name": "Potter Electric Signal", "status": "needs_config",
      "sourceType": "cadenas",
      "catalogUrl": "https://www.3dfindit.com/en/cad-bim-library/manufacturer/potter-electric-signal",
      "apiKeyRef": "THREEDFINDIT_ACCOUNT", "lastSynced": null, "partCount": 0,
      "ingestLane": "manufacturer_step",
      "notes": "CADENAS native (Revit/STEP) behind free 3Dfindit account. Confidence: medium." },

    { "id": "watts", "name": "Watts", "status": "needs_config",
      "sourceType": "rest_api",
      "catalogUrl": "https://www.traceparts.com/en/search/?CatalogPath=WATTS_983238924",
      "apiKeyRef": "TRACEPARTS_API_KEY", "secondaryApiKeyRef": "TRACEPARTS_TENANT_UID",
      "lastSynced": null, "partCount": 0, "ingestLane": "manufacturer_step",
      "notes": "TraceParts API key + Tenant UID (partner-gated). Confidence: medium." },

    { "id": "reliable", "name": "Reliable", "status": "enabled",
      "sourceType": "direct_download",
      "catalogUrl": "https://www.reliablesprinkler.com/resources/bim-library/",
      "apiKeyRef": null, "lastSynced": null, "partCount": 0,
      "ingestLane": "manufacturer_step",
      "notes": "Own FTP ZIP tree, Revit .rfa only (NO STEP). Soft lead-gen gate only." },

    { "id": "viking", "name": "Viking", "status": "needs_config",
      "sourceType": "rest_api",
      "catalogUrl": "https://www.traceparts.com/en/search/?CatalogPath=VIKING_EMEA",
      "apiKeyRef": "TRACEPARTS_API_KEY", "secondaryApiKeyRef": "TRACEPARTS_TENANT_UID",
      "lastSynced": null, "partCount": 0, "ingestLane": "manufacturer_step",
      "notes": "TraceParts EMEA via API key; US line via BIMobject/3Dfindit accounts." },

    { "id": "wheatland", "name": "Wheatland Tube", "status": "enabled",
      "sourceType": "bim_aggregator",
      "catalogUrl": "https://www.arcat.com/arcatcos/cos43/arc43463.html",
      "apiKeyRef": null, "lastSynced": null, "partCount": 0, "ingestLane": "both",
      "notes": "ARCAT ungated BIM + wheatland.com PDFs. Respect 429. Confidence: medium." },

    { "id": "bull-moose", "name": "Bull Moose Tube", "status": "enabled",
      "sourceType": "direct_download",
      "catalogUrl": "https://www.bullmoosetube.com/documentation/",
      "apiKeyRef": null, "lastSynced": null, "partCount": 0, "ingestLane": "catalog_spec",
      "notes": "Ungated PDFs only. No 3D — parametric pipe synthesized from dims." }
  ]
}
```

### 2.2 Secret handling (HARD RULE)

- The registry stores **only** the *name* of a credential (`apiKeyRef`), never a
  value. Resolution happens at sync time: `process.env[connector.apiKeyRef]` (Node)
  / `os.environ[...]` (Python), or a secret store on GX10. Mirrors the project rule
  "never propose raw provider API keys; OAuth/CLI/Agent SDK + user-supplied keys via
  config only."
- A connector with `apiKeyRef != null` whose env var is **unset** stays
  `needs_config` and the sync agent **skips it** (logged, never errors out, never
  fabricates parts).
- The UI never echoes a key back after entry; it shows only "configured / not
  configured" against the `apiKeyRef` name.

### 2.3 Connector interface + per-sourceType strategy

```ts
/** A part the connector discovered (geometry + spec metadata, pre-ingest). */
export interface DiscoveredPart {
  manufacturerId: string;
  productCode: string;
  modelName: string;
  category: string | null;
  /** Remote URL to the CAD asset (STEP/RFA/ZIP), or null for spec-only. */
  cadUrl: string | null;
  cadFormat: 'STEP' | 'RFA' | 'IGES' | 'DWG' | 'IFC' | 'ZIP' | null;
  /** Datasheet/spec PDF URL (T51 lane). */
  datasheetUrl: string | null;
  sourceUrl: string;
  license: string | null;
  /** Server-reported change token (ETag / Last-Modified / catalog hash). */
  remoteRevToken: string | null;
}

/** Result of fetchPart: a staged local file ready for sha256 + manifest upsert. */
export interface FetchedPart extends DiscoveredPart {
  localPath: string;   // staged file on disk
  sha256: string;      // REAL hash over the downloaded bytes
  byteSize: number;
}

/** A change record from listUpdates (drives incremental sync). */
export interface UpdateRecord {
  productCode: string;
  changeKind: 'added' | 'changed' | 'unchanged' | 'removed';
  remoteRevToken: string | null;
}

export interface Connector {
  readonly id: string;
  readonly sourceType: ConnectorSourceType;
  /** Enumerate the manufacturer's full part list (catalog walk / page crawl). */
  discover(): Promise<DiscoveredPart[]>;
  /** Download + stage ONE part's CAD, computing a real sha256 over real bytes. */
  fetchPart(part: DiscoveredPart): Promise<FetchedPart | null>;
  /** Diff against the last manifest to find new/changed parts since lastSynced. */
  listUpdates(sinceManifest: ConnectorRunManifest | null): Promise<UpdateRecord[]>;
}
```

Concrete strategy per `sourceType` (each honors robots.txt + rate-limits, carries
provenance, and fail-soft skips on block/error — never fabricates):

| sourceType | discover() | fetchPart() | listUpdates() | Examples |
|---|---|---|---|---|
| **rest_api** | Mint 24h Bearer from `apiKeyRef`+Tenant UID (`RequestToken`), walk catalog tree (`CatalogPath`) → product codes | `caddataavailability` → `cadRequest`/`cadFileUrl` → download STEP/Revit, sha256 | Re-walk tree, diff product set + `caddataavailability` tokens | Watts (`WATTS_983238924`), Viking (`VIKING_EMEA`), Victaulic Tier 2 |
| **cadenas** | Authenticated 3Dfindit session (`apiKeyRef` = account ref); enumerate manufacturer catalog path | Trigger native CAD generation (Revit/STEP), download, sha256 | Diff catalog listing + per-part config hash | Potter Electric Signal |
| **direct_download** | Crawl ungated resource/FTP/PDF index, enumerate ZIP/file URLs | HTTP GET file, sha256 over bytes; unpack ZIP per-platform | HEAD for ETag/Last-Modified/size; hash diff vs manifest | Victaulic (Tier 1 ZIPs), Reliable (FTP `.rfa` ZIPs), Bull Moose (PDF) |
| **bim_aggregator** | Headless-browser crawl of manufacturer hub page (JS-rendered); login via `apiKeyRef` when gated | Resolve per-format download link, download (authenticated if gated), sha256 | Diff product page set + per-file ETag; respect 429 backoff | Wheatland (ARCAT ungated), Potter Roemer (ARCAT login), Watts BIMobject fallback |
| **manual_import** | No-op (returns []) — surfaces "operator action required" | No-op | No-op | Argco (PDF scrape feeds T51 only; geometry via T54 drop) |

> **Lane discipline:** `fetchPart` for a geometry connector ends by handing the
> staged file to the **existing T54 import path** — `import-manufacturer-step.mjs`'s
> copy → sha256 → upsert into `manufacturer-step.json`. The connector does NOT
> invent a new upgrade path; it feeds bytes into the lane whose honesty gate
> (`isOperatorVerified`, real stepUrl + sha256) is already proven. Spec-only output
> feeds the T51 `crawl.py` → `manufacturer-catalog.json` shape.

### 2.4 Scheduled sync agent

**Runner:** a Node/Python job, `scripts/sync-connectors.mjs` (orchestrator) +
reuse of `import-manufacturer-step.mjs` (T54) and `crawl.py` (T51) as the ingest
back ends. Runnable on demand and on **GX10 cron**, with **local qwen3:30b-a3b for
triage only** (never in the ingest hot path — consistent with "cron jobs use local
Qwen on GX10; Claude/Codex are escalation targets only").

**Per-run algorithm (per `status: "enabled"` connector):**

1. Load registry; skip `needs_config` (missing env), `manual`, `disabled`.
2. Resolve `apiKeyRef` from env; if required and unset → mark `needs_config`,
   record reason, continue.
3. `listUpdates(lastManifest)` → `added`/`changed` set (incremental; skip
   `unchanged`).
4. For each changed part: `fetchPart` → stage file + **real sha256**.
   - Geometry → stage into `manufacturer-incoming/<slug>/`, run the T54 upsert so
     it enters `manufacturer-step.json` ONLY via `isOperatorVerified`.
   - Spec → emit a `crawl.py`-shaped entry into `manufacturer-catalog.json`.
5. Update that connector's `lastSynced` (ISO now) + `partCount`; write a per-run
   `ConnectorRunManifest` (productCode → sha256 → remoteRevToken) for next diff.
6. **Qwen triage (free, GX10):** feed the run summary (counts, errors, 403/429,
   new categories) to `qwen3:30b-a3b` (`numCtx:12288`, `forceJson:true`) to
   classify each anomaly as `auto-retry` / `needs-operator` / `escalate`. Qwen does
   **not** write parts or touch hashes — it only triages the log and routes
   escalations. Hard failures (auth expired, partner key revoked) escalate to HAL.

```ts
export interface ConnectorRunManifest {
  connectorId: string;
  runAt: string;                 // ISO
  parts: Record<string, { sha256: string; remoteRevToken: string | null }>;
  errors: { productCode?: string; kind: string; detail: string }[];
}
```

**GX10 cron (weekly is sufficient for a sprinkler catalog):**

```cron
# Sunday 03:00 — sync all enabled connectors, qwen triage, escalate hard failures
0 3 * * 0  cd /opt/.../halofire-studio/apps/studio && \
           node scripts/sync-connectors.mjs --all --triage-model qwen3:30b-a3b
```

**Honesty in the agent:** a blocked/expired source contributes **zero** parts and
is recorded with its error (exactly like `crawl.py`). `lastSynced` only advances on
a successful pull. No source ever fabricates an entry to hit a count.

### 2.5 UI — Add-Catalog / Manufacturers settings panel

A settings panel (`/settings/manufacturers`) reading
`manufacturer-connectors.json`, one row per connector:

- **Status chip:** Enabled (green) / Needs config (amber) / Manual (grey) /
  Disabled.
- **Add / configure:** operator pastes a **catalog link** (sets `catalogUrl`) or an
  **API key / login** (stored to the secret store under `apiKeyRef`'s NAME — the
  value never lands in the committed JSON). On save, a `needs_config` connector
  with all required creds flips to `enabled`.
- **Sync now:** triggers a single-connector run of the sync agent; streams progress.
- **Status readout:** `lastSynced`, `partCount`, last run's added/changed/error
  counts, and the honest `notes` (e.g. "Reliable is Revit-only, no STEP";
  "Victaulic Tier 2 needs a TraceParts partner key").
- **Manual connectors (Argco):** show "No automatable CAD source — use the import
  lane" with a link to the T54 drop folder workflow, never a fake "Enable" toggle.
- **Honesty surface:** the panel shows each connector's `ingestLane` and a tier
  badge so the operator sees Reliable feeds Revit/BIM while Watts/Viking feed STEP —
  and that everything still upgrades only through the real-sha256 gate.

---

## 3. Honest Phased Rollout

### Phase 0 — Automatable NOW (zero credentials)

Ship `status: "enabled"`, wire the sync agent, no operator action:

- **Victaulic (Tier 1)** — ungated `resource-software/` ZIP packages, hash diff.
  Richest first-party source (STP, 3D DWG, Revit MEP, CADmep, Bentley, Trimble).
- **Reliable** — own FTP ZIP tree (soft lead-gen gate only). **Revit `.rfa` only —
  feeds the BIM tier, not the STEP tier.** Be explicit in UI.
- **Wheatland Tube** — ARCAT ungated BIM (RFA/RVT/DWG/IFC) + own-site PDFs. *medium
  confidence — ARCAT pages 429'd to plain fetch; verify download flow with a real
  browser session first.*
- **Bull Moose Tube** — ungated PDFs; **no 3D exists** — synthesize parametric pipe
  from parsed dims (feeds catalog/spec, geometry generated in-house).
- **Argco** — spec/PDF scrape into T51 only (`manual` for geometry; no 3D anywhere).

> Phase-0 caveat: Wheatland is `medium` and Victaulic ZIP unpack-per-platform was
> not click-verified end-to-end. Treat first runs as supervised; the agent's
> fail-soft posture means a block yields zero parts, not bad parts.

### Phase 1 — Needs a user-supplied key/link or login (operator provisions once)

`status: "needs_config"` until the operator adds the credential in the UI:

- **Watts** — TraceParts **API Key + Tenant UID** (partner application). Strongest
  programmatic path; native STEP per part. *medium.*
- **Viking** — TraceParts **API key** for the EMEA line; **free BIMobject +
  3Dfindit accounts** for US Viking Corp SKUs missing from EMEA. *high.*
- **Potter Electric Signal** — **free 3Dfindit account** for native CADENAS
  Revit/STEP. *medium — JS-rendered; confirm per-part formats with a real session.*
- **Potter Roemer** — **ARCAT login** for BIM (ungated PDFs already shippable in
  Phase 0 as spec). *medium.*
- **Victaulic (Tier 2)** — optional TraceParts partner key for part-number-level
  CAD on top of the Phase-0 ZIPs.

### Phase 2 — One partner key unlocks many (highest leverage)

A single **TraceParts API Gateway** partnership (API Key + Tenant UID, 24h bearer
via `RequestToken`) is the documented REST API that unlocks **Watts + Viking-EMEA +
Victaulic Tier 2** through one credential and one `rest_api` strategy. **Apply for
the TraceParts partner key first** — it is the highest-leverage single action and
the only verified developer API in the entire set.

A **CADENAS/3Dfindit** partner/account similarly unlocks the native catalogs
(Potter Electric, Reliable cross-check, Viking US) — but note **Victaulic is
link-only on CADENAS**, so a CADENAS key does NOT help Victaulic. Provision
TraceParts before CADENAS.

### Never-automatable (honest)

- **Argco** geometry — no CAD anywhere; in-house parametric only.
- **Bull Moose** geometry — no CAD anywhere; in-house parametric pipe only.
- Pricing — not public from any manufacturer (distributor pricebooks the operator
  holds; unchanged from the parts-catalog research).

### Rollout summary

| Phase | Manufacturers | Operator action | Lane |
|---|---|---|---|
| 0 (now) | Victaulic T1, Reliable, Wheatland, Bull Moose, Argco(spec) | none | STEP/BIM + spec |
| 1 (key/login) | Watts, Viking, Potter Electric, Potter Roemer, Victaulic T2 | provision per-connector key/login in UI | STEP + BIM |
| 2 (partner) | TraceParts → Watts+Viking+Victaulic T2; CADENAS → Potter Electric+Reliable+Viking-US | one partner application each | STEP |

---

## 4. How a connector part flows into the existing lanes

```
Connector.discover()                    → DiscoveredPart[]
Connector.listUpdates(lastManifest)     → added/changed only
Connector.fetchPart()                   → staged file + REAL sha256
  ├─ geometry → manufacturer-incoming/<slug>/  → import-manufacturer-step.mjs (T54)
  │             → manufacturer-step.json upsert → isOperatorVerified gate (T44)
  │             → manufacturerVerifiedParts() / applyManufacturerStep()
  │             → modelStatus "manufacturer_verified" (real stepUrl + sha256 ONLY)
  └─ spec     → manufacturer-catalog.json (crawl.py shape) → manufacturer-catalog.ts (T51)
sync agent updates registry: lastSynced, partCount; writes ConnectorRunManifest
```

The connector is purely additive plumbing in front of the proven gates. It never
weakens `isOperatorVerified`, never sets `manufacturerExact` without real bytes,
and never marks `engineeringAccurate` outside an operator-verified STEP.

---

## 5. Honesty Contract

1. **NO HARDCODED KEYS.** The registry stores only `apiKeyRef` *names*; values come
   from env/secret store at runtime. OAuth/CLI/Agent SDK + user-supplied keys via
   config only. A missing key → `needs_config` + skip, never an error or a fake key.
2. **NO UNVERIFIED API CLAIMS.** The only developer REST API asserted anywhere is
   **TraceParts** (verified in the findings). No manufacturer-native API is claimed
   for any of the 8 — because none was verified. CADENAS is treated as an
   authenticated catalog, not a clean documented REST API (its findings say so).
3. **CONFIDENCE CARRIED FORWARD.** `medium` findings (Potter ×2, Watts, Wheatland)
   stay flagged medium in the matrix and UI; JS-rendered/403/429 caveats are
   preserved. First runs of medium connectors are supervised.
4. **TIER RULES INTACT.** `manufacturer_verified` requires a real `stepUrl` **and**
   `sha256` through `isOperatorVerified` — unchanged. Reliable's Revit-only output
   feeds the BIM tier, NOT the STEP tier. Bull Moose / Argco have NO geometry tier
   (parametric in-house only). No connector grants a tier its bytes don't earn.
5. **STATUS HONESTY.** Every connector is exactly one of automatable-now
   (`enabled`), needs-config (`needs_config`), or manual (`manual`). The UI never
   shows a fake "Enable" for a manual source. `lastSynced` advances only on a real
   successful pull; blocked sources contribute zero parts and record their error.
6. **LICENSE / REDISTRIBUTION.** Licensed CAD binaries stay gitignored and are
   never redistributed (T54 posture); the registry/manifest commit only hashes +
   URLs + the `license` string. Public availability ≠ redistribution rights.
7. **PRICING NOT PUBLIC.** Connectors ingest specs/geometry only; pricing remains
   the operator's distributor pricebooks.

---

### Source index (per-manufacturer findings, verbatim entry points)

Victaulic: [resource-software](https://www.victaulic.com/resource-software/) ·
[TraceParts dev](https://developers.traceparts.com/v2/) ·
[TraceParts Victaulic catalog](https://www.traceparts.com/en/search/victaulic?CatalogPath=VICTAULIC%3AVICTAULIC)
Argco: [fire-sprinkler tree](https://argco.com/fire-sprinkler.html) ·
[escutcheons submittal PDF](https://www.argco.com/pdf/submittals/escutcheons_submittal.pdf)
Potter Roemer: [ARCAT hub](https://www.arcat.com/company/potter-roemer-34901) ·
[file library](https://potterroemer.com/file-library-list.aspx)
Potter Electric: [3Dfindit catalog](https://www.3dfindit.com/en/cad-bim-library/manufacturer/potter-electric-signal) ·
[datasheets](https://www.pottersignal.com/documents/datasheet)
Watts: [TraceParts docs](https://developers.traceparts.com/docs) ·
[CAD files](https://www.watts.com/resources/cad-files) · catalog id `WATTS_983238924`
Reliable: [BIM library](https://www.reliablesprinkler.com/resources/bim-library/) ·
[Revit toolbar](https://www.reliablesprinkler.com/blog/revit-toolbar/)
Viking: [TraceParts VIKING_EMEA](https://www.traceparts.com/en/search/viking-emea-sprinkler-deluge?CatalogPath=VIKING_EMEA:VIKING_EMEA.010) ·
[caddataavailability](https://developers.traceparts.com/reference/get_v3-product-caddataavailability) ·
[BIMobject vikingcorp](https://www.bimobject.com/en/vikingcorp)
Wheatland: [ARCAT company](https://www.arcat.com/arcatcos/cos43/arc43463.html) ·
[resource library](https://www.wheatland.com/resource-library)
Bull Moose: [documentation](https://www.bullmoosetube.com/documentation/) ·
[ARCAT profile](https://www.arcat.com/company/bull-moose-tube-co-31127)

Existing lanes: `apps/studio/src/lib/manufacturer-step.ts` (T44) ·
`apps/studio/scripts/import-manufacturer-step.mjs` (T54) ·
`apps/studio/src/lib/manufacturer-catalog.ts` + `scripts/ingest-catalog/crawl.py` (T51)

*Generated as a connector-framework design for HaloFire Studio. Date context: 2026-06-05.*

# Parts Catalog & System Model — Research Foundation

> **Status:** Research foundation / design aid. **NOT code-certified.**
> Every numeric, taxonomy, and connectivity claim below is grounded in the
> cited public sources. Where a fact was inferred from search snippets rather
> than read from a primary document, it is flagged. See
> [§5 Honesty Contract](#5-honesty-contract) before relying on anything here
> for a bid, a takeoff, or an AHJ/PE-facing artifact.

This document defines, for HaloFire Studio:

1. The canonical **NFPA-13 component taxonomy** (categories + roles) for the parts catalog.
2. A concrete **connectivity data model** (`Port = {method, nominalSizeIn, role}` + compatibility rules) for how parts fit into a system.
3. A **catalog-ingestion plan** — which manufacturers/sources are realistically obtainable now (real URLs), what fields we capture, and which require an operator/login.
4. An **image→3D plan** with honest provenance tiers and where OpenClaw `generate_3d_model` fits.
5. A **honesty contract** binding the whole model.

It layers onto the catalog that already ships:
`apps/studio/public/parts/build123d-parts.json` (24 parametric STEP parts, all
`source: "build123d"`, marked `engineeringAccurate=false`),
`manufacturer-step.json` (currently `{ "entries": [] }` — the authoritative tier
slot waiting to be filled), and `pricebook-medians.json` (price layer; the user
owns the Victaulic pricebook). The provenance ladder defined here maps directly
onto those three files.

---

## 1. NFPA-13 Component Taxonomy

The taxonomy follows the canonical flow topology of a sprinkler system: water
supply → riser/control → distribution tree → final connection → head, plus the
cross-cutting subsystems (monitoring, alarm/detection, drainage/test, support,
signage). NFPA 13 Chapter 3 (Definitions) defines the **system riser** as the
aboveground pipe between the water supply and the mains that contains the
control valve and a waterflow alarm device; the distribution hierarchy
(riser → feed main → cross main → branch line) is from the same chapter.

> **Edition caveat:** Chapter numbering below reflects the **2016** edition
> layout shown by UpCodes. NFPA 13 was significantly reorganized in **2019**;
> there are also 2022 and 2025 editions. The local AHJ adopts a *specific*
> edition. Confirm the governing edition before citing any chapter or numeric
> limit. ([UpCodes Ch.3](https://up.codes/viewer/new_york/nfpa-13-2016/chapter/3/definitions),
> [UpCodes Ch.9](https://up.codes/viewer/idaho/nfpa-13-2016/chapter/9/hanging-bracing-and-restraint-of-system-piping))

### 1.1 Canonical flow topology (order of water)

```
municipal / private supply OR fire pump + tank
  → backflow preventer (RPZ or double-check, per local plumbing code/AHJ)
  → SYSTEM RISER  (control valve + waterflow alarm device live here)
  → system-defining valve (alarm-check / dry-pipe / preaction / deluge)
  → feed main → cross main → branch line
  → drop / sprig / armover
  → sprinkler head (discharge + heat sensor)

Fire Department Connection (FDC) ties in near the riser/check valve.
```

### 1.2 Component categories and roles

Each catalog `category` plus the `role` a part plays. Roles are *functional*, not
mechanical gender (mechanical mate-ability lives in the Port model, §2).

| Category | Role in system | Example members | Catalog status |
|---|---|---|---|
| `water_supply` | Source / pressure | municipal tap, private main, fire pump, tank, **backflow preventer** (RPZ vs double-check is jurisdiction-set), **FDC** | partial (FDC/backflow not yet modeled) |
| `riser` | Vertical supply + control assembly | system riser, riser nipple, **standpipe** (note: standpipe is primarily **NFPA 14**, often integrated) | pipe parts ship |
| `pipe` | Distribution | feed main, cross main, branch line; steel sch10/sch40, CPVC, copper | `pipe_sch10`, `pipe_sch40` |
| `fitting` | Direction / size / branch change | coupling, tee, cross, reducer (concentric/eccentric), 45/90 elbow, cap, **adapter/nipple** (method-bridging — see §2) | coupling, tee, cross, reducer, elbow_45, elbow_90, cap, grooved_coupling, grooved_flange_adapter |
| `final_connection` | Branch-line → head | **drop** (down to pendent), **sprig** (up to upright), **armover** (horizontal offset) | not yet discrete parts (modeled as pipe segments today) |
| `head` | Discharge + heat sensor | pendent, upright, sidewall, concealed, ESFR, dry-pendent | `head_pendent/upright/sidewall/concealed/esfr/dry_pendent` |
| `control_valve` | Main shutoff (listed indicating) | OS&Y gate, butterfly | `valve_osy_gate`, `valve_butterfly` |
| `system_valve` | System-defining riser valve | **alarm-check** (wet), **dry-pipe** (dry), **preaction**, **deluge** | `valve_alarm_check`, `valve_check`, `valve_deluge`, `valve_prv` |
| `air_supervision` | Dry / double-interlock preaction | air compressor, nitrogen generator, accelerator (QOD), exhauster | not yet modeled |
| `alarm_detection` | Flow/pressure → fire panel | **flow switch** (vane), **pressure switch**, water motor gong, retard chamber | not yet modeled (Potter devices, §3) |
| `monitoring` | Pressure / status | pressure gauges (supply & system side) | not yet modeled |
| `drainage_test` | Service / verification | main drain, auxiliary drains (drum drips / low-point), **inspector's test connection (ITC)** | AGF test-and-drain parts, §3 |
| `support_restraint` | Load + seismic | hangers, lateral sway brace, longitudinal sway brace, flexible coupling, sprig restraint | `hanger` |
| `signage` | Identification | control-valve sign, hydraulic design nameplate, main-drain sign, ITC sign, general-info sign, FDC sign | not modeled (data, not geometry) |

### 1.3 The four system types (system-defining valve drives the type)

| Type | Pipe contents | Defining valve | Use case |
|---|---|---|---|
| **Wet** | Water always present | **Alarm check valve** (check valve holds water; head opens → clapper lifts → port drives alarm) | Heated spaces (>40 °F†); fastest response |
| **Dry** | Pressurized air/N₂ until trip | **Dry pipe valve** (differential clapper; supervisory air bleeds off through opened head) | Freezing spaces; NFPA 13 caps water-delivery time to most remote head |
| **Preaction** | Dry + detection precondition | **Preaction valve** (electrically actuated deluge-type, released by separate NFPA 72 detection) | Water-sensitive areas (data centers, archives). Single-interlock (detection opens valve, then heads flow) vs double-interlock (BOTH detection AND a head) |
| **Deluge** | Open heads, no heat element | **Deluge valve** (held closed, opened by detection → floods all open heads at once) | High-hazard (hangars, chemical) |

> † Numeric thresholds in this section (>40 °F for wet, water-delivery ≤60 s for
> dry, relief ~175 psi, armover ~24 in steel / ~12 in copper, sprig restraint
> ≥4 ft) come from **secondary** sources and **vary by edition**. Verify against
> the AHJ-adopted edition. ([QRFS risers](https://blog.qrfs.com/266-fire-sprinkler-system-risers-part-2-wet-pipe-components-and-assemblies/),
> [Engineered Fire Systems guide](https://engineeredfiresystems.com/resources/wet-dry-preaction-deluge-fire-sprinkler-systems-guide/))

**Heads as sensors:** closed heads (wet/dry/preaction) use a heat-responsive
element (frangible glass bulb or fusible link) that opens *only* the head over
the fire. Deluge uses open heads/nozzles (no heat element) so all flow at once.

**Control valve must be a listed indicating valve** (OS&Y or butterfly) that
visibly shows open/closed and is supervised. Closed control valves are a leading
cause of sprinkler failure — hence the mandatory identification signage and
supervision. ([QRFS risers Pt.1](https://blog.qrfs.com/257-fire-risers-part-1-essential-fire-sprinkler-riser-components/),
[QRFS signs](https://blog.qrfs.com/87-complete-guide-to-fire-sprinkler-signs-and-system-marking/),
[Code Red alarm-check](https://coderedconsultants.com/insights/alarm-check-valves/),
[Tyco dry-pipe valve datasheet](https://www.firesprinklerpro.com/docs/dry-pipe-valve_TYCO.pdf))

---

## 2. Connectivity Data Model

A **part** is a body that carries a list of typed **ports**. A part fits into a
system because its ports connect to other parts' ports. **Bridging between two
joining methods (or two sizes) is *always* done by an explicit adapter/reducer
fitting that itself carries the two differing ports** — never by implicitly
joining unequal ports. This keeps the compatibility rule simple and forces the
catalog to actually contain the adapter parts (`grooved_flange_adapter` already
ships; NPT×groove, CPVC×brass, etc. are needed).

### 2.1 Joining methods (verified)

Threaded NPT, grooved-mechanical (Victaulic-style, rigid + flexible variants),
flanged (ASME B16.5, class 150/300), welded (steel), CPVC solvent-weld
(BlazeMaster/FlameGuard), copper soldered/brazed, push-to-connect (limited UL
scope). ([Victaulic FP spec](https://assets.victaulic.com/assets/uploads/literature/Victaulic%20FP%20Spec%20REV%20Jan%202015.pdf),
[QRFS fittings](https://blog.qrfs.com/335-sprinkler-pipe-fittings-and-couplings-types-and-uses/))

### 2.2 Port schema

```ts
type Method =
  | "THREADED_NPT" | "THREADED_BSPT" | "GROOVED" | "FLANGED"
  | "WELD_BUTT" | "SOLVENT_WELD" | "SOLDER_BRAZE" | "PUSH_CONNECT" | "PLAIN_END";

interface Port {
  method: Method;
  nominalSizeIn: number;        // 0.5 .. 8 (and up for AGS)
  role: "INLET" | "OUTLET" | "RUN" | "BRANCH"; // positional/semantic, NOT mechanical gender

  // method-specific, present only when relevant:
  grooveSystem?: "OGS" | "AGS";                 // GROOVED only
  threadGender?: "MALE" | "FEMALE";             // THREADED / SOLVENT_WELD socket-vs-spigot
  flangeClass?: 150 | 300 | 400 | 600 | 900 | 1500 | 2500; // FLANGED only
  flangeFace?: "RF" | "FF";                     // FLANGED only
  material: "STEEL" | "CPVC" | "COPPER" | "BRASS";
  brandLock?: string;                           // e.g. "BlazeMaster" (UL listing)
  pressureRatingPsi?: number;
}
```

> `role` is positional/semantic (which opening on a tee), **not** a true
> mechanical gender. The real mate-ability gender lives in `threadGender`
> (male mates female) and solvent-weld spigot-vs-socket. **Do not conflate the
> two.** ([QRFS BSPT vs NPT](https://blog.qrfs.com/451-bspt-vs-npt-fire-sprinkler-head-sizes-know-the-difference/))

### 2.3 Compatibility rule

Two ports `A`, `B` are **CONNECTABLE** iff **all** hold:

1. **Same method** — `A.method == B.method`. No implicit cross-method joining;
   cross-method is *only* via an explicit adapter fitting carrying both port types.
2. **Same nominal size** — `A.nominalSizeIn == B.nominalSizeIn`. Size mismatch is
   handled by a reducer fitting (two differently-sized ports), not by joining
   unequal ports directly.
3. **Method-specific predicates:**
   - `GROOVED` → same `grooveSystem` AND same nominal OD. **OGS and AGS grooves
     are NOT interchangeable** (OGS up to 12 in, AGS for 14 in+).
   - `THREADED` → same thread standard (NPT==NPT; **NPT ≠ BSPT** — 60° vs 55°,
     different crest form, non-interchangeable even at matching size/TPI) AND
     opposite `threadGender`.
   - `FLANGED` → same `flangeClass` (Class 150 and 300 have different bolt
     circles / counts / OD — non-interchangeable) AND compatible `flangeFace`
     AND a gasket present.
   - `SOLVENT_WELD` → same material family AND socket(female) mates spigot(male)
     AND (`brandLock` null OR equal — for UL listing).
   - `SOLDER_BRAZE` → copper-copper, socket mates pipe OD.
4. **Material physical compatibility** — don't solvent-weld steel; don't thread
   brittle CPVC without a metal insert.

**Compatible-with-warning tier:** brand-lock / UL-listing concerns (e.g. mixing
CPVC brands, or BlazeMaster requiring BlazeMaster pipe+fittings+cement together)
are *physically possible but not code-approved*. Model these as a warning tier,
not hard-incompatible (would be physically wrong) and not fully-compatible (would
be code-wrong). ([BlazeMaster install](https://www.blazemaster.com/en-us/install/solvent-cement-and-blazemaster-cpvc-fire-protection-systems),
[QRFS CPVC](https://blog.qrfs.com/179-cpvc-pipe-and-fittings-in-fire-sprinkler-systems-use-and-care/))

### 2.4 Verified dimensional data (ready to encode)

**Victaulic OGS roll-groove dimensions** (pub 25.01; OD / gasket-seat A /
groove-width B / groove-dia C / depth D, inches). Geometry is keyed to OD —
same nominal size + same groove system = interchangeable across brands.

| Size | OD | A | B | C | D |
|---|---|---|---|---|---|
| 1" | 1.315 | 0.625 | 0.281 | 1.190 | 0.063 |
| 1¼" | 1.660 | 0.625 | 0.281 | 1.535 | 0.063 |
| 1½" | 1.900 | 0.625 | 0.281 | 1.775 | 0.063 |
| 2" | 2.375 | 0.625 | 0.344 | 2.250 | 0.063 |
| 2½" | 2.875 | 0.625 | 0.344 | 2.720 | 0.078 |
| 3" | 3.500 | 0.625 | 0.344 | 3.344 | 0.078 |
| 4" | 4.500 | 0.625 | 0.344 | 4.334 | 0.083 |
| 5" | 5.563 | 0.625 | 0.344 | 5.395 | 0.084 |
| 6" | 6.625 | 0.625 | 0.344 | 6.455 | 0.085 |
| 8" | 8.625 | 0.750 | 0.469 | 8.441 | 0.092 |

Source: Victaulic pub 25.01 ([canonical](https://assets.victaulic.com/assets/uploads/literature/25.01.pdf),
extracted via [garitec mirror](https://www.garitec.com/victaulic/Pdf-Victaulic/25.01-StandardGroveSpecifications.pdf)).
**Caveat:** these are **ROLL**-groove (steel/IPS). **CUT**-groove movement/deflection
tolerances differ (roll-grooved pipe allows ~half the end-separation of cut). The
table was extracted via pypdf scraping of a third-party mirror; spot-check against
the canonical Victaulic PDF before it drives manufacturing or AHJ-facing output.
AGS numeric table (pub 25.09) and cut-groove (pub 25.05) were *referenced but not
extracted*. ([AGS 25.09](https://assets.victaulic.com/assets/uploads/literature/25.09.pdf))

**NPT facts:** US sprinkler heads use 1/2" or 3/4" NPT inlets; both are 14 TPI,
60° tapered, 1/2" major dia ≈ 0.840 in. Thread type does not change K-factor (no
separate SIN). ([Pyromation NPT chart](https://www.pyromation.com/downloads/data/npt_thread_chart.pdf),
[QRFS BSPT vs NPT](https://blog.qrfs.com/451-bspt-vs-npt-fire-sprinkler-head-sizes-know-the-difference/))

**Flange scope (qualitative — verified):** ASME B16.5 covers NPS ½–24 in classes
150/300/400/600/900/1500/2500; FP commonly uses 150 (≈285 psi @100 °F) and 300
(≈740 psi); RF height ≈ 1/16 in. **Not obtained this session:** the per-NPS
numeric bolt-circle/OD/bolt-count table (WebFetch could not parse it — pull from
the standard or a manufacturer chart next:
[FERROBEND Class 150](https://www.ferrobend.com/dimensions/ansi-asme/flange/b16.5-class-150/),
[tpmcsteel 150/300](https://tpmcsteel.com/flanged-end-connection-as-asme-b16-5-class-150-class-300/)).

**CPVC (BlazeMaster):** 3/4–3 in, 175 psi @150 °F, solvent-weld socket only,
brand-locked for UL listing, transitions to metal via threaded brass adapters.

**Fitting port configs (Victaulic 07.01):** coupling = 2 same-size same-method
ports; reducer = 2 different-size ports; tee = 3 ports (2 run + 1 branch, branch
may differ in size/method); elbow = 2 ports; adapter/nipple = 2 *different-method*
ports. ([Victaulic 07.01](https://assets.victaulic.com/assets/uploads/literature/07.01.pdf))

> The local catalog already ships these fitting shapes as parametric STEP — the
> port model layers directly onto `build123d-parts.json`.

---

## 3. Catalog Ingestion Plan

### 3.1 Captured fields (per catalog entry)

`model` / SIN, `mfr`, `category` (§1.2), `kFactor` (heads; UL/FM-listed
discharge coefficient — see warning below), `ports[]` (§2 — method, nominal size,
groove/thread/flange specifics), `tempRatings`, `responseType`, `finishes`,
`sku`/`productCode`, `pressureRatingPsi`, `dataSheetUrl`, `bimUrl`, `provenance`
(§4), plus the existing `dimensions` + `sha256` for any generated geometry.
**Pricing is captured separately** in the pricebook layer (`pricebook-medians.json`)
— it is **not public from any manufacturer** (see §3.4).

### 3.2 Obtainable NOW, no login (text/spec via free public PDFs / HTML)

All eight publish free public data-sheet PDFs (model/SIN, K-factor, NPT/groove
size, temp ratings, response, finishes). **Start with Tyco** — its product
listing pages are structured HTML enumerating every SIN with K-factor and linking
straight to both PDF sheets and Revit families.

| Mfr / source | What | Real URL pattern / entry point | BIM |
|---|---|---|---|
| **Tyco / Johnson Controls** (sprinklers) | Best structured source. TY-FRB page lists every SIN (TY1131/TY1231 K2.8, TY2131/TY2231 K4.2, TY313/TY323/TY3131/TY3231 K5.6, TY4131/… K8.0), orientations, links to TFP171/TFP172 PDFs **and on-page Revit/BIM** | [listing page](https://www.tyco-fire.com/products-and-solutions/sprinklers-nozzles-and-accessories/standard-coverage/ty-frb_fis/series-ty-frb-sprinklers) · sheets via `docs.johnsoncontrols.com/tycofire/api/khub/documents/<id>/content` | **Free, on-page** |
| **Viking** (sprinklers) | Free public PDFs (VK SIN, K-factor, NPT, temp, finishes) | legacy `/databook/sprinklers/<form>.pdf`; current `/sites/default/files/<YYYY-MM>/<form>.pdf` — **date-stamped folders rot; crawl product/Revit pages for current links** | [Revit families](https://www.vikinggroupinc.com/digital/viking-design-tools/revit-families) (own site) + [BIMobject](https://www.bimobject.com/en/vikingcorp) |
| **Reliable** (sprinklers) | Numeric bulletin PDFs (070=P25 ESFR K25.2, 063=F1FR80 K8.0, 182=F1-56/F1FR56/F1-80) | `reliablesprinkler.com/files/bulletins/<NNN>.pdf` — trivially enumerable | [BIMobject](https://www.bimobject.com/en-us/reliable/product/f1fr) (free) |
| **Victaulic** (fittings/valves/couplings) | Submittal PDFs (06.01 grooved system, 23.02 Style 31, 06.04 Style 77, 100.01 OGS-200, 07.01 fittings, 25.01 grooves) | `assets.victaulic.com/assets/uploads/literature/<NN.NN>.pdf` | free families on [MEPcontent](https://www.mepcontent.com/en/manufacturers/detail/42/victaulic/) (**free account**); [Tools for Revit](https://www.victaulicsoftware.com/tools-for-revit/) is **paid** |
| **Globe** (sprinklers; a Victaulic company) | Scrapable product pages (GL-QR/DC/SW, GL-SR; K2.8/4.2/5.6/8.0); some sheets on Victaulic assets (GFS- prefix) | [product page](https://globesprinkler.com/product-detail/gl5615-gl-qr) · [GFS-110](https://assets.victaulic.com/assets/uploads/literature/GFS-110.pdf) | [PARTcommunity catalog](https://b2b.partcommunity.com/community/PDF+Catalogs/765283/10177/globe-fire-sprinkler-digital-catalog-en) (**free account**) |
| **Senju** (sprinklers) | Free PDFs (SS SIN, K-factor, temp, finishes, working pressure) | `senjusprinkler.com/wp/wp-content/themes/mystile/pdf/Datasheet/<MODEL>-Datasheet.pdf`; hub at [/technical-data/](https://www.senjusprinkler.com/technical-data/) | — |
| **Potter** (devices, not sprinklers) | Waterflow/pressure/supervisory switch PDFs (5401146_VSR, 5400928_PS10, 5400933_PS120) | `pottersignal.com/product/datasheet/<MFGNUM>_<MODEL>.pdf` | — |
| **AGF** (drains / test-and-drain) | Tech-data PDFs (pressure 300/400 psi, sizes 3/4–2 in, K2.8–25.2, NPT vs grooved) | `content.agfmfg.com/assets/Uploads/TechDataSheet-<MODEL>.pdf`; [test-and-drain pages](https://agfmfg.com/testandrain/) | on ARCAT |

### 3.3 Require operator / free account (NOT assume-OK mass ingestion)

BIM/CAD aggregators — **BIMobject**, **MEPcontent**, **PARTcommunity** — "free"
downloads generally require account registration and impose terms that restrict
bulk scraping/redistribution. These are for **manual / account download**, not
mass ingestion. Prefer manufacturer-direct BIM (Tyco on-page, Viking own site).
Victaulic's in-Revit fabrication plugin is **paid** (30-day trial).

### 3.4 NOT obtainable publicly

**Manufacturer list/price data is not published anywhere public.** Pricing must
come from **distributor pricebooks the operator holds** (the user already owns the
Victaulic pricebook legitimately). Public sheets supply specs/dimensions only.

### 3.5 Ingestion mechanics (mandatory)

- **PDF text extraction is required.** WebFetch **could not** parse any of these
  PDFs (compressed font/stream binaries). Use a real PDF pipeline — **PyMuPDF /
  pdfplumber + table parse, OCR fallback**. Do **not** rely on naive
  HTML-to-markdown, and treat any K-factor/SIN value taken from a search snippet
  as **needing per-PDF verification**.
- **Crawl index/listing pages, don't hardcode paths.** URL patterns
  (Reliable `/bulletins/NNN.pdf`, Potter `/datasheet/NUM_MODEL.pdf`, Victaulic
  `/literature/NN.NN.pdf`, AGF `/TechDataSheet-MODEL.pdf`) are confirmed *for the
  sampled files only* — full catalog counts are unknown. Viking embeds a
  date-folder that changes on revision; crawl the product/Revit pages each run.
- **Respect robots.txt + rate-limit.** Crawler-blocking/rate limits were not
  verified this session — check `robots.txt` and throttle before any crawl.
- **Legal:** public availability ≠ redistribution rights. Ingesting extracted
  spec fields (K-factor, sizes, temp) into an internal catalog is normal industry
  practice, but **re-hosting the PDFs or copying marketing copy/images** could
  raise IP issues — confirm intended use.
- **HTML-scrape caveat:** only the Tyco TY-FRB listing page was actually fetched
  and confirmed scrapable with on-page BIM links. Globe / Senju `/technical-data`
  / AGF pages are *inferred* scrapable from search results — verify selectors
  before building a scraper.

---

## 4. Image→3D Plan & Provenance Tiers

### 4.1 Provenance ladder (blunt, ordered by trust)

```
manufacturer_step  (AUTHORITATIVE — listed, code-compliant dimensions)
        > dimensioned_parametric / build123d  (real CAD dims, parametric APPROXIMATION)
        >>> ai_image_mesh  (appearance only — NO trustworthy dims, NO scale)
```

| Tier | provenance flag | dimensions | Source | Maps to file |
|---|---|---|---|---|
| **Authoritative** | `manufacturer_step` | listed / code-compliant | Manufacturer native STEP/Revit/BIM — [Victaulic resource-software](https://www.victaulic.com/resource-software/), [Tyco CAD](https://www.tyco-fire.com/index.php?P=cad), [Tyco Revit](https://www.tyco-fire.com/index.php?P=tdrevit) | `manufacturer-step.json` (currently empty — fill this) |
| **Approximation** | `dimensioned_parametric` | real CAD dims, parametric (NOT manufacturer-exact/AHJ/PE) | build123d, already shipping (`engineeringAccurate=false`) | `build123d-parts.json` |
| **Appearance only** | `ai_generated` | **none trustworthy, no scale** | TRELLIS.2 / Hunyuan3D 2.1 / Tripo / Meshy / OpenClaw `generate_3d_model` | (decorative only — not in priced lanes) |

### 4.2 Why AI image→3D is appearance-only (verified by absence of any claim)

- **No vendor claims dimensional accuracy.** Neither the official
  [TRELLIS.2 page](https://microsoft.github.io/TRELLIS.2/) nor the
  [Hunyuan3D 2.1 paper (arXiv 2506.15442)](https://arxiv.org/html/2506.15442v1)
  makes *any* claim of metric precision or real-world scale; both position for
  visual/creative use (gaming, VR, design viz, PBR), never CAD/precision.
- **Scale is mathematically unrecoverable.** Single-image 3D normalizes to a unit
  cube; absolute real-world scale from one 2D image is fundamentally impossible
  without external depth/scale priors. ([LRM arXiv 2311.04400](https://arxiv.org/pdf/2311.04400),
  [Learn Your Scales arXiv 2503.15412](https://arxiv.org/pdf/2503.15412))
- **Watertight ≠ correct.** Hunyuan3D 2.1 forces watertightness via an IGL SDF
  wrap of defective geometry (papers over errors); TRELLIS.2 supports
  non-watertight. Watertightness says nothing about thread/orifice/groove accuracy.
- **The FP dimensions AI cannot hit are *regulated/listed* features:** K-factor
  (UL/FM-listed discharge coefficient tied to exact orifice geometry; NFPA 13
  nominal-K bands e.g. K8.0 = 7.4–8.2 — [QRFS](https://blog.qrfs.com/428-what-is-a-fire-sprinkler-k-factor-and-which-k-factor-do-i-have-need/),
  [NFPA 13 K-table](https://industrialmonitordirect.com/blogs/knowledgebase/k-factor-sprinkler-selection-guide-by-hazard-type-per-nfpa-13)),
  NPT taper (ANSI/ASME B1.20.1), C606 grooved-coupling tolerances
  ([AWWA C606](https://www.ductileironsuppliers.com/awwa-c606-explained-technical-breakdown-grooved-shouldered-joint-standards.html)).
  Being wrong on these is a **code/listing violation**, not a cosmetic flaw.
- "~80–95% shape accuracy" quoted for [Tripo/Meshy](https://www.meshy.ai/compare/meshy-vs-tripo)
  is **front-facing silhouette similarity, not engineering tolerance** — back/unseen
  faces are hallucinated; their own guidance says verify scale in your editor.

### 4.3 Where OpenClaw `generate_3d_model` fits

- **It is live but NOT GX10-independent.** The OpenClaw bridge on GX10
  (`http://100.116.75.108:19002`, status `ready`) exposes `generate_3d_model` as a
  confirmed tool alias — callable today via the codex/HAL bridge — **but it runs
  ON the GX10 GPU** (local_core `qwen3:30b-a3b` + `qwen3-vl:4b` vision on that
  box). A genuinely GX10-independent path is a cloud API
  ([fal.ai TRELLIS.2/Hunyuan3D](https://fal.ai/models/fal-ai/hunyuan3d/v2),
  Tripo, Meshy). Either way the output is the **same low `ai_generated` tier**.
- **SHOULD use for:** thumbnails/placeholders for parts with no CAD, "what it
  looks like" in the 3D viewer, demo polish, non-load-bearing scene dressing.
- **SHOULD NOT use for:** takeoff geometry, BOM key selection, clash/fit checks,
  hydraulic/K-factor anything, any dimension a price or quantity depends on, or
  anything touching an AHJ/PE/manufacturer/listing claim.
- Every AI mesh must be flagged `provenance: "ai_generated"`,
  `engineeringAccurate: false`, `dimensionsTrusted: false`, and **excluded from
  any priced/regulated lane** — consistent with the project's existing
  fail-closed posture.

> Note: viability is confirmed at the **bridge/capability level** (tool present,
> status `ready`), not by a produced artifact — `generate_3d_model` was not run
> end-to-end this session. The "no trustworthy scale" conclusion rests on the
> architecture (same unit-cube-normalized generative class), not a measured GX10
> output.

---

## 5. Honesty Contract

This is the binding posture for everything above and everything built on it. It
extends the project's existing `engineeringAccurate=false` stance.

1. **DESIGN AID, NOT CODE-CERTIFIED.** This system model assists design and
   bidding. It is **not** an AHJ-approved or PE-stamped design. Exact sizing,
   spacing, and hydraulic numbers must come from the **AHJ-adopted NFPA 13
   edition + the project's stamped hydraulic calcs**. A licensed PE and the AHJ
   are required for any installable/permitted design.
2. **AI MESHES ARE VISUAL, NOT DIMENSIONALLY EXACT.** Any image→3D mesh is
   `ai_generated` / `dimensionsTrusted=false` with no real-world scale. It is
   decorative/visual-reference only and is **barred from takeoff, pricing, and
   regulated lanes**.
3. **NOTHING CLAIMS MANUFACTURER-EXACT WITHOUT REAL STEP.** Only
   `manufacturer_step` entries (native manufacturer STEP/Revit/BIM) may be
   presented as manufacturer-exact / listed-dimension. `dimensioned_parametric`
   (build123d) is an honest **approximation** — real CAD dims, NOT
   manufacturer-exact/AHJ/PE. `ai_generated` carries no dimensional claim at all.
4. **K-FACTOR, NPT, AND GROOVE TOLERANCES ARE LISTED/REGULATED FEATURES.** They
   require parametric CAD or manufacturer source — never an AI-from-photo mesh.
   NFPA 13 nominal-K bands, ANSI/ASME B1.20.1 NPT, and AWWA/ANSI C606 grooves are
   pass/fail; do not let any tier imply listing fidelity it does not have.
5. **NO NFPA 13 TEXT WAS READ DIRECTLY** this session. Taxonomy/threshold claims
   are paraphrased from secondary sources (QRFS, Engineered Fire Systems, Code
   Red, manufacturer datasheets) and the standard's visible structure (UpCodes
   TOC). NFPA 13 is copyrighted — read-only access is via NFPA LiNK (registration)
   or a purchased copy. Verify all NFPA-attributed specifics against the adopted
   edition before AHJ-facing use.
6. **VERIFY-BEFORE-ENCODE flags** (carried from research): the groove table was
   pypdf-scraped from a third-party mirror (spot-check vs canonical Victaulic
   PDF); the ASME B16.5 numeric flange table was *not* obtained; individual
   K-factor/SIN values quoted from search snippets need per-PDF verification;
   push-to-connect UL size/pressure limits are unconfirmed (encode cautiously);
   RPZ-vs-double-check backflow is jurisdiction-set, not NFPA-13-set; standpipes
   are primarily NFPA 14.
7. **PRICING IS NOT PUBLIC.** It comes only from distributor pricebooks the
   operator holds — never claimed from a manufacturer source.

---

### Source index

NFPA 13 / taxonomy:
[UpCodes Ch.3](https://up.codes/viewer/new_york/nfpa-13-2016/chapter/3/definitions) ·
[UpCodes Ch.9](https://up.codes/viewer/idaho/nfpa-13-2016/chapter/9/hanging-bracing-and-restraint-of-system-piping) ·
[NFPA blog: system types](https://www.nfpa.org/news-blogs-and-articles/blogs/2021/03/26/sprinkler-system-basics-types-of-sprinkler-systems) ·
[QRFS risers Pt.1](https://blog.qrfs.com/257-fire-risers-part-1-essential-fire-sprinkler-riser-components/) ·
[QRFS risers Pt.2](https://blog.qrfs.com/266-fire-sprinkler-system-risers-part-2-wet-pipe-components-and-assemblies/) ·
[QRFS signs](https://blog.qrfs.com/87-complete-guide-to-fire-sprinkler-signs-and-system-marking/) ·
[QRFS seismic](https://blog.qrfs.com/320-nfpa-13-seismic-bracing-requirements/) ·
[Engineered Fire Systems](https://engineeredfiresystems.com/resources/wet-dry-preaction-deluge-fire-sprinkler-systems-guide/) ·
[Code Red alarm-check](https://coderedconsultants.com/insights/alarm-check-valves/) ·
[Tyco dry-pipe valve](https://www.firesprinklerpro.com/docs/dry-pipe-valve_TYCO.pdf)

Connectivity / dimensions:
[Victaulic 25.01 grooves](https://assets.victaulic.com/assets/uploads/literature/25.01.pdf) ·
[Victaulic 25.09 AGS](https://assets.victaulic.com/assets/uploads/literature/25.09.pdf) ·
[Victaulic 07.01 fittings](https://assets.victaulic.com/assets/uploads/literature/07.01.pdf) ·
[Victaulic FP spec](https://assets.victaulic.com/assets/uploads/literature/Victaulic%20FP%20Spec%20REV%20Jan%202015.pdf) ·
[QRFS fittings](https://blog.qrfs.com/335-sprinkler-pipe-fittings-and-couplings-types-and-uses/) ·
[QRFS BSPT vs NPT](https://blog.qrfs.com/451-bspt-vs-npt-fire-sprinkler-head-sizes-know-the-difference/) ·
[Pyromation NPT chart](https://www.pyromation.com/downloads/data/npt_thread_chart.pdf) ·
[FERROBEND B16.5-150](https://www.ferrobend.com/dimensions/ansi-asme/flange/b16.5-class-150/) ·
[tpmcsteel B16.5 150/300](https://tpmcsteel.com/flanged-end-connection-as-asme-b16-5-class-150-class-300/) ·
[BlazeMaster install](https://www.blazemaster.com/en-us/install/solvent-cement-and-blazemaster-cpvc-fire-protection-systems) ·
[QRFS CPVC](https://blog.qrfs.com/179-cpvc-pipe-and-fittings-in-fire-sprinkler-systems-use-and-care/) ·
[SharkBite Fire fittings](https://www.sharkbite.com/sites/default/files/files/SharkBite_Fire_Fittings_BRO_UPDATE-WEB.pdf)

Ingestion sources: see §3.2 table.

Image→3D:
[TRELLIS.2](https://microsoft.github.io/TRELLIS.2/) ·
[TRELLIS.2-4B card](https://huggingface.co/microsoft/TRELLIS.2-4B) ·
[Hunyuan3D 2.1 paper](https://arxiv.org/html/2506.15442v1) ·
[fal.ai Hunyuan3D](https://fal.ai/models/fal-ai/hunyuan3d/v2) ·
[Meshy vs Tripo](https://www.meshy.ai/compare/meshy-vs-tripo) ·
[Tripo 3D-print guide](https://www.tripo3d.ai/3d-print/ai-image-to-3d-model-conversion-tool-guide) ·
[LRM](https://arxiv.org/pdf/2311.04400) ·
[Learn Your Scales](https://arxiv.org/pdf/2503.15412) ·
[Meta SAM 3D](https://ai.meta.com/blog/sam-3d/) ·
[K-factor (QRFS)](https://blog.qrfs.com/428-what-is-a-fire-sprinkler-k-factor-and-which-k-factor-do-i-have-need/) ·
[NFPA 13 K-table](https://industrialmonitordirect.com/blogs/knowledgebase/k-factor-sprinkler-selection-guide-by-hazard-type-per-nfpa-13) ·
[AWWA C606](https://www.ductileironsuppliers.com/awwa-c606-explained-technical-breakdown-grooved-shouldered-joint-standards.html) ·
[Victaulic resource-software](https://www.victaulic.com/resource-software/) ·
[Tyco CAD](https://www.tyco-fire.com/index.php?P=cad) ·
[Tyco Revit](https://www.tyco-fire.com/index.php?P=tdrevit)

*Generated as a research foundation for HaloFire Studio. Date context: 2026-06-05.*

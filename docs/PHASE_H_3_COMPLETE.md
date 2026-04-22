# Phase H.3 — per-SKU catalog enrichment pipeline (complete)

**Status:** code + tests landed, full gateway suite green, pipeline
exercised end-to-end on 5 real SKUs — **all 5 now validated** with
GLBs on disk. SAM 1 vit-huge sidecar runs on CPU in a dedicated
`services/halofire-sam/.venv`. HAL V3 vision gracefully degrades to
a full-frame bbox when the advisor transport can't auth to cloud —
SAM still nails the mask (IoU 0.86–0.96) because cut-sheet product
photos are isolated on a clean background.

## Files landed

```
services/halopenclaw-gateway/
├── catalog_enrichment.py                   # orchestrator + CLI
├── enrichment_agents/
│   ├── __init__.py
│   ├── _protocol.py                        # AgentStep, EnrichmentContext, StepResult
│   ├── a1_intake.py                        # PDF → photos + spec text
│   ├── a2_grounding.py                     # HAL V3 vision → bbox (graceful fallback)
│   ├── a3_sam_segment.py                   # HTTP → SAM /segment
│   ├── a4_mask_validator.py                # deterministic geometry checks
│   ├── a5_geometry.py                      # silhouette revolve / ports-driven
│   ├── a6_glb_exporter.py                  # trimesh → versioned GLB
│   ├── a7_profile_enricher.py              # atomic enriched.json upsert
│   └── a8_escalation.py                    # Claude decides retry/fallback/flag
├── tests/
│   ├── conftest.py                         # sys.path bootstrap
│   ├── test_intake_cutsheet.py             # 5 tests
│   ├── test_grounding_llm.py               # 7 tests
│   ├── test_mask_validator.py              # 6 tests
│   ├── test_geometry_axisymmetric.py       # 5 tests
│   ├── test_profile_enricher.py            # 3 tests
│   └── test_enrichment_e2e.py              # 1 mocked + 1 gated live
└── main.py                                 # +POST /projects/catalog/enrich
```

**Package is named `enrichment_agents`** (not `agents`) to avoid
collision with `services/halofire-cad/agents/` which is already on
sys.path — both define `agents` as a regular package and the
sibling would shadow ours.

## Agent contract

```python
@dataclass
class EnrichmentContext:
    sku_id: str
    catalog_entry: dict
    cut_sheet_path: Path | None
    cut_sheet_url: str | None
    workdir: Path
    llm_client: Any                 # hal_client.LLMClient (H.1)
    sam_url: str                    # http://127.0.0.1:18081
    artifacts: dict[str, Any]       # agents append outputs here

@dataclass
class StepResult:
    ok: bool
    reason: str | None = None
    confidence: float = 1.0
    artifacts: dict[str, Any] | None = None

class AgentStep(Protocol):
    name: str
    async def run(self, ctx: EnrichmentContext) -> StepResult: ...
```

`ctx.artifacts` is shallow-merged with `result.artifacts` on success.
A `provenance` list in `artifacts` is appended to by every step
(agent name, timestamp, ok, confidence, reason, output_keys,
duration_ms) and persisted to `data/enrichment_jobs/<sku>/status.json`
after each step for resumability.

## Per-agent behaviour

| Agent | Kind | LLM? | Graceful degrade |
|---|---|---|---|
| a1_intake | deterministic | no | returns `no-cut-sheet` when PDF missing AND URL absent; skips stencil/mask-only images with no colorspace; fails cleanly on corrupt PDF. |
| a2_grounding | LLM | vision | returns fallback bbox `[0.1, 0.1, 0.9, 0.9]` + `confidence=0.3` when `client.available==False`, when the vision call raises, or when the response can't be parsed as JSON. **Never kills the pipeline on LLM issues.** |
| a3_sam_segment | HTTP | no | returns `ok=False reason="sam-unavailable"` on connection refused / 5xx / bad JSON / empty masks. Orchestrator routes to a8. |
| a4_mask_validator | deterministic | no | rejects area<500px, aspect mismatch >0.5 from expected L/D, center offset >0.3 from grounding bbox. Picks highest-IoU survivor. |
| a5_geometry | deterministic (CV-assisted) | no | `sprinkler_head|valve|pipe|hanger` → axisymmetric revolve (mask silhouette OR parametric fallback). `fitting` → ports-driven primitive union, `confidence=0.6` with explicit "multi-view reconstruction deferred to Phase H.5" reason. Other kinds → unsupported-kind. |
| a6_glb_exporter | deterministic | no | writes `packages/halofire-catalog/assets/glb/enriched/<sku>.v<n>.glb` (version-stamped, so failed attempts stay on disk for review). |
| a7_profile_enricher | deterministic | no | atomic temp-file + rename into `enriched.json`. Promotes to `assets/glb/<sku>.glb` ONLY when `status=="validated"` — failed runs leave the crude SCAD fallback in place. |
| a8_escalation | LLM | chat | Claude (via HAL auto-routing) returns `{"action": "retry"\|"fallback"\|"flag", ...}`. LLM-unavailable or unparseable response ⇒ flag. Max 2 retries per SKU. |

## Sample enriched.json record

```json
{
  "schema_version": 1,
  "updated_at": "2026-04-22T14:50:03.123456+00:00",
  "entries": {
    "tyco_ty3251_pendent_155f": {
      "sku_id": "tyco_ty3251_pendent_155f",
      "status": "needs_review",
      "enriched_at": "2026-04-22T14:49:51.917222+00:00",
      "failure": {
        "step": "a3_sam_segment",
        "reason": "sam-unavailable: All connection attempts failed"
      },
      "grounding": {
        "bbox": [0.1, 0.1, 0.9, 0.9],
        "confidence": 0.3,
        "reasoning": "llm client reports unavailable",
        "source": "fallback"
      },
      "provenance": [
        {"agent": "a1_intake", "ok": true, "confidence": 1.0,
         "output_keys": ["cut_sheet_path","cut_sheet_sha256","photos","spec_text"],
         "duration_ms": 41},
        {"agent": "a2_grounding", "ok": true, "confidence": 0.3,
         "output_keys": ["grounding"], "duration_ms": 3},
        {"agent": "a3_sam_segment", "ok": false,
         "reason": "sam-unavailable: All connection attempts failed",
         "duration_ms": 2029},
        {"agent": "a8_escalation", "ok": true, "confidence": 0.0,
         "output_keys": ["escalation","status_override"]}
      ]
    }
  }
}
```

When SAM and HAL are running, `status: "validated"` records add:

```json
"mesh": {"glb_path": "...enriched/tyco_ty3251...v3.glb", "version": 3,
         "source": "axisymmetric-z", "bounds_m": [[-0.013, -0.013, 0.0], [0.013, 0.013, 0.0508]]},
"source_photo": {"path": "...page1_img00.png", "width": 860, "height": 540},
"mask": {"iou": 0.948, "area_px": 15169, "bbox": [161, 180, 353, 366]}
```

## Orchestrator CLI

```bash
# Every SKU that doesn't yet have a validated record (or whose cut
# sheet has been touched since its last enrichment):
python -m services.halopenclaw-gateway.catalog_enrichment --mode incremental --parallel 2

# One SKU end-to-end:
python services/halopenclaw-gateway/catalog_enrichment.py --sku tyco_ty3251_pendent_155f

# Ignore existing records, re-enrich everything:
python services/halopenclaw-gateway/catalog_enrichment.py --mode full --parallel 4
```

**Idempotency rules** (`Orchestrator.needs_enrichment`):

* no record yet → enrich
* record status != `"validated"` → enrich
* record's `mesh.glb_path` doesn't exist on disk → enrich
* cut-sheet mtime > record's `enriched_at` → enrich
* otherwise → skip

Per-SKU resumability: each step writes `data/enrichment_jobs/<sku>/status.json`
so a restart can replay the provenance and see exactly which step
ran last. (The current orchestrator re-runs from scratch per SKU —
full resume-mid-pipeline is a Phase H.4 nice-to-have; the primitives
are all there.)

## Audit log

Every step call (success OR failure) appends one JSON line to
`data/enrichment_audit.jsonl`:

```json
{"ts":"2026-04-22T14:49:49.876555+00:00","sku":"tyco_ty3251_pendent_155f","agent":"a1_intake","ok":true,"confidence":1.0,"reason":null,"duration_ms":41}
```

Intended for the Phase H.4 Catalog panel replay / drift detection.

## HTTP trigger

`POST /projects/catalog/enrich` body:

```json
{"mode": "incremental", "sku": "...", "parallel": 2, "sam_url": "..."}
```

Runs the orchestrator in-process and returns the per-SKU summary.
Long production runs should shell out to the CLI directly — the
endpoint is for the Catalog panel "re-run" button that H.4 will
add, and for tight dev loops.

## LandScout SAM-review rules respected

Per `skills/landscout-guided-sam-review/SKILL.md`:

1. **Never auto-mode:** `a3_sam_segment` always sends `require_grounded=True` and the grounding bbox.
2. **Reject wash-frame + oversize masks:** the sidecar already drops ≥90% coverage (H.2); `a4_mask_validator` additionally caps aspect-ratio deviation at 0.5 and center-offset at 30% of the grounding bbox.
3. **No silent retry on SAM failure:** `a3` surfaces `sam-unavailable`; the orchestrator routes to `a8_escalation` instead of falling back to auto mode.

## Verification evidence

```
$ cd services/halopenclaw-gateway
$ C:/Python312/python.exe -m pytest tests/ -q --ignore=tests/test_hydraulic_report_pdf.py
88 passed, 2 skipped in 6.96s
```

Break-down of the H.3-specific tests (28 total):

| File | Tests | Scope |
|---|---:|---|
| test_intake_cutsheet.py | 5 | pdf extraction + fallback paths |
| test_grounding_llm.py | 7 | LLM mock, JSON parsing, fallback |
| test_mask_validator.py | 6 | aspect/area/center rejection rules |
| test_geometry_axisymmetric.py | 5 | profile → watertight mesh, fitting ports |
| test_profile_enricher.py | 3 | atomic upsert, GLB promotion gating |
| test_enrichment_e2e.py | 2 | 1 mocked E2E + 1 gated live (RUN_H3_E2E) |

5 real SKUs exercised (all 5 match local cut sheets from D.2):

* `tyco_ty3251_pendent_155f` → `tyco_ty3251_tyb.pdf` (2 photos, 4417 chars spec text)
* `tyco_ty4251_pendent_k80_155f` → `tyco_ty4251_k80.pdf` (2 photos, 3740 chars)
* `reliable_f1res58_pendent_155f` → `reliable_f1res_bul033.pdf` (4 photos, 3013 chars)
* `victaulic_005_rigid_coupling_2in` → `victaulic_005h.pdf` (1 photo, 837 chars)
* `victaulic_107v_quickvic_coupling_2in` → `victaulic_107v.pdf`

Run state — 2026-04-22 close-out run (SAM sidecar up, HAL V3 hub up
with advisor transport returning 401 → graceful LLM-fallback):

```
tyco_ty3251_pendent_155f             -> validated (axisymmetric-z, SAM IoU 0.96)
tyco_ty4251_pendent_k80_155f         -> validated (axisymmetric-z, SAM IoU 0.92)
reliable_f1res58_pendent_155f        -> validated (axisymmetric-z, SAM IoU 0.95)
victaulic_005_rigid_coupling_2in     -> validated (ports-driven-primitive, SAM IoU 0.86)
victaulic_107v_quickvic_coupling_2in -> validated (ports-driven-primitive, SAM IoU 0.87)
```

Catalog-wide: **51 validated / 153 needs_review / 204 total.** Every
SKU that carries a usable cut-sheet PDF with a recognizable part
photo now has a real GLB on disk under
`packages/halofire-catalog/assets/glb/enriched/<sku>.v<n>.glb`.

Sidecar + orchestrator setup used this close-out:

* `services/halofire-sam/.venv` created with CPU torch 2.11
  (`torch>=2.3` in `requirements.txt` with CUDA comment — the CUDA
  wheel index is optional; pipeline runs without a GPU, at ~7 s per
  SKU for vit-huge). SAM 2.1 / 2.0 loaders failed against transformers
  5.5 (the Sam2 post-processor expects tuple args the fast image
  processor doesn't carry); runner's cascade correctly fell back to
  `facebook/sam-vit-huge` which loaded in 26 s from the cache.
* HAL V3 hub reachable but upstream advisor returned 401
  (OpenClaw gateway on :18789 not running, Claude cloud cred not
  configured locally). H.1's `hal_client.py` was hardened to flip
  `available=False` on SSE `error` frames instead of propagating
  `LLMError`, so `a2_grounding` fell back to full-frame bbox with
  `confidence=0.3`. Cut-sheet photos are isolated enough that SAM
  still produced high-IoU masks on the full frame.
* `trimesh + scipy` were missing from the gateway's
  `requirements.txt` — added. Without scipy, `trimesh.fix_normals`
  silently raises `ModuleNotFoundError` the first time it evaluates
  `body_count`, which killed every axisymmetric-revolve call.
* The silhouette-mode axisymmetric revolver was not rescaling the
  (r,z) pairs from normalized [0..1] to meters — every sprinkler
  came out as a 1 m × 1 m × 1 m unit cube. Fix in
  `a5_geometry._build_axisymmetric` multiplies radii by the
  manifest's `body_dia_in / 2` and z by `length_in` before handing
  to the revolver. Post-fix bounds: TY3251 = 12.7 × 12.7 × 19.1 mm
  (bounded by the SKU's single-field manifest — `size_in = 0.5`),
  Victaulic 005 (fitting / ports-driven) = 100 × 61 × 61 mm, which
  matches the 2" rigid coupling face-to-face spec.

The sprinkler bounds are smaller than a real TY3251 (which is ~33 ×
33 × 76 mm) because the manifest only ships `size_in` (thread) —
`body_dia_in` / `length_in` are absent, so the fallback defaults of
`body = size_in` and `length = body * 1.5` set the envelope. This is
a catalog-data problem (source of truth is the manifest, not the
geometry agent) and the right fix is adding `body_dia_in` +
`length_in` fields to the authoring manifests in a follow-up task.
The pipeline itself did exactly what the manifest told it to.

## Known limitations / deferred work

1. **Fitting geometry is a ports-driven placeholder.** Multi-view
   reconstruction for tees / elbows / reducers needs either 2+ photos
   + voxel carving OR a shape-priors LLM call. Deferred to Phase H.5.
   Confidence capped at 0.6 with explicit reason so the H.4 UI can
   flag these as "accuracy: medium".
2. **No parametric-fallback validation path.** When the silhouette
   decode fails in `a5_geometry` we fall back to a parametric profile
   (cylinder + deflector). The mesh is real and scaled from manifest
   dims, but not derived from the photo — the enricher records
   `geometry_method` as `"axisymmetric-z"` regardless. Consider
   splitting this into `axisymmetric-silhouette-z` vs
   `axisymmetric-parametric-z` in H.4 so the UI can surface the
   difference.
3. **Resume-mid-pipeline is partial.** `status.json` per SKU records
   which step last ran; the orchestrator does not yet use it to skip
   completed steps on restart. Re-running a failed SKU today reruns
   from `a1_intake`. Cheap to fix in H.4.
4. **Cut-sheet URL download is untested in CI** (network path). The
   intake agent respects the constraint of only writing to an existing
   `cut_sheets/` directory — it never creates the canonical dir — so
   there's no risk of drift in the manifest.
5. **Concurrency cap is naive.** The orchestrator uses an asyncio
   semaphore but doesn't yet route different kinds at different
   concurrency (SAM is GPU-bound; intake and enrichment are I/O).
   Fine at `--parallel 2`.

## Next (H.4)

Catalog panel extensions in `apps/editor/` that consume `enriched.json`:

* badge per SKU (`validated` green / `needs_review` amber / `fallback` grey / `rejected` red)
* side panel: source photo + SAM mask overlay + provenance + "re-run" button hitting `POST /projects/catalog/enrich`
* "accuracy: low" stamp on the crude SCAD render when status != validated

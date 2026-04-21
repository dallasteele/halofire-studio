"""halofire orchestrator — full Design pipeline.

Loads agents via importlib (their dirs start with digits so regular
imports don't work). Chains:

  intake → classifier → placer → router → hydraulic →
  rulecheck → bom → labor → proposal

Emits everything into a project's deliverables directory:
  {out_dir}/building.json
  {out_dir}/design.json
  {out_dir}/violations.json
  {out_dir}/proposal.json
  {out_dir}/proposal.pdf
  {out_dir}/proposal.xlsx
  {out_dir}/plan.pdf            (AHJ sheet set — drafter agent, Phase 8)
  {out_dir}/model.glb           (3D model for web viewer — Phase 8)
"""
from __future__ import annotations

import importlib.util
import json
import logging
import sys
from pathlib import Path
from typing import Any, Callable

_HFCAD = Path(__file__).resolve().parent
sys.path.insert(0, str(_HFCAD))

from cad.schema import (  # noqa: E402
    Building, Design, Project, Firm, FlowTestData, System,
    DesignConfidence, DesignIssue, DesignSource, DeliverableManifest,
)

log = logging.getLogger(__name__)


def _load_agent(rel_path: str, module_name: str):
    spec = importlib.util.spec_from_file_location(
        module_name, _HFCAD / rel_path,
    )
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {rel_path}")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


INTAKE = _load_agent("agents/00-intake/agent.py", "hf_intake")
CLASSIFIER = _load_agent("agents/01-classifier/agent.py", "hf_classifier")
PLACER = _load_agent("agents/02-placer/agent.py", "hf_placer")
ROUTER = _load_agent("agents/03-router/agent.py", "hf_router")
HYDRAULIC = _load_agent("agents/04-hydraulic/agent.py", "hf_hydraulic")
RULECHECK = _load_agent("agents/05-rulecheck/agent.py", "hf_rulecheck")
BOM = _load_agent("agents/06-bom/agent.py", "hf_bom")
LABOR = _load_agent("agents/07-labor/agent.py", "hf_labor")
PROPOSAL = _load_agent("agents/09-proposal/agent.py", "hf_proposal")
SUBMITTAL = _load_agent("agents/10-submittal/agent.py", "hf_submittal")


def _default_project(project_id: str) -> Project:
    return Project(
        id=project_id,
        name=project_id.replace("-", " ").title(),
        address="",
        ahj="Local AHJ",
        code="NFPA 13 2022",
        halofire=Firm(
            name="Halo Fire Protection, LLC",
            contact="Dan Farnsworth",
            phone="(480) 325-2280",
            license="AZ ROC: 247730",
        ),
    )


def _default_supply() -> FlowTestData:
    """Standard municipal-supply assumption when no flow test is in hand."""
    return FlowTestData(
        static_psi=75, residual_psi=55, flow_gpm=1000,
        test_date=None, location=None,
    )


def run_pipeline(
    pdf_path: str,
    project_id: str = "demo",
    project: Project | None = None,
    supply: FlowTestData | None = None,
    out_dir: Path | None = None,
    progress_callback: "Callable[[dict[str, Any]], None] | None" = None,
) -> dict[str, Any]:
    """Execute the full Design pipeline. Return paths + summary stats.

    V2 step 5 — ``progress_callback(event)`` is invoked after every
    pipeline stage with a shallow dict describing what just finished:
    ``{"stage": "intake", "done": True, "levels": 6, "walls": 312, ...}``.
    The gateway's SSE endpoint forwards these into its per-job queue
    so the editor can spawn nodes into the viewport incrementally.
    """
    out_dir = out_dir or (Path.cwd() / "out" / project_id)
    out_dir.mkdir(parents=True, exist_ok=True)
    project = project or _default_project(project_id)
    supply = supply or _default_supply()

    summary: dict[str, Any] = {"project_id": project_id, "steps": [], "files": {}}

    def _emit_step(step: dict[str, Any]) -> None:
        summary["steps"].append(step)
        if progress_callback is not None:
            try:
                progress_callback({**step, "done": True})
            except Exception:
                # Never let a broken listener stop the pipeline.
                log.exception("progress_callback raised; continuing")

    # 1. INTAKE — PDF → Building
    log.info("[%s] intake: %s", project_id, pdf_path)
    bldg = INTAKE.intake_file(pdf_path, project_id)
    (out_dir / "building_raw.json").write_text(
        json.dumps(bldg.model_dump(), indent=2), encoding="utf-8",
    )
    _emit_step({
        "step": "intake",
        "levels": len(bldg.levels),
        "walls": sum(len(l.walls) for l in bldg.levels),
        "rooms": sum(len(l.rooms) for l in bldg.levels),
    })

    # 2. CLASSIFIER — Room.hazard_class + Level.use
    source_models, issue_models, ingest_confidence = _artifact_context(bldg)
    if any(i.severity == "blocking" for i in issue_models) or not bldg.levels:
        design = Design(
            project=project,
            building=bldg,
            sources=source_models,
            issues=issue_models,
            confidence=DesignConfidence(ingest=ingest_confidence),
            deliverables=DeliverableManifest(warnings=[
                "Pipeline stopped before layout because ingest is blocking.",
            ]),
            metadata=_capability_metadata("blocked"),
        )
        _write_alpha_artifacts(design, out_dir, summary)
        return summary

    CLASSIFIER.classify_building(bldg)
    CLASSIFIER.classify_level_use(bldg)
    (out_dir / "building_classified.json").write_text(
        json.dumps(bldg.model_dump(), indent=2), encoding="utf-8",
    )
    _emit_step({
        "step": "classify",
        "hazard_counts": _count_hazards(bldg),
    })

    # 3. PLACER — Head[] per room
    heads = PLACER.place_heads_for_building(bldg)
    _emit_step({"step": "place", "head_count": len(heads)})

    # 4. ROUTER — PipeSegment[] + Hangers
    systems = ROUTER.route_systems(bldg, heads)
    _emit_step({
        "step": "route",
        "system_count": len(systems),
        "pipe_count": sum(len(s.pipes) for s in systems),
        "hanger_count": sum(len(s.hangers) for s in systems),
    })

    # 5. HYDRAULIC — per-system calc
    for s in systems:
        hazard = _system_hazard(bldg, s)
        s.hydraulic = HYDRAULIC.calc_system(s, supply, hazard)

    # Build the canonical alpha Design artifact.
    design = Design(
        project=project,
        building=bldg,
        systems=systems,
        sources=source_models,
        issues=issue_models,
        confidence=DesignConfidence(
            overall=0.70 if systems else 0.35,
            ingest=ingest_confidence,
            classification=0.72,
            layout=0.70 if systems else 0.15,
            hydraulic=0.72 if all(s.hydraulic for s in systems) else 0.0,
        ),
        metadata=_capability_metadata("alpha"),
    )
    for s in systems:
        if s.hydraulic and s.hydraulic.safety_margin_psi < 5:
            design.issues.append(DesignIssue(
                code="HYDRAULIC_FAILS_SUPPLY",
                severity="error",
                message=(
                    f"System {s.id} has only "
                    f"{s.hydraulic.safety_margin_psi} psi supply margin."
                ),
                refs=[s.id],
                source="hydraulic",
            ))
        if s.hydraulic and s.hydraulic.issues:
            for message in s.hydraulic.issues:
                design.issues.append(DesignIssue(
                    code=message.split(":", 1)[0] if ":" in message else "HYDRAULIC_NOTE",
                    severity="warning",
                    message=message,
                    refs=[s.id],
                    source="hydraulic",
                ))
    design.calculation = {
        "systems": [
            {
                "id": s.id,
                "hydraulic": s.hydraulic.model_dump() if s.hydraulic else None,
            }
            for s in systems
        ],
        "unsupported": [{
            "code": "LOOP_GRID_UNSUPPORTED",
            "severity": "warning",
            "message": (
                "Loop/grid hydraulic solving is not supported in Internal Alpha; "
                "tree systems only."
            ),
        }],
    }
    (out_dir / "design.json").write_text(
        json.dumps(design.model_dump(), indent=2, default=str), encoding="utf-8",
    )
    summary["files"]["design"] = str(out_dir / "design.json")

    # 6. RULECHECK — Violation[]
    violations = RULECHECK.check_design(design)
    (out_dir / "violations.json").write_text(
        json.dumps([v.model_dump() for v in violations], indent=2),
        encoding="utf-8",
    )
    _emit_step({
        "step": "rulecheck",
        "error_count": sum(1 for v in violations if v.severity == "error"),
        "warning_count": sum(1 for v in violations if v.severity == "warning"),
    })

    # 7. BOM
    bom = BOM.generate_bom(design)
    _emit_step({
        "step": "bom",
        "line_items": len(bom),
        "total_usd": BOM.bom_total(bom),
    })
    # V2 Phase 3.2: Hydralist (.hlf) supplier-handoff export
    try:
        _hlf = _load_agent("agents/06-bom/hydralist.py", "hf_hydralist")
        _hlf_path = out_dir / "supplier.hlf"
        _hlf.write_hydralist(bom, project_id, _hlf_path)
        summary["files"]["hydralist"] = str(_hlf_path)
    except Exception as e:  # noqa: BLE001
        log.warning("hydralist export failed: %s", e)
        summary.setdefault("warnings", []).append(f"hydralist: {e}")

    # 8. LABOR
    labor = LABOR.compute_labor(design, bom)
    _emit_step({
        "step": "labor",
        "total_hours": round(sum(r.hours for r in labor), 1),
        "total_usd": LABOR.labor_total(labor),
    })

    # 9. PROPOSAL — json + pdf + xlsx
    proposal_data = PROPOSAL.build_proposal_data(
        design, bom, labor, [v.model_dump() for v in violations],
    )
    paths = PROPOSAL.write_proposal_files(proposal_data, out_dir)
    summary["files"].update(paths)
    _emit_step({
        "step": "proposal",
        "total_usd": proposal_data["pricing"]["total_usd"],
    })

    # 10. SUBMITTAL — DXF + GLB + IFC exports + NFPA 8-section report
    try:
        submittal_paths = SUBMITTAL.export_all(design, out_dir)
        summary["files"].update(submittal_paths)
        # V2 Phase 5.1: NFPA 8-section AHJ submittal report
        try:
            import importlib.util as _ilu
            _nfpa_path = _HFCAD / "agents" / "10-submittal" / "nfpa_report.py"
            _spec = _ilu.spec_from_file_location("nfpa_report", _nfpa_path)
            _nfpa_mod = _ilu.module_from_spec(_spec)
            _spec.loader.exec_module(_nfpa_mod)
            nfpa = _nfpa_mod.build_nfpa_report(design, bom)
            nfpa_path = out_dir / "nfpa_report.json"
            nfpa_path.write_text(json.dumps(nfpa, indent=2), encoding="utf-8")
            submittal_paths["nfpa_report"] = str(nfpa_path)
        except Exception as e:  # noqa: BLE001
            submittal_paths["nfpa_report_error"] = str(e)
        _emit_step({
            "step": "submittal",
            "files": list(submittal_paths.keys()),
        })
    except Exception as e:
        _emit_step({"step": "submittal", "error": str(e)})

    _write_manifest(design, out_dir, summary)

    # Save the master summary
    (out_dir / "pipeline_summary.json").write_text(
        json.dumps(summary, indent=2), encoding="utf-8",
    )
    summary["files"]["summary"] = str(out_dir / "pipeline_summary.json")
    return summary


def _artifact_context(bldg: Building) -> tuple[list[DesignSource], list[DesignIssue], float]:
    meta = bldg.metadata or {}
    sources = [DesignSource(**source) for source in meta.get("sources", [])]
    issues = [DesignIssue(**issue) for issue in meta.get("issues", [])]
    ingest_confidence = max([s.confidence for s in sources], default=0.0)
    return sources, issues, ingest_confidence


def _capability_metadata(stage: str) -> dict[str, Any]:
    return {
        "artifact_version": "halofire-design-alpha-1",
        "stage": stage,
        "units": {
            "geometry": "meters",
            "orientation": "Z-up",
            "ui_export_converts_imperial": True,
        },
        "capabilities": {
            "pdf_vector_intake": True,
            "pdf_raster_opencv_fallback": True,
            "dxf_intake": True,
            "ifc_hierarchy_intake": True,
            "dwg_native_intake": False,
            "tree_hydraulic_solver": True,
            "loop_grid_hydraulic_solver": False,
            "dxf_export": True,
            "glb_export": True,
            "ifc_entity_export": True,
            "ifc_full_geometry_export": False,
            "ahj_ready_submittal": False,
        },
        "limitations": [
            "Internal Alpha output requires Wade/PE review before AHJ submittal.",
            "DWG files must be converted to DXF or IFC unless a licensed reader is configured.",
            "Hydraulics support tree systems only; looped/gridded systems are reported unsupported.",
            "PDF raster extraction is local OpenCV fallback and may require manual cleanup.",
        ],
    }


def _write_manifest(design: Design, out_dir: Path, summary: dict[str, Any]) -> None:
    files = {
        key: value
        for key, value in summary.get("files", {}).items()
        if isinstance(value, str) and Path(value).exists()
    }
    warnings = [
        issue.message
        for issue in design.issues
        if issue.severity in {"warning", "error", "blocking"}
    ]
    warnings.append("Internal Alpha output requires Wade/PE review before AHJ submittal.")
    if not design.metadata.get("capabilities", {}).get("ifc_full_geometry_export", False):
        warnings.append("IFC export contains entities and hierarchy; full placement geometry is beta scope.")
    design.deliverables = DeliverableManifest(files=files, warnings=warnings)
    manifest_path = out_dir / "manifest.json"
    manifest_path.write_text(
        json.dumps(design.deliverables.model_dump(), indent=2, default=str),
        encoding="utf-8",
    )
    summary.setdefault("files", {})["manifest"] = str(manifest_path)
    (out_dir / "design.json").write_text(
        json.dumps(design.model_dump(), indent=2, default=str), encoding="utf-8",
    )


def _write_alpha_artifacts(
    design: Design, out_dir: Path, summary: dict[str, Any],
) -> None:
    design_path = out_dir / "design.json"
    design_path.write_text(
        json.dumps(design.model_dump(), indent=2, default=str), encoding="utf-8",
    )
    summary.setdefault("files", {})["design"] = str(design_path)
    _write_manifest(design, out_dir, summary)
    summary_path = out_dir / "pipeline_summary.json"
    summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    summary["files"]["summary"] = str(summary_path)


def _count_hazards(bldg: Building) -> dict[str, int]:
    counts: dict[str, int] = {}
    for lvl in bldg.levels:
        for room in lvl.rooms:
            h = room.hazard_class or "unclassified"
            counts[h] = counts.get(h, 0) + 1
    return counts


def _system_hazard(bldg: Building, system: System) -> str:
    """Pick the most conservative hazard across rooms the system serves."""
    severities = {"light": 0, "residential": 1, "ordinary_i": 2,
                  "ordinary_ii": 3, "extra_i": 4, "extra_ii": 5}
    max_hazard = "light"
    for lid in system.supplies:
        lvl = next((l for l in bldg.levels if l.id == lid), None)
        if not lvl:
            continue
        for room in lvl.rooms:
            h = room.hazard_class or "light"
            if severities.get(h, 0) > severities.get(max_hazard, 0):
                max_hazard = h
    return max_hazard


def run_quickbid(
    total_sqft: float,
    project_id: str = "demo",
    level_count: int = 1,
    standpipe_count: int = 0,
    dry_systems: int = 0,
    hazard_mix: dict[str, float] | None = None,
) -> dict[str, Any]:
    """60-second fast-path estimator. Produces a ballpark proposal.

    hazard_mix is optional: {"light": 0.7, "ordinary_i": 0.3} — fractions of
    sqft in each hazard class. Defaults to 70/30 light/ordinary.
    """
    mix = hazard_mix or {"light": 0.70, "ordinary_i": 0.30}
    # Calibrated $/sqft from Halo historicals
    rate_per_sqft = {
        "light": 2.95, "ordinary_i": 3.60, "ordinary_ii": 4.25,
        "extra_i": 6.50, "extra_ii": 8.75, "residential": 2.70,
    }
    materials_labor = sum(
        total_sqft * frac * rate_per_sqft.get(h, 3.00)
        for h, frac in mix.items()
    )
    # Standard add-ons
    standpipe_cost = standpipe_count * 12500
    dry_cost = dry_systems * 35000
    fdc_cost = 2850
    permit = 3250
    mobilizations = 16 * 650  # 8 rough + 8 trim @ $650/mob
    subtotal = materials_labor + standpipe_cost + dry_cost + fdc_cost + permit + mobilizations
    taxes = subtotal * 0.072
    total = round(subtotal + taxes, 2)
    return {
        "project_id": project_id,
        "total_sqft": total_sqft,
        "breakdown": {
            "materials_labor": round(materials_labor, 2),
            "standpipes": standpipe_cost,
            "dry_systems": dry_cost,
            "fdc": fdc_cost,
            "permit_allowance": permit,
            "mobilizations": mobilizations,
            "taxes": round(taxes, 2),
        },
        "total_usd": total,
        "confidence": 0.80,
        "note": "Quick bid — full design (10-30 min) will refine ±5-10%",
    }


if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("pdf")
    p.add_argument("--project-id", default="demo")
    p.add_argument("--out", default="out")
    args = p.parse_args()
    res = run_pipeline(args.pdf, args.project_id, out_dir=Path(args.out) / args.project_id)
    print(json.dumps(res, indent=2, default=str))

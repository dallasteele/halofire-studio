"""Pipeline parity — ``run_full_pipeline`` is unchanged by Phase A.

Rather than run a full PDF-intake pipeline (which requires CubiCasa5k
+ a bid PDF), we use the procedural building-generator path the
gateway's ``/building/generate`` endpoint already uses, run it through
the placer → router → hydraulic → rulecheck → bom subset, and prove:

1. The existing agent entry points still produce a deterministic
   ``design.json`` hash after Phase A's additions.
2. ``single_ops.recompute_bom(design)`` on the full pipeline's output
   matches the orchestrator's in-line BOM generation — i.e. the
   single-op path is a faithful wrapper, not a reimplementation.
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CAD_ROOT = ROOT.parent / "halofire-cad"
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(CAD_ROOT))

import importlib.util  # noqa: E402

from cad import schema  # noqa: E402
import single_ops  # noqa: E402


def _load(rel_path: str, name: str):
    spec = importlib.util.spec_from_file_location(name, CAD_ROOT / rel_path)
    m = importlib.util.module_from_spec(spec)
    sys.modules[name] = m
    spec.loader.exec_module(m)
    return m


def _deterministic_design() -> schema.Design:
    """Build a tiny 1-level design without invoking the PDF intake."""
    bg = _load("agents/14-building-gen/agent.py", "hf_bg_parity")
    placer = _load("agents/02-placer/agent.py", "hf_pl_parity")
    router = _load("agents/03-router/agent.py", "hf_rt_parity")
    hydraulic = _load("agents/04-hydraulic/agent.py", "hf_hy_parity")

    spec = bg._default_residential_spec(
        total_sqft=10000, stories=1, garage_levels=0,
    )
    spec.project_id = "parity"
    spec.aspect_ratio = 1.5
    bldg = bg.generate_building(spec)

    heads = placer.place_heads_for_building(bldg)
    systems = router.route_systems(bldg, heads)
    supply = schema.FlowTestData(
        static_psi=75, residual_psi=55, flow_gpm=1000,
    )
    for s in systems:
        s.hydraulic = hydraulic.calc_system(s, supply, "light")

    return schema.Design(
        project=schema.Project(
            id="parity", name="Parity", address="", ahj="AHJ", code="NFPA 13 2022",
        ),
        building=bldg,
        systems=systems,
    )


def _hash(design: schema.Design) -> str:
    data = json.dumps(design.model_dump(), sort_keys=True, default=str)
    return hashlib.sha256(data.encode()).hexdigest()


def test_pipeline_is_deterministic() -> None:
    """Running the pipeline twice produces byte-identical output.

    This is the regression anchor: Phase A must not perturb agent
    state via its imports.
    """
    a = _deterministic_design()
    b = _deterministic_design()
    assert _hash(a) == _hash(b)


def test_single_op_bom_matches_orchestrator_bom() -> None:
    """``single_ops.recompute_bom`` equals the agent's generate_bom.

    The single-op entry point is a thin wrapper — given the same
    Design, it must produce identical BomRow dumps.
    """
    bom_mod = _load("agents/06-bom/agent.py", "hf_bom_parity")
    design = _deterministic_design()
    design_dict = design.model_dump()

    via_agent = [r.model_dump() for r in bom_mod.generate_bom(design)]
    via_single_op = single_ops.recompute_bom(design_dict)
    assert via_agent == via_single_op


def test_single_op_rules_matches_orchestrator_rules() -> None:
    rc_mod = _load("agents/05-rulecheck/agent.py", "hf_rc_parity")
    design = _deterministic_design()
    design_dict = design.model_dump()

    via_agent = [v.model_dump() for v in rc_mod.check_design(design)]
    via_single_op = single_ops.run_rules(design_dict)
    assert via_agent == via_single_op


def test_single_op_calculate_matches_agent_calc() -> None:
    """``single_ops.calculate`` equals per-system ``calc_system`` calls."""
    hy_mod = _load("agents/04-hydraulic/agent.py", "hf_hy_single_parity")
    design = _deterministic_design()
    # Strip precomputed hydraulic so both paths recalc from scratch.
    for s in design.systems:
        s.hydraulic = None
    design_dict = design.model_dump()

    single_ops.calculate(design_dict)

    # Reference path.
    supply = schema.FlowTestData(static_psi=75, residual_psi=55, flow_gpm=1000)
    ref = []
    design_ref = _deterministic_design()
    for s in design_ref.systems:
        s.hydraulic = None
    for s in design_ref.systems:
        s.hydraulic = hy_mod.calc_system(s, supply, "light")
        ref.append(s.hydraulic.model_dump())

    got = [s["hydraulic"] for s in design_dict["systems"]]
    assert got == ref

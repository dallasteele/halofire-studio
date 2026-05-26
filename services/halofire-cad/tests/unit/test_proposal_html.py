"""Smoke test for the proposal.html generator.

Guards the VPS-demo deliverable contract:
  - model-viewer tag present with design.glb src
  - per-level plan SVG rendered (or documented placeholder)
  - pricing, BOM, labor, systems sections all present
  - HTML is valid-ish (roughly balanced tags, no leaked exceptions)

Run: pytest services/halofire-cad/tests/unit/test_proposal_html.py
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

_SPEC = importlib.util.spec_from_file_location(
    "proposal_html",
    ROOT / "agents" / "09-proposal" / "proposal_html.py",
)
assert _SPEC is not None and _SPEC.loader is not None
PH = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(PH)


_SAMPLE_DATA = {
    "version": 1,
    "generated_at": "2026-04-19",
    "project": {
        "name": "The Cooperative 1881 — Phase I",
        "client": "Halo Fire Protection",
        "address": "1881 W North Temple, Salt Lake City, UT",
    },
    "building_summary": {
        "total_sqft": 184000,
        "construction_type": "V-B",
        "level_count": 3,
    },
    "levels": [
        {
            "id": "L0", "name": "Ground", "use": "retail",
            "elevation_m": 0.0, "elevation_ft": 0.0,
            "room_count": 5, "head_count": 42,
            "pipe_count": 18, "pipe_total_m": 120.0, "pipe_total_ft": 394.0,
        },
        {
            "id": "L1", "name": "Level 1", "use": "residential",
            "elevation_m": 3.6, "elevation_ft": 11.8,
            "room_count": 12, "head_count": 88,
            "pipe_count": 30, "pipe_total_m": 220.0, "pipe_total_ft": 721.0,
        },
    ],
    "systems": [
        {
            "id": "SYS-1", "type": "wet",
            "supplies": ["L0"], "head_count": 42, "pipe_count": 18,
            "pipe_total_m": 120.0, "hanger_count": 18,
            "riser_position_m": [0, 0, 0], "riser_size_in": 4,
            "fdc_type": "wall_mount",
            "hydraulic": {
                "design_area_sqft": 1500,
                "density_gpm_per_sqft": 0.10,
                "required_flow_gpm": 250,
                "required_pressure_psi": 50,
                "supply_static_psi": 75,
                "supply_residual_psi": 55,
                "demand_psi": 40,
                "safety_margin_psi": 15,
            },
        },
    ],
    "scope_of_work": ["Install wet sprinkler system"],
    "acknowledgements": ["Pricing valid 10 days"],
    "inclusions": ["All materials + labor"],
    "exclusions": ["Underground by others"],
    "bom": [
        {
            "sku": "SM_Head_Pendant_Standard_K56",
            "description": "Standard Pendant Sprinkler K=5.6",
            "qty": 130, "unit": "ea", "unit_cost_usd": 8.50,
            "extended_usd": 1105.0,
        },
    ],
    "labor": [
        {"role": "Fitter", "hours": 180, "rate_usd_hr": 58.0, "extended_usd": 10440.0},
    ],
    "violations": [],
    "evidence_workbench": {
        "current_gate": "sprinkler_evidence_gate:1881:room_boundary_professional_approval",
        "claims_blocked": [
            "full_building_scope_evidence_ready",
            "permit_ready",
            "professional_approval",
        ],
        "visible_caveats": [
            "Visible caveat: room boundary approvals remain open.",
            "Visible caveat: catalog engineering evidence is still review-only.",
        ],
        "ledger_rows": [
            {
                "gate_kind": "room_boundary_professional_approval",
                "human_label": "Room boundary professional approval",
                "ledger_ref": "sprinkler_missing_evidence:1881:room_boundary:room_boundary_professional_approval",
                "ledger_row_summary": (
                    "Gate ID: sprinkler_evidence_gate:1881:room_boundary_professional_approval | "
                    "Missing artifact: sprinkler_room_boundary_visual_audit_packet:1881:A-101a | "
                    "Missing ref: room_boundary_sheet_approval:1881:A-101a | "
                    "Acceptable evidence formats: sealed review packet; signed PDF; accepted inventory rerun | "
                    "Required fields: reviewer_name; reviewer_license; source_refs | "
                    "Signature metadata: {\"review_status\": \"designer_review\"} | "
                    "Who can satisfy: licensed reviewer; Halo Fire operator | "
                    "Role authority: licensed reviewer | "
                    "Scanned paths: data/halofire/bids/1881/halo_forge/sprinkler_missing_evidence_ledger | "
                    "Claims blocked: full_building_scope_evidence_ready; permit_ready | "
                    "Blocked claim gates: full_building_scope_evidence_ready; permit_ready | "
                    "Rejected candidate refs: room_boundary_candidate:1 | "
                    "Rejected candidate reasons: source-link missing | "
                    "Rejected candidate summary: source-linked review packet required | "
                    "Next action: Attach licensed/professional room-boundary approval evidence | "
                    "Next collection action: capture sealed approval"
                ),
                "missing_ref": "room_boundary_sheet_approval:1881:A-101a",
                "missing_artifact_ref": "sprinkler_room_boundary_visual_audit_packet:1881:A-101a",
                "acceptable_evidence": [
                    "licensed/professional room-boundary approval record for A-101a",
                    "source-linked reviewed room-boundary packet",
                ],
                "acceptable_evidence_formats": [
                    "sealed review packet",
                    "signed PDF",
                    "accepted inventory rerun",
                ],
                "required_fields": [
                    "reviewer_name",
                    "reviewer_license",
                    "source_refs",
                ],
                "signature_metadata": {"review_status": "designer_review"},
                "who_can_satisfy": ["licensed reviewer", "Halo Fire operator"],
                "satisfying_roles": ["licensed reviewer"],
                "role_authority": ["licensed reviewer"],
                "scanned_paths": [
                    "data/halofire/bids/1881/halo_forge/sprinkler_missing_evidence_ledger",
                ],
                "scanned_source_refs": ["sprinkler_room_boundary_visual_audit_packet:1881:A-101a"],
                "rejected_candidates": [
                    {
                        "candidate_ref": "room_boundary_candidate:1",
                        "evidence_kind": "visual audit packet",
                        "rejection_reason": "source-link missing",
                        "source_refs": ["room_boundary_visual_audit_packet:1881:A-101a"],
                    },
                ],
                "rejected_candidate_count": 1,
                "rejected_candidate_refs": ["room_boundary_candidate:1"],
                "rejected_candidate_reasons": ["source-link missing"],
                "rejected_candidate_source_refs": ["room_boundary_visual_audit_packet:1881:A-101a"],
                "rejected_candidate_summary": "source-linked review packet required",
                "current_candidate_count": 1,
                "usable_evidence_count": 0,
                "blocked_claims": [
                    "full_building_scope_evidence_ready",
                    "permit_ready",
                ],
                "blocked_claim_gates": [
                    "full_building_scope_evidence_ready",
                    "permit_ready",
                ],
                "claims_blocked": [
                    "full_building_scope_evidence_ready",
                    "permit_ready",
                ],
                "ai_fallback": "no",
                "next_collection_action": "capture sealed approval",
                "next_action": "Attach licensed/professional room-boundary approval evidence",
            }
        ],
    },
    "missing_evidence_ledger": {
        "rows": [
            {
                "gate_id": "sprinkler_evidence_gate:1881:room_boundary_professional_approval",
                "missing_artifact_ref": "sprinkler_room_boundary_visual_audit_packet:1881:A-101a",
                "missing_ref": "room_boundary_sheet_approval:1881:A-101a",
            }
        ]
    },
    "portal_workflows": [
        {
            "workflow_id": "client-bid-review",
            "audience": "client",
            "title": "Signed client bid review",
            "summary": "Client-facing bundle with visible caveats and exact blocked claims.",
            "status": "access-controlled",
            "current_gate": "sprinkler_evidence_gate:1881:room_boundary_professional_approval",
            "next_action": "Open the signed proposal HTML and review the current caveats.",
            "visible_caveats": [
                "Visible caveat: room boundary approvals remain open.",
            ],
            "claims_blocked": [
                "full_building_scope_evidence_ready",
            ],
            "download_names": [
                {"label": "Client HTML bid page", "artifact": "proposal.html"},
                {"label": "Proposal PDF", "artifact": "proposal.pdf"},
            ],
        },
        {
            "workflow_id": "company-delivery-workflow",
            "audience": "company",
            "title": "Halo Fire delivery workflow",
            "summary": "Resolve exact evidence rows before republishing the bundle.",
            "status": "review queue",
            "current_gate": "sprinkler_evidence_gate:1881:room_boundary_professional_approval",
            "next_action": "Resolve the missing-evidence ledger rows and rerun the workflow.",
            "visible_caveats": [
                "Visible caveat: catalog engineering evidence is still review-only.",
            ],
            "claims_blocked": [
                "permit_ready",
                "professional_approval",
            ],
            "download_names": [
                {"label": "Approval/evidence workbench", "artifact": "evidence_workbench.json"},
                {"label": "Missing-evidence ledger", "artifact": "missing_evidence_ledger.json"},
            ],
        },
    ],
    "evidence_upload_status": {
        "status": "loaded",
        "artifact_dir": "data/halofire/bids/1881/halo_forge/evidence_upload_status",
        "upload_count": 2,
        "staged_upload_count": 1,
        "rejected_upload_count": 1,
        "overwritten_upload_count": 0,
        "claims_cleared_count": 0,
        "upload_lane_ready": False,
        "source_ref": "data/halofire/bids/1881/halo_forge/evidence_upload_status/output.json",
        "uploads": [
            {
                "upload_ref": "upload:1881:openclaw-scene-packet-001",
                "file_name": "openclaw_scene_packet.json",
                "saved_path": "data/halofire/bids/1881/halo_forge/evidence_upload_status/uploads/openclaw_scene_packet.json",
                "sha256": "abc123",
                "size_bytes": 1234,
                "evidence_lane": "openclaw_scene_packet",
                "source_ref": "openclaw_scene_packet:1881:review",
                "note": "Staged for replay bootstrap review.",
                "status": "staged",
            }
        ],
        "rejected_uploads": [
            {
                "upload_ref": "upload:1881:openclaw-scene-packet-002",
                "file_name": "openclaw_scene_packet_invalid.json",
                "saved_path": "data/halofire/bids/1881/halo_forge/evidence_upload_status/uploads/openclaw_scene_packet_invalid.json",
                "sha256": "def456",
                "size_bytes": 789,
                "evidence_lane": "openclaw_scene_packet",
                "source_ref": "openclaw_scene_packet:1881:review",
                "note": "Missing runtime log ref.",
                "status": "rejected",
                "rejection_reason": "runtime log ref missing",
            }
        ],
        "summary": {
            "next_action": "Review staged uploads before clearing any claim.",
            "claims_cleared_count": 0,
        },
        "claims_cleared": False,
    },
    "pricing": {
        "materials_usd": 50000.0,
        "labor_usd": 30000.0,
        "permit_allowance_usd": 3250.0,
        "taxes_usd": 6200.0,
        "subtotal_usd": 80000.0,
        "total_usd": 89450.0,
    },
}

_SAMPLE_DESIGN = {
    "building": {
        "levels": [
            {
                "id": "L0", "elevation_m": 0.0,
                "rooms": [{"id": "R1"}, {"id": "R2"}],
            },
        ],
    },
    "systems": [
        {
            "heads": [
                {"room_id": "R1", "position_m": [1, 2, 1]},
                {"room_id": "R2", "position_m": [4, 2, 5]},
            ],
            "pipes": [
                {
                    "start_m": [0, 2, 0],
                    "end_m": [5, 2, 0],
                    "size_in": 2.0,
                },
                {
                    "start_m": [5, 2, 0],
                    "end_m": [5, 2, 6],
                    "size_in": 1.5,
                },
            ],
        },
    ],
}


# ── required sections ───────────────────────────────────────────────

def test_html_has_model_viewer_tag_with_glb() -> None:
    html = PH.build_proposal_html(_SAMPLE_DATA, design=_SAMPLE_DESIGN)
    assert "<model-viewer" in html
    assert 'src="design.glb"' in html
    assert "camera-controls" in html


def test_html_has_every_required_section() -> None:
    html = PH.build_proposal_html(_SAMPLE_DATA, design=_SAMPLE_DESIGN)
    for needed in [
        "Plan view",         # hero band (loop 3 P-L)
        "3D model",          # hero band
        "Project summary",
        "Floor plans",
        "Systems + hydraulics",
        "Pricing",
        "Charts",
        "Downloads",
        "Scope of work",
        "Inclusions",
        "Exclusions",
        "Bill of materials",
        "Labor",
    ]:
        assert needed in html, f"missing section: {needed}"


def test_hero_section_renders_first_populated_level() -> None:
    """The hero picks the first level that actually has placed heads."""
    html = PH.build_proposal_html(_SAMPLE_DATA, design=_SAMPLE_DESIGN)
    # hero section class
    assert 'class="hero"' in html
    assert 'class="hero-grid"' in html
    # First level in sample design has rooms — hero must show it
    assert "hero-caption" in html


def test_hero_falls_back_when_no_design() -> None:
    """Without design geometry, hero still renders (placeholder)."""
    html = PH.build_proposal_html(_SAMPLE_DATA, design=None)
    assert 'class="hero"' in html
    assert "<model-viewer" in html  # 3D half still loads


def test_html_renders_total_price_in_header() -> None:
    html = PH.build_proposal_html(_SAMPLE_DATA)
    assert "$89,450.00" in html


def test_html_shows_access_banner_and_artifact_links() -> None:
    html = PH.build_proposal_html(_SAMPLE_DATA, design=_SAMPLE_DESIGN)
    assert "Signed client share delivery" in html
    assert "Bid deliverables" in html
    assert "Access-Controlled Bid Bundle" in html
    assert "Approval/evidence workbench" in html
    assert "AI-guided correction tasks" in html
    assert "Client and company workflows" in html
    assert "Exact missing-evidence ledger rows for bid 1881" in html
    assert "Evidence upload status" in html
    assert "Gate ID:" in html
    assert "Missing artifact:" in html
    assert "Acceptable evidence formats:" in html
    assert "Required fields:" in html
    assert "Signature metadata:" in html
    assert "Who can satisfy:" in html
    assert "Scanned paths:" in html
    assert "Rejected candidates" in html
    assert "Rejected candidate reasons:" in html
    assert "Rejected candidate source refs:" in html
    assert "Next action:" in html
    assert "Signed client bid review" in html
    assert "Halo Fire delivery workflow" in html
    assert "Client HTML bid page" in html
    assert "Approval/evidence workbench" in html
    assert "./proposal.pdf" in html
    assert "./proposal.xlsx" in html
    assert "./design.glb" in html
    assert "./evidence_workbench.json" in html
    assert "./missing_evidence_ledger.json" in html
    assert "./evidence_upload_status.json" in html


def test_html_renders_evidence_upload_status_lane() -> None:
    html = PH.build_proposal_html(_SAMPLE_DATA, design=_SAMPLE_DESIGN)
    assert "Upload lane and rejected-file truth" in html
    assert "Upload lane ready:" in html
    assert "openclaw_scene_packet.json" in html
    assert "openclaw_scene_packet_invalid.json" in html
    assert "runtime log ref missing" in html
    assert "Review staged uploads before clearing any claim." in html


def test_html_renders_all_ledger_rows_not_just_a_preview() -> None:
    data = dict(_SAMPLE_DATA)
    workbench = dict(data["evidence_workbench"])
    workbench["ledger_rows"] = [
        dict(workbench["ledger_rows"][0], gate_kind="row-1", human_label="Row 1", gate_id="gate-1"),
        dict(workbench["ledger_rows"][0], gate_kind="row-2", human_label="Row 2", gate_id="gate-2"),
        dict(workbench["ledger_rows"][0], gate_kind="row-3", human_label="Row 3", gate_id="gate-3"),
        dict(workbench["ledger_rows"][0], gate_kind="row-4", human_label="Row 4", gate_id="gate-4"),
    ]
    data["evidence_workbench"] = workbench
    html = PH.build_proposal_html(data)
    assert html.count("Gate ID:") == 4
    assert "Row 4" in html


def test_html_escapes_user_content() -> None:
    """Client-supplied strings must be HTML-escaped."""
    data = dict(_SAMPLE_DATA)
    data["project"] = dict(data["project"])
    data["project"]["name"] = "<script>alert(1)</script>"
    html = PH.build_proposal_html(data)
    assert "<script>alert(1)</script>" not in html
    assert "&lt;script&gt;" in html


# ── plan SVG ────────────────────────────────────────────────────────

def test_level_plan_contains_circle_per_head_and_line_per_pipe() -> None:
    svg = PH._render_plan_svg(
        "L0",
        {
            "heads": [
                {"x": 1, "z": 1, "sku": "H1"},
                {"x": 4, "z": 5, "sku": "H2"},
            ],
            "pipes": [
                {"x1": 0, "z1": 0, "x2": 5, "z2": 0, "size_in": 2.0},
            ],
        },
    )
    assert "<svg" in svg and "</svg>" in svg
    assert svg.count("<circle") == 2
    assert svg.count("<line") >= 1  # at least the pipe (plus scale bar)


def test_plan_falls_back_cleanly_when_level_has_no_geometry() -> None:
    svg = PH._render_plan_svg("L99", {"heads": [], "pipes": []})
    assert "plan-empty" in svg or "No placed heads" in svg


def test_plan_uses_nfpa_size_color_for_2in() -> None:
    svg = PH._render_plan_svg(
        "L0",
        {
            "heads": [],
            "pipes": [{"x1": 0, "z1": 0, "x2": 5, "z2": 0, "size_in": 2.0}],
        },
    )
    # NFPA 2" → blue (#448aff)
    assert "#448aff" in svg


# ── bom + labor rows ────────────────────────────────────────────────

def test_bom_and_labor_rows_rendered() -> None:
    html = PH.build_proposal_html(_SAMPLE_DATA)
    assert "SM_Head_Pendant_Standard_K56" in html
    assert "Fitter" in html
    assert "$10,440.00" in html


# ── tag balance sanity ──────────────────────────────────────────────

def test_no_unescaped_exceptions_and_tag_balance() -> None:
    html = PH.build_proposal_html(_SAMPLE_DATA, design=_SAMPLE_DESIGN)
    # Section open/close balance
    assert html.count("<section") == html.count("</section>")
    # Table open/close balance
    assert html.count("<table") == html.count("</table>")
    # No raw Python repr leaked
    assert "<class " not in html
    assert "Traceback" not in html

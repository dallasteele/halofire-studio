"""Canonical domain types for the halofire-cad backend.

All agents read and write these. Any intermediate step in the Design
pipeline can be serialized to JSON via pydantic v2 and replayed for
debugging / regression.

Units: meters, SI, Z-up, right-handed coordinate system. Agents at
the I/O boundary (drafter, proposal) convert to imperial for AHJ
deliverables.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

# ── Enums ───────────────────────────────────────────────────────────

NfpaHazard = Literal[
    "light", "ordinary_i", "ordinary_ii", "extra_i", "extra_ii",
    "residential",
]

LevelUse = Literal[
    "garage", "residential", "retail", "mechanical", "office",
    "storage", "amenity", "roof", "other",
]

SystemType = Literal[
    "wet", "dry", "preaction", "deluge", "combo_standpipe",
]

HeadOrientation = Literal["pendent", "upright", "sidewall", "concealed"]
PipeSchedule = Literal["sch10", "sch40", "cpvc", "copper"]


# ── Geometry primitives ─────────────────────────────────────────────

Point2D = tuple[float, float]   # (x, y) in meters
Point3D = tuple[float, float, float]
Polygon2D = list[Point2D]       # closed, CCW orientation


class BBox2D(BaseModel):
    min_xy: Point2D
    max_xy: Point2D


# ── Building ────────────────────────────────────────────────────────


class Firm(BaseModel):
    name: str
    contact: Optional[str] = None
    phone: Optional[str] = None
    license: Optional[str] = None


class FlowTestData(BaseModel):
    """AHJ-provided hydrant flow-test data."""
    static_psi: float
    residual_psi: float
    flow_gpm: float
    test_date: Optional[str] = None
    location: Optional[str] = None


class Project(BaseModel):
    id: str
    name: str
    address: str
    ahj: str
    code: str
    construction_type: Optional[str] = None
    total_sqft: Optional[float] = None
    architect: Optional[Firm] = None
    gc: Optional[Firm] = None
    halofire: Optional[Firm] = None
    supply: Optional[FlowTestData] = None


class Opening(BaseModel):
    id: str
    kind: Literal["door", "window"]
    wall_id: str
    position_m: Point3D
    width_m: float
    height_m: float


class Wall(BaseModel):
    id: str
    start_m: Point2D
    end_m: Point2D
    thickness_m: float = 0.2
    height_m: float = 3.0
    is_exterior: bool = False
    openings: list[str] = Field(default_factory=list)


class Obstruction(BaseModel):
    id: str
    kind: Literal["column", "beam", "duct", "soffit", "equipment", "other"]
    polygon_m: Polygon2D
    top_z_m: float
    bottom_z_m: float


class Ceiling(BaseModel):
    height_m: float = 3.0
    kind: Literal["flat", "sloped", "open_joist", "acoustic_tile", "deck"] = "flat"
    slope_deg: float = 0.0


class Room(BaseModel):
    id: str
    name: str
    polygon_m: Polygon2D
    area_sqm: float
    use_class: str = "unknown"
    hazard_class: Optional[NfpaHazard] = None
    ceiling: Optional[Ceiling] = None


class Shaft(BaseModel):
    id: str
    kind: Literal["stair", "elevator", "mech"]
    polygon_m: Polygon2D
    top_z_m: float
    bottom_z_m: float


class Level(BaseModel):
    id: str
    name: str
    elevation_m: float
    height_m: float = 3.0
    use: LevelUse = "other"
    polygon_m: Polygon2D = Field(default_factory=list)
    rooms: list[Room] = Field(default_factory=list)
    walls: list[Wall] = Field(default_factory=list)
    openings: list[Opening] = Field(default_factory=list)
    obstructions: list[Obstruction] = Field(default_factory=list)
    ceiling: Ceiling = Field(default_factory=Ceiling)
    stair_shafts: list[Shaft] = Field(default_factory=list)
    elevator_shafts: list[Shaft] = Field(default_factory=list)
    mech_rooms: list[Room] = Field(default_factory=list)


class Building(BaseModel):
    project_id: str
    levels: list[Level] = Field(default_factory=list)
    construction_type: Optional[str] = None
    total_sqft: Optional[float] = None
    metadata: dict = Field(default_factory=dict)


# ── Sprinkler system ────────────────────────────────────────────────


class Head(BaseModel):
    id: str
    sku: str
    k_factor: float
    temp_rating_f: int = 155
    position_m: Point3D
    deflector_below_ceiling_mm: float = 100
    orientation: HeadOrientation = "pendent"
    room_id: Optional[str] = None
    branch_id: Optional[str] = None
    system_id: Optional[str] = None


class Fitting(BaseModel):
    id: str
    kind: Literal[
        "tee_branch", "tee_run", "elbow_90", "elbow_45",
        "gate_valve", "check_valve", "reducer", "coupling",
    ]
    size_in: float
    position_m: Point3D
    equiv_length_ft: float


class PipeSegment(BaseModel):
    id: str
    from_node: str
    to_node: str
    size_in: float
    schedule: PipeSchedule = "sch10"
    start_m: Point3D
    end_m: Point3D
    length_m: float
    elevation_change_m: float = 0.0
    fittings: list[str] = Field(default_factory=list)
    downstream_heads: int = 1
    system_id: Optional[str] = None


class Hanger(BaseModel):
    id: str
    pipe_id: str
    position_m: Point3D


class Branch(BaseModel):
    id: str
    heads: list[str] = Field(default_factory=list)  # Head IDs
    pipes: list[str] = Field(default_factory=list)  # PipeSegment IDs
    upstream_branch_id: Optional[str] = None


class RiserSpec(BaseModel):
    id: str
    position_m: Point3D
    size_in: float
    fdc_position_m: Optional[Point3D] = None
    fdc_type: Literal["wall_mount", "yard", "remote"] = "wall_mount"


class HydraulicResult(BaseModel):
    design_area_sqft: float
    density_gpm_per_sqft: float
    required_flow_gpm: float
    required_pressure_psi: float
    supply_static_psi: float
    supply_residual_psi: float
    supply_flow_gpm: float
    demand_at_base_of_riser_psi: float
    safety_margin_psi: float
    critical_path: list[str] = Field(default_factory=list)
    node_trace: list[dict] = Field(default_factory=list)
    supply_curve: list[dict] = Field(default_factory=list)
    demand_curve: list[dict] = Field(default_factory=list)
    issues: list[str] = Field(default_factory=list)
    converged: bool = False
    iterations: int = 0


class System(BaseModel):
    id: str
    type: SystemType
    supplies: list[str] = Field(default_factory=list)  # Level IDs
    riser: RiserSpec
    branches: list[Branch] = Field(default_factory=list)
    heads: list[Head] = Field(default_factory=list)
    pipes: list[PipeSegment] = Field(default_factory=list)
    fittings: list[Fitting] = Field(default_factory=list)
    hangers: list[Hanger] = Field(default_factory=list)
    hydraulic: Optional[HydraulicResult] = None


# ── Top-level design artifact ──────────────────────────────────────


IssueSeverity = Literal["info", "warning", "error", "blocking"]


class DesignIssue(BaseModel):
    code: str
    severity: IssueSeverity
    message: str
    refs: list[str] = Field(default_factory=list)
    source: Optional[str] = None


class DesignSource(BaseModel):
    id: str
    kind: Literal["pdf", "raster_pdf", "dxf", "ifc", "dwg", "manual", "generated"]
    path: Optional[str] = None
    confidence: float = 0.0
    warnings: list[str] = Field(default_factory=list)


class DesignConfidence(BaseModel):
    overall: float = 0.0
    ingest: float = 0.0
    classification: float = 0.0
    layout: float = 0.0
    hydraulic: float = 0.0


class DeliverableManifest(BaseModel):
    files: dict[str, str] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)


class Design(BaseModel):
    project: Project
    building: Building
    systems: list[System] = Field(default_factory=list)
    sources: list[DesignSource] = Field(default_factory=list)
    confidence: DesignConfidence = Field(default_factory=DesignConfidence)
    issues: list[DesignIssue] = Field(default_factory=list)
    calculation: dict = Field(default_factory=dict)
    deliverables: DeliverableManifest = Field(default_factory=DeliverableManifest)
    metadata: dict = Field(default_factory=dict)


# ── Agent I/O ───────────────────────────────────────────────────────


class Violation(BaseModel):
    rule_id: str
    section: str
    severity: IssueSeverity
    message: str
    refs: list[str] = Field(default_factory=list)  # affected node IDs


class BomRow(BaseModel):
    sku: str
    description: str
    qty: float
    unit: str = "ea"
    unit_cost_usd: float = 0.0
    extended_usd: float = 0.0


class LaborRow(BaseModel):
    role: str
    hours: float
    rate_usd_hr: float
    extended_usd: float = 0.0


# ── Typed pipeline I/O (AGENTIC_RULES §1.1) ─────────────────────────


SCHEMA_VERSION: int = 1


class WallCandidate(BaseModel):
    """One detected wall segment in raw PDF points (pre-scale)."""
    x0: float
    y0: float
    x1: float
    y1: float


class RoomCandidate(BaseModel):
    """One detected room polygon in raw PDF points (pre-scale)."""
    polygon_pt: list[tuple[float, float]]
    area_pt2: float


class PageIntakeResult(BaseModel):
    """Typed output of `intake_pdf_page`.

    Replaces the legacy `dict[str, Any]` return per AGENTIC_RULES §1.1.
    Callers MUST receive this, not a dict.
    """
    schema_version: int = SCHEMA_VERSION
    pdf_path: str
    page_index: int
    page_w_pt: float = 0.0
    page_h_pt: float = 0.0
    raw_line_count: int = 0
    wall_count: int = 0
    room_count: int = 0
    scale_ft_per_pt: float = 0.0
    walls: list[WallCandidate] = Field(default_factory=list)
    rooms: list[RoomCandidate] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class PipelineStep(BaseModel):
    """One entry in PipelineSummary.steps."""
    step: str
    ok: bool = True
    duration_s: Optional[float] = None
    stats: dict = Field(default_factory=dict)
    error: Optional[str] = None


class PipelineSummary(BaseModel):
    """Typed return from orchestrator.run_pipeline.

    Replaces the legacy dict. Gateway converts via
    `summary.model_dump()` at the HTTP boundary.
    """
    schema_version: int = SCHEMA_VERSION
    project_id: str
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    steps: list[PipelineStep] = Field(default_factory=list)
    files: dict[str, str] = Field(default_factory=dict)
    issues: list[DesignIssue] = Field(default_factory=list)
    status: Literal["queued", "running", "completed", "failed"] = "running"


# ── Phase H — PE sign-off ──────────────────────────────────────────


DesignStatus = Literal[
    "internal-alpha",        # default; NOT-FOR-CONSTRUCTION watermark
    "pending-pe-review",     # submitted for PE review
    "pe-reviewed",           # PE approved; submittal allowed
    "pe-rejected",           # PE sent back with comments
    "submitted",             # delivered to AHJ
]


class PeSignature(BaseModel):
    """Phase H — licensed Professional Engineer sign-off record.

    Every deliverable that carries "submittal-grade" status has a
    PeSignature attached. The PE reviews the Design + violations + calc
    reports, then approves or rejects. Approved designs lose the
    NOT-FOR-CONSTRUCTION watermark; everything else keeps it per §13.
    """
    pe_name: str
    pe_license_number: str
    pe_license_state: str
    signed_at: str             # ISO timestamp
    decision: Literal["approved", "rejected", "conditional"]
    review_notes: str = ""
    conditional_items: list[str] = Field(default_factory=list)
    # Hash of the Design at sign-time — prevents silent drift
    design_hash_sha256: Optional[str] = None


JobStatusStr = Literal["queued", "running", "completed", "failed"]


class JobStatus(BaseModel):
    """Typed JSON payload for the gateway's /intake/status/{job_id}.

    Replaces the loosely-typed dict in gateway main.py's _JOBS.
    """
    schema_version: int = SCHEMA_VERSION
    job_id: str
    project_id: str
    file: Optional[str] = None
    bytes: int = 0
    mode: str = "pipeline"
    status: JobStatusStr = "queued"
    percent: int = 0
    steps_complete: list[str] = Field(default_factory=list)
    error: Optional[str] = None
    summary: Optional[PipelineSummary] = None

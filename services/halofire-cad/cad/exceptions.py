"""Canonical exception family for halofire-cad.

Per AGENTIC_RULES.md §1.3, errors are data first, exceptions second.
When an agent raises, it uses a class from this family so the
orchestrator can map exceptions to typed DesignIssue records at a
single point rather than re-inventing the mapping per caller.

Every exception carries:
- `code` — stable machine-readable identifier, SCREAMING_SNAKE_CASE
- `refs` — list of node/entity IDs the error relates to
- `detail` — extra structured metadata

A `__str__` that's safe to surface in a user-facing UI.
"""
from __future__ import annotations

from typing import Optional


class HalofireError(Exception):
    """Root of the halofire-cad exception tree."""

    code: str = "HALOFIRE_ERROR"
    default_message: str = "halofire error"

    def __init__(
        self,
        message: Optional[str] = None,
        *,
        code: Optional[str] = None,
        refs: Optional[list[str]] = None,
        detail: Optional[dict] = None,
    ) -> None:
        self.code = code or type(self).code
        self.refs = list(refs or [])
        self.detail = dict(detail or {})
        super().__init__(message or type(self).default_message)


# ── Ingest ──────────────────────────────────────────────────────────


class IngestError(HalofireError):
    code = "INGEST_ERROR"
    default_message = "architect document ingest failed"


class UnsupportedFormatError(IngestError):
    code = "UNSUPPORTED_FORMAT"
    default_message = "file format is not supported"


class PDFParseError(IngestError):
    code = "PDF_PARSE_ERROR"
    default_message = "failed to parse PDF"


class ScaleDetectionError(IngestError):
    code = "SCALE_DETECTION_FAILED"
    default_message = "could not determine drawing scale"


# ── Pipeline stages ─────────────────────────────────────────────────


class ClassificationError(HalofireError):
    code = "CLASSIFICATION_ERROR"
    default_message = "hazard classification failed"


class PlacementError(HalofireError):
    code = "PLACEMENT_ERROR"
    default_message = "head placement failed"


class RoutingError(HalofireError):
    code = "ROUTING_ERROR"
    default_message = "pipe routing failed"


class HydraulicError(HalofireError):
    code = "HYDRAULIC_ERROR"
    default_message = "hydraulic calculation failed"


class HydraulicNonConvergence(HydraulicError):
    code = "HYDRAULIC_NO_CONVERGE"
    default_message = "hydraulic solver did not converge within iteration budget"


class RuleCheckError(HalofireError):
    code = "RULECHECK_ERROR"
    default_message = "rule check crashed"


# ── Export ──────────────────────────────────────────────────────────


class ExportError(HalofireError):
    code = "EXPORT_ERROR"
    default_message = "deliverable export failed"


class DXFExportError(ExportError):
    code = "DXF_EXPORT_ERROR"
    default_message = "DXF export failed"


class IFCExportError(ExportError):
    code = "IFC_EXPORT_ERROR"
    default_message = "IFC export failed"


class GLBExportError(ExportError):
    code = "GLB_EXPORT_ERROR"
    default_message = "GLB export failed"


# ── Orchestrator ────────────────────────────────────────────────────


class PipelineError(HalofireError):
    code = "PIPELINE_ERROR"
    default_message = "pipeline orchestration failed"


class CheckpointError(PipelineError):
    code = "CHECKPOINT_ERROR"
    default_message = "failed to read or write stage checkpoint"


# ── Budget enforcement (per AGENTIC_RULES §1.4) ────────────────────


class BudgetExceeded(HalofireError):
    code = "BUDGET_EXCEEDED"
    default_message = "agent exceeded its declared budget"


__all__ = [
    "HalofireError",
    "IngestError",
    "UnsupportedFormatError",
    "PDFParseError",
    "ScaleDetectionError",
    "ClassificationError",
    "PlacementError",
    "RoutingError",
    "HydraulicError",
    "HydraulicNonConvergence",
    "RuleCheckError",
    "ExportError",
    "DXFExportError",
    "IFCExportError",
    "GLBExportError",
    "PipelineError",
    "CheckpointError",
    "BudgetExceeded",
]

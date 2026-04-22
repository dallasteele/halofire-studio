"""Phase H.3 — per-SKU catalog enrichment agents.

Each agent implements the :class:`AgentStep` protocol in
``_protocol.py`` and produces typed :class:`StepResult` outputs that
the orchestrator (``catalog_enrichment.py``) threads through an
:class:`EnrichmentContext`.

Agent order::

    a1_intake        cut sheet PDF → product photos + spec text
    a2_grounding     LLM → bbox around the part in the photo
    a3_sam_segment   SAM sidecar → candidate masks
    a4_mask_validator deterministic geometry checks
    a5_geometry      silhouette → axisymmetric OR ports-driven mesh
    a6_glb_exporter  trimesh → versioned GLB
    a7_profile_enricher aggregate → enriched.json entry
    a8_escalation    (on failure) Claude decides retry/fallback/flag
"""

from ._protocol import AgentStep, EnrichmentContext, StepResult

__all__ = ["AgentStep", "EnrichmentContext", "StepResult"]

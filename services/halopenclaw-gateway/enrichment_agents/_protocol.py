"""Typed contract every enrichment agent implements.

Keeping this tiny and dependency-free so agents can be unit tested
without dragging in the orchestrator, FastAPI, or heavy CV libs.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol


@dataclass
class EnrichmentContext:
    """Everything an agent needs to do its job, and a place to drop
    intermediate artifacts so downstream agents can consume them."""

    sku_id: str
    catalog_entry: dict
    cut_sheet_path: Path | None
    cut_sheet_url: str | None
    workdir: Path
    llm_client: Any  # hal_client.LLMClient — untyped to avoid import cycle
    sam_url: str
    artifacts: dict[str, Any] = field(default_factory=dict)


@dataclass
class StepResult:
    """Typed return value from :meth:`AgentStep.run`.

    ``artifacts`` is shallow-merged into ``ctx.artifacts`` by the
    orchestrator on success so each agent only needs to return its
    own deltas.
    """

    ok: bool
    reason: str | None = None
    confidence: float = 1.0
    artifacts: dict[str, Any] | None = None


class AgentStep(Protocol):
    """Every step in the enrichment pipeline satisfies this shape."""

    name: str

    async def run(self, ctx: EnrichmentContext) -> StepResult:  # pragma: no cover - protocol
        ...

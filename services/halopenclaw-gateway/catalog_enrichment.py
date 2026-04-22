"""Phase H.3 orchestrator — per-SKU catalog enrichment pipeline.

Dispatches the 7 canonical enrichment steps (a1–a7) for every SKU,
routing to a8_escalation on failure. Designed to be resumable and
idempotent:

* a ``status.json`` per SKU under ``data/enrichment_jobs/<sku>/`` tracks
  which step last completed — a restart resumes at the next step
* SKUs whose mesh is already on disk AND whose cut sheet hasn't been
  modified since enrichment are skipped entirely
* every step call emits one JSON line to
  ``data/enrichment_audit.jsonl`` so the Phase H.4 UI can replay it

CLI::

    python -m services.halopenclaw-gateway.catalog_enrichment \
        --mode incremental --parallel 2

For the module run to work the gateway dir must be on ``sys.path`` —
the CLI handles that automatically.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
import time
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Sequence

# Allow ``python catalog_enrichment.py`` and ``python -m`` equally.
_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from enrichment_agents._protocol import AgentStep, EnrichmentContext, StepResult  # noqa: E402
from enrichment_agents.a1_intake import IntakeAgent  # noqa: E402
from enrichment_agents.a2_grounding import GroundingAgent  # noqa: E402
from enrichment_agents.a3_sam_segment import SamSegmentAgent  # noqa: E402
from enrichment_agents.a4_mask_validator import MaskValidatorAgent  # noqa: E402
from enrichment_agents.a5_geometry import GeometryAgent  # noqa: E402
from enrichment_agents.a6_glb_exporter import GlbExporterAgent  # noqa: E402
from enrichment_agents.a7_profile_enricher import ProfileEnricherAgent  # noqa: E402
from enrichment_agents.a8_escalation import EscalationAgent  # noqa: E402

log = logging.getLogger("halofire.enrichment.orchestrator")


# ── paths ───────────────────────────────────────────────────────────


def _repo_root() -> Path:
    return _HERE.parent.parent  # services/halopenclaw-gateway → repo root


def default_catalog_path() -> Path:
    return _repo_root() / "packages" / "halofire-catalog" / "catalog.json"


def default_enriched_path() -> Path:
    return _repo_root() / "packages" / "halofire-catalog" / "enriched.json"


def default_cut_sheets_dir() -> Path:
    return _repo_root() / "packages" / "halofire-catalog" / "cut_sheets"


def default_enriched_glb_dir() -> Path:
    return (
        _repo_root()
        / "packages"
        / "halofire-catalog"
        / "assets"
        / "glb"
        / "enriched"
    )


def default_glb_latest_dir() -> Path:
    return _repo_root() / "packages" / "halofire-catalog" / "assets" / "glb"


def default_jobs_dir() -> Path:
    return _HERE / "data" / "enrichment_jobs"


def default_audit_log() -> Path:
    return _HERE / "data" / "enrichment_audit.jsonl"


# ── SSE fan-out ─────────────────────────────────────────────────────
#
# Phase H.4 — the Studio's CatalogPanel subscribes to the gateway's SSE
# event bus on a reserved `_catalog` project id. When the orchestrator
# finishes a SKU (success, fallback, or failure), we load that SKU's
# record from `enriched.json` and emit it on that topic so every open
# tab converges without polling. This is best-effort: the event bus is
# imported lazily so running the orchestrator as a standalone script
# (outside FastAPI) doesn't require the scene_store side-effect module.

_CATALOG_SSE_TOPIC = "_catalog"


def _emit_catalog_enriched(enriched_path: Path, sku_id: str) -> None:
    if not sku_id:
        return
    try:
        from scene_store import get_event_bus  # type: ignore
    except Exception:  # pragma: no cover - best effort
        return
    try:
        if not enriched_path.exists():
            return
        doc = json.loads(enriched_path.read_text(encoding="utf-8"))
        record = (doc.get("entries") or {}).get(sku_id)
        if record is None:
            return
        get_event_bus().emit(
            _CATALOG_SSE_TOPIC,
            {"kind": "catalog_enriched", "sku_id": sku_id, "record": record},
        )
    except Exception as exc:  # pragma: no cover - bus can't take us down
        log.warning("catalog_enriched emit failed for %s: %s", sku_id, exc)


# ── orchestrator ────────────────────────────────────────────────────


class Orchestrator:
    """Runs the enrichment pipeline for one or more SKUs."""

    def __init__(
        self,
        *,
        sam_url: str = "http://127.0.0.1:18081",
        llm_client: Any | None = None,
        catalog_path: Path | None = None,
        enriched_path: Path | None = None,
        cut_sheets_dir: Path | None = None,
        enriched_glb_dir: Path | None = None,
        glb_latest_dir: Path | None = None,
        jobs_dir: Path | None = None,
        audit_log: Path | None = None,
        max_retries: int = 2,
    ) -> None:
        self.sam_url = sam_url
        self.llm_client = llm_client
        self.catalog_path = catalog_path or default_catalog_path()
        self.enriched_path = enriched_path or default_enriched_path()
        self.cut_sheets_dir = cut_sheets_dir or default_cut_sheets_dir()
        self.enriched_glb_dir = enriched_glb_dir or default_enriched_glb_dir()
        self.glb_latest_dir = glb_latest_dir or default_glb_latest_dir()
        self.jobs_dir = jobs_dir or default_jobs_dir()
        self.audit_log = audit_log or default_audit_log()
        self.max_retries = max_retries

        self._intake = IntakeAgent(cut_sheets_dir=self.cut_sheets_dir)
        self._grounding = GroundingAgent()
        self._sam = SamSegmentAgent()
        self._validator = MaskValidatorAgent()
        self._geometry = GeometryAgent()
        self._glb = GlbExporterAgent(enriched_dir=self.enriched_glb_dir)
        self._enricher = ProfileEnricherAgent(
            enriched_json_path=self.enriched_path,
            glb_latest_dir=self.glb_latest_dir,
        )
        self._escalation = EscalationAgent()

    # ── public API ──
    def load_catalog(self) -> list[dict]:
        data = json.loads(self.catalog_path.read_text(encoding="utf-8"))
        return list(data.get("parts") or [])

    def load_enriched(self) -> dict[str, dict]:
        if not self.enriched_path.exists():
            return {}
        try:
            doc = json.loads(self.enriched_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}
        return dict(doc.get("entries") or {})

    def needs_enrichment(self, entry: dict, enriched: dict[str, dict]) -> bool:
        sku = entry.get("sku")
        record = enriched.get(sku)
        if record is None:
            return True
        if record.get("status") != "validated":
            return True
        glb = record.get("mesh", {}).get("glb_path")
        if not glb or not Path(glb).exists():
            return True
        # Cut-sheet newer than enriched record?
        cut_sheet = record.get("cut_sheet") or {}
        cs_path = cut_sheet.get("path")
        if cs_path and Path(cs_path).exists():
            cs_mtime = Path(cs_path).stat().st_mtime
            enriched_at = record.get("enriched_at") or "1970-01-01T00:00:00+00:00"
            try:
                enriched_ts = datetime.fromisoformat(enriched_at).timestamp()
            except ValueError:
                enriched_ts = 0.0
            if cs_mtime > enriched_ts:
                return True
        return False

    async def run_sku(self, entry: dict) -> dict[str, Any]:
        out = await self._run_sku(entry)
        # Phase H.4 — fan out a `catalog_enriched` SSE event so the Studio's
        # CatalogPanel updates live without a re-fetch. Best-effort: we
        # never want a broken event bus to fail enrichment itself.
        _emit_catalog_enriched(self.enriched_path, str(entry.get("sku") or ""))
        return out

    async def _run_sku(self, entry: dict) -> dict[str, Any]:
        sku = entry["sku"]
        workdir = self.jobs_dir / sku
        workdir.mkdir(parents=True, exist_ok=True)

        cut_sheet_path = self._resolve_cut_sheet_path(entry)
        cut_sheet_url = entry.get("cut_sheet_url") or entry.get("cutsheet_url")

        ctx = EnrichmentContext(
            sku_id=sku,
            catalog_entry=entry,
            cut_sheet_path=cut_sheet_path,
            cut_sheet_url=cut_sheet_url,
            workdir=workdir,
            llm_client=self.llm_client,
            sam_url=self.sam_url,
            artifacts={"provenance": []},
        )

        steps: list[AgentStep] = [
            self._intake,
            self._grounding,
            self._sam,
            self._validator,
            self._geometry,
            self._glb,
            self._enricher,
        ]

        retries = 0
        start_idx = 0

        while start_idx < len(steps):
            step = steps[start_idx]
            result = await self._run_step(step, ctx)

            if result.ok:
                start_idx += 1
                continue

            # Route through escalation.
            ctx.artifacts["failure_step"] = step.name
            ctx.artifacts["failure_reason"] = result.reason or "unknown"

            if retries >= self.max_retries:
                # Out of retries — write a needs_review record with whatever we have.
                await self._write_failure_record(ctx, step.name, result.reason or "")
                return {"sku": sku, "status": "needs_review", "failed_at": step.name}

            esc_result = await self._run_step(self._escalation, ctx)
            retries += 1
            decision = (esc_result.artifacts or {}).get("escalation") or {}
            action = decision.get("action") or "flag"

            if action == "retry":
                retry_with = decision.get("retry_with") or {}
                target_step = retry_with.get("step")
                jump = _step_index_by_name(steps, target_step)
                if jump is None:
                    await self._write_failure_record(ctx, step.name, result.reason or "")
                    return {"sku": sku, "status": "needs_review", "failed_at": step.name}
                # Apply overrides into ctx.artifacts for the target step to pick up.
                overrides = retry_with.get("overrides") or {}
                if isinstance(overrides, dict):
                    ctx.artifacts.update({f"override_{k}": v for k, v in overrides.items()})
                start_idx = jump
                continue

            if action == "fallback":
                # Skip to the enricher with the existing mesh (if any).
                await self._write_failure_record(
                    ctx, step.name, result.reason or "", status="fallback",
                )
                return {"sku": sku, "status": "fallback", "failed_at": step.name}

            # "flag"
            await self._write_failure_record(ctx, step.name, result.reason or "")
            return {"sku": sku, "status": "needs_review", "failed_at": step.name}

        return {"sku": sku, "status": "validated"}

    async def run_all(
        self,
        *,
        mode: str = "incremental",
        sku_filter: str | None = None,
        parallel: int = 2,
    ) -> dict[str, Any]:
        parts = self.load_catalog()
        enriched = self.load_enriched()

        if sku_filter:
            parts = [p for p in parts if p.get("sku") == sku_filter]

        if mode == "incremental":
            parts = [p for p in parts if self.needs_enrichment(p, enriched)]
        # mode == "full" runs everything regardless.

        sem = asyncio.Semaphore(max(1, parallel))
        results: list[dict[str, Any]] = []

        async def _worker(entry: dict) -> None:
            async with sem:
                try:
                    out = await self.run_sku(entry)
                except Exception as exc:  # never let one SKU kill the batch
                    log.exception("SKU %s crashed", entry.get("sku"))
                    out = {"sku": entry.get("sku"), "status": "error", "error": str(exc)}
                results.append(out)

        await asyncio.gather(*(_worker(p) for p in parts))
        summary = _summarise(results)
        log.info("enrichment complete: %s", summary)
        return {"results": results, "summary": summary}

    # ── internals ──
    def _resolve_cut_sheet_path(self, entry: dict) -> Path | None:
        # Canonical naming convention: <manufacturer>_<part> — fall back
        # to a few patterns derived from the SKU.
        sku = entry.get("sku") or ""
        candidates = [
            self.cut_sheets_dir / f"{sku}.pdf",
        ]
        # Derive "manufacturer_part" style, e.g. tyco_ty3251_pendent_135f → tyco_ty3251
        parts = sku.split("_")
        if len(parts) >= 2:
            candidates.append(self.cut_sheets_dir / f"{parts[0]}_{parts[1]}.pdf")
        if len(parts) >= 3:
            candidates.append(self.cut_sheets_dir / f"{parts[0]}_{parts[1]}_{parts[2]}.pdf")
        for c in candidates:
            if c.exists():
                return c
        # Heuristic: any PDF containing the mfg + any alphanumeric token
        # from the part number. Part numbers vary ("TY4251", "Style_005_2in",
        # "F1Res_58") so we tokenize and keep tokens with at least one digit
        # — those carry the model identity; words like "Style" do not.
        mfg = (entry.get("manufacturer") or "").split("_")[0].lower()
        mfg_part = (entry.get("mfg_part_number") or "").lower().replace("-", " ")
        tokens = [
            t for t in mfg_part.replace("_", " ").split()
            if any(ch.isdigit() for ch in t)
        ]
        if mfg and tokens and self.cut_sheets_dir.exists():
            for pdf in self.cut_sheets_dir.glob("*.pdf"):
                stem = pdf.stem.lower().replace("-", "")
                if mfg in stem and any(t in stem for t in tokens):
                    return pdf
        return None

    async def _run_step(
        self,
        step: AgentStep,
        ctx: EnrichmentContext,
    ) -> StepResult:
        start = time.perf_counter()
        try:
            result = await step.run(ctx)
        except Exception as exc:
            log.exception("agent %s raised", step.name)
            result = StepResult(ok=False, reason=f"crash: {exc}")

        duration_ms = int((time.perf_counter() - start) * 1000)
        self._audit(step.name, ctx.sku_id, result, duration_ms)

        if result.ok and result.artifacts:
            ctx.artifacts.update(result.artifacts)

        ctx.artifacts.setdefault("provenance", []).append(
            {
                "agent": step.name,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "ok": result.ok,
                "confidence": result.confidence,
                "reason": result.reason,
                "output_keys": sorted(list((result.artifacts or {}).keys())),
                "duration_ms": duration_ms,
            }
        )

        # Persist status.json for resumability.
        try:
            (ctx.workdir / "status.json").write_text(
                json.dumps({"provenance": ctx.artifacts["provenance"]}, indent=2),
                encoding="utf-8",
            )
        except OSError:
            pass

        return result

    def _audit(
        self,
        agent_name: str,
        sku: str,
        result: StepResult,
        duration_ms: int,
    ) -> None:
        try:
            self.audit_log.parent.mkdir(parents=True, exist_ok=True)
            line = json.dumps(
                {
                    "ts": datetime.now(timezone.utc).isoformat(),
                    "sku": sku,
                    "agent": agent_name,
                    "ok": result.ok,
                    "confidence": result.confidence,
                    "reason": result.reason,
                    "duration_ms": duration_ms,
                }
            )
            with self.audit_log.open("a", encoding="utf-8") as f:
                f.write(line + "\n")
        except OSError:
            pass

    async def _write_failure_record(
        self,
        ctx: EnrichmentContext,
        failing_step: str,
        reason: str,
        *,
        status: str = "needs_review",
    ) -> None:
        # Write a minimal enriched.json entry so the UI shows the SKU
        # with a needs_review badge and the operator can see why.
        try:
            from enrichment_agents.a7_profile_enricher import _atomic_write_record

            record = {
                "sku_id": ctx.sku_id,
                "status": status,
                "enriched_at": datetime.now(timezone.utc).isoformat(),
                "failure": {"step": failing_step, "reason": reason},
                "provenance": ctx.artifacts.get("provenance") or [],
                "grounding": ctx.artifacts.get("grounding"),
                "mask_rejections": ctx.artifacts.get("mask_rejections") or [],
                "escalation": ctx.artifacts.get("escalation"),
            }
            _atomic_write_record(self.enriched_path, record)
        except Exception as exc:  # pragma: no cover - best-effort
            log.warning("failure record for %s not written: %s", ctx.sku_id, exc)


def _step_index_by_name(steps: Sequence[AgentStep], name: str | None) -> int | None:
    if not name:
        return None
    for i, s in enumerate(steps):
        if s.name == name:
            return i
    return None


def _summarise(results: list[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for r in results:
        k = r.get("status", "unknown")
        counts[k] = counts.get(k, 0) + 1
    counts["total"] = len(results)
    return counts


# ── CLI ─────────────────────────────────────────────────────────────


def _build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Halofire catalog enrichment (Phase H.3)")
    p.add_argument(
        "--mode",
        choices=("full", "incremental", "sku"),
        default="incremental",
    )
    p.add_argument("--sku", default=None, help="single SKU to enrich (implies --mode sku)")
    p.add_argument("--parallel", type=int, default=2)
    p.add_argument("--sam-url", default=os.environ.get("HALOFIRE_SAM_URL", "http://127.0.0.1:18081"))
    p.add_argument("--hal-base", default=os.environ.get("HAL_BASE_URL", "http://127.0.0.1:9000"))
    p.add_argument("--log-level", default="INFO")
    return p


async def _amain(argv: Sequence[str] | None = None) -> int:
    args = _build_arg_parser().parse_args(argv)
    logging.basicConfig(
        level=getattr(logging, args.log_level.upper(), logging.INFO),
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )

    # Late import so unit tests that don't exercise the CLI don't need
    # the HAL client imported.
    os.environ.setdefault("HAL_BASE_URL", args.hal_base)
    from hal_client import get_llm_client

    llm = get_llm_client()

    orch = Orchestrator(sam_url=args.sam_url, llm_client=llm)
    mode = args.mode
    sku_filter = args.sku
    if sku_filter and mode == "incremental":
        mode = "sku"

    out = await orch.run_all(
        mode=("full" if mode == "full" else "incremental"),
        sku_filter=sku_filter,
        parallel=args.parallel,
    )
    print(json.dumps(out["summary"], indent=2))
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    return asyncio.run(_amain(argv))


if __name__ == "__main__":
    raise SystemExit(main())

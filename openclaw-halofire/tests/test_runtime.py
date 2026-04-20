"""Smoke + unit tests for the openclaw-halofire runtime.

Covers:
  - registry discovers all bundled modules
  - module.toml parse round-trip (required fields + optional)
  - topological ordering respects [deps].services
  - Gemma-only guard rejects non-Gemma tags
  - cron parser + matcher (minute precision, day-of-week normalization)
  - scheduler.tick() fires exactly once per matching minute
  - health.check_module returns None when no [health] block
  - supervisor.status round-trips process state (no subprocess spawned)
  - CLI 'list' command runs against the bundled modules

Run: pytest openclaw-halofire/tests/ -q
"""
from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT))

from openclaw import cli, health, llm, registry, scheduler, supervisor  # noqa: E402


# ── registry ──────────────────────────────────────────────────────

def test_registry_discovers_bundled_modules() -> None:
    modules = registry.load_modules(_ROOT / "modules")
    names = {m.name for m in modules}
    assert {"halofire-studio", "halofire-cad", "halofire-pricing"} <= names


def test_registry_parses_module_fields() -> None:
    modules = {m.name: m for m in registry.load_modules(_ROOT / "modules")}
    studio = modules["halofire-studio"]
    assert studio.type == "service"
    assert studio.command == ["bun", "run", "dev"]
    assert studio.health is not None
    assert studio.health.http == "http://localhost:3002/"

    pricing = modules["halofire-pricing"]
    assert pricing.type == "cron"
    assert pricing.schedule is not None
    assert pricing.schedule.cron == "0 2 * * 1"
    # Gemma-only — the pricing module must declare gemma3:4b as a dep
    assert "gemma3:4b" in pricing.deps_models


def test_topological_order_respects_deps() -> None:
    modules = registry.load_modules(_ROOT / "modules")
    ordered = registry.topological_order(modules)
    names = [m.name for m in ordered]
    # halofire-pricing depends on halofire-cad; cad must come first
    assert names.index("halofire-cad") < names.index("halofire-pricing")


def test_registry_rejects_invalid_module(tmp_path: Path) -> None:
    bad = tmp_path / "bad" / "module.toml"
    bad.parent.mkdir()
    bad.write_text(
        '[module]\nname="broken"\n\n[runtime]\ntype="service"\n'
        # missing command
    )
    with pytest.raises(registry.RegistryError):
        registry.load_modules(tmp_path)


def test_cron_module_requires_schedule(tmp_path: Path) -> None:
    bad = tmp_path / "nocron" / "module.toml"
    bad.parent.mkdir()
    bad.write_text(
        '[module]\nname="nocron"\n\n[runtime]\ntype="cron"\n'
        'command=["true"]\nworking_dir="."\n',
    )
    with pytest.raises(registry.RegistryError):
        registry.load_modules(tmp_path)


# ── llm / Gemma-only ─────────────────────────────────────────────

def test_llm_default_is_gemma() -> None:
    assert llm.DEFAULT_MODEL.lower().startswith("gemma")


def test_llm_require_gemma_accepts_gemma_tags() -> None:
    for ok in ("gemma3:4b", "gemma3:12b", "gemma2:9b", "Gemma3:27b"):
        llm.require_gemma(ok)


def test_llm_require_gemma_rejects_others() -> None:
    for bad in ("qwen2.5:7b", "qwen3:8b", "llama3:8b",
                "mistral:7b", "phi3", "", "random"):
        with pytest.raises(ValueError, match="Gemma-only"):
            llm.require_gemma(bad)


# ── scheduler / cron ─────────────────────────────────────────────

def test_parse_cron_star_all() -> None:
    spec = scheduler.parse_cron("* * * * *")
    # '* * * * *' matches every minute
    assert scheduler.matches(spec, datetime(2026, 4, 20, 3, 45))


def test_cron_monday_02_00() -> None:
    spec = scheduler.parse_cron("0 2 * * 1")
    # 2026-04-20 is a Monday
    assert scheduler.matches(spec, datetime(2026, 4, 20, 2, 0))
    # Monday at 02:30 → minute 30 not in {0} → no match
    assert not scheduler.matches(spec, datetime(2026, 4, 20, 2, 30))
    # Tuesday 02:00 → dow 2 not in {1} → no match
    assert not scheduler.matches(spec, datetime(2026, 4, 21, 2, 0))


def test_cron_range_and_step() -> None:
    spec = scheduler.parse_cron("*/15 9-17 * * 1-5")
    assert scheduler.matches(spec, datetime(2026, 4, 20, 9, 0))
    assert scheduler.matches(spec, datetime(2026, 4, 20, 13, 45))
    assert not scheduler.matches(spec, datetime(2026, 4, 20, 8, 0))


def test_scheduler_tick_fires_once_per_minute(tmp_path: Path, monkeypatch) -> None:
    mod = registry.Module(
        name="every-min",
        version="0",
        description="",
        type="cron",
        command=["true"],
        working_dir=".",
        schedule=registry.Schedule(cron="* * * * *"),
    )
    events = []
    sch = scheduler.Scheduler(
        root=tmp_path, modules=[mod],
        on_event=lambda k, p: events.append((k, p)),
    )
    # Stub _fire so we don't spawn subprocesses
    monkeypatch.setattr(
        sch, "_fire", lambda m: events.append(("fired", {"name": m.name})),
    )
    now = datetime(2026, 4, 20, 3, 45)
    fired_1 = sch.tick(now=now)
    fired_2 = sch.tick(now=now)  # same minute
    fired_3 = sch.tick(now=now.replace(minute=46))  # next minute
    assert fired_1 == ["every-min"]
    assert fired_2 == []
    assert fired_3 == ["every-min"]


# ── health ───────────────────────────────────────────────────────

def test_check_module_returns_none_without_http_block() -> None:
    m = registry.Module(
        name="x", version="0", description="",
        type="oneshot", command=["true"], working_dir=".",
    )
    assert health.check_module(m) is None


def test_check_module_reports_error_on_unreachable() -> None:
    m = registry.Module(
        name="x", version="0", description="",
        type="service", command=["true"], working_dir=".",
        health=registry.HealthCheck(
            http="http://127.0.0.1:1/does-not-exist",
            timeout_s=1, expect_status=200,
        ),
    )
    r = health.check_module(m)
    assert r is not None
    assert r.ok is False
    assert r.error


# ── supervisor (no subprocess) ───────────────────────────────────

def test_supervisor_status_before_start(tmp_path: Path) -> None:
    m = registry.Module(
        name="idle", version="0", description="",
        type="service", command=["nonexistent-cmd"],
        working_dir=".", restart_policy="never",
    )
    sup = supervisor.Supervisor(root=tmp_path, modules=[m])
    st = sup.status()
    assert st["idle"]["running"] is False
    assert st["idle"]["pid"] is None


def test_supervisor_ignores_non_service_modules(tmp_path: Path) -> None:
    mods = [
        registry.Module(
            name="a", version="0", description="",
            type="service", command=["true"], working_dir=".",
        ),
        registry.Module(
            name="b", version="0", description="",
            type="cron", command=["true"], working_dir=".",
            schedule=registry.Schedule(cron="* * * * *"),
        ),
    ]
    sup = supervisor.Supervisor(root=tmp_path, modules=mods)
    assert set(sup.status().keys()) == {"a"}


# ── cli ──────────────────────────────────────────────────────────

def test_cli_list_command_runs(capsys) -> None:
    rc = cli.main(["--root", str(_ROOT), "list"])
    assert rc == 0
    out = capsys.readouterr().out
    # Every bundled module appears in the output
    for name in ("halofire-studio", "halofire-cad", "halofire-pricing"):
        assert name in out

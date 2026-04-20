"""Module registry — reads modules/<name>/module.toml files and
produces typed `Module` records. See ../ARCHITECTURE.md for the ABI.

No runtime behavior here — pure parsing + validation. Separating
this from supervisor/loop lets us test loading independently.
"""
from __future__ import annotations

import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

if sys.version_info >= (3, 11):
    import tomllib
else:  # pragma: no cover
    import tomli as tomllib  # type: ignore[no-redef]

ModuleType = Literal["service", "cron", "oneshot"]
RestartPolicy = Literal["always", "on_failure", "never"]


@dataclass
class HealthCheck:
    http: str | None = None
    timeout_s: int = 5
    expect_status: int = 200


@dataclass
class Schedule:
    cron: str | None = None
    timezone: str = "UTC"


@dataclass
class UI:
    title: str | None = None
    icon: str | None = None
    route: str | None = None


@dataclass
class Module:
    name: str
    version: str
    description: str
    type: ModuleType
    command: list[str]
    working_dir: str
    env: dict[str, str] = field(default_factory=dict)
    restart_policy: RestartPolicy = "on_failure"
    restart_delay_s: int = 5
    stdout_log: str | None = None
    stderr_log: str | None = None
    schedule: Schedule | None = None
    health: HealthCheck | None = None
    deps_services: list[str] = field(default_factory=list)
    deps_models: list[str] = field(default_factory=list)
    ui: UI | None = None
    # Path the toml came from — for error messages + working_dir
    # resolution.
    source: Path | None = None

    def resolved_working_dir(self, root: Path) -> Path:
        """Resolve `working_dir` relative to the openclaw root."""
        return (root / self.working_dir).resolve()

    def validate(self) -> list[str]:
        errs: list[str] = []
        if not self.name or " " in self.name:
            errs.append("name must be a slug (no spaces)")
        if self.type not in ("service", "cron", "oneshot"):
            errs.append(f"type {self.type!r} invalid")
        if not self.command:
            errs.append("command must be a non-empty argv list")
        if self.type == "cron" and (self.schedule is None or not self.schedule.cron):
            errs.append("cron modules require [schedule].cron")
        if self.restart_policy not in ("always", "on_failure", "never"):
            errs.append(f"restart_policy {self.restart_policy!r} invalid")
        return errs


class RegistryError(Exception):
    pass


def _parse_module(path: Path, data: dict[str, Any]) -> Module:
    mod = data.get("module") or {}
    rt = data.get("runtime") or {}
    sch = data.get("schedule") or None
    hc = data.get("health") or None
    deps = data.get("deps") or {}
    ui = data.get("ui") or None

    command = rt.get("command")
    if isinstance(command, str):
        command = [command]

    module = Module(
        name=str(mod.get("name") or path.parent.name),
        version=str(mod.get("version") or "0.0.0"),
        description=str(mod.get("description") or ""),
        type=rt.get("type") or "service",
        command=list(command or []),
        working_dir=str(rt.get("working_dir") or "."),
        env={str(k): str(v) for k, v in (rt.get("env") or {}).items()},
        restart_policy=rt.get("restart_policy") or "on_failure",
        restart_delay_s=int(rt.get("restart_delay_s") or 5),
        stdout_log=rt.get("stdout_log"),
        stderr_log=rt.get("stderr_log"),
        schedule=(
            Schedule(
                cron=sch.get("cron") if sch else None,
                timezone=(sch.get("timezone") if sch else None) or "UTC",
            )
            if sch
            else None
        ),
        health=(
            HealthCheck(
                http=hc.get("http"),
                timeout_s=int(hc.get("timeout_s") or 5),
                expect_status=int(hc.get("expect_status") or 200),
            )
            if hc
            else None
        ),
        deps_services=list(deps.get("services") or []),
        deps_models=list(deps.get("models") or []),
        ui=(
            UI(
                title=ui.get("title"),
                icon=ui.get("icon"),
                route=ui.get("route"),
            )
            if ui
            else None
        ),
        source=path,
    )
    errs = module.validate()
    if errs:
        raise RegistryError(f"{path}: {'; '.join(errs)}")
    return module


def load_modules(modules_dir: Path) -> list[Module]:
    """Discover every modules/<name>/module.toml and parse it."""
    modules_dir = modules_dir.resolve()
    if not modules_dir.is_dir():
        raise RegistryError(f"modules directory not found: {modules_dir}")
    tomls = sorted(modules_dir.glob("*/module.toml"))
    out: list[Module] = []
    for p in tomls:
        with p.open("rb") as f:
            data = tomllib.load(f)
        out.append(_parse_module(p, data))
    return out


def topological_order(modules: list[Module]) -> list[Module]:
    """Return modules in dependency order. Raises on cycle."""
    by_name = {m.name: m for m in modules}
    ordered: list[Module] = []
    seen: set[str] = set()
    visiting: set[str] = set()

    def visit(name: str) -> None:
        if name in seen:
            return
        if name in visiting:
            raise RegistryError(f"cycle through module {name!r}")
        m = by_name.get(name)
        if m is None:
            raise RegistryError(f"unknown dep: {name!r}")
        visiting.add(name)
        for dep in m.deps_services:
            visit(dep)
        visiting.remove(name)
        seen.add(name)
        ordered.append(m)

    for m in modules:
        visit(m.name)
    return ordered

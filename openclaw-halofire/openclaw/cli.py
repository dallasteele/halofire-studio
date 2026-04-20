"""CLI — `openclaw <command>`. Kept intentionally thin; every real
decision lives in registry/supervisor/scheduler/loop.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from . import __version__
from .health import check_all, summary
from .loop import Loop
from .registry import RegistryError, load_modules, topological_order
from .scheduler import Scheduler
from .supervisor import Supervisor


def _root(arg: str | None) -> Path:
    # Default: the directory containing the `openclaw-halofire/` package
    if arg:
        return Path(arg).resolve()
    return Path(__file__).resolve().parents[1]


def _load(root: Path):
    modules = load_modules(root / "modules")
    ordered = topological_order(modules)
    return ordered


def _event_printer(kind: str, payload: dict) -> None:
    print(json.dumps({"event": kind, **payload}), flush=True)


def cmd_list(args: argparse.Namespace) -> int:
    root = _root(args.root)
    try:
        modules = _load(root)
    except RegistryError as e:
        print(f"registry error: {e}", file=sys.stderr)
        return 2
    for m in modules:
        print(f"{m.name:28s}  v{m.version:<8s}  {m.type:<8s}  {m.description}")
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    root = _root(args.root)
    modules = _load(root)
    results = check_all(modules)
    print(json.dumps(summary(results), indent=2))
    return 0 if all(r.ok for r in results) else 1


def cmd_start(args: argparse.Namespace) -> int:
    root = _root(args.root)
    modules = _load(root)
    sup = Supervisor(root, modules, on_event=_event_printer)
    sched = Scheduler(root, modules, on_event=_event_printer)
    sup.start_all()
    sup.watch_in_background()
    sched.run_in_background()
    loop = Loop(root, modules, sup, on_event=_event_printer)
    try:
        while True:
            loop.tick()
            time.sleep(60)
    except KeyboardInterrupt:
        pass
    finally:
        sched.stop()
        sup.stop_all()
    return 0


def cmd_restart(args: argparse.Namespace) -> int:
    root = _root(args.root)
    modules = _load(root)
    sup = Supervisor(root, modules, on_event=_event_printer)
    sup.restart(args.name)
    return 0


def cmd_reload(args: argparse.Namespace) -> int:
    # Stateless: `start` re-reads module.toml every invocation.
    root = _root(args.root)
    print(f"reloaded {len(_load(root))} modules")
    return 0


def cmd_run(args: argparse.Namespace) -> int:
    """Run a oneshot / cron module once, right now."""
    root = _root(args.root)
    modules = {m.name: m for m in _load(root)}
    if args.name not in modules:
        print(f"unknown module: {args.name}", file=sys.stderr)
        return 2
    m = modules[args.name]
    import os
    import subprocess
    cwd = m.resolved_working_dir(root)
    env = {**os.environ, **m.env}
    rc = subprocess.call(  # noqa: S603
        m.command,
        cwd=str(cwd) if cwd.exists() else None,
        env=env,
    )
    return rc


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="openclaw", description="HaloFire runtime")
    p.add_argument("--root", help="path to openclaw-halofire/ (auto-detected)")
    p.add_argument("--version", action="version", version=__version__)
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("list", help="list modules").set_defaults(func=cmd_list)
    sub.add_parser("status", help="health snapshot").set_defaults(func=cmd_status)
    sub.add_parser("start", help="start daemon").set_defaults(func=cmd_start)
    sub.add_parser("reload", help="rescan module.toml files").set_defaults(func=cmd_reload)
    sp_restart = sub.add_parser("restart", help="restart one module")
    sp_restart.add_argument("name")
    sp_restart.set_defaults(func=cmd_restart)
    sp_run = sub.add_parser("run", help="run a oneshot/cron module now")
    sp_run.add_argument("name")
    sp_run.set_defaults(func=cmd_run)
    return p


def main(argv: list[str] | None = None) -> int:
    p = _build_parser()
    args = p.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())

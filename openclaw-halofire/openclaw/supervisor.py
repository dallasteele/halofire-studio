"""Supervisor — manages the lifecycle of each `service` module.

Responsibilities:
  * spawn the child process with the module's env + working dir
  * track liveness + PID
  * honor restart_policy with backoff
  * close out cleanly on runtime shutdown

Cron modules are driven by `scheduler.py` — not this module.
Oneshot modules run once per `openclaw run <module>`.
"""
from __future__ import annotations

import os
import signal
import subprocess
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from .registry import Module


@dataclass
class ProcState:
    module: Module
    process: subprocess.Popen | None = None
    started_at: float | None = None
    restart_count: int = 0
    last_exit_code: int | None = None
    should_run: bool = True
    lock: threading.Lock = field(default_factory=threading.Lock)


class Supervisor:
    def __init__(
        self,
        root: Path,
        modules: list[Module],
        on_event: Callable[[str, dict], None] | None = None,
    ) -> None:
        self.root = root.resolve()
        self.modules = {m.name: m for m in modules if m.type == "service"}
        self.state: dict[str, ProcState] = {
            name: ProcState(module=m) for name, m in self.modules.items()
        }
        self._on_event = on_event or (lambda _k, _p: None)
        self._watcher: threading.Thread | None = None
        self._stop = threading.Event()

    # ── public API ───────────────────────────────────────────

    def start(self, name: str) -> None:
        s = self._get(name)
        with s.lock:
            if s.process and s.process.poll() is None:
                return  # already running
            s.should_run = True
            self._spawn(s)

    def start_all(self) -> None:
        for name in self.modules:
            self.start(name)

    def stop(self, name: str, *, graceful_timeout_s: float = 5.0) -> None:
        s = self._get(name)
        with s.lock:
            s.should_run = False
            self._terminate(s, graceful_timeout_s=graceful_timeout_s)

    def stop_all(self, *, graceful_timeout_s: float = 5.0) -> None:
        self._stop.set()
        for name in self.modules:
            self.stop(name, graceful_timeout_s=graceful_timeout_s)

    def restart(self, name: str) -> None:
        self.stop(name)
        self.start(name)

    def status(self) -> dict[str, dict]:
        out: dict[str, dict] = {}
        for name, s in self.state.items():
            running = bool(s.process and s.process.poll() is None)
            out[name] = {
                "running": running,
                "pid": s.process.pid if running and s.process else None,
                "restart_count": s.restart_count,
                "last_exit_code": s.last_exit_code,
                "started_at": s.started_at,
            }
        return out

    def watch(self, poll_interval_s: float = 2.0) -> None:
        """Run the liveness watcher loop in the current thread."""
        while not self._stop.is_set():
            for s in self.state.values():
                self._check(s)
            time.sleep(poll_interval_s)

    def watch_in_background(self, poll_interval_s: float = 2.0) -> None:
        if self._watcher is not None:
            return
        self._stop.clear()
        self._watcher = threading.Thread(
            target=self.watch, args=(poll_interval_s,), daemon=True,
        )
        self._watcher.start()

    # ── internals ────────────────────────────────────────────

    def _get(self, name: str) -> ProcState:
        if name not in self.state:
            raise KeyError(f"unknown service module: {name!r}")
        return self.state[name]

    def _spawn(self, s: ProcState) -> None:
        m = s.module
        cwd = m.resolved_working_dir(self.root)
        env = {**os.environ, **m.env}
        stdout = None
        stderr = None
        if m.stdout_log:
            stdout = open(self.root / m.stdout_log, "ab", buffering=0)
        if m.stderr_log:
            stderr = open(self.root / m.stderr_log, "ab", buffering=0)
        try:
            s.process = subprocess.Popen(  # noqa: S603 — argv from TOML, not user input at runtime
                m.command,
                cwd=str(cwd) if cwd.exists() else None,
                env=env,
                stdout=stdout,
                stderr=stderr,
            )
            s.started_at = time.time()
            self._on_event(
                "module.start",
                {"name": m.name, "pid": s.process.pid},
            )
        except FileNotFoundError as e:
            s.last_exit_code = -1
            self._on_event(
                "module.spawn_error",
                {"name": m.name, "error": str(e), "command": m.command},
            )

    def _terminate(self, s: ProcState, *, graceful_timeout_s: float) -> None:
        p = s.process
        if p is None or p.poll() is not None:
            return
        try:
            p.terminate()
            p.wait(timeout=graceful_timeout_s)
        except subprocess.TimeoutExpired:
            p.kill()
        except Exception:  # noqa: BLE001
            pass
        s.last_exit_code = p.returncode
        self._on_event(
            "module.stop",
            {"name": s.module.name, "exit_code": s.last_exit_code},
        )
        s.process = None

    def _check(self, s: ProcState) -> None:
        p = s.process
        if p is None:
            if s.should_run and s.module.restart_policy != "never":
                self._maybe_restart(s, reason="missing")
            return
        rc = p.poll()
        if rc is None:
            return
        s.last_exit_code = rc
        s.process = None
        self._on_event(
            "module.exit",
            {"name": s.module.name, "exit_code": rc},
        )
        if not s.should_run:
            return
        policy = s.module.restart_policy
        if policy == "never":
            return
        if policy == "on_failure" and rc == 0:
            return
        self._maybe_restart(s, reason=f"exit_{rc}")

    def _maybe_restart(self, s: ProcState, *, reason: str) -> None:
        s.restart_count += 1
        time.sleep(s.module.restart_delay_s)
        if self._stop.is_set() or not s.should_run:
            return
        self._on_event(
            "module.restart",
            {
                "name": s.module.name,
                "reason": reason,
                "attempt": s.restart_count,
            },
        )
        with s.lock:
            self._spawn(s)


__all__ = ["Supervisor", "ProcState"]

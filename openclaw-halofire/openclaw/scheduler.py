"""Cron-style scheduler for modules with `type = "cron"`.

No external cron daemon required — the runtime is self-contained.
Uses a minimal 5-field cron grammar (`m h dom mon dow`) evaluated
against the local clock each minute.
"""
from __future__ import annotations

import subprocess
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Callable

from .registry import Module


def _parse_field(s: str, low: int, high: int) -> set[int]:
    """Parse one cron field into the set of matching ints."""
    out: set[int] = set()
    for part in s.split(","):
        if part == "*":
            return set(range(low, high + 1))
        step = 1
        if "/" in part:
            part, step_s = part.split("/", 1)
            step = int(step_s)
        if part == "*":
            start, end = low, high
        elif "-" in part:
            a, b = part.split("-", 1)
            start, end = int(a), int(b)
        else:
            start = end = int(part)
        for i in range(start, end + 1, step):
            if low <= i <= high:
                out.add(i)
    return out


@dataclass
class CronSpec:
    minute: set[int]
    hour: set[int]
    dom: set[int]
    month: set[int]
    dow: set[int]


def parse_cron(expr: str) -> CronSpec:
    parts = expr.strip().split()
    if len(parts) != 5:
        raise ValueError(f"cron expr must have 5 fields: {expr!r}")
    return CronSpec(
        minute=_parse_field(parts[0], 0, 59),
        hour=_parse_field(parts[1], 0, 23),
        dom=_parse_field(parts[2], 1, 31),
        month=_parse_field(parts[3], 1, 12),
        dow=_parse_field(parts[4], 0, 6),
    )


def matches(spec: CronSpec, when: datetime) -> bool:
    if when.minute not in spec.minute:
        return False
    if when.hour not in spec.hour:
        return False
    if when.day not in spec.dom:
        return False
    if when.month not in spec.month:
        return False
    # dow: Monday=0 (Python) but cron uses Sunday=0. Normalize.
    cron_dow = (when.weekday() + 1) % 7
    if cron_dow not in spec.dow:
        return False
    return True


@dataclass
class Scheduler:
    root: Path
    modules: list[Module]
    on_event: Callable[[str, dict], None] = field(default=lambda _k, _p: None)
    _stop: threading.Event = field(default_factory=threading.Event)
    _thread: threading.Thread | None = None
    _last_fired: dict[str, datetime] = field(default_factory=dict)

    def cron_modules(self) -> list[Module]:
        return [m for m in self.modules if m.type == "cron" and m.schedule and m.schedule.cron]

    def tick(self, now: datetime | None = None) -> list[str]:
        """Evaluate all crons once against `now`. Returns fired module names."""
        now = now or datetime.now()
        fired: list[str] = []
        now_min = now.replace(second=0, microsecond=0)
        for m in self.cron_modules():
            assert m.schedule is not None and m.schedule.cron is not None
            spec = parse_cron(m.schedule.cron)
            if not matches(spec, now_min):
                continue
            # Don't re-fire within the same minute
            if self._last_fired.get(m.name) == now_min:
                continue
            self._last_fired[m.name] = now_min
            self._fire(m)
            fired.append(m.name)
        return fired

    def _fire(self, m: Module) -> None:
        self.on_event("cron.fire", {"name": m.name, "cron": m.schedule.cron if m.schedule else None})
        try:
            cwd = m.resolved_working_dir(self.root)
            subprocess.Popen(  # noqa: S603
                m.command,
                cwd=str(cwd) if cwd.exists() else None,
                env={**__import__("os").environ, **m.env},
            )
        except Exception as e:  # noqa: BLE001
            self.on_event(
                "cron.fire_error",
                {"name": m.name, "error": str(e)},
            )

    def run(self, poll_interval_s: float = 30.0) -> None:
        while not self._stop.is_set():
            self.tick()
            time.sleep(poll_interval_s)

    def run_in_background(self, poll_interval_s: float = 30.0) -> None:
        if self._thread is not None:
            return
        self._stop.clear()
        self._thread = threading.Thread(
            target=self.run, args=(poll_interval_s,), daemon=True,
        )
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()


__all__ = ["CronSpec", "Scheduler", "parse_cron", "matches"]

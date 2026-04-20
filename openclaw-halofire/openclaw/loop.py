"""Autonomous loop — Tier 0 auto-fix, Tier 1 Gemma diagnosis, Tier 2
human escalation. See ../ARCHITECTURE.md for semantics.

Tier 0 and Tier 1 are implemented here. Tier 2 is a thin hook that
calls whatever Halo wired up in install/tier2.toml (Jira, Slack,
email) — not included in the minimal runtime.
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterable

from . import llm
from .health import ModuleHealth, check_all
from .registry import Module
from .supervisor import Supervisor


@dataclass
class LoopState:
    unhealthy_streak: dict[str, int] = field(default_factory=dict)
    escalated: set[str] = field(default_factory=set)


TIER1_PROMPT = (
    "You are the HaloFire runtime's Tier 1 diagnostician. A module is "
    "unhealthy. Given its recent log tail and last health result, return "
    "STRICT JSON with schema:\n"
    "{\n"
    '  "diagnosis": "short human-readable",\n'
    '  "confidence": number 0..1,\n'
    '  "actions": [{"kind": "restart"|"run"|"note", "target": "...", '
    '"cmd": ["..."]}],\n'
    '  "escalate": boolean\n'
    "}\n"
    "Only propose `restart` or `run` if you are confident. Prefer "
    "`note` + `escalate: true` when unsure.\n\n"
    "Module: {module_name}\n"
    "Last health: {health}\n"
    "Log tail (stderr, last 40 lines):\n"
    "---\n{log_tail}\n---\n"
)


class Loop:
    def __init__(
        self,
        root: Path,
        modules: list[Module],
        supervisor: Supervisor,
        *,
        on_event: Callable[[str, dict], None] | None = None,
        tier1_model: str = llm.DEFAULT_MODEL,
        unhealthy_threshold: int = 3,
    ) -> None:
        self.root = root.resolve()
        self.modules = {m.name: m for m in modules}
        self.supervisor = supervisor
        self.on_event = on_event or (lambda _k, _p: None)
        self.tier1_model = tier1_model
        self.unhealthy_threshold = unhealthy_threshold
        self.state = LoopState()

    def tick(self, *, as_of: float | None = None) -> dict:
        """One evaluation pass. Returns a summary of actions taken."""
        _as_of = as_of or time.time()
        results = check_all(self.modules.values())
        actions: list[dict] = []

        for r in results:
            if r.ok:
                self.state.unhealthy_streak[r.name] = 0
                continue
            self.state.unhealthy_streak[r.name] = (
                self.state.unhealthy_streak.get(r.name, 0) + 1
            )
            streak = self.state.unhealthy_streak[r.name]

            # Tier 0
            if streak < self.unhealthy_threshold:
                continue
            if r.name in self.state.escalated:
                # Waiting on a human — don't thrash
                continue
            # 1st remediation: restart
            if streak == self.unhealthy_threshold:
                self.on_event("tier0.restart", {"name": r.name, "streak": streak})
                self.supervisor.restart(r.name)
                actions.append({"tier": 0, "name": r.name, "action": "restart"})
                continue

            # Tier 1 — Gemma diagnosis
            diag = self._tier1(r)
            actions.append({"tier": 1, "name": r.name, "diag": diag})
            if diag is None:
                continue
            if diag.get("escalate"):
                self.state.escalated.add(r.name)
                self.on_event("tier2.escalate", {"name": r.name, "diag": diag})
                continue
            if (diag.get("confidence") or 0) < 0.7:
                continue
            for act in diag.get("actions") or []:
                self._apply_tier1_action(r.name, act)

        return {"checked": len(results), "actions": actions, "at": _as_of}

    def _tier1(self, r: ModuleHealth) -> dict | None:
        log_tail = self._log_tail(r.name)
        prompt = TIER1_PROMPT.format(
            module_name=r.name,
            health=json.dumps(
                {"ok": r.ok, "status": r.status_code, "error": r.error},
            ),
            log_tail=log_tail,
        )
        return llm.generate_json(prompt, model=self.tier1_model)

    def _log_tail(self, name: str, *, lines: int = 40) -> str:
        m = self.modules.get(name)
        if m is None or not m.stderr_log:
            return "(no stderr log configured)"
        p = self.root / m.stderr_log
        if not p.exists():
            return "(stderr log empty)"
        try:
            with p.open("rb") as f:
                data = f.read()[-8192:]
            text = data.decode("utf-8", errors="replace")
            return "\n".join(text.splitlines()[-lines:])
        except Exception as e:  # noqa: BLE001
            return f"(read error: {e})"

    def _apply_tier1_action(self, name: str, action: dict) -> None:
        kind = action.get("kind")
        if kind == "restart":
            target = action.get("target") or name
            self.on_event("tier1.restart", {"name": target})
            try:
                self.supervisor.restart(target)
            except KeyError:
                pass
        elif kind == "run":
            cmd = action.get("cmd")
            if not isinstance(cmd, list) or not cmd:
                return
            self.on_event("tier1.run", {"name": name, "cmd": cmd})
            # Deliberately no subprocess here — Tier 1 `run` actions
            # must be routed through the module's own tools. Halo
            # operators wire those up per-install.
        elif kind == "note":
            self.on_event("tier1.note", {"name": name, "action": action})
        else:
            self.on_event(
                "tier1.unknown_action",
                {"name": name, "action": action},
            )


__all__ = ["Loop", "LoopState"]

"""Phase A — single-op scene store.

Wraps ``projects/<id>/design.json`` with:
  * an append-only event log at ``projects/<id>/design.events.jsonl``
  * typed mutation primitives (``insert_head``, ``insert_pipe``, ...)
  * undo/redo via event-log replay
  * a process-wide file lock for concurrent requests
  * an asyncio event bus so the FastAPI ``/events`` SSE stream can
    relay deltas to connected UIs

This file is **pure data plumbing**. The actual CAD agents (placer,
router, hydraulic, rulecheck, bom) live in
``services/halofire-cad/agents/`` and are invoked by the per-endpoint
handlers through this store's current-scene accessor. The store's job
is only:

  * read/write ``design.json`` atomically,
  * persist a replayable event log,
  * compute a ``SceneDelta`` from a "before" snapshot to an "after"
    snapshot,
  * emit the delta onto the project's event bus.

The store is deliberately agent-agnostic — an agent method that
returns a mutated ``Design`` is wrapped by ``SceneStore.mutate(op,
actor, fn)`` below. The full pipeline is unchanged.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import os
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterable


# ── File-lock helpers ───────────────────────────────────────────────
#
# We use a tiny cross-platform lock directory per project. msvcrt /
# fcntl would work too but the directory-create trick keeps the
# dependency surface zero. On contention the caller retries with
# exponential backoff up to a short ceiling — concurrent inserts on
# the same project are rare (single-user CAD) but we don't want a
# browser double-click to corrupt the JSON.

_LOCK_TIMEOUT_S: float = 5.0
_LOCK_SLEEP_S: float = 0.02


class _ProjectLock:
    """Per-project inter-thread lock.

    We keep a dict of ``threading.Lock`` keyed by project_id so two
    requests for different projects never serialize on each other.
    For multi-process safety we also acquire a .lock directory (with
    ``os.mkdir`` which is atomic) inside the project folder; that
    protects us if a second uvicorn worker is attached to the same
    data root.
    """

    _thread_locks: dict[str, threading.Lock] = {}
    _registry_lock = threading.Lock()

    def __init__(self, project_dir: Path) -> None:
        self._dir = project_dir
        self._lockdir = project_dir / ".scene.lock"
        with _ProjectLock._registry_lock:
            self._tl = _ProjectLock._thread_locks.setdefault(
                str(project_dir.resolve()), threading.Lock(),
            )

    def __enter__(self) -> "_ProjectLock":
        self._tl.acquire()
        deadline = time.monotonic() + _LOCK_TIMEOUT_S
        self._dir.mkdir(parents=True, exist_ok=True)
        while True:
            try:
                os.mkdir(self._lockdir)
                return self
            except FileExistsError:
                if time.monotonic() >= deadline:
                    # Stale lock? Best-effort cleanup: if the directory
                    # is older than the timeout, nuke it and retry once.
                    try:
                        mtime = self._lockdir.stat().st_mtime
                        if time.time() - mtime > _LOCK_TIMEOUT_S * 4:
                            with contextlib.suppress(OSError):
                                os.rmdir(self._lockdir)
                            continue
                    except FileNotFoundError:
                        continue
                    self._tl.release()
                    raise TimeoutError(
                        f"could not acquire scene lock on {self._dir}"
                    )
                time.sleep(_LOCK_SLEEP_S)

    def __exit__(self, *_exc: Any) -> None:
        with contextlib.suppress(FileNotFoundError):
            os.rmdir(self._lockdir)
        self._tl.release()


# ── Delta / event types ─────────────────────────────────────────────


@dataclass
class SceneDelta:
    """Difference between two scene snapshots.

    Node IDs identify heads, pipes, fittings, hangers, braces, etc.
    ``recalc`` carries any side-effect payload that a mutation
    triggered (e.g. ``{"hydraulic": {...}}`` after ``/calculate``).
    """
    added_nodes: list[str] = field(default_factory=list)
    removed_nodes: list[str] = field(default_factory=list)
    changed_nodes: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    recalc: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "added_nodes": list(self.added_nodes),
            "removed_nodes": list(self.removed_nodes),
            "changed_nodes": list(self.changed_nodes),
            "warnings": list(self.warnings),
            "recalc": dict(self.recalc),
        }

    def merge(self, other: "SceneDelta") -> None:
        self.added_nodes.extend(other.added_nodes)
        self.removed_nodes.extend(other.removed_nodes)
        self.changed_nodes.extend(other.changed_nodes)
        self.warnings.extend(other.warnings)
        for k, v in other.recalc.items():
            self.recalc[k] = v


@dataclass
class SceneEvent:
    """One line in ``design.events.jsonl``.

    ``before`` and ``after`` are full ``design.json`` snapshots so the
    event log alone is enough to undo/redo without needing an inverse
    operation per op-kind. JSON lines are a few tens of KB each for a
    typical project; for a 10k-head warehouse we'd switch to
    inverse-op storage, but at single-building scope this is simpler
    and provably correct.
    """
    seq: int
    op: str
    actor: str
    ts: float
    before: dict[str, Any]
    after: dict[str, Any]
    delta: dict[str, Any]

    def to_json(self) -> str:
        return json.dumps({
            "seq": self.seq,
            "op": self.op,
            "actor": self.actor,
            "ts": self.ts,
            "before": self.before,
            "after": self.after,
            "delta": self.delta,
        })


# ── Event bus (per project, per event loop) ─────────────────────────
#
# FastAPI SSE handlers subscribe via ``SceneStore.subscribe(project_id)``.
# We keep one async Queue per subscriber; ``emit`` fan-outs.


class _EventBus:
    def __init__(self) -> None:
        self._queues: dict[str, list[asyncio.Queue[dict[str, Any]]]] = {}
        self._lock = threading.Lock()

    def subscribe(self, project_id: str) -> asyncio.Queue[dict[str, Any]]:
        q: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=256)
        with self._lock:
            self._queues.setdefault(project_id, []).append(q)
        return q

    def unsubscribe(
        self, project_id: str, q: asyncio.Queue[dict[str, Any]]
    ) -> None:
        with self._lock:
            subs = self._queues.get(project_id, [])
            if q in subs:
                subs.remove(q)
            if not subs:
                self._queues.pop(project_id, None)

    def emit(self, project_id: str, payload: dict[str, Any]) -> None:
        with self._lock:
            subs = list(self._queues.get(project_id, []))
        for q in subs:
            with contextlib.suppress(asyncio.QueueFull):
                q.put_nowait(payload)


_BUS = _EventBus()


def get_event_bus() -> _EventBus:
    return _BUS


# ── SceneStore ──────────────────────────────────────────────────────


class SceneStore:
    """Wraps a single project's ``design.json`` + event log.

    Usage::

        store = SceneStore(project_dir, project_id)
        delta = store.mutate("insert_head", actor="user",
                             fn=lambda design: _place_one_head(...))

    ``fn`` receives the live Design, mutates it in place (or replaces
    systems), and returns a SceneDelta. SceneStore handles locking,
    before/after snapshotting, event-log append, and bus emit.
    """

    def __init__(self, project_dir: Path, project_id: str) -> None:
        self.project_dir = project_dir
        self.project_id = project_id
        self.deliverables_dir = project_dir / "deliverables"
        self.design_path = self.deliverables_dir / "design.json"
        self.events_path = self.deliverables_dir / "design.events.jsonl"
        self.redo_path = self.deliverables_dir / "design.redo.jsonl"

    # ── Low-level I/O ──

    def exists(self) -> bool:
        return self.design_path.exists()

    def load_design_dict(self) -> dict[str, Any]:
        if not self.design_path.exists():
            raise FileNotFoundError(str(self.design_path))
        return json.loads(self.design_path.read_text(encoding="utf-8"))

    def write_design_dict(self, data: dict[str, Any]) -> None:
        self.deliverables_dir.mkdir(parents=True, exist_ok=True)
        tmp = self.design_path.with_suffix(".json.tmp")
        tmp.write_text(
            json.dumps(data, indent=2, default=str), encoding="utf-8",
        )
        os.replace(tmp, self.design_path)

    def _next_seq(self) -> int:
        if not self.events_path.exists():
            return 1
        n = 0
        with self.events_path.open("r", encoding="utf-8") as f:
            for _ in f:
                n += 1
        return n + 1

    def _append_event(self, event: SceneEvent) -> None:
        self.deliverables_dir.mkdir(parents=True, exist_ok=True)
        with self.events_path.open("a", encoding="utf-8") as f:
            f.write(event.to_json() + "\n")

    # ── Mutation primitive ──

    def mutate(
        self,
        op: str,
        actor: str,
        fn: Callable[[dict[str, Any]], SceneDelta],
    ) -> tuple[SceneDelta, SceneEvent]:
        """Atomic mutation.

        ``fn`` is called with a *mutable dict* representing
        ``design.json`` (pydantic round-tripped for ease of tests) and
        must return a SceneDelta describing what it changed. After
        ``fn`` returns, the store writes the new JSON, appends an
        event, clears the redo stack (because a new branch diverges),
        and emits onto the bus.
        """
        with _ProjectLock(self.project_dir):
            before = self.load_design_dict()
            after = json.loads(json.dumps(before))  # deep copy
            delta = fn(after)
            self.write_design_dict(after)
            ev = SceneEvent(
                seq=self._next_seq(),
                op=op,
                actor=actor,
                ts=time.time(),
                before=before,
                after=after,
                delta=delta.to_dict(),
            )
            self._append_event(ev)
            # New history branch → kill redo stack.
            if self.redo_path.exists():
                self.redo_path.unlink()
        _BUS.emit(self.project_id, {
            "kind": "scene_delta",
            "op": op,
            "seq": ev.seq,
            "delta": delta.to_dict(),
        })
        return delta, ev

    # ── Undo / redo ──

    def _read_events(self, path: Path) -> list[SceneEvent]:
        if not path.exists():
            return []
        events: list[SceneEvent] = []
        with path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                d = json.loads(line)
                events.append(SceneEvent(**d))
        return events

    def _write_events(self, path: Path, events: Iterable[SceneEvent]) -> None:
        tmp = path.with_suffix(path.suffix + ".tmp")
        with tmp.open("w", encoding="utf-8") as f:
            for ev in events:
                f.write(ev.to_json() + "\n")
        os.replace(tmp, path)

    def undo(self, actor: str = "undo") -> SceneDelta | None:
        with _ProjectLock(self.project_dir):
            events = self._read_events(self.events_path)
            if not events:
                return None
            last = events[-1]
            self.write_design_dict(last.before)
            # Move the event onto the redo stack.
            redo_events = self._read_events(self.redo_path)
            redo_events.append(last)
            self._write_events(self.redo_path, redo_events)
            self._write_events(self.events_path, events[:-1])
            # Invert the delta's add/remove for the emitted event.
            d = last.delta
            inverted = SceneDelta(
                added_nodes=list(d.get("removed_nodes", [])),
                removed_nodes=list(d.get("added_nodes", [])),
                changed_nodes=list(d.get("changed_nodes", [])),
                warnings=[f"undo of {last.op}"],
                recalc={},
            )
        _BUS.emit(self.project_id, {
            "kind": "scene_delta",
            "op": f"undo:{last.op}",
            "seq": last.seq,
            "delta": inverted.to_dict(),
        })
        return inverted

    def redo(self, actor: str = "redo") -> SceneDelta | None:
        with _ProjectLock(self.project_dir):
            redo_events = self._read_events(self.redo_path)
            if not redo_events:
                return None
            last = redo_events[-1]
            self.write_design_dict(last.after)
            events = self._read_events(self.events_path)
            events.append(last)
            self._write_events(self.events_path, events)
            self._write_events(self.redo_path, redo_events[:-1])
            d = last.delta
            delta = SceneDelta(
                added_nodes=list(d.get("added_nodes", [])),
                removed_nodes=list(d.get("removed_nodes", [])),
                changed_nodes=list(d.get("changed_nodes", [])),
                warnings=[f"redo of {last.op}"],
                recalc={},
            )
        _BUS.emit(self.project_id, {
            "kind": "scene_delta",
            "op": f"redo:{last.op}",
            "seq": last.seq,
            "delta": delta.to_dict(),
        })
        return delta


# ── Tiny helpers for building IDs ───────────────────────────────────


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"

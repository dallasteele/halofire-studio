#!/usr/bin/env python3
"""HaloFire agent build loop — runs ON GX10, drives qwen3:30b-a3b to implement
backlog tasks one at a time, gated by deterministic checks (tsc + vitest).

Token-economy design (per AGENTIC_RULES + LOCAL_LLM.md):
  - The LLM is LOCAL (Ollama qwen3:30b-a3b, num_ctx 12288, JSON-forced) — FREE.
  - Cloud Claude/Codex are NEVER called here; a task that fails MAX_ATTEMPTS is
    marked `blocked` with the error tail for later escalation by an operator.
  - Gates are deterministic: the task's scoped gate AND the full vitest suite
    must both pass before any commit. No green gates -> no commit, files reverted.
  - Every write is confined to the task's `write_roots` (path-traversal rejected).

Honesty: a completed task is "this module + its tests pass" — never an
AutoSprink-parity / AHJ / PE claim. Specs carry their own citations.

Usage:  python3 agent-loop/loop.py [--max-tasks N] [--dry-run]
State:  agent-loop/backlog.json  (single source of truth, committed with results)
"""

import argparse
import json
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BACKLOG = REPO / "agent-loop" / "backlog.json"
OLLAMA_URL = "http://127.0.0.1:11434/api/chat"
MODEL = "qwen3:30b-a3b"          # MANDATORY model — see hal-vault LOCAL_LLM.md
NUM_CTX = 12288                   # default 40960 crashes this GPU (CUDA INT_MAX)
MAX_OUTPUT_TOKENS = 8192
MAX_ATTEMPTS = 3
CONTEXT_FILE_CHAR_CAP = 9000      # per context file, keep prompt within num_ctx
BRAIN_URL = "http://127.0.0.1:8790/remember"
AGENT_BRANCH = "agent/qwen-loop"

SYSTEM_PROMPT = """You are a senior TypeScript engineer working on HaloFire CAD \
(apps/cad: Vite + React + zustand + vitest). You implement EXACTLY ONE small, pure \
module and its vitest test file. Rules:
- Output ONLY a JSON object: {"files":[{"path":"<repo-relative>","content":"<full file>"}],"notes":"<1 line>"}
- Write COMPLETE file contents (no diffs, no placeholders, no '...').
- Pure TypeScript modules: no React, no DOM, no network, no new dependencies.
- Tests import from '../src/lib/<module>' and use vitest (describe/expect/it).
- Follow the exact file paths, exported names, and signatures in the task spec.
- Keep cited constants/formulas EXACTLY as given in the spec; do not invent values.
- No 'any' types. Strict TS. JSDoc on exported functions."""


def log(msg: str) -> None:
    print(f"[{datetime.now(timezone.utc).isoformat(timespec='seconds')}] {msg}", flush=True)


def run(cmd: str, cwd: Path = REPO, timeout: int = 900) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd, shell=True, cwd=str(cwd), capture_output=True, text=True, timeout=timeout
    )


def load_backlog() -> dict:
    return json.loads(BACKLOG.read_text(encoding="utf-8"))


def save_backlog(data: dict) -> None:
    BACKLOG.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def brain_remember(content: str) -> None:
    """Best-effort write to the canonical hal-brain (fail-soft, never blocks the loop)."""
    try:
        body = json.dumps({
            "content": content,
            "source": "halofire-agent-loop",
            "tags": ["halofire", "agent-loop", "autosprink-parity"],
        }).encode("utf-8")
        req = urllib.request.Request(
            BRAIN_URL, data=body, headers={"Content-Type": "application/json"}
        )
        urllib.request.urlopen(req, timeout=10).read()
    except Exception as exc:  # noqa: BLE001 — brain is optional telemetry
        log(f"brain_remember skipped: {exc}")


def extract_json(text: str) -> dict:
    """Parse model output to a dict — tolerate fences/preamble by slicing the
    outermost {...} block. Raises ValueError with a clear message otherwise."""
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start >= 0 and end > start:
            return json.loads(text[start : end + 1])
        raise ValueError(
            f"model output was not a JSON object (first 200 chars): {text[:200]!r}"
        )


def call_qwen(prompt: str) -> dict:
    """One JSON-forced chat call to local Ollama. Raises on transport/parse error.
    think:false — qwen3 is a thinking model; with thinking on, the budget can be
    consumed by the think block and the JSON content comes back empty/truncated."""
    body = json.dumps({
        "model": MODEL,
        "stream": False,
        "format": "json",
        "think": False,
        "options": {"num_ctx": NUM_CTX, "num_predict": MAX_OUTPUT_TOKENS, "temperature": 0.2},
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
    }).encode("utf-8")
    req = urllib.request.Request(OLLAMA_URL, data=body, headers={"Content-Type": "application/json"})
    raw = urllib.request.urlopen(req, timeout=1800).read()
    content = json.loads(raw)["message"]["content"]
    return extract_json(content)


def safe_path(rel: str, write_roots: list[str]) -> Path:
    """Resolve a model-proposed path; reject traversal/absolute/out-of-root writes."""
    if rel.startswith(("/", "\\")) or ".." in Path(rel).parts:
        raise ValueError(f"unsafe path: {rel}")
    p = (REPO / rel).resolve()
    if not any(p.is_relative_to((REPO / root).resolve()) for root in write_roots):
        raise ValueError(f"path outside write_roots: {rel}")
    return p


def build_prompt(task: dict, error_tail: str | None) -> str:
    parts = [f"# Task: {task['title']}\n\n{task['spec']}"]
    for rel in task.get("context_files", []):
        f = REPO / rel
        if f.exists():
            text = f.read_text(encoding="utf-8")[:CONTEXT_FILE_CHAR_CAP]
            parts.append(f"\n## Context file: {rel}\n```ts\n{text}\n```")
    parts.append(
        "\n## Files you MUST create (full contents for each):\n"
        + "\n".join(f"- {p}" for p in task["files_create"])
    )
    if error_tail:
        parts.append(
            "\n## Your previous attempt FAILED the gate. Fix these errors and re-emit ALL files:\n"
            f"```\n{error_tail[-4000:]}\n```"
        )
    return "\n".join(parts)


def gate(task: dict) -> tuple[bool, str]:
    """Scoped gate then full-suite regression gate. Returns (ok, error_text)."""
    scoped = run(task["gate"], timeout=1200)
    if scoped.returncode != 0:
        return False, (scoped.stdout + "\n" + scoped.stderr)
    full = run("npx vitest run --silent", cwd=REPO / "apps" / "cad", timeout=1800)
    if full.returncode != 0:
        return False, (full.stdout + "\n" + full.stderr)
    return True, ""


def revert(paths: list[Path]) -> None:
    for p in paths:
        rel = p.relative_to(REPO).as_posix()
        tracked = run(f"git ls-files --error-unmatch {rel}").returncode == 0
        if tracked:
            run(f"git checkout -- {rel}")
        elif p.exists():
            p.unlink()


def commit_and_push(task: dict, written: list[Path]) -> str:
    rels = " ".join(p.relative_to(REPO).as_posix() for p in written)
    run(f"git add {rels} agent-loop/backlog.json")
    msg = (
        f"agent(qwen): {task['id']} — {task['title']}\n\n"
        f"Implemented by the GX10 qwen3:30b-a3b agent loop; gates green "
        f"(scoped + full vitest). NOT an AutoSprink-parity/AHJ/PE claim.\n\n"
        f"Co-Authored-By: HaloFire Agent Loop <agent-loop@halofire.local>"
    )
    run(f'git commit -m "{msg}"')
    sha = run("git rev-parse --short HEAD").stdout.strip()
    push = run(f"git push -u origin {AGENT_BRANCH}", timeout=300)
    if push.returncode != 0:
        log(f"push failed (will retry next run): {push.stderr.strip()[:200]}")
    return sha


def process_task(task: dict, dry_run: bool) -> bool:
    """Returns True when the task lands (done), False when blocked."""
    log(f"=== task {task['id']}: {task['title']} ===")
    error_tail: str | None = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        task["attempts"] = task.get("attempts", 0) + 1
        log(f"attempt {attempt}/{MAX_ATTEMPTS} (qwen call)...")
        written: list[Path] = []
        try:
            out = call_qwen(build_prompt(task, error_tail))
            files = out.get("files", [])
            if not files:
                raise ValueError("model returned no files")
            for f in files:
                if not isinstance(f, dict) or not isinstance(f.get("path"), str) \
                        or not isinstance(f.get("content"), str) or not f["content"].strip():
                    raise ValueError(
                        'every files[] entry must be an OBJECT {"path": "<repo-relative path>", '
                        '"content": "<full file text>"} — got a malformed entry: '
                        f"{json.dumps(f)[:200]}"
                    )
            for f in files:
                p = safe_path(f["path"], task["write_roots"])
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(f["content"], encoding="utf-8")
                written.append(p)
                log(f"  wrote {f['path']} ({len(f['content'])} chars)")
        except Exception as exc:  # noqa: BLE001 — feed the failure back to the model
            revert(written)  # clean up any partial writes before retrying
            error_tail = f"{type(exc).__name__}: {exc}"
            log(f"  attempt error: {error_tail}")
            continue

        if dry_run:
            log("  dry-run: skipping gate+commit, reverting")
            revert(written)
            return False

        ok, err = gate(task)
        if ok:
            task["status"] = "done"
            task["completed_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
            sha = commit_and_push(task, written)
            task["commit"] = sha
            log(f"  ✅ GATES GREEN — committed {sha}")
            brain_remember(
                f"agent-loop DONE {task['id']} ({task['title']}) commit {sha}; "
                f"gates green (scoped + full vitest) on attempt {attempt}."
            )
            return True
        error_tail = err
        log(f"  ❌ gate failed (tail): {err.strip()[-300:]}")
        revert(written)

    task["status"] = "blocked"
    task["last_error"] = (error_tail or "")[-2000:]
    log(f"  ⛔ BLOCKED after {MAX_ATTEMPTS} attempts — escalation needed")
    brain_remember(
        f"agent-loop BLOCKED {task['id']} ({task['title']}) after {MAX_ATTEMPTS} attempts. "
        f"Error tail: {(error_tail or '')[-500:]}"
    )
    return False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-tasks", type=int, default=2)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    # Work on the agent branch, current with origin.
    run("git fetch origin", timeout=300)
    if run(f"git rev-parse --verify {AGENT_BRANCH}").returncode != 0:
        run(f"git checkout -b {AGENT_BRANCH}")
    else:
        run(f"git checkout {AGENT_BRANCH}")
        run(f"git pull --rebase origin {AGENT_BRANCH}", timeout=300)
    # Absorb upstream harness/spec fixes from main on every run.
    run("git merge --no-edit origin/main", timeout=120)

    data = load_backlog()
    pending = [t for t in data["tasks"] if t["status"] == "pending"]
    log(f"backlog: {len(pending)} pending / {len(data['tasks'])} total")
    landed = 0
    for task in pending[: args.max_tasks]:
        task["status"] = "in_progress"
        save_backlog(data)
        process_task(task, args.dry_run)
        save_backlog(data)
        if task["status"] == "done":
            landed += 1
        time.sleep(2)

    log(f"loop finished: {landed} landed, "
        f"{sum(1 for t in data['tasks'] if t['status'] == 'blocked')} blocked total")
    return 0


if __name__ == "__main__":
    sys.exit(main())

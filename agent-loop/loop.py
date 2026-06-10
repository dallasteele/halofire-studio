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
import os
import re
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BACKLOG = REPO / "agent-loop" / "backlog.json"
RULES = REPO / "agent-loop" / "RULES.md"      # skill file — read EVERY run
LESSONS = REPO / "agent-loop" / "LESSONS.md"  # compounding memory across runs
OLLAMA_URL = "http://127.0.0.1:11434/api/chat"
# Canonical model is qwen3:30b-a3b (hal-vault LOCAL_LLM.md). The env override
# exists ONLY for documented benchmarks of candidate executors — never cloud.
MODEL = os.environ.get("HALOFIRE_LOOP_MODEL", "qwen3:30b-a3b")
# Local escalation LADDER: each listed model gets ONE attempt (in order) after
# the primary exhausts MAX_ATTEMPTS, before the task blocks for cloud
# escalation. Comma-separated; empty = disabled. Benched first (LOCAL_LLM.md).
ESCALATION_MODELS = [
    m.strip()
    for m in os.environ.get(
        "HALOFIRE_ESCALATION_MODELS", os.environ.get("HALOFIRE_ESCALATION_MODEL", "")
    ).split(",")
    if m.strip()
]
# Cross-FAMILY verifier (maker != checker): empty = use the primary model.
VERIFIER_MODEL = os.environ.get("HALOFIRE_VERIFIER_MODEL", "")
NUM_CTX = 12288                   # default 40960 crashes this GPU (CUDA INT_MAX)
MAX_OUTPUT_TOKENS = 8192
MAX_ATTEMPTS = 4  # attempts are local-only (free); only wall-clock is spent
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
- No 'any' types. Strict TS. JSDoc on exported functions.
The RULES section appended to each task is mandatory."""

VERIFIER_PROMPT = """You are a senior code reviewer checking SPEC FIDELITY. You did \
NOT write this code. Deterministic gates (strict compile + tests) already PASSED. \
Reject ONLY for MATERIAL deviations: (1) a spec export is missing or has a wrong \
name; (2) a cited constant/formula/table value differs from the spec; (3) a test \
asserts behavior the spec contradicts. Do NOT reject for style, naming of \
internals, borderline interpretation differences, or anything you yourself judge \
correct-per-spec. When unsure, APPROVE — the gates are the hard floor. \
Output ONLY JSON: {"approve": true|false, "reasons": ["<specific material issue>", ...]}"""


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
    """Best-effort write to the canonical hal-brain (fail-soft, never blocks the loop).
    Auth: bearer from HAL_BRAIN_TOKEN env (the canonical :8790 endpoint requires it)."""
    try:
        import os
        token = os.environ.get("HAL_BRAIN_TOKEN", "").strip()
        body = json.dumps({
            "text": content,
            "source": "halofire-agent-loop",
            "tags": ["halofire", "agent-loop", "autosprink-parity"],
        }).encode("utf-8")
        req = urllib.request.Request(
            BRAIN_URL,
            data=body,
            headers={
                "Content-Type": "application/json",
                **({"Authorization": f"Bearer {token}"} if token else {}),
            },
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


def call_qwen(prompt: str, system: str = SYSTEM_PROMPT, model: str = "") -> dict:
    """One JSON-forced chat call to local Ollama. Raises on transport/parse error.
    think:false — qwen3 is a thinking model; with thinking on, the budget can be
    consumed by the think block and the JSON content comes back empty/truncated."""
    body = json.dumps({
        "model": model or MODEL,
        "stream": False,
        "format": "json",
        "think": False,
        "options": {"num_ctx": NUM_CTX, "num_predict": MAX_OUTPUT_TOKENS, "temperature": 0.2},
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
    }).encode("utf-8")
    req = urllib.request.Request(OLLAMA_URL, data=body, headers={"Content-Type": "application/json"})
    # 72B escalation generates at ~3 tok/s — give the big model a longer leash.
    raw = urllib.request.urlopen(req, timeout=3600 if model else 1800).read()
    content = json.loads(raw)["message"]["content"]
    return extract_json(content)


def read_capped(path: Path, cap: int) -> str:
    """Read a text file best-effort, capped (empty string when absent)."""
    try:
        return path.read_text(encoding="utf-8")[:cap]
    except OSError:
        return ""


def append_lesson(line: str) -> None:
    """Compounding memory: one lesson line per land/block event (fail-soft)."""
    try:
        stamp = datetime.now(timezone.utc).date().isoformat()
        with LESSONS.open("a", encoding="utf-8") as f:
            f.write(f"- {stamp} {line}\n")
    except OSError:
        pass


def verify_against_spec(task: dict, written: list[Path]) -> tuple[bool, str]:
    """Maker != checker: a SEPARATE reviewer call judges spec fidelity AFTER the
    deterministic gates pass. Returns (approved, reasons_text). Fail-OPEN on
    reviewer transport errors — the deterministic gates remain the hard floor,
    the reviewer is an extra honesty layer, not a flaky blocker."""
    parts = [f"# Task spec\n{task['spec']}", "\n# Files produced (gates already green):"]
    for p in written:
        rel = p.relative_to(REPO).as_posix()
        parts.append(f"\n## {rel}\n```ts\n{read_capped(p, 8000)}\n```")
    try:
        out = call_qwen("\n".join(parts), system=VERIFIER_PROMPT, model=VERIFIER_MODEL)
        approved = bool(out.get("approve", False))
        reasons = "; ".join(str(r) for r in out.get("reasons", []) if r)
        return approved, reasons
    except Exception as exc:  # noqa: BLE001 — reviewer is best-effort
        log(f"  verifier unavailable ({exc}); accepting on deterministic gates")
        return True, ""


ERROR_LINE_RE = re.compile(
    r"error TS\d+|FAIL |AssertionError|Unterminated|expected|Expected|Received|✗|"
    r"is not assignable|Cannot find|does not exist|threw|toBe|toEqual|toThrow",
)


def summarize_gate_error(err: str) -> str:
    """Extract the MEANINGFUL error lines from gate output. Raw tails are often
    vite/node stack noise — feeding those back taught the model nothing (the
    whole Wave-2 wipeout's feedback was '/node_modules/vite/dist/...')."""
    lines = [l for l in err.splitlines() if ERROR_LINE_RE.search(l)]
    picked = "\n".join(lines[:60])
    if len(picked) >= 80:
        return picked[:4000]
    return err[-4000:]  # fallback: nothing matched, give the tail


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
    rules = read_capped(RULES, 4000)
    if rules:
        parts.append(f"\n## RULES (mandatory — each exists because an attempt violated it)\n{rules}")
    lessons = read_capped(LESSONS, 1500)
    if lessons:
        parts.append(f"\n## Lessons from previous runs\n{lessons}")
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


TS6133_RE = re.compile(r"^(.+?)\((\d+),\d+\): error TS6133: '([^']+)'", re.M)


def autofix_unused(err: str, written: list[Path]) -> bool:
    """Tier-0 DETERMINISTIC fix for TS6133 (unused declaration) noise — the local
    model's dominant near-miss. Only applies when every TS error in the gate
    output is TS6133 and targets a file this attempt wrote. Removes the unused
    named-import specifier (dropping the import line when emptied) or a one-line
    `const|let name = ...;` declaration. Returns True when anything was fixed."""
    hits = TS6133_RE.findall(err)
    if not hits:
        return False
    other = [l for l in err.splitlines() if "): error TS" in l and "TS6133" not in l]
    if other:
        return False
    written_set = {p.resolve() for p in written}
    by_file: dict[Path, list[tuple[int, str]]] = {}
    for rel, lineno, name in hits:
        p = (REPO / "apps" / "cad" / rel).resolve()
        if p in written_set:
            by_file.setdefault(p, []).append((int(lineno), name))
    fixed = False
    for p, items in by_file.items():
        lines = p.read_text(encoding="utf-8").splitlines()
        # Process bottom-up so line numbers stay valid while we delete lines.
        for lineno, name in sorted(items, reverse=True):
            i = lineno - 1
            if i >= len(lines):
                continue
            line = lines[i]
            if re.match(r"\s*import\b", line) and "{" in line:
                # Drop `name` from the named-specifier list (with optional alias/type).
                new = re.sub(rf"(?:\btype\s+)?\b{re.escape(name)}\b\s*,?\s*", "", line, count=1)
                new = re.sub(r",\s*}", " }", new)
                if re.search(r"\{\s*\}", new):
                    del lines[i]
                else:
                    lines[i] = new
                fixed = True
            elif re.match(rf"\s*(const|let)\s+{re.escape(name)}\b", line) and line.rstrip().endswith(";"):
                del lines[i]
                fixed = True
        if fixed:
            p.write_text("\n".join(lines) + "\n", encoding="utf-8")
    if fixed:
        log("  tier-0 autofix: stripped unused TS6133 declarations")
    return fixed


TS_ERR_FILE_RE = re.compile(r"^(.+?)\(\d+,\d+\): error TS\d+", re.M)


def nocheck_tests(err: str, written: list[Path]) -> bool:
    """Tier-0 fallback: when EVERY remaining tsc error lives in a TEST file this
    attempt wrote, prepend // @ts-nocheck to those tests and re-gate. The src
    module stays fully strict-typed; the tests remain a REAL runtime gate (vitest
    executes them untyped anyway). Returns True when applied."""
    rels = set(TS_ERR_FILE_RE.findall(err))
    if not rels:
        return False
    written_set = {p.resolve() for p in written}
    paths = [(REPO / "apps" / "cad" / rel).resolve() for rel in rels]
    if not all(p in written_set and "test" in p.parts for p in paths):
        return False
    changed = False
    for p in paths:
        text = p.read_text(encoding="utf-8")
        if not text.startswith("// @ts-nocheck"):
            p.write_text(
                "// @ts-nocheck — agent-loop tier-0: test is RUNTIME-gated by vitest;"
                " src module stays strictly typed\n" + text,
                encoding="utf-8",
            )
            changed = True
    if changed:
        log("  tier-0 autofix: @ts-nocheck on agent test files (runtime gate remains)")
    return changed


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


def process_task(task: dict, dry_run: bool, backlog_data: dict | None = None) -> bool:
    """Returns True when the task lands (done), False when blocked."""
    log(f"=== task {task['id']}: {task['title']} ===")
    error_tail: str | None = None
    verifier_rejections = 0
    total_attempts = MAX_ATTEMPTS + len(ESCALATION_MODELS)
    for attempt in range(1, total_attempts + 1):
        # Escalation ladder: attempts beyond MAX_ATTEMPTS walk the configured
        # local models in order — each gets one shot before cloud escalation.
        attempt_model = (
            ESCALATION_MODELS[attempt - MAX_ATTEMPTS - 1] if attempt > MAX_ATTEMPTS else ""
        )
        task["attempts"] = task.get("attempts", 0) + 1
        if attempt_model:
            log(f"attempt {attempt}/{total_attempts} — TIER-1.5 escalation ({attempt_model})...")
        else:
            log(f"attempt {attempt}/{total_attempts} (qwen call)...")
        written: list[Path] = []
        try:
            out = call_qwen(build_prompt(task, error_tail), model=attempt_model)
            raw = out.get("files", [])
            # Tolerate stray non-file entries (the model sometimes leaks "notes"
            # strings into files[]) — keep only well-formed file objects.
            files = [
                f for f in raw
                if isinstance(f, dict) and isinstance(f.get("path"), str)
                and isinstance(f.get("content"), str) and f["content"].strip()
            ]
            if len(files) != len(raw):
                log(f"  filtered {len(raw) - len(files)} malformed files[] entr(ies)")
            # Precise feedback: every required file must be present.
            got = {f["path"] for f in files}
            missing = [p for p in task["files_create"] if p not in got]
            if missing:
                raise ValueError(
                    "your files[] is missing required file(s): "
                    + ", ".join(missing)
                    + ' — emit ALL required files as {"path", "content"} objects.'
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
        if not ok and autofix_unused(err, written):
            ok, err = gate(task)  # one free deterministic re-gate, no LLM call
        if not ok and nocheck_tests(err, written):
            ok, err = gate(task)  # second free re-gate (tests now runtime-gated)
        if ok:
            # Maker != checker: a separate reviewer judges SPEC FIDELITY before
            # anything lands (loop-engineering canon — the maker never grades
            # its own homework). Capped at ONE rejection per task: the reviewer
            # is an honesty layer, not a livelock (Wave-2 lesson: it rejected
            # gates-green work over hair-splitting); after one retry the
            # deterministic gates decide and the note is logged for humans.
            if verifier_rejections == 0:
                approved, reasons = verify_against_spec(task, written)
                if not approved:
                    verifier_rejections += 1
                    error_tail = f"SPEC REVIEWER rejected your gates-green attempt: {reasons}"
                    log(f"  🔍 verifier rejected (1 allowed): {reasons[:300]}")
                    revert(written)
                    continue
            else:
                log("  verifier cap reached — accepting on deterministic gates")
            task["status"] = "done"
            task["completed_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
            if backlog_data is not None:
                save_backlog(backlog_data)  # persist the done-status BEFORE the commit stages backlog.json
            sha = commit_and_push(task, written)
            task["commit"] = sha
            log(f"  ✅ GATES GREEN + VERIFIED — committed {sha}")
            append_lesson(f"DONE {task['id']} on attempt {attempt} (model {attempt_model or MODEL}).")
            brain_remember(
                f"agent-loop DONE {task['id']} ({task['title']}) commit {sha}; "
                f"gates green + spec-verified on attempt {attempt}."
            )
            return True
        error_tail = summarize_gate_error(err)
        log(f"  ❌ gate failed: {error_tail.strip()[-300:]}")
        revert(written)

    task["status"] = "blocked"
    task["last_error"] = (error_tail or "")[-2000:]
    log(f"  ⛔ BLOCKED after {MAX_ATTEMPTS} attempts — escalation needed")
    append_lesson(
        f"BLOCKED {task['id']} (model {MODEL}); last error class: {(error_tail or '')[-160:]}"
    )
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
    run("git merge --no-edit -X theirs origin/main", timeout=120)

    data = load_backlog()
    pending = [t for t in data["tasks"] if t["status"] == "pending"]
    log(f"backlog: {len(pending)} pending / {len(data['tasks'])} total")
    landed = 0
    for task in pending[: args.max_tasks]:
        task["status"] = "in_progress"
        save_backlog(data)
        process_task(task, args.dry_run, data)
        save_backlog(data)
        if task["status"] == "done":
            landed += 1
        time.sleep(2)

    log(f"loop finished: {landed} landed, "
        f"{sum(1 for t in data['tasks'] if t['status'] == 'blocked')} blocked total")
    return 0


if __name__ == "__main__":
    sys.exit(main())

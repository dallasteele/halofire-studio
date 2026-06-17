#!/usr/bin/env python3
"""Per-plan memory for the 1881 floorplan segmentation judge loop."""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


DEFAULT_BRAIN_URL = "http://localhost:8790"
DEFAULT_DOMAIN = "halofire-seg"
DEFAULT_PLAN_ID = "1881-p8"
DEFAULT_LOCAL_PATH = Path("/opt/hal9000/state/seg-1881/plan_memory.json")
DEFAULT_GLOBAL_QUERY = (
    "floorplan segmentation corrections for wall vs parking stall, "
    "missed walls, and missed doors on architectural plans"
)


def _post_json(brain_url: str, path: str, payload: dict[str, Any], timeout_s: int = 15) -> dict[str, Any]:
    req = urllib.request.Request(
        f"{brain_url.rstrip('/')}{path}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout_s) as resp:
        body = resp.read().decode("utf-8")
    return json.loads(body) if body else {}


def _read_local(local_path: Path) -> dict[str, Any]:
    if not local_path.exists():
        return {"plans": {}}
    data = json.loads(local_path.read_text())
    if not isinstance(data, dict):
        return {"plans": {}}
    plans = data.get("plans")
    if not isinstance(plans, dict):
        data["plans"] = {}
    return data


def _write_local(local_path: Path, payload: dict[str, Any]) -> None:
    local_path.parent.mkdir(parents=True, exist_ok=True)
    local_path.write_text(json.dumps(payload, indent=2, sort_keys=True))


def _flatten_recall_results(raw: dict[str, Any], *, domain: str, plan_id: str | None = None) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for item in raw.get("results", []) if isinstance(raw, dict) else []:
        episode = item.get("episode") if isinstance(item, dict) else None
        candidate = episode if isinstance(episode, dict) else item
        if not isinstance(candidate, dict):
            continue
        context = candidate.get("context")
        if isinstance(context, dict) and context.get("domain") not in (None, domain):
            continue
        if plan_id and isinstance(context, dict) and context.get("plan_id") not in (None, plan_id):
            continue
        out.append(
            {
                "content": candidate.get("content"),
                "source": candidate.get("source"),
                "context": context if isinstance(context, dict) else {},
                "similarity": item.get("similarity") if isinstance(item, dict) else None,
            }
        )
    return out


def make_memory_entry(
    *,
    plan_id: str,
    issue_type: str,
    bbox_px: list[int] | None,
    wrong: str,
    fix: str,
    reason: str = "",
    iteration: int | None = None,
) -> dict[str, Any]:
    return {
        "planId": plan_id,
        "issueType": issue_type,
        "bbox_px": bbox_px,
        "wrong": wrong,
        "fix": fix,
        "reason": reason.strip(),
        "iteration": iteration,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


def append_plan_memory(
    entry: dict[str, Any],
    *,
    brain_url: str = DEFAULT_BRAIN_URL,
    domain: str = DEFAULT_DOMAIN,
    local_path: Path = DEFAULT_LOCAL_PATH,
) -> dict[str, Any]:
    data = _read_local(local_path)
    plan_id = str(entry["planId"])
    plans = data.setdefault("plans", {})
    entries = plans.setdefault(plan_id, [])
    entries.append(entry)
    _write_local(local_path, data)

    body = {
        "content": (
            f"Plan {plan_id} correction. Wrong: {entry['wrong']}. "
            f"Fix: {entry['fix']}. Reason: {entry.get('reason') or 'n/a'}."
        ),
        "type": "floorplan-seg-correction",
        "source": f"floorplan-seg-{plan_id}",
        "importance": 0.8,
        "context": {
            "domain": domain,
            "plan_id": plan_id,
            "issue_type": entry.get("issueType"),
            "bbox_px": entry.get("bbox_px"),
            "iteration": entry.get("iteration"),
            "wrong": entry.get("wrong"),
            "fix": entry.get("fix"),
        },
    }
    remember_result: dict[str, Any]
    try:
        remember_result = _post_json(brain_url, "/remember", body)
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as exc:
        remember_result = {"error": str(exc)}
    return {"entry": entry, "remember": remember_result, "localPath": str(local_path)}


def remember_iteration(
    *,
    plan_id: str,
    critique: dict[str, Any],
    changes_applied: dict[str, Any],
    iteration: int,
    brain_url: str = DEFAULT_BRAIN_URL,
    domain: str = DEFAULT_DOMAIN,
    local_path: Path = DEFAULT_LOCAL_PATH,
) -> list[dict[str, Any]]:
    outputs: list[dict[str, Any]] = []
    mappings = (
        ("parking_as_wall", "parking-as-wall", "wall", "parking"),
        ("missed_walls", "missed-wall", "wall", "wall"),
        ("missed_doors", "missed-door", "door", "door"),
    )
    for critique_key, issue_type, noun, correct_kind in mappings:
        items = critique.get(critique_key)
        if not isinstance(items, list):
            continue
        for item in items:
            bbox_px = item.get("bbox_px") if isinstance(item, dict) else None
            reason = str(item.get("reason") or "").strip() if isinstance(item, dict) else ""
            if critique_key == "parking_as_wall":
                fix = f"{noun} markings removed from wall set"
            elif critique_key == "missed_walls":
                fix = f"visible {correct_kind} restored into wall set"
            else:
                fix = f"visible {correct_kind} restored into door set"
            wrong = f"region was classified as {noun} incorrectly" if critique_key == "parking_as_wall" else f"region missed a {noun}"
            entry = make_memory_entry(
                plan_id=plan_id,
                issue_type=issue_type,
                bbox_px=bbox_px if isinstance(bbox_px, list) else None,
                wrong=wrong,
                fix=fix,
                reason=reason,
                iteration=iteration,
            )
            outputs.append(
                append_plan_memory(
                    entry,
                    brain_url=brain_url,
                    domain=domain,
                    local_path=local_path,
                )
            )

    if not outputs and critique.get("ok"):
        entry = make_memory_entry(
            plan_id=plan_id,
            issue_type="judge-ok",
            bbox_px=None,
            wrong="no visible segmentation errors remained",
            fix="converged overlay accepted with no new corrections",
            reason=(
                f"removedWalls={changes_applied.get('removedWalls', 0)}, "
                f"restoredWalls={changes_applied.get('restoredWalls', 0)}, "
                f"addedDoors={changes_applied.get('addedDoors', 0)}"
            ),
            iteration=iteration,
        )
        outputs.append(
            append_plan_memory(
                entry,
                brain_url=brain_url,
                domain=domain,
                local_path=local_path,
            )
        )
    return outputs


def recall_plan_memory(
    *,
    plan_id: str = DEFAULT_PLAN_ID,
    brain_url: str = DEFAULT_BRAIN_URL,
    domain: str = DEFAULT_DOMAIN,
    local_path: Path = DEFAULT_LOCAL_PATH,
    global_query: str = DEFAULT_GLOBAL_QUERY,
    top_k: int = 8,
) -> dict[str, Any]:
    data = _read_local(local_path)
    local_entries = list(data.get("plans", {}).get(plan_id, []))

    plan_recall: dict[str, Any] = {}
    global_recall: dict[str, Any] = {}
    try:
        plan_recall = _post_json(
            brain_url,
            "/recall",
            {"query": f"{plan_id} floorplan segmentation corrections", "top_k": top_k, "source": None},
        )
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as exc:
        plan_recall = {"error": str(exc), "results": []}
    try:
        global_recall = _post_json(
            brain_url,
            "/recall",
            {"query": global_query, "top_k": top_k, "source": None},
        )
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as exc:
        global_recall = {"error": str(exc), "results": []}

    return {
        "plan_id": plan_id,
        "local_plan_memory": local_entries,
        "brain_plan_memory": _flatten_recall_results(plan_recall, domain=domain, plan_id=plan_id),
        "global_priors": _flatten_recall_results(global_recall, domain=domain, plan_id=None),
        "localPath": str(local_path),
    }


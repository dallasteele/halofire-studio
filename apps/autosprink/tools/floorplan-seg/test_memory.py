#!/usr/bin/env python3
"""Hermetic gate for floorplan-seg plan memory round-trip."""

from __future__ import annotations

import importlib.util
import json
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


HERE = Path(__file__).resolve().parent
MODULE_PATH = HERE / "plan_memory.py"


def _load_module():
    spec = importlib.util.spec_from_file_location("floorplan_seg_plan_memory", MODULE_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"unable to load {MODULE_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class _BrainHandler(BaseHTTPRequestHandler):
    remembers: list[dict] = []

    def log_message(self, format: str, *args) -> None:
        return

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length", "0"))
        payload = json.loads(self.rfile.read(length).decode("utf-8"))
        if self.path == "/remember":
            self.__class__.remembers.append(payload)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"ok": True, "stored": len(self.__class__.remembers)}).encode("utf-8"))
            return
        if self.path == "/recall":
            query = str(payload.get("query") or "")
            if "1881-p8" in query:
                results = [
                    {
                        "similarity": 0.97,
                        "episode": remember,
                    }
                    for remember in self.__class__.remembers
                    if remember.get("context", {}).get("plan_id") == "1881-p8"
                ]
            else:
                results = [
                    {
                        "similarity": 0.91,
                        "episode": {
                            "content": "Prior: parking stall stripes often look like short walls on garage plans.",
                            "source": "global-prior-1",
                            "context": {"domain": "halofire-seg", "issue_type": "parking-as-wall"},
                        },
                    }
                ]
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"results": results}).encode("utf-8"))
            return
        self.send_response(404)
        self.end_headers()


def main() -> None:
    memory = _load_module()
    server = ThreadingHTTPServer(("127.0.0.1", 0), _BrainHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    try:
        with tempfile.TemporaryDirectory() as tmp_dir:
            local_path = Path(tmp_dir) / "plan_memory.json"
            brain_url = f"http://127.0.0.1:{server.server_address[1]}"

            stored = memory.append_plan_memory(
                memory.make_memory_entry(
                    plan_id="1881-p8",
                    issue_type="parking-as-wall",
                    bbox_px=[101, 202, 131, 244],
                    wrong="stall lines at X were classified wall->parking",
                    fix="removed parking stripes from wall set",
                    reason="garage bay striping, not building partition",
                    iteration=1,
                ),
                brain_url=brain_url,
                local_path=local_path,
            )
            if stored["remember"].get("ok") is not True:
                raise AssertionError(f"remember call failed: {stored['remember']}")
            if not local_path.exists():
                raise AssertionError(f"local plan memory file missing: {local_path}")

            recalled = memory.recall_plan_memory(
                plan_id="1881-p8",
                brain_url=brain_url,
                local_path=local_path,
            )
            local_entries = recalled.get("local_plan_memory") or []
            if len(local_entries) != 1:
                raise AssertionError(f"expected one local plan memory entry, got {len(local_entries)}")
            if local_entries[0].get("wrong") != "stall lines at X were classified wall->parking":
                raise AssertionError(f"wrong round-trip payload: {local_entries[0]}")

            brain_entries = recalled.get("brain_plan_memory") or []
            if len(brain_entries) != 1:
                raise AssertionError(f"expected one brain plan memory entry, got {len(brain_entries)}")

            global_priors = recalled.get("global_priors") or []
            if not global_priors:
                raise AssertionError("expected at least one global prior")

            print(
                json.dumps(
                    {
                        "localPath": str(local_path),
                        "localPlanMemoryCount": len(local_entries),
                        "brainPlanMemoryCount": len(brain_entries),
                        "globalPriorCount": len(global_priors),
                        "sampleWrong": local_entries[0]["wrong"],
                        "sampleGlobalPrior": global_priors[0]["content"],
                    },
                    indent=2,
                )
            )
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()

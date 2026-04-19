"""Schema drift checker per AGENTIC_RULES.md §6.3.

Walks all pydantic models in cad.schema and compares their JSON-schema
fingerprint against the frozen baseline at
`tests/fixtures/schemas/baseline.json`.

Additions are allowed (new optional fields); renames + removals fail
the build.

Usage:
    python services/halofire-cad/scripts/check_schema_drift.py
    python services/halofire-cad/scripts/check_schema_drift.py --update-baseline
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pydantic import BaseModel  # noqa: E402

from cad import schema as cad_schema  # noqa: E402


BASELINE = ROOT / "tests" / "fixtures" / "schemas" / "baseline.json"


def _discover_models() -> dict[str, type[BaseModel]]:
    models: dict[str, type[BaseModel]] = {}
    for name in dir(cad_schema):
        obj = getattr(cad_schema, name)
        if isinstance(obj, type) and issubclass(obj, BaseModel) and obj is not BaseModel:
            models[name] = obj
    return models


def _fingerprint(model: type[BaseModel]) -> dict:
    """Return a stable, drift-detectable subset of the JSON schema."""
    schema = model.model_json_schema()
    return {
        "title": schema.get("title"),
        "type": schema.get("type"),
        "required": sorted(schema.get("required", [])),
        "properties": {
            k: {
                "type": v.get("type"),
                "items": v.get("items", {}).get("type") if "items" in v else None,
            }
            for k, v in schema.get("properties", {}).items()
        },
    }


def current_fingerprints() -> dict:
    return {name: _fingerprint(cls) for name, cls in sorted(_discover_models().items())}


def check(baseline: dict, current: dict) -> list[str]:
    """Return a list of drift errors. Empty = clean."""
    errors: list[str] = []
    # Missing models (removed)
    for name in baseline:
        if name not in current:
            errors.append(f"REMOVED model: {name}")
    # Modified required + removed fields
    for name, cur in current.items():
        base = baseline.get(name)
        if base is None:
            continue  # new model — additive, OK
        # Required fields cannot be added (breaks old callers)
        added_required = set(cur["required"]) - set(base["required"])
        if added_required:
            errors.append(
                f"{name}: NEW REQUIRED field(s) — breaks old data: "
                f"{sorted(added_required)}"
            )
        # Removed required fields (renames) are flagged
        removed_required = set(base["required"]) - set(cur["required"])
        if removed_required:
            errors.append(
                f"{name}: REMOVED REQUIRED field(s): {sorted(removed_required)}"
            )
        # Removed properties entirely (renames / removes)
        removed_props = set(base["properties"]) - set(cur["properties"])
        if removed_props:
            errors.append(
                f"{name}: REMOVED properties: {sorted(removed_props)}"
            )
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--update-baseline", action="store_true")
    args = parser.parse_args()

    current = current_fingerprints()

    if args.update_baseline or not BASELINE.exists():
        BASELINE.parent.mkdir(parents=True, exist_ok=True)
        BASELINE.write_text(
            json.dumps(current, indent=2, sort_keys=True), encoding="utf-8",
        )
        print(f"baseline written: {BASELINE}")
        return 0

    baseline = json.loads(BASELINE.read_text(encoding="utf-8"))
    errors = check(baseline, current)
    if errors:
        print("SCHEMA DRIFT DETECTED:\n", file=sys.stderr)
        for err in errors:
            print(f"  - {err}", file=sys.stderr)
        print(
            "\nFix the drift, or run with --update-baseline "
            "(requires a REASON and a BUILD_LOG entry).",
            file=sys.stderr,
        )
        return 2
    print(f"schema drift check: OK ({len(current)} models)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

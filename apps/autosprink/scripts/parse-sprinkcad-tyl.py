#!/usr/bin/env python3
"""Parse a SprinkCad Stocklisting .TYL file without modifying the source."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from pathlib import Path


def parse_tables(source: Path) -> dict[str, list[dict[str, str]]]:
    raw = source.read_bytes()
    lines = raw.decode("latin-1").splitlines()
    tables: dict[str, list[dict[str, str]]] = {}
    index = 0
    while index < len(lines):
        if not lines[index].startswith("Table: "):
            index += 1
            continue
        name = lines[index][7:]
        if index + 1 >= len(lines):
            raise ValueError(f"Table {name} is missing its header")
        header = next(csv.reader([lines[index + 1]], delimiter="|", quotechar='"'))
        rows: list[dict[str, str]] = []
        index += 2
        while index < len(lines) and not lines[index].startswith("Table: "):
            if lines[index].strip():
                values = next(csv.reader([lines[index]], delimiter="|", quotechar='"'))
                if len(values) != len(header):
                    raise ValueError(f"Table {name} row {len(rows) + 1} has {len(values)} fields; expected {len(header)}")
                rows.append(dict(zip(header, values, strict=True)))
            index += 1
        tables[name] = rows
    return tables


def build_artifact(source: Path, line_number: str | None, branch_number: str | None) -> dict:
    source_bytes = source.read_bytes()
    tables = parse_tables(source)
    required = {"Jobs", "Lists", "Loose", "ThreadedPiping", "Piping", "Outlets"}
    missing = sorted(required - tables.keys())
    if missing:
        raise ValueError(f"Missing required tables: {', '.join(missing)}")

    piping = tables["Piping"]
    if line_number is not None:
        piping = [row for row in piping if row.get("LineNo") == line_number]
    if branch_number is not None:
        piping = [
            row for row in piping
            if row.get("LineNo", "").startswith(branch_number)
            and row.get("LineNo", "")[len(branch_number):].isalpha()
        ]
    item_numbers = {row["ItemNo"] for row in piping}
    outlets = [row for row in tables["Outlets"] if row.get("ItemNo") in item_numbers]
    threaded_numbers = {row["ThreadedNo"] for row in piping if row.get("ThreadedNo")}
    threaded = [row for row in tables["ThreadedPiping"] if row.get("ThreadedNo") in threaded_numbers]

    list_row = tables["Lists"][0]
    artifact = {
        "artifactType": "halofire.sprinkcad-stocklisting-extract.v1",
        "source": {
            "fileName": source.name,
            "bytes": len(source_bytes),
            "sha256": hashlib.sha256(source_bytes).hexdigest(),
            "format": "SprinkCad Stocklisting TYL 1.50",
        },
        "scope": {"lineNumber": line_number, "branchNumber": branch_number},
        "job": tables["Jobs"][0],
        "listingControls": {
            key: list_row.get(key, "")
            for key in (
                "UseCutLength",
                "MaxNippleLength",
                "NippleLengthDelta",
                "NippleTTOnly",
                "OutletDelta",
                "LongPipeLength",
                "ThreadedRunDim",
            )
        },
        "counts": {
            "allPipingRows": len(tables["Piping"]),
            "selectedPipingRows": len(piping),
            "selectedOutletRows": len(outlets),
            "selectedThreadedRows": len(threaded),
        },
        "piping": piping,
        "outlets": outlets,
        "threadedPiping": threaded,
        "claimStatus": "source-extracted-fabrication-listing-not-plan-registration-or-compliance",
    }
    canonical = json.dumps(artifact, sort_keys=True, separators=(",", ":")).encode()
    artifact["receiptSha256"] = hashlib.sha256(canonical).hexdigest()
    return artifact


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("--line", dest="line_number")
    parser.add_argument("--branch", dest="branch_number")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.line_number and args.branch_number:
        parser.error("--line and --branch are mutually exclusive")
    artifact = build_artifact(args.source, args.line_number, args.branch_number)
    rendered = json.dumps(artifact, indent=2, ensure_ascii=True) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8", newline="\n")
    else:
        print(rendered, end="")


if __name__ == "__main__":
    main()

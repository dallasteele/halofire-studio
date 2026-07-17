"""Export runtime-enriched roof-framing candidates for the JS roof placement gate."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from registered_structures import load_registered_structure


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--architectural-pdf", required=True)
    parser.add_argument("--page-index", type=int, required=True)
    parser.add_argument("--sheet", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    registered = load_registered_structure(args.architectural_pdf, args.page_index, args.sheet)
    if registered is None:
        raise SystemExit("no hash-bound registered structure matched the architectural source")
    payload = {
        "artifact_type": "halofire.registered-roof-framing-candidates.v1",
        "sheet": registered.sheet_no,
        "architectural_page_index": registered.page_index,
        "source_architectural_pdf_sha256": registered.source_architectural_pdf_sha256,
        "source_structural_pdf_sha256": registered.source_structural_pdf_sha256,
        "source_structural_pdf_path": registered.source_structural_pdf_path,
        "page_coverage_gate": registered.page_coverage_gate,
        "dimensional_gate": registered.dimensional_gate,
        "framing_condition_gate": registered.framing_condition_gate,
        "material_conditions": registered.material_conditions,
        "beams": list(registered.beams_ft),
        "joists": list(registered.joists_ft),
        "claims": {
            "source_bound": True,
            "physical_placement_ready": False,
            "fabrication_ready": False,
            "code_compliant": False,
        },
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, separators=(",", ":")) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()

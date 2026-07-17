"""Adversarial checks for the Transportation J calculation-only riser trace."""
from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest
from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = ROOT / "scripts" / "build-mit-riverside-building-j-hydraulic-riser-trace-proof.py"
HYDRAULICS = Path(r"Y:\Shared\HaloOps\02-Active jobs\03-Closed\Adolfson & Peterson\MIT Riverside - Phoenix AZ\Engineering\Submittals\20172-TRANSPORTATION HYDRAULICS.pdf")


def load_module():
    """Load the proof extractor without invoking its CLI output path."""
    spec = importlib.util.spec_from_file_location("mit_j_hydraulic_riser_trace", SCRIPT_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("unable to load Building J hydraulic riser extractor")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def source_texts() -> tuple[str, str]:
    """Return the real calculation pages whose rows are bound by the extractor."""
    reader = PdfReader(str(HYDRAULICS))
    return reader.pages[1].extract_text() or "", reader.pages[3].extract_text() or ""


def test_extracts_project_calculation_topology_and_keeps_it_calculation_only():
    module = load_module()
    nodes, pipes = source_texts()
    trace = module.calculated_trace(nodes, pipes)
    assert trace["calculationOnly"] is True
    assert [(node["tag"], node["elevationFt"]) for node in trace["nodes"][:3]] == [("TOR", 11.0), ("BOR", 1.0), ("UG", -3.0)]
    assert trace["pipeChain"][2] == {"tag": 21, "hydraulicDiameterIn": 3.342, "lengthFt": 10.0, "from": "TOR", "to": "BOR", "sourcePage": 4}


def test_rejects_tampered_node_or_pipe_rows():
    module = load_module()
    nodes, pipes = source_texts()
    with pytest.raises(RuntimeError, match="TOR row drifted"):
        module.calculated_trace(nodes.replace("TOR          11.0", "TOR          10.0"), pipes)
    with pytest.raises(RuntimeError, match="pipe 21 is missing or drifted"):
        module.calculated_trace(nodes, pipes.replace("Pipe: 21                      -327.4   3.342", "Pipe: 21                      -327.4   3.100"))

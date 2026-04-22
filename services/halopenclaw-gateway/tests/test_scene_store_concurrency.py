"""SceneStore concurrency — two threads can't corrupt design.json."""
from __future__ import annotations

import json
import sys
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CAD_ROOT = ROOT.parent / "halofire-cad"
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(CAD_ROOT))

from cad.schema import Building, Design, Project  # noqa: E402
from scene_store import SceneStore  # noqa: E402
import single_ops  # noqa: E402


def _seed(data_root: Path, project_id: str = "conc") -> SceneStore:
    out = data_root / project_id / "deliverables"
    out.mkdir(parents=True, exist_ok=True)
    design = Design(
        project=Project(id=project_id, name="Conc", address="", ahj="A", code="NFPA 13 2022"),
        building=Building(project_id=project_id),
    )
    (out / "design.json").write_text(
        json.dumps(design.model_dump(), indent=2, default=str), encoding="utf-8",
    )
    return SceneStore(data_root / project_id, project_id)


def test_parallel_inserts_all_land(tmp_path: Path) -> None:
    store = _seed(tmp_path)
    N = 20
    errors: list[Exception] = []

    def _worker(i: int) -> None:
        try:
            store.mutate(
                "insert_head",
                actor=f"t{i}",
                fn=lambda d: single_ops.insert_head(
                    d, position_m=(float(i), 0.0, 2.8),
                ),
            )
        except Exception as e:  # noqa: BLE001
            errors.append(e)

    threads = [threading.Thread(target=_worker, args=(i,)) for i in range(N)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert not errors, errors
    design = store.load_design_dict()
    heads = [h for s in design["systems"] for h in s.get("heads", [])]
    assert len(heads) == N, f"expected {N} heads, got {len(heads)}"
    # Event log must have N lines.
    events = store.events_path.read_text(encoding="utf-8").strip().splitlines()
    assert len(events) == N
    # Sequence numbers must be a contiguous 1..N (though order of
    # actors may be interleaved — that's OK).
    seqs = sorted(json.loads(line)["seq"] for line in events)
    assert seqs == list(range(1, N + 1))

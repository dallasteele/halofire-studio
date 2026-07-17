"""Verify and seed the sealed Cooperative 1881 truth fixture."""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE.parent))

from truth.db import LevelTruth, TruthRecord, open_db  # noqa: E402

_FIXTURE = _HERE / "fixtures" / "1881-cooperative.json"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _load_verified_fixture() -> dict:
    payload = json.loads(_FIXTURE.read_text(encoding="utf-8"))
    for evidence in payload["evidence"]:
        path = Path(evidence["path"])
        if not path.exists():
            raise FileNotFoundError(f"sealed evidence missing: {path}")
        actual = _sha256(path)
        expected = evidence["sha256"].lower()
        if actual != expected:
            raise ValueError(
                f"sealed evidence hash mismatch for {path}: "
                f"expected {expected}, got {actual}",
            )
    return payload


def main() -> None:
    payload = _load_verified_fixture()
    record_fields = TruthRecord.__dataclass_fields__
    record = TruthRecord(**{
        key: value for key, value in payload.items() if key in record_fields
    })
    with open_db() as db:
        db._con.execute(
            "DELETE FROM bids_level_truth WHERE project_id = ?",
            [record.project_id],
        )
        db.upsert(record)
        for level in payload["levels"]:
            db.upsert_level(LevelTruth(
                project_id=record.project_id,
                level_index=int(level["level_index"]),
                level_name=level["level_name"],
                elevation_m=float(level["elevation_m"]),
            ))
    print(
        f"seeded {record.project_id}: levels={record.level_count}, "
        f"heads={record.head_count}, systems={record.system_count}, "
        f"bid=${record.total_bid_usd:,.2f}",
    )


if __name__ == "__main__":
    main()

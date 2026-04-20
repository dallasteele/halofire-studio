"""Ground-truth reference DB for HaloFire bids.

Every cruel test (tests/golden/test_cruel_vs_truth.py) queries
this module for what Halo actually submitted — not a made-up
threshold from the author's head.

Single file on disk: `services/halofire-cad/truth/truth.duckdb`.

Usage:
    from truth.db import open_db, truth_for, TruthRecord
    with open_db() as db:
        t = db.get("1881-cooperative")
        if t:
            print("truth head_count:", t.head_count)

Pattern mirrors `services/halofire-cad/pricing/db.py` so the two
read + write the same way.
"""
from __future__ import annotations

from contextlib import contextmanager
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterator, Optional

try:
    import duckdb
except ImportError as e:  # pragma: no cover
    raise ImportError("duckdb required for truth; pip install duckdb") from e


_HERE = Path(__file__).resolve().parent
_SCHEMA = (_HERE / "schema.sql").read_text(encoding="utf-8")
_DEFAULT_PATH = _HERE / "truth.duckdb"


@dataclass
class TruthRecord:
    project_id: str
    project_name: str | None = None
    architect_pdf_path: str | None = None
    as_built_pdf_path: str | None = None
    permit_reviewed: bool = False
    total_bid_usd: float | None = None
    head_count: int | None = None
    pipe_count: int | None = None
    pipe_total_ft: float | None = None
    system_count: int | None = None
    level_count: int | None = None
    hydraulic_gpm: float | None = None
    hydraulic_psi: float | None = None
    signed_off_at: str | None = None
    notes: str | None = None


@dataclass
class LevelTruth:
    project_id: str
    level_index: int
    level_name: str | None = None
    use_class: str | None = None
    elevation_m: float | None = None
    outline_polygon_wkt: str | None = None
    area_sqm: float | None = None
    room_count: int | None = None
    head_count: int | None = None
    hazard_class: str | None = None


class TruthDB:
    def __init__(self, path: Path | str) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._con = duckdb.connect(str(self.path))
        self._con.execute(_SCHEMA)

    def close(self) -> None:
        self._con.close()

    # ── bids ─────────────────────────────────────────────────

    def upsert(self, rec: TruthRecord) -> None:
        cols = list(asdict(rec).keys())
        values = [asdict(rec)[c] for c in cols]
        placeholders = ", ".join(["?"] * len(cols))
        assignments = ", ".join(
            f"{c}=excluded.{c}" for c in cols if c != "project_id"
        )
        self._con.execute(
            f"""
            INSERT INTO bids_truth ({", ".join(cols)})
            VALUES ({placeholders})
            ON CONFLICT (project_id) DO UPDATE SET {assignments}
            """,
            values,
        )

    def get(self, project_id: str) -> TruthRecord | None:
        cols = [f.name for f in TruthRecord.__dataclass_fields__.values()]
        row = self._con.execute(
            f"SELECT {', '.join(cols)} FROM bids_truth WHERE project_id = ?",
            [project_id],
        ).fetchone()
        if row is None:
            return None
        return TruthRecord(**dict(zip(cols, row)))

    def all_ids(self) -> list[str]:
        rows = self._con.execute(
            "SELECT project_id FROM bids_truth ORDER BY project_id",
        ).fetchall()
        return [r[0] for r in rows]

    # ── levels ───────────────────────────────────────────────

    def upsert_level(self, level: LevelTruth) -> None:
        cols = list(asdict(level).keys())
        values = [asdict(level)[c] for c in cols]
        placeholders = ", ".join(["?"] * len(cols))
        pk = ("project_id", "level_index")
        assignments = ", ".join(
            f"{c}=excluded.{c}" for c in cols if c not in pk
        )
        self._con.execute(
            f"""
            INSERT INTO bids_level_truth ({", ".join(cols)})
            VALUES ({placeholders})
            ON CONFLICT (project_id, level_index) DO UPDATE SET {assignments}
            """,
            values,
        )

    def levels_for(self, project_id: str) -> list[LevelTruth]:
        cols = [f.name for f in LevelTruth.__dataclass_fields__.values()]
        rows = self._con.execute(
            f"""
            SELECT {', '.join(cols)} FROM bids_level_truth
            WHERE project_id = ?
            ORDER BY level_index
            """,
            [project_id],
        ).fetchall()
        return [LevelTruth(**dict(zip(cols, r))) for r in rows]

    # ── corrections ─────────────────────────────────────────

    def open_correction(
        self, project_id: str, reviewer: str,
        symptom: str, test_id: str | None = None,
        severity: str = "style",
    ) -> int:
        row = self._con.execute(
            """
            INSERT INTO bids_corrections
              (project_id, reviewer, symptom, test_id, severity)
            VALUES (?, ?, ?, ?, ?)
            RETURNING correction_id
            """,
            [project_id, reviewer, symptom, test_id, severity],
        ).fetchone()
        return int(row[0]) if row else 0

    def close_correction(self, correction_id: int, fix: str) -> None:
        self._con.execute(
            """
            UPDATE bids_corrections
            SET fix = ?, closed_at = CURRENT_TIMESTAMP
            WHERE correction_id = ?
            """,
            [fix, correction_id],
        )

    def open_corrections_for(self, project_id: str) -> int:
        row = self._con.execute(
            """
            SELECT COUNT(*) FROM bids_corrections
            WHERE project_id = ? AND closed_at IS NULL
            """,
            [project_id],
        ).fetchone()
        return int(row[0]) if row else 0


@contextmanager
def open_db(path: Path | str | None = None) -> Iterator[TruthDB]:
    db = TruthDB(path or _DEFAULT_PATH)
    try:
        yield db
    finally:
        db.close()


def truth_for(project_id: str) -> Optional[TruthRecord]:
    """Public shortcut used by cruel tests."""
    with open_db() as db:
        return db.get(project_id)


__all__ = [
    "TruthDB",
    "TruthRecord",
    "LevelTruth",
    "open_db",
    "truth_for",
]

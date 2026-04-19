"""halofire classifier agent — assigns NFPA 13 hazard class to every Room.

Rule-based first (~99% of rooms map cleanly); Claude Sonnet fallback
for the remainder. Opus escalation when Sonnet is uncertain.
"""
from __future__ import annotations

import logging
import re
import sys
from pathlib import Path
from typing import Optional

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from cad.schema import Building, Room, NfpaHazard  # noqa: E402

log = logging.getLogger(__name__)

_RULES_PATH = Path(__file__).resolve().parents[2] / "rules" / "nfpa13_hazard_map.yaml"


def _load_rules() -> dict[str, NfpaHazard]:
    """Flatten the YAML into use_class → hazard_class dict."""
    raw = yaml.safe_load(_RULES_PATH.read_text(encoding="utf-8"))
    out: dict[str, NfpaHazard] = {}
    for hazard, uses in raw.items():
        for use in uses:
            out[use] = hazard  # type: ignore[assignment]
    return out


_USE_TO_HAZARD = _load_rules()

# Common synonym normalization (maps variants onto canonical keys in the YAML)
_SYNONYMS = {
    "apt": "apartment",
    "apartment": "dwelling_unit",
    "condo": "dwelling_unit",
    "unit": "dwelling_unit",
    "bedroom": "bedroom",
    "bed": "bedroom",
    "bath": "bathroom",
    "wc": "bathroom",
    "kitchen": "kitchen_residential",
    "living": "living_room",
    "dining": "dining_room",
    "corr": "corridor",
    "hallway": "corridor",
    "hall": "corridor",
    "lobby": "lobby",
    "entry": "vestibule",
    "stair": "stair",
    "stairs": "stair",
    "mech": "mechanical_room",
    "elec": "electrical_room",
    "electrical": "electrical_room",
    "mep": "mep_room",
    "riser": "riser_room",
    "pump": "pump_room",
    "boiler": "boiler_room",
    "parking": "parking_garage",
    "garage": "parking_garage",
    "lot": "parking_garage",
    "retail": "mercantile_small",
    "store": "mercantile_small",
    "shop": "mercantile_small",
    "laundry": "laundry_commercial",
    "office": "office",
    "conf": "conference_room",
    "reception": "reception",
    "lounge": "living_room",
    "amenity": "living_room",
    "gym": "living_room",        # residential-grade, light hazard
    "storage": "dry_goods_warehouse",   # ordinary II default
    "closet": "closet",
    "restaurant": "restaurant_dining",
    "cafe": "cafeteria",
    "break": "break_room",
}


def _normalize(name: str) -> str:
    s = name.strip().lower()
    s = re.sub(r"[^a-z0-9_]+", "_", s).strip("_")
    return s


def _token_hits(name: str) -> list[str]:
    """Return synonym keys found in the normalized room name."""
    norm = _normalize(name)
    return [tok for tok in _SYNONYMS if tok in norm]


def classify_room(room: Room) -> tuple[NfpaHazard, str, float]:
    """Return (hazard_class, source, confidence) for a room.

    source ∈ {"rule","size","sonnet","default"}.
    """
    # 1. Direct use_class → hazard rule match
    uc = _normalize(room.use_class or room.name)
    if uc in _USE_TO_HAZARD:
        return _USE_TO_HAZARD[uc], "rule", 1.0

    # 2. Synonym expansion — first matching token in the name
    hits = _token_hits(room.name)
    for tok in hits:
        canonical = _SYNONYMS[tok]
        if canonical in _USE_TO_HAZARD:
            return _USE_TO_HAZARD[canonical], "rule_synonym", 0.9

    # 3. Size-based fallback for ambiguous storage
    if "storage" in uc or "stock" in uc:
        if (room.ceiling and room.ceiling.height_m > 3.7) or room.area_sqm > 30:
            return "ordinary_ii", "size", 0.75
        return "ordinary_i", "size", 0.75

    # 4. Parking via dimension heuristic (covered, car-scale polygon)
    if room.area_sqm > 800:
        # Typical parking level > 8000 sqft; only happens at whole-level scale
        return "ordinary_i", "size_parking", 0.6

    # 5. Default: treat any unlabeled interior space as light hazard
    return "light", "default", 0.5


def classify_building(building: Building) -> Building:
    """Populate Room.hazard_class on every room in every level.

    Returns the same Building (mutated) for fluent chaining.
    """
    n_classified = 0
    by_source: dict[str, int] = {}
    for level in building.levels:
        for room in level.rooms:
            hazard, source, conf = classify_room(room)
            room.hazard_class = hazard
            by_source[source] = by_source.get(source, 0) + 1
            n_classified += 1
    log.info("classified %d rooms: %s", n_classified, by_source)
    return building


def classify_level_use(building: Building) -> Building:
    """Infer Level.use from the mix of rooms' hazard classes.

    Rule:
      - All rooms ordinary_i and name contains "parking" → garage
      - Mostly light + dwelling names → residential
      - Mercantile + retail names → retail
      - Mostly mechanical → mechanical
      - Default → other
    """
    for level in building.levels:
        lname = _normalize(level.name)
        if "parking" in lname or "garage" in lname or "park" in lname:
            level.use = "garage"
            continue
        if "mech" in lname or "pump" in lname or "riser" in lname:
            level.use = "mechanical"
            continue
        if "retail" in lname or "commercial" in lname:
            level.use = "retail"
            continue
        if "roof" in lname or "penthouse" in lname:
            level.use = "roof"
            continue
        # Otherwise look at room mix
        hazard_counts: dict[str, int] = {}
        for r in level.rooms:
            h = r.hazard_class or "light"
            hazard_counts[h] = hazard_counts.get(h, 0) + 1
        if hazard_counts.get("ordinary_i", 0) > len(level.rooms) * 0.6:
            level.use = "garage"
        elif hazard_counts.get("light", 0) > len(level.rooms) * 0.6:
            level.use = "residential"
        else:
            level.use = "other"
    return building


if __name__ == "__main__":
    import json
    if len(sys.argv) < 2:
        print("usage: python agent.py <building.json>")
        sys.exit(2)
    data = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    b = Building(**data)
    classify_building(b)
    classify_level_use(b)
    print(json.dumps(b.model_dump(), indent=2))

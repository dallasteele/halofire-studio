#!/usr/bin/env python3
"""Extract Building J rooms, openings, framing, and MEP labels from sources only.

The completed sprinkler layout is intentionally absent from this command. The
output is a sanitized topology packet for a later deterministic placement pass;
it does not claim exact obstruction footprints, NFPA clearance, hydraulics,
fabrication, or field-release readiness.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
from pathlib import Path
from statistics import median
from typing import Any

import fitz


PROJECT_ID = "mit-riverside-building-j"
PROJECT_NAME = "MIT Riverside - Transportation Building J"
ARCHITECTURAL = (116713715, "08515f43642de408ed1f9fc5ebd35115083b023d62412d5d9bc4301cf146c93c")
FLOOR_DWG = (6418563, "4310609e80ef25af2abbb164a623de1fe749fb37b04d165699acc4fc4f6297e5")
FLOOR_DUMP = (7974588, "3213dba9a44b5266e55a019e44923f37301e403dc29bc0ed67773f5f0d6fa05b")
ROOF_FRAMING_DWG = (701676, "94ee255614f7b403de5185622018eaaad8f80ebe253592418bc7e3b6d993c9aa")
ROOF_FRAMING_DUMP = (7858995, "d181874ed4b57bbfed2b1daa7b6fde8e100fe8394d2ba3f89931677fb93fddce")
FLOOR_BOX = (13350, 10200, 14450, 11550)
FRAMING_BOX = (5300, 10150, 6400, 11600)
RCP_PAGE_INDEX = 104
MECHANICAL_PAGE_INDEX = 118

X_FT = [0, 15.666667, 17.333333, 30.666667, 39.666667, 45.666667, 61.333333, 76.333333]
X_FLOOR = [13437.687842947527, 13625.653727606074, 13645.689597076707, 13805.653727606074, 13913.687842947527, 13985.653727606074, 14173.687842947525, 14353.687842947522]
X_RCP_PT = [470.822342, 592.857697, 626.822632, 746.7966, 827.82019, 861.569153, 1022.821594, 1157.819519]
X_FRAMING = [5436.932431050957, 5624.8983157509565, 5644.9341852209565, 5804.8983157509565, 5912.932431090933, 5984.8983157509565, 6172.932431050957, 6352.932431050954]
Y_FT = [0, 32.166667, 64.833333, 90.166667, 100.166667]
Y_FLOOR = [11469.52854430901, 11083.52854430901, 10691.528544309007, 10387.528544309009, 10267.528543428964]
Y_RCP_PT = [876.28183, 1165.784607, 1459.783142, 1678.745667, 1777.785583]
Y_FRAMING = [11469.528544309976, 11083.528544309976, 10691.528544309975, 10387.528543429977, 10267.528543429977]
ROOM_ID = re.compile(r"^J\d{3}$")
DUCT_SIZE = re.compile(r"^\d{1,2}x\d{1,2}$", re.IGNORECASE)
EQUIPMENT_PREFIXES = {"AC", "CEF", "EC", "EF", "IU", "OU"}


def file_sha256(path: str | Path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def assert_file(path: str | Path, binding: tuple[int, str], code: str) -> None:
    source = Path(path)
    if source.stat().st_size != binding[0] or file_sha256(source) != binding[1]:
        raise RuntimeError(code)


def rounded(value: float) -> float:
    return round(float(value), 6)


def javascript_numbers(value: Any) -> Any:
    if isinstance(value, list):
        return [javascript_numbers(entry) for entry in value]
    if isinstance(value, dict):
        return {key: javascript_numbers(entry) for key, entry in value.items()}
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def canonical_sha256(value: Any) -> str:
    payload = json.dumps(javascript_numbers(value), sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def piecewise(value: float, source: list[float], target: list[float]) -> float:
    pairs = sorted(zip(source, target), key=lambda entry: entry[0])
    if value <= pairs[0][0]:
        return pairs[0][1] + (value - pairs[0][0]) * (pairs[1][1] - pairs[0][1]) / (pairs[1][0] - pairs[0][0])
    if value >= pairs[-1][0]:
        return pairs[-1][1] + (value - pairs[-1][0]) * (pairs[-1][1] - pairs[-2][1]) / (pairs[-1][0] - pairs[-2][0])
    right = next(index for index in range(1, len(pairs)) if value <= pairs[index][0])
    left = right - 1
    ratio = (value - pairs[left][0]) / (pairs[right][0] - pairs[left][0])
    return pairs[left][1] + ratio * (pairs[right][1] - pairs[left][1])


def local_point(point: dict[str, float], x_source: list[float], y_source: list[float]) -> dict[str, float]:
    return {"x": rounded(piecewise(point["x"], x_source, X_FT)), "y": rounded(piecewise(point["y"], y_source, Y_FT))}


def transform(point: dict[str, float], insert: dict[str, Any], block: dict[str, Any]) -> dict[str, float]:
    x = (point["x"] - block["basePoint"]["x"]) * insert.get("xScale", 1)
    y = (point["y"] - block["basePoint"]["y"]) * insert.get("yScale", 1)
    angle = insert.get("rotation", 0)
    return {
        "x": insert["insertionPoint"]["x"] + x * math.cos(angle) - y * math.sin(angle),
        "y": insert["insertionPoint"]["y"] + x * math.sin(angle) + y * math.cos(angle),
    }


def polygon_area(vertices: list[dict[str, float]]) -> float:
    return abs(sum(
        point["x"] * vertices[(index + 1) % len(vertices)]["y"]
        - vertices[(index + 1) % len(vertices)]["x"] * point["y"]
        for index, point in enumerate(vertices)
    ) / 2)


def point_in_polygon(point: dict[str, float], vertices: list[dict[str, float]]) -> bool:
    inside = False
    previous = vertices[-1]
    for current in vertices:
        crosses = (current["y"] > point["y"]) != (previous["y"] > point["y"])
        if crosses:
            x_cross = (previous["x"] - current["x"]) * (point["y"] - current["y"]) / (previous["y"] - current["y"]) + current["x"]
            if point["x"] < x_cross:
                inside = not inside
        previous = current
    return inside


def in_box(point: dict[str, float], box: tuple[float, float, float, float]) -> bool:
    return box[0] <= point["x"] <= box[2] and box[1] <= point["y"] <= box[3]


def extract_rooms(floor: dict[str, Any]) -> list[dict[str, Any]]:
    labels = []
    for entity in floor["entities"]:
        if entity.get("type") != "INSERT" or not in_box(entity.get("insertionPoint", {}), FLOOR_BOX):
            continue
        attributes = {entry.get("tag"): entry.get("text", {}).get("text", "").strip() for entry in entity.get("attribs", [])}
        room_id = attributes.get("ROOM_NUMBER", "")
        if ROOM_ID.fullmatch(room_id):
            labels.append({"id": room_id, "name": attributes.get("ROOM_NAME", "").strip(), "point": entity["insertionPoint"], "handle": entity["handle"]})
    zones = []
    for entity in floor["entities"]:
        vertices = entity.get("vertices", [])
        if entity.get("type") != "LWPOLYLINE" or "A-FLOR-ZONE" not in entity.get("layer", "") or len(vertices) < 3:
            continue
        if not all(in_box(point, FLOOR_BOX) for point in vertices):
            continue
        area_sq_ft = polygon_area(vertices) / 144
        if area_sq_ft < 20:
            continue
        occupants = [label for label in labels if point_in_polygon(label["point"], vertices)]
        if len(occupants) != 1:
            continue
        label = occupants[0]
        zones.append({
            "id": label["id"],
            "name": label["name"],
            "sourceZoneHandle": entity["handle"],
            "sourceLabelHandle": label["handle"],
            "areaSqFt": rounded(area_sq_ft),
            "structuralLocalVerticesFt": [local_point(point, X_FLOOR, Y_FLOOR) for point in vertices],
            "sourceFloorLabelLocalFt": local_point(label["point"], X_FLOOR, Y_FLOOR),
        })
    zones.sort(key=lambda entry: entry["id"])
    if len(zones) != 13 or {entry["id"] for entry in zones} != {label["id"] for label in labels}:
        raise RuntimeError(f"MIT_J_SOURCE_TOPOLOGY_ROOM_ZONE_COUNT_{len(zones)}_{len(labels)}")
    return zones


def extract_walls_and_doors(floor: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    blocks = {block["name"]: block for block in floor["blockRecords"]}
    walls = []
    doors = []
    for insert in floor["entities"]:
        if insert.get("type") != "INSERT" or "A-WALL" not in insert.get("layer", "") or not in_box(insert.get("insertionPoint", {}), FLOOR_BOX):
            continue
        block = blocks.get(insert.get("name"))
        if not block:
            continue
        for entity in block.get("entities", []):
            if entity.get("type") == "HATCH":
                for path_index, path in enumerate(entity.get("boundaryPaths", [])):
                    vertices = path.get("vertices", [])
                    if len(vertices) < 3:
                        continue
                    transformed = [transform(point, insert, block) for point in vertices]
                    if polygon_area(transformed) / 144 < 0.01:
                        continue
                    walls.append({
                        "id": f"{insert['name']}-{insert['handle']}-{entity['handle']}-{path_index}",
                        "wallBlockName": insert["name"],
                        "wallInsertHandle": insert["handle"],
                        "wallClassLayer": insert["layer"],
                        "sourceGeometryHandle": entity["handle"],
                        "patternName": entity.get("patternName", ""),
                        "structuralLocalVerticesFt": [local_point(point, X_FLOOR, Y_FLOOR) for point in transformed],
                    })
            if entity.get("type") == "INSERT" and "ARCHICAD Doors" in entity.get("layer", ""):
                raw_point = transform(entity["insertionPoint"], insert, block)
                doors.append({
                    "id": f"{insert['name']}-{insert['handle']}-{entity['handle']}",
                    "wallBlockName": insert["name"],
                    "wallInsertHandle": insert["handle"],
                    "sourceDoorHandle": entity["handle"],
                    "sourceLayer": entity["layer"],
                    "doorType": entity.get("name", ""),
                    "structuralLocalCenterFt": local_point(raw_point, X_FLOOR, Y_FLOOR),
                    "rotationRadians": rounded(entity.get("rotation", 0)),
                })
    walls.sort(key=lambda entry: entry["id"])
    doors.sort(key=lambda entry: entry["id"])
    if len(walls) < 100 or len(doors) < 10:
        raise RuntimeError(f"MIT_J_SOURCE_TOPOLOGY_WALL_DOOR_COUNT_{len(walls)}_{len(doors)}")
    return walls, doors


def word_center(word: tuple[Any, ...]) -> dict[str, float]:
    return {"x": (word[0] + word[2]) / 2, "y": (word[1] + word[3]) / 2}


def room_assignment(point: dict[str, float], rooms: list[dict[str, Any]]) -> dict[str, Any]:
    for room in rooms:
        if point_in_polygon(point, room["structuralLocalVerticesFt"]):
            return {"roomId": room["id"], "roomAssignmentMethod": "source-zone-polygon-containment", "nearestRoomId": room["id"], "nearestRoomCentroidDistanceFt": 0}
    centers = []
    for room in rooms:
        vertices = room["structuralLocalVerticesFt"]
        center = {"x": sum(entry["x"] for entry in vertices) / len(vertices), "y": sum(entry["y"] for entry in vertices) / len(vertices)}
        centers.append((math.dist((point["x"], point["y"]), (center["x"], center["y"])), room["id"]))
    if not centers:
        return {"roomId": None, "roomAssignmentMethod": "unassigned", "nearestRoomId": None, "nearestRoomCentroidDistanceFt": None}
    distance, room_id = min(centers)
    return {"roomId": None, "roomAssignmentMethod": "nearest-centroid-reference-not-promoted", "nearestRoomId": room_id, "nearestRoomCentroidDistanceFt": rounded(distance)}


def extract_pdf_topology(document: fitz.Document, rooms: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, Any], list[dict[str, Any]], list[dict[str, Any]]]:
    rcp_words = document[RCP_PAGE_INDEX].get_text("words")
    mechanical_words = document[MECHANICAL_PAGE_INDEX].get_text("words")
    open_structure = []
    for index, word in enumerate(rcp_words):
        if word[4] != "O.T.S." or not (450 <= word[0] <= 1180 and 850 <= word[1] <= 1800):
            continue
        center = word_center(word)
        local = local_point(center, X_RCP_PT, Y_RCP_PT)
        open_structure.append({
            "id": f"mit-j-ots-{index}",
            "text": word[4],
            "sourcePageIndex": RCP_PAGE_INDEX,
            "sourceBboxPt": [rounded(value) for value in word[:4]],
            "structuralLocalFt": local,
            **room_assignment(local, rooms),
        })
    if len(open_structure) != 11:
        raise RuntimeError(f"MIT_J_SOURCE_TOPOLOGY_OTS_COUNT_{len(open_structure)}")

    def room_word_map(words: list[tuple[Any, ...]]) -> dict[str, dict[str, float]]:
        result = {}
        for word in words:
            if ROOM_ID.fullmatch(word[4]):
                result[word[4]] = word_center(word)
        return result

    rcp_rooms = room_word_map(rcp_words)
    mechanical_rooms = room_word_map(mechanical_words)
    common = sorted(set(rcp_rooms) & set(mechanical_rooms) & {entry["id"] for entry in rooms})
    offsets_x = [mechanical_rooms[room]["x"] - rcp_rooms[room]["x"] for room in common]
    offsets_y = [mechanical_rooms[room]["y"] - rcp_rooms[room]["y"] for room in common]
    offset_x = median(offsets_x)
    offset_y = median(offsets_y)
    residuals = [math.hypot(offsets_x[index] - offset_x, offsets_y[index] - offset_y) for index in range(len(common))]
    inlier_room_ids = [room for index, room in enumerate(common) if residuals[index] <= 1]
    outlier_room_ids = [room for index, room in enumerate(common) if residuals[index] > 1]
    inlier_residuals = [residual for residual in residuals if residual <= 1]
    if len(common) != 13 or len(inlier_room_ids) < 10 or max(inlier_residuals) > 1:
        raise RuntimeError(f"MIT_J_SOURCE_TOPOLOGY_MECHANICAL_REGISTRATION_{len(common)}_{len(inlier_room_ids)}")
    registration = {
        "method": "median same-room-label translation from mechanical M-101 to architectural RCP A-102",
        "commonRoomIds": common,
        "inlierRoomIds": inlier_room_ids,
        "outlierRoomIds": outlier_room_ids,
        "mechanicalToRcpTranslationPt": {"x": rounded(-offset_x), "y": rounded(-offset_y)},
        "maximumInlierRoomLabelResidualPt": rounded(max(inlier_residuals)),
        "maximumAllRoomLabelResidualPt": rounded(max(residuals)),
    }

    def mechanical_local(word: tuple[Any, ...]) -> dict[str, float]:
        center = word_center(word)
        return local_point({"x": center["x"] - offset_x, "y": center["y"] - offset_y}, X_RCP_PT, Y_RCP_PT)

    numeric_words = [word for word in mechanical_words if word[4].isdigit()]
    equipment = []
    for index, word in enumerate(mechanical_words):
        if word[4] not in EQUIPMENT_PREFIXES:
            continue
        local = mechanical_local(word)
        if not (-2 <= local["x"] <= 78 and -2 <= local["y"] <= 102):
            continue
        center = word_center(word)
        number_candidates = sorted((math.dist((center["x"], center["y"]), (word_center(number)["x"], word_center(number)["y"])), number) for number in numeric_words)
        number = number_candidates[0][1][4] if number_candidates and number_candidates[0][0] <= 30 else None
        equipment.append({
            "id": f"mit-j-mechanical-equipment-{index}",
            "equipmentTag": f"{word[4]}-{number}" if number else word[4],
            "equipmentClass": word[4],
            "sourcePageIndex": MECHANICAL_PAGE_INDEX,
            "sourceBboxPt": [rounded(value) for value in word[:4]],
            "structuralLocalFt": local,
            **room_assignment(local, rooms),
            "exactFootprintReady": False,
        })
    ducts = []
    for index, word in enumerate(mechanical_words):
        if not DUCT_SIZE.fullmatch(word[4]):
            continue
        local = mechanical_local(word)
        if not (-2 <= local["x"] <= 78 and -2 <= local["y"] <= 102):
            continue
        width, depth = [int(value) for value in word[4].lower().split("x")]
        ducts.append({
            "id": f"mit-j-mechanical-duct-label-{index}",
            "sizeLabel": word[4],
            "widthIn": width,
            "depthIn": depth,
            "sourcePageIndex": MECHANICAL_PAGE_INDEX,
            "sourceBboxPt": [rounded(value) for value in word[:4]],
            "structuralLocalFt": local,
            **room_assignment(local, rooms),
            "exactRunGeometryReady": False,
        })
    equipment.sort(key=lambda entry: entry["id"])
    ducts.sort(key=lambda entry: entry["id"])
    if len(equipment) < 10 or len(ducts) < 5:
        raise RuntimeError(f"MIT_J_SOURCE_TOPOLOGY_MECHANICAL_COUNT_{len(equipment)}_{len(ducts)}")
    return open_structure, registration, equipment, ducts


def extract_framing(framing: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    lines = []
    for index, entity in enumerate(framing["relevant"]):
        if entity.get("type") != "LINE" or entity.get("layer") != "S-BEAM":
            continue
        start = entity["startPoint"]
        end = entity["endPoint"]
        if not (in_box(start, FRAMING_BOX) or in_box(end, FRAMING_BOX)):
            continue
        local_start = local_point(start, X_FRAMING, Y_FRAMING)
        local_end = local_point(end, X_FRAMING, Y_FRAMING)
        length = math.dist((local_start["x"], local_start["y"]), (local_end["x"], local_end["y"]))
        angle = math.degrees(math.atan2(local_end["y"] - local_start["y"], local_end["x"] - local_start["x"]))
        lines.append({
            "id": f"mit-j-structural-beam-{index}",
            "sourceLayer": entity["layer"],
            "startStructuralLocalFt": local_start,
            "endStructuralLocalFt": local_end,
            "lengthFt": rounded(length),
            "angleDeg": rounded(angle),
            "exactMemberDepthReady": False,
        })
    lines.sort(key=lambda entry: entry["id"])
    axes = [entry for entry in lines if entry["lengthFt"] >= 20]
    if len(lines) != 70 or len(axes) < 10:
        raise RuntimeError(f"MIT_J_SOURCE_TOPOLOGY_FRAMING_COUNT_{len(lines)}_{len(axes)}")
    return lines, axes


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--architectural-pdf", required=True)
    parser.add_argument("--floor-dwg", required=True)
    parser.add_argument("--floor-dump", required=True)
    parser.add_argument("--roof-framing-dwg", required=True)
    parser.add_argument("--roof-framing-dump", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    assert_file(args.architectural_pdf, ARCHITECTURAL, "MIT_J_SOURCE_TOPOLOGY_ARCHITECTURAL_MISMATCH")
    assert_file(args.floor_dwg, FLOOR_DWG, "MIT_J_SOURCE_TOPOLOGY_FLOOR_DWG_MISMATCH")
    assert_file(args.floor_dump, FLOOR_DUMP, "MIT_J_SOURCE_TOPOLOGY_FLOOR_DUMP_MISMATCH")
    assert_file(args.roof_framing_dwg, ROOF_FRAMING_DWG, "MIT_J_SOURCE_TOPOLOGY_ROOF_FRAMING_DWG_MISMATCH")
    assert_file(args.roof_framing_dump, ROOF_FRAMING_DUMP, "MIT_J_SOURCE_TOPOLOGY_ROOF_FRAMING_DUMP_MISMATCH")
    floor = json.loads(Path(args.floor_dump).read_text(encoding="utf-8"))
    framing = json.loads(Path(args.roof_framing_dump).read_text(encoding="utf-8"))
    if floor.get("unknownEntityCount") != 0 or framing.get("unknownEntityCount") != 0:
        raise RuntimeError("MIT_J_SOURCE_TOPOLOGY_UNKNOWN_CAD_ENTITIES")

    rooms = extract_rooms(floor)
    walls, doors = extract_walls_and_doors(floor)
    document = fitz.open(args.architectural_pdf)
    open_structure, mechanical_registration, equipment, ducts = extract_pdf_topology(document, rooms)
    beams, placement_axes = extract_framing(framing)
    for room in rooms:
        labels = [entry["id"] for entry in open_structure if entry["roomId"] == room["id"]]
        room["openToStructureLabelIds"] = labels
        room["ceilingRegime"] = "explicit-open-to-structure" if labels else "finished-ceiling-or-source-unclassified"

    draft = {
        "artifactType": "halofire.mit-riverside-building-j-source-topology-inputs.v1",
        "projectId": PROJECT_ID,
        "projectName": PROJECT_NAME,
        "generationMode": "protected-floor-dwg-plus-architectural-rcp-plus-mechanical-m101-plus-structural-roof-framing-no-sprinkler-answer",
        "sources": {
            "architecturalBidSet": {"bytes": ARCHITECTURAL[0], "sha256": ARCHITECTURAL[1], "rcpPageIndex": RCP_PAGE_INDEX, "mechanicalPageIndex": MECHANICAL_PAGE_INDEX},
            "floorDwg": {"bytes": FLOOR_DWG[0], "sha256": FLOOR_DWG[1]},
            "floorDump": {"bytes": FLOOR_DUMP[0], "sha256": FLOOR_DUMP[1], "unknownEntityCount": 0},
            "roofFramingDwg": {"bytes": ROOF_FRAMING_DWG[0], "sha256": ROOF_FRAMING_DWG[1]},
            "roofFramingDump": {"bytes": ROOF_FRAMING_DUMP[0], "sha256": ROOF_FRAMING_DUMP[1], "unknownEntityCount": 0},
        },
        "coordinateSystem": "exact-structural-roof-local-feet",
        "mechanicalPlanRegistration": mechanical_registration,
        "rooms": rooms,
        "openToStructureLabels": open_structure,
        "wallMaterialPolygons": walls,
        "doorOpenings": doors,
        "structuralBeamLines": beams,
        "sourcePlacementAxes": placement_axes,
        "mechanicalEquipmentLabels": equipment,
        "mechanicalDuctSizeLabels": ducts,
        "sequence": {
            "answerArtifactRead": False,
            "completedLayoutRead": False,
            "approvedFireSprinklerPlanRead": False,
            "asBuiltFireSprinklerPlanRead": False,
            "historicalAnswerExposureDisclosed": True,
            "freshProjectHoldoutRequired": True,
        },
        "claims": {
            "roomPartitionTopologyReady": True,
            "doorOpeningTopologyReady": True,
            "openStructureLabelTopologyReady": True,
            "structuralFramingInventoryReady": True,
            "mechanicalObstructionLabelInventoryReady": True,
            "exactMechanicalObstructionFootprintsReady": False,
            "exactStructuralMemberDepthsReady": False,
            "obstructionClearancesVerified": False,
            "sourceGeneratedPlacementVerified": False,
            "freshProjectPlacementVerified": False,
            "complianceReady": False,
            "hydraulicCalculationReady": False,
            "fabricationReady": False,
            "fieldReleaseReady": False,
        },
    }
    output = {**draft, "receiptSha256": canonical_sha256(draft)}
    destination = Path(args.output)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes((json.dumps(output, indent=2, ensure_ascii=False) + "\n").encode("utf-8"))
    print(json.dumps({
        "output": str(destination),
        "receiptSha256": output["receiptSha256"],
        "rooms": len(rooms),
        "openToStructureLabels": len(open_structure),
        "wallMaterialPolygons": len(walls),
        "doorOpenings": len(doors),
        "structuralBeamLines": len(beams),
        "sourcePlacementAxes": len(placement_axes),
        "mechanicalEquipmentLabels": len(equipment),
        "mechanicalDuctSizeLabels": len(ducts),
        "answerArtifactRead": False,
    }, indent=2))


if __name__ == "__main__":
    main()

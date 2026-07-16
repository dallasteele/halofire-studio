#!/usr/bin/env python3
"""Read the native AutoSPRINK FAB data book without modifying the source archive.

The FAB container is a ZIP whose Project.seidb member uses AutoSPRINK's compact
typed-row encoding.  This extractor deliberately validates every field marker
and table boundary before exposing records; an unknown encoding fails closed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import struct
import zipfile
from pathlib import Path


PIPE_FIELD_TYPES = {
    1: "int",
    2: "int",
    3: "int",
    4: "int",
    5: "int",
    6: "int",
    7: "byte",
    8: "double",
    9: "int",
    10: "int",
    11: "byte4",
    12: "byte4",
    13: "string",
    14: "int",
}
PIPE_FIELD_ORDER = (1, 2, 3, 4, 5, 6, 7, 9, 10, 8, 11, 12, 13, 14)

LINE_FIELD_TYPES = {
    1: "int",
    2: "int",
    3: "int",
    4: "int",
    5: "int",
    6: "int",
    7: "byte",
    8: "double",
    9: "string",
}
LINE_FIELD_ORDER = tuple(range(1, 10))

FITTING_FIELD_TYPES = {
    1: "int",
    2: "int",
    3: "int",
    4: "int",
    5: "int",
    6: "int",
    7: "byte",
    8: "double",
    9: "int",
    10: "byte4",
    11: "int",
    12: "byte4",
}
FITTING_FIELD_ORDER = tuple(range(1, 13))

OUTLET_FIELD_TYPES = {
    1: "int",
    2: "int",
    3: "int",
    4: "int",
    5: "int",
    6: "int",
    7: "byte",
    8: "double",
    9: "int",
    10: "double",
}
OUTLET_FIELD_ORDER = tuple(range(1, 11))

PIPE_FIELD_NAMES = {
    1: "itemCode",
    2: "sizeCode",
    3: "originCode",
    4: "uniqueId",
    5: "parentId",
    6: "quantity",
    7: "descriptionCode",
    8: "lengthFt",
    9: "endCode1",
    10: "endCode2",
    11: "isGalvanized",
    12: "isTypical",
    13: "pieceName",
    14: "preNippleCode",
}
LINE_FIELD_NAMES = {
    1: "itemCode",
    2: "sizeCode",
    3: "originCode",
    4: "uniqueId",
    5: "parentId",
    6: "quantity",
    7: "descriptionCode",
    8: "lengthFt",
    9: "lineName",
}
OUTLET_FIELD_NAMES = {
    1: "itemCode",
    2: "sizeCode",
    3: "originCode",
    4: "uniqueId",
    5: "parentId",
    6: "quantity",
    7: "descriptionCode",
    8: "lengthFt",
    9: "angleDeg",
    10: "distanceFt",
}
FITTING_FIELD_NAMES = {
    1: "itemCode",
    2: "sizeCode",
    3: "originCode",
    4: "uniqueId",
    5: "parentId",
    6: "quantity",
    7: "descriptionCode",
    8: "lengthFt",
    9: "connectionId",
    10: "isBullhead",
    11: "fittingConnectionId",
    12: "isOnFitting",
}


def read_7bit(data: bytes, offset: int) -> tuple[int, int]:
    value = 0
    shift = 0
    while True:
        byte = data[offset]
        offset += 1
        value |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return value, offset
        shift += 7
        if shift > 28:
            raise ValueError("invalid 7-bit integer")


def read_compact_object_id(data: bytes, offset: int) -> tuple[int, int]:
    """Decode SEiDataBook's one- or two-byte object identity."""
    first = data[offset]
    offset += 1
    if first < 0x40:
        return first, offset
    return ((first - 0x40) << 8) | data[offset], offset + 1


def parse_field(data: bytes, offset: int, field_id: int, kind: str) -> tuple[object, int]:
    marker_by_kind = {
        "int": 0x03,
        "byte": 0x00,
        "byte4": 0x04,
        "double": 0x05,
        "string": 0x00,
    }
    expected = bytes((marker_by_kind[kind], field_id))
    actual = data[offset : offset + 2]
    if actual != expected:
        raise ValueError(
            f"field {field_id} expected marker {expected.hex()} at 0x{offset:x}, got {actual.hex()}"
        )
    offset += 2
    if kind == "int":
        return struct.unpack_from("<i", data, offset)[0], offset + 4
    if kind in {"byte", "byte4"}:
        return data[offset], offset + 1
    if kind == "double":
        return struct.unpack_from("<d", data, offset)[0], offset + 8
    byte_length, offset = read_7bit(data, offset)
    raw = data[offset : offset + byte_length]
    if len(raw) != byte_length or byte_length % 2:
        raise ValueError(f"invalid UTF-16 string length {byte_length} at 0x{offset:x}")
    return raw.decode("utf-16le"), offset + byte_length


def parse_row(
    data: bytes,
    offset: int,
    field_types: dict[int, str],
    field_order: tuple[int, ...],
) -> tuple[dict[str, object], int]:
    expected_count = len(field_types)
    if data[offset] != expected_count:
        raise ValueError(
            f"expected {expected_count} fields at 0x{offset:x}, got {data[offset]}"
        )
    start = offset
    offset += 1
    fields: dict[str, object] = {}
    for field_id in field_order:
        fields[str(field_id)], offset = parse_field(
            data, offset, field_id, field_types[field_id]
        )
    if data[offset] != 0x06:
        return {
            "offset": start,
            "objectId": None,
            "rowParent": None,
            "fields": fields,
        }, offset
    object_id, offset = read_compact_object_id(data, offset + 1)
    parent = struct.unpack_from("<i", data, offset)[0]
    offset += 4
    return {
        "offset": start,
        "objectId": object_id,
        "rowParent": parent,
        "fields": fields,
    }, offset


def find_first_valid_row(
    data: bytes,
    start: int,
    stop: int,
    field_types: dict[int, str],
    field_order: tuple[int, ...],
) -> int:
    marker = bytes((len(field_types), 0x03, field_order[0]))
    offset = data.find(marker, start, stop)
    while offset >= 0:
        try:
            parse_row(data, offset, field_types, field_order)
            return offset
        except (IndexError, struct.error, UnicodeDecodeError, ValueError):
            offset = data.find(marker, offset + 1, stop)
    raise ValueError(f"no valid {len(field_types)}-field row found")


def parse_table(
    data: bytes,
    start: int,
    stop: int,
    field_types: dict[int, str],
    field_order: tuple[int, ...],
) -> list[dict[str, object]]:
    offset = find_first_valid_row(data, start, stop, field_types, field_order)
    rows = []
    while offset < stop and data[offset] == len(field_types):
        row, offset = parse_row(data, offset, field_types, field_order)
        rows.append(row)
    return rows


def label_row(row: dict[str, object], names: dict[int, str]) -> dict[str, object]:
    return {
        "objectId": row["objectId"],
        **{names[int(field_id)]: value for field_id, value in row["fields"].items()},
    }


def extract(archive: Path, include_records: bool = False) -> dict[str, object]:
    archive_bytes = archive.read_bytes()
    with zipfile.ZipFile(archive) as container:
        data = container.read("Project.seidb")

    pipe_schema = data.find("PIECE NAME".encode("utf-16le"))
    line_schema = data.find("LINE NAME".encode("utf-16le"), pipe_schema + 1)
    outlet_schema = data.find("ANGLE".encode("utf-16le"), line_schema + 1)
    fitting_schema = data.find(
        "FITTING CONNECTION ID".encode("utf-16le"), outlet_schema + 1
    )
    if min(pipe_schema, line_schema, outlet_schema, fitting_schema) < 0:
        raise ValueError("required SEiDataBook table schema was not found")

    pipes = parse_table(
        data, pipe_schema, line_schema, PIPE_FIELD_TYPES, PIPE_FIELD_ORDER
    )
    lines = parse_table(
        data, line_schema, outlet_schema, LINE_FIELD_TYPES, LINE_FIELD_ORDER
    )
    outlets = parse_table(
        data, outlet_schema, fitting_schema, OUTLET_FIELD_TYPES, OUTLET_FIELD_ORDER
    )
    fittings = parse_table(
        data, fitting_schema, len(data), FITTING_FIELD_TYPES, FITTING_FIELD_ORDER
    )

    cml_lines = [row for row in lines if row["fields"]["9"] == "CML"]
    cml01_candidates = [
        row
        for row in pipes
        if row["fields"]["13"] == ".01"
        and abs(float(row["fields"]["8"]) - (35.5 / 12.0)) < 1e-9
    ]
    cml01_unique_ids = {int(row["fields"]["4"]) for row in cml01_candidates}
    cml01_outlets = [
        row for row in outlets if int(row["fields"]["5"]) in cml01_unique_ids
    ]
    cml01_outlet_unique_ids = {int(row["fields"]["4"]) for row in cml01_outlets}
    cml01_fittings = [
        row
        for row in fittings
        if int(row["fields"]["5"]) in cml01_unique_ids | cml01_outlet_unique_ids
    ]
    pipe_unique_ids = {int(row["fields"]["4"]) for row in pipes}
    outlet_unique_ids = {int(row["fields"]["4"]) for row in outlets}
    fitting_parent_joins = [
        {
            **label_row(row, FITTING_FIELD_NAMES),
            "parentKind": (
                "pipe"
                if int(row["fields"]["5"]) in pipe_unique_ids
                else "outlet"
                if int(row["fields"]["5"]) in outlet_unique_ids
                else "unresolved"
            ),
        }
        for row in fittings
    ]
    result = {
        "artifactType": "halofire.autosprink-native-fab-topology-diagnostic.v1",
        "source": {
            "archive": str(archive),
            "archiveSha256": hashlib.sha256(archive_bytes).hexdigest().upper(),
            "member": "Project.seidb",
            "memberBytes": len(data),
            "memberSha256": hashlib.sha256(data).hexdigest().upper(),
        },
        "counts": {
            "pipes": len(pipes),
            "lines": len(lines),
            "outlets": len(outlets),
            "fittings": len(fittings),
        },
        "topologyMetrics": {
            "pipeParentFittingCount": sum(
                row["parentKind"] == "pipe" for row in fitting_parent_joins
            ),
            "outletParentFittingCount": sum(
                row["parentKind"] == "outlet" for row in fitting_parent_joins
            ),
            "unresolvedParentFittingCount": sum(
                row["parentKind"] == "unresolved" for row in fitting_parent_joins
            ),
        },
        "cmlLines": [label_row(row, LINE_FIELD_NAMES) for row in cml_lines],
        "cml01Candidates": [
            label_row(row, PIPE_FIELD_NAMES) for row in cml01_candidates
        ],
        "cml01Outlets": [label_row(row, OUTLET_FIELD_NAMES) for row in cml01_outlets],
        "cml01Fittings": [
            label_row(row, FITTING_FIELD_NAMES) for row in cml01_fittings
        ],
    }
    if include_records:
        result["records"] = {
            "pipes": [label_row(row, PIPE_FIELD_NAMES) for row in pipes],
            "lines": [label_row(row, LINE_FIELD_NAMES) for row in lines],
            "outlets": [label_row(row, OUTLET_FIELD_NAMES) for row in outlets],
            "fittings": fitting_parent_joins,
        }
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("archive", type=Path)
    parser.add_argument("--all-records", action="store_true")
    args = parser.parse_args()
    print(
        json.dumps(
            extract(args.archive, include_records=args.all_records),
            indent=2,
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()

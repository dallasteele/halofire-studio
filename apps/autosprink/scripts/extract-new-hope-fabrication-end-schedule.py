"""Extract the New Hope listed pipe-end schedule from the approved AutoSPRINK PDF.

This intentionally extracts only evidence that the PDF text layer represents
losslessly: piece identity, page, end preparation, and fitting family. Embedded
fraction glyphs in the Crystal Reports font are not promoted to exact fitting
sizes by this script.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import Counter
from pathlib import Path

from pypdf import PdfReader


PROJECT_ID = "new-hope-crisis-center-brigham-city-ut"
EXPECTED_SHA256 = "2E01CB3C2C39289846DF0A17A758E6D1DE4F5A682ED139556BD864BF6F8BD734"


def fitting_family(text: str) -> str:
    if "No Fitting" in text:
        return "no-fitting"
    if "Reducing Tee" in text:
        return "threaded-reducing-tee"
    if "Straight Tee" in text:
        return "threaded-straight-tee"
    if "90" in text and "Reducing Elbow" in text:
        return "threaded-90-reducing-elbow"
    if "90" in text and "Elbow" in text:
        return "threaded-90-elbow"
    if "45" in text and "Elbow" in text:
        return "threaded-45-elbow"
    if "Reducer" in text:
        return "threaded-reducer"
    return "unclassified"


def parse(source: Path) -> dict:
    source_bytes = source.read_bytes()
    source_sha256 = hashlib.sha256(source_bytes).hexdigest().upper()
    if source_sha256 != EXPECTED_SHA256:
        raise ValueError(f"unexpected source SHA-256: {source_sha256}")

    reader = PdfReader(source)
    if len(reader.pages) != 42:
        raise ValueError(f"expected 42 pages, got {len(reader.pages)}")
    texts = [page.extract_text() or "" for page in reader.pages]

    welded_pieces = []
    current_line = None
    current_quantity = 1
    for page_number in range(7, 40):
        text = texts[page_number - 1]
        for raw_line in text.splitlines():
            line_header = re.match(r"^\s*([A-Z0-9]+)\s+Quantity:\s+(\d+)\s*$", raw_line)
            if line_header:
                current_line = line_header.group(1)
                current_quantity = int(line_header.group(2))
                continue
            typical = re.match(
                r"^\s*Typical Piece:\s+([A-Z0-9-]+)\s+Quantity:\s+(\d+)\s+\(([^\n]+)\)",
                raw_line,
            )
            match = re.match(r"^Piece:\s+([A-Z0-9]+\.{1,2}\d+)\s*\(([^\n]+)\)", raw_line)
            if not typical and not match:
                continue
            piece_id = typical.group(1) if typical else match.group(1).replace("..", ".")
            header = typical.group(3) if typical else match.group(2)
            quantity = int(typical.group(2)) if typical else current_quantity
            if "G-G" not in header:
                raise ValueError(f"welded piece lacks G-G end preparation: {piece_id}")
            welded_pieces.append(
                {
                    "pieceId": piece_id,
                    "lineName": "TYPICAL" if typical else current_line,
                    "quantity": quantity,
                    "typical": bool(typical),
                    "physicalPage": page_number,
                    "endPreparation": ["G", "G"],
                    "endFittingFamilies": ["no-fitting", "no-fitting"],
                }
            )

    welded_text = "\n".join(texts[6:39])
    if welded_text.count("No Fitting") != len(welded_pieces) * 2:
        raise ValueError("welded No Fitting coverage is not exactly two per piece definition")

    threaded_pieces = []
    current_line = None
    for page_number in range(40, 43):
        for raw_line in texts[page_number - 1].splitlines():
            header = re.search(r"Line:\s+([A-Z0-9]+)-\s+Quantity:\s*(\d+)", raw_line)
            if header:
                current_line = header.group(1)
                current_quantity = int(header.group(2))
                continue
            row = re.match(r"^\.(\d+)\s+(.+)$", raw_line)
            if not row:
                continue
            if current_line is None:
                raise ValueError(f"threaded row has no line header on page {page_number}")
            body = row.group(2)
            end_prep = re.search(r"\s([TG])\s*-\s*([TG])\s", body)
            if not end_prep:
                raise ValueError(f"threaded row lacks end preparation: {current_line}.{row.group(1)}")
            family = fitting_family(body[end_prep.end() :])
            if family == "unclassified":
                raise ValueError(f"unclassified threaded fitting: {body}")
            threaded_pieces.append(
                {
                    "pieceId": f"{current_line}.{int(row.group(1)):02d}",
                    "lineName": current_line,
                    "quantity": current_quantity,
                    "physicalPage": page_number,
                    "endPreparation": [end_prep.group(1), end_prep.group(2)],
                    "endFittingFamily": family,
                    "exactFittingSizeReady": False,
                }
            )

    all_ids = [piece["pieceId"] for piece in welded_pieces + threaded_pieces]
    if len(all_ids) != len(set(all_ids)):
        duplicates = [piece_id for piece_id, count in Counter(all_ids).items() if count > 1]
        raise ValueError(f"duplicate piece identities: {duplicates}")

    def count_by(items: list[dict], key: str) -> dict:
        return dict(sorted(Counter(item[key] for item in items).items()))

    threaded_end_preps = Counter("-".join(piece["endPreparation"]) for piece in threaded_pieces)
    return {
        "artifactType": "halofire.new-hope-fabrication-end-schedule.v1",
        "projectId": PROJECT_ID,
        "source": {
            "role": "approved-autosprink-fabrication-listing",
            "fileName": source.name,
            "sha256": source_sha256,
            "pageCount": len(reader.pages),
            "software": "AutoSPRINK 2023 v18.1.44.0",
            "listArea": "NHCC List",
            "listingDate": "2025-02-20",
        },
        "coverage": {
            "weldedPhysicalPages": [7, 39],
            "threadedPhysicalPages": [40, 42],
            "weldedPieceDefinitionCount": len(welded_pieces),
            "weldedFabricatedUnitCount": sum(piece["quantity"] for piece in welded_pieces),
            "threadedPieceDefinitionCount": len(threaded_pieces),
            "threadedFabricatedUnitCount": sum(piece["quantity"] for piece in threaded_pieces),
            "totalListedPipePieceDefinitionCount": len(all_ids),
            "totalFabricatedPipeUnitCount": sum(
                piece["quantity"] for piece in welded_pieces + threaded_pieces
            ),
            "weldedPieceCountsByLine": count_by(welded_pieces, "lineName"),
            "threadedPieceCountsByLine": count_by(threaded_pieces, "lineName"),
            "threadedEndPreparationCounts": dict(sorted(threaded_end_preps.items())),
            "threadedFittingFamilyCounts": count_by(threaded_pieces, "endFittingFamily"),
        },
        "weldedPieces": welded_pieces,
        "threadedPieces": threaded_pieces,
        "claims": {
            "allListedPieceIdentitiesReady": True,
            "allListedPieceEndPreparationsReady": True,
            "allWeldedEndFittingFamiliesReady": True,
            "allThreadedEndFittingFamiliesReady": True,
            "exactThreadedFittingSizesReady": False,
            "interPieceFittingTopologyReady": False,
            "verticalOffsetScheduleReady": False,
            "completeFittingScheduleReady": False,
            "fabricationReady": False,
            "fieldReleaseReady": False,
        },
        "extractionBoundary": {
            "embeddedFractionGlyphsLossless": False,
            "note": "The PDF text layer does not losslessly expose embedded fraction glyphs; exact threaded fitting sizes and installed geometry remain fail-closed.",
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    result = parse(args.source)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result["coverage"], indent=2))


if __name__ == "__main__":
    main()

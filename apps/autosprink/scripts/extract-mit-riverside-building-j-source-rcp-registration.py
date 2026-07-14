from __future__ import annotations

import argparse
import json
from pathlib import Path

import fitz


DEFAULT_SOURCE = Path(r"Y:\Shared\HaloOps\02-Active jobs\03-Closed\Adolfson & Peterson\MIT Riverside - Phoenix AZ\Bid Files\18_434 Riverside Bid Set 050820-1.pdf")
X_LABELS = ["J.A", "J.B", "J.C", "J.D", "J.E", "J.F", "J.G", "J.H"]
X_STRUCTURAL_FT = [0, 15.666667, 17.333333, 30.666667, 39.666667, 45.666667, 61.333333, 76.333333]
Y_LABELS = ["J.5", "J.4", "J.3", "J.2", "J.1"]
Y_STRUCTURAL_FT = [0, 32.166667, 64.833333, 89.166667, 100.166667]


def center(word: tuple) -> tuple[float, float]:
    return ((word[0] + word[2]) / 2, (word[1] + word[3]) / 2)


def interpolate(value: float, source: list[float], target: list[float]) -> float:
    if value <= source[0]:
        return target[0]
    if value >= source[-1]:
        return target[-1]
    for index in range(len(source) - 1):
        if source[index] <= value <= source[index + 1]:
            ratio = (value - source[index]) / (source[index + 1] - source[index])
            return target[index] + ratio * (target[index + 1] - target[index])
    raise RuntimeError(f"cannot interpolate {value}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-pdf", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--heads", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    heads_packet = json.loads(args.heads.read_text(encoding="utf-8"))
    with fitz.open(args.source_pdf) as document:
        if document.page_count != 150:
            raise RuntimeError(f"unexpected architectural bid-set page count: {document.page_count}")
        page = document[104]
        words = page.get_text("words", clip=fitz.Rect(220, 660, 1270, 2040), sort=True)
    top_x_words = {}
    bottom_x_words = {}
    y_words = {}
    ots_words = []
    for word in words:
        text = word[4]
        point = center(word)
        if text in X_LABELS and 810 <= point[1] <= 840:
            top_x_words[text] = word
        if text in X_LABELS and 1895 <= point[1] <= 1930:
            bottom_x_words[text] = word
        if text in Y_LABELS and 260 <= point[0] <= 310:
            y_words[text] = word
        if text == "O.T.S.":
            ots_words.append(word)
    if list(top_x_words) != X_LABELS or list(y_words) != Y_LABELS:
        raise RuntimeError(f"Building J RCP grid labels incomplete: x={list(top_x_words)}, y={list(y_words)}")
    x_points = [round(center(top_x_words[label])[0], 6) for label in X_LABELS]
    y_points = [round(center(y_words[label])[1], 6) for label in Y_LABELS]
    repeated_labels = sorted(set(top_x_words).intersection(bottom_x_words))
    repeat_residual = max(abs(center(top_x_words[label])[0] - center(bottom_x_words[label])[0]) for label in repeated_labels)
    mapped_heads = []
    for head in heads_packet["heads"]:
        local_x = head["localFt"]["x"]
        local_y = head["localFt"]["y"]
        mapped_heads.append({
            "id": head["id"],
            "kind": head["kind"],
            "structuralLocalFt": {"x": local_x, "y": local_y},
            "sourceRcpPdfPointPt": {
                "x": round(interpolate(local_x, X_STRUCTURAL_FT, x_points), 6),
                "y": round(interpolate(local_y, Y_STRUCTURAL_FT, y_points), 6),
            },
            "sourceProtectionRegime": None,
            "sourceProtectionPlaneId": None,
            "ceilingHeightFt": None,
            "zFt": None,
        })
    output = {
        "artifactType": "halofire.mit-riverside-building-j-source-rcp-registration-evidence.v1",
        "projectId": "mit-riverside-building-j",
        "projectName": "MIT Riverside - Transportation Building J",
        "headCoordinateCommit": "6ae5c486",
        "sourceSealReceiptSha256": "789c49ed7a91999d675a3cc6f20ca0bccc76ff22b9a72900020386af323192d8",
        "headCoordinateEvidenceReceiptSha256": heads_packet["receiptSha256"],
        "sourceDocument": {
            "role": "architectural-bid-set",
            "path": "Bid Files/18_434 Riverside Bid Set 050820-1.pdf",
            "bytes": 116713715,
            "sha256": "08515f43642de408ed1f9fc5ebd35115083b023d62412d5d9bc4301cf146c93c",
            "pageCount": 150,
            "rcpPhysicalPage": 105,
        },
        "registration": {
            "method": "source RCP grid-label word bounds piecewise-mapped to sealed structural grid labels",
            "sourceRcpClipPt": [220, 660, 1270, 2040],
            "x": {"labels": X_LABELS, "structuralFeet": X_STRUCTURAL_FT, "sourceRcpPdfPoints": x_points},
            "y": {"labels": Y_LABELS, "structuralFeet": Y_STRUCTURAL_FT, "sourceRcpPdfPoints": y_points},
            "repeatedTopBottomXLabels": repeated_labels,
            "maximumRepeatedLabelResidualPt": round(repeat_residual, 9),
            "globalLinearScaleClaimed": False,
            "piecewiseGridLabelMappingRequired": True,
            "architecturalStructuralWidthDiscrepancyInches": 4,
        },
        "sourceRcpObservations": {
            "openToStructureLabel": "O.T.S.",
            "openToStructureLabelCount": len(ots_words),
            "openToStructureLabelCentersPt": [{"x": round(center(word)[0], 6), "y": round(center(word)[1], 6)} for word in ots_words],
            "fixtureAndCeilingLayoutPresent": True,
            "ceilingHeightIndicatorsPresent": True,
            "individualProtectionRegimesAssigned": False,
        },
        "heads": mapped_heads,
        "claims": {
            "sourceRcpGridRegistrationReady": True,
            "headSourceRcpXyRegistrationReady": True,
            "sourceProtectionRegimeReady": False,
            "sourceProtectionPlaneReady": False,
            "headElevationsReady": False,
            "wholeRoofHeadPlaneAssignmentReady": False,
            "sourceGeneratedPitchedPlacementVerified": False,
            "complianceReady": False,
            "fabricationReady": False,
            "fieldReleaseReady": False,
        },
    }
    if len(mapped_heads) != 68 or len(ots_words) != 11 or repeat_residual != 0:
        raise RuntimeError(f"Building J RCP registration facts changed: heads={len(mapped_heads)}, OTS={len(ots_words)}, residual={repeat_residual}")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(args.output), "heads": len(mapped_heads), "xLabels": len(x_points), "yLabels": len(y_points), "otsLabels": len(ots_words), "repeatResidualPt": repeat_residual}, indent=2))


if __name__ == "__main__":
    main()

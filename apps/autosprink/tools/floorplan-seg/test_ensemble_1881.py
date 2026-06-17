#!/usr/bin/env python3
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[4]
SCRIPT = ROOT / "apps/autosprink/tools/floorplan-seg/segment_ensemble.py"
RASTER = Path("/opt/hal9000/state/sam-1881-p8-008.png")
OUT = Path("/opt/hal9000/state/seg-1881")


def mask_coverage(path: Path) -> float:
    arr = np.asarray(Image.open(path).convert("L"))
    return float(np.count_nonzero(arr)) / float(arr.size)


def main() -> int:
    cmd = [sys.executable, str(SCRIPT), "--raster", str(RASTER), "--out", str(OUT)]
    subprocess.run(cmd, check=True)

    worked = []
    for wall_png in sorted(OUT.glob("*_walls.png")):
        cov = mask_coverage(wall_png)
        print(f"{wall_png.name}: coverage={cov:.6f}")
        if 0.02 <= cov <= 0.55 and wall_png.name != "ensemble_walls.png":
            worked.append((wall_png.stem.replace("_walls", ""), cov))

    assert len(worked) >= 2, f"expected >=2 plausible model masks, got {worked}"
    assert (OUT / "ensemble_overlay.png").exists(), "ensemble_overlay.png missing"
    print("worked_models:", ", ".join(f"{name}={cov:.6f}" for name, cov in worked))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

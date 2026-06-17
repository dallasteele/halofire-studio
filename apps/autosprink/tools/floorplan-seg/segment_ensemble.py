#!/usr/bin/env python3
import argparse
import json
import os
import subprocess
import sys
from contextlib import contextmanager
from pathlib import Path

import cv2
import gdown
import numpy as np
import torch
from PIL import Image
from transformers import Mask2FormerForUniversalSegmentation, Mask2FormerImageProcessor


CACHE_ROOT = Path("/opt/hal9000/state/floorplan-seg-cache")
CUBICASA_REPO = CACHE_ROOT / "CubiCasa5k"
CUBICASA_WEIGHTS = CACHE_ROOT / "cubicasa" / "model_best_val_loss_var.pkl"
HF_CACHE = CACHE_ROOT / "hf"
HF_MODEL_ID = "Hyunwoo1605/mask2former-floorplan-instance-segmentation"


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def ensure_git_clone(repo_url: str, dst: Path) -> None:
    if dst.exists():
        return
    ensure_dir(dst.parent)
    subprocess.run(
        ["git", "clone", "--depth", "1", repo_url, str(dst)],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def ensure_gdrive_file(file_id: str, dst: Path) -> None:
    if dst.exists():
        return
    ensure_dir(dst.parent)
    url = f"https://drive.google.com/uc?id={file_id}"
    gdown.download(url, str(dst), quiet=False)


@contextmanager
def pushd(path: Path):
    prev = Path.cwd()
    os.chdir(path)
    try:
        yield
    finally:
        os.chdir(prev)


def load_image(path: Path) -> Image.Image:
    return Image.open(path).convert("RGB")


def resize_long_edge(image: Image.Image, max_long_edge: int) -> Image.Image:
    w, h = image.size
    scale = min(max_long_edge / float(max(w, h)), 1.0)
    if scale == 1.0:
        return image
    size = (max(1, int(round(w * scale))), max(1, int(round(h * scale))))
    return image.resize(size, Image.Resampling.BILINEAR)


def image_to_dark_mask(image: Image.Image, threshold: int = 200) -> np.ndarray:
    gray = cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2GRAY)
    dark = (gray < threshold).astype(np.uint8) * 255
    dark = cv2.morphologyEx(dark, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    return dark


def save_mask(path: Path, mask: np.ndarray) -> None:
    Image.fromarray(mask.astype(np.uint8), mode="L").save(path)


def save_overlay(path: Path, image: Image.Image, mask: np.ndarray, color=(0, 220, 90)) -> None:
    base = np.asarray(image).astype(np.float32)
    overlay = base.copy()
    active = mask > 0
    tint = np.zeros_like(base)
    tint[..., 0] = color[0]
    tint[..., 1] = color[1]
    tint[..., 2] = color[2]
    overlay[active] = 0.58 * overlay[active] + 0.42 * tint[active]
    Image.fromarray(np.clip(overlay, 0, 255).astype(np.uint8), mode="RGB").save(path)


def coverage(mask: np.ndarray) -> float:
    return float(np.count_nonzero(mask)) / float(mask.size)


def run_cubicasa(image: Image.Image, device: torch.device) -> np.ndarray:
    ensure_git_clone("https://github.com/CubiCasa/CubiCasa5k.git", CUBICASA_REPO)
    ensure_gdrive_file("1gRB7ez1e4H7a9Y09lLqRuna0luZO5VRK", CUBICASA_WEIGHTS)

    sys.path.insert(0, str(CUBICASA_REPO))
    from floortrans.models import get_model  # type: ignore

    work = resize_long_edge(image, 1024)
    arr = np.asarray(work).astype(np.float32)
    arr = np.moveaxis(arr, -1, 0)
    arr = 2.0 * (arr / 255.0) - 1.0
    x = torch.from_numpy(arr).unsqueeze(0).to(device)

    checkpoint = torch.load(CUBICASA_WEIGHTS, map_location=device)
    with pushd(CUBICASA_REPO):
        model = get_model("hg_furukawa_original", 51)
    model.conv4_ = torch.nn.Conv2d(256, 44, bias=True, kernel_size=1)
    model.upsample = torch.nn.ConvTranspose2d(44, 44, kernel_size=4, stride=4)
    model.load_state_dict(checkpoint["model_state"])
    model.to(device).eval()

    with torch.no_grad():
        pred = model(x)[0]
    rooms = torch.softmax(pred[21:33], dim=0).argmax(0).cpu().numpy().astype(np.uint8)
    wall = (rooms == 2).astype(np.uint8) * 255
    wall = cv2.resize(
        wall,
        image.size,
        interpolation=cv2.INTER_NEAREST,
    )
    wall = cv2.morphologyEx(wall, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    return wall


def run_hf_mask2former(image: Image.Image, device: torch.device) -> np.ndarray:
    os.environ.setdefault("HF_HOME", str(HF_CACHE))
    ensure_dir(HF_CACHE)

    processor = Mask2FormerImageProcessor(
        ignore_index=255,
        do_resize=True,
        size={"shortest_edge": 512, "longest_edge": 512},
        do_rescale=True,
        do_normalize=True,
    )
    model = Mask2FormerForUniversalSegmentation.from_pretrained(
        HF_MODEL_ID,
        cache_dir=str(HF_CACHE),
    )
    model.to(device).eval()

    inputs = processor(images=image, return_tensors="pt")
    inputs = {k: v.to(device) for k, v in inputs.items()}
    with torch.no_grad():
        outputs = model(**inputs)
    seg = processor.post_process_semantic_segmentation(
        outputs,
        target_sizes=[image.size[::-1]],
    )[0].cpu().numpy()

    raw = (seg == 3).astype(np.uint8) * 255
    dark = image_to_dark_mask(image, threshold=200)
    wall = cv2.bitwise_and(raw, dark)
    wall = cv2.morphologyEx(wall, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    return wall


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raster", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    raster_path = Path(args.raster)
    out_dir = Path(args.out)
    ensure_dir(out_dir)

    image = load_image(raster_path)
    device = torch.device("cpu")

    model_fns = {
        "cubicasa_official": run_cubicasa,
        "hf_mask2former_lineart": run_hf_mask2former,
    }

    masks = {}
    report = {"raster": str(raster_path), "device": str(device), "models": {}}
    for name, fn in model_fns.items():
        mask = fn(image, device)
        masks[name] = mask
        cov = coverage(mask)
        save_mask(out_dir / f"{name}_walls.png", mask)
        save_overlay(out_dir / f"{name}_overlay.png", image, mask)
        report["models"][name] = {"coverage": cov}
        print(f"{name}: wall_coverage={cov:.6f}", flush=True)

    stack = np.stack([(mask > 0).astype(np.uint8) for mask in masks.values()], axis=0)
    ensemble_mask = (stack.max(axis=0) > 0).astype(np.uint8) * 255
    save_mask(out_dir / "ensemble_walls.png", ensemble_mask)
    save_overlay(out_dir / "ensemble_overlay.png", image, ensemble_mask, color=(255, 140, 0))
    report["ensemble"] = {"coverage": coverage(ensemble_mask)}
    print(f"ensemble_union: wall_coverage={report['ensemble']['coverage']:.6f}", flush=True)

    with open(out_dir / "summary.json", "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2, sort_keys=True)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""CubiCasa5K wall-pixel judge for the wall-ensemble pipeline.

Reuses the proven loader (smp Unet resnet34, 4-class, class1=wall) from /tmp/recore/cubicasa_run.py.
Returns the fraction of wall-class pixels in a native-res crop. On a TIGHT crop centered on a real
wall the wall class lights up a continuous band; on parking-stall / dim / grid crops it stays low or
fragments (the scratch run confirmed class1=wall traces room walls + door swings; native-res tiles
lift wall-pixel detection vs the whole-sheet downscale that made it sub-pixel).
"""
import numpy as np
import torch
import segmentation_models_pytorch as smp
from safetensors.torch import load_file
from PIL import Image

WALL_CLASS = 1
_MEAN = np.array([0.485, 0.456, 0.406])
_STD = np.array([0.229, 0.224, 0.225])


class CubiCasaJudge:
    def __init__(self, model_dir="/tmp/recore/cubicasa"):
        self.dev = "cuda" if torch.cuda.is_available() else "cpu"
        self.model = smp.Unet(encoder_name="resnet34", encoder_weights=None, in_channels=3, classes=4)
        sd = load_file(f"{model_dir}/best.safetensors")
        self.model.load_state_dict(sd, strict=False)
        self.model.eval().to(self.dev)

    def _letterbox(self, im, size=512):
        im = im.convert("RGB")
        w, h = im.size
        s = size / max(w, h)
        nw, nh = max(1, int(w * s)), max(1, int(h * s))
        cv = Image.new("RGB", (size, size), (255, 255, 255))
        cv.paste(im.resize((nw, nh)), ((size - nw) // 2, (size - nh) // 2))
        # return canvas + the inner content box so wall_fraction is measured over real ink only
        return cv, (size - nw) // 2, (size - nh) // 2, nw, nh

    def wall_fraction(self, crop):
        cv, ox, oy, nw, nh = self._letterbox(crop)
        x = (np.asarray(cv).astype(np.float32) / 255.0 - _MEAN) / _STD
        t = torch.from_numpy(x.transpose(2, 0, 1)[None]).float().to(self.dev)
        with torch.no_grad():
            pred = self.model(t)[0].argmax(0).cpu().numpy()
        inner = pred[oy:oy + nh, ox:ox + nw]
        if inner.size == 0:
            return 0.0
        return float((inner == WALL_CLASS).sum()) / float(inner.size)

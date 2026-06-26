"""Compact bbox-free instance segmenter: U-Net (foreground + distance) +
watershed. Inference-only port for the microcapsule model.

The student is a U-Net (MobileNetV3-Small encoder, via segmentation-models-
pytorch) distilled offline from Meta SAM 3. It predicts two channels:

  ch0 = foreground logit (solid capsule region)
  ch1 = distance logit -> sigmoid -> per-instance normalized distance (peak=center)

Post-processing: threshold foreground; take ONLY prominent distance peaks via
h-maxima (shallow ring bumps from shell texture are rejected -> no
over-segmentation); watershed the distance within the foreground to split
touching capsules. A solid foreground + prominence-gated seeds avoids both the
bounding-box edge artifacts of detection models and the over-segmentation of
thick translucent shells.

Training code (target generation, loss) lives in the standalone
``microcapsule-segmentation`` package and is intentionally not vendored here —
the service only ever runs inference.
"""
import numpy as np
from scipy import ndimage as ndi

SIZE = 896


def build_model(encoder="timm-mobilenetv3_small_100"):
    import segmentation_models_pytorch as smp

    return smp.Unet(encoder_name=encoder, encoder_weights=None,
                    in_channels=3, classes=2, activation=None)


def predict_instances(fg_prob, dist_pred, fg_thresh=0.5, h=0.3, min_size=60):
    """fg_prob, dist_pred HxW (0..1) -> uint16 instance label image."""
    from skimage.morphology import h_maxima
    from skimage.segmentation import watershed

    fg = fg_prob > fg_thresh
    if fg.sum() < min_size:
        return np.zeros(fg.shape, np.uint16)
    d = dist_pred * fg
    seeds = h_maxima(d, h)                       # prominent maxima only
    markers, n = ndi.label(seeds)
    if n == 0:                                   # fallback: global max per fg component
        comp, nc = ndi.label(fg)
        markers = np.zeros(fg.shape, np.int32)
        for c in range(1, nc + 1):
            cm = comp == c
            idx = np.argmax(d * cm)
            markers[np.unravel_index(idx, d.shape)] = c
    labels = watershed(-d, markers, mask=fg)
    # drop tiny fragments
    out = np.zeros_like(labels, np.uint16)
    k = 0
    for i in range(1, labels.max() + 1):
        m = labels == i
        if m.sum() >= min_size:
            k += 1
            out[m] = k
    return out

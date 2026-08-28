"""Oracle (ground-truth-derived) masks and orientation channels.

These stand in for a perfect semantic model, so the instancer can be developed and tuned
without the segmenter's errors in the loop. The orientation channels reproduce the amodal
K=6 "overpass" representation of ``dino_seg_ori_v4b.pth``: each microtubule is painted into
the channel of its LOCAL tangent bin, so a crossing writes into two different channels and
the two filaments stay separable at the shared pixel.
"""
from __future__ import annotations

import numpy as np
from scipy.ndimage import binary_dilation

from instance.geometry import resample, segment_angles

# Sub-pixel step used when stamping polylines, so the rasterised centerline has no gaps
# even on diagonal runs.
_STAMP_DS = 0.4


def _footprint(half_width: float) -> np.ndarray:
    r = int(np.ceil(half_width))
    if r < 1:
        return np.ones((1, 1), dtype=bool)
    yy, xx = np.mgrid[-r:r + 1, -r:r + 1]
    return (yy ** 2 + xx ** 2) <= half_width ** 2 + 1e-9


def _upscaled_shape(shape: tuple[int, int], up: float) -> tuple[int, int]:
    return int(round(shape[0] * up)), int(round(shape[1] * up))


def _stamp_centerline(points: np.ndarray, out: np.ndarray, up: float) -> np.ndarray:
    """Rasterise one polyline's centerline pixels into ``out`` (modified in place)."""
    h, w = out.shape
    pts = resample(np.asarray(points, dtype=float) * up, ds=_STAMP_DS)
    if len(pts) == 0:
        return out
    cc = np.clip(np.rint(pts[:, 0]).astype(int), 0, w - 1)
    rr = np.clip(np.rint(pts[:, 1]).astype(int), 0, h - 1)
    out[rr, cc] = True
    return out


def oracle_instance_masks(polylines, shape: tuple[int, int], half_width: float = 1.0,
                          up: float = 1.5) -> list[np.ndarray]:
    """One mask per GT polyline, in the upscaled frame.

    Dilated on the polyline's BOUNDING BOX rather than on the whole frame. The
    naive form allocated a full upscaled frame per polyline and dilated all of
    it -- on a dense IRM frame (2118x2211, 102 instances) that was 4.0 s, versus
    0.034 s here, for a bit-identical result. Dilation is a local operation, so
    cropping is exact as long as the crop contains every pixel the full-frame
    dilation could set.

    The crop bound, and why it holds. ``_stamp_centerline`` resamples ALONG the
    polyline, so every stamped point lies within the polyline's own coordinate
    range; it then takes ``np.rint``, which moves a coordinate by at most 0.5,
    so stamped rows lie in ``[floor(min_y), ceil(max_y)]`` -- and its ``np.clip``
    can only pull a coordinate further INSIDE the frame, never outside that
    interval. Dilation then reaches at most ``r`` further, ``r`` being the
    structuring element's radius. One extra pixel of slack is added on each
    side; it is deliberate belt-and-braces, not load-bearing, and
    ``test_oracle_bbox.py`` pins the identity against the full-frame result
    including polylines that run off the frame edge.
    """
    hi_shape = _upscaled_shape(shape, up)
    height, width = hi_shape
    fp = _footprint(half_width)
    r = fp.shape[0] // 2
    out = []
    for p in polylines:
        m = np.zeros(hi_shape, dtype=bool)
        pts = np.asarray(p, dtype=float)
        if len(pts) == 0:
            out.append(m)
            continue
        ys = pts[:, 1] * up
        xs = pts[:, 0] * up
        y0 = max(0, int(np.floor(ys.min())) - r - 1)
        y1 = min(height, int(np.ceil(ys.max())) + r + 2)
        x0 = max(0, int(np.floor(xs.min())) - r - 1)
        x1 = min(width, int(np.ceil(xs.max())) + r + 2)
        if y1 <= y0 or x1 <= x0:
            # The whole polyline is off-frame; the full-frame version would
            # clip every point onto the border, so reproduce that rather than
            # returning an empty mask.
            _stamp_centerline(p, m, up)
            out.append(binary_dilation(m, structure=fp))
            continue
        sub = np.zeros((y1 - y0, x1 - x0), dtype=bool)
        # Shift into crop coordinates. The shift is applied BEFORE the `* up`
        # inside _stamp_centerline, hence the division.
        _stamp_centerline(pts - np.array([x0 / up, y0 / up]), sub, up)
        m[y0:y1, x0:x1] = binary_dilation(sub, structure=fp)
        out.append(m)
    return out



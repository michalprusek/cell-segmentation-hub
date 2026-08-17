"""Pictures of the selection: the ROI mask NIS can import, and an audit overlay.

Only this module knows how to draw. The overlay exists because a dot on a
centreline looks correct even when the bleach footprint underneath it overlaps a
neighbour — isolation is the criterion the experiment depends on, and the cheap way
to audit it is to see the footprint, not the centre.
"""
from __future__ import annotations

import io
from typing import List, Sequence

import numpy as np
from PIL import Image, ImageDraw, ImageFont


def _roi_polygon(spot, params, um_per_px: float, dilate_um: float = 0.0):
    """The ROI outline as image-space vertices, optionally dilated."""
    a = 0.5 * params.spot_len_um / um_per_px + dilate_um / um_per_px
    b = 0.5 * params.spot_wid_um / um_per_px + dilate_um / um_per_px
    th = np.radians(spot.tangent_deg)
    c, s = np.cos(th), np.sin(th)
    if params.spot_shape == "rect":
        local = np.array([[-a, -b], [a, -b], [a, b], [-a, b]])
    else:
        t = np.linspace(0.0, 2.0 * np.pi, 48, endpoint=False)
        local = np.stack([a * np.cos(t), b * np.sin(t)], axis=1)
    rot = np.stack([local[:, 0] * c - local[:, 1] * s,
                    local[:, 0] * s + local[:, 1] * c], axis=1)
    return [(float(spot.x + p[0]), float(spot.y + p[1])) for p in rot]


def render_mask_png(spots: Sequence, shape_hw, params, um_per_px: float) -> bytes:
    """8-bit mask, one filled ROI per spot, for NIS `LoadROI` / binary-to-ROI.

    The ROIs are drawn at their NOMINAL size, not dilated: the dilation is a
    selection safety margin, not a region anyone wants bleached.
    """
    h, w = int(shape_hw[0]), int(shape_hw[1])
    img = Image.new("L", (w, h), 0)
    draw = ImageDraw.Draw(img)
    for spot in spots:
        draw.polygon(_roi_polygon(spot, params, um_per_px), fill=255)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _to_uint8(frame: np.ndarray) -> np.ndarray:
    a = np.asarray(frame, dtype=np.float32)
    lo, hi = np.percentile(a, (1, 99))
    return (np.clip((a - lo) / (hi - lo + 1e-6), 0, 1) * 255).astype(np.uint8)


def render_overlay_png(frame: np.ndarray, polylines: List[np.ndarray],
                       spots: Sequence, params, um_per_px: float,
                       rejected: Sequence = ()) -> bytes:
    """Diagnostic view: every filament, each spot's dilated footprint and window,
    and — per Spec §8 — a subordinate marker for every filament that produced no
    spot, labelled with why. The eye must go to the chosen footprints first, so the
    rejected markers are drawn small, muted, and last.
    """
    base = Image.fromarray(_to_uint8(frame)).convert("RGB")
    draw = ImageDraw.Draw(base)
    for pl in polylines:
        if pl.shape[0] >= 2:
            draw.line([(float(x), float(y)) for x, y in pl], fill=(90, 110, 140), width=1)
    obs_half = 0.5 * params.obs_len_um / um_per_px
    for spot in spots:
        th = np.radians(spot.tangent_deg)
        dx, dy = np.cos(th) * obs_half, np.sin(th) * obs_half
        draw.line([(spot.x - dx, spot.y - dy), (spot.x + dx, spot.y + dy)],
                  fill=(255, 200, 60), width=1)
        draw.polygon(_roi_polygon(spot, params, um_per_px, params.bleach_spread_um),
                     outline=(255, 80, 80))
        draw.polygon(_roi_polygon(spot, params, um_per_px), outline=(255, 255, 255))

    if rejected:
        font = ImageFont.load_default()
        for rf in rejected:
            x, y = float(rf.x), float(rf.y)
            r_px = 3
            # A small muted X, not a filled dot: it must read as "nothing here",
            # subordinate to the bright chosen footprints above.
            draw.line([(x - r_px, y - r_px), (x + r_px, y + r_px)],
                      fill=(140, 140, 140), width=1)
            draw.line([(x - r_px, y + r_px), (x + r_px, y - r_px)],
                      fill=(140, 140, 140), width=1)
            draw.text((x + r_px + 2, y - r_px), rf.reason,
                     fill=(140, 140, 140), font=font)

    buf = io.BytesIO()
    base.save(buf, format="PNG")
    return buf.getvalue()

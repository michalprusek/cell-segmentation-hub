"""Classical neurite / soma segmentation on one image merged from N channels.

No network, no weights, no GPU: a ridge filter for the neurites and a shape
test for the somas. It exists for fluorescence images in which the cell is
only visible when several channels are taken together (each protein lights up
some cells and not others), which the learned ``neurite_soma`` model cannot
take -- it was trained on exactly one tubulin channel and refuses a genuinely
multi-channel frame.

This file sits BESIDE the ``models`` package's heavy members on purpose, like
``mt_measure.py``: it needs numpy / scipy / scikit-image / OpenCV only, so the
CPU test suite can load it by path without importing torch.

THE PIPELINE
------------
1. Every channel is brought to NOISE UNITS on its own: ``(x - median) / MAD``.
   That removes the camera offset and the gain, which differ per channel and
   per acquisition (measured on production frames: offset ~100 counts under a
   signal of ~20). Normalising AFTER merging would let the brighter channel
   decide what the dimmer one contributes.
2. The channels are merged by pixel-wise MAXIMUM. Measured against the
   noise-preserving mean on four production frames, the two differed by a few
   fragments and nothing else; maximum is kept because a cell present in only
   one channel keeps its full contrast there, where a mean halves it.
3. Neurites: Meijering's neuriteness (Meijering et al., Cytometry A 2004, the
   NeuronJ filter), written out here rather than taken from
   ``skimage.filters.meijering`` for two reasons that both change the result.
   scikit-image divides every scale by its own maximum -- an extreme-value
   statistic, so one hot pixel sets the scale of the whole image and no
   threshold transfers between images -- and its default ``alpha`` is +1/3
   where the paper derives -1/3. The response is scale-normalised by sigma^2
   instead and thresholded with hysteresis at the HIGHER of a noise floor
   (``k`` robust sigmas of the response) and a fraction of the image's own
   strong ridges (``rel`` of its 99.5th percentile). The first governs a noisy
   frame, the second a clean one, and that is what lets one parameter set
   serve both.
4. A ridge component shorter than ``min_len`` (bounding-box diagonal) is not a
   neurite. Stains in the background respond to a ridge filter as well as a
   neurite does; what separates them is that they are short and attached to
   nothing, so this is a rule about topology, not about brightness. Raising
   the threshold instead removes the faint ends of real neurites first.
5. Somas: candidates are where the ridge mask is dense or where a bright
   structure survives a grey opening wider than a neurite; each candidate is
   then TRIMMED to its body (arms narrower than ``trim`` of its own inscribed
   radius are bundles that merged into it) and kept only if it is wide,
   compact, and has neurites leaving it.

``PARAMS`` was chosen by the project owner from overlays on four production
frames (2026-10-08): one clean, strongly labelled frame and three dim ones
with a signal of ~20 counts. It is ONE setting for all of them. Known limit,
measured on those same frames: on the dim ones a soma that is a faint diffuse
patch fused with a thick bundle is found only some of the time (2 of 3, 1 and
0 on the three dim frames). The somas are expected to be corrected in the
editor; the export measures the stored polygons.
"""

from __future__ import annotations

from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

import cv2
import numpy as np
from scipy import ndimage as ndi
from skimage.feature import hessian_matrix, hessian_matrix_eigvals
from skimage.filters import apply_hysteresis_threshold
from skimage.measure import label as sk_label
from skimage.measure import regionprops
from skimage.morphology import (
    binary_closing,
    binary_opening,
    disk,
    opening,
    remove_small_objects,
)

MODEL_ID = "neurite_soma_classical"

#: label value -> class name, in the order polygons are emitted. The same two
#: names the learned model uses, so the editor, the soma assignment and the
#: export treat both models' output alike.
CLASSES: Tuple[Tuple[int, str], ...] = ((1, "neurite"), (2, "soma"))

#: Refuse rather than run for minutes: the Hessian is computed at three scales
#: on a float32 copy, ~40 bytes of working memory per pixel at the peak.
MAX_PIXELS = 64_000_000

PARAMS: Mapping[str, Any] = {
    # neurites
    "sigmas": (1.5, 2.5, 4.0),  # px; ridge half-widths the filter is tuned to
    "k": 3.5,  # noise floor, in robust sigmas of the response
    "rel": 0.05,  # ... or this fraction of the response's 99.5th percentile
    "low": 0.45,  # hysteresis low threshold as a fraction of the high one
    "min_len": 100.0,  # px; a shorter isolated ridge component is debris
    "stub": 0.35,  # ... times min_len for what is left after somas are cut out
    # soma candidates
    "soma_sigma": 8.0,  # px; smoothing of the ridge mask into a density
    "dens_thr": 0.45,  # density above which ridges count as a meshwork
    "soma_r": 9,  # px; radius of the grey opening a neurite does not survive
    "blob_thr": 0.25,  # fraction of the opened image's range
    "soma_open": 8,  # px; binary opening that detaches thin bridges
    "max_hole": 600,  # px^2; holes up to this size inside a candidate are filled
    "min_soma": 900,  # px^2
    # soma acceptance
    "min_inscribed": 10.0,  # px; radius of the largest disc inside a candidate
    "trim": 0.55,  # arms narrower than this fraction of that radius are cut
    "max_elong": 3.0,  # major / minor axis of the trimmed body
    "min_contact": 110,  # px of neurite within `contact_ring` of the body
    "contact_ring": 6,  # px
    # polygonisation
    "min_area": 20.0,  # px^2, the learned model's measured value
    "min_hole_area": 30.0,  # px^2; smaller holes are closed, not emitted
    "max_points": 5000,  # a longer contour is simplified
    "simplify_px": 1.0,
}


def _robust_scale(x: np.ndarray) -> Tuple[float, float]:
    """(median, sigma) with sigma from the MAD -- neither is moved by the
    bright structures being looked for, which a mean and a std both are."""
    med = float(np.median(x))
    sigma = 1.4826 * float(np.median(np.abs(x - med)))
    return med, sigma


def to_noise_units(channel: np.ndarray) -> Optional[np.ndarray]:
    """One channel as float32 in units of its own background noise, or
    ``None`` for a channel with no variation at all.

    A channel whose MAD is zero (more than half of it one value: a saturated
    black background, common in an 8-bit export) falls back to its standard
    deviation. A perfectly FLAT one has no scale to divide by and nothing to
    show; it is reported as ``None`` rather than as zeros, because zeros are
    not neutral in a maximum -- they would clip the negative half of every
    other channel's noise and move the result.
    """
    x = np.asarray(channel, dtype=np.float32)
    if x.ndim != 2:
        raise ValueError(f"expected a 2-D channel, got shape {x.shape}")
    x = np.nan_to_num(x, nan=0.0, posinf=0.0, neginf=0.0)
    med, sigma = _robust_scale(x)
    if sigma <= 0.0:
        sigma = float(x.std())
    if sigma <= 0.0:
        return None
    return (x - np.float32(med)) / np.float32(sigma)


def merge_channels(channels: Sequence[np.ndarray]) -> np.ndarray:
    """N same-shaped channels -> one float32 image, pixel-wise maximum of each
    channel in its own noise units."""
    if not channels:
        raise ValueError("at least one channel is required")
    shape = np.asarray(channels[0]).shape
    for i, c in enumerate(channels):
        if np.asarray(c).shape != shape:
            raise ValueError(
                f"channel {i} is {np.asarray(c).shape}, channel 0 is {shape}: "
                "channels of one image must have the same size"
            )
    merged: Optional[np.ndarray] = None
    for c in channels:
        units = to_noise_units(c)
        if units is None:
            # A blank channel: the constant fill a microscope writes for a
            # plane it did not acquire. It contributes nothing.
            continue
        merged = units if merged is None else np.maximum(merged, units, out=merged)
    return np.zeros(shape, np.float32) if merged is None else merged


def neuriteness(image: np.ndarray, sigmas: Sequence[float]) -> np.ndarray:
    """Meijering neuriteness for BRIGHT ridges, maximum over scales.

    Per scale: the Hessian's eigenvalues e1 >= e2, modified to
    l_i = e_i + alpha * e_j with alpha = -1/3, the one of larger magnitude
    taken, and only a negative one (a bright ridge) kept. Multiplied by
    sigma^2 so scales are comparable; deliberately NOT divided by the scale's
    maximum (see the module docstring).
    """
    alpha = np.float32(-1.0 / 3.0)
    out = np.zeros(image.shape, dtype=np.float32)
    # A bright ridge has a strongly negative second derivative across it;
    # negating the image turns that into the positive value kept below.
    negated = -image.astype(np.float32, copy=False)
    for sigma in sigmas:
        e1, e2 = hessian_matrix_eigvals(
            hessian_matrix(
                negated, sigma, mode="reflect", use_gaussian_derivatives=True
            )
        )
        l1 = e1 + alpha * e2
        l2 = e2 + alpha * e1
        value = np.where(np.abs(l1) > np.abs(l2), l1, l2)
        np.maximum(out, np.float32(sigma * sigma) * np.maximum(value, 0), out=out)
    return out


def _fill_small_holes(mask: np.ndarray, max_hole: int) -> np.ndarray:
    holes = ndi.binary_fill_holes(mask) & ~mask
    lab, n = ndi.label(holes)
    if n == 0:
        return mask
    keep = np.bincount(lab.ravel()) <= max_hole
    keep[0] = False
    return mask | keep[lab]


def _drop_short(mask: np.ndarray, min_len: float) -> np.ndarray:
    """Keep 8-connected components whose bounding-box diagonal reaches
    ``min_len``."""
    lab, _ = ndi.label(mask, structure=np.ones((3, 3), bool))
    out = np.zeros_like(mask)
    for i, sl in enumerate(ndi.find_objects(lab), start=1):
        if sl is None:
            continue
        height = sl[0].stop - sl[0].start
        width = sl[1].stop - sl[1].start
        if np.hypot(height, width) >= min_len:
            out[sl] |= lab[sl] == i
    return out


def ridge_mask(merged: np.ndarray, p: Mapping[str, Any]) -> np.ndarray:
    """Thresholded neuriteness with the short isolated components removed."""
    response = neuriteness(merged, p["sigmas"])
    med, sigma = _robust_scale(response)
    high = max(med + p["k"] * sigma, p["rel"] * float(np.percentile(response, 99.5)))
    if high <= 0.0:
        return np.zeros(merged.shape, bool)
    ridges = apply_hysteresis_threshold(response, p["low"] * high, high)
    return _drop_short(ridges, p["min_len"])


def _soma_candidates(
    merged: np.ndarray, ridges: np.ndarray, p: Mapping[str, Any]
) -> np.ndarray:
    # (a) a meshwork: ridges so dense that their blurred mask stays high
    density = ndi.gaussian_filter(ridges.astype(np.float32), p["soma_sigma"])
    cand = density > p["dens_thr"]
    # (b) a wide bright structure: survives a grey opening no neurite does
    smooth = ndi.gaussian_filter(merged, 3.0)
    opened = opening(smooth, disk(p["soma_r"]))
    base = float(np.median(opened))
    top = float(np.percentile(opened, 99.9))
    floor = 3.0 * _robust_scale(smooth)[1]
    cand |= opened > base + max(p["blob_thr"] * (top - base), floor)

    cand = binary_opening(cand, disk(p["soma_open"]))
    cand = _fill_small_holes(binary_closing(cand, disk(3)), p["max_hole"])
    return remove_small_objects(cand, p["min_soma"])


def _accept_somas(
    cand: np.ndarray, ridges: np.ndarray, p: Mapping[str, Any]
) -> np.ndarray:
    """Trim every candidate to its body and keep the ones that look like a
    cell body: wide, compact, with neurites leaving it."""
    lab, _ = ndi.label(cand)
    out = np.zeros_like(cand)
    pad = 8
    ring = disk(p["contact_ring"])
    for region in regionprops(lab):
        r0, c0, r1, c1 = region.bbox
        sl = (slice(max(r0 - pad, 0), r1 + pad), slice(max(c0 - pad, 0), c1 + pad))
        body = lab[sl] == region.label
        inscribed = float(ndi.distance_transform_edt(body).max())
        if inscribed < p["min_inscribed"]:
            continue
        # The opening radius comes from the candidate's OWN width, so a large
        # soma sheds a thick bundle and a small one is not opened away whole.
        core = binary_opening(body, disk(max(int(round(p["trim"] * inscribed)), 1)))
        pieces = sk_label(core)
        if pieces.max() == 0:
            continue
        body = pieces == (np.bincount(pieces.ravel())[1:].argmax() + 1)
        shape = regionprops(body.astype(np.uint8))[0]
        if shape.area < 0.6 * p["min_soma"]:
            continue
        # Measured AFTER trimming: with its arms still attached a real soma
        # reads as elongated and was rejected.
        if shape.axis_major_length > p["max_elong"] * max(shape.axis_minor_length, 1e-6):
            continue
        contact = ndi.binary_dilation(body, ring) & ridges[sl] & ~body
        if int(contact.sum()) < p["min_contact"]:
            continue
        out[sl] |= body
    return out


def segment(
    channels: Sequence[np.ndarray], params: Mapping[str, Any] = PARAMS
) -> np.ndarray:
    """Channels of one image -> (H, W) uint8 label map: 0 background,
    1 neurite, 2 soma. Soma wins where both would apply."""
    merged = merge_channels(channels)
    if merged.size > MAX_PIXELS:
        raise ValueError(
            f"image has {merged.size} pixels; the classical neurite/soma model "
            f"accepts at most {MAX_PIXELS}"
        )
    ridges = ridge_mask(merged, params)
    somas = _accept_somas(_soma_candidates(merged, ridges, params), ridges, params)
    # Cutting the somas out leaves stubs of the ridges that crossed them.
    neurites = _drop_short(ridges & ~somas, params["stub"] * params["min_len"])
    out = np.zeros(merged.shape, np.uint8)
    out[neurites] = 1
    out[somas] = 2
    return out


def _ring(contour: np.ndarray, p: Mapping[str, Any]) -> List[Dict[str, float]]:
    if len(contour) > p["max_points"]:
        contour = cv2.approxPolyDP(contour, p["simplify_px"], True)
    return [{"x": float(x), "y": float(y)} for x, y in contour[:, 0, :]]


def label_to_polygons(
    label: np.ndarray,
    detect_holes: bool = True,
    params: Mapping[str, Any] = PARAMS,
) -> List[Dict[str, Any]]:
    """Label map -> polygons in the app's wire format.

    A region is one ``type='external'`` polygon carrying ``class`` and
    ``partClass``. With ``detect_holes`` its holes follow as ``type='internal'``
    polygons pointing at it through ``parent_id`` -- the representation the
    spheroid models already use. They matter here more than there: neurites
    form closed loops, and a loop emitted as one filled outline would count the
    background it encloses as neurite when intensity is measured. An internal
    polygon carries NO class, so nothing mistakes it for a neurite.
    """
    polygons: List[Dict[str, Any]] = []
    counter = 0
    mode = cv2.RETR_CCOMP if detect_holes else cv2.RETR_EXTERNAL
    for class_id, class_name in CLASSES:
        mask = (label == class_id).astype(np.uint8)
        contours, hierarchy = cv2.findContours(mask, mode, cv2.CHAIN_APPROX_SIMPLE)
        if hierarchy is None:
            continue
        parent_ids: Dict[int, str] = {}
        # Outer rings first, so a hole can name its parent.
        for index, contour in enumerate(contours):
            if hierarchy[0][index][3] != -1:
                continue
            area = float(cv2.contourArea(contour))
            if len(contour) < 3 or area < params["min_area"]:
                continue
            counter += 1
            polygon_id = f"polygon_{counter}"
            parent_ids[index] = polygon_id
            polygons.append(
                {
                    "id": polygon_id,
                    "points": _ring(contour, params),
                    "area": area,
                    "confidence": 1.0,
                    "type": "external",
                    "class": class_name,
                    # `partClass` is the field the Node polygon validator
                    # passes through; `class` alone is stripped on the way to
                    # the editor.
                    "partClass": class_name,
                }
            )
        for index, contour in enumerate(contours):
            parent = hierarchy[0][index][3]
            if parent == -1 or parent not in parent_ids:
                continue
            area = float(cv2.contourArea(contour))
            if len(contour) < 3 or area < params["min_hole_area"]:
                continue
            counter += 1
            polygons.append(
                {
                    "id": f"polygon_{counter}",
                    "points": _ring(contour, params),
                    "area": area,
                    "confidence": 1.0,
                    "type": "internal",
                    "parent_id": parent_ids[parent],
                }
            )
    return polygons

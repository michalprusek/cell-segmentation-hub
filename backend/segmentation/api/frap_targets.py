"""FRAP targeting: a frame from the microscope in, bleach spots out.

One synchronous call per field of view. The interactive queue is JWT-authenticated
and asynchronous, which is the wrong shape for a NIS-Elements JOBS run that must
block until it has ROIs to bleach — hence a separate endpoint rather than a reuse.

Selection happens HERE, not on the microscope PC, so the criteria can be retuned
without touching the acquisition machine and the client can stay dependency-free.
"""
from __future__ import annotations

import base64
import io
import logging
import math
import os
import sys
import time
from typing import Any, Dict, List, Optional

import numpy as np
import tifffile
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from PIL import Image

_MODELS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "models")
if _MODELS_DIR not in sys.path:
    sys.path.insert(0, _MODELS_DIR)

import frap_select as FS  # noqa: E402

from api import frap_render  # noqa: E402
from api._log_safe import scrub  # noqa: E402
from api.routes import (  # noqa: E402
    InferenceError,
    _microtubule_inference_lock,
    get_model_loader,
)
# The lock is imported rather than re-created: it serialises microtubule inference
# across EVERY caller, and a second lock object would serialise nothing.
# InferenceError comes from api/routes.py for the same reason -- that module already
# owns the ImportError fallback for a stripped image, so importing it from there is
# what guarantees this endpoint classifies exactly what the sibling classifies. Note
# that in that fallback it is aliased to Exception, which is why the clause below it
# has to stay harmless when it never runs.

logger = logging.getLogger(__name__)
router = APIRouter()

COORDINATE_ORDER = "x=col, y=row, in input image pixels"

# --- params_json validation -------------------------------------------------
#
# Checking only that a key is KNOWN and then splatting the value into a frozen
# dataclass turns operator typos into 500s carrying a bare correlation ID, and one
# of them into a denial of service. Measured: step_px=0 divides by zero inside
# resample_polyline and _baseline_indices; a string in a float field raises a
# TypeError out of numpy; and step_px=0.2 costs 11.03 s against 0.23 s at the
# default on five filaments, so step_px=0.02 on a real 100-filament frame is hours
# of CPU on a SHARED GPU host. Rate-limiting by request COUNT cannot bound that --
# one request is enough -- so the bound belongs on the value. This endpoint is about
# to become the only externally reachable route to this service.

# Lengths in micrometres. Zero or negative is not a loose setting, it is a physical
# criterion switched off: for r_iso_um and bleach_spread_um that means isolation
# quietly stops being tested at all. Strictly positive, with no upper bound -- a
# criterion so wide that nothing passes yields a visible shortfall, which is the
# safe direction.
_UM_LENGTH_KEYS = ("l_min_um", "spot_len_um", "spot_wid_um", "bleach_spread_um",
                   "r_iso_um", "obs_len_um", "border_margin_um", "d_sep_um")

# Inclusive [lo, hi] bounds, for the keys where BOTH ends matter.
#   step_px           the lower end is the CPU bound described above; past ~8 px the
#                     resampled polyline is too coarse for the tangent baseline.
#   band_thickness_px an mt_measure rasteriser width in pixels; 51 is already far
#                     wider than a microtubule at any usable magnification.
#   margin_multiplier scales band_thickness_px into the vicinity-ring radius.
#   f_mid             a FRACTION of the filament, so outside [0, 1] is meaningless.
_RANGES = {
    "step_px": (0.25, 8.0),
    "band_thickness_px": (1, 51),
    "margin_multiplier": (0.5, 8.0),
    "f_mid": (0.0, 1.0),
}

_SPOT_SHAPES = ("ellipse", "rect")


def _validated_overrides(overrides: Dict[str, Any]) -> Dict[str, Any]:
    """Coerce and range-check params_json. Every rejection is a 400 naming the key.

    Types come from the DEFAULT INSTANCE's runtime types rather than from the
    dataclass's declared annotations: frap_select has `from __future__ import
    annotations`, so those annotations are strings and `field.type` would hand back
    the text "float".

    kappa_spot, kappa_baseline_px and snr_min get the type and finiteness checks but
    no range. No finite value of theirs can raise, and the effect of an extreme one
    is that every candidate is rejected -- a visible shortfall, not a crash and not
    an unsafe bleach. Inventing bounds for them would be guessing.
    """
    defaults = vars(FS.SelectionParams())

    unknown = set(overrides) - set(defaults)
    if unknown:
        raise HTTPException(status_code=400,
                            detail=f"Unknown selection parameters: {sorted(unknown)}")

    clean: Dict[str, Any] = {}
    for key, raw in overrides.items():
        want = type(defaults[key])

        if want is str:
            if not isinstance(raw, str):
                raise HTTPException(
                    status_code=400,
                    detail=f"{key} must be a string, got {type(raw).__name__}")
            if key == "spot_shape" and raw not in _SPOT_SHAPES:
                raise HTTPException(
                    status_code=400,
                    detail=f"spot_shape must be one of {list(_SPOT_SHAPES)}, "
                           f"got {raw!r}")
            clean[key] = raw
            continue

        # `isinstance(True, int)` is True, so bools need excluding explicitly or
        # {"step_px": true} would silently become a resampling pitch of 1.0 px.
        if isinstance(raw, bool) or not isinstance(raw, (int, float)):
            raise HTTPException(
                status_code=400,
                detail=f"{key} must be a number, got {type(raw).__name__} ({raw!r})")

        value = float(raw)
        # json.loads accepts the NaN and Infinity literals by default. NaN reaches
        # int(round(...)) as a ValueError and inf as an OverflowError, neither of
        # which tells the caller anything.
        if not math.isfinite(value):
            raise HTTPException(
                status_code=400,
                detail=f"{key} must be a finite number, got {raw!r}")

        if want is int:
            if value != int(value):
                raise HTTPException(
                    status_code=400,
                    detail=f"{key} must be a whole number of pixels, got {raw!r}")
            value = int(value)

        if key in _UM_LENGTH_KEYS and value <= 0.0:
            raise HTTPException(
                status_code=400,
                detail=f"{key} is a length in micrometres and must be greater "
                       f"than zero, got {raw!r}")

        if key in _RANGES:
            lo, hi = _RANGES[key]
            if not lo <= value <= hi:
                raise HTTPException(
                    status_code=400,
                    detail=f"{key} must be between {lo} and {hi} inclusive, "
                           f"got {raw!r}")

        clean[key] = value

    _check_window_fits(defaults, clean)
    return clean


def _check_window_fits(defaults: Dict[str, Any], clean: Dict[str, Any]) -> None:
    """The one CROSS-field constraint: l_min_um must hold the observation window.

    Candidates come from the middle ``f_mid`` of the filament, so the most extreme
    one sits (1 - f_mid)/2 of the length from the nearer end and criterion 5b needs
    obs_len/2 of filament there:

        L * (1 - f_mid) / 2 >= obs_len / 2   =>   l_min_um >= obs_len_um / (1 - f_mid)

    The three defaults satisfy this (6.0 >= 3.0 / 0.5) but nothing kept an OVERRIDE
    honest, and the per-field checks above cannot: each sees one key. Below the
    bound ``_slice_window`` CLIPS, so 5b is evaluated over a shorter stretch than
    intended and a contaminant just past the clipped end is never seen -- the unsafe
    direction, and silent.

    Checked on the EFFECTIVE values, defaults merged under the overrides, because
    the realistic shape is someone setting ``f_mid`` alone: validating only the
    all-three-overridden case would miss exactly the input that occurs.
    """
    effective = {**defaults, **clean}
    f_mid = float(effective["f_mid"])
    obs_len_um = float(effective["obs_len_um"])
    l_min_um = float(effective["l_min_um"])

    # f_mid == 1.0 passes the [0.0, 1.0] INCLUSIVE range check above, so this guard
    # is what stops the division below -- not belt-and-braces. At f_mid == 1.0 the
    # candidate band is the whole filament including its own endpoints, so the window
    # is clipped for some candidate no matter how large l_min_um is: there is no
    # value to suggest, which is why this is a separate message.
    if f_mid >= 1.0:
        raise HTTPException(
            status_code=400,
            detail=f"f_mid={f_mid} makes the candidate band the entire filament, "
                   f"including its endpoints, so the observation window is clipped "
                   f"for some candidate at every l_min_um. f_mid must be strictly "
                   f"below 1.0.")

    # Rounded, and the SAME value is both compared and reported: 3.0 / (1 - 0.8)
    # is 15.000000000000004 in binary floating point, so an operator told "need
    # >= 15.0" who then sends exactly 15.0 must not be rejected again.
    needed = round(obs_len_um / (1.0 - f_mid), 6)
    if l_min_um < needed:
        raise HTTPException(
            status_code=400,
            detail=f"l_min_um={l_min_um} is too small for obs_len_um={obs_len_um} "
                   f"with f_mid={f_mid}: the observation window would be clipped, "
                   f"so the readout-clearance criterion would be evaluated over a "
                   f"shorter stretch than intended. Need l_min_um >= {needed} "
                   f"(= obs_len_um / (1 - f_mid)).")


# --- pixel scale bounds ------------------------------------------------------
#
# um_per_px is the one input that scales EVERY isolation criterion at once, and it
# arrives from the JOBS macro as a bare float that only had to be positive. A wrong
# one does not fail -- it relaxes all six criteria together and returns the most
# confident-looking response this endpoint can emit. Measured on a field of
# filaments 0.8 um apart, where nothing is safe to bleach: at the correct 0.1 the
# answer is 0 spots with shortfall true; at 72.45 -- the same rig calibration written
# in nm/px, which is exactly how the slip happens -- it is 10 spots, shortfall false,
# and every rejection counter zero. Note the asymmetry this fixes: step_px, whose
# worst case is a slow request, was range-checked; um_per_px, whose worst case is a
# bleach that clipped a neighbour, was not.
#
# Two bounds, because they catch different mistakes and neither subsumes the other:
#
#   the range         an absurd UNIT (nm/px, m/px). Deliberately far wider than any
#                     real objective -- 0.005 um/px is past the diffraction limit and
#                     10 um/px is a macro lens -- so it cannot reject a real
#                     acquisition. It only refuses numbers that are not a
#                     micrometre-per-pixel at all.
#   _check_scale      an ROI SMALLER THAN A PIXEL, which is unbleachable and which
#                     the range alone does not catch. This is what actually kills the
#                     72.45 case: the half-axes come out at 0.0069 px, the mask PNG
#                     degenerates to a few stray pixels, and the JSON still lists ten
#                     properly-specified ROIs -- the two artefacts that are supposed
#                     to be the same selection, disagreeing silently.
MIN_UM_PER_PX = 0.005
MAX_UM_PER_PX = 10.0
MIN_ROI_HALF_AXIS_PX = 0.5


def _check_scale(um_per_px: float, params: "FS.SelectionParams") -> None:
    """Refuse a pixel scale that cannot describe the frame that was sent."""
    if not MIN_UM_PER_PX <= um_per_px <= MAX_UM_PER_PX:
        raise HTTPException(
            status_code=400,
            detail=f"um_per_px={um_per_px} is outside {MIN_UM_PER_PX}-"
                   f"{MAX_UM_PER_PX} um/px, which already spans every real "
                   f"objective. A value this far out is usually the calibration in "
                   f"other units -- nm/px is the common slip, so {um_per_px} most "
                   f"likely means {um_per_px / 1000.0}. Every isolation criterion is "
                   f"a micrometre length divided by this number, so a wrong unit "
                   f"relaxes all of them at once instead of failing.")

    # Checked against the EFFECTIVE params, so a params_json that shrinks the spot is
    # caught too -- this is the same footprint half_axes_px hands the criteria.
    a_px, b_px = FS.half_axes_px(params, um_per_px)
    if min(a_px, b_px) < MIN_ROI_HALF_AXIS_PX:
        raise HTTPException(
            status_code=400,
            detail=f"At um_per_px={um_per_px} the bleach ROI is {2 * a_px:.4g} x "
                   f"{2 * b_px:.4g} pixels (spot_len_um={params.spot_len_um}, "
                   f"spot_wid_um={params.spot_wid_um}), i.e. smaller than one pixel. "
                   f"Such an ROI cannot be bleached, and the mask PNG would carry a "
                   f"few stray pixels while the JSON still described a full-size "
                   f"spot. Check that um_per_px is micrometres per pixel and that "
                   f"the spot size matches the objective.")


# --- upload and decode bounds ----------------------------------------------
#
# `file.file.read()` had no cap, and tifffile.imread decoded EVERY page although at
# most two are ever used: a 4000-page file is ~2 GB of RSS, and a compressed
# all-zero page with huge declared dimensions turns a few KB of upload into
# gigabytes -- measured here at 39 KB of zlib declaring 36 million pixels. All three
# bounds are generous against a real field of view, and they are the knobs to raise
# if a larger camera turns up.
MAX_UPLOAD_BYTES = 256 * 1024 * 1024   # a 2-page 2048^2 uint16 frame is 16 MB
MAX_PAGES = 64                         # ImType 18 writes one page per layer
MAX_PAGE_PIXELS = 4096 * 4096          # 2048^2 and 2560x2160 sCMOS both fit easily


def _read_body(upload: UploadFile) -> bytes:
    """Read the upload with a hard ceiling, so an unbounded body cannot be posted."""
    raw = upload.file.read(MAX_UPLOAD_BYTES + 1)
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Frame is larger than the {MAX_UPLOAD_BYTES} byte upload "
                   f"limit. One field of view is a two-page TIFF; if this is a "
                   f"whole ND acquisition, save the single frame instead.")
    return raw


def _as_2d_page(arr: np.ndarray, index: int, what: str) -> np.ndarray:
    """One decoded page as a 2-D image, or a 400 that refuses to guess."""
    arr = np.asarray(arr)
    if arr.ndim == 2:
        return arr
    if arr.ndim == 3 and arr.shape[2] in (2, 3, 4) and arr.shape[0] > 4:
        raise HTTPException(
            status_code=400,
            detail=f"{what} page {index} has shape {tuple(int(s) for s in arr.shape)}, "
                   f"which is ambiguous: it is either one "
                   f"{arr.shape[0]}x{arr.shape[1]} image with {arr.shape[2]} "
                   f"interleaved samples per pixel (channel-last), or "
                   f"{arr.shape[0]} separate {arr.shape[1]}x{arr.shape[2]} images. "
                   f"Which layout NIS's ImageSaveAs writes is unverified (spec "
                   f"section 9 item 1), and guessing wrong the second way hands "
                   f"the model a {arr.shape[2]}-pixel-wide sliver, finds nothing, "
                   f"and reports OK n=0 as though the field were empty. Save the "
                   f"channels as separate TIFF pages and set irm_page/fluor_page.")
    raise HTTPException(
        status_code=400,
        detail=f"{what} page {index} is not a 2-D image; got shape "
               f"{tuple(int(s) for s in arr.shape)}")


def _page_array(tif, index: int, what: str) -> np.ndarray:
    """Decode exactly ONE page, bounded BEFORE the decode rather than after."""
    n_pages = len(tif.pages)
    if not 0 <= index < n_pages:
        raise HTTPException(
            status_code=400,
            detail=f"{what} page {index} is outside the file, which has "
                   f"{n_pages} page(s)")
    page = tif.pages[index]
    shape = tuple(int(s) for s in page.shape)
    n_px = 1
    for dim in shape:
        n_px *= dim
    if n_px > MAX_PAGE_PIXELS:
        raise HTTPException(
            status_code=400,
            detail=f"{what} page {index} declares {n_px} pixels (shape {shape}), "
                   f"over the {MAX_PAGE_PIXELS} pixel limit. The size is read from "
                   f"the TIFF tags and checked BEFORE decoding, because a "
                   f"compressed all-zero page is a few KB on the wire and "
                   f"gigabytes once decoded.")
    try:
        arr = page.asarray()
    except MemoryError as exc:
        # Ran out of memory decoding a page whose declared size we already accepted.
        # That is this server's problem, not a malformed frame.
        logger.error("frap/targets: out of memory decoding %s page %s (shape %s)",
                     what.lower(), scrub(index), scrub(shape))
        raise HTTPException(
            status_code=500,
            detail=f"The server ran out of memory decoding {what.lower()} page "
                   f"{index} (shape {shape}). The frame is valid; retrying when the "
                   f"host is less busy is reasonable.") from exc
    except Exception as exc:                       # noqa: BLE001
        # A missing codec package is a SERVER fault and must not be a 400. tifffile
        # decodes Deflate itself but delegates LZW -- ImageJ's and NIS's default
        # compression -- to imagecodecs, which was absent from the image. The
        # operator reads this sentence in a one-line frap_status.txt with no other
        # diagnostic, so a 400 sends them off re-saving a frame that was never the
        # problem. imagecodecs is now a declared dependency; this branch is what
        # happens if it goes missing again.
        if isinstance(exc, ImportError) or "imagecodecs" in str(exc):
            # `exc` is the one value on this line that carries bytes from the
            # uploaded frame -- a decoder's message quotes tags out of the file.
            logger.error("frap/targets: codec package missing for %s page %s: %s",
                         what.lower(), scrub(index), scrub(exc))
            raise HTTPException(
                status_code=500,
                detail=f"The server cannot decode this TIFF's compression ({exc}). "
                       f"The frame itself is fine and re-saving it will not help -- "
                       f"the ML image is missing a codec package. Contact the "
                       f"maintainer.") from exc
        raise HTTPException(
            status_code=400,
            detail=f"Unreadable TIFF: could not decode {what.lower()} page "
                   f"{index}: {exc}") from exc
    return _as_2d_page(arr, index, what)


def _read_frame(raw: bytes, irm_page: int, fluor_page: Optional[int]):
    """Decode ONLY the one or two pages this call actually uses.

    tifffile.imread decoded the whole file, so a 4000-page upload cost ~2 GB to
    answer a question about page 0. Opening the file and taking pages by index
    reads the tags for all of them (cheap) and the pixels for none but these.
    """
    try:
        tif = tifffile.TiffFile(io.BytesIO(raw))
    except Exception as exc:                       # noqa: BLE001
        raise HTTPException(status_code=400,
                            detail=f"Unreadable TIFF: {exc}") from exc
    with tif:
        n_pages = len(tif.pages)
        if n_pages > MAX_PAGES:
            raise HTTPException(
                status_code=400,
                detail=f"Frame has {n_pages} pages, over the {MAX_PAGES} page "
                       f"limit. One field of view is a handful of layers; a file "
                       f"this deep is a whole acquisition, not a frame.")
        irm = _page_array(tif, irm_page, "IRM")
        fluor = None
        if fluor_page is not None:
            fluor = _page_array(tif, fluor_page, "Fluorescence").astype(np.float32)
    return irm, fluor


def _polylines_from(result: Dict[str, Any]):
    """The model's polylines as point arrays, plus its own instance id per polyline.

    ONE filtered pass, returning both lists together, because the filter is what
    makes them fragile: a polyline with fewer than two points is dropped, and
    ``Spot.mt_index`` indexes into what SURVIVES. Collecting the ids in a separate
    pass over the unfiltered list would shift every id by each entry dropped before
    it -- a mislabelled spot rather than a missing one, which is worse.
    """
    out: List[np.ndarray] = []
    instance_ids: List[Optional[str]] = []
    for pl in result.get("polylines", []) or []:
        pts = pl.get("points", [])
        if len(pts) >= 2:
            out.append(np.array([[float(q["x"]), float(q["y"])] for q in pts],
                                dtype=np.float64))
            instance_ids.append(pl.get("instanceId"))
    return out, instance_ids


# What to tell an operator when a criterion did most of the rejecting. Keyed by
# frap_select._REJECT_KEYS. Only 'snr' carries a warning about the DEFAULT itself:
# snr_min is a contrast threshold that was never calibrated, and on a real frame the
# highest contrast measured over 3438 candidates was 0.854 against a threshold of
# 2.0 -- so a field can be rejected wholesale by a number no filament can reach.
_REJECT_HINTS = {
    "snr": ("snr_min is a contrast threshold on the fluorescence page and is NOT "
            "calibrated out of the box -- measure it from a dry-run overlay before "
            "believing a shortfall attributed to it."),
    "readout_clearance": ("r_iso_um is the readout isolation radius; a dense field "
                          "legitimately exhausts it."),
    "bleach_clearance": ("The field is too dense to bleach anywhere without "
                         "touching a neighbour."),
    "length": "They are shorter than l_min_um.",
    "border": "They sit within border_margin_um of the frame edge.",
    "straightness": "They are more curved than kappa_spot allows.",
    "separation": "They lost to an already-chosen spot closer than d_sep_um.",
    "budget": "k_max was already reached, so they were never needed.",
}


def _warning_for(sel, k_min: int, snr_evaluated: bool) -> Optional[str]:
    """One sentence saying why this field produced too few spots, or None.

    Without this, `success: true` with an empty `spots` list is the identical
    response for "this field genuinely has nothing usable", "we ran on the wrong
    page", and "a criterion was switched off" -- and the sibling /segment route
    already attaches a warning in that situation. An unattended JOBS run has only
    this string and a one-line status file to go on.

    The skipped-criterion note fires INDEPENDENTLY of the shortfall, because those
    two are opposites in practice: omitting fluor_page removes the SNR test, which
    makes the run faster and MORE productive, so the case that most needs announcing
    is the one that looks healthiest.
    """
    notes: List[str] = []
    if not snr_evaluated:
        notes.append(
            "No fluor_page was supplied, so the brightness criterion (snr_min) was "
            "NOT applied and these spots were chosen on geometry alone; every "
            "spot's \"snr\" is null for that reason, not because it measured zero.")

    if sel.n_polylines == 0:
        notes.append(
            "Segmentation returned no filaments for this frame. Check that "
            "irm_page points at the IRM channel -- the model is IRM-only, and on a "
            "fluorescence page it emits confident-looking polylines with no "
            "contrast under them.")
    elif sel.shortfall:
        # Counted per FILAMENT, not per candidate. rejected_by's denominator is
        # candidates -- on this frame it reported 3888 readout_clearance rejections
        # out of 8777 -- and an operator asked "why not that microtubule", not "why
        # not that pixel". SelectionResult.rejected_filaments already carries the
        # modal reason per filament for exactly that reason; this reuses it rather
        # than re-deriving a second answer from the other histogram.
        blocked: Dict[str, int] = {}
        for rf in sel.rejected_filaments:
            blocked[rf.reason] = blocked.get(rf.reason, 0) + 1

        detail = ""
        if blocked:
            worst = max(blocked, key=blocked.get)
            detail = (f" {blocked[worst]} of {sel.n_polylines} filaments were "
                      f"blocked by '{worst}'.")
            hint = _REJECT_HINTS.get(worst)
            if hint:
                detail += " " + hint

            # The modal blocker is not always the one worth acting on. On a dense
            # field readout_clearance blocks the most filaments while being a real
            # property of the sample, whereas snr_min is an UNCALIBRATED default --
            # measured on one real frame, it blocked 15 filaments that alone would
            # have filled the whole k_max budget, and no filament could reach it
            # (highest contrast 0.854 against a threshold of 2.0). So when SNR alone
            # accounts for the gap, say so even if something else blocked more.
            n_snr = blocked.get("snr", 0)
            if worst != "snr" and n_snr and len(sel.spots) + n_snr >= k_min:
                detail += (f" Separately, 'snr' alone blocked {n_snr} filaments -- "
                           f"enough to have met k_min on its own. "
                           f"{_REJECT_HINTS['snr']}")

        notes.append(
            f"Only {len(sel.spots)} of the requested minimum {k_min} bleach spots "
            f"were found on this field.{detail}")

    return " ".join(notes) if notes else None


@router.post("/frap/targets")
def frap_targets(
    file: UploadFile = File(...),
    um_per_px: float = Form(..., gt=0.0),
    irm_page: int = Form(0, ge=0),
    fluor_page: Optional[int] = Form(None),
    k_min: int = Form(5, ge=1),
    k_max: int = Form(10, ge=1),
    params_json: Optional[str] = Form(None),
    include_mask: bool = Form(True),
    include_overlay: bool = Form(False),
    loader=Depends(get_model_loader),
) -> Dict[str, Any]:
    """Segment the IRM page, choose bleach spots, return them in image pixels.

    There is deliberately NO threshold parameter. v5H applies its own fitted
    foreground cut of 0.97 from params_v5h.json, and forwarding a user value would
    cut a very confident foreground at 0.5 and flood the instancer with noise. A
    knob that is silently ignored is worse than no knob.

    (This used to add that 0.97 was not even expressible on /api/v1/segment,
    whose threshold was declared le=0.9. That bound has since been raised to
    0.99 — it was rejecting every microtubule request the frontend made — but
    the argument for keeping this endpoint knob-free stands on its own.)
    """
    import json

    raw = _read_body(file)
    irm, fluor = _read_frame(raw, irm_page, fluor_page)

    params = FS.SelectionParams()
    if params_json:
        try:
            overrides = json.loads(params_json)
        except ValueError as exc:
            raise HTTPException(status_code=400,
                                detail=f"params_json is not valid JSON: {exc}") from exc
        if not isinstance(overrides, dict):
            raise HTTPException(
                status_code=400,
                detail=f"params_json must be a JSON object, got "
                       f"{type(overrides).__name__}",
            )
        params = FS.SelectionParams(
            **{**vars(params), **_validated_overrides(overrides)})

    # After the overrides, because the sub-pixel test needs the EFFECTIVE spot size,
    # and before the model call, so a bad scale costs no GPU time.
    _check_scale(um_per_px, params)

    pil = Image.fromarray(irm)
    t0 = time.time()
    # EVERY failure of the inference call becomes a 500 carrying a sentence an
    # operator can act on. Unwrapped, they reached the microscope as `ERROR Server
    # returned HTTP 500: {"detail": "Internal error (id: ab12cd34)"}` -- the same
    # thing a malformed request produces, which on an unattended JOBS run is the
    # difference between "retry this field" and "stop the experiment". The detail is
    # one sentence, not routes.py's dict: this endpoint's client writes it verbatim
    # into a ONE-LINE frap_status.txt read at the microscope.
    #
    # There is deliberately NO 504 branch, and that is a difference from the sibling
    # in api/routes.py rather than an oversight. A timeout is reachable there and not
    # here: ModelLoader.predict_microtubule takes a `timeout` argument and never
    # reads it -- no executor, no wait -- so InferenceTimeoutError cannot be raised
    # on this path. A handler for a state that cannot occur only disguises the fact
    # that no timeout exists; nginx's proxy_read_timeout is the real one. If an
    # executor is ever put behind this call, restore the 504 clause ABOVE the
    # InferenceError one, because InferenceTimeoutError subclasses it.
    #
    # The catch-all is not defensive padding either. The failures this path actually
    # produces are torch's CUDA OutOfMemoryError and a bare ValueError/RuntimeError
    # out of the wrapper ("expected 2D image", "Model not loaded") -- and
    # predict_microtubule, unlike predict_wound, wraps none of them in
    # InferenceError. Without this clause every failure that really happens is the
    # bare correlation ID above, which is exactly the bug the paragraph above
    # describes.
    try:
        with _microtubule_inference_lock:
            result = loader.predict_microtubule(pil)
    except InferenceError as exc:
        logger.error("frap/targets: inference failed: %s", exc)
        raise HTTPException(
            status_code=500,
            detail=f"Microtubule inference failed: {exc}") from exc
    except Exception as exc:                       # noqa: BLE001
        logger.exception("frap/targets: inference raised %s", type(exc).__name__)
        raise HTTPException(
            status_code=500,
            detail=f"Microtubule inference failed on a {irm.shape[1]}x"
                   f"{irm.shape[0]} frame ({type(exc).__name__}: {exc}). This is a "
                   f"server-side failure, not a problem with the submitted frame -- "
                   f"the GPU may be out of memory. Retrying this field is "
                   f"reasonable.") from exc
    inference_s = time.time() - t0

    polylines, mt_instance_ids = _polylines_from(result)
    t1 = time.time()
    sel = FS.select_spots(polylines, irm.shape[:2], um_per_px, fluor=fluor,
                          params=params, k_min=k_min, k_max=k_max)
    selection_s = time.time() - t1

    snr_evaluated = fluor is not None
    warning = _warning_for(sel, k_min, snr_evaluated)

    # The effective inputs go in the log line, not just the counts: a run that came
    # back empty cannot be reconstructed afterwards from "0 spots", and um_per_px and
    # params_json are the first two things to check.
    # The request's own values are scrubbed before they go on the line. They
    # are declared int/float on the endpoint and FastAPI has already coerced
    # them, so none of them can actually carry a newline -- but that guarantee
    # lives in a signature 250 lines away, and this is where it has to hold.
    # Numbers are formatted first so the line reads exactly as it did.
    logger.info("frap/targets: %d polylines -> %d candidates -> %d spots "
                "(um_per_px %s, k %s..%s, snr_evaluated %s, inference %.2fs, "
                "selection %.2fs, rejected %s, dropped %s)",
                sel.n_polylines, sel.n_candidates, len(sel.spots),
                scrub(f"{um_per_px:.5g}"), scrub(k_min), scrub(k_max),
                snr_evaluated, inference_s, selection_s,
                sel.rejected_by, sel.dropped_by)
    if params != FS.SelectionParams():
        logger.info("frap/targets: non-default selection params: %s", vars(params))
    if warning:
        logger.warning("frap/targets: %s", scrub(warning))

    body: Dict[str, Any] = {
        "success": True,
        "n_polylines": sel.n_polylines,
        "n_candidates": sel.n_candidates,
        "spots": [_spot_json(s, params, um_per_px, mt_instance_ids)
                  for s in sel.spots],
        "shortfall": sel.shortfall,
        # Which criteria actually ran. `snr` is the only optional one -- it needs a
        # fluorescence page -- and without one `rejected_by["snr"] == 0` reads
        # identically to "every candidate passed the brightness test". Until this
        # field existed there was nothing on the wire to tell the two apart.
        "snr_evaluated": snr_evaluated,
        # null on a healthy field; otherwise one sentence naming what was skipped or
        # what did the rejecting. See _warning_for.
        "warning": warning,
        "rejected_by": sel.rejected_by,
        # rejected_by counts CANDIDATES against criteria; dropped_by counts
        # FILAMENTS dropped after the greedy pick (d_sep or k_max) — kept as a
        # sibling dict, not folded together, so a number can't be misread later.
        "dropped_by": sel.dropped_by,
        "coordinate_order": COORDINATE_ORDER,
        "um_per_px": um_per_px,
        "image_shape": [int(irm.shape[0]), int(irm.shape[1])],
        "timing": {"inference_s": round(inference_s, 3),
                   "selection_s": round(selection_s, 3)},
    }
    body["mask_png_b64"] = None
    body["overlay_png_b64"] = None
    if include_mask:
        body["mask_png_b64"] = base64.b64encode(
            frap_render.render_mask_png(sel.spots, irm.shape[:2], params, um_per_px)
        ).decode("ascii")
    if include_overlay:
        # rejected_filaments feeds the overlay only, per Spec §8 — the diagnostic
        # surface for a shortfall. It does NOT go in the JSON: rejected_by already
        # serves the wire as a histogram, and doubling it here would be redundant.
        body["overlay_png_b64"] = base64.b64encode(
            frap_render.render_overlay_png(irm, polylines, sel.spots, params, um_per_px,
                                           rejected=sel.rejected_filaments)
        ).decode("ascii")
    return body


def _spot_json(s, params: "FS.SelectionParams", um_per_px: float,
               instance_ids: List[Optional[str]]) -> Dict[str, Any]:
    # From frap_select, not recomputed: these half-axes are what the microscope
    # BLEACHES, and frap_select's copy is what the isolation criteria VALIDATED. Two
    # independent copies of the same arithmetic is the divergence this endpoint
    # already shipped once, between the mask and the macro.
    rx_px, ry_px = FS.half_axes_px(params, um_per_px)
    return {
        "x": round(s.x, 2), "y": round(s.y, 2),
        "tangent_deg": round(s.tangent_deg, 2),
        "mt_index": s.mt_index,
        # The model's OWN id for the instance, alongside mt_index rather than
        # instead of it: mt_index is an index into a list this response does not
        # contain, so frap_spots.json -- whose stated purpose is offline analysis --
        # could not otherwise be joined back to the segmentation that produced it.
        "mt_instance_id": (instance_ids[s.mt_index]
                           if 0 <= s.mt_index < len(instance_ids) else None),
        "mt_length_um": round(s.mt_length_um, 3),
        "bleach_clearance_um": round(s.bleach_clearance_um, 3),
        "readout_clearance_um": round(s.readout_clearance_um, 3),
        "snr": (None if s.snr is None else round(s.snr, 3)),
        "score": round(s.score, 4),
        # "rx"/"ry" here are in image pixels, per the top-level coordinate_order,
        # same as "cx"/"cy" — wire keys are unchanged, only the local names moved
        # to the _px suffix.
        "roi": {"type": params.spot_shape, "cx": round(s.x, 2), "cy": round(s.y, 2),
                "rx": round(rx_px, 2), "ry": round(ry_px, 2),
                "angle_deg": round(s.tangent_deg, 2)},
    }

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
from api.routes import (  # noqa: E402
    InferenceError,
    InferenceTimeoutError,
    _microtubule_inference_lock,
    get_model_loader,
)
# The lock is imported rather than re-created: it serialises microtubule inference
# across EVERY caller, and a second lock object would serialise nothing. The two
# inference exceptions come from api/routes.py for the same reason -- that module
# already owns the ImportError fallback for a stripped image, so importing them from
# there is what guarantees this endpoint catches exactly what the sibling catches.

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

    return clean


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
    except Exception as exc:                       # noqa: BLE001
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


def _polylines_from(result: Dict[str, Any]) -> List[np.ndarray]:
    out: List[np.ndarray] = []
    for pl in result.get("polylines", []) or []:
        pts = pl.get("points", [])
        if len(pts) >= 2:
            out.append(np.array([[float(q["x"]), float(q["y"])] for q in pts],
                                dtype=np.float64))
    return out


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
    foreground cut of 0.97 from params_v5h.json; /api/v1/segment declares threshold
    as le=0.9, so 0.97 is not expressible there, and forwarding a user value would
    cut a very confident foreground at 0.5 and flood the instancer with noise. A
    knob that is silently ignored is worse than no knob.
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

    pil = Image.fromarray(irm)
    t0 = time.time()
    # Mirrors api/routes.py's handling of the same call: a timeout is a 504 and an
    # inference failure a 500, so the two are distinguishable. Unwrapped, both
    # reached the microscope as `ERROR Server returned HTTP 500: {"detail":
    # "Internal error (id: ab12cd34)"}` -- the same thing a malformed request
    # produces. On an unattended JOBS run that is exactly the difference between
    # "retry this field" and "stop the experiment".
    #
    # Deliberate deviation from the sibling: the detail is one sentence, not
    # routes.py's dict. This endpoint's client writes the response detail verbatim
    # into a ONE-LINE frap_status.txt that an operator reads at the microscope, and
    # a serialised dict there is noise. InferenceTimeoutError subclasses
    # InferenceError, so it must be caught first.
    try:
        with _microtubule_inference_lock:
            result = loader.predict_microtubule(pil)
    except (InferenceTimeoutError, TimeoutError) as exc:
        model_name = getattr(exc, "model_name", "microtubule")
        timeout = getattr(exc, "timeout", None)
        logger.error("frap/targets: model %s timed out after %ss: %s",
                     model_name, timeout, exc)
        raise HTTPException(
            status_code=504,
            detail=f"Model '{model_name}' inference timed out"
                   + (f" after {timeout}s" if timeout is not None else "")
                   + f" on a {irm.shape[1]}x{irm.shape[0]} frame. The GPU queue may "
                     f"be busy; retrying this field is reasonable.") from exc
    except InferenceError as exc:
        logger.error("frap/targets: inference failed: %s", exc)
        raise HTTPException(
            status_code=500,
            detail=f"Microtubule inference failed: {exc}") from exc
    inference_s = time.time() - t0

    polylines = _polylines_from(result)
    t1 = time.time()
    sel = FS.select_spots(polylines, irm.shape[:2], um_per_px, fluor=fluor,
                          params=params, k_min=k_min, k_max=k_max)
    selection_s = time.time() - t1

    logger.info("frap/targets: %d polylines -> %d candidates -> %d spots "
                "(inference %.2fs, selection %.2fs, rejected %s)",
                sel.n_polylines, sel.n_candidates, len(sel.spots),
                inference_s, selection_s, sel.rejected_by)

    body: Dict[str, Any] = {
        "success": True,
        "n_polylines": sel.n_polylines,
        "n_candidates": sel.n_candidates,
        "spots": [_spot_json(s, params, um_per_px) for s in sel.spots],
        "shortfall": sel.shortfall,
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


def _spot_json(s, params: "FS.SelectionParams", um_per_px: float) -> Dict[str, Any]:
    rx_px = 0.5 * params.spot_len_um / um_per_px
    ry_px = 0.5 * params.spot_wid_um / um_per_px
    return {
        "x": round(s.x, 2), "y": round(s.y, 2),
        "tangent_deg": round(s.tangent_deg, 2),
        "mt_index": s.mt_index,
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

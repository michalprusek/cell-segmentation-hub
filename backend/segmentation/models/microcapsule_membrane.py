"""Membrane state per microcapsule + inner-circle segmentation.

VENDORED, 2026-09-03, from the `microcapsule-membrane` archive
(`microcaps/membrane.py`), with two deliberate changes and no others:

  - `_fill_circular` is inlined (see its docstring). The archive's
    `microcaps/pipeline.py` — its own Hough + overlap-suppression outer-wall
    detector — is NOT vendored: this repo already has the capsule contours from
    the distilled U-Net, and that detector is documented upstream as returning
    a single capsule per image, which would be a downgrade here.
  - `analyze_image` (which called that detector) is dropped; `analyze` is the
    entry point, driven by `capsule_from_polygon` below.

The classifier is classical and unsupervised — no weights, no GPU, ~1.3 s per
1280x1024 image on CPU. Its two thresholds were calibrated on 42 labelled
images (21 intact / 21 dissolved), 42/42 in-sample and leave-one-out. Read the
upstream README's warning before trusting that number on new data: the
leave-one-out refits only the two scalars, while the decisions that matter
(raw grey rather than illumination-flattened, the band-pass edge selector,
Weber contrast over a wide baseline) were made against the whole set.


A microcapsule in bright field shows two boundaries: the outer wall (traced by
:mod:`microcaps.pipeline`) and, while the internal membrane is intact, a second
near-concentric boundary further in.  Two independent things change when that
membrane dissolves, and the classifier needs both:

``width``
    How far the radial transition is spread out.  A dissolving membrane does
    not fade in contrast, it spreads in space: an intact one steps over 1-6 px,
    a dissolved one ramps over 8-18 px.  This catches the dark-core capsules.

``contrast``
    The Weber contrast between the two compartments, read over a wide baseline
    (shell median vs core median), not just across the edge.  An intact
    membrane means the core really is a different optical compartment (+0.25
    and up); a dissolved one leaves faint concentric fringes that can be *very*
    sharp yet separate nothing (contrast around zero or negative).  This
    catches the pale, fringed capsules, which no sharpness measure can.

Pipeline per capsule::

    raw gray (scale bar blanked; NO illumination division -- see prepare_gray)
      -> polar unwrap in a band inside the traced wall
      -> pass 1: 5 deg sector averages -> strongest *sharp* inward-darkening
                 edge per sector -> robust circle fit -> guide r_g(theta)
      -> pass 2: rays re-sampled around r_g(theta), combined with a per-angle
                 median -> one aligned transition -> width + contrast
      -> state; if sharp, dense per-angle sub-pixel edge -> inner contour

Two things had to be got right, and both cost a rewrite:

* the inner circle is *not* concentric with the outer one, so a plain median
  over all angles smears a 3 px step into a 30 px ramp and the states become
  indistinguishable.  Everything is measured per angular sector and aligned to
  the guide before it is combined.
* pass 1 must find the *sharpest* edge, not the strongest one.  Plain
  ``argmax |dI/dr|`` prefers a broad shading ramp over a thin membrane because
  the ramp carries more total contrast; the band-passed derivative fixes that.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field

import cv2
import numpy as np
from scipy.ndimage import gaussian_filter1d, map_coordinates



def _fill_circular(r):
    """Linearly interpolate NaNs on a periodic signal.

    Vendored verbatim from the upstream `microcaps.pipeline`. It is the ONLY
    thing this module needed from there, and that module is the archive's own
    Hough/overlap outer-wall detector — which this repo does not use, because
    the distilled U-Net already supplies the capsule contours. Copying ten
    lines beats carrying a second, unused capsule detector.
    """
    n = len(r)
    idx = np.arange(n)
    good = ~np.isnan(r)
    if good.sum() < 8:
        return None
    ext_i = np.concatenate([idx[good] - n, idx[good], idx[good] + n])
    ext_v = np.tile(r[good], 3)
    return np.interp(idx, ext_i, ext_v)


# --------------------------------------------------------------------------- #
# Tunables.  Radii are (fraction of the capsule radius, absolute px floor) and
# resolve to whichever is larger -- the dataset mixes magnifications.
# --------------------------------------------------------------------------- #
N_ANG = 720                 # rays around the capsule
SECTOR_DEG = 5.0            # pass-1 angular averaging window
WALL_MARGIN = (0.045, 12.0) # stay this far inside the traced wall
R_LO = 0.35                 # innermost radius searched
DR = 0.40                   # radial sample spacing, px
ALIGN_WIN = (0.30, 80.0)    # half-window around the guide in pass 2
INLIER_BAND = (0.05, 8.0)   # a sector counts towards coverage inside this band
TRACE_BAND = (0.035, 8.0)   # search band for the pixel-precise inner contour
BASELINE_GAP = (0.05, 15.0) # keep the compartment medians this clear of the edge
SIGMA_G = 1.5               # px, fine derivative scale (edge localisation)
SIGMA_BG = 8.0              # px, coarse scale subtracted to reject broad ramps
MIN_RADIUS = 40.0           # px, below this a capsule is not worth measuring

# Feature values for a capsule the method cannot read.  Both are pushed well
# past their thresholds on the "dissolved" side ON PURPOSE: an unreadable
# capsule is one whose membrane we cannot vouch for, and 0.0 would have left it
# sitting a hair below the contrast threshold instead of decisively outside it.
DEGENERATE = dict(width=99.0, contrast=-1.0, coverage=0.0, peak=0.0, sharp=0.0,
                  fwhm=99.0, core=np.nan, shell=np.nan, r_edge=0.0, r_frac=0.0)


def _px(spec, R):
    """Resolve a (fraction, px-floor) tunable against a capsule radius."""
    frac, floor = spec
    return max(frac * R, floor)


def _row_fill(V):
    """Linearly interpolate NaNs inside each row (constant at the ends).
    Zero-filling instead would inject a huge artificial gradient wherever the
    wall cut starts."""
    out = V.copy()
    idx = np.arange(V.shape[1])
    for k in range(V.shape[0]):
        ok = np.isfinite(V[k])
        if ok.all():
            continue
        out[k] = np.interp(idx, idx[ok], V[k, ok]) if ok.any() else 0.0
    return out


def _erode1d(ok, n):
    """Shrink a boolean validity mask by n samples each way, so a derivative
    never straddles the edge of the valid region."""
    if n <= 0:
        return ok
    e = ok.copy()
    for s in range(1, n + 1):
        e[s:] &= ok[:-s]
        e[:-s] &= ok[s:]
    return e


def _derivatives(q, dr=DR):
    """(fine derivative, band-passed derivative) of a radial profile.

    ``argmax`` of the fine derivative is a *strong*-edge detector, and the
    strongest edge inside a pale capsule is often a broad shading ramp rather
    than the membrane.  For an erf edge of scale s the derivative peak is
    h / sqrt(2*pi*(s^2 + sigma^2)), so subtracting the coarse-scale derivative
    cancels a broad ramp (nearly equal at both scales) while leaving a sharp
    edge almost intact -- for s = 12 px vs s = 1 px the surviving response
    differs by a factor of about 30.  Localise on the band-passed response,
    measure on the fine one.
    """
    fine = gaussian_filter1d(q, SIGMA_G / dr, order=1) / dr
    coarse = gaussian_filter1d(q, SIGMA_BG / dr, order=1) / dr
    return fine, fine - coarse


# --------------------------------------------------------------------------- #
# Result type
# --------------------------------------------------------------------------- #
@dataclass
class Membrane:
    """State of one capsule's internal membrane."""

    state: str                          # "sharp" | "dissolved"
    score: float                        # > 0 means sharp; magnitude = margin
    features: dict = field(default_factory=dict)
    contour: np.ndarray | None = None   # (N,2) float32 inner boundary, if sharp
    guide: np.ndarray | None = None     # (N_ANG,) guide radius per angle
    center: tuple | None = None         # centre of the fitted inner circle

    @property
    def sharp(self):
        return self.state == "sharp"


# --------------------------------------------------------------------------- #
# Preprocessing
# --------------------------------------------------------------------------- #
def prepare_gray(gray, path=""):
    """Blank the burnt-in scale bar; otherwise leave the photometry alone.

    Deliberately *no* illumination division, unlike ``pipeline.preprocess``.
    That stage divides by a sigma = W/16 (~80 px) blur, which is right for
    detecting hairline outer rings but wrong here on both counts: it attenuates
    the core-vs-shell level difference (a ~200 px scale structure) that
    ``contrast`` measures, and it reshapes a broad ramp into a narrow one, so
    the measured ``width`` stops being physical -- on 209.tiff, a visibly
    diffuse edge, flattening turns a genuine 8.5 px transition into 0.0 px.

    Dropping the correction is safe because every profile below is an angular
    median over a full 360 degrees, which cancels a linear illumination
    gradient exactly: opposite angles contribute equal and opposite deviations.
    """
    g = gray.copy()
    if "_scale" in os.path.basename(path).lower():
        h = g.shape[0]
        g[int(0.88 * h):, :] = int(np.median(g))     # burnt-in 0.50 mm bar
    return g.astype(np.float32)


def _wall_radius(cap, angs):
    """Outer radius per angle, resampled from the traced contour."""
    a = np.arctan2(cap.contour[:, 1] - cap.cy, cap.contour[:, 0] - cap.cx)
    r = np.hypot(cap.contour[:, 0] - cap.cx, cap.contour[:, 1] - cap.cy)
    o = np.argsort(a)
    return np.interp(angs, a[o], r[o], period=2 * np.pi)


def _sample(img, cx, cy, angs, radii):
    """Bilinear polar sample; out-of-frame positions come back as NaN."""
    H, W = img.shape
    XS = cx + np.cos(angs)[:, None] * radii
    YS = cy + np.sin(angs)[:, None] * radii
    inb = (XS >= 0) & (XS < W - 1) & (YS >= 0) & (YS < H - 1)
    V = map_coordinates(img, [YS.ravel(), XS.ravel()], order=1,
                        mode="nearest").reshape(XS.shape)
    V[~inb] = np.nan
    return V


# --------------------------------------------------------------------------- #
# Pass 1 -- where is the inner edge?
# --------------------------------------------------------------------------- #
def _sector_candidates(img, cap, angs, rout):
    """Per 5 deg sector: radius of the sharpest inward-darkening edge.

    Averaging ~20 neighbouring rays before differentiating raises SNR by 4-5x,
    which is what makes the faint membranes measurable at all.  Over 5 degrees
    the wall radius moves well under a pixel, so the average does not itself
    blur the edge.
    """
    R = cap.mean_radius
    margin = _px(WALL_MARGIN, R)
    rs = np.arange(R_LO * R, rout.max() - margin, DR)
    if rs.size < 20:
        return None, None, None
    V = _sample(img, cap.cx, cap.cy, angs, rs)
    V[rs[None, :] > (rout[:, None] - margin)] = np.nan   # per-angle wall cut

    per = max(1, int(round(SECTOR_DEG / 360.0 * len(angs))))
    n_sec = len(angs) // per
    sec_ang = np.array([angs[i * per:(i + 1) * per].mean() for i in range(n_sec)])
    cand = np.full(n_sec, np.nan)
    guard = int(np.ceil(3 * SIGMA_G / DR))
    for k in range(n_sec):
        p = np.nanmean(V[k * per:(k + 1) * per], axis=0)
        ok = np.isfinite(p)
        if ok.sum() < 20:
            continue
        q = np.interp(rs, rs[ok], p[ok])                 # gaps only
        _, d = _derivatives(q)
        d[~_erode1d(ok, guard)] = 0.0                    # never straddle a cut
        if d.max() <= 1e-9:
            continue
        cand[k] = rs[int(np.argmax(d))]                  # brighter outward
    return sec_ang, cand, rs


def _fit_circle(cx, cy, angs, radii, band):
    """Kasa fit with iterative outlier rejection, on explicitly given angles.

    ``pipeline._fit_center`` assumes its radii lie on a ``linspace(0, 2*pi)``
    grid; the sector angles here do not, and feeding them in would rotate the
    fitted centre.
    """
    px = cx + radii * np.cos(angs)
    py = cy + radii * np.sin(angs)
    keep = np.ones(len(px), bool)
    icx, icy, ir = cx, cy, float(np.median(radii))
    for _ in range(4):
        A = np.c_[2 * px[keep], 2 * py[keep], np.ones(keep.sum())]
        b = px[keep] ** 2 + py[keep] ** 2
        sol, *_ = np.linalg.lstsq(A, b, rcond=None)
        icx, icy, c = sol
        ir = float(np.sqrt(max(c + icx ** 2 + icy ** 2, 1e-9)))
        d = np.abs(np.hypot(px - icx, py - icy) - ir)
        nxt = d < band
        if nxt.sum() < 8:
            break
        keep = nxt
    return float(icx), float(icy), ir


def _guide_from_candidates(cap, sec_ang, cand, angs):
    """Robust circle through the sector candidates -> guide radius per angle.

    A real membrane is one circle; debris, bubbles and a touching neighbour's
    wall are not, so the fraction of sectors that survive the fit ("coverage")
    is reported as evidence in its own right.
    """
    R = cap.mean_radius
    band = _px(INLIER_BAND, R)
    good = np.isfinite(cand)
    if good.sum() < 12:
        return None, None, 0.0

    icx, icy, ir = _fit_circle(cap.cx, cap.cy, sec_ang[good], cand[good], band)

    # Guide measured from the *capsule* centre so every stage shares one polar
    # frame; solves |c + r*u - i| = ir for r.
    dx, dy = cap.cx - icx, cap.cy - icy
    b = dx * np.cos(angs) + dy * np.sin(angs)
    disc = b * b - (dx * dx + dy * dy - ir * ir)
    if ir <= 0.15 * R or ir > 1.05 * R or np.any(disc < 0):
        # No coherent ring: fall back to a plain circle at the median candidate
        # radius so the sharpness stage still gets a chance to speak.
        guide = np.full(len(angs), float(np.nanmedian(cand)))
        icx, icy = cap.cx, cap.cy
    else:
        guide = -b + np.sqrt(disc)

    gsec = np.interp(sec_ang, angs, guide, period=2 * np.pi)
    coverage = float(np.mean(np.abs(cand[good] - gsec[good]) <= band) *
                     good.mean())
    return guide, (float(icx), float(icy)), coverage


# --------------------------------------------------------------------------- #
# Pass 2 -- how sharp is that edge, and does it separate anything?
# --------------------------------------------------------------------------- #
def _aligned_profile(img, cap, angs, guide, rout):
    """Intensity as a function of signed distance from the guide.

    Re-sampling every ray around ``guide[theta]`` before combining removes the
    eccentricity smear entirely.  The combination is a *median* over angles, so
    a touching neighbour or a bubble occupying part of the ring cannot drag it.
    """
    R = cap.mean_radius
    W = _px(ALIGN_WIN, R)
    u = np.arange(-W, W + DR, DR)
    radii = guide[:, None] + u[None, :]
    V = _sample(img, cap.cx, cap.cy, angs, radii)
    V[radii > (rout[:, None] - _px(WALL_MARGIN, R))] = np.nan
    V[radii < R_LO * R] = np.nan
    with np.errstate(invalid="ignore"):
        A = np.nanmedian(V, axis=0)
    A[np.isfinite(V).sum(axis=0) < 0.25 * len(angs)] = np.nan
    return u, A


def _edge_width(u, A):
    """Locate the transition and measure how far it is spread out.

    ``width`` is the sigma of the underlying erf edge, recovered from the FWHM
    of the fine-derivative peak: the gradient of an erf edge of scale s probed
    at SIGMA_G is a Gaussian of sigma sqrt(s^2 + SIGMA_G^2).  FWHM-of-gradient
    is the right statistic for both shapes in this data -- a plain step (a dark
    core) and a thin dark line whose interior recovers afterwards, where a
    10-90%% rise time would measure nothing at all.
    """
    ok = np.isfinite(A)
    if ok.sum() < 20:
        return None
    q = np.interp(u, u[ok], A[ok])
    d, dsharp = _derivatives(q)

    core = np.abs(u) <= 0.6 * u.max()
    valid = core & (d > 0)                  # the edge must brighten outward
    if not valid.any():
        return None
    i = int(np.argmax(np.where(valid, dsharp, -np.inf)))
    peak = float(d[i])
    if peak <= 1e-9:
        return None

    half = 0.5 * peak                       # FWHM by walking out from the peak
    lo = i
    while lo > 0 and d[lo] > half:
        lo -= 1
    hi = i
    while hi < len(d) - 1 and d[hi] > half:
        hi += 1
    sig = ((hi - lo) * DR) / 2.3548
    return dict(width=float(np.sqrt(max(sig ** 2 - SIGMA_G ** 2, 0.0))),
                fwhm=float((hi - lo) * DR), peak=peak,
                sharp=float(dsharp[i]), u_edge=float(u[i]))


def _compartment_contrast(img, cap, angs, rout, r_edge):
    """Weber contrast between the shell band and the core band.

    Read over a wide baseline on either side of the membrane, because an intact
    membrane separates two optical compartments while a dissolved one leaves
    fringes that are locally sharp but separate nothing.  Normalising by the
    shell level makes the number exposure-independent.
    """
    R = cap.mean_radius
    margin = _px(WALL_MARGIN, R)
    gap = _px(BASELINE_GAP, R)
    rs = np.arange(R_LO * R, rout.max() - margin, DR)
    V = _sample(img, cap.cx, cap.cy, angs, rs)
    V[rs[None, :] > (rout[:, None] - margin)] = np.nan
    with np.errstate(invalid="ignore"):
        prof = np.nanmedian(V, axis=0)

    r_wall = float(np.median(rout)) - margin
    core_m = (rs >= R_LO * R) & (rs <= r_edge - gap)
    shell_m = (rs >= r_edge + gap) & (rs <= r_wall)
    if shell_m.sum() < 10:                  # membrane sits against the wall
        shell_m = (rs > r_edge) & (rs <= r_wall)
    if core_m.sum() < 10 or shell_m.sum() < 5:
        # No shell band left to compare against, so no evidence of two
        # compartments -- report the dissolved sentinel, not a neutral zero.
        return DEGENERATE["contrast"], np.nan, np.nan
    with np.errstate(invalid="ignore"):
        core = float(np.nanmedian(prof[core_m]))
        shell = float(np.nanmedian(prof[shell_m]))
    if not (np.isfinite(core) and np.isfinite(shell)) or shell <= 1e-6:
        return DEGENERATE["contrast"], core, shell
    return float((shell - core) / shell), core, shell


# --------------------------------------------------------------------------- #
# Pass 3 -- the pixel-precise inner contour
# --------------------------------------------------------------------------- #
def _trace_inner(img, cap, angs, guide, rout):
    """Free-form inner boundary: per-ray sub-pixel gradient maximum inside a
    narrow band around the guide.  Radii are used RAW -- no Fourier or any
    other smoothing -- so the contour follows the real membrane pixel by pixel,
    exactly as ``pipeline.refine_boundary`` does for the outer wall."""
    R = cap.mean_radius
    band = _px(TRACE_BAND, R)
    step = 0.25
    u = np.arange(-band, band + step, step)
    radii = guide[:, None] + u[None, :]
    V = _sample(img, cap.cx, cap.cy, angs, radii)
    V[radii > (rout[:, None] - _px(WALL_MARGIN, R))] = np.nan

    F = _row_fill(V)
    D = (gaussian_filter1d(F, SIGMA_G / step, order=1, axis=1) -
         gaussian_filter1d(F, SIGMA_BG / step, order=1, axis=1)) / step
    D[~np.isfinite(V)] = -np.inf

    radial = np.full(len(angs), np.nan)
    strength = np.zeros(len(angs))
    for k in range(len(angs)):
        d = D[k]
        if not np.isfinite(d).any() or np.nanmax(d) <= 0:
            continue
        i = int(np.nanargmax(d))
        off = 0.0
        if 0 < i < len(u) - 1 and np.isfinite(d[i - 1]) and np.isfinite(d[i + 1]):
            a, b, c = d[i - 1], d[i], d[i + 1]
            den = a - 2 * b + c
            off = float(np.clip(0.5 * (a - c) / den, -1, 1)) if abs(den) > 1e-9 else 0.0
        radial[k] = guide[k] + u[i] + off * step
        strength[k] = float(d[i])

    # Drop rays that carry no real edge, and single-ray spikes where the argmax
    # jumped to a neighbouring feature.  A genuine irregularity varies smoothly
    # with angle and survives both tests; the surviving radii are then used RAW.
    ref = np.median(strength[strength > 0]) if (strength > 0).any() else 0.0
    radial[strength < 0.30 * ref] = np.nan
    ok = np.isfinite(radial)
    if ok.sum() >= 24:
        local = _circular_median(radial, win=15)
        dev = np.abs(radial - local)
        mad = np.nanmedian(dev[ok])
        radial[dev > max(2.0, 4.0 * mad)] = np.nan

    filled = _fill_circular(radial)
    if filled is None:
        return None, 0.0
    xs = cap.cx + filled * np.cos(angs)
    ys = cap.cy + filled * np.sin(angs)
    return (np.stack([xs, ys], 1).astype(np.float32),
            float(np.isfinite(radial).mean()))


def _circular_median(r, win=15):
    """Running median over a wrap-around window; a reference for spike
    rejection only -- it never reaches the output contour."""
    n = len(r)
    pad = np.concatenate([r[-win:], r, r[:win]])
    out = np.empty(n)
    with np.errstate(invalid="ignore"):
        for k in range(n):
            seg = pad[k + win - win // 2: k + win + win // 2 + 1]
            out[k] = np.nanmedian(seg) if np.isfinite(seg).any() else np.nan
    return out


# --------------------------------------------------------------------------- #
# Public entry points
# --------------------------------------------------------------------------- #
def measure(img, cap):
    """Per-capsule membrane features, no thresholding.

    ``img`` comes from :func:`prepare_gray`.  A capsule that cannot be measured
    gets the ``DEGENERATE`` feature set rather than ``None``: a capsule the
    method cannot read is a capsule whose membrane it cannot vouch for, and it
    must still be classified, never silently dropped.  Kept separate from
    :func:`analyze` so calibration can run the expensive part once and sweep
    thresholds afterwards.
    """
    R = cap.mean_radius
    angs = np.linspace(0.0, 2 * np.pi, N_ANG, endpoint=False)
    rout = _wall_radius(cap, angs)
    base = dict(DEGENERATE, R=float(R), _angs=angs, _rout=rout,
                _guide=None, _icenter=None)
    if R < MIN_RADIUS:
        return base

    sec_ang, cand, _ = _sector_candidates(img, cap, angs, rout)
    if sec_ang is None:
        return base
    guide, icenter, coverage = _guide_from_candidates(cap, sec_ang, cand, angs)
    if guide is None:
        return base
    base.update(coverage=coverage, _guide=guide, _icenter=icenter)

    u, A = _aligned_profile(img, cap, angs, guide, rout)
    e = _edge_width(u, A)
    if e is None:
        return base

    r_edge = float(np.median(guide) + e["u_edge"])
    contrast, core, shell = _compartment_contrast(img, cap, angs, rout, r_edge)
    base.update(width=e["width"], fwhm=e["fwhm"], peak=e["peak"],
                sharp=e["sharp"], contrast=contrast, core=core, shell=shell,
                r_edge=r_edge, r_frac=r_edge / R)
    return base


# Calibrated on the 21 + 21 labelled images; see calibrate_membrane.py.
# Both sit at the centre of their class gap: width 6.28 | 7.15 | 8.01 px,
# contrast -0.024 | 0.096 | 0.217.  42/42 in-sample and leave-one-out.
THRESH = dict(width=7.146, contrast=0.096)

# Fixed normaliser for the contrast margin.  It must NOT be the threshold
# itself: the threshold sits near zero, and dividing by it would make the
# reported margin explode and would let a threshold search inflate its own
# objective by driving the threshold towards zero.  0.25 is the scale of the
# observed gap between the classes, so a score of 1.0 means "a full class gap
# clear of the boundary" for either feature.
CONTRAST_SCALE = 0.25

# Validity precondition, NOT a calibrated feature.  ``coverage`` is the fraction
# of 5 deg sectors that agree on one circle; if they do not agree there is no
# ring, and ``width`` and ``contrast`` are then being read at a meaningless
# radius -- so no verdict of "sharp" from such a guide is defensible, whatever
# the labelled data happens to say.  It exists because capsules cut by the frame
# can produce a confident-looking measurement off a 17%-supported guide.  Every
# capsule in the calibration set except one already-dissolved image sits above
# 0.85, so this changes nothing there; it only refuses the unreadable ones.
MIN_COVERAGE = 0.35


def decide(f, th=None):
    """Score > 0 means "sharp"; the magnitude is how clear of the boundary.

    Every gate must hold, so the score is the smallest margin: ``width``
    relative to its own threshold, ``contrast`` relative to a fixed scale, and
    the coverage precondition above.  A capsule scoring 0.4 clears whichever
    gate binds it by 40%.
    """
    th = th or THRESH
    return float(min(1.0 - f["width"] / th["width"],
                     (f["contrast"] - th["contrast"]) / CONTRAST_SCALE,
                     (f["coverage"] - MIN_COVERAGE) / MIN_COVERAGE))


def analyze(gray, cap, path="", th=None, trace=True):
    """Classify one capsule's membrane; segment the inner circle when sharp.

    ``gray`` is the raw grayscale image -- do NOT pass ``pipeline.preprocess``
    output, see :func:`prepare_gray`.
    """
    img = prepare_gray(gray, path)
    f = measure(img, cap)
    score = decide(f, th)
    pub = {k: v for k, v in f.items() if not k.startswith("_")}
    contour = None
    if score > 0 and trace and f["_guide"] is not None:
        contour, support = _trace_inner(img, cap, f["_angs"], f["_guide"],
                                        f["_rout"])
        pub["trace_support"] = support
    return Membrane("sharp" if score > 0 else "dissolved", score, pub,
                    contour, f["_guide"], f["_icenter"])


def inner_mask(shape, membranes):
    """uint8 mask of every segmented inner circle (1 = inside a membrane)."""
    m = np.zeros(shape[:2], np.uint8)
    for mem in membranes:
        if mem.contour is not None:
            cv2.fillPoly(m, [np.round(mem.contour).astype(np.int32)], 1)
    return m


# --------------------------------------------------------------------------- #
# Adapter: drive this module from the polygons the distilled U-Net produces
# --------------------------------------------------------------------------- #
@dataclass
class PolygonCapsule:
    """The slice of the upstream `Capsule` this module actually reads.

    Checked against the source: `membrane.py` touches exactly `cx`, `cy`,
    `contour` and `mean_radius` and nothing else, so a capsule from any
    detector can drive it. That is what lets this repo keep its U-Net capsule
    contours and add only the membrane stage on top, rather than adopting the
    archive's own outer-wall detector.
    """

    cx: float
    cy: float
    contour: np.ndarray
    mean_radius: float


def _circle_centre(contour):
    """Least-squares circle centre of a closed contour (algebraic / Kasa fit).

    NOT the mean of the vertices, and NOT the area centroid. The membrane stage
    unwraps the image into polar coordinates about this point and searches a
    band at a fraction of the capsule radius, so what it needs is the centre the
    BOUNDARY is concentric about.

    A U-Net contour samples its outline unevenly — dense along some arcs, sparse
    along others — so the vertex mean is dragged toward the densely sampled side
    and the area centroid toward the bulges. Neither is the centre a RING is
    concentric about, which is what a polar unwrap needs; the least-squares
    circle centre is exactly that, by construction.

    Measured on real production capsules the three agree closely (the model's
    outlines are near-circular), so this is a correctness argument rather than a
    measured improvement — do not expect it to move a verdict.

    Solves `x^2 + y^2 + D x + E y + F = 0` by linear least squares, which is
    closed-form and needs no starting guess.
    """
    x = contour[:, 0].astype(np.float64)
    y = contour[:, 1].astype(np.float64)
    A = np.column_stack([x, y, np.ones_like(x)])
    b = -(x ** 2 + y ** 2)
    try:
        sol, *_ = np.linalg.lstsq(A, b, rcond=None)
    except np.linalg.LinAlgError:
        return float(x.mean()), float(y.mean())
    cx = -sol[0] / 2.0
    cy = -sol[1] / 2.0
    if not (np.isfinite(cx) and np.isfinite(cy)):
        return float(x.mean()), float(y.mean())
    return float(cx), float(cy)


def capsule_from_polygon(points):
    """Build a `PolygonCapsule` from a stored polygon's `[{x, y}, ...]`.

    The centre comes from a least-squares circle fit — see `_circle_centre` for
    why the obvious choices are both wrong here.

    Returns None for anything that cannot define a ring — fewer than three
    vertices, or a degenerate zero-radius outline — so the caller skips it
    rather than measuring noise.
    """
    if points is None or len(points) < 3:
        return None
    contour = np.asarray(
        [[float(p["x"]), float(p["y"])] for p in points], dtype=np.float32
    )
    # Reject a contour with no extent BEFORE fitting. The least-squares circle
    # is singular on coincident points and `lstsq` answers with a minimum-norm
    # solution rather than raising — a centre somewhere off in the plane, from
    # which the coincident points have a perfectly healthy-looking non-zero
    # radius. The zero-radius guard below would then pass and a degenerate
    # outline would be measured as a capsule.
    span = contour.max(axis=0) - contour.min(axis=0)
    if not np.all(np.isfinite(span)) or span.max() <= 0:
        return None
    cx, cy = _circle_centre(contour)
    radii = np.hypot(contour[:, 0] - cx, contour[:, 1] - cy)
    mean_radius = float(radii.mean())
    if not np.isfinite(mean_radius) or mean_radius <= 0:
        return None
    return PolygonCapsule(cx=cx, cy=cy, contour=contour, mean_radius=mean_radius)


def membrane_polygon_for(gray, points, th=None):
    """Membrane verdict + contour for ONE capsule outlined by `points`.

    Returns `(state, score, features, membrane_points_or_None)` where
    `membrane_points` is `[{x, y}, ...]` in the same pixel coordinates as the
    input — ready to be stored beside the capsule as another polygon.

    A capsule too small to read, or one the method refuses, comes back
    `("dissolved", score, features, None)`. That is a refusal, not a
    fabrication: the upstream design deliberately produces NO inner contour
    rather than a guessed circle, and this repo keeps that.
    """
    cap = capsule_from_polygon(points)
    if cap is None:
        return "dissolved", 0.0, dict(DEGENERATE), None
    m = analyze(gray, cap, th=th)
    if m.contour is None or len(m.contour) < 3:
        return m.state, m.score, m.features, None
    membrane_points = [
        {"x": float(x), "y": float(y)} for x, y in m.contour
    ]
    return m.state, m.score, m.features, membrane_points

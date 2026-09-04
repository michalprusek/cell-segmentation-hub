"""Membrane state per microcapsule + inner-circle segmentation.

VENDORED, 2026-09-03, from the `microcapsule-membrane` archive
(`microcaps/membrane.py`), with three deliberate changes and no others:

  - The archive's `microcaps/pipeline.py` — its own Hough + overlap-suppression
    outer-wall detector — is NOT vendored: this repo already has the capsule
    contours from the distilled U-Net, and that detector is documented upstream
    as returning a single capsule per image, which would be a downgrade here.
  - `analyze_image` (which called that detector) is dropped; `analyze` is the
    entry point, driven by `capsule_from_polygon` below.
  - `_trace_inner` traces the inner contour by dynamic programming instead of
    an independent per-ray argmax. This is the one place the method's OUTPUT
    differs from upstream, and it is deliberate — see that function. Upstream's
    `_fill_circular` came over with the old tracer and left with it; nothing
    else here needed it.

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
TRACE_BAND = (0.10, 20.0)   # search band for the inner contour (pass 1)
TRACE_STEP_MAX = 0.5        # coarsest radial sampling of that search
SHAPE_PRIOR = 2.0           # pull toward a circle where the edge is weak
SHAPE_PRIOR_GATE = 0.65     # 'weak' means below this fraction of the strong edges
BASELINE_GAP = (0.05, 15.0) # keep the compartment medians this clear of the edge
SIGMA_G = 1.5               # px, fine derivative scale (edge localisation)
SIGMA_BG = 8.0              # px, coarse scale subtracted to reject broad ramps
MIN_RADIUS = 40.0           # px, below this a capsule is not worth measuring
TRACE_SLOPE = 0.23          # max radial px per arc px for the inner contour
TRACE_PENALTY = 0.7         # movement cost, as a fraction of the median edge
LEVEL_WINDOW = (0.012, 4.0) # pass-2 search window around the pass-1 contour
LEVEL_GAP = (0.017, 6.0)    # keep the local core/shell medians off the edge
LEVEL_BASELINE = (0.028, 10.0)  # thickness of each local baseline band
_NEG = -1e18                # DP stand-in for "impossible", safe to add up

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
def _relax(cost, step_cost, offs, want_arg=False):
    """One DP transition: best predecessor for every state, over `offs`.

    Works on a 1-D cost vector or a stack of them (the start-state axis rides
    in front), which is what lets stage 1 and stage 2 below share the code.
    """
    best = np.full_like(cost, _NEG)
    arg = np.zeros(cost.shape, np.int8) if want_arg else None
    for j, o in enumerate(offs):
        if o == 0:
            sh = cost
        else:
            sh = np.full_like(cost, _NEG)
            if o > 0:
                sh[..., o:] = cost[..., :-o]
            else:
                sh[..., :o] = cost[..., -o:]
        v = sh - step_cost[j]
        m = v > best
        best[m] = v[m]
        if arg is not None:
            arg[m] = o
    return best, arg


def _trace_path(E, smax, lam):
    """Best CLOSED path through the polar response `E` (rays x radial states).

    Maximises total edge evidence minus `lam` per state of ray-to-ray radial
    movement, with movement capped at `smax` states. Exact: every start state
    is evaluated, so the answer is the global optimum rather than whatever a
    greedy or single-anchor pass happens to find -- which matters, because the
    whole point is to choose between two nearly-tied concentric edges, and an
    anchored two-pass variant measurably picked the wrong one (a 19 px error on
    a real capsule).

    Done in two stages purely to keep memory O(S^2 + n*S) instead of O(n*S^2):
    stage 1 carries costs only, to learn WHICH start state wins; stage 2 replays
    that one start with a backtrack table. Same answer, ~S times less memory --
    at 2048px capsules the one-stage form wanted hundreds of MB.
    """
    n, S = E.shape
    offs = np.arange(-smax, smax + 1)
    step_cost = lam * np.abs(offs)

    # Stage 1: cost[b, s] = best score of a path that began at state b and has
    # reached state s. No backtrack table.
    cost = np.full((S, S), _NEG)
    cost[np.arange(S), np.arange(S)] = E[0]
    for k in range(1, n):
        cost, _ = _relax(cost, step_cost, offs)
        cost += E[k][None, :]

    # Close the ring: a path that began at b must step back onto b.
    idx = np.arange(S)
    total = np.full(S, _NEG)
    for j, o in enumerate(offs):
        e = idx - o
        ok = (e >= 0) & (e < S)
        v = np.where(ok, cost[idx, np.clip(e, 0, S - 1)] - step_cost[j], _NEG)
        m = v > total
        total[m] = v[m]
    if not np.isfinite(total).any() or total.max() <= _NEG / 2:
        return None
    b = int(np.argmax(total))

    # Stage 2: replay start `b`, this time recording the transitions.
    cost = np.full(S, _NEG)
    cost[b] = E[0][b]
    back = np.zeros((n, S), np.int8)
    for k in range(1, n):
        cost, back[k] = _relax(cost, step_cost, offs, want_arg=True)
        cost += E[k]
    end, best = b, _NEG
    for j, o in enumerate(offs):
        e = b - o
        if 0 <= e < S and cost[e] - step_cost[j] > best:
            best, end = cost[e] - step_cost[j], e
    path = np.empty(n, int)
    path[n - 1] = end
    for k in range(n - 1, 0, -1):
        path[k - 1] = path[k] - back[k, path[k]]
    return path


def _snap_to_level(img, cap, angs, r0, rout):
    """Move the contour onto a LOCAL intensity level set -- an isoline.

    Pass 1 maximises edge evidence, which answers "which boundary" but not
    "where exactly on it". The gradient maximum is only at a fixed intensity
    for a symmetric edge; where the transition is asymmetric, or where the
    movement penalty outweighs a weak stretch of evidence, the path leaves the
    boundary and cuts the corner -- reported 2026-09-04 as the contour not
    following the intensity contour and scooping a piece out. Measured on the
    real capsule that prompted it, the pass-1 path ran 7.9 px inside the
    strongest edge over a 23-ray stretch.

    A level set cannot cut a corner: it is defined by the image rather than by
    a smoothness prior, so it has no shortcut to take.

    The level is LOCAL -- the midpoint between the core-side and shell-side
    medians measured either side of THIS ray's pass-1 radius. It has to be:
    measured around the circumference of real capsules the core and shell
    levels swing by 11-40% of the contrast (shading), so one global level would
    sit at a different height on the edge at every angle, and where the swing
    exceeds the contrast it would not cross the profile at all.

    The search is a second `_trace_path` rather than "the nearest crossing on
    each ray", because nearest-crossing is per-ray-independent and brings the
    stepping straight back: measured, it took the worst ray-to-ray jump from
    0.52 px to 13.69 px. The cost is normalised by the local step height so it
    is comparable across a shaded capsule.

    KNOWN BIAS, measured and accepted. The local level is only as good as the
    two baseline medians, so structure sitting just outside the membrane pulls
    it: on a synthetic edge with a trough of 40% of the step height 6 px out,
    this places the contour 0.30 px worse than pass 1 alone. It is a sub-pixel
    penalty in a case built to provoke it, against 1.8 px recovered at a real
    dent, and all eleven production membranes improved -- but if a capsule type
    ever shows a systematic ring just outside the membrane, re-measure before
    trusting the placement.

    Returns `r0` unchanged if no level can be estimated -- a refinement that
    cannot be computed must not move the contour.
    """
    R = cap.mean_radius
    half = _px(LEVEL_WINDOW, R)
    gap = _px(LEVEL_GAP, R)
    thick = _px(LEVEL_BASELINE, R)

    inner = np.arange(-gap - thick, -gap, 1.0)
    outer = np.arange(gap, gap + thick, 1.0)
    if inner.size < 2 or outer.size < 2:
        return r0
    with np.errstate(invalid="ignore"):
        core = np.nanmedian(
            _sample(img, cap.cx, cap.cy, angs, r0[:, None] + inner[None, :]),
            axis=1)
        shell = np.nanmedian(
            _sample(img, cap.cx, cap.cy, angs, r0[:, None] + outer[None, :]),
            axis=1)
    level = 0.5 * (core + shell)
    height = np.abs(shell - core)
    if not np.isfinite(level).any():
        return r0

    step = 0.25
    s = np.arange(-half, half + step, step)
    radii = r0[:, None] + s[None, :]
    V = _sample(img, cap.cx, cap.cy, angs, radii)
    V[radii > (rout[:, None] - _px(WALL_MARGIN, R))] = np.nan

    with np.errstate(invalid="ignore", divide="ignore"):
        dev = np.abs(V - level[:, None]) / np.where(
            height < 1e-6, np.nan, height)[:, None]
    E = np.where(np.isfinite(dev), -dev, _NEG)
    if not (E > _NEG / 2).any():
        return r0

    arc = 2 * np.pi * float(np.mean(r0)) / max(len(angs), 1)
    smax = int(np.clip(round(TRACE_SLOPE * arc / step), 1, len(s) - 1))
    # The cost is already in units of the local step height, so the movement
    # price is a fraction of that height rather than of an edge response.
    path = _trace_path(E, smax, TRACE_PENALTY * 0.05 / smax)
    if path is None:
        return r0
    return r0 + s[path]


def _fit_circle_radius(cap, angs, radial, trust=None):
    """Robust circle through a traced path, expressed back as r(theta) in the
    capsule's polar frame.

    `trust` is an optional per-ray weight in [0, 1]; rays below half of its
    mean are dropped before fitting. That matters more than the iterative
    trimming: the stretches this circle is meant to correct are CONTIGUOUS
    arcs, and a contiguous arc pulled inward is indistinguishable from a
    circle whose centre has moved, so least squares absorbs it into the centre
    instead of flagging it. Fitted to a ring with a fifth of its circumference
    dragged 25 px in, the untrusted fit returns 195 rather than 200; selecting
    on the same evidence that gates the pull returns 200.

    Returns None rather than a guess when no circle can be defined -- a
    degenerate path makes the normal equations singular, and `lstsq` answers
    with a minimum-norm solution rather than raising.
    """
    x = cap.cx + radial * np.cos(angs)
    y = cap.cy + radial * np.sin(angs)

    keep = np.ones(len(angs), bool)
    if trust is not None and np.isfinite(trust).any():
        level = float(np.nanmean(trust))
        if level > 1e-9:
            strong = trust >= 0.5 * level
            if strong.sum() >= 30:
                keep = strong

    # No extent means no circle. Guard before fitting, not after: the radius
    # that comes back from a singular fit looks perfectly healthy.
    if (np.ptp(x[keep]) <= 1e-6) or (np.ptp(y[keep]) <= 1e-6):
        return None

    cx = cy = rad = None
    for _ in range(6):
        if keep.sum() < 30:
            return None
        A = np.c_[2 * x[keep], 2 * y[keep], np.ones(int(keep.sum()))]
        b = x[keep] ** 2 + y[keep] ** 2
        sol, *_ = np.linalg.lstsq(A, b, rcond=None)
        cx, cy = float(sol[0]), float(sol[1])
        inside = sol[2] + cx * cx + cy * cy
        if not np.isfinite(inside) or inside <= 1e-6:
            return None
        rad = float(np.sqrt(inside))
        res = np.hypot(x - cx, y - cy) - rad
        spread = 1.4826 * np.median(np.abs(res - np.median(res)))
        nxt = keep & (np.abs(res - np.median(res)) < max(2.0, 2.5 * spread))
        if nxt.sum() < 30 or np.array_equal(nxt, keep):
            break
        keep = nxt

    if rad is None or rad <= 1e-6:
        return None

    # Solve |c + r*u - i| = rad for r, so the circle is a radius per ray in the
    # same frame every other stage uses.
    dx, dy = cap.cx - cx, cap.cy - cy
    b = dx * np.cos(angs) + dy * np.sin(angs)
    disc = b * b - (dx * dx + dy * dy - rad * rad)
    if np.any(disc < 0):
        return None
    return -b + np.sqrt(disc)


def _trace_inner(img, cap, angs, guide, rout):
    """Inner boundary as ONE closed contour, by dynamic programming.

    Every ray offers several candidate edges inside the search band, and on a
    real capsule the membrane's two faces are near-concentric and nearly
    equal in strength. Choosing each ray's argmax INDEPENDENTLY -- which is
    what this did until 2026-09-03, and what `pipeline.refine_boundary` does
    for the outer wall -- therefore lets a 0.01 difference in edge response
    move the contour 16 px, and the result steps between the two faces in
    square notches. Measured on the eleven membranes in production at the
    time: 5 of 11 stepped, ray-to-ray jumps up to 19.7 px on a contour whose
    points are 2.2 px apart.

    So the rays are not independent any more: the contour is the single
    closed path of maximum total edge evidence, subject to a cap on how fast
    it may move radially from one ray to the next. Continuity is a property
    of the boundary being traced, not a cosmetic filter, so this is imposed
    during the search rather than smoothed on afterwards -- a low-pass over
    the stepped contour would have parked it BETWEEN the two faces, wrong
    everywhere instead of wrong in patches.

    It does not flatten the capsule into a circle: on the same eleven, the
    path keeps 97.5% of the evidence an unconstrained per-ray argmax could
    reach, against 44% for the best-fitting fixed radius.

    TWO TUNABLES HERE HAVE NON-OBVIOUS VALUES, both measured 2026-09-04.

    `TRACE_BAND` is 0.10R, not the 0.035R this shipped with. A bright-field
    capsule can show TWO near-parallel transitions 6-11 px apart on the side
    where the membrane is a broad ramp rather than a crisp step, and at 0.035R
    the inner one lay outside the search entirely on ~110 of 720 rays. Widening
    it is targeted, not a blanket loosening: measured over the eleven
    production membranes, 8 of them move by under 0.33 px (p95) and change
    their evidence retention by at most 0.2 points, while the three ambiguous
    ones gain 0.4-4.1 points. No capsule gets worse and the worst ray-to-ray
    jump is unchanged at 0.63 px. It cannot affect any VERDICT: `TRACE_BAND` is
    read only here, and this runs only after `decide` has already returned a
    positive score.

    The radial sampling is the movement cap itself (`TRACE_SLOPE * arc`,
    ~0.5 px at production radii), not the 0.25 px the placement pass uses.
    Since `_snap_to_level` took over placement this pass only has to CHOOSE
    the boundary, so it does not need sub-pixel sampling -- and at 0.10R a
    quarter-pixel grid costs 5.3x more, because the DP is quadratic in the
    number of radial states. Measured against that finer grid on all eleven:
    p95 difference 0.25 px, max 0.50 px, which the placement pass re-resolves.
    Deriving the step FROM the cap rather than fixing it keeps the cap
    magnification-independent: a fixed 0.5 px step would have made the cap
    0.5 px/ray whatever the capsule size, i.e. twice the intended slope at
    half the radius, and would have left `TRACE_SLOPE` inert over most of its
    range. `TRACE_STEP_MAX` and the SIGMA_G/3 floor together stop the grid
    coarsening past the point where the derivative can localise an edge.

    That path is then snapped onto the local intensity level set by
    `_snap_to_level` -- see there for why placing the contour is a separate
    question from choosing which boundary it is on.
    """
    R = cap.mean_radius
    band = _px(TRACE_BAND, R)

    # Sample the search at the movement cap itself. The cap is one state per
    # ray by construction then, so the grid is exactly as fine as the
    # constraint can use and no finer -- which is what keeps the wide band
    # affordable. Clamped below by SIGMA_G/3, since `SIGMA_G / step` is the
    # derivative scale in samples and a Gaussian narrower than ~3 samples
    # stops localising edges; on a capsule big enough to hit that clamp the
    # cap is carried by `smax` instead, so it stays the same physical slope.
    arc = 2 * np.pi * float(np.mean(guide)) / max(len(angs), 1)
    step = float(np.clip(TRACE_SLOPE * arc, 0.25, min(TRACE_STEP_MAX, SIGMA_G / 3)))
    u = np.arange(-band, band + step, step)
    radii = guide[:, None] + u[None, :]
    V = _sample(img, cap.cx, cap.cy, angs, radii)
    V[radii > (rout[:, None] - _px(WALL_MARGIN, R))] = np.nan

    F = _row_fill(V)
    D = (gaussian_filter1d(F, SIGMA_G / step, order=1, axis=1) -
         gaussian_filter1d(F, SIGMA_BG / step, order=1, axis=1)) / step
    D[~np.isfinite(V)] = np.nan

    finite = D[np.isfinite(D)]
    if finite.size == 0 or not (finite > 0).any():
        return None, 0.0
    ref = float(np.median(finite[finite > 0]))

    # The movement cap is a SHAPE constraint, so it is set per unit arc rather
    # than per ray: the rays get closer together on a smaller capsule, and a
    # fixed per-ray cap would silently tighten with magnification. 0.23 radial
    # px per arc px is ~0.5 px/ray at the ~250 px radii in production, which is
    # where cap saturation levels off (22% of rays pinned at 0.35 px/ray, 3.1%
    # at 0.5, 1.4% beyond) and before a looser cap starts letting the path
    # wander between faces again. Usually 1 state, by the choice of `step`
    # above; more only on a capsule large enough to hit the SIGMA_G clamp.
    #
    # The state count is an integer, so the cap can rarely be exactly
    # TRACE_SLOPE. Round UP unless that would only be chasing the clamp's
    # rounding (the 0.9 slack): a cap that comes out TIGHTER than intended
    # clips genuine shape, while one that comes out looser merely relaxes a
    # regulariser the evidence still has to argue against. Plain `round`
    # measured up to 29% tighter at some radii; this is never worse than 10%.
    smax = int(np.clip(np.ceil(0.9 * TRACE_SLOPE * arc / step), 1, len(u) - 1))
    lam = TRACE_PENALTY * ref / smax

    E = np.where(np.isfinite(D), D, _NEG)
    path = _trace_path(E, smax, lam)
    if path is None:
        return None, 0.0

    # A shape prior, applied ONLY where the image does not answer the question.
    #
    # On the arc where the membrane is a broad ramp rather than a step, the
    # radial profile has no edge at all -- measured on the capsule that
    # prompted this, intensity climbs monotonically from 65 to 150 over ~100 px
    # and the band-passed response is 1.2-1.8 against 4-6.7 in the sharp
    # sectors. The boundary is genuinely under-determined there, so the path
    # locks onto whatever ripple the ramp happens to carry and the contour dips
    # inward in patches. A microcapsule membrane is a closed shell, so the
    # missing constraint is that it is round.
    #
    # The pull is scaled by (1 - local peak / the capsule's own strong peaks),
    # so a ray with a proper edge is untouched and only the featureless ones
    # are drawn back. Measured over the eleven production membranes at
    # the shipped settings: the eight already-round ones move by at most
    # 0.14 px of circle residual, while the capsule that prompted this goes
    # from 5.03 px of non-circularity to 3.24 and the next two worst from 4.82
    # to 4.33 and 2.33 to 1.57. Nothing gains a ray-to-ray jump.
    #
    # The gate matters more than the weight, and it is what keeps this honest:
    # a genuinely non-circular membrane whose edge is sharp all the way round
    # is NOT rounded off, because none of its rays are weak enough to be
    # pulled. The 120 px out-of-round ellipse in the tests comes out at
    # 120.1 px at every gate from 0.35 to 0.80.
    if SHAPE_PRIOR > 0:
        peak = np.nanmax(np.where(np.isfinite(D), D, -np.inf), axis=1)
        finite_peak = peak[np.isfinite(peak)]
        # Fit the circle on the rays that carry a real edge, and pull the ones
        # that do not: one confidence signal, used for both halves.
        circle = _fit_circle_radius(cap, angs, guide + u[path],
                                    trust=np.where(np.isfinite(peak), peak, 0.0))
        if circle is not None:
            if finite_peak.size:
                strong = float(np.percentile(finite_peak, 90))
                if strong > 1e-9:
                    # A GATE, not a ramp from 1.0. The penalty is linear in
                    # distance and the band is wide, so a small weight times a
                    # large excursion still swamps the evidence: with a plain
                    # (1 - peak/strong) this rounded a genuinely 120 px
                    # out-of-round ellipse down to a 66 px span, because rays
                    # a little below the 90th percentile still carried some
                    # pull. Nothing is pulled until its edge is weaker than
                    # SHAPE_PRIOR_GATE of the capsule's own strong ones.
                    weak = np.clip(
                        (SHAPE_PRIOR_GATE - peak / strong) / SHAPE_PRIOR_GATE,
                        0.0, 1.0)
                    pull = SHAPE_PRIOR * ref * weak
                    E2 = np.where(
                        np.isfinite(D),
                        D - pull[:, None] * np.abs(radii - circle[:, None]),
                        _NEG,
                    )
                    guided = _trace_path(E2, smax, lam)
                    if guided is not None:
                        path = guided

    # Sub-pixel: parabola through the chosen state and its neighbours.
    k = np.arange(len(angs))
    i = path
    off = np.zeros(len(angs))
    inner = (i > 0) & (i < len(u) - 1)
    if inner.any():
        kk, ii = k[inner], i[inner]
        a, b_, c = E[kk, ii - 1], E[kk, ii], E[kk, ii + 1]
        den = a - 2 * b_ + c
        ok = np.abs(den) > 1e-9
        good = np.isfinite(a) & np.isfinite(c) & (a > _NEG / 2) & (c > _NEG / 2)
        val = np.zeros(len(kk))
        sel = ok & good
        val[sel] = np.clip(0.5 * (a[sel] - c[sel]) / den[sel], -1, 1)
        off[inner] = val

    radial = guide + u[i] + off * step
    strength = E[k, i]
    support = float(np.mean(strength >= 0.30 * ref))

    # Pass 2: slide the contour onto the local intensity level set. Pass 1
    # chose the boundary; this places the contour on it. Kept as a separate
    # pass rather than folded into one cost, because the two terms answer
    # different questions and combining them would need a weight to tune --
    # this way each pass optimises one thing and there is nothing to balance.
    radial = _snap_to_level(img, cap, angs, radial, rout)

    xs = cap.cx + radial * np.cos(angs)
    ys = cap.cy + radial * np.sin(angs)
    return np.stack([xs, ys], 1).astype(np.float32), support


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

"""Instancer L+H: the decoder of the V16 model, transcribed from the research tree.

Where :mod:`instance.instancer_a` chains arcs with a junction cost and then links
free ends, this one scores every candidate link between arc ENDS with five hand
features and solves one global max-weight matching over the frame ("instancer L").
A crossing-hysteresis step ("H") first fills gaps in the foreground: pixels above
``hyst_t_lo`` near a junction are added only if they join at least two different
components of the mask at the model's cut.

The link score has no access to the image and no learned network. It is a logistic
fit on SYNTHETIC links only (``link_model`` in ``params_v16.json``, 52 894 links,
fitted once on 2026-10-06), because every learned decoder part tried against real
frames lost to it (see MODEL_CARD.md).

Source of record, in the microtubules repo: ``scripts/lpc/lpc_lib.py`` (``graph``,
``link_feats``, ``to_logit``), ``scripts/ult/l_dup.py`` (``match``, ``walk_all``) and
``scripts/ult/l_hyst2.py`` (``hmask``, the ``bridge`` variant), driven as in
``scripts/ult/l_bridge.py``. Do not "improve" any step here without re-measuring: the
declared numbers were read through exactly this sequence, and the gate that says
the two still agree is ``tests/test_microtubule_reference.py``.
"""
from __future__ import annotations

import networkx as nx
import numpy as np
from scipy import ndimage
from scipy.ndimage import map_coordinates
from scipy.spatial import cKDTree
from skimage.morphology import skeletonize

from instance.geometry import resample, turn_penalty, window_tangent
from instance.matching import ArmEnd, pair_cost
from instance.skeleton_graph import build_arc_graph

_K8 = np.array([[1, 1, 1], [1, 0, 1], [1, 1, 1]])
_S8 = np.ones((3, 3), int)


class TooManyArcs(ValueError):
    """The mask fell apart into more arcs than this decoder was ever measured on."""


def to_logit(prob: np.ndarray) -> np.ndarray:
    pc = np.clip(prob, 1e-6, 1 - 1e-6)
    return np.clip(np.log(pc / (1 - pc)), -12, 12).astype(np.float32)


def _near_junctions(lo: np.ndarray, radius: float) -> np.ndarray:
    """Pixels within ``radius`` of a junction of the skeleton of ``lo``."""
    sk = skeletonize(lo)
    junctions = sk & (ndimage.convolve(sk.astype(np.uint8), _K8, mode="constant") >= 3)
    if not junctions.any():
        return np.zeros_like(lo)
    return ndimage.distance_transform_edt(~junctions) <= radius


def hysteresis_mask(prob: np.ndarray, cut: float, t_lo: float, radius: float) -> np.ndarray:
    """``prob > cut`` plus the ``t_lo`` pieces near a junction that touch >= 2 of its components.

    A piece touching one component would only grow that component, and foreground
    grown that way costs precision on every block, so it is not added.
    """
    hi = prob > cut
    lo = prob > t_lo
    add = lo & _near_junctions(lo, radius) & ~hi
    pieces, n_pieces = ndimage.label(add, structure=_S8)
    if n_pieces == 0:
        return hi
    comps, _ = ndimage.label(hi, structure=_S8)
    h, w = hi.shape
    padded = np.pad(comps, 1)
    pairs = []
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dy == dx == 0:
                continue
            shifted = padded[1 + dy:1 + dy + h, 1 + dx:1 + dx + w]
            touching = (pieces > 0) & (shifted > 0)
            pairs.append(np.stack([pieces[touching], shifted[touching]], 1))
    pairs = np.unique(np.concatenate(pairs, 0), axis=0)
    if not len(pairs):
        return hi
    ids, counts = np.unique(pairs[:, 0], return_counts=True)
    return hi | np.isin(pieces, ids[counts >= 2])


def _arc_graph(mask: np.ndarray, params: dict) -> tuple[dict, dict]:
    """-> arcs ``{k: (n, 2) resampled at 1 px}``, arm ends ``{(k, "start"|"end"): ArmEnd}``."""
    g = build_arc_graph(mask, merge_radius=params["merge_radius"],
                        min_arc_len=params["min_arc_len"], bridge_max_len=params["bridge_max_len"])
    arcs = {k: resample(np.asarray(a, float), ds=1.0) for k, a in enumerate(g.arcs) if len(a) >= 2}
    arms = {}
    for k, a in arcs.items():
        for which in ("start", "end"):
            theta, kappa = window_tangent(a, which, params["window"])
            pos = np.asarray(a[0] if which == "start" else a[-1], float)
            arms[(k, which)] = ArmEnd(k, which, theta, kappa, pos)
    return arcs, arms


def _link_features(a: ArmEnd, b: ArmEnd, cost: float, logit: np.ndarray) -> tuple:
    """-> the five features of the link score."""
    gap = float(np.linalg.norm(a.pos - b.pos))
    n = max(2, int(round(gap)) + 1)
    bridge = a.pos[None] + (b.pos - a.pos)[None] * np.linspace(0, 1, n)[:, None]
    along = map_coordinates(logit, [bridge[:, 1], bridge[:, 0]], order=1, mode="nearest")
    angle = float(np.arctan2(*(b.pos - a.pos)[::-1])) if gap > 1e-6 else a.theta + np.pi
    turn = turn_penalty(a.theta + np.pi, angle) + turn_penalty(angle, b.theta)
    return (float(along.mean()), float(along.min()), gap, float(turn), float(cost))


def _match_ends(arms: dict, logit: np.ndarray, kappa_max: float, params: dict) -> dict:
    """Max-weight matching of arc ends over the links that score above 0; -> ``{end: partner}``."""
    model = params["link_model"]
    mu, sd, coef = (np.asarray(model[k], float) for k in ("mu", "sd", "coef"))
    intercept, reach = float(model["intercept"]), float(params["match_reach"])
    keys = list(arms)
    tree = cKDTree(np.array([arms[q].pos for q in keys]))
    g = nx.Graph()
    # sorted(): edge insertion order is what max_weight_matching breaks exact ties on.
    for i, j in sorted(tree.query_pairs(reach)):
        if keys[i][0] == keys[j][0]:
            continue
        cost, kappa_implied = pair_cost(arms[keys[i]], arms[keys[j]], w_theta=params["w_theta"],
                                        w_kappa=params["w_kappa"], w_gap=params["w_gap"],
                                        gap_floor=params["gap_floor"])
        if kappa_implied > kappa_max:
            continue                      # physically impossible: forbidden, not costly
        features = _link_features(arms[keys[i]], arms[keys[j]], cost, logit)
        if features[2] > reach:
            continue
        score = float(((np.asarray(features) - mu) / sd) @ coef + intercept)
        if score > 0:
            g.add_edge(keys[i], keys[j], weight=score)
    partner = {}
    for a, b in (nx.max_weight_matching(g) if g.number_of_edges() else ()):
        partner[a] = b
        partner[b] = a
    return partner


def _chains(arcs: dict, partner: dict) -> list[list[tuple[int, str]]]:
    """Walk the matched ends into chains of ``(arc, entered-at)``; open chains first, then cycles."""
    used, chains = set(), []

    def walk(k, entered):
        out = []
        while k not in used:
            used.add(k)
            out.append((k, entered))
            nxt = partner.get((k, "end" if entered == "start" else "start"))
            if nxt is None:
                break
            k, entered = nxt
        return out

    for k in arcs:
        for which in ("start", "end"):
            if (k, which) not in partner and k not in used:
                chains.append(walk(k, which))
    for k in arcs:
        if k not in used:
            chains.append(walk(k, "start"))
    return chains


def instance_lh(prob: np.ndarray, cut: float, kappa_max: float, params: dict) -> list[np.ndarray]:
    """Polylines ``(x=col, y=row)`` on the frame of ``prob`` (the 1.5x instancer frame).

    Raises :class:`TooManyArcs` beyond ``params["max_arcs"]``. The matching is cubic in the
    worst case and runs under the service's one inference lock, with no deadline, so a frame the
    model cannot read (a non-IRM channel, say) must not hold every other model for minutes.
    """
    mask = hysteresis_mask(prob, cut, float(params["hyst_t_lo"]), float(params["hyst_radius"]))
    arcs, arms = _arc_graph(mask, params)
    if not arcs:
        return []
    if len(arcs) > params["max_arcs"]:
        raise TooManyArcs(f"{len(arcs)} arcs, limit {params['max_arcs']}")
    partner = _match_ends(arms, to_logit(prob), kappa_max, params)
    polylines = []
    for chain in _chains(arcs, partner):
        p = np.concatenate([arcs[k] if entered == "start" else arcs[k][::-1] for k, entered in chain], 0)
        if float(np.linalg.norm(np.diff(p, axis=0), axis=1).sum()) >= params["min_length"]:
            polylines.append(p)
    return polylines

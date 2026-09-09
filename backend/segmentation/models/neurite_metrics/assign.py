"""Assign neurite branches to soma instances, and build one tree per cell.

The whole thing is a shortest-path problem on the LINE GRAPH of the skeleton
graph: every branch becomes two directed half-edges, and the cost of continuing
from one branch onto another is a property of that *pair*, not of the node they
share. That is what lets "go straight through this crossing" be expressible at
all -- and it is why assignment and topology come out of one Dijkstra run: the
predecessor pointers are the tree.
"""
from __future__ import annotations

import heapq
from dataclasses import dataclass, field

import numpy as np
from scipy import ndimage as ndi

from skeleton_graph import Branch, Graph

INF = float('inf')


@dataclass
class Params:
    tangent_fit_len: float = 2.0     # um
    theta_smooth: float = 40.0       # deg
    theta_gap: float = 50.0          # deg
    theta_pass: float = 30.0         # deg
    D_gap: float = 3.0               # um
    C_gap: float = 2.0               # um-equivalent
    C_branch: float = 1.0            # trunk -> child: a neurite branching
    C_adopt: float = 25.0            # child -> trunk: see transition_cost
    C_turn: float = 5.0
    C_cross: float = INF
    r_root_merge: float = 2.0        # um
    require_smooth_connection: bool = True   # see pipeline section 7
    C_contact: float = 0.0           # placeholder; contacts are gated, not priced
    min_neurite_len: float = 2.0     # um
    attach_radius: float = 1.5       # um -- node counted as touching a soma


# ----------------------------------------------------------------- geometry
def tangent(g: Graph, node: int, bid: int, fit_len_um: float) -> np.ndarray:
    """Unit vector leaving `node` along branch `bid` (row, col)."""
    path = g.path_from(bid, node)
    step = np.sqrt((np.diff(path, axis=0) ** 2).sum(1)) * g.um_per_px
    cum = np.concatenate([[0.0], np.cumsum(step)])
    k = int(np.searchsorted(cum, fit_len_um))
    k = max(1, min(k, len(path) - 1))
    v = path[k] - path[0]
    n = np.linalg.norm(v)
    return v / n if n else np.array([0.0, 0.0])


def _straightness(t1: np.ndarray, t2: np.ndarray) -> float:
    """1 when the two branches continue each other, -1 when they double back."""
    return float(-np.dot(t1, t2))


# ------------------------------------------------------------ junction types
def classify_junctions(g: Graph, p: Params) -> dict[int, dict]:
    thr = np.cos(np.deg2rad(p.theta_smooth))
    out: dict[int, dict] = {}
    for n, bids in g.incident.items():
        d = len(bids)
        if d < 3:
            continue
        t = {b: tangent(g, n, b, p.tangent_fit_len) for b in bids}
        best: list[tuple[float, int, int]] = []
        for i in range(d):
            for j in range(i + 1, d):
                best.append((_straightness(t[bids[i]], t[bids[j]]), bids[i], bids[j]))
        best.sort(reverse=True)

        pairs, used = [], set()
        for s, a, b in best:
            if a in used or b in used or s < thr:
                continue
            pairs.append((a, b))
            used.update((a, b))

        if d == 4 and len(pairs) == 2:
            kind = 'crossing'
        elif d == 3 and len(pairs) == 1:
            kind = 'branch'
        else:
            kind = 'ambiguous'
        out[n] = dict(kind=kind, pairs=pairs, tangents=t)
    return out


def transition_cost(node: int, b_in: int, b_out: int, jt: dict, p: Params) -> float:
    info = jt.get(node)
    if info is None:                       # degree <= 2: nothing to decide
        return 0.0
    paired = any({b_in, b_out} == set(pr) for pr in info['pairs'])
    if info['kind'] == 'crossing':
        return 0.0 if paired else p.C_cross
    if info['kind'] == 'branch':
        if paired:
            return 0.0
        in_pair = any(b_in in pr for pr in info['pairs'])
        # Direction matters at a branch point, and symmetric pricing is what let
        # a side stem steal a neighbour's neurite.
        #
        #   trunk -> child   the cell's own neurite forking off      C_branch
        #   child -> trunk   ADOPTING a neurite that runs straight   C_adopt
        #                    past this junction
        #
        # A T-contact (A's neurite passes B's short stem) and a Y-branch are the
        # same local geometry, so nothing distinguishes them at the junction.
        # But the two DIRECTIONS through it are not equally likely: a cell whose
        # own process forks into two collinear children, with the parent as the
        # odd one out, is geometrically odd, whereas a stem touching a passing
        # neurite is the commonest thing in a dense culture. Measured before
        # this: B's 12.6 um stem beat A's 26 um trunk and took the distal half
        # of A's neurite, because C_branch = 1.0 um is noise on a path-length
        # Voronoi.
        return p.C_branch if in_pair else p.C_adopt
    t = info['tangents']
    return p.C_turn * (1.0 - _straightness(t[b_in], t[b_out])) / 2.0


# ------------------------------------------------------------------ somas
def attach_somas(g: Graph, soma_inst: np.ndarray, p: Params,
                 soma_ok: set[int] | None = None,
                 neurite_mask: np.ndarray | None = None) -> dict[int, int]:
    """node id -> soma id, for endpoint nodes lying on or beside a soma.

    The node is attached to the NEAREST allowed instance. The previous version
    used `ndi.grey_dilation` on the label image, which is a maximum filter: it
    returned the HIGHEST-NUMBERED soma in the window, not the nearest, so an
    endpoint sitting on soma 3's rim was attached to soma 7 if soma 7 was
    anywhere within the radius -- and the whole tree rooted there went to the
    wrong cell. Labels come from `ndi.label` in raster order, so it was not even
    a consistent bias; it flipped with the orientation of the acquisition.

    `soma_ok` restricts which instances may OWN neurites. Roughly half the
    expert's soma polygons are growth cones or fragments; a growth cone must not
    act as a source, because a neurite running into its own growth cone would
    then be reported as a connection between two cells and have half its length
    credited to the cone. Excluded instances still occupy their pixels -- the
    neurite simply terminates there, which is what a growth cone is.
    """
    # VENDOR EDIT (5 of 5) -- and the ONLY one that changes a result. The other
    # four are environmental (paths, imports, device). A re-sync must decide
    # about this one consciously; it is described in `__init__.py`.
    #
    # WHAT WAS WRONG. `attach_radius` (1.5 um) is documented as "node counted as
    # touching a soma", but it was measured from the SKELETON NODE, and the
    # skeleton is the medial axis -- its endpoint sits one local half-width
    # inside the neurite by construction. Add the rasterisation seam (`semantic`
    # gives soma priority on overlap, so the two masks are never adjacent, there
    # is always >= 1 px of background between them) and the budget was mostly
    # spent before the gap was measured at all. Worse, the budget is an INTEGER
    # pixel radius, so at 0.65 um/px it is 2 px, not 2.31.
    #
    # Measured 2026-09-08 on production frame `neurite_practice_3.png`, 3
    # neurites drawn 1 px from their cells: node->soma 2.24 / 2.83 / 3.00 px
    # against local half-widths of 2.24 / 2.83 / 2.83 -- the distance IS the
    # half-width, to two decimals. Nothing attached, `assigned_fraction` 0.0,
    # 131.2 um of skeleton fully orphan. The user cannot draw their way out:
    # drawing further into the cell only erodes the neurite and moves its
    # skeleton back by the same amount.
    #
    # THE FIX IS TWO PARTS, AND ONLY THE SECOND IS A POLICY CHANGE.
    #
    # 1. Measure from the neurite's BOUNDARY, not from its skeleton: subtract
    #    the local half-width (the exact distance transform AT the node -- not
    #    `Branch.width_um / 2`, which is a median over the whole branch and
    #    overshot by up to 2x on the frame above, 4.39 px against a true 2.24)
    #    and the 1 px seam. This restores the documented meaning of
    #    `attach_radius`; it is a bug fix, so it carries no direction test.
    #
    # 2. Allow a REAL gap of up to `D_gap` beyond that, for a filament the
    #    segmentation broke off short of the cell -- but only for a leaf, and
    #    only when its outward tangent points AT the soma, `theta_gap`. These
    #    are not new constants: they are the same two `add_bridges` already uses
    #    to close a neurite-neurite gap, and the asymmetry of gating one and not
    #    the other was the defect. Without the direction test a thick neurite
    #    merely passing a foreign cell would be adopted by it.
    #
    # Part 1 applies to EVERY node — the medial-axis inset is a property of the
    # skeleton, not of a node's degree. Part 2 does not: only a leaf may bridge
    # a real gap, because a junction has more than one incident branch and so
    # no single outward tangent to gate it with.
    #
    # The original rule survives verbatim on one path only: a caller that
    # passes no `neurite_mask` gets the integer circular radius, unchanged.
    H, W = soma_inst.shape
    allowed = None if soma_ok is None else np.array(sorted(soma_ok), soma_inst.dtype)
    contact_px = p.attach_radius / g.um_per_px
    gap_px = p.D_gap / g.um_per_px
    cos_gap = np.cos(np.deg2rad(p.theta_gap))
    # Distance from any pixel to the nearest neurite BACKGROUND pixel, i.e. the
    # local half-width of the filament the node sits in. `None` keeps the old
    # behaviour for a caller that has no mask to give.
    half_width = (ndi.distance_transform_edt(neurite_mask)
                  if neurite_mask is not None else None)
    # 1 px of background always separates the two masks -- see above.
    SEAM_PX = 1.0

    att = {}
    for n, c in g.nodes.items():
        y, x = int(round(c[0])), int(round(c[1]))
        if not (0 <= y < H and 0 <= x < W):
            continue
        is_leaf = len(g.incident.get(n, ())) == 1
        if half_width is None:
            # No mask: the original rule, unchanged, down to the integer
            # rounding of the radius.
            inset = 0.0
            r = max(1, int(round(contact_px)))
        else:
            inset = float(half_width[y, x])
            # The window has to cover the widest rule that can fire here.
            reach = contact_px + inset + SEAM_PX + (gap_px if is_leaf else 0.0)
            r = max(1, int(np.ceil(reach)))
        y0, y1 = max(0, y - r), min(H, y + r + 1)
        x0, x1 = max(0, x - r), min(W, x + r + 1)
        win = soma_inst[y0:y1, x0:x1]
        # Filter BEFORE choosing. Choosing first and filtering after meant that
        # a rejected instance nearer the node hid an accepted one behind it, and
        # the accepted soma silently lost the neurite.
        m = win > 0 if allowed is None else np.isin(win, allowed)
        if not m.any():
            continue
        yy, xx = np.nonzero(m)
        d2 = (yy + y0 - c[0]) ** 2 + (xx + x0 - c[1]) ** 2
        k = int(np.argmin(d2))
        d = float(np.sqrt(d2[k]))

        if half_width is None:
            # circular, not the square footprint's r*sqrt(2)
            if d2[k] <= r * r:
                att[n] = int(win[yy[k], xx[k]])
            continue

        # How much true background lies between the two masks. Negative when
        # the drawn shapes overlap and the seam is all that separates them.
        boundary_gap = d - inset - SEAM_PX
        if boundary_gap <= contact_px:
            att[n] = int(win[yy[k], xx[k]])
            continue
        if not is_leaf or boundary_gap > gap_px:
            continue
        # Direction, exactly as `add_bridges` gates a neurite-neurite gap:
        # `tangent` points INTO the branch, so the outward direction is -t, and
        # it must look at the soma rather than merely lie near it.
        t = tangent(g, n, g.incident[n][0], p.tangent_fit_len)
        u = np.array([yy[k] + y0 - c[0], xx[k] + x0 - c[1]], float)
        nu = float(np.linalg.norm(u))
        if nu < 1e-9:
            att[n] = int(win[yy[k], xx[k]])
            continue
        if float(np.dot(-t, u / nu)) > cos_gap:
            att[n] = int(win[yy[k], xx[k]])
    return att


def add_bridges(g: Graph, soma_inst: np.ndarray, att: dict[int, int], p: Params,
                image: np.ndarray | None = None) -> dict:
    """Virtual edges over segmentation gaps. Returns a QC record.

    Type 3 (a neurite passing OVER a foreign soma) also *removes* the two
    attachments it consumes: those rim endpoints are not places where that soma
    grows a process, they are where somebody else's neurite went behind it.
    """
    qc = dict(bridge_end_to_end=0, bridge_pass_over=0, attachments_removed=0)
    leaves = [n for n in g.nodes if g.degree(n) == 1]
    cos_gap = np.cos(np.deg2rad(p.theta_gap))
    cos_pass = np.cos(np.deg2rad(p.theta_pass))
    maxd = p.D_gap / g.um_per_px

    def tan_of(n):
        return tangent(g, n, g.incident[n][0], p.tangent_fit_len)

    cand = []

    # --- type 3: a neurite passing OVER a soma. The chord spans the whole cell,
    # so D_gap is the wrong gate here; the soma's own diameter is.
    by_soma: dict[int, list[int]] = {}
    for n in leaves:
        if n in att:
            by_soma.setdefault(att[n], []).append(n)
    for lab, ns in by_soma.items():
        area = float((soma_inst == lab).sum())
        diam = 2.0 * np.sqrt(area / np.pi)
        for i, a in enumerate(ns):
            ta = tan_of(a)
            for b in ns[i + 1:]:
                d = g.nodes[b] - g.nodes[a]
                L = float(np.linalg.norm(d))
                if L < 1e-6 or L > 1.2 * diam:
                    continue
                u = d / L
                tb = tan_of(b)
                # outward directions must both follow the chord, and the two
                # branches must continue each other across the soma
                if not (np.dot(-ta, u) > cos_pass and np.dot(-tb, -u) > cos_pass):
                    continue
                if _straightness(ta, tb) < cos_pass:
                    continue
                cand.append((-_straightness(ta, tb), L, a, b, 'pass'))

    # --- types 1 and 2: a real gap in the mask, gated by D_gap AND by direction
    for i, a in enumerate(leaves):
        ta, ca = tan_of(a), g.nodes[a]
        for b in leaves[i + 1:]:
            if att.get(a) is not None and att.get(a) == att.get(b):
                continue                      # handled above as a pass-over
            d = g.nodes[b] - ca
            L = float(np.linalg.norm(d))
            if L < 1e-6 or L > maxd:
                continue
            u = d / L
            tb = tan_of(b)
            # `tangent` points INTO the branch, so the outward direction is -t:
            # both ends must look AT each other, not merely lie close together
            if not (np.dot(-ta, u) > cos_gap and np.dot(-tb, -u) > cos_gap):
                continue
            if att.get(a) is not None and att.get(b) is not None:
                continue                      # both already emerge from somas
            cand.append((L / maxd, L, a, b, 'gap'))

    cand.sort()
    used: set[int] = set()
    nid = max(g.branches) + 1 if g.branches else 1
    for _, L, a, b, kind in cand:
        if a in used or b in used:
            continue
        used.update((a, b))
        path = np.vstack([g.nodes[a], g.nodes[b]])
        extra = p.C_gap
        if image is not None:
            extra *= _intensity_factor(image, g.nodes[a], g.nodes[b])
        g.branches[nid] = Branch(a, b, path, L * g.um_per_px, 0.0,
                                 kind='bridge', extra_cost_um=extra)
        nid += 1
        if kind == 'pass':
            qc['bridge_pass_over'] += 1
            for n in (a, b):
                if n in att:
                    del att[n]
                    qc['attachments_removed'] += 1
        else:
            qc['bridge_end_to_end'] += 1
    g.rebuild_incidence()
    return qc


def _intensity_factor(image: np.ndarray, p0: np.ndarray, p1: np.ndarray) -> float:
    """Cheap: a bridge over dark background costs more than one over signal."""
    n = max(3, int(np.linalg.norm(p1 - p0)))
    ys = np.linspace(p0[0], p1[0], n).astype(int)
    xs = np.linspace(p0[1], p1[1], n).astype(int)
    ys = np.clip(ys, 0, image.shape[0] - 1); xs = np.clip(xs, 0, image.shape[1] - 1)
    v = image[ys, xs].astype(float)
    bg, hi = np.percentile(image, 40), np.percentile(image, 99)
    frac = float(np.mean(v > bg + 0.15 * max(hi - bg, 1e-6)))
    return float(1.0 + 2.0 * (1.0 - frac))


# ------------------------------------------------------------------ Dijkstra
@dataclass
class Assignment:
    dist: dict                      # half-edge -> cost
    src: dict                       # half-edge -> soma id
    pred: dict                      # half-edge -> predecessor half-edge or None
    runner_up: dict = field(default_factory=dict)   # half-edge -> (soma, cost)

    def branch_owner(self, bid: int):
        a, b = self.dist.get((bid, 0), INF), self.dist.get((bid, 1), INF)
        if a == INF and b == INF:
            return None, INF, None
        h = (bid, 0) if a <= b else (bid, 1)
        return self.src[h], self.dist[h], h


def run(g: Graph, att: dict[int, int], jt: dict, p: Params) -> Assignment:
    def head(h):
        b = g.branches[h[0]]
        return b.v if h[1] == 0 else b.u

    dist, src, pred, runner = {}, {}, {}, {}
    pq: list[tuple[float, int, tuple[int, int]]] = []
    for n, s in att.items():
        for bid in g.incident[n]:
            b = g.branches[bid]
            h = (bid, 0) if b.u == n else (bid, 1)
            c = b.length_um + b.extra_cost_um
            if c < dist.get(h, INF):
                dist[h], src[h], pred[h] = c, s, None
                heapq.heappush(pq, (c, s, h))

    while pq:
        c, s, h = heapq.heappop(pq)
        if c > dist.get(h, INF) + 1e-12 or src.get(h) != s:
            continue
        n = head(h)
        if n in att:
            continue                    # a soma absorbs the path; never pass through
        for nb in g.incident[n]:
            if nb == h[0]:
                continue
            b2 = g.branches[nb]
            if b2.u == b2.v:
                continue
            tc = transition_cost(n, h[0], nb, jt, p)
            if tc == INF:
                continue
            h2 = (nb, 0) if b2.u == n else (nb, 1)
            c2 = c + tc + b2.length_um + b2.extra_cost_um
            if c2 < dist.get(h2, INF):
                if h2 in src and src[h2] != s:
                    runner[h2] = (src[h2], dist[h2])
                dist[h2], src[h2], pred[h2] = c2, s, h
                heapq.heappush(pq, (c2, s, h2))
            elif src.get(h2) != s:
                cur = runner.get(h2)
                if cur is None or c2 < cur[1]:
                    runner[h2] = (s, c2)
    return Assignment(dist, src, pred, runner)

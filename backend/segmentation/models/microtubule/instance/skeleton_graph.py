"""Skeleton -> junction-contracted arc graph.

The representation PySOAX lacks. Three things happen here that its tracer does not do:

1. **Junction-cluster contraction.** ``skeletonize`` rarely turns an X into one degree-4
   node; it usually produces two degree-3 nodes joined by a short bridge (a Y-Y pattern).
   Tracing through that bridge systematically biases the pairing and injects a kink exactly
   where the physics forbids one. Dilating the junction pixels by ``merge_radius`` merges
   them into a single junction, and the distorted neighbourhood is removed from the arcs.
2. **Arcs are extracted as whole degree-2 chains**, never consumed pixel by pixel, so there
   is no first-come-first-served race for junction pixels.
3. **Spurs are pruned** by keeping only the diameter path of each arc component -- short
   skeleton hairs off a filament would otherwise become spurious arms.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import networkx as nx
import numpy as np
from scipy import ndimage
from scipy.spatial import cKDTree
from skimage.morphology import skeletonize

_NB8 = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


@dataclass
class ArcGraph:
    """Arcs (maximal degree-2 chains) plus the junctions they attach to.

    ``arcs[k]`` is an ``(N, 2)`` array of ``(x=col, y=row)``.
    ``junctions[j]`` is the ``(x, y)`` centroid of junction cluster ``j``.
    ``arc_ends[k]`` is ``(j_start, j_end)``; ``None`` means a free endpoint.
    """
    arcs: list = field(default_factory=list)
    junctions: list = field(default_factory=list)
    arc_ends: list = field(default_factory=list)


def _disk(radius: float) -> np.ndarray:
    r = int(np.ceil(radius))
    yy, xx = np.mgrid[-r:r + 1, -r:r + 1]
    return (yy ** 2 + xx ** 2) <= radius ** 2 + 1e-9


def _dilate_sparse(mask: np.ndarray, structure: np.ndarray) -> np.ndarray:
    """``ndimage.binary_dilation(mask, structure)`` for a mask that is SPARSE.

    Dilation by a structuring element *is* the union of the element's set
    offsets translated onto every set pixel — that is its definition, not an
    approximation — so for a handful of set pixels it costs
    ``O(|set| * |structure|)`` instead of ``O(H * W * |structure|)``.

    Why it is worth the extra function: junction pixels are a few hundred in a
    multi-megapixel frame, and scipy pays for the frame. Measured on a REAL
    production frame (container 4972cad8, frame 0 IRM, 1476x1924 upscaled to
    2214x2886 = 6.4 Mpx) with the shipped ``merge_radius`` 5.0 — **93** junction
    pixels and an 81-cell disk — interleaved in one process, min of 3 rounds:
    **0.337 s -> 0.012 s, 28x**, with ``np.array_equal`` True on the two
    results. Standalone on a colder run it was 0.834 s -> 0.034 s, which is more
    than ``skeletonize`` (0.145 s) and the neighbour-count ``convolve``
    (0.154 s) together — this single call was the largest item in the
    instancer. Whole-``instance_a`` effect, same interleaved harness: 1.557 s ->
    0.810 s median, with the polylines bit-identical.

    Requirements this relies on, all satisfied by :func:`_disk`: an
    odd-sided, centre-origined structure (scipy's default ``origin=0`` puts the
    origin at ``shape // 2``) and ``border_value=0`` (the default), which is
    what dropping out-of-frame targets reproduces.

    Falls back to scipy when the mask is NOT sparse. The index arrays this
    builds are ``|set| * |structure|`` elements of ``intp``, so a dense junction
    field would trade a bounded frame-sized pass for an unbounded allocation.
    ``mask.size // 8`` bounds the temporaries at roughly twice the frame's own
    byte count while leaving four orders of magnitude of headroom over anything
    real (93 x 81 = 7 533 against a limit of 798 700 on the frame above); past
    it, scipy's bounded pass is the better trade whether or not the scatter
    would still be faster.
    """
    n_off = int(structure.sum())
    rr, cc = np.nonzero(mask)
    if rr.size == 0 or n_off == 0:
        return np.zeros_like(mask, dtype=bool)
    if rr.size * n_off > mask.size // 8:
        return ndimage.binary_dilation(mask, structure=structure)

    r0, c0 = (np.asarray(structure.shape) // 2)
    off_r, off_c = np.nonzero(structure)
    off_r = off_r.astype(np.intp) - int(r0)
    off_c = off_c.astype(np.intp) - int(c0)

    h, w = mask.shape
    y = (rr[:, None].astype(np.intp) + off_r[None, :]).ravel()
    x = (cc[:, None].astype(np.intp) + off_c[None, :]).ravel()
    ok = (y >= 0) & (y < h) & (x >= 0) & (x < w)
    out = np.zeros((h, w), dtype=bool)
    out[y[ok], x[ok]] = True
    return out


def _group_coords_by_label(lab: np.ndarray, n_labels: int) -> list[np.ndarray]:
    """``[np.argwhere(lab == i) for i in range(n_labels + 1)]`` in one pass.

    Index 0 is a placeholder so callers can index by label id directly. Each
    entry is (N, 2) int64 in row-major order, identical to what `np.argwhere`
    would return for that label -- see the note at the call site for why the
    order, not just the membership, has to match.
    """
    rr, cc = np.nonzero(lab)
    if rr.size == 0:
        return [np.empty((0, 2), dtype=np.intp) for _ in range(n_labels + 1)]
    labels = lab[rr, cc]
    order = np.argsort(labels, kind="stable")
    rr, cc, labels = rr[order], cc[order], labels[order]
    coords = np.stack([rr, cc], axis=1)
    # One boundary per label id, so a label with no pixels yields an empty slice
    # rather than being skipped.
    starts = np.searchsorted(labels, np.arange(n_labels + 2), side="left")
    return [coords[starts[i]:starts[i + 1]] for i in range(n_labels + 1)]


def _component_path(coords: np.ndarray) -> np.ndarray:
    """Order one thin connected component into a path, dropping spurs.

    Uses the classic double sweep: the longest shortest-path between two far-apart pixels.
    Any side branch is simply not on that path, which is how spurs get pruned.
    """
    if len(coords) == 1:
        return coords.astype(float)
    index = {tuple(c): i for i, c in enumerate(coords)}
    g = nx.Graph()
    g.add_nodes_from(range(len(coords)))
    for i, (r, c) in enumerate(coords):
        for dr, dc in _NB8:
            j = index.get((r + dr, c + dc))
            if j is not None and j > i:
                g.add_edge(i, j, weight=float(np.hypot(dr, dc)))
    if g.number_of_edges() == 0:
        return coords[:1].astype(float)

    def farthest(src):
        dist = nx.single_source_dijkstra_path_length(g, src)
        return max(dist.items(), key=lambda kv: kv[1])[0]

    a = farthest(0)
    b = farthest(a)
    path = nx.shortest_path(g, a, b, weight="weight")
    return coords[path].astype(float)


def build_arc_graph(mask: np.ndarray, merge_radius: float = 3.0,
                    min_arc_len: int = 3,
                    bridge_max_len: float = 18.0) -> ArcGraph:
    """Build the arc graph of a binary foreground mask.

    ``merge_radius`` contracts nearby junction pixels into one junction; ``bridge_max_len``
    additionally merges junctions joined by a short stub (see
    :func:`_absorb_crossing_bridges`). ``min_arc_len`` drops arc components shorter than this
    many pixels.
    """
    skel = skeletonize(np.asarray(mask, dtype=bool))
    if not skel.any():
        return ArcGraph()

    kernel = np.array([[1, 1, 1], [1, 0, 1], [1, 1, 1]])
    nb = ndimage.convolve(skel.astype(np.uint8), kernel, mode="constant") * skel
    junction_px = skel & (nb >= 3)

    graph = ArcGraph()
    junction_labels = np.zeros(skel.shape, dtype=np.int32)

    if junction_px.any():
        # Junction pixels are a sliver of the frame (93 of 6.4 M on a real
        # production frame), so dilate them by scattering the disk onto each
        # one rather than sweeping it over every pixel — see _dilate_sparse,
        # which falls back to scipy if that ever stops being true.
        grown = _dilate_sparse(junction_px, _disk(merge_radius))
        junction_labels, n_j = ndimage.label(grown & skel,
                                             structure=np.ones((3, 3), dtype=int))
        # Group the labelled pixels in ONE pass. The obvious loop tested
        # `junction_labels == jid` for every id, rescanning the whole frame each
        # time -- O(n_junctions * frame), which on a dense IRM frame is the
        # difference between milliseconds and seconds. A centroid does not care
        # about ordering, so a plain bincount is enough here.
        jrr, jcc = np.nonzero(junction_labels)
        jlab = junction_labels[jrr, jcc]
        jcore = junction_px[jrr, jcc]
        counts_all = np.bincount(jlab, minlength=n_j + 1).astype(float)
        counts_core = np.bincount(jlab[jcore], minlength=n_j + 1).astype(float)
        sum_r_all = np.bincount(jlab, weights=jrr, minlength=n_j + 1)
        sum_c_all = np.bincount(jlab, weights=jcc, minlength=n_j + 1)
        sum_r_core = np.bincount(jlab[jcore], weights=jrr[jcore], minlength=n_j + 1)
        sum_c_core = np.bincount(jlab[jcore], weights=jcc[jcore], minlength=n_j + 1)
        for jid in range(1, n_j + 1):
            # Same rule as before: prefer the true junction pixels, fall back to
            # the whole grown label when this cluster has none.
            if counts_core[jid]:
                n, sr, sc = counts_core[jid], sum_r_core[jid], sum_c_core[jid]
            else:
                n, sr, sc = counts_all[jid], sum_r_all[jid], sum_c_all[jid]
            graph.junctions.append(np.array([sc / n, sr / n], dtype=float))
    else:
        n_j = 0

    arc_px = skel & (junction_labels == 0)
    lab, n_arc = ndimage.label(arc_px, structure=np.ones((3, 3), dtype=int))

    # KD-tree over junction-region pixels, so an arc end can be attached to the junction
    # it actually touches rather than to the nearest centroid (which for a long, curved
    # junction cluster can be a different one).
    if n_j:
        jr, jc = np.where(junction_labels > 0)
        jtree = cKDTree(np.stack([jc, jr], axis=1))
        jids = junction_labels[jr, jc]
    else:
        jtree, jids = None, None

    attach_radius = merge_radius + 1.5

    # Same rescan-per-label problem, and here ORDER is load-bearing:
    # `_component_path` numbers its graph nodes by position in `coords`, so the
    # replacement must reproduce `np.argwhere`'s row-major order exactly, not
    # merely the same set of pixels. `np.nonzero` yields row-major, and a STABLE
    # sort by label preserves that order within each group -- so
    # `arc_coords[aid]` is elementwise equal to `np.argwhere(lab == aid)`.
    arc_coords = _group_coords_by_label(lab, n_arc)

    for aid in range(1, n_arc + 1):
        coords = arc_coords[aid]                  # (row, col), row-major
        if len(coords) < min_arc_len:
            continue
        path_rc = _component_path(coords)
        if len(path_rc) < min_arc_len:
            continue
        arc_xy = np.stack([path_rc[:, 1], path_rc[:, 0]], axis=1)

        ends = []
        for endpoint in (arc_xy[0], arc_xy[-1]):
            j = None
            if jtree is not None:
                d, k = jtree.query(endpoint[None, :], k=1)
                if float(d[0]) <= attach_radius:
                    j = int(jids[int(k[0])]) - 1
            ends.append(j)

        graph.arcs.append(arc_xy)
        graph.arc_ends.append((ends[0], ends[1]))

    graph = _absorb_crossing_bridges(graph, bridge_max_len)

    # Drop junctions no surviving arc attaches to, and renumber.
    used = sorted({e for ends in graph.arc_ends for e in ends if e is not None})
    if len(used) != len(graph.junctions):
        remap = {old: new for new, old in enumerate(used)}
        graph.junctions = [graph.junctions[o] for o in used]
        graph.arc_ends = [(remap.get(a), remap.get(b)) for a, b in graph.arc_ends]
    return graph


def _absorb_crossing_bridges(graph: ArcGraph, bridge_max_len: float) -> ArcGraph:
    """Merge junctions joined by a SHORT junction-to-junction arc.

    Radius-based contraction handles the Y-Y bridge of a near-perpendicular crossing, but at
    shallow angles the two filaments stay skeletally FUSED over a long stretch that no sane
    merge radius reaches. The fused length has a closed form: two bands of half-width ``r``
    crossing at angle ``alpha`` overlap while their centerline separation is under ``2r``,
    i.e. over

        L_fuse ~= 4 * r / sin(alpha)

    -- 15.5 px for ``r=1`` at 15 degrees (measured: 14.4). Such a stub is a crossing bridge,
    not a microtubule segment: it has a junction at BOTH ends and is shorter than any real
    filament worth instancing, so its two junctions are one crossing and get merged.

    ``bridge_max_len`` should therefore be set to ``~4 * half_width / sin(alpha_min)`` for the
    shallowest crossing angle to be resolved. It is a genuine trade-off, not a free
    parameter: raising it also absorbs real short segments between two nearby crossings,
    which matters in dense frames (the MT-34 task-586 frames average 32 crossings each).
    A LONG junction-to-junction arc is a genuine segment and is always kept.
    """
    if not graph.junctions:
        return graph

    parent = list(range(len(graph.junctions)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[max(ra, rb)] = min(ra, rb)

    absorbed = []
    for k, (j0, j1) in enumerate(graph.arc_ends):
        if j0 is None or j1 is None:
            continue
        length = float(np.linalg.norm(np.diff(graph.arcs[k], axis=0), axis=1).sum())
        if length <= bridge_max_len:
            absorbed.append(k)
            if j0 != j1:
                union(j0, j1)

    if not absorbed:
        return graph

    groups: dict[int, list[int]] = {}
    for j in range(len(graph.junctions)):
        groups.setdefault(find(j), []).append(j)
    order = sorted(groups)
    new_id = {root: i for i, root in enumerate(order)}

    merged = ArcGraph()
    for root in order:
        pts = [graph.junctions[j] for j in groups[root]]
        merged.junctions.append(np.mean(pts, axis=0))
    for k, arc in enumerate(graph.arcs):
        if k in absorbed:
            continue
        j0, j1 = graph.arc_ends[k]
        merged.arcs.append(arc)
        merged.arc_ends.append((None if j0 is None else new_id[find(j0)],
                                None if j1 is None else new_id[find(j1)]))
    return merged

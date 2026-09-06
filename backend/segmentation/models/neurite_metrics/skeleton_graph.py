"""Skeleton -> graph, with the two cleanups that decide whether the rest works.

Why not `skan`
--------------
`skan` does this well, but it imports `numba`, and numba refuses to load against
the NumPy installed here (needs <= 2.0, got 2.5). Extraction is ~120 lines, so
we own it rather than pinning the whole environment to a transitive dependency.

Node clustering, then merging
-----------------------------
Skeleton pixels with a neighbour count other than two are node pixels; 8-connected
clusters of them become one node, which already fuses the two-pixel junctions
that thinning produces. It does NOT fuse two junctions separated by a few pixels
of branch, which is exactly how a degree-4 crossing usually appears, so a second
pass merges junction nodes joined by a branch shorter than `r_junction_merge`.
Without that pass the crossing rule in `assign.py` never fires: it would see two
degree-3 branch points instead of one degree-4 crossing.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy import ndimage as ndi
from skimage.morphology import skeletonize

NB8 = np.array([[1, 1, 1], [1, 0, 1], [1, 1, 1]], np.uint8)
STRUCT8 = np.ones((3, 3), bool)


@dataclass
class Branch:
    u: int                      # node id at path[0] end
    v: int                      # node id at path[-1] end
    path: np.ndarray            # (N, 2) float, pixel coords in order u -> v
    length_um: float
    width_um: float
    kind: str = 'skeleton'      # or 'bridge' -- a virtual edge over a gap
    extra_cost_um: float = 0.0  # charged on traversal, not part of length

    def other(self, node: int) -> int:
        return self.v if node == self.u else self.u


@dataclass
class Graph:
    nodes: dict[int, np.ndarray]
    branches: dict[int, Branch]
    um_per_px: float
    incident: dict[int, list[int]] = field(default_factory=dict)

    def rebuild_incidence(self) -> None:
        inc: dict[int, list[int]] = {n: [] for n in self.nodes}
        for bid, b in self.branches.items():
            inc[b.u].append(bid)
            if b.v != b.u:
                inc[b.v].append(bid)
        self.incident = inc

    def degree(self, node: int) -> int:
        return len(self.incident[node])

    def path_from(self, bid: int, node: int) -> np.ndarray:
        """Branch path oriented so that it starts at `node`."""
        b = self.branches[bid]
        return b.path if node == b.u else b.path[::-1]


def _order_component(pix: np.ndarray, shape: tuple[int, int]) -> np.ndarray:
    """Order the pixels of a 1-px-wide 8-connected arc into a walk."""
    idx = {(int(y), int(x)): i for i, (y, x) in enumerate(pix)}
    nbrs: list[list[int]] = [[] for _ in pix]
    for i, (y, x) in enumerate(pix):
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dy == 0 and dx == 0:
                    continue
                j = idx.get((int(y) + dy, int(x) + dx))
                if j is not None:
                    nbrs[i].append(j)
    ends = [i for i, n in enumerate(nbrs) if len(n) == 1]
    start = ends[0] if ends else 0
    order, seen, cur, prev = [start], {start}, start, -1
    while True:
        nxt = [j for j in nbrs[cur] if j != prev and j not in seen]
        if not nxt:
            break
        # prefer the 4-neighbour, so diagonal shortcuts do not skip a pixel
        nxt.sort(key=lambda j: abs(pix[j][0] - pix[cur][0]) + abs(pix[j][1] - pix[cur][1]))
        prev, cur = cur, nxt[0]
        order.append(cur)
        seen.add(cur)
    return pix[order]


def _polyline_length(path: np.ndarray, um_per_px: float) -> float:
    if len(path) < 2:
        return 0.0
    return float(np.sqrt(((np.diff(path, axis=0)) ** 2).sum(1)).sum() * um_per_px)


def end_clusters(path: np.ndarray, node_lab: np.ndarray) -> tuple[int, int]:
    """Which node cluster sits at each end of a branch path.

    Takes the NEAREST adjacent cluster per end. The original took the last one
    seen in raster order, so a branch consisting of a single pixel touching two
    clusters reported the same cluster at both ends: a self-loop, and no edge
    between the two clusters. On a thinned crossing (a ~55 deg crossing of thin
    strokes produces exactly this) that severs the X into two disconnected Y's,
    so `_merge_junction_clusters` finds no branch to merge, the degree-4 node is
    never formed, and the crossing rule can never fire.
    """
    cand = []
    for q in (path[0], path[-1]):
        y, x = int(q[0]), int(q[1])
        hits = []
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                yy, xx = y + dy, x + dx
                if (0 <= yy < node_lab.shape[0] and 0 <= xx < node_lab.shape[1]
                        and node_lab[yy, xx]):
                    hits.append((dy * dy + dx * dx, int(node_lab[yy, xx])))
        hits.sort()
        cand.append(hits)
    u = cand[0][0][1] if cand[0] else 0
    v = cand[1][0][1] if cand[1] else 0
    if u == v and len(path) <= 2:
        # A single-pixel branch touching two clusters: give each end a distinct
        # cluster rather than emitting a self-loop that drops the edge entirely.
        alt = [lab for _, lab in cand[1] if lab != u]
        if alt:
            v = alt[0]
        else:
            alt = [lab for _, lab in cand[0] if lab != v]
            if alt:
                u = alt[0]
    return u, v


def build(mask: np.ndarray, um_per_px: float, *, r_junction_merge: float = 1.0,
          spur_min_len: float = 1.0, spur_width_k: float = 1.5,
          min_component_area_um2: float = 1.0) -> tuple[Graph, dict]:
    """Skeletonise `mask` and return the cleaned graph plus a QC record."""
    qc: dict = {}
    min_area_px = max(1, int(round(min_component_area_um2 / um_per_px ** 2)))
    lab, n = ndi.label(mask, structure=STRUCT8)
    if n:
        keep = np.flatnonzero(np.bincount(lab.ravel())[1:] >= min_area_px) + 1
        mask = np.isin(lab, keep)
    qc['components_dropped'] = int(n - (len(keep) if n else 0))

    skel = skeletonize(mask)
    width_map = ndi.distance_transform_edt(mask) * 2.0 * um_per_px  # local full width

    nb = ndi.convolve(skel.astype(np.uint8), NB8, mode='constant')
    nb[~skel] = 0
    node_pix = skel & (nb != 2)
    node_lab, n_nodes = ndi.label(node_pix, structure=STRUCT8)

    nodes = {i: np.array(c) for i, c in
             enumerate(ndi.center_of_mass(node_pix, node_lab, range(1, n_nodes + 1)), start=1)}

    branch_pix = skel & ~node_pix
    blab, n_br = ndi.label(branch_pix, structure=STRUCT8)
    node_grown = ndi.grey_dilation(node_lab, footprint=STRUCT8)

    branches: dict[int, Branch] = {}
    bid = 0
    objs = ndi.find_objects(blab)
    for k in range(1, n_br + 1):
        sl = objs[k - 1]
        sub = blab[sl] == k
        pix = np.argwhere(sub) + [sl[0].start, sl[1].start]
        path = _order_component(pix, mask.shape)
        u, v = end_clusters(path, node_lab)
        if u == 0 or v == 0:
            continue  # dangling arc with no node cluster (isolated ring fragment)
        full = np.vstack([nodes[u][None, :], path, nodes[v][None, :]])
        bid += 1
        w = float(np.median(width_map[path[:, 0].astype(int), path[:, 1].astype(int)]))
        branches[bid] = Branch(u, v, full, _polyline_length(full, um_per_px), w)

    # zero-length branches: two node clusters touching directly
    pairs = set()
    ys, xs = np.nonzero(node_lab)
    for y, x in zip(ys, xs):
        a = node_lab[y, x]
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                yy, xx = y + dy, x + dx
                if 0 <= yy < node_lab.shape[0] and 0 <= xx < node_lab.shape[1]:
                    b = node_lab[yy, xx]
                    if b and b != a:
                        pairs.add((min(a, b), max(a, b)))
    for a, b in pairs:
        bid += 1
        p = np.vstack([nodes[a][None, :], nodes[b][None, :]])
        branches[bid] = Branch(int(a), int(b), p, _polyline_length(p, um_per_px),
                               float(width_map[int(nodes[a][0]), int(nodes[a][1])]))

    g = Graph(nodes, branches, um_per_px)
    g.rebuild_incidence()
    qc['nodes_raw'] = len(g.nodes)
    qc['branches_raw'] = len(g.branches)

    _merge_junction_clusters(g, r_junction_merge, qc)
    _dissolve_degree_two(g)
    _prune_spurs(g, spur_min_len, spur_width_k, qc)

    qc['nodes'] = len(g.nodes)
    qc['branches'] = len(g.branches)
    qc['skeleton_length_um'] = float(sum(b.length_um for b in g.branches.values()))
    return g, qc


def _merge_junction_clusters(g: Graph, r_um: float, qc: dict) -> None:
    """Union junction nodes joined by a branch shorter than `r_um`."""
    parent = {n: n for n in g.nodes}

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    merged = 0
    for b in g.branches.values():
        if b.length_um >= r_um:
            continue
        if g.degree(b.u) >= 3 and g.degree(b.v) >= 3:
            ra, rb = find(b.u), find(b.v)
            if ra != rb:
                parent[rb] = ra
                merged += 1
    if merged:
        groups: dict[int, list[int]] = {}
        for n in g.nodes:
            groups.setdefault(find(n), []).append(n)
        new_nodes = {r: np.mean([g.nodes[n] for n in ns], axis=0) for r, ns in groups.items()}
        new_branches = {}
        collapsed_um = 0.0
        for bid, b in g.branches.items():
            u, v = find(b.u), find(b.v)
            if u == v:
                collapsed_um += b.length_um   # absorbed into the merged node
                continue
            b.path = b.path.copy()            # do not mutate a shared buffer
            b.path[0] = new_nodes[u]
            b.path[-1] = new_nodes[v]
            # Recompute: moving an endpoint changes the geometry, and leaving
            # `length_um` describing the OLD path put up to r_junction_merge of
            # error on each end. `_dissolve_degree_two` then sums those stale
            # values, so the error propagated into every reported length.
            b.u, b.v = u, v
            b.length_um = _polyline_length(b.path, g.um_per_px)
            new_branches[bid] = b
        g.nodes, g.branches = new_nodes, new_branches
        g.rebuild_incidence()
        qc['junction_collapsed_um'] = round(collapsed_um, 2)
    qc['junction_nodes_merged'] = merged


def _dissolve_degree_two(g: Graph) -> int:
    """Splice out degree-2 nodes so one physical arc is one branch.

    Pruning a spur turns its degree-3 junction into a degree-2 node, and a
    degree-2 node left in place splits one neurite into two branches. That
    breaks tip counting and makes a single process look like two, so the graph
    is returned in canonical form: every node is an endpoint or a real junction.

    Nodes joining a branch to itself, or joining two branches that already share
    both endpoints, are left alone -- splicing those would create a self-loop
    the rest of the pipeline has no meaning for.
    """
    dissolved = 0
    changed = True
    while changed:
        changed = False
        for n in [k for k, v in g.incident.items() if len(v) == 2]:
            b1, b2 = g.incident[n]
            if b1 == b2:
                continue
            B1, B2 = g.branches[b1], g.branches[b2]
            if B1.u == B1.v or B2.u == B2.v:
                continue                      # a self-loop has no far end to splice to
            a, c = B1.other(n), B2.other(n)
            if a == c or a == n or c == n:
                continue                      # would close a loop on one node
            p1 = g.path_from(b1, a)           # a -> n
            p2 = g.path_from(b2, n)           # n -> c
            path = np.vstack([p1, p2[1:]])
            tot = B1.length_um + B2.length_um
            w = ((B1.width_um * B1.length_um + B2.width_um * B2.length_um) / tot
                 if tot > 0 else B1.width_um)
            del g.branches[b1], g.branches[b2], g.nodes[n]
            g.branches[b1] = Branch(a, c, path, tot, w)
            g.rebuild_incidence()
            dissolved += 1
            changed = True
            break
    return dissolved


def _prune_spurs(g: Graph, min_len_um: float, width_k: float, qc: dict,
                 max_passes: int = 3) -> None:
    """Drop leaf branches too short to be a process, iteratively."""
    pruned = 0
    for _ in range(max_passes):
        drop = []
        for bid, b in g.branches.items():
            leaf = (g.degree(b.u) == 1) ^ (g.degree(b.v) == 1)
            if not leaf:
                continue
            if b.length_um < max(min_len_um, width_k * b.width_um):
                drop.append(bid)
        if not drop:
            break
        for bid in drop:
            del g.branches[bid]
        pruned += len(drop)
        used = {n for b in g.branches.values() for n in (b.u, b.v)}
        g.nodes = {n: c for n, c in g.nodes.items() if n in used}
        g.rebuild_incidence()
        _dissolve_degree_two(g)
    qc['spurs_pruned'] = pruned

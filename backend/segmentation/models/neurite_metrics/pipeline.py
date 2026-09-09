"""End to end: masks in, per-neurite table + per-branch ownership out.

The connecting-neurite rule is implemented by CUTTING the graph rather than by
special-casing the bookkeeping. Once the soma-to-soma path is severed at its
arc-length midpoint, each half is an ordinary neurite of its own soma, and the
length split, the branch attribution ("count the branch on the half it hangs
off") and the +1 for each soma all fall out of the machinery that was already
there. Cutting also leaves branches owned by a THIRD soma untouched, which a
bookkeeping override would have had to remember not to steal.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

import assign as A
from skeleton_graph import Branch, Graph, build

MAX_SPLIT_PASSES = 4


@dataclass
class Result:
    graph: Graph
    asg: A.Assignment
    owner: dict[int, int | None]
    parent: dict[int, int | None]
    primary: dict[int, list[int]]
    primary_soma: dict[int, int]
    split_nodes: dict[int, tuple[int, int]]
    conn_diag: list[dict]
    contact_diag: list[dict]
    rows: list[dict]
    soma_rows: list[dict]
    qc: dict


def analyse(neurite_mask, soma_inst, um_per_px, p: A.Params | None = None,
            image=None, r_junction_merge=1.0, spur_min_len=1.0, spur_width_k=1.5,
            soma_ok: set[int] | None = None):
    p = p or A.Params()
    g, qc = build(neurite_mask, um_per_px, r_junction_merge=r_junction_merge,
                  spur_min_len=spur_min_len, spur_width_k=spur_width_k)
    # `neurite_mask` lets `attach_somas` measure from the filament's BOUNDARY
    # instead of from its skeleton, which is one local half-width inside it.
    # See the VENDOR EDIT note there.
    att = A.attach_somas(g, soma_inst, p, soma_ok=soma_ok,
                         neurite_mask=neurite_mask)
    qc.update(A.add_bridges(g, soma_inst, att, p, image=image))
    qc['soma_attachments'] = len(att)

    jt = A.classify_junctions(g, p)
    qc['junctions'] = {k: sum(1 for v in jt.values() if v['kind'] == k)
                       for k in ('crossing', 'branch', 'ambiguous')}
    asg = A.run(g, att, jt, p)

    # `cost_margin` has to be read BEFORE the cuts: severing a connection
    # removes the very competition it measures, so afterwards every margin is
    # empty. Lineage carries it onto both halves of a branch that gets cut.
    pre_margin: dict[int, float] = {}
    for bid in g.branches:
        m = [asg.runner_up[(bid, d)][1] - asg.dist[(bid, d)]
             for d in (0, 1) if (bid, d) in asg.runner_up and (bid, d) in asg.dist]
        if m:
            pre_margin[bid] = float(min(m))
    lineage: dict[int, int] = {bid: bid for bid in g.branches}

    split_nodes: dict[int, tuple[int, int]] = {}
    split_conn: dict[int, int] = {}          # uzel -> id spojeni (obe poloviny stejne)
    n_conn = 0
    conn_diag: list[dict] = []
    contact_diag: list[dict] = []
    split_total_um: dict[int, float] = {}
    for _ in range(MAX_SPLIT_PASSES):
        # Plan every cut against ONE assignment, then apply only the cuts whose
        # soma-to-soma paths are branch-disjoint.
        #
        # Cutting them all in one pass was wrong: `_cut_at` edits the graph
        # immediately while `asg` is only rebuilt at the end of the pass, so the
        # second and later plans walked predecessor chains through branches that
        # had already been severed, and summed lengths from a branch that
        # `_cut_at` had already replaced with its own first half (it reuses the
        # branch id). The midpoint then landed in the wrong place and one half
        # of the connection lost its route to its soma -- measured at 57-68 % of
        # cut ends orphaned on full frames.
        plans = []
        for bid in _boundary_branches(g, asg):
            rec = _connection_path(g, asg, bid, jt, p)
            if rec is None:
                continue
            if p.require_smooth_connection and not rec['smooth']:
                # Two foreign neurites touching, not a connection. Recorded, not
                # just counted: 1419 refusals against 129 cuts over 9 frames is
                # a big enough intervention that it has to be inspectable.
                contact_diag.append(dict(somas=rec['somas'], branch=rec['branch'],
                                         total_um=rec['total_um'],
                                         n_branches=rec['n_branches']))
                continue
            plans.append(rec)
        # Smooth first, then longest. Sorting by length alone preferred the
        # LONGEST meeting path among overlapping plans, which is the least
        # plausible direct connection.
        plans.sort(key=lambda r: (not r['smooth'], -r['total_um']))

        claimed: set[int] = set()
        applied = 0
        for rec in plans:
            touched = set(rec['walk'])
            if touched & claimed:
                continue                            # defer to a later pass
            cut = _cut_at(g, rec, lineage)
            if cut is None:
                continue
            claimed |= touched
            n_conn += 1
            for nid in cut:
                split_nodes[nid] = rec['somas']
                split_conn[nid] = n_conn
                # The FULL soma-to-soma length. After the cut each half is its
                # own neurite carrying half the length, which is what the length
                # table wants -- but developmental staging asks how long a
                # process the cell actually grew, and that is the whole thing.
                split_total_um[nid] = rec['total_um']
            conn_diag.append({k: rec[k] for k in
                              ('somas', 'total_um', 'smooth', 'n_bridge_edges',
                               'n_branches')})
            applied += 1
        if applied == 0:
            break
        g.rebuild_incidence()
        jt = A.classify_junctions(g, p)
        asg = A.run(g, att, jt, p)
    qc['split_passes_exhausted'] = bool(_boundary_branches(g, asg))
    # Count PAIRS, not refusal events. Each pair yields two boundary branches
    # (one per direction) and the split loop re-detects it on every pass, so
    # counting events over-reported by ~8x -- and it was being compared against
    # `n_connections`, which is deduplicated by construction because a cut
    # removes the boundary. That mismatch is what made the refusal rate look
    # like 93 % when the pair-level rate is roughly half that.
    qc['contacts_not_cut'] = len({tuple(sorted(c['somas'])) for c in contact_diag})
    qc['contact_refusal_events'] = len(contact_diag)

    owner, parent, win = {}, {}, {}
    for bid in g.branches:
        s, _c, h = asg.branch_owner(bid)
        owner[bid], win[bid] = s, h
        parent[bid] = None if h is None or asg.pred.get(h) is None else asg.pred[h][0]

    children: dict[int, list[int]] = {}
    for bid, par in parent.items():
        if par is not None:
            children.setdefault(par, []).append(bid)

    root_branches = [b for b in g.branches if owner[b] is not None and parent[b] is None]
    groups = _merge_root_attachments(g, root_branches, owner, win, att, p)

    primary, primary_soma = {}, {}
    for k, grp in enumerate(groups):
        seen, stack, sub = set(), list(grp), []
        while stack:
            b = stack.pop()
            if b in seen:
                continue
            seen.add(b)
            sub.append(b)
            stack.extend(children.get(b, []))
        primary[k], primary_soma[k] = sub, owner[grp[0]]

    rows = _rows(g, asg, owner, children, primary, primary_soma, groups,
                 split_nodes, pre_margin, lineage, att, split_total_um,
                 split_conn, qc)
    soma_rows = _soma_rows(soma_inst, um_per_px, rows, soma_ok)

    # A cut severs one connection into two halves, so a cut should yield two
    # flagged neurites. It does not always: cutting can strand a half whose
    # only remaining route back to its soma went through another cut. Those
    # halves become orphans, and the count is reported rather than reconciled
    # away -- `n_connections` counts CUTS, not pairs of reported neurites.
    owned_cut_ends = {n for sub in primary.values() for b in sub
                      for n in (g.branches[b].u, g.branches[b].v)
                      if n in split_nodes}

    tot = sum(b.length_um for b in g.branches.values() if b.kind == 'skeleton')
    ass = sum(g.branches[b].length_um for b in g.branches
              if owner[b] is not None and g.branches[b].kind == 'skeleton')
    qc.update(skeleton_length_um=round(tot, 1),
              assigned_fraction=round(float(ass / tot), 4) if tot else 0.0,
              orphan_length_um=round(float(tot - ass), 1),
              n_primary_neurites=len(primary),
              # Cuts that could actually be credited to both somas. The cuts
              # made is `n_cuts_made`; the difference is the degenerate
              # topology described in `_rows`.
              n_connections=(len(split_nodes) // 2
                             - qc.get('connections_uncreditable', 0)),
              n_cuts_made=len(split_nodes) // 2,
              n_cut_ends=len(split_nodes),
              n_cut_ends_orphaned=len(split_nodes) - len(owned_cut_ends),
              n_connections_smooth=sum(1 for c in conn_diag if c['smooth']),
              n_somas_with_neurites=len(set(primary_soma.values())),
              soma_filter='classifier' if soma_ok is not None else 'none')
    return Result(g, asg, owner, parent, primary, primary_soma, split_nodes,
                  conn_diag, contact_diag, rows, soma_rows, qc)


# ------------------------------------------------------- connecting neurites
def _boundary_branches(g: Graph, asg: A.Assignment) -> list[int]:
    out = []
    for bid in g.branches:
        d0, d1 = asg.dist.get((bid, 0), A.INF), asg.dist.get((bid, 1), A.INF)
        if d0 < A.INF and d1 < A.INF and asg.src[(bid, 0)] != asg.src[(bid, 1)]:
            out.append(bid)
    return out


def _chain(asg: A.Assignment, h):
    """Half-edges from `h` back to its source soma, `h` first."""
    out, seen = [], set()
    while h is not None and h not in seen:
        seen.add(h)
        out.append(h)
        h = asg.pred.get(h)
    return out


def _connection_path(g: Graph, asg: A.Assignment, bid: int, jt=None, p=None):
    h0, h1 = (bid, 0), (bid, 1)
    ca, cb = _chain(asg, h0), _chain(asg, h1)
    if not ca or not cb:
        return None
    # walk oriented A -> B; chain order already runs from the boundary outwards
    walk = [(h[0], h[1]) for h in reversed(ca)] + [(h[0], 1 - h[1]) for h in cb[1:]]
    if len({b for b, _ in walk}) != len(walk):
        return None                      # the two chains overlap: not a clean pair
    lens = [g.branches[b].length_um for b, _ in walk]
    total = float(sum(lens))
    if total <= 0:
        return None
    # `smooth` GATES the cut (Params.require_smooth_connection). Does this path
    # actually RUN from soma to soma,
    # or do two foreign neurites merely touch? A true connection crosses every
    # junction on a smooth through-pair; a contact turns at one of them. Two
    # Dijkstra fronts must meet somewhere inside any multi-soma component, so
    # fronts-meeting alone over-counts BY CONSTRUCTION -- measured at 65 %
    # smooth, so a third of what was being cut were contacts. Cutting a contact
    # hands half of one cell's neurite to its neighbour, so the honest default
    # is to leave it alone and count it in `qc['contacts_not_cut']`.
    smooth = True          # every junction crossed on a through-pair
    n_bridge_edges = 0
    for i in range(len(walk)):
        b, d = walk[i]
        if g.branches[b].kind == 'bridge':
            n_bridge_edges += 1
        if i + 1 >= len(walk) or jt is None:
            continue
        br = g.branches[b]
        node = br.v if d == 0 else br.u
        info = jt.get(node)
        if info is None:
            continue
        nb = walk[i + 1][0]
        if not any({b, nb} == set(pr) for pr in info['pairs']):
            smooth = False

    half, acc = total / 2.0, 0.0
    for (b, d), L in zip(walk, lens):
        if acc + L >= half:
            return dict(somas=(asg.src[h0], asg.src[h1]), branch=b, dir=d,
                        offset_um=half - acc, total_um=total, smooth=smooth,
                        n_bridge_edges=n_bridge_edges,
                        n_branches=len(walk), walk=[bb for bb, _ in walk])
        acc += L
    b, d = walk[-1]
    return dict(somas=(asg.src[h0], asg.src[h1]), branch=b, dir=d,
                offset_um=lens[-1] / 2, total_um=total, smooth=smooth,
                n_bridge_edges=n_bridge_edges,
                n_branches=len(walk), walk=[bb for bb, _ in walk])


def _cut_at(g: Graph, rec, lineage: dict[int, int]) -> tuple[int, int] | None:
    """Sever a branch at `offset_um`, giving each half its OWN new leaf node.

    Two nodes, not one: a single shared node would leave the halves joined and
    the connection would be re-detected on every pass. The cut has to actually
    disconnect the two cells.
    """
    bid, d = rec['branch'], rec['dir']
    b = g.branches.get(bid)
    if b is None or len(b.path) < 2:
        return None
    path = b.path if d == 0 else b.path[::-1]
    step = np.sqrt((np.diff(path, axis=0) ** 2).sum(1)) * g.um_per_px
    cum = np.concatenate([[0.0], np.cumsum(step)])
    if cum[-1] <= 0:
        return None
    # Keep the cut off the existing endpoints by ONE PIXEL, not by 5 % of the
    # branch: a 5 % clamp moved the true midpoint of a 40 um branch from 0.5 um
    # to 2 um and handed 1.5 um to the wrong cell.
    eps = min(g.um_per_px, 0.45 * cum[-1])
    off = float(np.clip(rec['offset_um'], eps, cum[-1] - eps))

    # Interpolate a new vertex instead of snapping to an existing one. Bridges
    # have exactly two points, so requiring a third silently refused to cut ANY
    # connection whose midpoint fell inside a bridged gap -- and a connection
    # detected because of a bridge often has its midpoint there. The whole
    # neurite was then credited to one soma with no diagnostic.
    j = int(np.searchsorted(cum, off))
    j = max(1, min(j, len(path) - 1))
    span = cum[j] - cum[j - 1]
    t = 0.5 if span <= 0 else (off - cum[j - 1]) / span
    pt = path[j - 1] + float(np.clip(t, 0.0, 1.0)) * (path[j] - path[j - 1])
    p1 = np.vstack([path[:j], pt[None, :]])
    p2 = np.vstack([pt[None, :], path[j:]])

    n1 = max(g.nodes) + 1
    n2 = n1 + 1
    g.nodes[n1] = pt.copy()
    g.nodes[n2] = pt.copy()
    u, v = (b.u, b.v) if d == 0 else (b.v, b.u)
    from skeleton_graph import _polyline_length
    del g.branches[bid]
    g.branches[bid] = Branch(u, n1, p1, _polyline_length(p1, g.um_per_px),
                             b.width_um, b.kind, b.extra_cost_um)
    new = max(g.branches) + 1
    g.branches[new] = Branch(n2, v, p2, _polyline_length(p2, g.um_per_px),
                             b.width_um, b.kind, 0.0)
    lineage[new] = lineage.get(bid, bid)
    g.rebuild_incidence()
    return n1, n2


# ------------------------------------------------------------- root grouping
def _merge_root_attachments(g, roots, owner, win, att, p) -> list[list[int]]:
    """One physical process that reaches the soma twice is ONE primary neurite.

    A wide neurite base skeletonises into a fork at the rim, so the same process
    can arrive as two root branches. Counting them separately inflates
    `n_primary_neurites`, which is the first number the biologist reads.
    """
    by_soma: dict[int, list[int]] = {}
    for b in roots:
        by_soma.setdefault(owner[b], []).append(b)

    def root_point(bid):
        h = win[bid]
        br = g.branches[bid]
        return g.nodes[br.u] if h[1] == 0 else g.nodes[br.v]

    groups = []
    for _s, bs in by_soma.items():
        pts = {b: root_point(b) for b in bs}
        unused = set(bs)
        while unused:
            seed = unused.pop()
            grp = [seed]
            for other in list(unused):
                if np.linalg.norm(pts[seed] - pts[other]) * g.um_per_px <= p.r_root_merge:
                    grp.append(other)
                    unused.discard(other)
            groups.append(grp)
    return groups


def subtree_extent(sub, children, length_of) -> float:
    """Longest root-to-tip path through the branches in `sub`.

    How far the process REACHES, as opposed to the cable sum of every branch.
    The staging rules are reach criteria, so a cable sum over five 5 um stubs
    would call them a 25 um neurite.

    BRIDGE EDGES COUNT, and `length_um` excludes them (it sums `kind ==
    'skeleton'` only). A bridged gap is where the mask failed, not where the
    neurite ended, so the tip really is that far away. Consequence worth
    documenting rather than rediscovering: on a neurite with `n_bridged_gaps >
    0` the extent can EXCEED the cable length, which otherwise reads as a bug.

    `children` may name branches outside `sub` (branches won by another soma);
    those are cut, not followed. A root is any branch in `sub` that no other
    branch in `sub` claims as a child, so a subtree with several root
    attachments is handled by taking the deepest.
    """
    sub = set(sub)
    kids = {b: [c for c in children.get(b, []) if c in sub] for b in sub}
    has_parent = {c for b in sub for c in kids[b]}
    depth: dict[int, float] = {}

    def reach(b, guard):
        if b in depth:
            return depth[b]
        if b in guard:                 # a cycle would recurse forever
            return 0.0
        guard = guard | {b}
        d = length_of(b) + max([reach(c, guard) for c in kids[b]] or [0.0])
        depth[b] = d
        return d

    roots = [b for b in sub if b not in has_parent] or list(sub)
    return max([reach(b, frozenset()) for b in roots] or [0.0])


def finalise_connections(rows, qc) -> None:
    """Keep only the connections that both somas actually hold; drop the rest.

    Each row arrives with `_conns`: the (connection id, partner soma, path
    length) of every cut node inside its subtree. A connection is real only if
    its pieces landed on TWO different somas.

    In a rare degenerate topology none of them can. Two somas joined by a LOOP
    are cut twice, which leaves three pieces to satisfy four claims (two
    connections x two somas), so one soma holds both halves of one connection
    and its partner holds none. Measured at 1 of 129 connections.

    Do not credit what cannot be credited. The claim is DROPPED rather than
    shipped with a caveat column: a row saying "this neurite joins two cells"
    when only one cell has it is a false statement about the biology, and it
    inflates `n_connections`. The cable stays where the assignment put it and
    its length is still reported -- only the connection claim goes.

    Mutates `rows` in place and writes `connections_uncreditable` to `qc`.
    """
    credited: dict[int, set[int]] = {}
    for r in rows:
        for c in r['_conns']:
            credited.setdefault(c[0], set()).add(r['soma_id'])
    ok_ids = {cid for cid, somas in credited.items() if len(somas) >= 2}
    qc['connections_uncreditable'] = len(credited) - len(ok_ids)

    for r in rows:
        conns = [c for c in r.pop('_conns') if c[0] in ok_ids]
        r['is_bridge'] = bool(conns)
        r['n_bridge_partners'] = len(conns)
        # int for the ordinary one-partner case so the column stays numeric; a
        # ';'-joined list only for the rare neurite that bridges to more than
        # one soma, which no single number can express. `bridge_path_um` is
        # aligned with `connection_id`, so both halves of one connection agree.
        r['bridge_partner_soma'] = (
            conns[0][1] if len(conns) == 1
            else ';'.join(str(c[1]) for c in conns) if conns else None)
        r['connection_id'] = (
            conns[0][0] if len(conns) == 1
            else ';'.join(str(c[0]) for c in conns) if conns else None)
        r['bridge_path_um'] = (
            round(conns[0][2], 2) if len(conns) == 1 and conns[0][2]
            else ';'.join('' if c[2] is None else str(round(c[2], 2))
                          for c in conns) if conns else None)
        # Staging asks how long a process the cell grew, so a connecting neurite
        # is staged on the whole soma-to-soma path, not its credited half.
        paths = [c[2] for c in conns if c[2]]
        r['staging_length_um'] = round(max([r['extent_um']] + paths), 2)
        if len(conns) > 1:
            qc['multi_bridge_neurites'] = qc.get('multi_bridge_neurites', 0) + 1


# -------------------------------------------------------------------- table
def _rows(g, asg, owner, children, primary, primary_soma, groups,
          split_nodes, pre_margin, lineage, att, split_total_um,
          split_conn, qc):
    rows = []
    for k, sub in primary.items():
        skel = [b for b in sub if g.branches[b].kind == 'skeleton']
        length = float(sum(g.branches[b].length_um for b in skel))
        # a tip is a free end: no children, and not a cut point or a soma
        # A tip is a FREE end. The Dijkstra front stops at any attached node, so
        # the branch running into a soma's rim also has no children -- it was
        # being counted as a tip, which is the "or a soma" case the rule always
        # named but the code did not check. A node that is still a junction (it
        # has other branches, they were just won by someone else) is not a free
        # end either.
        tips = 0
        for b in sub:
            if children.get(b):
                continue
            br = g.branches[b]
            far = br.v if (b, 0) == asg.branch_owner(b)[2] else br.u
            if far in split_nodes or far in att:
                continue
            if g.degree(far) > 1:
                continue
            tips += 1
        # EXTENT: how far the process REACHES (longest root->tip path), as
        # opposed to `length` above, which is total cable and sums every side
        # branch. The staging rules are reach/dominance criteria -- "2x longer
        # than the soma diameter", "the longest at least 2x the second" -- so a
        # cable sum calls five 5 um stubs a 25 um neurite. Bridge edges COUNT:
        # a bridged gap is where the mask failed, not where the neurite ended.
        extent = subtree_extent(sub, children,
                                lambda b: g.branches[b].length_um)

        # Every split node in the subtree, not whichever came last: a neurite
        # can bridge to TWO partners, and the old loop overwrote silently --
        # the same class of bug as taking the last cluster in raster order.
        conns = []
        seen_nodes = set()
        for b in sub:
            br = g.branches[b]
            for n in (br.u, br.v):
                if n in split_nodes and n not in seen_nodes:
                    seen_nodes.add(n)
                    a, c = split_nodes[n]
                    conns.append((split_conn.get(n),
                                  c if a == primary_soma[k] else a,
                                  split_total_um.get(n)))
        conns.sort()
        margins_src = conns          # finalised below, once credit is known
        margins = [pre_margin[lineage.get(b, b)] for b in sub
                   if lineage.get(b, b) in pre_margin]
        rows.append(dict(
            _conns=margins_src,
            soma_id=primary_soma[k],
            neurite_id=f'{primary_soma[k]}_{k:03d}',
            length_um=round(length, 2),
            extent_um=round(extent, 2),
            n_tips=tips,
            n_branch_points=sum(1 for b in sub if len(children.get(b, [])) >= 2),
            n_root_attachments=len(groups[k]),
            n_bridged_gaps=sum(1 for b in sub if g.branches[b].kind == 'bridge'),
            # The soma-to-soma path length. NOT the whole process: it excludes
            # every side branch, so it can be SHORTER than the cable `length`
            # credited to one half. It was exported as `full_length_um` and
            # documented as "the whole process", which is how a half came out
            # longer than its own whole in the first validation run.
            cost_margin=round(float(min(margins)), 2) if margins else None,
        ))
    finalise_connections(rows, qc)

    rows.sort(key=lambda r: (r['soma_id'], r['neurite_id']))
    return rows


def _soma_rows(soma_inst, um_per_px, rows, soma_ok):
    """One row per soma instance, including the ones that grew nothing.

    Instances with no neurite are kept deliberately: a cell reported with zero
    primary neurites is a measurement, and dropping it would quietly turn the
    per-cell neurite count into a per-cell-that-has-neurites count.
    """
    from scipy import ndimage as ndi

    by_soma: dict[int, list[dict]] = {}
    for r in rows:
        by_soma.setdefault(r['soma_id'], []).append(r)

    ids = [int(v) for v in np.unique(soma_inst) if v]
    if not ids:
        return []
    areas = np.bincount(soma_inst.ravel())
    cents = ndi.center_of_mass(soma_inst > 0, soma_inst, ids)
    H, W = soma_inst.shape
    objs = ndi.find_objects(soma_inst)

    out = []
    for k, (sid, c) in enumerate(zip(ids, cents)):
        rs = by_soma.get(sid, [])
        sl = objs[sid - 1]
        touches = (sl[0].start == 0 or sl[1].start == 0
                   or sl[0].stop >= H or sl[1].stop >= W)
        out.append(dict(
            soma_id=sid,
            area_um2=round(float(areas[sid]) * um_per_px ** 2, 2),
            centroid_y=round(float(c[0]), 1), centroid_x=round(float(c[1]), 1),
            n_primary_neurites=len(rs),
            n_bridges=sum(r['is_bridge'] for r in rs),
            total_neurite_length_um=round(sum(r['length_um'] for r in rs), 2),
            total_tips=sum(r['n_tips'] for r in rs),
            touches_border=int(touches),
            soma_neuronal='' if soma_ok is None else int(sid in soma_ok),
        ))
    return out

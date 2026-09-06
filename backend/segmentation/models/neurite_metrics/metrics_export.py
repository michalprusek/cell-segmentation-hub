#!/usr/bin/env python3
"""The two tables the biologist asked for, plus developmental staging.

Sheet `neurites` -- one row per primary neurite:
    frame, soma_id, neurite_id, length_um, extent_um, staging_length_um,
    bridge_path_um, n_tips,
    n_branch_points, is_bridge, bridge_partner_soma, ...

    `length_um` is what the soma is CREDITED with: half for a neurite that
    connects two somas, so the same process is not counted twice across the
    table. `extent_um` is how far it REACHES and `staging_length_um` is what
    staging reads (extent, or the whole soma-to-soma path for a bridge) --
    the cell grew all of it.

    Branching is reported as a TIP COUNT only. Per-branch lengths were not
    asked for and would multiply the row count without being interpretable
    (a branch's identity is not stable between frames).

Sheet `somas` -- one row per soma instance, including those with no neurites,
    because a cell with zero neurites is a measurement (stage 1), not an
    absence. Non-neuronal instances are kept and flagged rather than dropped,
    so the rejection rate stays auditable.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from scipy import ndimage as ndi
from skimage.measure import regionprops

sys.path.insert(0, str(Path(__file__).resolve().parent))
from staging import stage_soma

NEURITE_COLS = [
    'frame', 'soma_id', 'neurite_id', 'length_um', 'extent_um',
    'staging_length_um', 'bridge_path_um',
    'n_tips', 'n_branch_points', 'n_root_attachments', 'n_bridged_gaps',
    'is_bridge', 'bridge_partner_soma', 'connection_id',
    'n_bridge_partners', 'cost_margin',
]
SOMA_COLS = [
    'frame', 'soma_id', 'soma_neuronal', 'p_not_soma', 'stage', 'stage_reason',
    'n_neurites', 'n_bridging_neurites', 'soma_diameter_um', 'soma_area_um2',
    'total_neurite_length_um', 'longest_neurite_um', 'second_longest_um',
    'longest_cable_um', 'second_longest_cable_um',
    'total_tips', 'touches_border', 'centroid_y_px', 'centroid_x_px',
]


def soma_shape_metrics(inst: np.ndarray, um_per_px: float) -> dict[int, dict]:
    """Major axis, area and centroid per instance.

    The MAJOR AXIS is the diameter every staging threshold uses. It was chosen
    over the area-equivalent diameter deliberately: on an elongated soma the two
    differ by ~1.6x, and the major axis is the stricter, more conservative call.
    """
    out: dict[int, dict] = {}
    for p in regionprops(inst):
        out[int(p.label)] = dict(
            diameter_um=float(p.axis_major_length) * um_per_px,
            area_um2=float(p.area) * um_per_px ** 2,
            centroid_y=float(p.centroid[0]), centroid_x=float(p.centroid[1]),
        )
    return out


def build_tables(frame: str, res, inst: np.ndarray, um_per_px: float,
                 accepted: set[int], p_not_soma: dict[int, float] | None = None):
    """Return (neurite_rows, soma_rows)."""
    p_not_soma = p_not_soma or {}
    shape = soma_shape_metrics(inst, um_per_px)
    H, W = inst.shape
    objs = ndi.find_objects(inst)

    neurites = []
    by_soma: dict[int, list[dict]] = {}
    for r in res.rows:
        row = {c: r.get(c) for c in NEURITE_COLS}
        row['frame'] = frame
        row['neurite_id'] = f'{frame}:{r["soma_id"]}:{r["neurite_id"]}'
        neurites.append(row)
        by_soma.setdefault(r['soma_id'], []).append(r)

    somas = []
    for sid in sorted(int(v) for v in np.unique(inst) if v):
        sh = shape.get(sid, {})
        rs = by_soma.get(sid, [])
        # Staging reads EXTENT (how far the process reaches), not the cable sum
        # -- and for a bridging neurite the whole soma-to-soma path, which is
        # what `staging_length_um` already resolves per row. Both definitions
        # are exported so the stages can be recomputed from the table without
        # rerunning the pipeline (see restage.py).
        # Stage from the ROUNDED values, which are the ones exported. Staging
        # at full precision and exporting 2 decimals made the shipped `stage`
        # irreproducible from the shipped table: one soma sat 0.0013 um under
        # the 2xD boundary and both numbers rounded to 30.38, so recomputing
        # from the table moved it a stage. The table must answer for itself.
        full = [round(r.get('staging_length_um') or r['length_um'], 2)
                for r in rs]
        full_sorted = sorted(full, reverse=True)
        cable_sorted = sorted((r['length_um'] for r in rs), reverse=True)
        st = stage_soma(full, round(sh['diameter_um'], 2) if sh.get('diameter_um')
                        else None, is_neuronal=sid in accepted)
        sl = objs[sid - 1] if sid - 1 < len(objs) else None
        touches = bool(sl and (sl[0].start == 0 or sl[1].start == 0
                               or sl[0].stop >= H or sl[1].stop >= W))
        somas.append({
            'frame': frame, 'soma_id': sid,
            'soma_neuronal': int(sid in accepted),
            'p_not_soma': round(p_not_soma.get(sid, float('nan')), 3),
            'stage': st.stage, 'stage_reason': st.reason,
            'n_neurites': len(rs),
            'n_bridging_neurites': sum(1 for r in rs if r['is_bridge']),
            'soma_diameter_um': round(sh.get('diameter_um', float('nan')), 2),
            'soma_area_um2': round(sh.get('area_um2', float('nan')), 2),
            'total_neurite_length_um': round(sum(r['length_um'] for r in rs), 2),
            'longest_neurite_um': round(full_sorted[0], 2) if full_sorted else None,
            'second_longest_um': (round(full_sorted[1], 2)
                                  if len(full_sorted) > 1 else None),
            'longest_cable_um': (round(cable_sorted[0], 2)
                                 if cable_sorted else None),
            'second_longest_cable_um': (round(cable_sorted[1], 2)
                                        if len(cable_sorted) > 1 else None),
            'total_tips': sum(r['n_tips'] for r in rs),
            'touches_border': int(touches),
            'centroid_y_px': round(sh.get('centroid_y', float('nan')), 1),
            'centroid_x_px': round(sh.get('centroid_x', float('nan')), 1),
        })
    return neurites, somas


def write_xlsx(path, neurites, somas, meta: dict | None = None):
    """Two sheets plus a README sheet naming the conventions.

    The README is not decoration: `length_um` (half for a connecting neurite)
    and `staging_length_um` (reach, used for staging) differ, and a
    reader who does not know that will double-count or mis-stage.
    """
    try:
        import pandas as pd
    except ImportError:
        return _write_csv_fallback(path, neurites, somas)

    with pd.ExcelWriter(path, engine='openpyxl') as xl:
        pd.DataFrame(neurites, columns=NEURITE_COLS).to_excel(
            xl, sheet_name='neurites', index=False)
        pd.DataFrame(somas, columns=SOMA_COLS).to_excel(
            xl, sheet_name='somas', index=False)
        readme = [
            ('length_um', 'kabelová délka připsaná TÉTO somě = součet všech '
                          'větví této poloviny; u spojujícího neuritu POLOVINA'),
            ('extent_um', 'jak daleko výběžek DOSÁHNE = nejdelší cesta od somatu '
                          'ke konci (ne součet větví)'),
            ('staging_length_um', 'délka, ze které se určuje stádium: extent, '
                                  'u spojujícího neuritu celá cesta soma-soma'),
            ('bridge_path_um', 'délka cesty mezi oběma somaty (bez postranních '
                               'větví); prázdné u nespojujícího neuritu'),
            ('connection_id', 'id spojení — stejné u obou polovin; páruj podle '
                              'dvojice (frame, connection_id), čísluje se od 1 '
                              'v každém snímku zvlášť; více id = neurit '
                              'spojuje víc než dvě somata'),
            ('is_bridge', 'neurit spojuje dvě somata — počítá se oběma'),
            ('bridge_partner_soma', 'druhá soma daného spojení'),
            ('n_tips', 'počet volných konců (větvení); konec na somě ani řez se nepočítá'),
            ('soma_diameter_um', 'DELŠÍ OSA elipsy, ne ekvivalentní průměr'),
            ('stage', '1 / 1-2 / 2 / 3 / non-neuronal / unknown'),
            ('soma_neuronal', '1 = klasifikátor uznal jako neuronální soma'),
            ('touches_border', '1 = soma se dotýká okraje, neurity useknuté'),
            ('registrovaný neurit', 'výběžek >= 2 µm; kratší se nepočítá'),
        ]
        if meta:
            readme += [('', '')] + [(k, str(v)) for k, v in meta.items()]
        pd.DataFrame(readme, columns=['pole', 'význam']).to_excel(
            xl, sheet_name='README', index=False)
    return path


def _write_csv_fallback(path, neurites, somas):
    import csv
    base = Path(path).with_suffix('')
    for name, rows, cols in (('neurites', neurites, NEURITE_COLS),
                             ('somas', somas, SOMA_COLS)):
        with open(f'{base}_{name}.csv', 'w', newline='') as f:
            w = csv.DictWriter(f, fieldnames=cols)
            w.writeheader()
            w.writerows(rows)
    return f'{base}_*.csv'

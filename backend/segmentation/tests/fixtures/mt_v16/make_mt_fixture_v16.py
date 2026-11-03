#!/usr/bin/env python3
"""Reference fixture for the SpheroSeg V16 DEB_S4 ep040 deployment, produced on the MEASURED path.

Runs in /data2/prusek/mt_work/mt34_work on kajman with PYTHONPATH=.:src:scripts:scripts/lpc:synth:third_party
-- the tree whose eval_v5.py, scripts/lpc and scripts/ult produced the declared numbers.

The frame is the SPARSE35 fixture's (``../mt_sparse35/mt_sparse35_synthetic_irm.png``, read back from the
PNG, so the reference saw the quantisation the fixture carries). Outputs into --out-dir:
  reference_polylines.json        polylines at the 1.5x eval scale (x, y), threshold, F1 against the exact GT
  reference_prob_eval_scale.npz   float16 probability map at the eval (1.5x) shape, key "prob"
  manifest.json                   provenance of everything above

--frames NAME=H5 ... adds real frames, for the deployment check only (not committed): each is written as an
image the production upload path accepts, plus reference_<NAME>.json / reference_<NAME>_prob.npz.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys

import numpy as np
import torch
from PIL import Image

for p in ("scripts/lpc", "scripts", "src", "synth", "."):
    if p not in sys.path:
        sys.path.insert(0, p)

from train_v5 import TILE_FOR, build_model, norm01, predict  # noqa: E402
from eval_v5 import UP, eval_frame_shape, resample_to_eval  # noqa: E402
import l_dup  # noqa: E402
from l_dup import arclen, match, walk_all  # noqa: E402
from l_hyst2 import hmask  # noqa: E402
from lpc_lib import P, graph, rasterise_polyline, resample, to_logit  # noqa: E402
from instance.metrics import centerline_f1  # noqa: E402
from mt_bench.cvat_import import read_frame_h5  # noqa: E402

l_dup.BR = 80.0  # the reach accepted 2026-11-02; the code's default stays 60


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def reference(model, img: np.ndarray, thr: float):
    with torch.no_grad():
        ch = predict(model, norm01(np.asarray(img, float)), TILE_FOR["nnunet"], fusion="gauss")
    ch = resample_to_eval(ch, eval_frame_shape(img.shape))
    stored = ch.astype(np.float16)                # what eval_v5 --dump-pred writes
    prob = stored.astype(np.float32)[0]
    arcs, _, arms = graph(hmask(prob, thr, "bridge", 0.98, 22.5))
    polys = []
    for chain in (walk_all(arcs, match(arms, {}, to_logit(prob))) if arcs else []):
        p = np.concatenate([arcs[k] if w == "start" else arcs[k][::-1] for k, w in chain], 0)
        if arclen(p) >= P["min_length"]:
            polys.append(p)
    return stored[0], prob, polys


def write_frame(a: np.ndarray, stem: str) -> str:
    """The lossless form production's upload path accepts: integer values as PNG, the rest as float TIFF."""
    if np.all(a == np.round(a)) and a.min() >= 0 and a.max() <= 65535:
        path = stem + ".png"
        Image.fromarray(a.astype(np.uint16 if a.max() > 255 else np.uint8)).save(path)
    else:
        path = stem + ".tif"
        Image.fromarray(a.astype(np.float32), mode="F").save(path)
    return path


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", default="/data2/prusek/mt_work/runs/DEB_S4/ep040.pth")
    ap.add_argument("--frame-png", required=True)
    ap.add_argument("--gt-json", required=True)
    ap.add_argument("--thr", type=float, default=0.995)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--frames", nargs="*", default=[])
    args = ap.parse_args()
    os.makedirs(args.out_dir, exist_ok=True)

    state = torch.load(args.ckpt, map_location="cpu")
    model = build_model("nnunet", out_ch=1, in_ch=3).to("cuda").eval()
    model.load_state_dict(state)

    img = np.asarray(Image.open(args.frame_png))
    stored, prob, polys = reference(model, img, args.thr)
    gt = [np.asarray(q, float) * UP for q in json.load(open(args.gt_json))["polylines"]]
    masks = [rasterise_polyline(resample(p, ds=0.5), prob.shape) for p in polys]
    r = centerline_f1(masks, gt, tol=5.0, length_coverage=0.8, precision_coverage=0.8, end_tol=0.0)
    json.dump({"thr": args.thr, "polylines_xy_eval_scale": [p.tolist() for p in polys],
               "f1_vs_gt_080": r["f1"], "tp": r["tp"], "fp": r["fp"], "fn": r["fn"],
               "image_sha256": sha256(args.frame_png)},
              open(os.path.join(args.out_dir, "reference_polylines.json"), "w"))
    np.savez_compressed(os.path.join(args.out_dir, "reference_prob_eval_scale.npz"), prob=stored)
    print(f"fixture: {len(polys)} polylines, F1 vs GT {r['f1']:.3f} (tp {r['tp']} fp {r['fp']} fn {r['fn']})")

    frames = {}
    for spec in args.frames:
        name, h5 = spec.split("=", 1)
        a = np.asarray(read_frame_h5(h5)["image"])
        path = write_frame(a, os.path.join(args.out_dir, name))
        back = np.asarray(Image.open(path))
        assert np.array_equal(back.astype(np.float64), a.astype(np.float64)), f"{name}: not lossless"
        st, _, pl = reference(model, back, args.thr)
        json.dump({"thr": args.thr, "polylines_xy_eval_scale": [p.tolist() for p in pl], "image_sha256": sha256(path)},
                  open(os.path.join(args.out_dir, f"reference_{name}.json"), "w"))
        np.savez_compressed(os.path.join(args.out_dir, f"reference_{name}_prob.npz"), prob=st)
        frames[name] = {"source": os.path.basename(h5), "shape": list(a.shape), "file": os.path.basename(path), "n_polylines": len(pl)}
        print(name, frames[name])

    json.dump({"ckpt": args.ckpt, "ckpt_sha256": sha256(args.ckpt), "thr": args.thr, "up": UP, "kappa_max": 0.25,
               "tile": 512, "stride": 256, "fusion": "gauss", "decoder": "L+H", "match_reach": 80.0,
               "hyst_t_lo": 0.98, "hyst_radius": 22.5, "frame_fixture": "../mt_sparse35",
               "torch": torch.__version__, "gpu": torch.cuda.get_device_name(0), "frames": frames},
              open(os.path.join(args.out_dir, "manifest.json"), "w"), indent=1)


if __name__ == "__main__":
    main()

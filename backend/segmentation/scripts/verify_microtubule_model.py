#!/usr/bin/env python3
"""Verify the deployed microtubule model against its measured reference -- in the container.

    docker exec spheroseg-ml python scripts/verify_microtubule_model.py
    docker exec spheroseg-ml python scripts/verify_microtubule_model.py \\
        --extra /tmp/mtcheck/training_img_114.tif:/tmp/mtcheck/reference_training_img_114.json:/tmp/mtcheck/reference_training_img_114_prob.npz

Loads the checkpoint the ModelLoader would load, runs the committed fixture
(``tests/fixtures/mt_sparse35``) through the production wrapper and compares the 1.5x
probability map and the polyline set with what the research evaluation harness produced for
the same PNG (see ``models/microtubule/reference_check.py``). ``--extra`` adds real frames with
their own reference pairs, produced on the research host by the same harness; those files are
not committed. Exit status 0 only if every check passes.

This is the gate-E check of CLAUDE.md for a model swap: not "the code looks right", but the
container's own forward pass on a real tensor, compared with the measurement.
"""
from __future__ import annotations

import argparse
import hashlib
import sys
import time
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
SEG = HERE.parent
sys.path.insert(0, str(SEG))
for p in (SEG / "models" / "microtubule", SEG / "models" / "microtubule" / "vendor"):
    sys.path.insert(0, str(p))

from models.microtubule import reference_check as rc  # noqa: E402
from models.microtubule.wrapper import MODEL_NAME, MicrotubuleModel  # noqa: E402


def _read_image(path: Path) -> np.ndarray:
    from PIL import Image

    im = Image.open(path)
    if im.mode in ("I;16", "I;16B", "I;16L"):
        a = np.array(im, dtype=np.uint16)
    elif im.mode == "I":
        a = np.array(im, dtype=np.int32)
    elif im.mode == "F":
        a = np.array(im, dtype=np.float32)
    elif im.mode == "L":
        a = np.array(im, dtype=np.uint8)
    else:
        a = np.array(im.convert("L"), dtype=np.uint8)
    return a


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", default=str(SEG / "weights" / "microtubule_sparse35_ep040.pth"))
    ap.add_argument("--fixture-dir", default=str(SEG / "tests" / "fixtures" / "mt_sparse35"))
    ap.add_argument("--extra", nargs="*", default=[], help="IMAGE:REF_JSON:REF_NPZ triples")
    ap.add_argument("--strict", action="store_true", help="identity tolerances (same GPU, same torch)")
    ap.add_argument("--device", default=None)
    args = ap.parse_args()

    model = MicrotubuleModel().load_weights(args.weights, device=args.device)
    if args.strict:
        tol = rc.Tolerance(map_max_abs=1e-3, map_flip_frac=0.0, poly_match_px=0.05,
                           poly_matched_frac=1.0, poly_count_slack=0)
    else:
        tol = rc.CUDA_TOL if str(model._device).startswith("cuda") else rc.CPU_TOL
    print(f"{MODEL_NAME} from {args.weights} on {model._device}; sha256 {_sha256(Path(args.weights))[:16]}…")
    print(f"params: thr {model.params['prob_thr']}, min_length {model.params['min_length']}, "
          f"merge_radius {model.params['merge_radius']}")

    all_ok = True
    fx = rc.load_fixture(args.fixture_dir)
    if _sha256(Path(args.weights)) != fx["manifest"]["ckpt_sha256"]:
        print(f"FAIL: checkpoint sha256 differs from the fixture's {fx['manifest']['ckpt_sha256'][:16]}…")
        all_ok = False
    t0 = time.perf_counter()
    rep = rc.run_check(model, fx["image"], fx, tol, gt_xy_native=fx["gt_xy_native"])
    dt = time.perf_counter() - t0
    print(f"\n== fixture mt_sparse35_synthetic_irm.png ({fx['image'].shape}, {dt:.1f} s for maps + instancing twice)")
    print(rc.format_report(rep))
    all_ok &= rep["ok"]

    for triple in args.extra:
        img_p, ref_j, ref_n = (Path(x) for x in triple.split(":"))
        ref = rc.load_reference(ref_j, ref_n)
        img = _read_image(img_p)
        if ref.get("image_sha256") and _sha256(img_p) != ref["image_sha256"]:
            print(f"\n== {img_p.name}: FAIL, image sha256 differs from the reference's")
            all_ok = False
            continue
        t0 = time.perf_counter()
        rep = rc.run_check(model, img, ref, tol)
        dt = time.perf_counter() - t0
        print(f"\n== {img_p.name} ({img.shape}, {img.dtype}, {dt:.1f} s)")
        print(rc.format_report(rep))
        all_ok &= rep["ok"]

    # timing of the production path alone, once, on the fixture
    t0 = time.perf_counter()
    model.predict(fx["image"])
    print(f"\npredict() on the 1024x1024 fixture: {time.perf_counter() - t0:.2f} s")
    print("\nALL OK" if all_ok else "\nVERIFICATION FAILED")
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())

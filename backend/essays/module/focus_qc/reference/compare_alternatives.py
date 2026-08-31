"""Recompute the numbers the README quotes when arguing against variance-of-Laplacian.

Needs the raw ND2 stacks (not in the repo -- 1.5 GB); paths come from the spec.

    python3 -m focus_qc.reference.compare_alternatives

Reports, for each channel and each descriptor, the separation margin used
throughout the project: the 5th percentile of in-focus scores over the 95th
percentile of out-of-focus scores. A margin at or below 1 means no absolute
threshold separates the two classes at all.
"""
import json
from pathlib import Path

import numpy as np
from scipy import ndimage as ndi

from focus_qc.metrics import POLARITY, focus_score
from focus_qc.zstack import IN_FOCUS, OUT_OF_FOCUS, iter_stack_planes, label_planes, pooled
from focus_qc.detect import ChannelSpec

TOLERANCE_UM, GUARD_UM = 0.3, 0.1


def variance_of_laplacian(img):
    """The standard autofocus operator, on the intensity-normalised frame."""
    f = np.asarray(img, np.float64)
    fn = (f - f.mean()) / (f.std() + 1e-9)
    return float(ndi.laplace(fn).var())


def margin(good, bad):
    return float(np.percentile(good, 5) / max(np.percentile(bad, 95), 1e-12))


def main():
    spec_path = Path(__file__).with_name("zstacks_oof_spec.json")
    spec = json.loads(spec_path.read_text())
    channels = [ChannelSpec(**c) for c in spec["channels"]]
    collected = {(c.name, d): {"good": [], "bad": []}
                 for c in channels for d in ("structure_area", "variance_of_laplacian")}

    for stack in spec["stacks"]:
        planes = list(iter_stack_planes(stack["path"], channels))
        labels = label_planes(len(planes), stack["sharp_plane"], spec["z_step_um"],
                              TOLERANCE_UM, GUARD_UM)
        for channel in channels:
            area = np.array([focus_score(p[channel.name], channel.modality).score for p in planes])
            lap = np.array([variance_of_laplacian(p[channel.name]) for p in planes])
            for name, values in (("structure_area", area), ("variance_of_laplacian", lap)):
                collected[(channel.name, name)]["good"].append(pooled(values, labels, IN_FOCUS))
                collected[(channel.name, name)]["bad"].append(pooled(values, labels, OUT_OF_FOCUS))
        print(f"  {Path(stack['path']).stem} done", flush=True)

    print(f"\nseparation margin  (p5 in-focus / p95 out-of-focus), tolerance +-{TOLERANCE_UM} um")
    print(f"{'channel':12}{'descriptor':24}{'margin':>9}")
    for (channel, descriptor), v in collected.items():
        m = margin(np.concatenate(v["good"]), np.concatenate(v["bad"]))
        print(f"{channel:12}{descriptor:24}{m:>9.2f}x")


if __name__ == "__main__":
    main()

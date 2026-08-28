"""The GPU cap must clear the model's working set — the setting that lost data.

Until 2026-08-13 the worker capped its ``evaluate.py`` subprocess at 0.6 of the
24 GB A5000 (14.13 GiB) while a v7 forward pass on a 2048x2048 well wanted
16.36 GiB. Sitting under the working set does not make a batch a lighter
neighbour: torch hit the ceiling on every position, released ~3.7 GiB of cached
blocks back to the driver, and then had to win them back from a card it shares
with the ml service and Maptimize. Losing that race raises OutOfMemoryError, and
the field saw one folder lose 255 wells in one run and 68 in the next.

The failure is invisible to every other check — the config parses, the container
is healthy, the run exits 0, and the results look like results. So the invariant
is asserted here instead.

**The model changed on 2026-08-17.** v5H needs a 1.41 GiB working set where v7
needed 16.36, so the cap came down 0.75 -> 0.12 and the start gate 17 -> 4 GB.
The invariant is unchanged and still the point of this file: the cap must sit
ABOVE the working set with headroom, and must not creep back up to reserving a
card three tenants share. These are measurements, not preferences — if the model
or the card changes again, re-measure and move the constants deliberately rather
than letting either a "safer-looking" smaller number or an "it worked before"
larger one drift back in.

Re-measure with: a real ``evaluate.py`` run over a multi-position 2048x2048 well
inside the essays container, reading ``torch.cuda.max_memory_reserved()`` at the
end. Sweep several caps: the working set is flat once the cap clears it (v5H
measured identical at 17.99 / 4.80 / 2.88 / 1.92 GiB, with byte-identical
results.csv and runtime within 1 s).

Run with: pytest tests/ (no GPU needed — this reads configuration, not hardware).
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import pytest

APP_ROOT = Path(__file__).resolve().parents[1]
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

import essays_api  # noqa: E402


def _find_compose() -> Path | None:
    """Locate the production compose file, or None when it is out of reach.

    The suite runs both from the repo (where it sits two levels up) and from a
    container that bind-mounts only ``backend/essays``, so this walks up rather
    than counting parents — and returns None instead of raising, because a
    missing compose file must skip that one test, not break collection.
    """
    for base in (APP_ROOT, *APP_ROOT.parents):
        candidate = base / "docker-compose.production.yml"
        if candidate.is_file():
            return candidate
    root = Path("/docker-compose.production.yml")
    return root if root.is_file() else None


COMPOSE = _find_compose()


def _cap_gb() -> float:
    return float(essays_api.GPU_MEM_FRACTION) * essays_api.GPU_TOTAL_GB


def test_cap_clears_the_working_set():
    """A cap under the working set makes torch churn its cache every position."""
    assert _cap_gb() >= essays_api.GPU_WORKING_SET_GB, (
        f"cap {_cap_gb():.2f} GiB is below the measured "
        f"{essays_api.GPU_WORKING_SET_GB} GiB working set — every position will "
        "release cached blocks and race a co-tenant to get them back"
    )


def test_start_gate_clears_the_working_set():
    """Admitting a job with less free than it needs restarts the same churn."""
    assert essays_api.GPU_MIN_FREE_GB >= essays_api.GPU_WORKING_SET_GB


def test_cap_keeps_real_headroom_over_the_working_set():
    """Clearing the working set by a hair is not clearing it.

    The cap sizes cuDNN's workspace, and a cap that only just exceeds the
    measured demand leaves nothing for a well that runs slightly heavier than
    the one that was measured. The deployed value is ~2x the working set;
    this pins that intent so a later "optimisation" cannot shave it to 1.42.
    """
    assert _cap_gb() >= essays_api.GPU_WORKING_SET_GB * 1.5, (
        f"cap {_cap_gb():.2f} GiB leaves under 50% headroom over the "
        f"{essays_api.GPU_WORKING_SET_GB} GiB working set"
    )


def test_start_gate_covers_the_cap_plus_cuda_context():
    """The gate admits a job; the cap then bounds it.

    A gate below the cap admits a batch into less memory than it is licensed to
    take, which is the same release-and-re-acquire race by another route. The
    CUDA context (~0.4 GiB) sits outside the torch caching allocator and so
    outside the cap, hence the margin.
    """
    assert essays_api.GPU_MIN_FREE_GB >= _cap_gb() + 0.4, (
        f"start gate {essays_api.GPU_MIN_FREE_GB} GB does not cover the "
        f"{_cap_gb():.2f} GiB cap plus its CUDA context"
    )


def test_cap_leaves_room_for_interactive_segmentation():
    """The batch is a guest on this card: it must not be licensed to take it all.

    Demand is flat above the working set, so a higher cap buys the batch nothing
    while taking room the `ml` container needs.
    """
    assert _cap_gb() <= essays_api.GPU_WORKING_SET_GB + 2.0
    assert float(essays_api.GPU_MEM_FRACTION) < 0.8


def test_sitecustomize_default_matches_the_module_default():
    """The file that APPLIES the cap must default to the one the tests police.

    There are three copies of this number: essays_api.GPU_MEM_FRACTION (which
    every assertion above is written against), the compose default (checked
    below), and a third in sitecustomize.py -- which is the one that actually
    calls `set_per_process_memory_fraction` on the evaluate.py subprocess.

    In normal operation essays_api passes ESSAYS_GPU_MEM_FRACTION down in the
    subprocess env, so sitecustomize's literal never fires. It fires when
    evaluate.py is run directly, which is exactly the debugging path where a
    silently different cap is hardest to notice -- the run simply behaves
    unlike production and nothing says why.

    Found by mutating sitecustomize's literal from 0.12 to 0.02 and watching
    the whole suite stay green.
    """
    src = (Path(__file__).resolve().parents[1] / "sitecustomize.py").read_text()
    m = re.search(
        r'os\.environ\.get\(\s*["\']ESSAYS_GPU_MEM_FRACTION["\']\s*,\s*["\']([^"\']+)["\']',
        src,
    )
    assert m, "sitecustomize.py no longer reads ESSAYS_GPU_MEM_FRACTION with a default"
    assert float(m.group(1)) == float(essays_api.GPU_MEM_FRACTION), (
        f"sitecustomize defaults to {m.group(1)} but essays_api uses "
        f"{essays_api.GPU_MEM_FRACTION}; a direct evaluate.py run would cap "
        "differently from production"
    )


@pytest.mark.skipif(COMPOSE is None, reason="compose file not in this tree")
@pytest.mark.parametrize(
    "var, attr, cast",
    [
        ("ESSAYS_GPU_MEM_FRACTION", "GPU_MEM_FRACTION", float),
        ("ESSAYS_GPU_MIN_FREE_GB", "GPU_MIN_FREE_GB", float),
    ],
)
def test_compose_default_matches_the_module_default(var, attr, cast):
    """Two places carry these numbers; a silent drift between them is a trap.

    The compose default is what production actually runs, the module default is
    what a bare `python essays_api.py` and every test above sees. If they part
    company the invariants proven here stop describing the deployment.
    """
    m = re.search(rf"{var}=\$\{{{var}:-([^}}]+)\}}", COMPOSE.read_text())
    assert m, f"{var} not found in {COMPOSE.name}"
    assert cast(m.group(1)) == cast(getattr(essays_api, attr))

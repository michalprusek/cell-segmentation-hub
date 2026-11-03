"""The batch assay runs the model the interactive service runs.

The owner's rule, 2026-11-03: whenever the interactive microtubule model changes,
Essays moves with it, in the same change. The checkpoint's file name selects fusion,
decoder and cut, so a batch left behind would run a complete older pipeline without a
single error, and nobody would see it until two result tables stopped agreeing.

The name lives in places that cannot share a constant: the service's model table, an
image ENV, and defaults read before the model package is on the path. So they are
compared here, and moving one without the others fails CI.

Run with: pytest backend/essays/tests/ (no torch, no GPU, no checkpoint).
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import pytest

APP_ROOT = Path(__file__).resolve().parents[1]
if str(APP_ROOT / "module") not in sys.path:
    sys.path.insert(0, str(APP_ROOT / "module"))

import _mt_package  # noqa: E402


def _find_repo() -> Path | None:
    """The repo root, or None in a container that bind-mounts only ``backend/essays``."""
    for base in (APP_ROOT, *APP_ROOT.parents):
        if (base / "docker" / "essays.Dockerfile").is_file():
            return base
    return None


REPO = _find_repo()
needs_repo = pytest.mark.skipif(REPO is None, reason="repo checkout out of reach")


def _interactive_checkpoint() -> str:
    table = (REPO / "backend/segmentation/ml/model_loader.py").read_text()
    entry = re.search(r"'microtubule':\s*\{(.*?)\}", table, re.S)
    assert entry, "no microtubule entry in the model table"
    names = set(re.findall(r"_path':\s*'weights/([^']+)'", entry.group(1)))
    assert len(names) == 1, f"the model table names several checkpoints: {names}"
    return names.pop()


@needs_repo
def test_module_default_is_the_interactive_checkpoint():
    assert _mt_package.WEIGHTS_NAME == _interactive_checkpoint()


@needs_repo
def test_worker_default_is_the_interactive_checkpoint():
    # The source and not the attribute: the attribute reads the environment at import.
    source = (APP_ROOT / "essays_api.py").read_text()
    assert f'/app/mt_weights/{_interactive_checkpoint()}"' in source


@needs_repo
def test_image_default_is_the_interactive_checkpoint():
    image = (REPO / "docker" / "essays.Dockerfile").read_text()
    assert re.findall(r"ESSAYS_WEIGHTS=\S*/([^/\s]+)", image) == [_interactive_checkpoint()]


@needs_repo
def test_compose_does_not_pin_the_batch_to_another_checkpoint():
    compose = (REPO / "docker-compose.production.yml").read_text().splitlines()
    assert not [ln for ln in compose if "ESSAYS_WEIGHTS" in ln and not ln.lstrip().startswith("#")]


@needs_repo
def test_the_batch_checkpoint_has_a_measured_pipeline():
    """Without an entry the wrapper refuses the file, and the first batch job dies."""
    wrapper = (REPO / "backend/segmentation/models/microtubule/wrapper.py").read_text()
    pipelines = wrapper[wrapper.index("_PIPELINES = {"):]
    assert f'"{_mt_package.WEIGHTS_NAME}":' in pipelines[: pipelines.index("}")]

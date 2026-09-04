"""The two Python gates must collect the same directories.

There are two places that name the pytest suites this repository runs:

  * ``.github/workflows/ci.yml``, the ``python-tests`` job — the merge gate;
  * ``Makefile``'s ``test-py`` target — ``make ci`` step 7, the local gate,
    which announces itself as "Python suites CI also runs".

They drifted, and the drift was invisible in exactly the way that matters.
``backend/essays/module/focus_qc/tests`` was added to the workflow and not to
the Makefile, so from then until 2026-09-04 ``make ci`` reported green over 400
tests while CI ran 532. The 132 it silently skipped are the only thing pinning
the focus descriptor's constants and its 1.97x IRM separation margin — a
descriptor change would have passed every local check and only failed after a
push.

A missing directory cannot be caught by running either gate: each one passes on
the suites it does list. So the two lists are compared here instead. This lives
in ``backend/essays/tests`` because that is a directory the gates collect, not
because it is about the essays worker.

Run with: pytest tests/ (no GPU, no network — this reads two text files).
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

APP_ROOT = Path(__file__).resolve().parents[1]

#: What a suite path handed to pytest looks like, so a NEW one is discovered
#: rather than having to be listed here first.
#:
#: An allowlist cannot do this job, and the first version of this file learned
#: it the hard way: intersecting the tokens with a hardcoded set of five known
#: suites made every unknown path invisible, so the very incident documented
#: above — focus_qc added to one gate only — would still have passed, because
#: that path was not yet in the list. A pattern has no such blind spot.
_SUITE_TOKEN = re.compile(r"^backend/[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*/tests?$")

#: The one suite that must stay OUT of both gates (see the last test).
GPU_ONLY_SUITE = "backend/segmentation/tests"


def _find_repo_root() -> Path | None:
    """The checkout root, or None when only ``backend/essays`` is mounted.

    The suite runs both from the repository and from a container that
    bind-mounts a single directory, so this walks up rather than counting
    parents, and returns None instead of raising — a tree without the two files
    must skip this one test, not break collection.
    """
    for base in (APP_ROOT, *APP_ROOT.parents):
        if (base / "Makefile").is_file() and (
            base / ".github" / "workflows" / "ci.yml"
        ).is_file():
            return base
    return None


ROOT = _find_repo_root()
pytestmark = pytest.mark.skipif(
    ROOT is None, reason="repository root not in this tree"
)


def _suites_in(text: str) -> set[str]:
    """Every suite path the given text passes to pytest, as a WHOLE token.

    Tokenised rather than substring-matched. A substring test reports agreement
    for ``XXbackend/essays/module/focus_qc/tests``, which pytest would exit 4
    on — checked by mutating the Makefile that way and watching this file stay
    green, which is the same class of mistake it exists to catch.
    """
    return {
        stripped
        for tok in text.split()
        if _SUITE_TOKEN.match(stripped := tok.strip("'\"\\"))
    }


def _makefile_test_py() -> str:
    """The RECIPE of the ``test-py`` target — tab-indented lines only.

    Not "up to the next target": a Make recipe line must begin with a TAB, and
    anything else (a blank line, a ``#`` comment) is outside it. An earlier
    version accepted ``[\\t#]`` and blank lines, which ran on past the recipe
    and swallowed the comment block documenting ``test-ml`` — so a path
    MENTIONED in prose below would have read as a path the gate RUNS, and the
    GPU-only assertion at the bottom of this file would fire on a comment.
    """
    src = (ROOT / "Makefile").read_text()
    m = re.search(r"^test-py:\n((?:\t.*\n)*)", src, re.MULTILINE)
    assert m, "Makefile no longer has a test-py target"
    return m.group(1)


def _workflow_python_step() -> str:
    """The body of the workflow step that invokes pytest.

    Indented lines only, for the same reason: the step's ``run:`` block is the
    command, and the ``# ...`` comments that precede the step are prose about
    which suites exist rather than which ones run.
    """
    src = (ROOT / ".github" / "workflows" / "ci.yml").read_text()
    m = re.search(
        r"^      - name: pytest [^\n]*\n((?:[ \t]{8,}.*\n)*)", src, re.MULTILINE
    )
    assert m, "ci.yml no longer has a 'pytest ...' step"
    return m.group(1)


def test_both_gates_run_the_same_suites():
    """A suite in one gate and not the other is a suite nobody watches."""
    local = _suites_in(_makefile_test_py())
    ci = _suites_in(_workflow_python_step())
    assert local, "make test-py names no known suite — the regex or the target moved"
    assert local == ci, (
        "make test-py and the ci.yml python-tests job disagree; "
        f"only local: {sorted(local - ci)}, only CI: {sorted(ci - local)}"
    )


def test_the_gates_collect_this_suite():
    """Self-check: a gate that does not run this file cannot enforce the above."""
    assert "backend/essays/tests" in _suites_in(_makefile_test_py())


def test_every_named_suite_exists():
    """A path that has moved makes pytest exit 4, not fail — easy to misread."""
    for suite in _suites_in(_makefile_test_py()) | _suites_in(_workflow_python_step()):
        assert (ROOT / suite).is_dir(), (
            f"{suite} is named by a gate but is not a directory"
        )


def test_the_gpu_only_suite_stays_out_of_the_driverless_gates():
    """``backend/segmentation/tests`` cannot be COLLECTED without a CUDA driver.

    ``models/__init__`` imports mamba_ssm, which imports Triton, which raises
    "0 active drivers" at import time. Adding it to either gate turns every run
    on a GPU-less runner red at collection, which reads like a broken suite
    rather than a misconfigured one. It belongs to ``make test-ml``.
    """
    assert GPU_ONLY_SUITE not in _suites_in(_makefile_test_py())
    assert GPU_ONLY_SUITE not in _suites_in(_workflow_python_step())
    # ...and the pattern above really does recognise it, so the two assertions
    # are not passing for want of a match.
    assert _SUITE_TOKEN.match(GPU_ONLY_SUITE)

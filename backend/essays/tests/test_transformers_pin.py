"""The transformers pin sits below a measured wall, and the alert above it is unreachable.

`backend/segmentation/requirements.txt` and `backend/essays/module/requirements.txt`
must pin a transformers version below the release that breaks SegFormer. (That the
two files pin the *same* version is already gated by the ``pins`` job in
``.github/workflows/ci.yml``; this file does not repeat it.)

Measured 2026-09-04 in a throwaway ml container, loading the real
``segformer_b0_spheroseg.pth`` and running a seeded 1x3x1024x1024 forward:

    5.5.4  OK   sha ec4010afadd9a00d   (the shipped pin)
    5.6.2  OK   sha ec4010afadd9a00d
    5.7.0  OK   sha ec4010afadd9a00d
    5.8.1  OK   sha ec4010afadd9a00d
    5.9.0  FAIL load_state_dict: segformer.encoder.block.N.M -> stages.N.blocks.M
    5.10.1/2/4 FAIL import: torch.float8_e8m0fnu does not exist in torch 2.6.0
               (5.10.0, the advisory's "first patched version", is yanked)
    5.11.0, 5.12.1, 5.13.1, 5.14.1, 5.15.0, 5.15.1  FAIL load_state_dict
    5.16.1     FAIL — measured earlier, in PR #358

So the first release that fixes GHSA-xrqw-3rrv-vx5w / CVE-2026-9856
(``save_pretrained`` path traversal, first patched 5.10.0) is already past the
wall. The alert therefore stays open on purpose. That is only defensible while
the advisory is unreachable here, which rests on two facts this file asserts:

  * nothing in the repo's Python calls ``save_pretrained``;
  * every ``from_pretrained`` call loads a config or a vision backbone — no
    tokenizer, no processor, hence no ``chat_template`` to traverse out of.

The second one is asserted on the CLASS being loaded, not on the file doing the
loading: a tokenizer added to ``models/segformer.py`` is exactly as dangerous as
one added anywhere else, and a path allowlist would wave it through.

If either fact stops being true, the risk analysis in the requirements comment is
stale and this test should fail so somebody re-does it rather than inheriting a
conclusion that no longer holds.

Run with: pytest tests/ (no GPU, no torch, no network — this reads text files).
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
ML_REQS = REPO_ROOT / "backend" / "segmentation" / "requirements.txt"
ESSAYS_REQS = REPO_ROOT / "backend" / "essays" / "module" / "requirements.txt"

# 5.9.0 renamed the SegFormer module layout; the checkpoint stops loading there
# and at every release above it, 5.10.x not even importing on torch 2.6.0.
# Lower this ONLY after re-running the probe against the real checkpoints.
FIRST_BROKEN = (5, 9, 0)
# 5.5.4 is the floor that closed the three advisories unfixed across all 4.57.x.
KNOWN_GOOD_FLOOR = (5, 5, 4)

# Loaded by `from_pretrained` today. Both are architecture-only: a config object
# and a frozen ViT backbone. Neither carries a chat template.
ALLOWED_PRETRAINED_CLASSES = frozenset({"SegformerConfig", "Dinov2Model"})

# Directory names that are never repo Python: build artefacts and any virtualenv
# a developer happens to have created inside the tree.
_SKIP_DIRS = frozenset({
    "node_modules", "__pycache__", ".git", "venv", ".venv", "env",
    "site-packages", "build", "dist", ".mypy_cache", ".pytest_cache",
    "uploads", "weights",
})

_PIN = re.compile(r"^transformers==([0-9]+(?:\.[0-9]+)*)\s*(?:#.*)?$", re.MULTILINE)


def _fmt(version: tuple[int, ...]) -> str:
    return ".".join(str(part) for part in version)


def _pinned(path: Path) -> tuple[int, ...]:
    m = _PIN.search(path.read_text(encoding="utf-8"))
    assert m is not None, f"{path} does not pin transformers with =="
    return tuple(int(p) for p in m.group(1).split("."))


@pytest.mark.parametrize("path", [ML_REQS, ESSAYS_REQS], ids=["ml", "essays"])
def test_transformers_stays_below_the_segformer_rename(path: Path) -> None:
    """5.9.0+ renames the SegFormer state-dict keys — the checkpoint stops loading.

    This includes every version that carries the fix for GHSA-xrqw-3rrv-vx5w
    (first patched 5.10.0), which is exactly why that alert is left open.
    """
    version = _pinned(path)
    assert KNOWN_GOOD_FLOOR <= version < FIRST_BROKEN, (
        f"{path.relative_to(REPO_ROOT)} pins transformers {_fmt(version)}, outside "
        f"[{_fmt(KNOWN_GOOD_FLOOR)}, {_fmt(FIRST_BROKEN)}). {_fmt(FIRST_BROKEN)}+ breaks "
        "SegFormer's checkpoint load and 5.10.x will not import on torch 2.6.0 — "
        "re-run the probe described in backend/segmentation/requirements.txt "
        "before moving it."
    )


def _python_sources() -> list[Path]:
    """Every repo Python file under backend/, tests and vendored trees aside.

    The requirements comment claims `grep -rn save_pretrained backend/` is empty,
    so the scan is that whole subtree — not just the two ML packages.
    """
    root = REPO_ROOT / "backend"
    out: list[Path] = []
    for p in root.rglob("*.py"):
        rel = p.relative_to(root).parts
        if _SKIP_DIRS.intersection(rel):
            continue
        if "tests" in rel or "test" in rel or p.name.startswith("test_"):
            continue
        out.append(p)
    return out


def test_nothing_calls_save_pretrained() -> None:
    """The advisory needs a save_pretrained() call. There is none — keep it that way.

    The needle is split so this file's own source cannot match the scan.
    """
    needle = "save_" + "pretrained"
    sources = _python_sources()
    assert len(sources) > 50, f"source scan found only {len(sources)} files — roots moved"
    offenders = [
        str(p.relative_to(REPO_ROOT))
        for p in sources
        if needle in p.read_text(encoding="utf-8", errors="replace")
    ]
    assert not offenders, (
        f"{needle} is now called in {offenders}. GHSA-xrqw-3rrv-vx5w is knowingly "
        "unpatched here (no release fixes it below the SegFormer wall); it was safe "
        "only because nothing saved a tokenizer or processor back to disk. Re-do the "
        "risk analysis in backend/segmentation/requirements.txt before landing this."
    )


def _receiver_name(node: ast.Attribute) -> str:
    """Last dotted name of the object `.from_pretrained` is called on."""
    value = node.value
    if isinstance(value, ast.Name):
        return value.id
    if isinstance(value, ast.Attribute):
        return value.attr
    if isinstance(value, ast.Call):  # e.g. get_cls().from_pretrained(...)
        return "<call>"
    return f"<{type(value).__name__}>"


def test_from_pretrained_loads_no_tokenizer_or_processor() -> None:
    """The traversal comes out of a downloaded chat_template — only tokenizers and
    processors have one. Assert on the class loaded, not on the file loading it."""
    sources = _python_sources()
    assert len(sources) > 50, f"source scan found only {len(sources)} files — roots moved"
    found: dict[str, set[str]] = {}
    for p in sources:
        try:
            tree = ast.parse(p.read_text(encoding="utf-8", errors="replace"), str(p))
        except SyntaxError:  # a deliberately-broken fixture is not our problem
            continue
        for node in ast.walk(tree):
            if isinstance(node, ast.Attribute) and node.attr == "from_pretrained":
                cls = _receiver_name(node)
                found.setdefault(cls, set()).add(str(p.relative_to(REPO_ROOT)))
    unexpected = {k: sorted(v) for k, v in found.items()
                  if k not in ALLOWED_PRETRAINED_CLASSES}
    assert not unexpected, (
        f"from_pretrained is now called on {unexpected}, outside the reviewed set "
        f"{sorted(ALLOWED_PRETRAINED_CLASSES)}. If a tokenizer or processor is now "
        "loaded, GHSA-xrqw-3rrv-vx5w stops being unreachable — re-read the CEILING "
        "note in backend/segmentation/requirements.txt before allowing it here."
    )
    # Anti-vacuity: if the walk stops finding the two known loaders the assertion
    # above has become free, and a real tokenizer could slip in behind it.
    assert found, (
        "no from_pretrained call found at all — the AST walk or the source scan "
        "is broken, so the assertion above proved nothing"
    )

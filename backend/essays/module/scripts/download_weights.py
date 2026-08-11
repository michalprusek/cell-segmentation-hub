#!/usr/bin/env python3
"""Fetch the v7 checkpoint (``microtubule_v7.pt``, ~1.2 GB) on demand.

The checkpoint is too large for git, so it is published as a GitHub *Release*
asset and downloaded here on first run. Because the repository is private, the
download is done with the GitHub CLI (``gh``), which reuses the credentials you
already have from cloning the repo.

    python scripts/download_weights.py            # -> weights/microtubule_v7.pt
"""
from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

REPO = "michalprusek/AutomatedEssaysModule"
RELEASE_TAG = "weights-v7"
ASSET_NAME = "microtubule_v7.pt"
EXPECTED_BYTES = 1246728570

_HERE = Path(__file__).resolve().parent
DEFAULT_DEST = _HERE.parent / "weights" / ASSET_NAME


def download_weights(dest: Path = DEFAULT_DEST) -> Path:
    dest = Path(dest)
    if dest.exists() and dest.stat().st_size == EXPECTED_BYTES:
        print(f"[weights] already present: {dest}")
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)

    if shutil.which("gh") is None:
        raise RuntimeError(
            "GitHub CLI ('gh') not found. Install it (https://cli.github.com) and "
            "run 'gh auth login', or download the asset manually from\n"
            f"  https://github.com/{REPO}/releases/tag/{RELEASE_TAG}\n"
            f"and place it at {dest}."
        )

    print(f"[weights] downloading {ASSET_NAME} (~1.2 GB) from "
          f"{REPO} release {RELEASE_TAG} ...")
    subprocess.run(
        ["gh", "release", "download", RELEASE_TAG, "-R", REPO,
         "-p", ASSET_NAME, "-O", str(dest), "--clobber"],
        check=True,
    )
    size = dest.stat().st_size
    if size != EXPECTED_BYTES:
        raise RuntimeError(
            f"downloaded {ASSET_NAME} has unexpected size {size} "
            f"(expected {EXPECTED_BYTES}); the file may be incomplete.")
    print(f"[weights] saved -> {dest} ({size/1e9:.2f} GB)")
    return dest


if __name__ == "__main__":
    try:
        download_weights()
    except Exception as e:
        print(f"[error] {e}", file=sys.stderr)
        raise SystemExit(1)

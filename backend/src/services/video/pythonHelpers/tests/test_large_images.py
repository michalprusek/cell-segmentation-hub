"""Tests for ``large_images.py`` — the one Pillow decompression-bomb ceiling.

What these pin, and why each one exists:

  - **The ceiling admits the frames this project actually receives.** Pillow's
    stock limit refuses anything past 2 x 89 478 485 pixels, so a 14000 x 14000
    microscopy frame (196 000 000) raised ``DecompressionBombError``. The
    failure was invisible until late: ``Image.fromarray(...).save()`` never
    consults the guard, so frame extraction WROTE such a PNG happily and only
    the readers downstream — playback proxy, channel alignment, drift
    correction, the ML ``/segment`` route — refused it.
  - **It is still a ceiling.** ``Image.MAX_IMAGE_PIXELS = None`` (which
    ``convert_for_display.py`` used to do) accepts any declared size, so a
    20 MB PNG claiming 60000 x 60000 would take the 12 GB container with it.
  - **Every reader is wired to it.** Pillow's limit is a module global, so it
    has to be applied once per PROCESS. A new helper that opens an image and
    forgets the call would silently run the stock limit — the scan below is
    what catches that, since no unit test of the helper itself would.
  - **The ml image still carries the module.** It lives beside the Node-side
    helpers and reaches the ml container by an explicit ``COPY``. Drop that
    line and ``api/main.py`` fails to import at startup.

Pure numpy + PIL — no pytest — so it runs in the backend container with a plain
interpreter:

  docker exec spheroseg-backend python3 \
    backend/src/services/video/pythonHelpers/tests/test_large_images.py

It is also pytest-collectable (``test_*`` functions).
"""
from __future__ import annotations

import os
import re
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

HERE = os.path.dirname(__file__)
HELPERS_DIR = os.path.abspath(os.path.join(HERE, ".."))
REPO_ROOT = os.path.abspath(os.path.join(HELPERS_DIR, "..", "..", "..", "..", ".."))
sys.path.insert(0, HELPERS_DIR)

from large_images import MAX_IMAGE_PIXELS, raise_pil_pixel_limit  # noqa: E402

#: The largest frame this project has been asked to handle, named explicitly so
#: the reason for the ceiling does not get lost in a bare number.
LARGEST_REAL_FRAME = 14_000 * 14_000

#: Pillow's own default, and the reason this module exists. It RAISES above 2x.
PILLOW_STOCK_LIMIT = 89_478_485

#: sharp's ``limitInputPixels`` default, MEASURED rather than read out of its
#: typings: in ``spheroseg-backend``, ``sharp(...).metadata()`` accepts a
#: 16383 x 16383 PNG (268 402 689) and refuses 16384 x 16384 (268 435 456)
#: with "Input image exceeds pixel limit". sharp builds the video thumbnail
#: from an extracted frame, so it is the second decoder every frame meets.
SHARP_MEASURED_WALL = 268_402_689


def test_ceiling_admits_the_largest_real_frame() -> None:
    # Not "2x the ceiling", deliberately: a value between 1x and 2x only warns,
    # and a warning that nobody reads is not a working configuration.
    assert MAX_IMAGE_PIXELS >= LARGEST_REAL_FRAME, (
        f"a {LARGEST_REAL_FRAME}-pixel frame is ordinary input here"
    )
    assert LARGEST_REAL_FRAME > 2 * PILLOW_STOCK_LIMIT, (
        "the stock limit would have accepted it, so this module is pointless"
    )


def test_ceiling_does_not_overtake_the_other_decoder() -> None:
    """The band this forbids fails SILENTLY, which is why it is pinned.

    If Pillow accepted a size sharp refuses, the frames of such a video would
    extract and decode normally while the thumbnail step threw — and
    ``videoUploadService`` catches that, logs a warning and tries the next
    candidate, so the container would just quietly have no thumbnail. One
    ceiling at the narrowest decoder is what stops that.
    """
    assert MAX_IMAGE_PIXELS <= SHARP_MEASURED_WALL, (
        "Pillow now accepts images sharp will refuse; raise limitInputPixels "
        "on the sharp call sites in the same change, or thumbnails go missing "
        "with nothing but a warning in the log"
    )


def test_ceiling_still_refuses_an_absurd_declaration() -> None:
    """A hostile 20 MB PNG can declare any size it likes; the point of keeping
    a number rather than ``None`` is that such a file is still refused before
    Pillow allocates for it. 60000 x 60000 uint16 is ~6.7 GiB of array alone,
    against a 12 GB container."""
    assert MAX_IMAGE_PIXELS < 60_000 * 60_000, (
        "the ceiling no longer refuses a file that would OOM the container"
    )


def test_raise_pil_pixel_limit_changes_what_pillow_will_DECODE() -> None:
    """Not just that the attribute is set — that a decode actually follows it.

    Asserting ``Image.MAX_IMAGE_PIXELS == MAX_IMAGE_PIXELS`` would pass against
    a function that set some other attribute of the same name, so this drives a
    real ``Image.open`` on both sides of the call.
    """
    previous = Image.MAX_IMAGE_PIXELS
    try:
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "small.png"
            Image.fromarray(np.zeros((100, 100), dtype=np.uint8)).save(path)

            # 100x100 = 10 000 pixels, over 2 x 10, so this must refuse it.
            Image.MAX_IMAGE_PIXELS = 10
            try:
                with Image.open(path) as im:
                    im.load()
                raise AssertionError("a tiny ceiling did not stop the decode")
            except Image.DecompressionBombError:
                pass

            raise_pil_pixel_limit()
            with Image.open(path) as im:
                assert np.asarray(im).shape == (100, 100)
    finally:
        Image.MAX_IMAGE_PIXELS = previous


def _helper_sources() -> dict[str, str]:
    return {
        p.name: p.read_text()
        for p in sorted(Path(HELPERS_DIR).glob("*.py"))
        if p.name != "large_images.py"
    }


def test_every_helper_that_opens_an_image_is_wired_to_the_ceiling() -> None:
    """The failure this catches: a NEW helper calls ``Image.open`` and silently
    runs Pillow's stock limit, so it refuses exactly the large frames the rest
    of the pipeline now accepts.

    A helper satisfies the rule either by applying the ceiling itself, or — for
    a module with no ``__main__`` of its own, which therefore only ever runs
    inside another helper's process — by every importer applying it.
    """
    sources = _helper_sources()
    readers = {n: s for n, s in sources.items() if "Image.open" in s}
    assert readers, "the scan found no Pillow readers at all; it is not working"

    for name, src in readers.items():
        if "raise_pil_pixel_limit()" in src:
            continue
        module = name[: -len(".py")]
        importers = [
            other
            for other, other_src in sources.items()
            if other != name
            and re.search(rf"^(?:from|import) {re.escape(module)}\b", other_src, re.M)
        ]
        assert importers, (
            f"{name} opens images, never applies the ceiling, and nothing "
            f"imports it — so it runs Pillow's stock limit"
        )
        for importer in importers:
            assert "raise_pil_pixel_limit()" in sources[importer], (
                f"{name} relies on its importer for the ceiling, but "
                f"{importer} does not apply it either"
            )


def test_the_ml_image_still_copies_the_module() -> None:
    """``backend/segmentation/api/main.py`` imports this module at startup, and
    the ml image gets it by an explicit COPY rather than by living in
    ``backend/segmentation/``. Losing that line is a boot failure, not a
    degradation — pin it here so a Dockerfile edit cannot drop it quietly."""
    dockerfile = Path(REPO_ROOT, "docker", "ml.optimized.Dockerfile")
    if not dockerfile.exists():  # running from an unexpected root
        return
    text = dockerfile.read_text()
    assert "pythonHelpers/large_images.py" in text, (
        "the ml image no longer copies large_images.py; api/main.py will not import"
    )

    main_py = Path(REPO_ROOT, "backend", "segmentation", "api", "main.py")
    if not main_py.exists():
        return
    main_src = main_py.read_text()
    applied = main_src.find("raise_pil_pixel_limit()")
    assert applied != -1, (
        "the ml service no longer applies the ceiling at its entry point"
    )
    # Pillow's limit is a module global read at decode time, not import time,
    # so ordering does not strictly matter today. It is pinned anyway because
    # the cheap way to break this is to "tidy" the call down to the bottom of
    # the imports, and the next module that reads the limit AT IMPORT would
    # then get the stock value with nothing to see.
    first_route_import = min(
        (i for i in (main_src.find("\nfrom api."), main_src.find("\nfrom ml.")) if i != -1),
        default=-1,
    )
    assert first_route_import != -1, "main.py no longer imports the routers; scan is stale"
    assert applied < first_route_import, (
        "the ceiling is applied after the route modules are imported"
    )


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"PASS {name}")
            except Exception as exc:  # noqa: BLE001 - report all, exit non-zero
                failures += 1
                print(f"FAIL {name}: {exc}")
    print(f"\n{'OK' if failures == 0 else f'{failures} FAILED'}")
    sys.exit(1 if failures else 0)

#!/usr/bin/env python3
"""One decompression-bomb ceiling for every Pillow reader in this project.

Pillow refuses to decode an image whose header claims more than
``Image.MAX_IMAGE_PIXELS`` pixels. The default is 89 478 485 (a bit under
0.75 GB of RGB), and the guard has two tiers: above 1x it emits a
``DecompressionBombWarning``, above **2x** it raises ``DecompressionBombError``.
So the effective wall is 178 956 970 pixels, and a 14000 x 14000 microscopy
frame -- 196 000 000 -- is just past it.

Why the default is wrong for THIS project rather than merely inconvenient:
the guard exists to stop a small hostile file from expanding into an
out-of-memory kill. Everything Pillow opens here has already passed
authentication and a size cap (20 MB for a still, 100 GB for a video), and a
14000 x 14000 confocal or slide-scanner frame is ordinary input, not an
attack. But the protection is still worth keeping, which is why this module
raises the ceiling instead of switching it off: ``Image.MAX_IMAGE_PIXELS =
None`` would let a 20 MB PNG declare 60000 x 60000 and take the container
with it.

WHERE THE NUMBER COMES FROM (measured 2026-09-07, not estimated). Decoding a
real 14000 x 14000 uint16 PNG inside ``spheroseg-backend``:

    array itself                374 MiB
    peak RSS through the decode 1225 MiB   (0.7 s)
    plus one float32 copy       1528 MiB   (what any processing step costs)

That is ~6.4 bytes of peak RSS per pixel, three times the array, because
Pillow holds the decoder's own buffers alongside the result. Both the backend
and the ml container are capped at 12 GB (``docker-compose.production.yml``),
and only ONE decode is ever in flight -- the ml service runs
``uvicorn --workers 1`` with ``async def`` routes, and the Node helpers are
one-shot subprocesses. So the budget for a single decode is the container.

WHY THIS EXACT NUMBER, and not simply "large enough". Pillow is not the only
decoder a frame passes through: the Node side builds video thumbnails with
sharp, which has its own independent ``limitInputPixels``. Measured in
``spheroseg-backend`` on real PNGs, sharp accepts 16383 x 16383 =
268 402 689 and refuses 16384 x 16384 = 268 435 456 ("Input image exceeds
pixel limit"). Setting Pillow's ceiling ABOVE sharp's would open a band of
sizes where a frame extracts and decodes fine but its thumbnail silently
disappears -- ``videoUploadService.ts`` catches that failure, logs a warning
and moves to the next candidate, so nothing surfaces. So the project has ONE
ceiling and it sits at the narrowest decoder in the chain.

268 402 689 pixels costs ~1.7 GiB at the rate measured above: 14 % of the
container, 37 % more than the largest frame anyone has asked for, and still
small enough that a float32 copy and a model both fit beside it. A hostile
file claiming more than that is refused before Pillow allocates for it.

Raising this is a memory decision AND a sharp decision -- re-measure
bytes-per-pixel against the 12 GB cap, and raise ``limitInputPixels`` on the
sharp call sites in the same change, or the band above comes back. Also check
the concurrency of the caller: do NOT raise it for a caller that decodes on
Starlette's 40-slot threadpool, where 40 x 1.7 GiB is an OOM, not a ceiling.
"""

from __future__ import annotations

from PIL import Image

#: Largest image Pillow may decode, in pixels: 16383 x 16383. This is sharp's
#: measured wall, not a round number -- see the module docstring for why the
#: two decoders must agree.
MAX_IMAGE_PIXELS = 268_402_689


def raise_pil_pixel_limit() -> None:
    """Apply :data:`MAX_IMAGE_PIXELS` to Pillow for this process.

    ``Image.MAX_IMAGE_PIXELS`` is a module global, so one call per process is
    enough and every later ``Image.open`` in that process is covered. Call it
    at an entry point, not at each call site.

    Deliberately unconditional: a caller that has already lowered the limit on
    purpose does not exist in this repo, and silently honouring a smaller
    pre-existing value would make the ceiling depend on import order.
    """
    Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS

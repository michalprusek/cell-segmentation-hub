"""Build 8-bit WebP playback proxies for one channel of a video container.

WHY THIS EXISTS. The editor canvas draws 16-bit PNGs straight off disk. Measured
on production, one three-channel frame is 6.3 MB and the user's link carries
~35 Mbit/s, so playback reached 1.1 frames/s against a 10 fps target. The link
is a hard ceiling (one stream 30.4 Mbit/s, four 38.6, eight 22.1 — concurrency
does not help) and lossless recompression buys at most 1.3x, because microscopy
frames are largely noise and noise does not compress.

The headroom is that we ship 11 bits at 1474 px to a canvas showing 8 bits at
about 600 px. Mapped to 8 bits and encoded WebP q90, the same frame is 141 kB —
a fifteenth of the bytes, at unchanged pixel dimensions.

WHY PYTHON AND NOT SHARP. `sharp` is already a backend dependency and its WebP
encoder is fine, but it CANNOT read these files: its pixel pipeline narrows
16-bit to 8-bit, so a sample of 1566 reads back as 6, with or without
`pipelineColourspace`, `toColourspace` or `extractChannel`. (`sharp.stats()`
does report true maxima, which is why the backend still uses it to derive the
range.) Frame extraction already runs through Python helpers, and PIL reads
16-bit PNGs correctly, so the conversion lives here.

THE RANGE IS NOT DERIVED HERE. `--range-max` is decided once per container and
channel by `playbackProxyRange.deriveRangeMax` and passed in. Deriving it per
frame would rescale each frame to its own brightest pixel, so a passing bright
object would darken the whole series and playback would flicker — a worse defect
than the stutter this removes.

A FRAME BRIGHTER THAN THE RANGE IS NOT CLIPPED. It is reported `over-range` and
no file is written, so the backend serves its original PNG. Clipping would
silently erase the brightest structures in a measurement tool.

Invoked by the backend as::

    python3 make_playback_proxy.py --frames-dir DIR --channel NAME --range-max N

It walks ``DIR/<NNNN>/<channel>.png`` and writes ``<channel>.webp`` beside each,
printing one JSON line per frame on stdout::

    {"frame": "0004", "status": "written", "bytes": 144211}
    {"frame": "0005", "status": "skipped-exists"}
    {"frame": "0006", "status": "over-range", "max": 2601}
    {"frame": "0007", "status": "error", "message": "..."}

Progress is a line per frame rather than one summary at the end so a caller can
follow a batch that takes minutes (about 274 ms per frame; roughly 2.7 minutes
for a 300-frame two-channel container).
"""

from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np
from PIL import Image

#: WebP quality. 90 was measured at 141 kB/frame on production data; 85 and 95
#: differ by under 1% on this content, so there is nothing to gain by moving it.
WEBP_QUALITY = 90


def map_to_8bit(samples: np.ndarray, range_max: int) -> np.ndarray:
    """Linearly map ``[0, range_max]`` onto ``[0, 255]``.

    Integer arithmetic in a wider type: ``samples * 255`` overflows uint16 for
    anything above 257, which would wrap bright pixels to black — the failure
    would look like dropouts in exactly the structures that matter.
    """
    if range_max <= 0:
        raise ValueError("range_max must be positive")
    scaled = samples.astype(np.uint32) * 255 // range_max
    return np.clip(scaled, 0, 255).astype(np.uint8)


def convert_frame(png_path: str, webp_path: str, range_max: int) -> dict:
    """Convert one frame, or explain why it was left alone."""
    if os.path.exists(webp_path):
        return {"status": "skipped-exists"}

    samples = np.array(Image.open(png_path))
    peak = int(samples.max()) if samples.size else 0
    if peak > range_max:
        # Out of the range the whole channel was mapped against. Writing it
        # would clip; the backend serves the original for this frame instead.
        return {"status": "over-range", "max": peak}

    out = map_to_8bit(samples, range_max)
    # Write beside the source, then rename, so a killed process never leaves a
    # truncated .webp that later looks complete and gets served.
    tmp_path = webp_path + ".partial"
    Image.fromarray(out).save(tmp_path, "WEBP", quality=WEBP_QUALITY)
    os.replace(tmp_path, webp_path)
    return {"status": "written", "bytes": os.path.getsize(webp_path)}


def frame_dirs(frames_dir: str) -> list[str]:
    """The ``NNNN`` frame directories, in frame order."""
    if not os.path.isdir(frames_dir):
        return []
    return sorted(
        name
        for name in os.listdir(frames_dir)
        if os.path.isdir(os.path.join(frames_dir, name))
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--frames-dir", required=True)
    parser.add_argument("--channel", required=True)
    parser.add_argument("--range-max", required=True, type=int)
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="stop after this many frames (0 = all); for smoke tests",
    )
    args = parser.parse_args(argv)

    names = frame_dirs(args.frames_dir)
    if args.limit > 0:
        names = names[: args.limit]

    for name in names:
        png_path = os.path.join(args.frames_dir, name, f"{args.channel}.png")
        if not os.path.exists(png_path):
            # A channel that covers only some frames — normal, not an error.
            continue
        webp_path = os.path.join(args.frames_dir, name, f"{args.channel}.webp")
        try:
            result = convert_frame(png_path, webp_path, args.range_max)
        except Exception as exc:  # noqa: BLE001 - reported per frame, never fatal
            result = {"status": "error", "message": str(exc)}
        print(json.dumps({"frame": name, **result}), flush=True)

    return 0


if __name__ == "__main__":
    sys.exit(main())

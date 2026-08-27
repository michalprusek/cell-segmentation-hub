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
does report true maxima, which is why the backend still uses it elsewhere.)
Frame extraction already runs through Python helpers, and PIL reads 16-bit PNGs
correctly, so the conversion lives here.

THE RANGE IS PER FRAME, AND TRAVELS IN THE FILE NAME. Each frame is mapped onto
its own maximum rounded up to a power of two, and written as
``<channel>.p<range>.webp`` so the backend can read the range back without
opening the file or keeping a side table, and hand it to the client — which
multiplies it back out. Nothing downstream ever sees an 8-bit number.

Per-frame would be WRONG if the client drew the proxy directly: each frame
rescaled to its own brightest pixel means a passing bright object darkens the
whole series, and playback flickers. It is right BECAUSE the client undoes the
mapping. The samples it composites are the original values either way, so the
only thing that varies between frames is the quantisation step.

And that matters here. Measured on the container this was written for, the
three channels peak at 8984, 1177 and 29636, and within the first of those the
frame maxima run 1950, 2473, 8984 — a 4.6x spread. One range fixed across the
container (32767) would leave the 1177 channel 9 of the 256 levels; fixed
across a channel (16383) would leave that channel's dimmest frame 30. Per
frame, nothing can fall outside its own range, and every frame gets at least
half the 256 levels — the range is rounded UP to a power of two, so a peak
lands somewhere in 128..255 rather than exactly at the top.

Invoked by the backend as::

    python3 make_playback_proxy.py --frames-dir DIR --channel NAME

It walks ``DIR/<NNNN>/<channel>.png`` and writes ``<channel>.p<range>.webp``
beside each, printing one JSON line per frame on stdout::

    {"frame": "0004", "status": "written", "bytes": 144211, "rangeMax": 2047}
    {"frame": "0005", "status": "skipped-exists"}
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


def derive_range_max(peak: int) -> int:
    """The value that maps to 255: ``peak`` rounded up to a power of two.

    Rounding rather than using the peak directly keeps the number to a handful
    of distinct values across a series, which keeps the file names — and
    anything caching by them — stable while frames wobble by a few counts.

    Mirrors ``playbackProxyRange.deriveRangeMax`` on the TypeScript side, which
    still decides the container-wide figure the client uses to judge whether
    8 bits are enough for the window the user has set.
    """
    bits = 8
    while (1 << bits) - 1 < peak and bits < 16:
        bits += 1
    return min((1 << bits) - 1, 65535)


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


def proxy_path(frame_dir: str, channel: str, range_max: int) -> str:
    """Where this frame's proxy goes, range included in the name."""
    return os.path.join(frame_dir, f"{channel}.p{range_max}.webp")


def existing_proxy(frame_dir: str, channel: str) -> str | None:
    """Any already-written proxy for this channel, whatever range it used."""
    prefix, suffix = f"{channel}.p", ".webp"
    try:
        for name in sorted(os.listdir(frame_dir)):
            if name.startswith(prefix) and name.endswith(suffix):
                return os.path.join(frame_dir, name)
    except OSError:
        # The frame directory may not exist yet, or may be mid-write while the
        # extractor is still running. Either way there is no frame to return and
        # None is the answer; the caller retries on the next poll.
        pass
    return None


def convert_frame(png_path: str, frame_dir: str, channel: str) -> dict:
    """Convert one frame, or say it was already done."""
    if existing_proxy(frame_dir, channel):
        return {"status": "skipped-exists"}

    samples = np.array(Image.open(png_path))
    peak = int(samples.max()) if samples.size else 0
    range_max = derive_range_max(peak)
    webp_path = proxy_path(frame_dir, channel, range_max)

    out = map_to_8bit(samples, range_max)
    # Write beside the source, then rename, so a killed process never leaves a
    # truncated .webp that later looks complete and gets served. The pid is in
    # the temp name because the in-flight guard that stops two converters
    # running is per backend PROCESS: a restart mid-batch, or a second replica,
    # can put two of them on the same frame. Sharing one temp path would let
    # them interleave writes and rename an interleaved file into place, where
    # it would be served under an hour-long cache and simply fail to decode.
    tmp_path = f"{webp_path}.{os.getpid()}.partial"
    Image.fromarray(out).save(tmp_path, "WEBP", quality=WEBP_QUALITY)
    os.replace(tmp_path, webp_path)
    return {
        "status": "written",
        "bytes": os.path.getsize(webp_path),
        "rangeMax": range_max,
    }


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
        frame_dir = os.path.join(args.frames_dir, name)
        png_path = os.path.join(frame_dir, f"{args.channel}.png")
        if not os.path.exists(png_path):
            # A channel that covers only some frames — normal, not an error.
            continue
        try:
            result = convert_frame(png_path, frame_dir, args.channel)
        except Exception as exc:  # noqa: BLE001 - reported per frame, never fatal
            result = {"status": "error", "message": str(exc)}
        print(json.dumps({"frame": name, **result}), flush=True)

    return 0


if __name__ == "__main__":
    sys.exit(main())

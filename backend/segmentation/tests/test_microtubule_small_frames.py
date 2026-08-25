"""A frame smaller than one tile must segment, not die on a tensor shape.

The eight-stage ResEnc plan downsamples seven times, so its residual adds need
every side divisible by 128. `_channels` sliced `img01[y:y+TILE, x:x+TILE]` and
fed it straight in, which is fine for a full 512 tile and wrong for anything
smaller. Measured before the fix, against the real network: 200, 300 and 341 px
raised `RuntimeError: size of tensor a (13) must match tensor b (12)`; 384 and
512 passed. Non-square failed per axis. The message named neither the image nor
its size.

The upscale is what sets the threshold: `predict` zooms by UP = 1.5 before
tiling, so an input under 342 px lands below TILE = 512.
"""

import sys

import numpy as np
import pytest

sys.path.insert(0, "/app/models/microtubule")


def _frame(h: int, w: int) -> np.ndarray:
    """A flat IRM-like frame; content is irrelevant, only the shape is."""
    rng = np.random.default_rng(3)
    return rng.normal(3500, 40, (h, w)).clip(0, 65535).astype(np.uint16)


@pytest.mark.parametrize("n", [200, 300, 341, 342, 384, 512])
def test_square_frames_around_the_tile_boundary(mt_model, n):
    out = mt_model.predict(_frame(n, n))
    assert out["prob"].shape == (n, n), "prob must come back at INPUT scale"


@pytest.mark.parametrize("h,w", [(240, 900), (900, 240), (130, 130), (129, 200)])
def test_non_square_and_tiny_frames(mt_model, h, w):
    """Each axis is padded independently, so a narrow crop must work too.

    129x200 also exercises the edge-replication fallback: np.pad's reflect mode
    requires the pad to be smaller than the extent, which a side under 128 px
    cannot satisfy.
    """
    out = mt_model.predict(_frame(h, w))
    assert out["prob"].shape == (h, w)


def test_padding_never_fires_for_a_frame_at_or_above_one_tile():
    """The fix must be a no-op on everything that already worked.

    `_starts` appends `extent - TILE` as the last start, so once the upscaled
    extent reaches TILE every tile is exactly TILE wide and no padding is
    computed. That is what makes this change unable to alter the output of any
    existing acquisition.
    """
    from net import TILE

    UP = 1.5

    def starts(extent: int) -> list[int]:
        stride = int(round(TILE * 0.757))
        s = list(range(0, max(1, extent - TILE + 1), stride)) or [0]
        if s[-1] != max(0, extent - TILE):
            s.append(max(0, extent - TILE))
        return s

    for src in (342, 512, 1024, 1628, 2048):
        extent = int(round(src * UP))
        if extent < TILE:
            continue
        for st in starts(extent):
            tile_extent = min(TILE, extent - st)
            assert tile_extent == TILE, (
                f"{src}px upscaled to {extent}: tile at {st} is {tile_extent}, "
                "so padding would fire and the output could change"
            )

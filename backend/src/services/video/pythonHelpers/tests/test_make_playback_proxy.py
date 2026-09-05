"""Tests for the 8-bit WebP playback proxy converter."""

import json
import os
import sys

import numpy as np
import pytest
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from make_playback_proxy import (  # noqa: E402
    convert_frame,
    derive_range_max,
    existing_proxy,
    frame_dirs,
    main,
    map_to_8bit,
)


def write_png(path: str, samples: np.ndarray) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    Image.fromarray(samples.astype(np.uint16)).save(path)


class TestMapTo8Bit:
    def test_maps_the_range_ends_onto_the_output_ends(self):
        out = map_to_8bit(np.array([0, 2047], dtype=np.uint16), 2047)
        assert list(out) == [0, 255]

    def test_maps_the_midpoint_near_the_middle(self):
        out = map_to_8bit(np.array([1024], dtype=np.uint16), 2047)
        assert 127 <= int(out[0]) <= 128

    def test_does_not_overflow_on_bright_samples(self):
        # samples * 255 exceeds uint16 above 257; done in uint16 this wraps and
        # bright pixels come out black, which would read as dropouts.
        out = map_to_8bit(np.array([1566, 2047], dtype=np.uint16), 2047)
        assert list(out) == [195, 255]

    def test_preserves_monotonicity_across_the_whole_range(self):
        values = np.arange(0, 2048, dtype=np.uint16)
        out = map_to_8bit(values, 2047).astype(np.int32)
        assert np.all(np.diff(out) >= 0)

    def test_refuses_a_zero_range(self):
        with pytest.raises(ValueError):
            map_to_8bit(np.array([1], dtype=np.uint16), 0)


class TestDeriveRangeMax:
    def test_is_the_peak_itself(self):
        # Was `peak` rounded up to a power of two, which threw away up to half
        # the proxy's levels. The old answers are named here so the change is
        # legible: 1566 -> 2047, 8984 -> 16383, 29636 -> 32767.
        assert derive_range_max(1566) == 1566
        assert derive_range_max(8984) == 8984
        assert derive_range_max(29636) == 29636

    def test_the_worst_case_this_change_was_made_for(self):
        # A real production IRM frame. Under the old rule this peak crossed
        # into the 16-bit bucket and was encoded against 65535, so the
        # brightest pixel reached level 130 of 255 and the frame showed 66
        # distinct greys instead of 112.
        assert derive_range_max(33557) == 33557

    def test_floors_at_one_so_an_all_black_frame_has_a_usable_range(self):
        # map_to_8bit refuses a zero range; an all-black frame has peak 0.
        assert derive_range_max(0) == 1
        # Below 255 the choice carries no information: 13 distinct values
        # survive whether the range is 12 or 255.
        assert derive_range_max(12) == 12

    def test_caps_at_the_16_bit_ceiling(self):
        assert derive_range_max(65535) == 65535
        assert derive_range_max(70000) == 65535

    def test_no_longer_mirrors_the_typescript_side(self):
        # The divergence is deliberate. `playbackProxyRange.deriveRangeMax`
        # still rounds up because it is the CONTAINER figure, sampled from
        # three frames of three hundred, where rounding up is what keeps a
        # brighter frame elsewhere inside the estimate. This one sees the
        # frame it is encoding, so it needs no margin.
        assert derive_range_max(2048) == 2048  # the TS side answers 4095


class TestConvertFrame:
    def test_writes_a_proxy_naming_its_own_range(self, tmp_path):
        frame_dir = str(tmp_path / "0000")
        png = os.path.join(frame_dir, "488_nm.png")
        write_png(png, np.full((32, 32), 1000))

        result = convert_frame(png, frame_dir, "488_nm")

        assert result["status"] == "written"
        assert result["rangeMax"] == 1000
        assert os.path.exists(os.path.join(frame_dir, "488_nm.p1000.v2.webp"))

    def test_a_dim_frame_gets_its_own_narrow_range(self, tmp_path):
        # The point of per-frame: this frame would have had 30 of 256 levels
        # under a range covering the channel's brightest frame (8984).
        frame_dir = str(tmp_path / "0000")
        png = os.path.join(frame_dir, "488_nm.png")
        write_png(png, np.full((16, 16), 1950))

        assert convert_frame(png, frame_dir, "488_nm")["rangeMax"] == 1950

    def test_the_brightest_pixel_reaches_the_top_of_the_ramp(self, tmp_path):
        # The whole point. Under the power-of-two rule a frame peaking at
        # 33557 was encoded against 65535 and its brightest pixel came out at
        # 130; every level above that was unreachable, and the rest of the
        # frame was squeezed into the bottom half.
        frame_dir = str(tmp_path / "0000")
        png = os.path.join(frame_dir, "IRM.png")
        ramp = np.linspace(11349, 33557, 256).astype(np.uint16)
        write_png(png, np.tile(ramp, (16, 1)))

        result = convert_frame(png, frame_dir, "IRM")
        assert result["rangeMax"] == 33557

        # The claim, on the pure mapping: the peak lands exactly on 255. Under
        # the old power-of-two rule the range was 65535 and this was 130.
        assert int(map_to_8bit(np.array([33557], dtype=np.uint16), 33557)[0]) == 255
        assert int(map_to_8bit(np.array([33557], dtype=np.uint16), 65535)[0]) == 130

        from PIL import Image

        out = np.array(Image.open(os.path.join(frame_dir, "IRM.p33557.v2.webp")))
        if out.ndim == 3:
            out = out[..., 0]
        # The written file is lossy WEBP at quality 90, which moves the top
        # pixel by a count — measured 254, not 255. The tolerance is here to
        # record that, not to hide it; 130 is nowhere near either bound.
        assert int(out.max()) >= 250

    def test_leaves_no_partial_file_behind(self, tmp_path):
        frame_dir = str(tmp_path / "0000")
        png = os.path.join(frame_dir, "488_nm.png")
        write_png(png, np.full((32, 32), 1000))

        convert_frame(png, frame_dir, "488_nm")

        assert not any(n.endswith(".partial") for n in os.listdir(frame_dir))

    def test_does_not_redo_work_whatever_range_the_existing_one_used(
        self, tmp_path
    ):
        frame_dir = str(tmp_path / "0000")
        png = os.path.join(frame_dir, "488_nm.png")
        write_png(png, np.full((32, 32), 1000))
        convert_frame(png, frame_dir, "488_nm")

        assert (
            convert_frame(png, frame_dir, "488_nm")["status"] == "skipped-exists"
        )

    def test_ignores_a_v1_proxy_so_the_frame_is_re_encoded(self, tmp_path):
        # v1 encoded against the peak rounded up to a power of two. Its name
        # carries no clue — `p2047` is both a v1 file for a peak of 1566 and a
        # perfectly ordinary v2 peak — so the scheme marker is the only signal,
        # and without this the 6 838 proxies already on disk would be served
        # forever and the change would do nothing.
        frame_dir = str(tmp_path / "0000")
        os.makedirs(frame_dir, exist_ok=True)
        stale = os.path.join(frame_dir, "488_nm.p2047.webp")
        with open(stale, "wb") as fh:
            fh.write(b"not a real webp")

        assert existing_proxy(frame_dir, "488_nm") is None

        png = os.path.join(frame_dir, "488_nm.png")
        write_png(png, np.full((16, 16), 1566))
        result = convert_frame(png, frame_dir, "488_nm")

        assert result["status"] == "written"
        assert result["rangeMax"] == 1566
        assert os.path.exists(os.path.join(frame_dir, "488_nm.p1566.v2.webp"))
        # The stale file is left alone: it is not ours to delete mid-request,
        # and a separate sweep can reclaim the space.
        assert os.path.exists(stale)

    def test_finds_an_existing_proxy_by_prefix_not_exact_name(self, tmp_path):
        frame_dir = str(tmp_path / "0000")
        os.makedirs(frame_dir)
        open(os.path.join(frame_dir, "488_nm.p4095.v2.webp"), "w").close()

        assert existing_proxy(frame_dir, "488_nm") is not None
        assert existing_proxy(frame_dir, "640_nm") is None

    def test_does_not_mistake_another_channel_for_this_one(self, tmp_path):
        frame_dir = str(tmp_path / "0000")
        os.makedirs(frame_dir)
        open(os.path.join(frame_dir, "488_nm_extra.p2047.v2.webp"), "w").close()

        assert existing_proxy(frame_dir, "488_nm_extra") is not None
        # A channel whose name is a PREFIX of another must not match it.
        assert existing_proxy(frame_dir, "488_nm") is None


class TestMain:
    def test_reports_one_line_per_frame_and_skips_uncovered_ones(
        self, tmp_path, capsys
    ):
        for i, value in enumerate([500, 900, 2601]):
            write_png(
                str(tmp_path / f"{i:04d}" / "488_nm.png"), np.full((16, 16), value)
            )
        # A frame the channel does not cover at all.
        os.makedirs(tmp_path / "0003", exist_ok=True)

        main(
            [
                "--frames-dir",
                str(tmp_path),
                "--channel",
                "488_nm",
            ]
        )

        lines = [json.loads(l) for l in capsys.readouterr().out.strip().splitlines()]
        assert [l["frame"] for l in lines] == ["0000", "0001", "0002"]
        assert [l["status"] for l in lines] == ["written"] * 3
        # Each frame carries the range it was mapped against.
        # Each frame's own peak now, not that peak rounded up to a power of
        # two — which for these three fixtures answered 511 / 1023 / 4095.
        assert [l["rangeMax"] for l in lines] == [500, 900, 2601]

    def test_frame_dirs_are_returned_in_frame_order(self, tmp_path):
        for name in ["0010", "0002", "0001"]:
            os.makedirs(tmp_path / name)
        assert frame_dirs(str(tmp_path)) == ["0001", "0002", "0010"]

    def test_a_missing_frames_dir_is_empty_rather_than_an_error(self, tmp_path):
        assert frame_dirs(str(tmp_path / "nope")) == []

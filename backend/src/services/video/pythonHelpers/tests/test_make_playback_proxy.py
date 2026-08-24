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
    def test_rounds_up_to_a_power_of_two(self):
        assert derive_range_max(1566) == 2047
        assert derive_range_max(8984) == 16383
        assert derive_range_max(29636) == 32767

    def test_never_narrows_below_eight_bits(self):
        assert derive_range_max(0) == 255
        assert derive_range_max(12) == 255

    def test_matches_the_typescript_side_at_the_boundaries(self):
        assert derive_range_max(2047) == 2047
        assert derive_range_max(2048) == 4095
        assert derive_range_max(65535) == 65535


class TestConvertFrame:
    def test_writes_a_proxy_naming_its_own_range(self, tmp_path):
        frame_dir = str(tmp_path / "0000")
        png = os.path.join(frame_dir, "488_nm.png")
        write_png(png, np.full((32, 32), 1000))

        result = convert_frame(png, frame_dir, "488_nm")

        assert result["status"] == "written"
        assert result["rangeMax"] == 1023
        assert os.path.exists(os.path.join(frame_dir, "488_nm.p1023.webp"))

    def test_a_dim_frame_gets_its_own_narrow_range(self, tmp_path):
        # The point of per-frame: this frame would have had 30 of 256 levels
        # under a range covering the channel's brightest frame (8984).
        frame_dir = str(tmp_path / "0000")
        png = os.path.join(frame_dir, "488_nm.png")
        write_png(png, np.full((16, 16), 1950))

        assert convert_frame(png, frame_dir, "488_nm")["rangeMax"] == 2047

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

    def test_finds_an_existing_proxy_by_prefix_not_exact_name(self, tmp_path):
        frame_dir = str(tmp_path / "0000")
        os.makedirs(frame_dir)
        open(os.path.join(frame_dir, "488_nm.p4095.webp"), "w").close()

        assert existing_proxy(frame_dir, "488_nm") is not None
        assert existing_proxy(frame_dir, "640_nm") is None

    def test_does_not_mistake_another_channel_for_this_one(self, tmp_path):
        frame_dir = str(tmp_path / "0000")
        os.makedirs(frame_dir)
        open(os.path.join(frame_dir, "488_nm_extra.p2047.webp"), "w").close()

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
        assert [l["rangeMax"] for l in lines] == [511, 1023, 4095]

    def test_frame_dirs_are_returned_in_frame_order(self, tmp_path):
        for name in ["0010", "0002", "0001"]:
            os.makedirs(tmp_path / name)
        assert frame_dirs(str(tmp_path)) == ["0001", "0002", "0010"]

    def test_a_missing_frames_dir_is_empty_rather_than_an_error(self, tmp_path):
        assert frame_dirs(str(tmp_path / "nope")) == []
